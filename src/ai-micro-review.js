import { aiChat, activeAiProvider, parseJsonFromModel } from "./ai-chat.js";
import { cursorApiKey } from "./ai-credentials.js";
import { enrichFinding, normalizeFindingPriority, normalizeFindingTag } from "./finding-meta.js";
import { splitPatchIntoHunks } from "./partition.js";

/**
 * @typedef {import('./partition.js').MicroPr} MicroPr
 * @typedef {import('./review-engine.js').Finding} Finding
 */

const PATCH_LIMIT = 22000;
const PER_FILE_PATCH = 4500;

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
      "AI slice review uses Cursor only. Set CURSOR_API_KEY, CEDAR_AI_PROVIDER=cursor, and unset OPENROUTER_API_KEY."
    );
  }

  const slices = micro.files.map((f) => ({
    path: f.filename,
    status: f.status,
    patch: (f.patch ?? "").slice(0, PER_FILE_PATCH),
  }));

  const system = `You are a senior reviewer writing inline pull-request comments on changed lines only.
Return JSON: { "findings": [ {
  "ruleId": "category/short-id",
  "severity": "info"|"warning"|"blocker",
  "priority": "P0"|"P1"|"P2"|"P3",
  "tag": "security"|"boundary"|"architecture"|"quality"|"hygiene",
  "message": "2-4 sentences: what changed, concrete risk, what to fix",
  "filename": "exact path from files[].path",
  "line": line number on the NEW file side (from + lines in patch),
  "suggestion": "optional short fix"
} ] }
Rules:
- Every finding MUST cite a real filename and line from the provided patches.
- Write like a GitHub review comment (specific, actionable). No generic praise or slice-level summaries.
- Use tag "security" for auth, injection, secrets, crypto, unsafe APIs.
- Max 10 findings; skip generated/lockfile-only noise.`;

  const user = JSON.stringify({
    component: {
      id: micro.componentId,
      name: micro.componentName,
      depends_on: micro.dependsOn,
    },
    pr_context: ctx.architectureSummary?.slice(0, 2000) ?? "",
    files: slices,
    total_patch_chars: Math.min(
      PATCH_LIMIT,
      micro.files.reduce((n, f) => n + (f.patch?.length ?? 0), 0)
    ),
    hunk_count: micro.files.reduce((n, f) => n + splitPatchIntoHunks(f.patch ?? "").length, 0),
  });

  const raw = await aiChat({
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    json: true,
    maxTokens: 2200,
  });

  const parsed = parseJsonFromModel(raw);
  if (!Array.isArray(parsed.findings)) return [];

  return parsed.findings
    .slice(0, 10)
    .map((f) => {
      const suggestion = f.suggestion ? String(f.suggestion).trim() : "";
      const baseMessage = String(f.message ?? "Review note").trim();
      const message = suggestion ? `${baseMessage}\n\n_Suggestion:_ ${suggestion}` : baseMessage;
      const line = Number(f.line);
      const tag = normalizeFindingTag(f.tag);
      const priority = normalizeFindingPriority(f.priority);

      return enrichFinding({
        ruleId: `ai/${String(f.ruleId ?? "review").replace(/\s+/g, "-")}`,
        severity: normalizeSeverity(f.severity),
        message,
        filename: f.filename ? String(f.filename) : undefined,
        line: Number.isFinite(line) && line > 0 ? line : undefined,
        tag,
        priority,
      });
    })
    .filter((f) => f.message && f.filename);
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