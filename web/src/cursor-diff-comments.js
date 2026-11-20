import { isCodeReviewFinding } from "../../src/finding-meta.js";
import {
  findingAnchoredOnDiff,
  findingKey,
  findingsForSlice,
  firstAddedLineInPatch,
  isFindingIgnored,
} from "./finding-actions.js";

/**
 * @typedef {import("./diff-comments.js").ReviewComment} ReviewComment
 */

/**
 * First changed file line in the PR — anchor for PR-wide macro themes on the diff.
 *
 * @param {{ data?: { microPrs?: Array<{ componentId: string, files?: Array<{ path?: string, filename?: string, patch?: string }> }>, microResults?: Array<{ componentId: string, status?: string }> }, filePatches?: Map<string, string> }} session
 */
function resolvePrWideDiffAnchor(session) {
  const microPrs = session.data?.microPrs ?? [];
  const microResults = session.data?.microResults ?? [];
  for (const r of microResults) {
    if (r.status === "skipped") continue;
    const micro = microPrs.find((m) => m.componentId === r.componentId);
    const files = micro?.files ?? [];
    for (const f of files) {
      const path = f.path ?? f.filename;
      if (!path) continue;
      const patch = f.patch ?? session.filePatches?.get(`${r.componentId}::${path}`) ?? "";
      const line = firstAddedLineInPatch(patch);
      return { path: String(path), line, side: /** @type {const} */ ("RIGHT") };
    }
  }
  return null;
}

/**
 * @returns {Array<ReviewComment & { source: "cursor-macro", findingKey: string }>}
 */
export function collectMacroDraftCommentsForDiff() {
  const session = /** @type {{ data?: { macroReview?: { findings?: Array<{ message?: string, ruleId?: string, priority?: string }> } }, filePatches?: Map<string, string> } | undefined} */ (
    window.__cedarSession
  );
  const findings = session?.data?.macroReview?.findings;
  if (!session?.data || !Array.isArray(findings) || findings.length === 0) return [];

  const anchor = resolvePrWideDiffAnchor(session);
  if (!anchor) return [];

  /** @type {Array<ReviewComment & { source: "cursor-macro", findingKey: string }>} */
  const out = [];
  let syntheticId = -10_000;

  findings.forEach((f, i) => {
    const message = String(f.message ?? "").trim();
    if (!message) return;
    const priority = f.priority ? String(f.priority).trim() : "";
    const body = priority ? `${priority} · ${message}` : message;
    out.push({
      id: syntheticId,
      path: anchor.path,
      line: anchor.line,
      side: anchor.side,
      body,
      user: "Cursor",
      source: "cursor-macro",
      findingKey: `macro::${f.ruleId ?? "theme"}::${i}`,
    });
    syntheticId -= 1;
  });

  return out;
}

/**
 * Composer slice findings as inline diff threads (RIGHT / new-file line).
 *
 * @returns {Array<ReviewComment & { source: "cursor" | "cursor-macro", findingKey: string }>}
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

  return [...out, ...collectMacroDraftCommentsForDiff()];
}