import { html as diff2html } from "diff2html";
import {
  getActiveDiffFontPreset,
  getDiffFontSettings,
  renderDiffFontControl,
  wireDiffFontControls,
} from "./diff-font.js";
import { wireDiffComments } from "./diff-comments.js";

const DIFF_BASE = {
  drawFileList: false,
  matching: "lines",
  colorScheme: "dark",
  renderNothingWhenEmpty: false,
};

/** @typedef {"side-by-side" | "line-by-line"} DiffOutputFormat */

/**
 * @returns {DiffOutputFormat}
 */
export function defaultDiffFormat() {
  return "line-by-line";
}

/**
 * @param {DiffOutputFormat} format
 */
function diffOptions(format) {
  return {
    ...DIFF_BASE,
    outputFormat: format,
  };
}

/**
 * @param {string} patch
 */
function patchToB64(patch) {
  return btoa(unescape(encodeURIComponent(patch)));
}

/**
 * @param {string} b64
 */
function patchFromB64(b64) {
  return decodeURIComponent(escape(atob(b64)));
}

/**
 * @param {string} path
 * @param {string} patch
 */
export function normalizePatch(path, patch) {
  if (!patch?.trim()) return "";
  const p = patch.trim();
  if (p.startsWith("diff --git")) return p;
  return [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`, p].join("\n");
}

/**
 * @param {string} path
 * @param {string | null | undefined} patch
 * @param {DiffOutputFormat} [format]
 */
export function renderGithubFileDiff(path, patch, format = defaultDiffFormat()) {
  const full = normalizePatch(path, patch ?? "");
  if (!full) {
    return `<p class="cedar-gh-diff-empty">Diff not available from GitHub (file may be too large or binary).</p>`;
  }
  try {
    const body = diff2html(full, diffOptions(format));
    return `<div class="cedar-diff2html d2h-dark-color-scheme" data-diff-format="${format}">${body}</div>`;
  } catch {
    return `<pre class="cedar-gh-diff-fallback">${escapeHtml(patch ?? "")}</pre>`;
  }
}

/**
 * @param {string} status
 */
function statusLabel(status) {
  const s = String(status ?? "modified").toLowerCase();
  const labels = {
    added: "Added",
    removed: "Deleted",
    deleted: "Deleted",
    renamed: "Renamed",
    copied: "Copied",
    changed: "Changed",
    modified: "Modified",
  };
  return labels[s] ?? "Modified";
}

const FILE_CHANGE_BADGE = {
  added: { fill: "#14532d", border: "#34d399", text: "#d1fae5" },
  removed: { fill: "#450a0a", border: "#f87171", text: "#fecaca" },
  deleted: { fill: "#450a0a", border: "#f87171", text: "#fecaca" },
  renamed: { fill: "#312e81", border: "#818cf8", text: "#e0e7ff" },
  copied: { fill: "#134e4a", stroke: "#2dd4bf", text: "#ccfbf1", border: "#2dd4bf" },
  changed: { fill: "#1e3a8a", border: "#60a5fa", text: "#dbeafe" },
  modified: { fill: "#422006", border: "#fbbf24", text: "#fef3c7" },
};

/**
 * @param {string} status
 */
function renderFileChangeBadge(status) {
  const key = String(status ?? "modified").toLowerCase();
  const c = FILE_CHANGE_BADGE[key] ?? FILE_CHANGE_BADGE.modified;
  const border = c.border ?? c.stroke;
  return `<span class="cedar-badge cedar-file-change-badge" style="border-color:${border}55;background-color:${c.fill};color:${c.text}">${escapeHtml(statusLabel(key))}</span>`;
}

/**
 * @param {{ path: string, status?: string, additions: number, deletions: number, patch?: string | null }[]} files
 * @param {string} pullUrl
 */
export function renderSliceFileReviews(files, pullUrl = "") {
  if (!files?.length) {
    return `<p class="text-sm text-zinc-600">No files in this virtual PR.</p>`;
  }

  const ghFiles = pullUrl ? `${pullUrl.replace(/\/$/, "")}/files` : "";
  const format = defaultDiffFormat();

  const cards = files
    .map((f, i) => {
      const status = f.status ?? "modified";
      const diffHtml = f.patch ? renderGithubFileDiff(f.path, f.patch, format) : "";
      const patchB64 = f.patch ? patchToB64(f.patch) : "";
      const ghFile = ghFiles ? `${ghFiles}#diff-${encodeGitHubAnchor(f.path)}` : "";

      return `
      <article class="cedar-gh-file" data-file-review data-file-path="${escapeHtml(f.path)}"${
        patchB64 ? ` data-patch-b64="${patchB64}"` : ""
      }>
        <div class="cedar-gh-file-actions">
          <div class="cedar-gh-diff-view-toggle" role="group" aria-label="Diff view">
            <button type="button" class="cedar-gh-diff-mode${format === "side-by-side" ? " is-active" : ""}" data-diff-mode="side-by-side" title="Split">Split</button>
            <button type="button" class="cedar-gh-diff-mode${format === "line-by-line" ? " is-active" : ""}" data-diff-mode="line-by-line" title="Unified">Unified</button>
          </div>
          ${
            ghFile
              ? `<a href="${escapeHtml(ghFile)}" target="_blank" rel="noreferrer" class="cedar-gh-open-github">Open on GitHub</a>`
              : ""
          }
          ${renderFileChangeBadge(status)}
        </div>
        <div class="cedar-gh-file-body" data-file-body id="file-review-${i}">
          ${diffHtml || `<p class="cedar-gh-diff-empty">No patch returned for this file.</p>`}
        </div>
      </article>`;
    })
    .join("");

  const fontPreset = getActiveDiffFontPreset();
  const { size, line } = getDiffFontSettings();

  return `
    <div class="cedar-gh-files-changed space-y-0" style="--cedar-diff-font-size: ${size}px; --cedar-diff-line-height: ${line}px">
      <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p class="cedar-label mb-0">Files changed</p>
          <p class="mt-1 text-[8px] text-zinc-600">Click a line or + in the gutter · posts to GitHub</p>
        </div>
        ${renderDiffFontControl(fontPreset)}
      </div>
      ${cards}
    </div>`;
}

