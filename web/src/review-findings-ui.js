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

function severityClass(sev) {
  if (sev === "blocker") return "severity-blocker";
  if (sev === "warning") return "severity-warning";
  return "severity-info";
}

/**
 * @param {{ ruleId?: string, severity?: string, tag?: string, priority?: string }} f
 */
function renderFindingTaxonomy(f) {
  const meta = getFindingMeta(f.ruleId, f.severity);
  const tag = f.tag ?? meta.tag;
  const tagLabel = meta.tagLabel;
  const priority = f.priority ?? meta.priority;
  const tagClass = FINDING_TAG_CLASS[tag] ?? "cedar-finding-tag-quality";
  return `<span class="cedar-finding-priority" title="Priority">${priority}</span>
    <span class="cedar-finding-tag ${tagClass}" title="Category">${escapeHtml(tagLabel)}</span>`;
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
      html: `<p class="text-sm italic text-zinc-600">No findings yet — run review or reload GitHub comments.</p>`,
      activeCount: 0,
    };
  }

  const html = `<ul class="cedar-findings-list space-y-2">${sliceFindings
    .slice(0, 24)
    .map((f, fi) => {
      const key = findingKey(r.componentId, f, fi);
      const ignored = isFindingIgnored(key);
      const onGithub = posted.has(key) || f.source === "github";
      const fileBtn = f.filename
        ? `<button type="button" class="cedar-finding-file cedar-btn-link text-[10px]" data-finding-jump data-filename="${escapeHtml(f.filename)}">${escapeHtml(f.filename)}</button>`
        : "";
      const meta = getFindingMeta(f.ruleId, f.severity);
      const tag = f.tag ?? meta.tag;
      const priority = f.priority ?? meta.priority;
      const line =
        typeof f.line === "number" && f.line > 0
          ? `<span class="cedar-badge cedar-badge-muted font-mono text-[9px]" title="Line in file">L${f.line}</span>`
          : "";
      return `<li class="cedar-finding-card cedar-glass-subtle px-3 py-2.5${ignored ? " is-ignored" : ""}" data-finding-key="${escapeHtml(key)}">
                <div class="flex flex-wrap items-center gap-1.5">
                  <span class="${severityClass(f.severity)}">${f.severity}</span>
                  ${renderFindingTaxonomy(f)}
                  ${line}
                  ${fileBtn}
                  ${ignored ? '<span class="cedar-badge cedar-badge-muted">Ignored</span>' : ""}
                  ${onGithub ? '<span class="cedar-badge cedar-badge-ok">On GitHub</span>' : ""}
                </div>
                <p class="cedar-finding-message mt-1.5 text-xs leading-relaxed text-zinc-300">${escapeHtml(f.message)}</p>
                <div class="cedar-finding-actions mt-2 flex flex-wrap gap-1.5">
                  ${
                    ignored
                      ? `<button type="button" class="cedar-btn-secondary cedar-btn-compact" data-finding-unignore data-finding-key="${escapeHtml(key)}">Restore</button>`
                      : `<button type="button" class="cedar-btn-secondary cedar-btn-compact" data-finding-ignore data-finding-key="${escapeHtml(key)}">Ignore</button>`
                  }
                  <button type="button" class="cedar-btn-secondary cedar-btn-compact" data-finding-comment
                    data-finding-key="${escapeHtml(key)}"
                    data-filename="${escapeHtml(f.filename ?? "")}"
                    data-finding-severity="${escapeHtml(f.severity)}"
                    data-finding-rule="${escapeHtml(f.ruleId ?? "finding")}"
                    data-finding-message="${escapeHtml(f.message)}"
                    data-finding-tag="${escapeHtml(tag)}"
                    data-finding-priority="${escapeHtml(priority)}"
                    data-finding-line="${typeof f.line === "number" && f.line > 0 ? f.line : ""}"
                    data-component-id="${escapeHtml(r.componentId)}"
                    data-component-name="${escapeHtml(r.componentName)}"
                    ${!f.filename || onGithub ? "disabled" : ""}
                    title="${!f.filename ? "No file path for this finding" : onGithub ? "Already on GitHub" : "Post as inline review comment on GitHub"}">${onGithub ? "On GitHub" : "Save as comment"}</button>
                </div>
              </li>`;
    })
    .join("")}</ul>`;

  return { html, activeCount: activeFindings.length };
}