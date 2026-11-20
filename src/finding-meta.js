/**
 * Taxonomy for review findings: human-facing tag + priority for UI and GitHub comments.
 *
 * @typedef {'P0'|'P1'|'P2'|'P3'} FindingPriority
 * @typedef {'security'|'boundary'|'architecture'|'quality'|'hygiene'|'review'|'ai'|'github'} FindingTag
 */

/** @type {Record<string, { tag: FindingTag, priority?: FindingPriority }>} */
const RULE_META = {
  "possible-secret": { tag: "security", priority: "P0" },
  "env-file": { tag: "security", priority: "P0" },
  "large-file-delta": { tag: "quality", priority: "P2" },
  "multi-component-file": { tag: "boundary", priority: "P2" },
  "migration-outside-persistence": { tag: "architecture", priority: "P2" },
  "solid/dip-domain-framework": { tag: "architecture", priority: "P2" },
  "solid/srp-fat-controller": { tag: "architecture", priority: "P3" },
  "todo-in-hunk": { tag: "hygiene", priority: "P3" },
  "debug-log": { tag: "hygiene", priority: "P3" },
  "skip-generated": { tag: "review", priority: "P3" },
  "review/spot-check": { tag: "review", priority: "P3" },
  "review/clean-slice": { tag: "review", priority: "P3" },
  "unsafe-eval": { tag: "security", priority: "P1" },
  "unsafe-dom": { tag: "security", priority: "P1" },
  "unsafe-shell": { tag: "security", priority: "P1" },
  "suspicious-auth": { tag: "security", priority: "P1" },
  "ai/unavailable": { tag: "ai", priority: "P2" },
  "github/review-comment": { tag: "github", priority: "P2" },
};

const TAG_LABEL = {
  security: "Security",
  boundary: "Boundary",
  architecture: "Architecture",
  quality: "Quality",
  hygiene: "Hygiene",
  review: "Review",
  ai: "AI",
  github: "GitHub",
};

const PRIORITY_FROM_SEVERITY = /** @type {const} */ ({
  blocker: "P1",
  warning: "P2",
  info: "P3",
});

/**
 * @param {string | undefined} ruleId
 * @param {'blocker'|'warning'|'info'|string} [severity]
 * @returns {{ tag: FindingTag, tagLabel: string, priority: FindingPriority }}
 */
export function getFindingMeta(ruleId, severity = "info") {
  const id = ruleId ?? "finding";
  let tag = /** @type {FindingTag} */ ("quality");
  let priority = /** @type {FindingPriority} */ (PRIORITY_FROM_SEVERITY[severity] ?? "P3");

  const exact = RULE_META[id];
  if (exact) {
    tag = exact.tag;
    if (exact.priority) priority = exact.priority;
  } else if (id.startsWith("ai/")) {
    tag = "ai";
    priority = severity === "blocker" ? "P1" : severity === "warning" ? "P2" : "P3";
  } else if (id.startsWith("github/")) {
    tag = "github";
    priority = "P2";
  } else if (id.includes("secret") || id.includes("security")) {
    tag = "security";
    priority = severity === "blocker" ? "P0" : "P1";
  }

  if (tag === "security" && severity === "blocker" && priority !== "P0" && !exact?.priority) {
    priority = "P0";
  }

  return { tag, tagLabel: TAG_LABEL[tag] ?? tag, priority };
}

/**
 * @template {{ ruleId?: string, severity?: string, tag?: FindingTag, priority?: FindingPriority }} T
 * @param {T} finding
 * @returns {T & { tag: FindingTag, priority: FindingPriority }}
 */
export function enrichFinding(finding) {
  const meta = getFindingMeta(finding.ruleId, finding.severity);
  return {
    ...finding,
    tag: finding.tag ?? meta.tag,
    priority: finding.priority ?? meta.priority,
  };
}

/** @type {Record<FindingTag, string>} */
export const FINDING_TAG_CLASS = {
  security: "cedar-finding-tag-security",
  boundary: "cedar-finding-tag-boundary",
  architecture: "cedar-finding-tag-architecture",
  quality: "cedar-finding-tag-quality",
  hygiene: "cedar-finding-tag-hygiene",
  review: "cedar-finding-tag-review",
  ai: "cedar-finding-tag-ai",
  github: "cedar-finding-tag-github",
};