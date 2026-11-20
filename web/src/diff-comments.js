import { collectCursorDraftCommentsForDiff } from "./cursor-diff-comments.js";

export { collectCursorDraftCommentsForDiff };

/** @typedef {{ id: number, path: string, line: number, side: string, body: string, html_url?: string, user?: string | null, created_at?: string, source?: "github" | "cursor", findingKey?: string }} ReviewComment */

/** @typedef {{ prUrl: string, token?: string, reviewComments?: ReviewComment[], data: { target?: { owner?: string, repo?: string, pr?: number }, pull?: { headSha?: string } } }} CedarSession */

/** @type {HTMLElement | null} */
let popover = null;

function ensurePopover() {
  if (popover) return popover;
  popover = document.createElement("div");
  popover.className = "cedar-diff-comment-popover";
  popover.hidden = true;
  popover.innerHTML = `
    <form class="cedar-diff-comment-form">
      <p class="cedar-diff-comment-form-title">Comment on GitHub</p>
      <p class="cedar-diff-comment-form-meta"></p>
      <textarea class="cedar-diff-comment-input" rows="3" placeholder="Leave a review comment…" required></textarea>
      <div class="cedar-diff-comment-actions">
        <button type="button" class="cedar-diff-comment-cancel cedar-btn-secondary cedar-btn-compact">Cancel</button>
        <button type="submit" class="cedar-diff-comment-submit cedar-btn-primary cedar-btn-compact">Post to GitHub</button>
      </div>
    </form>`;
  document.body.appendChild(popover);
  return popover;
}

/**
 * @param {Element | null | undefined} el
 */
function lineNumFromEl(el) {
  const raw = el?.textContent?.trim() ?? "";
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {HTMLElement} row
 */
function resolveLineFromRow(row) {
  const oldDiv = row.querySelector(".line-num1");
  const newDiv = row.querySelector(".line-num2");
  if (oldDiv || newDiv) {
    const oldNum = lineNumFromEl(oldDiv);
    const newNum = lineNumFromEl(newDiv);
    const isDel = Boolean(row.querySelector("td.d2h-del, .d2h-del"));
    if (isDel && oldNum != null) return { line: oldNum, side: "LEFT" };
    if (newNum != null) return { line: newNum, side: "RIGHT" };
    if (oldNum != null) return { line: oldNum, side: "LEFT" };
    return null;
  }

  const sideCell = row.querySelector("td.d2h-code-side-linenumber");
  if (sideCell) {
    const n = lineNumFromEl(sideCell);
    if (n == null) return null;
    const onLeft = Boolean(row.closest(".d2h-file-side-diff-left"));
    const isDel = Boolean(row.querySelector(".d2h-del"));
    return { line: n, side: onLeft || isDel ? "LEFT" : "RIGHT" };
  }

  const nums = [...row.querySelectorAll(".d2h-code-linenumber")].flatMap((td) => {
    const a = lineNumFromEl(td.querySelector(".line-num1"));
    const b = lineNumFromEl(td.querySelector(".line-num2"));
    if (a != null || b != null) return [a, b].filter((x) => x != null);
    const direct = lineNumFromEl(td);
    return direct != null ? [direct] : [];
  });
  if (!nums.length) return null;
  const isDel = Boolean(row.querySelector("td.d2h-del"));
  if (isDel) return { line: nums[0], side: "LEFT" };
  return { line: nums[nums.length - 1], side: "RIGHT" };
}

/** @type {{ path: string, line: number, side: string, row: HTMLElement } | null} */
let activeTarget = null;

function closePopover() {
  const el = ensurePopover();
  el.hidden = true;
  activeTarget = null;
}

/**
 * @param {HTMLElement} row
 * @param {string} path
 */
function openCommentPopoverForRow(row, path) {
  const resolved = resolveLineFromRow(row);
  if (!resolved) {
    showCommentToast("No line number on this row — pick a line with a number in the gutter.", "error");
    return;
  }

  const el = ensurePopover();
  const meta = el.querySelector(".cedar-diff-comment-form-meta");
  const input = el.querySelector(".cedar-diff-comment-input");
  const submit = el.querySelector(".cedar-diff-comment-submit");
  if (!(meta instanceof HTMLElement) || !(input instanceof HTMLTextAreaElement)) return;
  if (submit instanceof HTMLButtonElement) {
    submit.disabled = false;
    submit.textContent = "Post to GitHub";
  }

  activeTarget = { path, line: resolved.line, side: resolved.side, row };
  meta.textContent = `${path}:${resolved.line} (${resolved.side === "LEFT" ? "deleted" : "added"})`;

  const anchor = row.querySelector(".d2h-code-linenumber, .d2h-code-side-linenumber, .d2h-code-line-ctn") ?? row;
  const rect = anchor.getBoundingClientRect();
  const top = Math.min(rect.bottom + 6, window.innerHeight - 220);
  const left = Math.min(Math.max(8, rect.left), window.innerWidth - 336);
  el.style.position = "fixed";
  el.style.top = `${top}px`;
  el.style.left = `${left}px`;
  el.style.zIndex = "200";
  el.hidden = false;
  input.value = "";
  input.focus();
}

async function submitActiveComment() {
  const session = /** @type {CedarSession | undefined} */ (window.__cedarSession);
  if (!session || !activeTarget) return;

  const el = ensurePopover();
  const input = el.querySelector(".cedar-diff-comment-input");
  const submit = el.querySelector(".cedar-diff-comment-submit");
  if (!(input instanceof HTMLTextAreaElement) || !(submit instanceof HTMLButtonElement)) return;

  const body = input.value.trim();
  if (!body) return;

  const panel = activeTarget.row.closest("[data-slice-panel]");
  const componentId = panel?.getAttribute("data-slice-panel") ?? "";
  const componentName = panel?.querySelector("h3")?.textContent?.trim() ?? componentId;

  submit.disabled = true;
  submit.textContent = "Posting…";

  try {
    const res = await fetch("/api/comment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prUrl: session.prUrl,
        token: session.token,
        owner: session.data.target?.owner,
        repo: session.data.target?.repo,
        pr: session.data.target?.pr,
        headSha: session.data.pull?.headSha,
        path: activeTarget.path,
        line: activeTarget.line,
        side: activeTarget.side,
        body,
        componentId,
        componentName,
      }),
    });
    const json = await res.json();
    if (!res.ok) {
      const msg = [json.error, json.hint, json.githubMessage].filter(Boolean).join("\n\n");
      throw new Error(msg || "Comment failed");
    }

    if (json.comment) {
      upsertSessionComment(/** @type {ReviewComment} */ (json.comment));
    }
    const fileBody = activeTarget.row.closest("[data-file-body]");
    const root = fileBody?.closest("#results") ?? document;
    if (fileBody instanceof HTMLElement) {
      paintCommentsForBody(fileBody, getSessionComments(), activeTarget.path);
    } else {
      repaintAllDiffComments(root);
    }
    closePopover();
    showCommentToast(`Posted on GitHub · ${pathBasename(activeTarget.path)}:${activeTarget.line}`);
  } catch (err) {
    submit.disabled = false;
    submit.textContent = "Post to GitHub";
    showCommentToast(err instanceof Error ? err.message : String(err), "error");
  }
}

