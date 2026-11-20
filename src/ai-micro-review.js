import { aiChat, parseJsonFromModel } from "./ai-chat.js";
import { enrichFinding } from "./finding-meta.js";
import { splitPatchIntoHunks } from "./partition.js";

/**
 * @typedef {import('./partition.js').MicroPr} MicroPr
 * @typedef {import('./review-engine.js').Finding} Finding
 */

const PATCH_LIMIT = 12000;

/**
 * @param {MicroPr} micro
 * @param {{ architectureSummary?: string }} ctx
 * @returns {Promise<Finding[]>}
 */
export async function aiReviewMicroSlice(micro, ctx = {}) {
  if (!micro.files.length) return [];

  const slices = micro.files.map((f) => ({
    path: f.filename,
    status: f.status,
    patch: (f.patch ?? "").slice(0, 2000),
  }));

  const system = `You are a strict code reviewer for one architectural slice of a PR.
Return JSON: { "findings": [ { "ruleId": "string", "severity": "info"|"warning"|"blocker", "message": "string", "filename": "optional path" } ] }
Max 8 findings. Focus on bugs, security, missing tests, and boundary violations. No nitpicks.`;

  const user = JSON.stringify({
    component: {
      id: micro.componentId,
      name: micro.componentName,
      depends_on: micro.dependsOn,
    },
    pr_context: ctx.architectureSummary?.slice(0, 1500) ?? "",
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
    maxTokens: 1500,
  });

  const parsed = parseJsonFromModel(raw);
  if (!Array.isArray(parsed.findings)) return [];

  return parsed.findings
    .slice(0, 8)
    .map((f) =>
      enrichFinding({
        ruleId: `ai/${String(f.ruleId ?? "review").replace(/\s+/g, "-")}`,
        severity: normalizeSeverity(f.severity),
        message: String(f.message ?? "Review note"),
        filename: f.filename ? String(f.filename) : undefined,
      })
    )
    .filter((f) => f.message);
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