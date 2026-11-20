import { FINDING_TAG_CLASS, getFindingMeta } from "../../src/finding-meta.js";

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
function renderMacroFindingMeta(f) {
  const meta = getFindingMeta(f.ruleId, f.severity);
  const tag = f.tag ?? meta.tag;
  const tagLabel = meta.tagLabel;
  const priority = f.priority ?? meta.priority;
  const tagClass = FINDING_TAG_CLASS[tag] ?? "cedar-finding-tag-quality";
  return `<span class="cedar-finding-priority">${priority}</span>
    <span class="cedar-finding-tag ${tagClass}">${escapeHtml(tagLabel)}</span>`;
}

/**
 * @param {{ body?: string, event?: string, priority?: string, findings?: Array<{ message?: string, tag?: string, priority?: string, ruleId?: string, severity?: string }>, source?: string }} macroReview
 */
export function renderMacroReviewPanelHtml(macroReview) {
  if (!macroReview?.body?.trim() && !(macroReview?.findings?.length)) {
    return "";
  }

  const event = macroReview.event ?? "COMMENT";
  const eventLabel =
    event === "APPROVE" ? "Suggests approve" : event === "REQUEST_CHANGES" ? "Suggests changes" : "Review comment";

  const findingCards = (macroReview.findings ?? [])
    .map(
      (f) => `<li class="cedar-review-comment-card cedar-glass-subtle px-3 py-2.5">
        <div class="mb-1.5 flex flex-wrap items-center gap-1.5">
          <span class="cedar-badge cedar-badge-ok text-[9px]">Macro review</span>
          ${renderMacroFindingMeta(f)}
        </div>
        <p class="cedar-review-comment-body text-sm leading-relaxed text-zinc-200">${escapeHtml(f.message ?? "")}</p>
      </li>`
    )
    .join("");

  const findingsBlock = findingCards
    ? `<div class="mt-4">
        <p class="cedar-label">Themes (${macroReview.findings.length})</p>
        <ul class="mt-2 space-y-2">${findingCards}</ul>
      </div>`
    : "";

  return `<section class="cedar-glass-subtle cedar-macro-review mb-6 px-5 py-4" aria-labelledby="cedar-macro-review-heading">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p class="cedar-label" id="cedar-macro-review-heading">Macro review · entire PR</p>
        <p class="mt-2 text-xs leading-relaxed text-zinc-400">PR-wide architecture and cross-cutting themes stay here. Line-level code comments appear inline on the diff as <span class="text-zinc-300">Cursor · Draft</span>.</p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <span class="cedar-badge cedar-badge-muted text-[9px]">${escapeHtml(eventLabel)}</span>
        ${macroReview.priority ? `<span class="cedar-finding-priority text-[10px]">${escapeHtml(macroReview.priority)}</span>` : ""}
        ${
          macroReview.body?.trim()
            ? `<button type="button" id="post-macro-review-btn" class="cedar-btn-secondary cedar-btn-compact" data-macro-event="${escapeHtml(event)}"
          title="Post the full macro comment as a GitHub PR review">Post PR comment</button>`
            : ""
        }
      </div>
    </div>
    ${findingsBlock}
  </section>`;
}