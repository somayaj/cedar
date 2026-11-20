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
  const fromGithub = f.source === "github";
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
      ${fromGithub ? '<span class="cedar-badge cedar-badge-muted text-[9px]">On PR</span>' : '<span class="cedar-badge cedar-badge-muted text-[9px]">Draft</span>'}
      ${renderCommentMeta(f)}
      ${lineChip}
      ${jumpBtn}
      ${ignored ? '<span class="cedar-badge cedar-badge-muted">Dismissed</span>' : ""}
      ${onGithub && !fromGithub ? '<span class="cedar-badge cedar-badge-ok">Posted</span>' : ""}
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
 * @param {{ componentId: string, componentName: string, findings?: Array<unknown> }} sliceResult
 * @param {{ githubFindingsBySlice?: Record<string, unknown[]>, findingCommentsPosted?: Set<string> } | undefined} session
 */
export function buildFindingsListHtml(sliceResult, session) {
  const r = sliceResult;
  const sliceFindings = findingsForSlice(r.componentId, r, session);
  const posted = session?.findingCommentsPosted ?? new Set();
  const activeFindings = sliceFindings.filter((f, fi) => !isFindingIgnored(findingKey(r.componentId, f, fi)));

  if (sliceFindings.length === 0) {
    return {
      html: `<p class="text-xs leading-relaxed text-zinc-500">
        No <strong class="font-medium text-zinc-400">micro</strong> review comments for this slice yet. Re-run <strong class="font-medium text-zinc-400">Start review</strong> with Composer (<span class="font-mono text-zinc-600">CURSOR_API_KEY</span>). Comments attach to changed files below — post with <strong class="font-medium text-zinc-400">Post comment</strong>.
      </p>`,
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

  const html = `<p class="mb-2 text-[10px] leading-snug text-zinc-600"><strong class="font-medium text-zinc-400">Micro review</strong> — inline comments on files in this slice (macro review covers the whole PR above).</p>
    <ul class="cedar-findings-list cedar-findings-by-file space-y-4">${fileSections}</ul>`;

  return { html, activeCount: activeFindings.length };
}