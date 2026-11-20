/** @typedef {"agent" | "plan" | "ask"} ComposerReviewMode */

/**
 * Mode for Composer slice/macro review. Default `agent` so Composer 2.5 can read the repo.
 * Set `CEDAR_COMPOSER_REVIEW_MODE=plan` for JSON-only (no tools, faster).
 */
export function resolveComposerReviewMode() {
  const raw = String(process.env.CEDAR_COMPOSER_REVIEW_MODE ?? "agent").trim().toLowerCase();
  if (raw === "plan" || raw === "ask" || raw === "agent") return raw;
  return "agent";
}