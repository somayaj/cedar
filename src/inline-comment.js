import {
  createClient,
  fetchPullRequest,
  createPullRequestReviewComment,
  fetchPullRequestReviewComments,
} from "./github.js";
import { resolvePrTarget } from "./parse-pr-url.js";

/**
 * @param {{
 *   prUrl?: string,
 *   owner?: string,
 *   repo?: string,
 *   pr?: number,
 *   token: string,
 *   path: string,
 *   line: number,
 *   side?: "LEFT" | "RIGHT",
 *   body: string,
 *   headSha?: string,
 *   componentId?: string,
 *   componentName?: string,
 * }} opts
 */
export async function submitInlineDiffComment(opts) {
  const target = opts.prUrl
    ? resolvePrTarget({ prUrl: opts.prUrl })
    : resolvePrTarget({ owner: opts.owner, repo: opts.repo, pr: opts.pr });

  const octokit = createClient(opts.token);
  const pull = await fetchPullRequest(octokit, {
    owner: target.owner,
    repo: target.repo,
    pull_number: target.pr,
  });

  const commitId = opts.headSha || pull.head.sha;
  const commentBody = opts.body.trim();
  if (!commentBody) {
    throw new Error("Comment cannot be empty");
  }

  const prefix =
    opts.componentId || opts.componentName
      ? `**Cedar · ${opts.componentName ?? opts.componentId}**\n\n`
      : "**Cedar review comment**\n\n";

  const comment = await createPullRequestReviewComment(octokit, {
    owner: target.owner,
    repo: target.repo,
    pull_number: target.pr,
    commit_id: commitId,
    path: opts.path,
    line: opts.line,
    side: opts.side ?? "RIGHT",
    body: `${prefix}${commentBody}`,
  });

  return {
    target,
    comment: {
      id: comment.id,
      html_url: comment.html_url,
      path: comment.path,
      line: comment.line,
      side: comment.side,
      body: comment.body,
      user: comment.user?.login ?? null,
      created_at: comment.created_at,
    },
    headSha: commitId,
  };
}

/**
 * @param {{
 *   prUrl?: string,
 *   owner?: string,
 *   repo?: string,
 *   pr?: number,
 *   token: string,
 * }} opts
 */
export async function listInlineDiffComments(opts) {
  const target = opts.prUrl
    ? resolvePrTarget({ prUrl: opts.prUrl })
    : resolvePrTarget({ owner: opts.owner, repo: opts.repo, pr: opts.pr });

  const octokit = createClient(opts.token);
  const raw = await fetchPullRequestReviewComments(octokit, {
    owner: target.owner,
    repo: target.repo,
    pull_number: target.pr,
  });

  return {
    target,
    comments: raw.map((c) => ({
      id: c.id,
      html_url: c.html_url,
      path: c.path,
      line: c.line ?? c.original_line,
      side: c.side ?? "RIGHT",
      body: c.body ?? "",
      user: c.user?.login ?? null,
      created_at: c.created_at,
      commit_id: c.commit_id,
    })),
  };
}