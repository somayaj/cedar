import { enrichFinding } from "../../src/finding-meta.js";

/**
 * @param {Array<{ id?: number, path?: string, body?: string, line?: number, original_line?: number, user?: { login?: string } }>} comments
 * @param {Array<{ componentId: string, componentName?: string, files?: Array<{ path?: string, filename?: string }> }>} microPrs
 * @returns {Record<string, import("../../src/review-engine.js").Finding[]>}
 */
export function groupGithubCommentFindings(comments, microPrs) {
  /** @type {Map<string, { componentId: string, componentName: string }>} */
  const pathToComponent = new Map();

  for (const micro of microPrs ?? []) {
    for (const file of micro.files ?? []) {
      const path = file.path ?? file.filename;
      if (!path) continue;
      pathToComponent.set(path, {
        componentId: micro.componentId,
        componentName: micro.componentName ?? micro.componentId,
      });
    }
  }

  /** @type {Record<string, import("../../src/review-engine.js").Finding[]>} */
  const bySlice = {};

  for (const comment of comments ?? []) {
    const path = comment.path;
    if (!path) continue;
    const comp = pathToComponent.get(path);
    if (!comp) continue;

    const body = String(comment.body ?? "").trim();
    const excerpt = body.replace(/\s+/g, " ").slice(0, 600);
    const line = comment.line ?? comment.original_line;

    const finding = enrichFinding({
      ruleId: "github/review-comment",
      severity: "info",
      message: excerpt || "Existing review comment on this line.",
      filename: path,
      line: typeof line === "number" ? line : undefined,
      source: "github",
      githubCommentId: comment.id,
    });

    if (!bySlice[comp.componentId]) bySlice[comp.componentId] = [];
    bySlice[comp.componentId].push(finding);
  }

  return bySlice;
}