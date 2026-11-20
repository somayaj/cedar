import { FINDING_TAG_CLASS, getFindingMeta } from "../../src/finding-meta.js";
import {
  findingKey,
  findingsForSlice,
  isFindingIgnored,
} from "./finding-actions.js";

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * @param {{ tag?: string, priority?: string, ruleId?: string, severity?: string }} f
 */
function renderCommentMeta(f) {
  const meta = getFindingMeta(f.ruleId, f.severity);
  const tag = f.tag ?? meta.tag;
  const tagLabel = meta.tagLabel;
  const priority = f.priority ?? meta.priority;
  const tagClass = FINDING_TAG_CLASS[tag] ?? "cedar-finding-tag-quality";
  return `<span class="cedar-finding-priority" title="Priority">${priority}</span>
    <span class="cedar-finding-tag ${tagClass}" title="Category">${escapeHtml(tagLabel)}</span>`;
}

/**
 * @param {*} f
 * @param {*} r
 * @param {number} fi
 * @param {Set<string>} posted
 */
function renderCommentCard(f, r, fi, posted) {
  const key = findingKey(r.componentId, f, fi);
  const ignored = isFindingIgnored(key);
  const onGithub = posted.has(key) || f.source === "github";
  const lineChip =
    typeof f.line === "number" && f.line > 0
      ? `<span class="cedar-badge cedar-badge-muted font-mono text-[9px]">L${f.line}</span>`
      : "";
  const jumpBtn = f.filename
    ? `<button type="button" class="cedar-btn-secondary cedar-btn-compact cedar-review-comment-jump" data-finding-jump data-filename="${escapeHtml(f.filename)}" data-finding-line="${typeof f.line === "number" ? f.line : ""}">Open in diff</button>`
    : "";
  const meta = getFindingMeta(f.ruleId, f.severity);
  const tag = f.tag ?? meta.tag;
  const priority = f.priority ?? meta.priority;

  return `<li class="cedar-review-comment-card cedar-glass-subtle px-3 py-2.5${ignored ? " is-ignored" : ""}" data-finding-key="${escapeHtml(key)}">
    <p class="cedar-review-comment-body text-sm leading-relaxed text-zinc-200">${escapeHtml(f.message)}</p>
    <div class="cedar-review-comment-meta mt-2 flex flex-wrap items-center gap-1.5">
      <span class="cedar-badge cedar-badge-ok text-[9px]">Cursor</span>
      ${renderCommentMeta(f)}
      ${lineChip}
      ${jumpBtn}
      ${ignored ? '<span class="cedar-badge cedar-badge-muted">Dismissed</span>' : ""}
      ${onGithub && f.source !== "github" ? '<span class="cedar-badge cedar-badge-ok">Posted</span>' : ""}
    </div>
    <div class="cedar-finding-actions mt-2 flex flex-wrap gap-1.5">
      ${
        ignored
          ? `<button type="button" class="cedar-btn-secondary cedar-btn-compact" data-finding-unignore data-finding-key="${escapeHtml(key)}">Restore</button>`
          : `<button type="button" class="cedar-btn-secondary cedar-btn-compact" data-finding-ignore data-finding-key="${escapeHtml(key)}">Dismiss</button>`
      }
      <button type="button" class="cedar-btn-secondary cedar-btn-compact" data-finding-comment
        data-finding-key="${escapeHtml(key)}"
        data-filename="${escapeHtml(f.filename ?? "")}"
        data-finding-severity="${escapeHtml(f.severity ?? "info")}"
        data-finding-rule="${escapeHtml(f.ruleId ?? "review")}"
        data-finding-message="${escapeHtml(f.message)}"
        data-finding-tag="${escapeHtml(tag)}"
        data-finding-priority="${escapeHtml(priority)}"
        data-finding-line="${typeof f.line === "number" && f.line > 0 ? f.line : ""}"
        data-component-id="${escapeHtml(r.componentId)}"
        data-component-name="${escapeHtml(r.componentName)}"
        ${!f.filename || onGithub ? "disabled" : ""}
        title="${!f.filename ? "No file line" : onGithub ? "Already on GitHub" : "Post inline on GitHub"}">${onGithub ? "On GitHub" : "Post comment"}</button>
    </div>
  </li>`;
}

/**
 * @param {{ componentId: string, componentName: string, status?: string, filesReviewed?: number, reviewComments?: unknown[], cursorReview?: { status?: string, count?: number, error?: string } }} sliceResult
 * @param {{ data?: { cursorReviewSummary?: { enabled?: boolean } }, findingCommentsPosted?: Set<string> } | undefined} session
 */
