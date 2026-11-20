import { Octokit } from "@octokit/rest";

/**
 * @param {string} token
 * @returns {Octokit}
 */
export function createClient(token) {
  if (!token) {
    throw new Error("GITHUB_TOKEN is required");
  }
  return new Octokit({ auth: token });
}

/**
 * @param {unknown} err
 */
export function formatGithubApiError(err) {
  const data = /** @type {{ message?: string, errors?: { message?: string, code?: string, field?: string }[] } | undefined} */ (
    /** @type {{ response?: { data?: unknown } }} */ (err)?.response?.data
  );
  if (!data) return err instanceof Error ? err.message : String(err);
  const parts = [data.message].filter(Boolean);
  if (Array.isArray(data.errors)) {
    for (const e of data.errors) {
      const bit = e.message ?? [e.field, e.code].filter(Boolean).join(": ");
      if (bit) parts.push(bit);
    }
  }
  return parts.join(" — ") || "GitHub API error";
}

/**
 * @param {Octokit} octokit
 * @param {{ owner: string, repo: string, pull_number: number }} pr
 */
export async function fetchPullRequest(octokit, pr) {
  const { data } = await octokit.pulls.get({
    owner: pr.owner,
    repo: pr.repo,
    pull_number: pr.pull_number,
  });
  return data;
}

/**
 * @param {Octokit} octokit
 * @param {{ owner: string, repo: string, pull_number: number }} pr
 * @returns {Promise<import('./partition.js').PrFile[]>}
 */
export async function fetchPullRequestFiles(octokit, pr) {
  /** @type {import('./partition.js').PrFile[]} */
  const all = [];
  let page = 1;
  for (;;) {
    const { data } = await octokit.pulls.listFiles({
      owner: pr.owner,
      repo: pr.repo,
      pull_number: pr.pull_number,
      per_page: 100,
      page,
    });
    if (!data.length) break;
    for (const f of data) {
      all.push({
        filename: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
        changes: f.changes,
        patch: f.patch,
        previous_filename: f.previous_filename,
      });
    }
    if (data.length < 100) break;
    page += 1;
  }
  return all;
}

/**
 * @param {Octokit} octokit
 * @param {{ owner: string, repo: string, pull_number: number }} pr
 * @param {string} login
 */
/**
 * @param {Octokit} octokit
 * @param {{
 *   owner: string,
 *   repo: string,
 *   pull_number: number,
 *   commit_id: string,
 *   path: string,
 *   line: number,
 *   side?: "LEFT" | "RIGHT",
 *   body: string,
 * }} opts
 */
export async function createPullRequestReviewComment(octokit, opts) {
  const { data } = await octokit.pulls.createReviewComment({
    owner: opts.owner,
    repo: opts.repo,
    pull_number: opts.pull_number,
    body: opts.body,
    commit_id: opts.commit_id,
    path: opts.path,
    line: opts.line,
    side: opts.side ?? "RIGHT",
  });
  return data;
}

/**
 * @param {Octokit} octokit
 * @param {{ owner: string, repo: string, pull_number: number }} pr
 */
export async function fetchPullRequestReviewComments(octokit, pr) {
  /** @type {import("@octokit/rest").RestEndpointMethodTypes["pulls"]["listReviewComments"]["response"]["data"]} */
  const all = [];
  let page = 1;
  for (;;) {
    const { data } = await octokit.pulls.listReviewComments({
      owner: pr.owner,
      repo: pr.repo,
      pull_number: pr.pull_number,
      per_page: 100,
      page,
    });
    if (!data.length) break;
    all.push(...data);
    if (data.length < 100) break;
    page += 1;
  }
  return all;
}

async function listPullReviews(octokit, pr, login) {
  const { data } = await octokit.pulls.listReviews({
    owner: pr.owner,
    repo: pr.repo,
    pull_number: pr.pull_number,
    per_page: 100,
  });
  return data.filter((r) => r.user?.login === login);
}