function pathBasename(path) {
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * @param {string} path
 * @param {number} line
 * @param {string} side
 */
function commentAnchorKey(path, line, side) {
  return `${path}\0${line}\0${side === "LEFT" ? "LEFT" : "RIGHT"}`;
}

/**
 * @returns {ReviewComment[]}
 */
function getSessionComments() {
  const session = /** @type {CedarSession | undefined} */ (window.__cedarSession);
  return session?.reviewComments ?? [];
}

/**
 * GitHub inline + Composer Cursor drafts for diff painting.
 * @returns {ReviewComment[]}
 */
export function getCommentsForDiffPaint() {
  const github = getSessionComments().map((c) => ({ ...c, source: /** @type {const} */ ("github") }));
  const cursor = collectCursorDraftCommentsForDiff();
  return [...github, ...cursor];
}

/**
 * @param {ReviewComment} comment
 */
function upsertSessionComment(comment) {
  const session = /** @type {CedarSession | undefined} */ (window.__cedarSession);
  if (!session) return;
  if (!session.reviewComments) session.reviewComments = [];
  const idx = session.reviewComments.findIndex((c) => c.id === comment.id);
  if (idx >= 0) session.reviewComments[idx] = comment;
  else session.reviewComments.push(comment);
}

/**
 * @param {ReviewComment[]} comments
 */
function commentsByAnchor(comments) {
  /** @type {Map<string, ReviewComment[]>} */
  const map = new Map();
  for (const c of comments) {
    if (!c.path || !Number.isFinite(c.line)) continue;
    const key = commentAnchorKey(c.path, c.line, c.side ?? "RIGHT");
    const list = map.get(key) ?? [];
    list.push(c);
    map.set(key, list);
  }
  return map;
}

/**
 * @param {ReviewComment[]} items
 */
function renderCommentThreadSlide(items) {
  const cards = items
    .map((c) => {
      const isCursor = c.source === "cursor";
      const who = isCursor
        ? `<span class="cedar-diff-comment-card-user"><span class="cedar-badge cedar-badge-ok text-[9px]">Cursor</span> Draft</span>`
        : c.user
          ? `<span class="cedar-diff-comment-card-user">@${escapeHtml(c.user)}</span>`
          : `<span class="cedar-diff-comment-card-user">Reviewer</span>`;
      const when = !isCursor && c.created_at ? escapeHtml(new Date(c.created_at).toLocaleString()) : "";
      const link = c.html_url
        ? `<a class="cedar-diff-comment-thread-link" href="${escapeHtml(c.html_url)}" target="_blank" rel="noreferrer">Open on GitHub</a>`
        : "";
      const cardClass = isCursor ? "cedar-diff-comment-card cedar-diff-comment-card--cursor" : "cedar-diff-comment-card";
      return `<article class="${cardClass}">
        <header class="cedar-diff-comment-card-head">
          ${who}
          ${when ? `<span class="cedar-diff-comment-card-time">${when}</span>` : ""}
          ${link}
        </header>
        <p class="cedar-diff-comment-card-body">${escapeHtml(c.body).replace(/\n/g, "<br>")}</p>
      </article>`;
    })
    .join("");
  const count = items.length;
  const noun = count === 1 ? "comment" : "comments";
  return `<div class="cedar-diff-comment-thread-wrap">
    <button type="button" class="cedar-diff-comment-thread-toggle" aria-expanded="true" aria-label="Hide ${count} review ${noun} on this line">
      <span class="cedar-diff-comment-thread-toggle-count">${count}</span>
      <span class="cedar-diff-comment-thread-toggle-label">Hide ${noun}</span>
    </button>
    <div class="cedar-diff-comment-thread" role="region" aria-label="Review comments on this line">${cards}</div>
  </div>`;
}

/**
 * @param {HTMLElement} threadRow
 * @param {boolean} [expand]
 */
/**
 * @param {HTMLElement} host
 */
function commentsHostVisible(host) {
  return host.dataset.commentsHidden !== "true";
}

/**
 * @param {HTMLElement} host
 * @param {boolean} visible
 */
function setCommentsHostVisible(host, visible) {
  host.dataset.commentsHidden = visible ? "false" : "true";
  host.classList.toggle("cedar-diff-comments-off", !visible);
  host.querySelectorAll(".cedar-diff-comment-thread-row").forEach((threadRow) => {
    if (!(threadRow instanceof HTMLElement)) return;
    threadRow.classList.toggle("cedar-diff-comments-off", !visible);
    if (visible) threadRow.classList.remove("is-collapsed");
  });
  const btn = host.querySelector("[data-comments-toggle]");
  if (btn instanceof HTMLButtonElement) {
    btn.textContent = visible ? "Hide comments" : "Show comments";
    btn.setAttribute("aria-pressed", visible ? "true" : "false");
  }
}

/**
 * @param {HTMLElement} host
 */
function applyCommentsHostVisibility(host) {
  setCommentsHostVisible(host, commentsHostVisible(host));
}

function setThreadRowExpanded(threadRow, expand) {
  const host = threadRow.closest(".cedar-gh-files-changed");
  if (host instanceof HTMLElement && !commentsHostVisible(host)) return;

  const on =
    expand === undefined ? threadRow.classList.contains("is-collapsed") : expand;
  threadRow.classList.toggle("is-collapsed", !on);
  const btn = threadRow.querySelector(".cedar-diff-comment-thread-toggle");
  const label = threadRow.querySelector(".cedar-diff-comment-thread-toggle-label");
  const count = threadRow.querySelectorAll(".cedar-diff-comment-card").length;
  const noun = count === 1 ? "comment" : "comments";
  if (btn instanceof HTMLButtonElement) {
    btn.setAttribute("aria-expanded", on ? "true" : "false");
    btn.setAttribute("aria-label", `${on ? "Hide" : "Show"} ${count} review ${noun} on this line`);
  }
  if (label instanceof HTMLElement) {
    label.textContent = on ? `Hide ${noun}` : `Show ${noun}`;
  }
}

/**
 * @param {HTMLElement} codeRow
 */
function toggleThreadForCodeRow(codeRow) {
  const threadRow = codeRow.nextElementSibling;
  if (!(threadRow instanceof HTMLElement) || !threadRow.classList.contains("cedar-diff-comment-thread-row")) return;
  setThreadRowExpanded(threadRow);
}

/**
 * @param {HTMLElement} body
 */
function wireCommentThreads(body) {
  body.querySelectorAll(".cedar-diff-comment-thread-row").forEach((threadRow) => {
    if (!(threadRow instanceof HTMLElement)) return;
    if (threadRow.dataset.wiredThreadToggle) return;
    threadRow.dataset.wiredThreadToggle = "1";
    const btn = threadRow.querySelector(".cedar-diff-comment-thread-toggle");
    btn?.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      setThreadRowExpanded(threadRow);
    });
  });
}

