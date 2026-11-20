/**
 * Parse unified diff hunks for line-anchored review findings.
 */

/**
 * @param {string} patch
 * @returns {Generator<{ line: number, text: string, kind: "add"|"context"|"del" }>}
 */
export function* walkPatchLines(patch) {
  if (!patch?.trim()) return;
  let line = 1;
  for (const raw of patch.split("\n")) {
    const hunk = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      line = Number.parseInt(hunk[1], 10);
      continue;
    }
    if (raw.startsWith("+++") || raw.startsWith("---") || raw.startsWith("diff ") || raw.startsWith("\\")) continue;
    if (raw.startsWith("+")) {
      yield { line, text: raw.slice(1), kind: "add" };
      line += 1;
    } else if (raw.startsWith("-")) {
      yield { line, text: raw.slice(1), kind: "del" };
    } else if (raw.startsWith(" ")) {
      yield { line, text: raw.slice(1), kind: "context" };
      line += 1;
    }
  }
}

/**
 * @param {string} patch
 * @param {RegExp} re
 * @returns {{ line: number, text: string } | null}
 */
export function firstAddedLineMatching(patch, re) {
  for (const row of walkPatchLines(patch)) {
    if (row.kind !== "add") continue;
    if (re.test(row.text)) return { line: row.line, text: row.text.trim() };
  }
  return null;
}

/**
 * @param {string} text
 * @param {number} [max = 120]
 */
export function clipCodeExcerpt(text, max = 120) {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

/**
 * @param {string} message
 * @param {{ line: number, text: string }} hit
 */
export function withCodeAnchor(message, hit) {
  const excerpt = clipCodeExcerpt(hit.text);
  return `${message} (line ${hit.line}: \`${excerpt}\`)`;
}

/**
 * @typedef {{
 *   ruleId: string,
 *   severity: "info"|"warning"|"blocker",
 *   re: RegExp,
 *   message: string,
 *   tag?: import("./finding-meta.js").FindingTag,
 *   priority?: import("./finding-meta.js").FindingPriority,
 * }} AddedLineRule
 */

/** @type {AddedLineRule[]} */
export const ADDED_LINE_RULES = [
  {
    ruleId: "security/sql-concat",
    severity: "warning",
    re: /(SELECT|INSERT|UPDATE|DELETE).*\+|`.*\$\{/i,
    message:
      "Possible SQL/query built via string concatenation or template — use parameters/prepared statements to avoid injection.",
    tag: "security",
    priority: "P1",
  },
  {
    ruleId: "security/disable-auth",
    severity: "warning",
    re: /@PreAuthorize\s*\(\s*["']permitAll|csrf\(\)\.disable|CorsConfiguration.*\*|allowedOrigins.*\*/,
    message: "Auth/CORS/CSRF may be relaxed in this change — confirm threat model and scope.",
    tag: "security",
    priority: "P1",
  },
  {
    ruleId: "quality/empty-catch",
    severity: "warning",
    re: /catch\s*\([^)]*\)\s*\{\s*\}/,
    message: "Empty catch block swallows errors — log, wrap, or handle explicitly.",
    tag: "quality",
    priority: "P2",
  },
  {
    ruleId: "quality/swallowed-promise",
    severity: "warning",
    re: /\.catch\s*\(\s*\(\)\s*=>\s*\{\s*\}\s*\)|\.catch\s*\(\s*_?\s*=>\s*\{\s*\}\s*\)/,
    message: "Promise rejection handler appears empty — surface failures to callers or monitoring.",
    tag: "quality",
    priority: "P2",
  },
  {
    ruleId: "quality/ts-ignore",
    severity: "info",
    re: /@ts-ignore|@ts-nocheck|eslint-disable-next-line/,
    message: "Lint/type suppression added — justify in comment or fix underlying issue.",
    tag: "hygiene",
    priority: "P3",
  },
  {
    ruleId: "security/hardcoded-url",
    severity: "info",
    re: /https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)/i,
    message: "Hardcoded local URL in change — use config/env for environments.",
    tag: "security",
    priority: "P2",
  },
];

/**
 * @param {string} filename
 * @param {string} patch
 * @param {(raw: import("./review-engine.js").Finding) => void} note
 */
export function reviewAddedLinesInPatch(filename, patch, note) {
  const seen = new Set();
  for (const rule of ADDED_LINE_RULES) {
    const hit = firstAddedLineMatching(patch, rule.re);
    if (!hit) continue;
    const dedupe = `${rule.ruleId}::${hit.line}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    note({
      ruleId: rule.ruleId,
      severity: rule.severity,
      message: withCodeAnchor(rule.message, hit),
      filename,
      line: hit.line,
      tag: rule.tag,
      priority: rule.priority,
    });
  }
}

/**
 * @param {string} filename
 * @param {string} patch
 * @param {(raw: import("./review-engine.js").Finding) => void} note
 */
export function reviewChangeSummary(filename, patch, note) {
  const added = [];
  for (const row of walkPatchLines(patch)) {
    if (row.kind === "add" && row.text.trim()) added.push({ line: row.line, text: row.text.trim() });
  }
  if (!added.length) return;

  const top = added.slice(0, 3);
  const anchors = top.map((a) => `\`${clipCodeExcerpt(a.text, 72)}\` @${a.line}`).join("; ");
  note({
    ruleId: "review/change-review",
    severity: "info",
    message: `Review added logic in \`${filename}\`: ${anchors}.`,
    filename,
    line: top[0].line,
    tag: "review",
    priority: "P3",
  });
}