/**
 * @param {Octokit} octokit
 * @param {{
 *   owner: string,
 *   repo: string,
 *   pull_number: number,
 *   commit_id: string,
 *   event: 'COMMENT'|'APPROVE'|'REQUEST_CHANGES',
 *   body: string,
 *   comments?: object[],
 * }} opts
 */
export async function submitPullRequestReview(octokit, opts) {
  const pr = {
    owner: opts.owner,
    repo: opts.repo,
    pull_number: opts.pull_number,
  };

  const { data: me } = await octokit.users.getAuthenticated();
  const pull = await fetchPullRequest(octokit, pr);

  let commitId = pull.head.sha;
  let event = opts.event;
  let body = (opts.body ?? "").trim() || " ";
  let authorCommentFallback = false;

  if (event === "APPROVE" && pull.user?.login === me.login) {
    event = "COMMENT";
    authorCommentFallback = true;
    body = [
      opts.body?.trim() || "Cedar sign-off on this pull request.",
      "",
      "---",
      "_GitHub does not allow the PR author to submit an **Approve** review on their own pull request. Cedar posted this as a review comment instead._",
    ].join("\n");
  }

  const myReviews = await listPullReviews(octokit, pr, me.login);
  if (event === "APPROVE") {
    const approved = myReviews.find((r) => r.state === "APPROVED");
    if (approved) return { review: approved, meta: { idempotent: true } };
  }

  /**
   * @param {string} sha
   */
  async function createReview(sha) {
    /** @type {Parameters<Octokit["pulls"]["createReview"]>[0]} */
    const payload = {
      owner: opts.owner,
      repo: opts.repo,
      pull_number: opts.pull_number,
      commit_id: sha,
      event,
      body,
    };
    if (opts.comments?.length) payload.comments = opts.comments;
    const { data } = await octokit.pulls.createReview(payload);
    return data;
  }

  try {
    const review = await createReview(commitId);
    return {
      review,
      meta: authorCommentFallback ? { authorCommentFallback: true } : {},
    };
  } catch (err) {
    const status = /** @type {{ status?: number }} */ (err)?.status;
    if (status !== 422) throw err;

    const pending = myReviews.find((r) => r.state === "PENDING");
    if (pending) {
      try {
        const { data } = await octokit.pulls.submitReview({
          owner: opts.owner,
          repo: opts.repo,
          pull_number: opts.pull_number,
          review_id: pending.id,
          event,
          body,
        });
        return {
          review: data,
          meta: authorCommentFallback ? { authorCommentFallback: true } : {},
        };
      } catch (submitErr) {
        const submitStatus = /** @type {{ status?: number }} */ (submitErr)?.status;
        if (submitStatus === 422) {
          try {
            await octokit.pulls.deleteReview({
              owner: opts.owner,
              repo: opts.repo,
              pull_number: opts.pull_number,
              review_id: pending.id,
            });
          } catch {
            /* ignore */
          }
          const review = await createReview(commitId);
          return {
            review,
            meta: authorCommentFallback ? { authorCommentFallback: true } : {},
          };
        }
        throw submitErr;
      }
    }

    const fresh = await fetchPullRequest(octokit, pr);
    if (fresh.head.sha !== commitId) {
      commitId = fresh.head.sha;
      const review = await createReview(commitId);
      return {
        review,
        meta: authorCommentFallback ? { authorCommentFallback: true } : {},
      };
    }

    // Some orgs disallow APPROVE via PAT — fall back to comment once.
    if (opts.event === "APPROVE" && event === "APPROVE") {
      event = "COMMENT";
      body = [
        opts.body?.trim() || "Cedar sign-off on this pull request.",
        "",
        "---",
        "_GitHub rejected an **Approve** review on this repo (permissions or branch rules). Posted as a review comment instead._",
      ].join("\n");
      const review = await createReview(commitId);
      return { review, meta: { approveFallbackComment: true } };
    }

    const message = formatGithubApiError(err);
    const wrapped = new Error(message);
    /** @type {{ status?: number, response?: unknown }} */ (wrapped).status = 422;
    /** @type {{ status?: number, response?: unknown }} */ (wrapped).response = /** @type {unknown} */ (err).response;
    throw wrapped;
  }
}