function wireCommentVisibilityOnce() {
  const doc = document.documentElement;
  if (doc.dataset.cedarCommentVisWired) return;
  doc.dataset.cedarCommentVisWired = "1";
  document.addEventListener("click", (ev) => {
    const btn =
      ev.target instanceof HTMLElement ? ev.target.closest("[data-comments-toggle]") : null;
    if (!(btn instanceof HTMLButtonElement)) return;
    const host = btn.closest(".cedar-gh-files-changed");
    if (!(host instanceof HTMLElement)) return;
    ev.preventDefault();
    ev.stopPropagation();
    const showAfterClick = btn.getAttribute("aria-pressed") !== "true";
    setCommentsHostVisible(host, showAfterClick);
  });
}

/**
 * @param {HTMLElement} body
 * @param {ReviewComment[]} comments
 * @param {string} path
 */
function paintCommentsForBody(body, comments, path) {
  body.querySelectorAll(".cedar-diff-comment-thread-row").forEach((el) => el.remove());

  const byAnchor = commentsByAnchor(comments.filter((c) => c.path === path));
  if (!byAnchor.size) return;

  body.querySelectorAll(".d2h-diff-tbody tr.cedar-diff-comment-row").forEach((row) => {
    if (!(row instanceof HTMLElement)) return;
    const resolved = resolveLineFromRow(row);
    if (!resolved) return;
    const key = commentAnchorKey(path, resolved.line, resolved.side);
    const items = byAnchor.get(key);
    if (!items?.length) return;

    row.classList.add("cedar-diff-line-commented");
    const colCount = row.querySelectorAll("td").length || 4;
    const threadRow = document.createElement("tr");
    threadRow.className = "cedar-diff-comment-thread-row";
    const td = document.createElement("td");
    td.colSpan = Math.max(colCount, 4);
    td.className = "cedar-diff-comment-thread-cell";
    td.innerHTML = renderCommentThreadSlide(items);
    threadRow.appendChild(td);
    threadRow.dataset.sourceRow = "1";
    row.insertAdjacentElement("afterend", threadRow);
  });

  wireCommentThreads(body);
  const filesHost = body.closest(".cedar-gh-files-changed");
  if (filesHost instanceof HTMLElement) {
    applyCommentsHostVisibility(filesHost);
  }
}

