import { sliceReviewAiAvailable } from "./ai-credentials.js";

/** Whether per-slice Composer review should run (independent of AI breakouts). */
export function sliceReviewRequested(explicit) {
  if (explicit !== undefined) return Boolean(explicit);
  const aiReviewEnv = String(process.env.CEDAR_AI_SLICE_REVIEW ?? "").trim().toLowerCase();
  return (
    aiReviewEnv === "true" ||
    (sliceReviewAiAvailable() && aiReviewEnv !== "false" && aiReviewEnv !== "0")
  );
}