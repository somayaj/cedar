import { isCodeReviewFinding } from "./finding-meta.js";
import { sliceReviewAiAvailable } from "./ai-credentials.js";

/**
 * @param {import('./review-engine.js').MicroReviewResult[]} microResults
 */
export function summarizeCursorSliceReview(microResults) {
  /** @type {Array<{ componentId: string, componentName: string, count: number, status: string, error?: string }>} */
  const bySlice = [];
  let total = 0;
  let slicesWithFindings = 0;
  let slicesAttempted = 0;

  for (const r of microResults) {
    if (r.status === "skipped") continue;
    const cr = r.cursorReview;
    if (!cr) continue;
    slicesAttempted += 1;
    const comments = (r.reviewComments ?? []).filter(isCodeReviewFinding);
    const count = comments.length;
    total += count;
    if (count > 0) slicesWithFindings += 1;
    bySlice.push({
      componentId: r.componentId,
      componentName: r.componentName,
      count,
      status: cr.status ?? (count > 0 ? "ok" : "empty"),
      error: cr.error,
    });
  }

  return { total, slicesWithFindings, slicesAttempted, bySlice };
}

/**
 * @param {import('./review-engine.js').MicroReviewResult[]} microResults
 * @param {{ findings?: unknown[], event?: string, priority?: string, body?: string } | null | undefined} macroReview
 * @param {boolean} useAiReview
 */
export function buildCursorReviewSummary(microResults, macroReview, useAiReview) {
  const enabled = Boolean(useAiReview && sliceReviewAiAvailable());
  const slice = summarizeCursorSliceReview(microResults);
  const macroFindingCount = Array.isArray(macroReview?.findings) ? macroReview.findings.length : 0;

  return {
    enabled,
    slice,
    macro: macroReview
      ? {
          findingCount: macroFindingCount,
          event: macroReview.event ?? "COMMENT",
          priority: macroReview.priority,
          hasBody: Boolean(macroReview.body?.trim()),
        }
      : null,
    totalFindings: slice.total + macroFindingCount,
  };
}