/**
 * @param {ParentNode} root
 */
export function repaintAllDiffComments(root) {
  const comments = getCommentsForDiffPaint();
  root.querySelectorAll("[data-file-body]").forEach((body) => {
    if (!(body instanceof HTMLElement)) return;
    const path = body.closest("[data-file-review]")?.getAttribute("data-file-path");
    if (!path) return;
    paintCommentsForBody(body, comments, path);
  });
  root.querySelectorAll(".cedar-gh-files-changed").forEach((host) => {
    if (host instanceof HTMLElement) applyCommentsHostVisibility(host);
  });
}

/** Global toast hook set from app.js */
export let showCommentToast = /** @type {(message: string, tone?: string) => void} */ (
  (message, tone) => {
    console.warn("[cedar]", tone ?? "info", message);
  }
);

/**
 * @param {(message: string, tone?: string) => void} fn
 */
export function setCommentToast(fn) {
  showCommentToast = fn;
}

function wirePopoverOnce() {
  const el = ensurePopover();
  if (el.dataset.wired) return;
  el.dataset.wired = "1";

  el.querySelector(".cedar-diff-comment-cancel")?.addEventListener("click", closePopover);
  el.querySelector(".cedar-diff-comment-form")?.addEventListener("submit", (ev) => {
    ev.preventDefault();
    void submitActiveComment();
  });

  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && popover && !popover.hidden) closePopover();
  });

  document.addEventListener(
    "click",
    (ev) => {
      if (!popover || popover.hidden) return;
      if (ev.target instanceof Node && popover.contains(ev.target)) return;
      if (ev.target instanceof HTMLElement && ev.target.closest(".cedar-diff-gutter, .cedar-diff-add-comment")) return;
      closePopover();
    },
    true
  );
}

