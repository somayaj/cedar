import { activeAiProvider } from "./ai-chat.js";
import { cursorApiKey } from "./ai-credentials.js";
import { composerReviewChat } from "./cursor-llm.js";
import { resolveCursorModel } from "./default-model.js";
import { enrichFinding, normalizeFindingPriority, normalizeFindingTag } from "./finding-meta.js";
import { parseJsonFromModel } from "./openrouter.js";
import { splitPatchIntoHunks } from "./partition.js";
import { clipCodeExcerpt, resolveCommentLineInPatch } from "./patch-review.js";

/**
 * @typedef {import('./partition.js').MicroPr} MicroPr
 * @typedef {import('./review-engine.js').Finding} Finding
 */

const PATCH_LIMIT = 32000;
const PER_FILE_PATCH = 9000;

function maxSliceComments() {
  const n = Number.parseInt(String(process.env.CEDAR_SLICE_REVIEW_MAX_COMMENTS ?? "18"), 10);
  return Number.isFinite(n) ? Math.max(4, Math.min(n, 28)) : 18;
}

/**
 * @param {MicroPr} micro
 * @param {{ architectureSummary?: string }} ctx
 * @returns {Promise<Finding[]>}
 */
export async function aiReviewMicroSlice(micro, ctx = {}) {
  if (!micro.files.length) return [];
  if (!cursorApiKey()) return [];
  if (activeAiProvider() !== "cursor") {
    throw new Error(
      "Composer slice review requires CURSOR_API_KEY and CEDAR_AI_PROVIDER=cursor (unset OPENROUTER_API_KEY)."
    );
  }

  const files = micro.files
    .filter((f) => (f.patch ?? "").trim().length > 0)
    .map((f) => ({
      path: f.filename,
      status: f.status,
      patch: (f.patch ?? "").slice(0, PER_FILE_PATCH),
    }));

  if (!files.length) return [];

  const model = resolveCursorModel();

  const system = `You are a senior engineer doing a **granular, technical** line review on a PR slice.
Use repo read/search tools when available to verify callers, types, error paths, and test coverage — then anchor comments to specific + lines in the provided patches.
Tone: direct, precise, collegial. Name symbols, types, invariants, and failure modes. No fluff, no process metrics, no "finding" jargon.

Output JSON only: { "comments": [ {
  "ruleId": "short technical slug (e.g. null-deref, race, authz-gap)",
  "severity": "info"|"warning"|"blocker",
  "priority": "P0"|"P1"|"P2"|"P3",
  "tag": "security"|"boundary"|"architecture"|"quality"|"hygiene",
  "message": "2–6 sentences: what changed, concrete risk/bug, why it fails or scales badly, what to do (mention function/type names)",
  "filename": "exact files[].path",
  "line": NEW-file line number from + lines in the patch (required),
  "suggestion": "concrete fix: one line or small fenced snippet when applicable"
} ] }

Rules:
- ONLY comment on + lines present in files[]; every item needs exact filename + line.
- Prefer **many specific** comments over few vague ones (up to ${maxSliceComments()}). Skip style-only nits unless they hide bugs.
- Cover when relevant: correctness, edge cases, concurrency/async, error handling, API/typing contracts, security (injection/authz/secrets), perf hot paths, backward compatibility, missing tests for new behavior.
- Each message must reference real code from the diff (identifiers, operators, or logic) — not slice metadata.
- blocker = ship-stopper or high-likelihood production bug; warning = should fix; info = worthwhile hardening.
- Include suggestion for blocker and warning when a local fix exists.`;

  const user = JSON.stringify({
    model_hint: model,
    component: {
      id: micro.componentId,
      name: micro.componentName,
      depends_on: micro.dependsOn,
    },
    pr_context: ctx.architectureSummary?.slice(0, 2500) ?? "",
    files,
    hunk_count: micro.files.reduce((n, f) => n + splitPatchIntoHunks(f.patch ?? "").length, 0),
    patch_bytes: Math.min(PATCH_LIMIT, micro.files.reduce((n, f) => n + (f.patch?.length ?? 0), 0)),
  });

  const raw = await composerReviewChat({
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    json: true,
    model,
  });

  const parsed = parseJsonFromModel(raw);
  const items = Array.isArray(parsed.comments) ? parsed.comments : parsed.findings;
  if (!Array.isArray(items)) return [];

  /** @type {Map<string, string>} */
  const patchByPath = new Map(micro.files.map((f) => [f.filename, f.patch ?? ""]));

  return items
    .slice(0, maxSliceComments())
    .map((f) => {
      const filename = f.filename ? String(f.filename) : "";
      const patch = patchByPath.get(filename) ?? "";
      const line = resolveCommentLineInPatch(patch, Number(f.line));
      const suggestion = f.suggestion ? String(f.suggestion).trim() : "";
      let baseMessage = String(f.message ?? "").trim();
      if (!baseMessage || !filename || line == null) return null;

      if (suggestion) {
        baseMessage = `${baseMessage}\n\n**Suggested change:**\n${suggestion.startsWith("```") ? suggestion : `\`${suggestion}\``}`;
      }
      const tag = normalizeFindingTag(f.tag);
      const priority = normalizeFindingPriority(f.priority);

      const hitLine = patch ? firstAddedTextAtLine(patch, line) : "";
      if (hitLine && !baseMessage.includes("`")) {
        baseMessage = `${baseMessage} (\`${clipCodeExcerpt(hitLine, 80)}\`)`;
      }

      return enrichFinding({
        ruleId: `composer/${String(f.ruleId ?? "review").replace(/\s+/g, "-")}`,
        severity: normalizeSeverity(f.severity),
        message: baseMessage,
        filename,
        line,
        tag,
        priority,
        source: "composer",
      });
    })
    .filter(Boolean);
}

/**
 * @param {string} patch
 * @param {number} line
 */
function firstAddedTextAtLine(patch, line) {
  let current = 1;
  for (const raw of patch.split("\n")) {
    const hunk = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      current = Number.parseInt(hunk[1], 10);
      continue;
    }
    if (raw.startsWith("+++") || raw.startsWith("---") || raw.startsWith("diff ")) continue;
    if (raw.startsWith("+")) {
      if (current === line) return raw.slice(1).trim();
      current += 1;
    } else if (raw.startsWith(" ")) {
      current += 1;
    }
  }
  return "";
}

/**
 * @param {unknown} value
 * @returns {'info'|'warning'|'blocker'}
 */
function normalizeSeverity(value) {
  const s = String(value ?? "info").toLowerCase();
  if (s === "blocker" || s === "error" || s === "critical") return "blocker";
  if (s === "warning" || s === "warn") return "warning";
  return "info";
}