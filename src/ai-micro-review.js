import { activeAiProvider } from "./ai-chat.js";
import { cursorApiKey } from "./ai-credentials.js";
import { composerReviewChat } from "./cursor-llm.js";
import { resolveCursorModel } from "./default-model.js";
import { enrichFinding, normalizeFindingPriority, normalizeFindingTag } from "./finding-meta.js";
import { parseJsonFromModel } from "./openrouter.js";
import { splitPatchIntoHunks } from "./partition.js";
import { clipCodeExcerpt, validateLineInPatch } from "./patch-review.js";

/**
 * @typedef {import('./partition.js').MicroPr} MicroPr
 * @typedef {import('./review-engine.js').Finding} Finding
 */

const PATCH_LIMIT = 28000;
const PER_FILE_PATCH = 6000;

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

  const system = `You are a senior engineer writing GitHub inline code review comments using the Composer review style.
Output JSON only: { "findings": [ {
  "ruleId": "security|quality|architecture|boundary|hygiene/short-snake-id",
  "severity": "info"|"warning"|"blocker",
  "priority": "P0"|"P1"|"P2"|"P3",
  "tag": "security"|"boundary"|"architecture"|"quality"|"hygiene",
  "message": "2-4 sentences: what the changed code does wrong, user impact, concrete fix",
  "filename": "must match files[].path exactly",
  "line": integer line number on the NEW file (RIGHT side) from the unified diff + lines,
  "suggestion": "optional one-line code fix"
} ] }
Rules:
- ONLY comment on lines that appear as additions (+) in the patch — every finding MUST have valid filename + line.
- Each message must reference the actual change (logic, types, error handling, security), not slice metadata or file counts.
- No "spot check", "large diff", or process notes. No praise. Max 12 findings per slice.
- P0/P1 for security and correctness blockers; P2 warnings; P3 nits.`;

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
  if (!Array.isArray(parsed.findings)) return [];

  /** @type {Map<string, string>} */
  const patchByPath = new Map(micro.files.map((f) => [f.filename, f.patch ?? ""]));

  return parsed.findings
    .slice(0, 12)
    .map((f) => {
      const filename = f.filename ? String(f.filename) : "";
      const patch = patchByPath.get(filename) ?? "";
      const line = Number(f.line);
      const suggestion = f.suggestion ? String(f.suggestion).trim() : "";
      let baseMessage = String(f.message ?? "").trim();
      if (!baseMessage || !filename || !validateLineInPatch(patch, line)) return null;

      if (suggestion) baseMessage = `${baseMessage}\n\n_Suggestion:_ ${suggestion}`;
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