/**
 * @param {HTMLElement} row
 */
function isCommentableDiffRow(row) {
  if (row.querySelector(".d2h-info, .d2h-emptyplaceholder, .d2h-code-side-emptyplaceholder")) return false;
  if (row.querySelector(".d2h-code-line-ctn, .d2h-code-side-line")) return true;
  return Boolean(row.querySelector("td.d2h-ins, td.d2h-del, td.d2h-cntx, td.d2h-change"));
}

/**
 * @param {HTMLElement} body
 */
function wireDiffBodyComments(body) {
  const article = body.closest("[data-file-review]");
  const path = article?.getAttribute("data-file-path");
  if (!path) return;

  body.querySelectorAll(".d2h-diff-tbody tr").forEach((row) => {
    if (!(row instanceof HTMLElement)) return;
    if (!isCommentableDiffRow(row)) return;
    if (row.dataset.cedarCommentRow) return;
    row.dataset.cedarCommentRow = "1";
    row.classList.add("cedar-diff-comment-row");

    row.querySelectorAll(".d2h-code-linenumber, .d2h-code-side-linenumber").forEach((gutter) => {
      if (!(gutter instanceof HTMLElement)) return;
      gutter.classList.add("cedar-diff-gutter");
      if (!gutter.querySelector(".cedar-diff-add-comment")) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "cedar-diff-add-comment";
        btn.title = "Add review comment";
        btn.setAttribute("aria-label", "Add review comment");
        btn.textContent = "+";
        gutter.appendChild(btn);
        btn.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          openCommentPopoverForRow(row, path);
        });
      }
    });

    const openFromRow = (ev) => {
      if (ev.target instanceof HTMLElement && ev.target.closest(".cedar-diff-add-comment")) return;
      const filesHost = row.closest(".cedar-gh-files-changed");
      if (
        filesHost instanceof HTMLElement &&
        commentsHostVisible(filesHost) &&
        row.classList.contains("cedar-diff-line-commented") &&
        row.nextElementSibling?.classList.contains("cedar-diff-comment-thread-row") &&
        !(ev.target instanceof HTMLElement && ev.target.closest(".cedar-diff-add-comment"))
      ) {
        const onGutter = ev.target instanceof HTMLElement && ev.target.closest(".d2h-code-linenumber, .d2h-code-side-linenumber");
        const onCode = ev.target instanceof HTMLElement && ev.target.closest(".d2h-code-line-ctn");
        if (onGutter || onCode) {
          ev.preventDefault();
          ev.stopPropagation();
          toggleThreadForCodeRow(row);
          return;
        }
      }
      const onGutter = ev.target instanceof HTMLElement && ev.target.closest(".d2h-code-linenumber, .d2h-code-side-linenumber");
      const onCode = ev.target instanceof HTMLElement && ev.target.closest(".d2h-code-line-ctn");
      if (!onGutter && !onCode) return;
      ev.preventDefault();
      ev.stopPropagation();
      openCommentPopoverForRow(row, path);
    };

    row.addEventListener("click", openFromRow);
  });
}

/**
 * @param {ParentNode} root
 */
export function wireDiffComments(root) {
  wirePopoverOnce();
  wireCommentVisibilityOnce();
  root.querySelectorAll("[data-file-body]").forEach((body) => {
    if (!(body instanceof HTMLElement)) return;
    wireDiffBodyComments(body);
    const path = body.closest("[data-file-review]")?.getAttribute("data-file-path");
    if (path) {
      const merged = getCommentsForDiffPaint();
      if (merged.length) paintCommentsForBody(body, merged, path);
    }
  });
}

/**
 * @param {ParentNode} root
 */
export async function loadDiffReviewComments(root) {
  const session = /** @type {CedarSession | undefined} */ (window.__cedarSession);
  if (!session) return;

  try {
    const res = await fetch("/api/comments/list", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prUrl: session.prUrl,
        token: session.token,
        owner: session.data.target?.owner,
        repo: session.data.target?.repo,
        pr: session.data.target?.pr,
      }),
    });
    const json = await res.json();
    if (!res.ok) {
      const msg = [json.error, json.hint, json.githubMessage].filter(Boolean).join("\n\n");
      throw new Error(msg || "Could not load comments");
    }
    session.reviewComments = json.comments ?? [];
    repaintAllDiffComments(root);
  } catch (err) {
    showCommentToast(err instanceof Error ? err.message : String(err), "error");
  }
}