function sliceCursorEmptyMessage(r, session) {
  const health =
    session?.serverHealth ??
    (typeof window !== "undefined" ? window.__cedarServerHealth : null);
  const data = session?.data;
  const summary = data?.cursorReviewSummary;
  const slicePassRan = Boolean(summary?.slicePassRan || (summary?.slice?.slicesAttempted ?? 0) > 0);
  const hasCursorKey = Boolean(
    slicePassRan ||
      summary?.available ||
      summary?.enabled ||
      data?.macroReview ||
      data?.partition?.mode === "ai" ||
      health?.hasCursor ||
      health?.sliceReviewAvailable
  );
  const cr = r.cursorReview;
  const rawComments = Array.isArray(r.reviewComments) ? r.reviewComments.length : 0;

  if (r.status === "skipped" || (r.filesReviewed ?? 0) === 0) {
    return "No changed files in this slice — Cursor line comments are not generated here.";
  }

  if (cr?.status === "pending") {
    return `Cursor is reviewing this slice in the <strong class="font-medium text-zinc-400">background</strong> — watch the progress bar above. Findings will appear here and on the diff when ready.`;
  }

  if (cr?.status === "skipped") {
    const hint = cr.error ? ` ${escapeHtml(cr.error)}` : "";
    return `Per-slice Composer review is <strong class="font-medium text-zinc-400">off</strong> for this run.${hint} Architectural breakouts can still use Cursor. Remove <span class="font-mono text-zinc-600">CEDAR_AI_SLICE_REVIEW=false</span> from <span class="font-mono text-zinc-600">.env</span>, restart <span class="font-mono text-zinc-600">npm run dev:api</span>, then <strong class="font-medium text-zinc-400">Start review</strong>.`;
  }

  if (cr?.status === "error" || cr?.status === "stopped") {
    const err = cr.error ? ` <span class="text-rose-400/90">${escapeHtml(cr.error)}</span>` : "";
    return `Cursor ran on this slice but the Composer call did not finish.${err} Check the review progress log (bridge/API) and run <strong class="font-medium text-zinc-400">Start review</strong> again.`;
  }

  if (cr && (cr.status === "empty" || cr.count === 0) && rawComments === 0) {
    return `Cursor reviewed this slice and returned <strong class="font-medium text-zinc-400">no line comments</strong> (nothing to flag on changed <code class="font-mono text-[10px] text-zinc-500">+</code> lines). Heuristic signals may still show elsewhere on the slice.`;
  }

  if (rawComments > 0) {
    return `Composer returned ${rawComments} comment(s) but none could be anchored to this diff (filename/line mismatch). Re-run <strong class="font-medium text-zinc-400">Start review</strong> or check server logs.`;
  }

  if (hasCursorKey && summary && summary.requested === false) {
    return `Your Cursor key is loaded on the API, but <strong class="font-medium text-zinc-400">per-slice</strong> review is disabled (<span class="font-mono text-zinc-600">CEDAR_AI_SLICE_REVIEW=false</span>). Slices/breakouts still use Cursor. Unset that flag, restart the API, and run <strong class="font-medium text-zinc-400">Start review</strong>.`;
  }

  if (hasCursorKey) {
    if (!cr) {
      return `Cursor is configured on the API (breakouts/macros may still run), but this slice has no Composer pass from the last review. Run <strong class="font-medium text-zinc-400">Start review</strong> again and watch <strong class="font-medium text-zinc-400">Cursor · slice review</strong> in the progress log.`;
    }
    return `No Cursor draft comments for this slice. GitHub inline comments, if any, stay on the diff only.`;
  }

  return `Cursor slice review did not run on this pass. In <strong class="font-medium text-zinc-400">Room configuration</strong>, paste your key and click <strong class="font-medium text-zinc-400">Save to .env</strong>, confirm the status shows <span class="font-mono text-zinc-500">In .env / API · set</span>, then <strong class="font-medium text-zinc-400">Start review</strong> and watch <strong class="font-medium text-zinc-400">Cursor · slice review</strong> in the log.`;
}

/**
 * @param {{ componentId: string, componentName: string, findings?: Array<unknown> }} sliceResult
 * @param {{ githubFindingsBySlice?: Record<string, unknown[]>, findingCommentsPosted?: Set<string> } | undefined} session
 */
export function buildFindingsListHtml(sliceResult, session) {
  const r = sliceResult;
  const sliceFindings = findingsForSlice(r.componentId, r);
  const posted = session?.findingCommentsPosted ?? new Set();
  const activeFindings = sliceFindings.filter((f, fi) => !isFindingIgnored(findingKey(r.componentId, f, fi)));

  if (sliceFindings.length === 0) {
    return {
      html: `<p class="text-xs leading-relaxed text-zinc-500">${sliceCursorEmptyMessage(r, session)}</p>`,
      activeCount: 0,
    };
  }

  /** @type {Map<string, Array<{ f: unknown, fi: number }>>} */
  const byFile = new Map();
  sliceFindings.forEach((f, fi) => {
    const path = f.filename ?? "_slice";
    if (!byFile.has(path)) byFile.set(path, []);
    byFile.get(path).push({ f, fi });
  });

  const fileSections = [...byFile.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, items]) => {
      const cards = items.map(({ f, fi }) => renderCommentCard(f, r, fi, posted)).join("");
      const title =
        path === "_slice"
          ? `<p class="cedar-file-review-group-label text-[10px] font-medium text-zinc-500">General</p>`
          : `<p class="cedar-file-review-group-label font-mono text-[10px] text-zinc-400">${escapeHtml(path)}</p>`;
      return `<li class="cedar-file-review-group">
        ${title}
        <ul class="mt-1.5 space-y-2">${cards}</ul>
      </li>`;
    })
    .join("");

  const html = `<ul class="cedar-findings-list cedar-findings-by-file space-y-4">${fileSections}</ul>`;

  return { html, activeCount: activeFindings.length };
}