/**
 * @param {string} path
 */
function encodeGitHubAnchor(path) {
  return path.replace(/\//g, "-").replace(/\./g, "-");
}

/**
 * @param {ParentNode} root
 */
export function wireFileReviewToggles(root) {
  wireDiffFontControls(root);
  wireDiffComments(root);

  root.querySelectorAll(".cedar-gh-file[data-file-review]").forEach((article) => {
    if (!(article instanceof HTMLElement)) return;

    article.querySelectorAll(".d2h-file-header").forEach((header) => {
      header.classList.add("d2h-sticky-header");
    });

    article.querySelectorAll("[data-diff-mode]").forEach((btn) => {
      if (btn.dataset.wiredDiff) return;
      btn.dataset.wiredDiff = "1";
      btn.addEventListener("click", () => {
        const mode = btn.getAttribute("data-diff-mode");
        if (mode !== "side-by-side" && mode !== "line-by-line") return;
        const path = article.getAttribute("data-file-path");
        const b64 = article.getAttribute("data-patch-b64");
        const body = article.querySelector("[data-file-body]");
        if (!path || !b64 || !(body instanceof HTMLElement)) return;

        article.querySelectorAll("[data-diff-mode]").forEach((b) => {
          b.classList.toggle("is-active", b.getAttribute("data-diff-mode") === mode);
        });

        try {
          const patch = patchFromB64(b64);
          body.innerHTML = renderGithubFileDiff(path, patch, mode);
          body.querySelectorAll(".d2h-file-header").forEach((header) => {
            header.classList.add("d2h-sticky-header");
          });
          wireDiffComments(body);
        } catch {
          /* keep previous render */
        }
      });
    });
  });
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}