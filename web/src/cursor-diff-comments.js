import { isCodeReviewFinding } from "../../src/finding-meta.js";
import {
  findingAnchoredOnDiff,
  findingKey,
  findingsForSlice,
  isFindingIgnored,
} from "./finding-actions.js";

/**
 * @typedef {import("./diff-comments.js").ReviewComment} ReviewComment
 */

/**
 * Composer slice findings as inline diff threads (RIGHT / new-file line).
 *
 * @returns {Array<ReviewComment & { source: "cursor", findingKey: string }>}
 */
export function collectCursorDraftCommentsForDiff() {
  const session = /** @type {{ data?: { microResults?: Array<{ componentId: string, componentName?: string, reviewComments?: unknown[] }> }, ignoredFindings?: Set<string>, findingCommentsPosted?: Set<string> } | undefined} */ (
    window.__cedarSession
  );
  if (!session?.data?.microResults?.length) return [];

  /** @type {Array<ReviewComment & { source: "cursor", findingKey: string }>} */
  const out = [];
  let syntheticId = -1;

  for (const r of session.data.microResults) {
    const list = findingsForSlice(r.componentId, r).filter(isCodeReviewFinding);
    list.forEach((f, fi) => {
      const key = findingKey(r.componentId, f, fi);
      if (isFindingIgnored(key)) return;
      if (!findingAnchoredOnDiff(f)) return;
      const path = String(f.filename);
      const line = /** @type {number} */ (f.line);
      const message = String(f.message).trim();

      out.push({
        id: syntheticId,
        path,
        line,
        side: "RIGHT",
        body: message,
        user: "Cursor",
        source: "cursor",
        findingKey: key,
      });
      syntheticId -= 1;
    });
  }

  return out;
}