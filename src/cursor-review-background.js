import { aiReviewMicroSlice } from "./ai-micro-review.js";
import { aiMacroPrReview } from "./ai-macro-review.js";
import { buildCursorReviewSummary } from "./cursor-review-summary.js";
import { isCodeReviewFinding } from "./finding-meta.js";
import { sliceReviewAiAvailable } from "./ai-credentials.js";
import { sliceReviewRequested } from "./slice-review-toggle.js";
import { emitPhase, emitReviewProgress } from "./review-progress.js";

/**
 * @param {unknown} err
 */
function isAiAuthError(err) {
  const msg = err instanceof Error ? err.message : String(err);
  return /401|403|User not found|invalid.*api.*key|unauthorized|authentication/i.test(msg);
}

/**
 * @param {string | undefined} raw
 */
/**
 * @param {Array<{ files?: Array<{ path?: string, filename?: string, status?: string, patch?: string | null, additions?: number, deletions?: number }> } & Record<string, unknown>>} microPrs
 */
export function hydrateMicroPrsFromReport(microPrs) {
  return microPrs.map((m) => ({
    ...m,
    files: (m.files ?? []).map((f) => ({
      filename: f.filename ?? f.path ?? "",
      status: f.status,
      patch: f.patch ?? "",
      additions: f.additions ?? 0,
      deletions: f.deletions ?? 0,
    })),
  }));
}

export function backgroundCursorReviewEnabled(explicit) {
  if (explicit === true) return true;
  if (explicit === false) return false;
  const v = String(process.env.CEDAR_CURSOR_REVIEW_BACKGROUND ?? "").trim().toLowerCase();
  if (v === "false" || v === "0") return false;
  return true;
}

/**
 * @param {{
 *   microPrs: import("./partition.js").MicroPr[],
 *   microResults: import("./review-engine.js").MicroReviewResult[],
 *   architectureSummary?: string,
 *   pull: { title: string, number: number, headSha: string },
 *   breakouts?: unknown,
 *   useAiReview?: boolean,
 *   emit?: (event: Record<string, unknown>) => void,
 * }} opts
 */
export async function runBackgroundCursorReview(opts) {
  const emit = opts.emit ?? (() => {});
  const useAiReview = opts.useAiReview ?? sliceReviewRequested();
  if (!useAiReview || !sliceReviewAiAvailable()) {
    return {
      microResults: opts.microResults,
      macroReview: null,
      cursorReviewSummary: buildCursorReviewSummary(opts.microResults, null, false),
    };
  }

  /** @type {import("./review-engine.js").MicroReviewResult[]} */
  const microResults = opts.microResults.map((r) => ({ ...r }));
  const byId = new Map(microResults.map((r) => [r.componentId, r]));
  const ordered = opts.microPrs.filter((m) => (m.files?.length ?? 0) > 0);
  let aiSliceReviewStopped = false;

  emit({ type: "activity", text: "Cursor slice review (background)…", phase: "cursor-slices" });
  emitPhase("cursor-slices", "Cursor · slice review", "running", `${ordered.length} slice(s) · background`);

  let slicePassIndex = 0;
  for (const micro of opts.microPrs) {
    const result = byId.get(micro.componentId);
    if (!result || result.status === "skipped" || !micro.files.length) continue;
    if (aiSliceReviewStopped) {
      result.cursorReview = {
        source: "cursor",
        count: 0,
        status: "stopped",
        error: "Composer slice review stopped after an earlier auth/API error",
      };
      continue;
    }

    slicePassIndex += 1;
    const sliceLabel = `${micro.componentName} (${slicePassIndex}/${ordered.length})`;
    emitReviewProgress({
      type: "activity",
      text: `Cursor · ${sliceLabel}`,
      phase: "cursor-slices",
    });
    emit({
      type: "cursor_progress",
      completed: slicePassIndex - 1,
      total: ordered.length,
      phase: "slice",
      detail: `Slice ${slicePassIndex} of ${ordered.length} · ${micro.componentName}…`,
    });
    emitPhase("cursor-slices", "Cursor · slice review", "running", sliceLabel);

    try {
      const aiFindings = await aiReviewMicroSlice(micro, {
        architectureSummary: opts.architectureSummary,
      });
      const valid = aiFindings.filter(isCodeReviewFinding);
      result.reviewComments = aiFindings;
      result.cursorReview = {
        source: "cursor",
        count: valid.length,
        status: valid.length ? "ok" : "empty",
      };
      emitPhase("cursor-slices", "Cursor · slice review", "running", `${sliceLabel} · ${valid.length} finding(s)`);
      emit({
        type: "cursor_progress",
        completed: slicePassIndex,
        total: ordered.length,
        phase: "slice",
        detail: `${slicePassIndex} of ${ordered.length} slices · ${valid.length} finding(s)`,
      });
      emit({
        type: "cursor_slice",
        componentId: micro.componentId,
        microResult: result,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (isAiAuthError(err)) aiSliceReviewStopped = true;
      result.cursorReview = {
        source: "cursor",
        count: 0,
        status: aiSliceReviewStopped ? "stopped" : "error",
        error: message.slice(0, 240),
      };
      emit({
        type: "cursor_progress",
        completed: slicePassIndex,
        total: ordered.length,
        phase: "slice",
        detail: `${slicePassIndex} of ${ordered.length} slices`,
      });
      emit({
        type: "cursor_slice",
        componentId: micro.componentId,
        microResult: result,
      });
    }
  }

  const stats = buildCursorReviewSummary(microResults, null, useAiReview).slice;
  emitPhase(
    "cursor-slices",
    "Cursor · slice review",
    aiSliceReviewStopped ? "blocked" : "done",
    `${stats.total} finding(s) · background`
  );

  emit({ type: "cursor_progress", completed: ordered.length, total: ordered.length, phase: "macro" });
  emitPhase("macro", "Cursor · macro review (entire PR)", "running");
  /** @type {import("./ai-macro-review.js").ReturnType<typeof aiMacroPrReview> extends Promise<infer T> ? T : null} */
  let macroReview = null;
  try {
    macroReview = await aiMacroPrReview({
      pull: opts.pull,
      breakouts: opts.breakouts,
      microPrs: opts.microPrs,
      microResults,
    });
    const macroThemes = macroReview?.findings?.length ?? 0;
    emitPhase(
      "macro",
      "Cursor · macro review (entire PR)",
      "done",
      `${macroThemes} PR theme(s) · background`
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emitPhase("macro", "Cursor · macro review (entire PR)", "blocked", message.slice(0, 80));
  }

  const cursorReviewSummary = buildCursorReviewSummary(microResults, macroReview, useAiReview);
  emit({
    type: "cursor_done",
    microResults,
    macroReview,
    cursorReviewSummary,
  });

  return { microResults, macroReview, cursorReviewSummary };
}