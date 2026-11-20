import { cedarMarkSvg } from "./cedar-logo.js";
import { architectureIconSvg, slicesIconSvg } from "./cedar-icons.js";
import { mountArchitectureGraphs, wireArchitectureZoomControls } from "./architecture-canvas.js";
import { buildDiagramGraph } from "../../src/diagram-graph.js";
import { layerAccent, sliceStatusVisual } from "../../src/diagram-colors.js";
import { buildArchitectureDiagramMermaid } from "../../src/architecture-diagram.js";
import { buildCompleteLayoutViews } from "../../src/architecture-layout-views.js";
import {
  ARCHITECTURE_LAYER_STACK,
  ARCHITECTURE_MODEL_LABEL,
  normalizeSliceId,
} from "../../src/architecture-model.js";
import { buildPrArchitectureLayers } from "../../src/pr-architecture-layers.js";
import { renderSliceFileReviews, wireFileReviewToggles } from "./diff-view.js";
import { loadDiffReviewComments, setCommentToast } from "./diff-comments.js";
import { initDiffFontFromServer } from "./diff-font.js";
import {
  mountCompleteLayoutViews,
  activateDiagramUx,
  wireDiagramResizeListeners,
  refitPanZoomDiagrams,
} from "./diagram-ux.js";
import { applyReviewStreamEvent, postReviewStream } from "./review-stream.js";
import { buildPrChatContext, wirePrChatSidebar } from "./pr-chat.js";
import {
  countActiveFindings,
  ensureFindingSession,
  findingKey,
  findingsForSlice,
  isFindingIgnored,
  setFindingToast,
  wireFindingActions,
} from "./finding-actions.js";
import { buildFindingsListHtml } from "./review-findings-ui.js";
import { renderMacroReviewPanelHtml } from "./macro-review-ui.js";

/**
 * @param {string} [status]
 */
function renderSliceStatusDot(status) {
  const v = sliceStatusVisual(status);
  return `<span class="cedar-slice-status-dot" style="background-color:${v.fill};border-color:${v.border};color:${v.border}" aria-hidden="true"></span>`;
}

/**
 * @param {number} n
 * @param {string} [status]
 * @param {boolean} [hashPrefix]
 */
function renderSliceIndexLabel(n, status, hashPrefix = true) {
  const v = sliceStatusVisual(status);
  const label = hashPrefix ? `#${n}` : String(n);
  return `<span class="cedar-slice-index tabular-nums" style="color:${v.text}">${label}</span>`;
}

/**
 * Review status pill on each virtual micro-PR (matches diagram slice badges).
 * @param {string} [status]
 */
function renderSliceReviewBadge(status) {
  const v = sliceStatusVisual(status);
  const label = statusLabel[status] ?? status ?? "Pending";
  return `<span class="cedar-badge cedar-slice-review-badge inline-flex items-center gap-1.5" style="border-color:${v.border}66;background-color:${v.fill};color:${v.text}">
    ${renderSliceStatusDot(status)}
    <span>${escapeHtml(label)}</span>
  </span>`;
}

const statusLabel = {
  passed: "Ready",
  failed: "Blocked",
  skipped: "Skipped",
};

function githubApiErrorMessage(body, fallback = "Request failed") {
  if (!body || typeof body !== "object") return fallback;
  if (body.code === "GITHUB_TOKEN_FORBIDDEN") {
    return `${body.error} Fine-grained PAT: Pull requests → Read and write on this repo. Classic PAT: repo scope. Org: authorize SSO.`;
  }
  const base = body.error ?? body.githubMessage ?? fallback;
  if (body.hint) return `${base}\n\n${body.hint}`;
  return base;
}

function showToast(message, tone = "neutral") {
  const host = document.getElementById("toast-host");
  if (!host) return;
  const el = document.createElement("div");
  el.className = `cedar-toast ${tone === "error" ? "border-rose-500/30 text-rose-100" : ""}`;
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => el.remove(), 4800);
}

export function mountApp(root) {
  setCommentToast((message, tone) => showToast(message, tone === "error" ? "error" : "neutral"));
  setFindingToast((message, tone) => showToast(message, tone === "error" ? "error" : "neutral"));

  root.innerHTML = `
    <div class="cedar-shell">
      <header class="sticky top-0 z-40 border-b border-white/[0.06] bg-black/40 backdrop-blur-xl">
        <div class="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3.5 sm:px-6">
          <a href="/" class="group flex items-center gap-2.5" aria-label="Cedar home">
            <span class="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-black shadow-lg shadow-black/40 transition group-hover:scale-105 group-hover:shadow-white/10">
              ${cedarMarkSvg("h-[22px] w-[22px]")}
            </span>
            <span class="text-sm font-semibold tracking-tight text-white">cedar</span>
          </a>
          <nav class="hidden items-center gap-1 text-xs font-medium text-zinc-500 sm:flex">
            <span class="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-zinc-300">${slicesIconSvg("h-3.5 w-3.5 opacity-80")}<span>Micro slices</span></span>
            <span class="text-zinc-700">·</span>
            <span class="px-3 py-1.5">Architecture</span>
            <span class="text-zinc-700">·</span>
            <span class="px-3 py-1.5">Approve</span>
          </nav>
          <div id="health-pill" class="cedar-badge cedar-badge-muted">Checking…</div>
        </div>
      </header>

      <main id="main-stage" class="relative mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-20">
        <section id="hero" class="cedar-fade-in mx-auto max-w-xl">
          <div class="text-center">
            <div class="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-white shadow-[0_0_40px_-12px_rgba(255,255,255,0.25)]">
              ${cedarMarkSvg("h-8 w-8")}
            </div>
            <h1 class="mt-4 text-4xl font-semibold tracking-tight text-white sm:text-[2.75rem] sm:leading-[1.1]">
              Review the architecture,<br class="hidden sm:block" /> not just the diff
            </h1>
            <p class="mx-auto mt-5 max-w-md text-base leading-relaxed text-zinc-400">
              Cedar splits each pull request into micro slices, reviews them independently, and delivers a whole-picture composite with an architecture diagram.
            </p>
          </div>

          <form id="review-form" class="cedar-glass mt-10 p-6 sm:p-8">
            <label class="cedar-label">GitHub pull request URL</label>
            <input name="prUrl" required inputmode="url" autocomplete="url"
              placeholder="https://github.com/owner/repo/pull/42"
              class="cedar-input mt-3 font-mono text-[13px]" />
            <details class="mt-5 group">
              <summary class="cursor-pointer list-none text-sm font-medium text-zinc-500 transition hover:text-zinc-300">
                <span class="group-open:hidden">Advanced options</span>
                <span class="hidden group-open:inline">Hide options</span>
              </summary>
              <div class="mt-4 space-y-4 border-t border-white/[0.06] pt-4">
                <label class="block">
                  <span class="text-xs text-zinc-500">GitHub token (optional)</span>
                  <input name="token" type="password" autocomplete="off" placeholder="Uses server credentials if empty"
                    class="cedar-input mt-2 font-mono text-xs" />
                </label>
                <div class="flex flex-wrap gap-6 text-xs text-zinc-400">
                  <label class="flex cursor-pointer items-center gap-2"><input type="checkbox" name="postMicro" class="rounded border-white/20 bg-black" /> Post micro-reviews to GitHub</label>
                  <label class="flex cursor-pointer items-center gap-2"><input type="checkbox" name="post" class="rounded border-white/20 bg-black" /> Post composite review</label>
                </div>
              </div>
            </details>
            <div class="mt-8 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
              <button type="submit" id="submit-btn" class="cedar-btn-primary w-full sm:w-auto">
                <span id="submit-label">Start review</span>
              </button>
              <p class="text-center text-xs text-zinc-600 sm:text-left">Typically 30–90s depending on PR size</p>
            </div>
          </form>
          <p id="form-error" class="mt-4 hidden text-center text-sm text-rose-400"></p>
        </section>

        <section id="results" class="hidden cedar-fade-in"></section>
      </main>
    </div>
  `;

  void refreshHealth();
  document.getElementById("review-form").addEventListener("submit", onSubmit);

  const params = new URLSearchParams(window.location.search);
  const prFromQuery = params.get("pr") ?? params.get("url");
  if (prFromQuery) {
    const input = document.querySelector('input[name="prUrl"]');
    if (input) input.value = prFromQuery;
  }
}

async function refreshHealth() {
  const pill = document.getElementById("health-pill");
  try {
    const res = await fetch("/api/health");
    const data = await res.json();
    window.__cedarServerHealth = data;
    initDiffFontFromServer(data.diffFont);
    if (data.hasToken && data.aiProvider === "cursor") {
      pill.textContent = "Cursor ready";
      pill.className = "cedar-badge cedar-badge-ok";
    } else if (data.hasToken && data.aiProvider === "openrouter") {
      pill.textContent = "OpenRouter";
      pill.className = "cedar-badge cedar-badge-ok";
    } else if (data.hasToken && (data.hasCursor || data.hasOpenRouter)) {
      pill.textContent = "Ready";
      pill.className = "cedar-badge cedar-badge-ok";
    } else if (data.hasToken) {
      pill.textContent = "GitHub only";
      pill.className = "cedar-badge cedar-badge-warn";
    } else {
      pill.textContent = "Needs token";
      pill.className = "cedar-badge cedar-badge-warn";
    }
  } catch {
    pill.textContent = "API offline";
    pill.className = "cedar-badge border-rose-500/30 bg-rose-500/10 text-rose-200";
  }
}

async function onSubmit(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const fd = new FormData(form);
  const payload = {
    prUrl: String(fd.get("prUrl")).trim(),
    token: String(fd.get("token") || "").trim() || undefined,
    post: fd.get("post") === "on",
    postMicro: fd.get("postMicro") === "on",
  };

  const errorEl = document.getElementById("form-error");
  const btn = document.getElementById("submit-btn");
  const label = document.getElementById("submit-label");
  const hero = document.getElementById("hero");
  const results = document.getElementById("results");

  errorEl.classList.add("hidden");
  btn.disabled = true;
  label.innerHTML = '<span class="cedar-spinner"></span><span class="ml-2">Connecting…</span>';
  hero.classList.add("hidden");
  results.classList.remove("hidden");
  document.getElementById("main-stage")?.classList.add("cedar-review-wide");
  results.innerHTML = loadingSkeleton();

  try {
    const statusEl = document.getElementById("review-progress-status");
    const logEl = document.getElementById("review-progress-log");
    const onStream = (event) => {
      applyReviewStreamEvent(event, statusEl, logEl);
      if (event?.type === "activity" && event.text) {
        label.innerHTML = `<span class="cedar-spinner"></span><span class="ml-2">${escapeHtml(String(event.text))}</span>`;
      } else if (event?.type === "phase" && event.status === "running") {
        label.innerHTML = `<span class="cedar-spinner"></span><span class="ml-2">${escapeHtml(String(event.label ?? "Working…"))}</span>`;
      }
    };
    const data = await postReviewStream(payload, onStream);

    const filePatches = new Map();
    for (const m of data.microPrs ?? []) {
      for (const f of m.files ?? []) {
        if (f.patch) filePatches.set(`${m.componentId}::${f.path}`, f.patch);
      }
    }

    window.__cedarSession = {
      prUrl: payload.prUrl,
      token: payload.token,
      data,
      sliceApprovals: new Set(),
      ignoredFindings: new Set(),
      findingCommentsPosted: new Set(),
      filePatches,
    };
    ensureFindingSession(window.__cedarSession);

    renderResults(results, data);
  } catch (err) {
    results.innerHTML = "";
    results.classList.add("hidden");
    document.getElementById("main-stage")?.classList.remove("cedar-review-wide");
    errorEl.textContent = err instanceof Error ? err.message : String(err);
    errorEl.classList.remove("hidden");
    showToast(errorEl.textContent, "error");
  } finally {
    btn.disabled = false;
    label.textContent = "Start review";
  }
}

function loadingSkeleton() {
  return `
    <div id="review-progress-panel" class="cedar-glass p-6 sm:p-8">
      <p class="cedar-label">Review in progress</p>
      <p id="review-progress-status" class="mt-3 text-sm font-medium text-zinc-200">Connecting…</p>
      <ul id="review-progress-log" class="review-progress-log mt-4 max-h-56 space-y-1 overflow-y-auto text-xs text-zinc-500" aria-live="polite"></ul>
    </div>`;
}

let sliceApprovals = new Set();

function finishReviewUi(container) {
  bindApproveHandlers(container);
  wireFindingActions(container, patchFindingsAndMetrics);
  wireFileReviewToggles(container);
  wireMacroReviewPost(container);
  void loadDiffReviewComments(container);
}

function refreshReviewUi() {
  const session = window.__cedarSession;
  const results = document.getElementById("results");
  if (!session?.data || !results) return;
  ensureFindingSession(session);
  sliceApprovals = session.sliceApprovals ?? sliceApprovals;
  renderResults(results, session.data);
}

window.__cedarPatchFindings = patchFindingsAndMetrics;

function patchFindingsAndMetrics() {
  const session = window.__cedarSession;
  const container = document.getElementById("results");
  if (!session?.data || !container) return;

  const { microResults } = session.data;
  for (const r of microResults.filter((res) => res.status !== "skipped")) {
    const panel = container.querySelector(`[data-slice-panel="${CSS.escape(r.componentId)}"]`);
    if (!panel) continue;

    const { html, activeCount } = buildFindingsListHtml(r, session);
    const body = panel.querySelector(".cedar-findings-panel > .mt-3");
    const details = panel.querySelector(".cedar-findings-panel");
    if (body) body.innerHTML = html;
    if (details instanceof HTMLDetailsElement) {
      const sum = details.querySelector("summary");
      if (sum) sum.textContent = `Cursor · slice findings${activeCount ? ` (${activeCount})` : ""}`;
      if (activeCount) details.open = true;
    }
    patchSliceFindingBadges(panel, r, session);
  }

  patchPrHeaderMetrics(session.data);
  wireFindingActions(container, patchFindingsAndMetrics);
}

/**
 * @param {HTMLElement} panel
 */
function patchSliceFindingBadges(panel, r, session) {
  const row = panel.querySelector("[data-slice-badges]");
  if (!row) return;
  const sliceFindings = findingsForSlice(r.componentId, r);
  const activeFindings = sliceFindings.filter((f, fi) => !isFindingIgnored(findingKey(r.componentId, f, fi)));
  const blockers = activeFindings.filter((f) => f.severity === "blocker").length;
  const warnings = activeFindings.filter((f) => f.severity === "warning").length;
  row.querySelector("[data-slice-blockers]")?.remove();
  row.querySelector("[data-slice-warnings]")?.remove();
  if (blockers) {
    row.insertAdjacentHTML(
      "beforeend",
      `<span data-slice-blockers class="cedar-badge border-rose-500/30 bg-rose-500/10 text-rose-200">${blockers} blockers</span>`
    );
  }
  if (warnings) {
    row.insertAdjacentHTML(
      "beforeend",
      `<span data-slice-warnings class="cedar-badge cedar-badge-warn">${warnings} warnings</span>`
    );
  }
}

function patchPrHeaderMetrics(data) {
  const session = window.__cedarSession;
  sliceApprovals = session?.sliceApprovals ?? sliceApprovals;
  const { gate, microResults } = data;
  const touched = microResults.filter((r) => r.status !== "skipped");
  const approvedCount = touched.filter((r) => sliceApprovals.has(r.componentId)).length;
  const allSlicesApproved = touched.length > 0 && approvedCount === touched.length;
  const canApprovePr = gate.ready && allSlicesApproved;
  const approvePct = touched.length ? Math.round((approvedCount / touched.length) * 100) : 0;
  const confidence = mergeConfidence(gate, microResults);

  const statValues = document.querySelectorAll(".cedar-pr-header-metrics .cedar-pr-stat-value");
  const confVal = statValues[0];
  const approvedVal = statValues[1];
  if (confVal) {
    const num = confVal.querySelector(".cedar-pr-stat-num");
    if (num) num.textContent = String(confidence.score);
    confVal.className = `cedar-pr-stat-value tabular-nums ${confidence.color}`;
    const caption = document.querySelector(".cedar-pr-stat-caption");
    if (caption) caption.textContent = confidence.label;
  }
  if (approvedVal) {
    const num = approvedVal.querySelector(".cedar-pr-stat-num");
    const denom = approvedVal.querySelector(".cedar-pr-stat-denom");
    if (num) num.textContent = String(approvedCount);
    if (denom) denom.textContent = `/${touched.length}`;
  }
  const progress = document.querySelector(".cedar-pr-stat-progress");
  const fill = document.querySelector(".cedar-pr-stat-progress-fill");
  if (progress) progress.setAttribute("aria-valuenow", String(approvePct));
  if (fill) fill.style.width = `${approvePct}%`;

  const prBtn = document.getElementById("approve-pr-btn");
  if (prBtn instanceof HTMLButtonElement) {
    prBtn.disabled = !canApprovePr;
    prBtn.classList.toggle("is-ready", canApprovePr);
    prBtn.title = canApprovePr
      ? "Approve the full pull request on GitHub"
      : "Mark every slice approved in Cedar first";
  }
}

function patchSliceApprovalState(componentId) {
  const container = document.getElementById("results");
  if (!container) return;

  const panel = container.querySelector(`[data-slice-panel="${CSS.escape(componentId)}"]`);
  const btn = panel?.querySelector(`[data-approve-slice="${CSS.escape(componentId)}"]`);
  if (btn instanceof HTMLButtonElement) {
    btn.disabled = true;
    btn.textContent = "Approved";
    btn.classList.remove("is-ready");
    btn.classList.add("is-done");
  }

  const metrics = panel?.querySelector("[data-slice-badges]");
  if (metrics && !metrics.querySelector("[data-slice-approved-badge]")) {
    metrics.insertAdjacentHTML(
      "beforeend",
      '<span class="cedar-badge cedar-badge-ok" data-slice-approved-badge>Approved</span>'
    );
  }

  container.querySelectorAll(`[data-slice-tab="${CSS.escape(componentId)}"]`).forEach((tab) => {
    if (tab.querySelector(".cedar-nav-item-check")) return;
    tab.insertAdjacentHTML("beforeend", '<span class="cedar-nav-item-check">✓</span>');
  });

  container.querySelectorAll(`[data-scroll-slice="${CSS.escape(componentId)}"]`).forEach((navBtn) => {
    const row = navBtn.querySelector(".cedar-nav-item-row");
    if (!row || row.querySelector(".cedar-nav-item-check")) return;
    row.insertAdjacentHTML("beforeend", '<span class="cedar-nav-item-check">✓</span>');
  });

  if (window.__cedarSession?.data) patchPrHeaderMetrics(window.__cedarSession.data);
}

function mergeConfidence(gate, microResults) {
  const session = window.__cedarSession;
  const blockers = countActiveFindings(microResults, "blocker", session);
  const warnings = countActiveFindings(microResults, "warning", session);
  if (blockers > 0) return { score: 1, label: "High risk", color: "text-rose-400" };
  if (!gate.ready) return { score: 2, label: "In progress", color: "text-amber-300" };
  if (warnings > 3) return { score: 3, label: "Review carefully", color: "text-amber-200" };
  if (warnings > 0) return { score: 4, label: "Likely safe", color: "text-emerald-300" };
  return { score: 5, label: "Safe to merge", color: "text-emerald-400" };
}

function cyToolbar(targetId, badge = "") {
  return `<div class="diagram-toolbar flex flex-wrap items-center gap-1.5">
    <span class="cedar-label mb-0">View</span>
    <button type="button" class="diagram-tool-btn" data-cy-action="in" data-cy-target="${targetId}" title="Zoom in">+</button>
    <button type="button" class="diagram-tool-btn" data-cy-action="out" data-cy-target="${targetId}" title="Zoom out">−</button>
    <button type="button" class="diagram-tool-btn" data-cy-action="fit" data-cy-target="${targetId}" title="Fit">Fit</button>
    ${badge}
  </div>`;
}

/**
 * @param {Array<{ componentId: string, componentName: string, status: string, sliceNumber: number, classNames?: string[] }>} slices
 */
function renderDiagramSliceBadges(slices) {
  if (!slices.length) return "";
  const dots = slices
    .map((r) => {
      const v = sliceStatusVisual(r.status);
      const n = r.sliceNumber ?? 0;
      const classes = (r.classNames ?? []).filter(Boolean);
      const classHint = classes.length ? classes.join(", ") : String(r.componentName ?? r.componentId ?? "").trim();
      const title = classHint ? `${classHint} · slice #${n}` : `slice #${n}`;
      return `<button type="button" class="cedar-diagram-slice-badge" data-jump-slice="${escapeHtml(r.componentId)}"
        style="border-color:${v.border}44"
        title="${escapeHtml(title)}"
        aria-label="Slice ${n}: ${escapeHtml(classHint || r.componentId)}">
        ${renderSliceStatusDot(r.status)}
        ${renderSliceIndexLabel(n, r.status)}
      </button>`;
    })
    .join("");
  return `<div class="cedar-diagram-slice-badges flex flex-wrap items-center gap-1.5" role="list" aria-label="Micro slices in this PR">${dots}</div>`;
}

/**
 * @param {{ view: string, label: string, id: string, aria: string, first?: boolean }} spec
 * @param {string} sliceBadgesHtml
 */
function completeLayoutMermaidArticle(spec, sliceBadgesHtml) {
  const mt = spec.first ? "" : " mt-8";
  return `<article class="cedar-layout-view cedar-architecture-read-panel${mt} w-full" data-layout-view="${escapeHtml(spec.view)}" data-diagram-wrap>
              <div class="architecture-read-mermaid-head mb-2 flex flex-wrap items-center justify-between gap-2">
                <p class="cedar-label mb-0">${escapeHtml(spec.label)}</p>
                ${architectureDiagramToolbar(spec.id, sliceBadgesHtml)}
              </div>
              <div class="cedar-cy-host diagram-overview-read diagram-complete-layout diagram-stage-canvas cedar-mermaid-scroll">
                <div id="${escapeHtml(spec.id)}" class="cedar-mermaid-source m-0" role="img" aria-label="${escapeHtml(spec.aria)}"></div>
              </div>
            </article>`;
}

function architectureDiagramToolbar(targetId, sliceBadgesHtml = "") {
  const id = escapeHtml(targetId);
  return `<div class="diagram-toolbar flex flex-wrap items-center gap-1.5" data-diagram-toolbar>
    ${sliceBadgesHtml}
    <span class="cedar-label mb-0">View</span>
    <button type="button" class="diagram-tool-btn" data-cy-action="in" data-cy-target="${id}" title="Zoom in">+</button>
    <button type="button" class="diagram-tool-btn" data-cy-action="out" data-cy-target="${id}" title="Zoom out">−</button>
    <button type="button" class="diagram-tool-btn" data-cy-action="fit" data-cy-target="${id}" title="Fit">Fit</button>
    <button type="button" class="diagram-tool-btn" data-diagram-action="collapse" title="Collapse diagram" aria-expanded="true">▾</button>
    <button type="button" class="diagram-tool-btn" data-diagram-action="maximize" title="Maximize panel" aria-pressed="false">⤢</button>
  </div>`;
}

/**
 * @param {string[]} activeSliceIds
 */
function renderPrLayerStack(activeSliceIds) {
  const active = new Set(activeSliceIds);
  const layers = ARCHITECTURE_LAYER_STACK.filter((l) => active.has(l.id));
  if (!layers.length) return "";
  const items = layers
    .map((layer) => {
      const accent = layerAccent(layer.id);
      return `<li class="cedar-layer-chip is-active" style="border-color:${accent.stroke};background:linear-gradient(135deg, ${accent.fill}88 0%, #0a0a0a44 100%)"><span class="cedar-layer-chip-label" style="color:${accent.text}">${escapeHtml(layer.label)}</span><span class="cedar-layer-chip-hint">${escapeHtml(layer.hint)}</span></li>`;
    })
    .join("");
  return `<div class="cedar-layer-stack mt-4" aria-label="${escapeHtml(ARCHITECTURE_MODEL_LABEL)}">
    <p class="cedar-label mb-2">Layers in this PR</p>
    <ol class="cedar-layer-stack-list">${items}</ol>
  </div>`;
}

function virtualPrLabel(target, pull, componentId, index, total) {
  const repo = target?.owner && target?.repo ? `${target.owner}/${target.repo}` : "repository";
  return {
    id: `vpr-${pull.number}-${componentId}`,
    title: `Virtual micro-PR ${index} of ${total}`,
    slug: `${repo}#${pull.number} · slice \`${componentId}\``,
  };
}

/**
 * @param {ParentNode} root
 * @param {"architecture" | "slices"} [mainTab]
 */
function activateReviewMainTab(root, mainTab = "architecture") {
  root.querySelectorAll("[data-review-tab]").forEach((btn) => {
    if (!(btn instanceof HTMLElement)) return;
    const on = btn.getAttribute("data-review-tab") === mainTab;
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-selected", on ? "true" : "false");
  });
  root.querySelectorAll("[data-review-panel]").forEach((panel) => {
    if (!(panel instanceof HTMLElement)) return;
    panel.hidden = panel.getAttribute("data-review-panel") !== mainTab;
  });
  const layout = root.querySelector(".cedar-review-layout");
  if (layout instanceof HTMLElement) {
    layout.classList.toggle("cedar-review-slices-focus", mainTab === "slices");
  }
  if (mainTab === "slices") {
    requestAnimationFrame(() => {
      const shell = root.querySelector(".cedar-slices-shell");
      if (shell instanceof HTMLElement) {
        applySliceRailWidth(shell, readStoredSliceRailWidth());
        window.dispatchEvent(new Event("resize"));
      }
    });
  }
}

const SLICE_RAIL_COLLAPSED_KEY = "cedar.sliceRailCollapsed";

/**
 * @param {ParentNode} root
 */
function wireDiffFocusToggles(root) {
  const shell = root.querySelector(".cedar-slices-shell");
  const layout = root.querySelector(".cedar-review-layout");
  if (!(shell instanceof HTMLElement) || !(layout instanceof HTMLElement)) return;

  const stored = sessionStorage.getItem(SLICE_RAIL_COLLAPSED_KEY);
  const collapsed = stored === null ? true : stored === "true";
  shell.classList.toggle("cedar-slice-rail-collapsed", collapsed);

  root.querySelectorAll("[data-toggle-slice-rail]").forEach((btn) => {
    if (btn.dataset.wiredFocus) return;
    btn.dataset.wiredFocus = "1";
    btn.addEventListener("click", () => {
      const isCollapsed = shell.classList.toggle("cedar-slice-rail-collapsed");
      sessionStorage.setItem(SLICE_RAIL_COLLAPSED_KEY, isCollapsed ? "true" : "false");
      const label = btn.querySelector("[data-toggle-label]");
      if (label instanceof HTMLElement) {
        label.textContent = isCollapsed ? "Show slices" : "Hide slices";
      }
      btn.setAttribute("aria-pressed", isCollapsed ? "true" : "false");
      window.dispatchEvent(new Event("resize"));
    });
    const label = btn.querySelector("[data-toggle-label]");
    if (label instanceof HTMLElement) {
      label.textContent = shell.classList.contains("cedar-slice-rail-collapsed") ? "Show slices" : "Hide slices";
    }
  });

  root.querySelectorAll("[data-toggle-pipeline-rail]").forEach((btn) => {
    if (btn.dataset.wiredFocus) return;
    btn.dataset.wiredFocus = "1";
    btn.addEventListener("click", () => {
      const expanded = layout.classList.toggle("cedar-pipeline-rail-expanded");
      const label = btn.querySelector("[data-toggle-label]");
      if (label instanceof HTMLElement) {
        label.textContent = expanded ? "Hide pipeline" : "Show pipeline";
      }
      btn.setAttribute("aria-pressed", expanded ? "true" : "false");
      window.dispatchEvent(new Event("resize"));
    });
    const label = btn.querySelector("[data-toggle-label]");
    if (label instanceof HTMLElement) {
      label.textContent = layout.classList.contains("cedar-pipeline-rail-expanded")
        ? "Hide pipeline"
        : "Show pipeline";
    }
  });

  root.querySelectorAll("[data-toggle-slice-rail]").forEach((btn) => {
    btn.setAttribute("aria-pressed", shell.classList.contains("cedar-slice-rail-collapsed") ? "true" : "false");
  });
}

/**
 * @param {ParentNode} root
 * @param {string} componentId
 */
function activateSliceTab(root, componentId) {
  if (!componentId) return;
  activateReviewMainTab(root, "slices");
  root.querySelectorAll("[data-slice-tab]").forEach((btn) => {
    if (!(btn instanceof HTMLElement)) return;
    const on = btn.getAttribute("data-slice-tab") === componentId;
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-selected", on ? "true" : "false");
    if (on) btn.scrollIntoView({ block: "nearest", inline: "nearest" });
  });
  root.querySelectorAll("[data-slice-panel]").forEach((panel) => {
    if (!(panel instanceof HTMLElement)) return;
    panel.hidden = panel.getAttribute("data-slice-panel") !== componentId;
  });
  root.querySelectorAll("[data-scroll-slice]").forEach((btn) => {
    if (!(btn instanceof HTMLElement)) return;
    btn.classList.toggle(
      "is-active",
      btn.getAttribute("data-scroll-slice") === componentId
    );
  });
}

/**
 * @param {ParentNode} root
 */
function wireSliceKeyboardNav(root) {
  if (root instanceof HTMLElement && root.dataset.wiredSliceKeys) return;
  if (root instanceof HTMLElement) root.dataset.wiredSliceKeys = "1";

  const sliceIds = [...root.querySelectorAll("[data-slice-tab]")]
    .map((el) => el.getAttribute("data-slice-tab"))
    .filter(Boolean);

  document.addEventListener("keydown", (ev) => {
    if (ev.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName)) return;
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;

    const slicesPanel = root.querySelector('[data-review-panel="slices"]');
    if (slicesPanel?.hidden) return;

    const active = root.querySelector("[data-slice-tab].is-active");
    const current = active?.getAttribute("data-slice-tab");
    const idx = current ? sliceIds.indexOf(current) : 0;
    if (idx < 0) return;

    if (ev.key === "[" && idx > 0) {
      ev.preventDefault();
      activateSliceTab(root, sliceIds[idx - 1]);
    } else if (ev.key === "]" && idx < sliceIds.length - 1) {
      ev.preventDefault();
      activateSliceTab(root, sliceIds[idx + 1]);
    }
  });
}

const SIDEBAR_WIDTH_KEY = "cedar.reviewSidebarWidthPx";
const SIDEBAR_WIDTH_DEFAULT = 200;
const SIDEBAR_WIDTH_MIN = 160;
const SIDEBAR_WIDTH_MAX = 360;

const SLICE_RAIL_WIDTH_KEY = "cedar.sliceRailWidthPx";
const SLICE_RAIL_DEFAULT = 148;
const SLICE_RAIL_MIN = 108;
const SLICE_RAIL_MAX = 320;

/**
 * @param {HTMLElement | null | undefined} layout
 */
function readStoredSidebarWidth() {
  const raw = localStorage.getItem(SIDEBAR_WIDTH_KEY);
  const n = raw ? Number(raw) : NaN;
  if (Number.isFinite(n)) return Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, n));
  return SIDEBAR_WIDTH_DEFAULT;
}

/**
 * @param {HTMLElement | null | undefined} layout
 */
function applySidebarWidth(layout, widthPx) {
  if (!layout) return;
  layout.style.setProperty("--cedar-sidebar-width", `${widthPx}px`);
}

/**
 * @param {ParentNode} root
 */
function wireReviewLayoutResize(root) {
  const layout = root.querySelector(".cedar-review-layout");
  const splitter = root.querySelector("[data-review-splitter]");
  const sidebar = root.querySelector(".cedar-review-sidebar");
  if (!(layout instanceof HTMLElement) || !(splitter instanceof HTMLElement)) return;

  applySidebarWidth(layout, readStoredSidebarWidth());

  if (splitter.dataset.wiredSplitter) return;
  splitter.dataset.wiredSplitter = "1";

  const notifyMainResized = () => {
    window.dispatchEvent(new Event("resize"));
  };

  splitter.addEventListener("dblclick", () => {
    applySidebarWidth(layout, SIDEBAR_WIDTH_DEFAULT);
    localStorage.removeItem(SIDEBAR_WIDTH_KEY);
    notifyMainResized();
  });

  splitter.addEventListener("pointerdown", (ev) => {
    if (!window.matchMedia("(min-width: 1024px)").matches) return;
    ev.preventDefault();
    splitter.setPointerCapture(ev.pointerId);
    document.body.classList.add("cedar-is-resizing-review");
    const startX = ev.clientX;
    const startW =
      sidebar instanceof HTMLElement ? sidebar.getBoundingClientRect().width : readStoredSidebarWidth();

    const onMove = (moveEv) => {
      const next = Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, startW + (moveEv.clientX - startX)));
      applySidebarWidth(layout, next);
      notifyMainResized();
    };

    const onUp = (upEv) => {
      splitter.releasePointerCapture(upEv.pointerId);
      document.body.classList.remove("cedar-is-resizing-review");
      splitter.removeEventListener("pointermove", onMove);
      splitter.removeEventListener("pointerup", onUp);
      splitter.removeEventListener("pointercancel", onUp);
      if (sidebar instanceof HTMLElement) {
        const px = Math.round(sidebar.getBoundingClientRect().width);
        localStorage.setItem(SIDEBAR_WIDTH_KEY, String(px));
      }
    };

    splitter.addEventListener("pointermove", onMove);
    splitter.addEventListener("pointerup", onUp);
    splitter.addEventListener("pointercancel", onUp);
  });

  splitter.addEventListener("keydown", (ev) => {
    if (!window.matchMedia("(min-width: 1024px)").matches) return;
    let delta = 0;
    if (ev.key === "ArrowLeft") delta = -16;
    else if (ev.key === "ArrowRight") delta = 16;
    else return;
    ev.preventDefault();
    const current = sidebar instanceof HTMLElement ? sidebar.getBoundingClientRect().width : SIDEBAR_WIDTH_DEFAULT;
    const next = Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, current + delta));
    applySidebarWidth(layout, next);
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(Math.round(next)));
    notifyMainResized();
  });
}

function readStoredSliceRailWidth() {
  const raw = localStorage.getItem(SLICE_RAIL_WIDTH_KEY);
  const n = raw ? Number(raw) : NaN;
  if (Number.isFinite(n)) return Math.min(SLICE_RAIL_MAX, Math.max(SLICE_RAIL_MIN, n));
  return SLICE_RAIL_DEFAULT;
}

/**
 * @param {HTMLElement | null | undefined} shell
 * @param {number} widthPx
 */
function applySliceRailWidth(shell, widthPx) {
  if (!shell) return;
  shell.style.setProperty("--cedar-slice-rail-width", `${widthPx}px`);
}

/**
 * @param {ParentNode} root
 */
function wireSliceRailResize(root) {
  const shell = root.querySelector(".cedar-slices-shell");
  const splitter = root.querySelector("[data-slice-splitter]");
  const rail = root.querySelector(".cedar-slice-rail-wrap");
  if (!(shell instanceof HTMLElement) || !(splitter instanceof HTMLElement)) return;

  applySliceRailWidth(shell, readStoredSliceRailWidth());

  if (splitter.dataset.wiredSliceSplit) return;
  splitter.dataset.wiredSliceSplit = "1";

  const notifyResized = () => window.dispatchEvent(new Event("resize"));

  splitter.addEventListener("dblclick", () => {
    applySliceRailWidth(shell, SLICE_RAIL_DEFAULT);
    localStorage.removeItem(SLICE_RAIL_WIDTH_KEY);
    notifyResized();
  });

  splitter.addEventListener("pointerdown", (ev) => {
    if (!window.matchMedia("(min-width: 1024px)").matches) return;
    ev.preventDefault();
    splitter.setPointerCapture(ev.pointerId);
    document.body.classList.add("cedar-is-resizing-slices");
    const startX = ev.clientX;
    const startW = rail instanceof HTMLElement ? rail.getBoundingClientRect().width : readStoredSliceRailWidth();

    const onMove = (moveEv) => {
      // Rail sits on the right: drag left → narrower rail → wider diff pane
      const next = Math.min(SLICE_RAIL_MAX, Math.max(SLICE_RAIL_MIN, startW - (moveEv.clientX - startX)));
      applySliceRailWidth(shell, next);
      notifyResized();
    };

    const onUp = (upEv) => {
      splitter.releasePointerCapture(upEv.pointerId);
      document.body.classList.remove("cedar-is-resizing-slices");
      splitter.removeEventListener("pointermove", onMove);
      splitter.removeEventListener("pointerup", onUp);
      splitter.removeEventListener("pointercancel", onUp);
      if (rail instanceof HTMLElement) {
        localStorage.setItem(SLICE_RAIL_WIDTH_KEY, String(Math.round(rail.getBoundingClientRect().width)));
      }
    };

    splitter.addEventListener("pointermove", onMove);
    splitter.addEventListener("pointerup", onUp);
    splitter.addEventListener("pointercancel", onUp);
  });

  splitter.addEventListener("keydown", (ev) => {
    if (!window.matchMedia("(min-width: 1024px)").matches) return;
    let delta = 0;
    if (ev.key === "ArrowLeft") delta = 16;
    else if (ev.key === "ArrowRight") delta = -16;
    else return;
    ev.preventDefault();
    const current = rail instanceof HTMLElement ? rail.getBoundingClientRect().width : SLICE_RAIL_DEFAULT;
    const next = Math.min(SLICE_RAIL_MAX, Math.max(SLICE_RAIL_MIN, current - delta));
    applySliceRailWidth(shell, next);
    localStorage.setItem(SLICE_RAIL_WIDTH_KEY, String(Math.round(next)));
    notifyResized();
  });
}

/**
 * @param {ParentNode} root
 * @param {"architecture" | "slices"} defaultMainTab
 */
/**
 * @param {ParentNode} root
 * @param {string} source
 * @param {() => void} [onRetry]
 */
/**
 * @param {ParentNode} root
 * @param {{ components?: string, flow?: string, events?: string }} views
 */
const COMPLETE_LAYOUT_MERMAID_SLOTS = [
  { key: "components", sel: "#cedar-mermaid-components" },
  { key: "flow", sel: "#cedar-mermaid-flow" },
  { key: "events", sel: "#cedar-mermaid-events" },
];

function wireCompleteLayoutViews(root, views) {
  if (!(root instanceof HTMLElement) || !views) return;
  const host = root.querySelector("#architecture-read-mermaid");
  if (!(host instanceof HTMLElement)) return;

  const allMounted = () =>
    COMPLETE_LAYOUT_MERMAID_SLOTS.every(({ key, sel }) => {
      const slot = host.querySelector(sel);
      return slot?.querySelector("svg") || !views[key]?.trim();
    });

  const draw = () => {
    const panel = root.querySelector("#cedar-review-panel-architecture");
    if (panel instanceof HTMLElement && panel.hidden) return;
    if (allMounted()) return;
    void mountCompleteLayoutViews(host, views).then((drew) => {
      if (!drew) showToast("Complete layout diagrams could not render.", "error");
      if (allMounted()) host.dataset.mermaidLayoutsMounted = "1";
      else delete host.dataset.mermaidLayoutsMounted;
      activateDiagramUx(host);
      wireArchitectureZoomControls(root);
      requestAnimationFrame(() => refitPanZoomDiagrams(host));
    });
  };

  wireArchitectureZoomControls(root);

  root.querySelectorAll("[data-review-tab]").forEach((btn) => {
    if (!(btn instanceof HTMLElement) || btn.dataset.wiredMermaidTab) return;
    btn.dataset.wiredMermaidTab = "1";
    btn.addEventListener("click", () => {
      if (btn.getAttribute("data-review-tab") === "architecture") {
        requestAnimationFrame(draw);
      }
    });
  });

  requestAnimationFrame(() => requestAnimationFrame(draw));
}

function wireReviewTabs(root, defaultMainTab) {
  root.querySelectorAll("[data-review-tab]").forEach((btn) => {
    if (btn.dataset.wiredReviewTab) return;
    btn.dataset.wiredReviewTab = "1";
    btn.addEventListener("click", () => {
      const tab = btn.getAttribute("data-review-tab");
      if (tab === "architecture" || tab === "slices") activateReviewMainTab(root, tab);
    });
  });
  activateReviewMainTab(root, defaultMainTab);
}

/**
 * @param {ParentNode} root
 * @param {string} [initialSliceId]
 */
function wireSliceTabs(root, initialSliceId = "") {
  root.querySelectorAll("[data-slice-tab]").forEach((btn) => {
    if (btn.dataset.wiredSliceTab) return;
    btn.dataset.wiredSliceTab = "1";
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-slice-tab");
      if (id) activateSliceTab(root, id);
    });
  });
  if (initialSliceId) activateSliceTab(root, initialSliceId);
}

function renderCursorReviewRollup(summary) {
  if (!summary?.enabled) return "";
  const sliceRows = (summary.slice?.bySlice ?? [])
    .map((s) => {
      const fail = s.error ? ' <span class="text-rose-400/90">· failed</span>' : "";
      return `<li class="flex justify-between gap-2 text-[9px] text-zinc-500">
        <span class="truncate">${escapeHtml(s.componentName)}${fail}</span>
        <span class="shrink-0 tabular-nums text-zinc-400">${s.count}</span>
      </li>`;
    })
    .join("");
  const macroCount = summary.macro?.findingCount ?? 0;
  return `<div class="mt-3 border-t border-white/[0.06] pt-3" aria-labelledby="cedar-cursor-rollup-heading">
    <p id="cedar-cursor-rollup-heading" class="text-[9px] font-medium uppercase tracking-wide text-zinc-500">Cursor findings</p>
    <p class="mt-1 text-[10px] font-medium text-zinc-300">${summary.totalFindings} on this PR</p>
    <p class="text-[9px] text-zinc-600">${summary.slice.total} slice · ${macroCount} macro</p>
    ${sliceRows ? `<ul class="mt-2 max-h-36 space-y-0.5 overflow-y-auto">${sliceRows}</ul>` : ""}
  </div>`;
}

function renderResults(container, data) {
  const { pull, gate, microPrs, microResults, macroReview, cursorReviewSummary, composite, breakouts, partition, process, target } = data;
  const macroReviewHtml = renderMacroReviewPanelHtml(macroReview);
  sliceApprovals = window.__cedarSession?.sliceApprovals ?? sliceApprovals;
  ensureFindingSession(window.__cedarSession);

  const confidence = mergeConfidence(gate, microResults);
  const touched = microResults.filter((r) => r.status !== "skipped");
  const approvedCount = touched.filter((r) => sliceApprovals.has(r.componentId)).length;
  const allSlicesApproved = touched.length > 0 && approvedCount === touched.length;
  const canApprovePr = gate.ready && allSlicesApproved;
  const approvePct = touched.length ? Math.round((approvedCount / touched.length) * 100) : 0;
  const sliceTotal = touched.length || microResults.length;

  const sidebarSlices = microResults
    .filter((r) => r.status !== "skipped")
    .map((r, i) => {
      const micro = microPrs.find((m) => m.componentId === r.componentId);
      const approved = sliceApprovals.has(r.componentId);
      const vpr = virtualPrLabel(target, pull, r.componentId, i + 1, sliceTotal);
      return `
        <button type="button" data-scroll-slice="${escapeHtml(r.componentId)}"
          class="cedar-nav-item cedar-nav-item-stack${i === 0 ? " is-active" : ""}"
          title="${escapeHtml(r.componentName)}">
          <span class="cedar-nav-item-row">
            ${renderSliceIndexLabel(i + 1, r.status, false)}
            ${renderSliceStatusDot(r.status)}
            <span class="cedar-nav-item-label">${escapeHtml(r.componentName)}</span>
            ${approved ? '<span class="cedar-nav-item-check">✓</span>' : ""}
          </span>
          <span class="cedar-nav-item-meta">${escapeHtml(vpr.id)} · ${micro?.fileCount ?? r.filesReviewed} files</span>
        </button>`;
    })
    .join("");

  const processList = (process ?? [])
    .map((step, i) => {
      const done = step.status === "done";
      const blocked = step.status === "blocked";
      const skipped = step.status === "skipped";
      return `
        <li class="flex gap-2 text-[10px] leading-snug">
          <span class="mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[9px] font-semibold ${
            done
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
              : blocked
                ? "border-rose-500/40 text-rose-300"
                : skipped
                  ? "border-white/[0.06] text-zinc-600"
                  : "border-white/10 text-zinc-500"
          }">${i + 1}</span>
          <span class="min-w-0">
            <span class="font-medium text-zinc-200">${escapeHtml(step.label)}</span>
            <span class="block text-[9px] text-zinc-600">${escapeHtml(step.detail ?? step.status)}</span>
          </span>
        </li>`;
    })
    .join("");

  const archSliceCount = microPrs.filter((m) => (m.files?.length ?? m.fileCount ?? 0) > 0).length;
  const diagramMicroPrs = microPrs
    .filter((m) => (m.files?.length ?? m.fileCount ?? 0) > 0)
    .map((m) => ({
      componentId: m.componentId,
      componentName: m.componentName,
      additions: m.additions ?? 0,
      deletions: m.deletions ?? 0,
      dependsOn: m.dependsOn ?? [],
      files: (m.files ?? []).map((f) => ({
        filename: f.path ?? f.filename,
        additions: f.additions ?? 0,
        deletions: f.deletions ?? 0,
      })),
    }));
  let diagramMermaid = breakouts?.diagramMermaid ?? "";
  if (!diagramMermaid.trim() && diagramMicroPrs.length) {
    diagramMermaid = buildArchitectureDiagramMermaid(
      diagramMicroPrs,
      breakouts,
      { number: pull.number, title: pull.title },
      { owner: target?.owner, repo: target?.repo }
    );
  }
  const activeSlicesForDiagram = microResults.filter((r) => r.status !== "skipped");
  const sliceNumberById = Object.fromEntries(
    activeSlicesForDiagram.map((r, i) => [normalizeSliceId(r.componentId), i + 1])
  );
  const archLayersForBadges = diagramMicroPrs.length
    ? buildPrArchitectureLayers(diagramMicroPrs, breakouts)
    : [];
  const classNamesBySlice = new Map(archLayersForBadges.map((l) => [l.id, l.types ?? []]));

  let layoutViews = breakouts?.diagramLayoutViews ?? null;
  if (!layoutViews && diagramMicroPrs.length) {
    layoutViews = buildCompleteLayoutViews(
      diagramMicroPrs,
      breakouts,
      { number: pull.number, title: pull.title },
      { owner: target?.owner, repo: target?.repo },
      sliceNumberById
    );
  }
  const hasLayoutViews = Boolean(
    layoutViews &&
      (layoutViews.components?.trim() || layoutViews.flow?.trim() || layoutViews.events?.trim())
  );
  const showArchitectureSection = archSliceCount > 0 || hasLayoutViews;
  const architectureReadSummary = (
    breakouts?.architectureVisual?.summary ??
    breakouts?.diagramGraph?.meta?.visualSummary ??
    ""
  ).trim();
  const architectureReadNotes =
    breakouts?.architectureVisual?.conceptualNotes ?? breakouts?.diagramGraph?.meta?.conceptualNotes ?? [];
  const activeArchitectureIds = microPrs
    .filter((m) => (m.files?.length ?? m.fileCount ?? 0) > 0)
    .map((m) => m.componentId);
  const prLayerStackHtml = renderPrLayerStack(activeArchitectureIds);

  const showArchitectureRead =
    showArchitectureSection ||
    architectureReadSummary ||
    architectureReadNotes.length ||
    Boolean(composite);

  const activeSlices = activeSlicesForDiagram;
  const firstSliceId = activeSlices[0]?.componentId ?? "";
  const hasArchitectureContent = Boolean(breakouts?.architectureSummary) || showArchitectureRead;
  const defaultMainTab = hasArchitectureContent ? "architecture" : "slices";
  const diagramSliceBadges = renderDiagramSliceBadges(
    activeSlices.map((r, i) => {
      const id = normalizeSliceId(r.componentId);
      return {
        componentId: r.componentId,
        componentName: microPrs.find((m) => m.componentId === r.componentId)?.componentName ?? r.componentName,
        status: r.status,
        sliceNumber: sliceNumberById[id] ?? i + 1,
        classNames: classNamesBySlice.get(id) ?? [],
      };
    })
  );

  const sliceTabBar = activeSlices
    .map((r, i) => {
      const approved = sliceApprovals.has(r.componentId);
      const active = i === 0;
      return `<button type="button" role="tab" class="cedar-nav-item cedar-slice-tab${active ? " is-active" : ""}"
        data-slice-tab="${escapeHtml(r.componentId)}" aria-selected="${active ? "true" : "false"}"
        title="${escapeHtml(r.componentName)}">
        ${renderSliceIndexLabel(i + 1, r.status, false)}
        ${renderSliceStatusDot(r.status)}
        <span class="cedar-nav-item-label">${escapeHtml(r.componentName)}</span>
        ${approved ? '<span class="cedar-nav-item-check">✓</span>' : ""}
      </button>`;
    })
    .join("");

  const slicePanels = activeSlices
    .map((r, i) => {
      const micro = microPrs.find((m) => m.componentId === r.componentId);
      const rationale = micro?.rationale ?? micro?.description;
      const session = window.__cedarSession;
      const { html: findings, activeCount } = buildFindingsListHtml(r, session);
      const cursorCount = (r.reviewComments ?? []).length;
      const activeFindings = findingsForSlice(r.componentId, r).filter(
        (f, fi) => !isFindingIgnored(findingKey(r.componentId, f, fi))
      );
      const blockers = activeFindings.filter((f) => f.severity === "blocker").length;
      const warnings = activeFindings.filter((f) => f.severity === "warning").length;
      const approved = sliceApprovals.has(r.componentId);
      const vpr = virtualPrLabel(target, pull, r.componentId, i + 1, sliceTotal);
      const fileList = micro?.files ?? [];

      return `
        <article id="slice-${escapeHtml(r.componentId)}" class="cedar-slice-panel" data-slice-panel="${escapeHtml(r.componentId)}" data-virtual-pr="${escapeHtml(vpr.id)}"${
          i === 0 ? "" : " hidden"
        }>
          <div class="flex flex-wrap items-start justify-between gap-4">
            <div class="min-w-0 max-w-3xl">
              <p class="cedar-label">${escapeHtml(vpr.title)}</p>
              <h3 class="mt-2 text-sm font-semibold text-white">${escapeHtml(r.componentName)}</h3>
              <p class="mt-1 font-mono text-xs text-zinc-500">${escapeHtml(vpr.slug)}</p>
              <div class="mt-4 flex flex-wrap gap-2" data-slice-badges>
                ${renderSliceReviewBadge(r.status)}
                <span class="cedar-badge cedar-badge-muted">+${micro?.additions ?? 0} / −${micro?.deletions ?? 0}</span>
                <span class="cedar-badge cedar-badge-muted">${fileList.length} files</span>
                ${cursorCount ? `<span class="cedar-badge cedar-badge-ok text-[9px]">${cursorCount} Cursor</span>` : ""}
                ${blockers ? `<span data-slice-blockers class="cedar-badge border-rose-500/30 bg-rose-500/10 text-rose-200">${blockers} blockers</span>` : ""}
                ${warnings ? `<span data-slice-warnings class="cedar-badge cedar-badge-warn">${warnings} warnings</span>` : ""}
                ${approved ? `<span class="cedar-badge cedar-badge-ok" data-slice-approved-badge>Approved</span>` : ""}
              </div>
              ${
                rationale
                  ? `<details class="mt-3">
                <summary class="cursor-pointer text-xs text-zinc-500 hover:text-zinc-300">Slice rationale</summary>
                <p class="mt-2 text-sm leading-relaxed text-zinc-300">${escapeHtml(rationale)}</p>
              </details>`
                  : ""
              }
            </div>
            <button type="button" data-approve-slice="${escapeHtml(r.componentId)}" data-component-name="${escapeHtml(r.componentName)}"
              ${approved ? "disabled" : ""}
              class="cedar-btn-signoff cedar-btn-slice${!approved ? " is-ready" : ""}${approved ? " is-done" : ""}"
              title="Mark this slice approved in Cedar (not sent to GitHub)">
              ${approved ? "Approved" : "Mark approved"}
            </button>
          </div>
          <div class="mt-4 space-y-4 border-t border-white/[0.06] pt-4">
            ${renderSliceFileReviews(fileList, pull.url)}
            <details class="group cedar-findings-panel"${activeCount ? " open" : ""}>
              <summary class="cursor-pointer text-xs font-medium text-zinc-500 hover:text-zinc-300">Cursor · slice findings${
                activeCount ? ` (${activeCount})` : ""
              }</summary>
              <div class="mt-3">${findings}</div>
            </details>
          </div>
        </article>`;
    })
    .join("");

  container.innerHTML = `
    <header class="cedar-pr-header cedar-glass mb-8">
      <div class="cedar-pr-header-id">
        <p class="cedar-pr-header-eyebrow">Pull request</p>
        <a href="${escapeHtml(pull.url)}" target="_blank" rel="noreferrer"
          class="cedar-pr-header-title" title="${escapeHtml(pull.title)}">${escapeHtml(pull.title)}</a>
        <p class="cedar-pr-header-meta">#${pull.number} · ${gate.headSha.slice(0, 7)} · ${escapeHtml(breakouts?.strategy ?? partition?.mode ?? "review")}</p>
      </div>
      <div class="cedar-pr-header-metrics">
        <div class="cedar-pr-stats" role="group" aria-label="Review progress">
          <p class="cedar-pr-stat-label">Confidence</p>
          <div class="cedar-pr-stat-divider" aria-hidden="true"></div>
          <p class="cedar-pr-stat-label">Slices approved</p>
          <p class="cedar-pr-stat-value tabular-nums ${confidence.color}">
            <span class="cedar-pr-stat-num">${confidence.score}</span><span class="cedar-pr-stat-denom">/5</span>
          </p>
          <p class="cedar-pr-stat-value tabular-nums text-zinc-100">
            <span class="cedar-pr-stat-num">${approvedCount}</span><span class="cedar-pr-stat-denom">/${touched.length}</span>
          </p>
          <p class="cedar-pr-stat-caption">${confidence.label}</p>
          <div class="cedar-pr-stat-progress" role="progressbar" aria-valuenow="${approvePct}" aria-valuemin="0" aria-valuemax="100" aria-label="Slices approved">
            <div class="cedar-pr-stat-progress-fill" style="width:${approvePct}%"></div>
          </div>
        </div>
        <button type="button" id="approve-pr-btn" ${canApprovePr ? "" : "disabled"} class="cedar-btn-signoff cedar-btn-approve-pr${canApprovePr ? " is-ready" : ""}"
          title="${canApprovePr ? "Approve the full pull request on GitHub" : "Mark every slice approved in Cedar first"}">
          Approve full PR
        </button>
      </div>
    </header>

    ${macroReviewHtml}

    <div class="cedar-review-layout">
      <aside class="cedar-review-sidebar space-y-2 lg:sticky lg:top-20 lg:self-start">
        <div class="cedar-review-rail-card">
          <p class="cedar-rail-label">Pipeline</p>
          <ul class="mt-2 space-y-2">${processList}</ul>
          ${renderCursorReviewRollup(cursorReviewSummary)}
        </div>
        <div class="cedar-review-rail-card cedar-review-rail-slices lg:hidden">
          <p class="cedar-rail-label cedar-rail-label-with-icon">${slicesIconSvg("cedar-rail-icon")}<span>Slices</span></p>
          <div class="mt-2 flex flex-col gap-0.5">${sidebarSlices}</div>
        </div>
        <div class="cedar-review-rail-card cedar-pr-chat-card">
          <p class="cedar-rail-label">Ask about this PR</p>
          <p class="cedar-pr-chat-hint mt-1 text-[9px] leading-snug text-zinc-600">Composer · ask mode · answers from review context</p>
          <div class="cedar-pr-chat-log mt-2" id="cedar-pr-chat-log" aria-live="polite" aria-relevant="additions"></div>
          <form class="cedar-pr-chat-form mt-2">
            <label class="sr-only" for="cedar-pr-chat-input">Question about this pull request</label>
            <textarea id="cedar-pr-chat-input" class="cedar-pr-chat-input" rows="5" maxlength="2000"
              placeholder="Architecture, slices, blockers, what changed…"></textarea>
            <button type="submit" class="cedar-pr-chat-send cedar-btn-secondary mt-2 w-full text-xs">Send</button>
          </form>
          <p class="cedar-pr-chat-status mt-2 text-[9px] text-zinc-500" hidden></p>
        </div>
        <p class="rounded-lg border px-3 py-2 text-xs ${gate.ready ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-300/90" : "border-amber-500/20 bg-amber-500/5 text-amber-200/90"}">
          ${gate.ready ? "Composite review is ready." : escapeHtml(gate.blockedReason ?? "Composite pending.")}
        </p>
        <button type="button" id="new-review-btn" class="cedar-btn-secondary w-full text-xs">New review</button>
      </aside>
      <div
        class="cedar-col-splitter cedar-review-splitter"
        data-review-splitter
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        tabindex="0"
        title="Drag to resize · double-click to reset"
      ></div>

      <div class="cedar-review-main cedar-review-stage min-w-0">
        <header class="cedar-review-tabs-head">
          <div class="cedar-main-tablist" role="tablist" aria-label="Review views">
            <button type="button" role="tab" class="cedar-main-tab${defaultMainTab === "architecture" ? " is-active" : ""}" data-review-tab="architecture"
              aria-selected="${defaultMainTab === "architecture" ? "true" : "false"}">
              ${architectureIconSvg("cedar-main-tab-icon")}
              <span>Architecture</span>
            </button>
            <button type="button" role="tab" class="cedar-main-tab${defaultMainTab === "slices" ? " is-active" : ""}" data-review-tab="slices"
              aria-selected="${defaultMainTab === "slices" ? "true" : "false"}">
              ${slicesIconSvg("cedar-main-tab-icon")}
              <span>Slices</span>
              <span class="cedar-main-tab-count">${touched.length}</span>
            </button>
          </div>
        </header>

        <div class="cedar-main-tabpanels">
          <div role="tabpanel" class="cedar-main-tabpanel space-y-6" data-review-panel="architecture" id="cedar-review-panel-architecture"${
            defaultMainTab === "slices" ? " hidden" : ""
          }>
            ${
              breakouts?.architectureSummary
                ? `<section class="cedar-glass-subtle cedar-architecture-summary px-5 py-4">
            <p class="cedar-label">Summary · ${escapeHtml(String(breakouts.strategy ?? partition?.mode ?? ""))}</p>
            <p class="mt-2 text-sm leading-relaxed text-zinc-400">${escapeHtml(breakouts.architectureSummary)}</p>
          </section>`
                : ""
            }
            ${
              showArchitectureRead
                ? `<section class="cedar-glass p-6" id="architecture-read">
            <h2 class="text-sm font-semibold text-white">Architecture read</h2>
            ${prLayerStackHtml}
            ${
              architectureReadSummary
                ? `<p class="mt-4 max-w-3xl text-base leading-relaxed text-zinc-200">${escapeHtml(architectureReadSummary)}</p>`
                : !composite && !hasLayoutViews && archSliceCount === 0
                  ? `<p class="mt-4 text-sm text-zinc-500">Cursor can supply a one-paragraph visual read when <span class="font-mono text-zinc-600">CEDAR_AI_DIAGRAM</span> is on; the full narrative appears after every slice passes.</p>`
                  : ""
            }
            ${
              architectureReadNotes.length
                ? `<ul class="mt-4 list-inside list-disc space-y-1 text-sm text-zinc-400">${architectureReadNotes
                    .map((n) => `<li>${escapeHtml(n)}</li>`)
                    .join("")}</ul>`
                : ""
            }
            ${
              archSliceCount > 0
                ? `<div class="mt-6" id="architecture-read-overview">
            <div class="architecture-read-mermaid-head mb-2 flex flex-wrap items-center justify-between gap-2">
              <p class="cedar-label mb-0">Overview · virtual micro-PRs</p>
              ${cyToolbar(
                "cedar-cy-slices",
                `<span class="cedar-badge cedar-badge-muted">${archSliceCount} slices · ${
                  breakouts?.diagramVisualSource === "cursor" ? "Cursor" : "Minimal"
                }</span>`
              )}
            </div>
            <div id="cedar-cy-slices" class="cedar-cy-host diagram-overview-read" role="img" aria-label="Virtual micro-PR overview"></div>
          </div>`
                : ""
            }
            ${
              hasLayoutViews
                ? `<div class="mt-6 w-full min-w-0" id="architecture-read-layout" aria-labelledby="complete-layout-heading">
            <p id="complete-layout-heading" class="cedar-label mb-4">Complete layout</p>
            <div class="cedar-complete-layout-views w-full min-w-0" id="architecture-read-mermaid">
            ${[
              {
                view: "uml",
                label: "UML · components",
                id: "cedar-mermaid-components",
                aria: "UML components class diagram",
                first: true,
              },
              { view: "flow", label: "Flow", id: "cedar-mermaid-flow", aria: "Request flow diagram" },
              { view: "events", label: "Events", id: "cedar-mermaid-events", aria: "Domain events sequence diagram" },
            ]
              .map((spec) => completeLayoutMermaidArticle(spec, diagramSliceBadges))
              .join("")}
            </div>
          </div>`
                : ""
            }
          </section>`
                : !breakouts?.architectureSummary
                  ? `<p class="text-sm text-zinc-500">Architecture narrative and diagrams appear once partitioning finishes.</p>`
                  : ""
            }
          </div>

          <div role="tabpanel" class="cedar-main-tabpanel cedar-slices-tabpanel" data-review-panel="slices" id="cedar-review-panel-slices"${
            defaultMainTab === "architecture" ? " hidden" : ""
          }>
            <div class="cedar-diff-focus-bar">
              <button type="button" class="cedar-diff-focus-btn" data-toggle-pipeline-rail aria-pressed="false">
                <span data-toggle-label>Hide pipeline</span>
              </button>
              <button type="button" class="cedar-diff-focus-btn" data-toggle-slice-rail aria-pressed="false">
                <span data-toggle-label>Hide slices</span>
              </button>
            </div>
            <div class="cedar-slices-shell">
              <div class="cedar-slice-panels cedar-slice-review-pane min-w-0 flex-1">${slicePanels}</div>
              <div
                class="cedar-col-splitter cedar-slice-splitter"
                data-slice-splitter
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize review pane"
                tabindex="0"
                title="Drag left for more diff space · double-click reset"
              ></div>
              <nav class="cedar-slice-rail-wrap cedar-slice-rail-right" aria-label="Micro slices">
                <p class="cedar-rail-label cedar-rail-label-with-icon mb-2 px-0.5">${slicesIconSvg("cedar-rail-icon")}<span>Slices</span></p>
                <p class="cedar-rail-hint mb-2 hidden lg:block">drag grip left · [ ] keys</p>
                <div class="cedar-slice-rail cedar-slice-tablist" role="tablist">${sliceTabBar}</div>
              </nav>
            </div>
          </div>
        </div>

        <p id="approve-status" class="mt-6 hidden text-sm font-medium text-emerald-400"></p>
      </div>
    </div>
  `;

  container.querySelectorAll("[data-scroll-slice], [data-jump-slice]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-scroll-slice") ?? btn.getAttribute("data-jump-slice");
      if (id) activateSliceTab(container, id);
    });
  });

  wireReviewTabs(container, defaultMainTab);
  wireSliceTabs(container, firstSliceId);
  wireSliceKeyboardNav(container);
  wireReviewLayoutResize(container);
  wireSliceRailResize(container);
  wireDiffFocusToggles(container);
  const layout = container.querySelector(".cedar-review-layout");
  if (layout instanceof HTMLElement && defaultMainTab === "slices") {
    layout.classList.add("cedar-review-slices-focus");
  }

  document.getElementById("new-review-btn")?.addEventListener("click", () => {
    document.getElementById("hero")?.classList.remove("hidden");
    document.getElementById("main-stage")?.classList.remove("cedar-review-wide");
    container.classList.add("hidden");
    container.innerHTML = "";
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  if (hasLayoutViews && layoutViews) {
    wireCompleteLayoutViews(container, layoutViews);
    wireDiagramResizeListeners(container);
  }

  if (archSliceCount > 0) {
    const graph =
      breakouts?.diagramGraph ??
      buildDiagramGraph(
        microPrs.map((m) => ({
          componentId: m.componentId,
          componentName: m.componentName,
          additions: m.additions,
          deletions: m.deletions,
          description: m.description,
          dependsOn: m.dependsOn ?? [],
          files: (m.files ?? []).map((f) => ({
            filename: f.path,
            additions: f.additions,
            deletions: f.deletions,
          })),
        })),
        breakouts,
        { number: pull.number, title: pull.title },
        { owner: target?.owner, repo: target?.repo }
      );
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const statusByLayerId = new Map(
          activeSlicesForDiagram.map((r) => [normalizeSliceId(r.componentId), r.status])
        );
        const drew = mountArchitectureGraphs(container, graph, statusByLayerId);
        if (!drew) showToast("Architecture diagram could not render.", "error");
      });
    });
  }

  wirePrChatSidebar(container, {
    getContext: () => buildPrChatContext(data),
    getToken: () => window.__cedarSession?.token,
  });

  finishReviewUi(container);
}

function wireMacroReviewPost(root) {
  const btn = root.querySelector("#post-macro-review-btn");
  if (!(btn instanceof HTMLButtonElement)) return;
  if (btn.dataset.wiredMacro) return;
  btn.dataset.wiredMacro = "1";
  btn.addEventListener("click", () => void postMacroReview());
}

async function postMacroReview() {
  const session = window.__cedarSession;
  const macro = session?.data?.macroReview;
  const btn = document.getElementById("post-macro-review-btn");
  if (!session || !macro?.body?.trim()) {
    showToast("No macro review text to post.", "error");
    return;
  }
  const prev = btn instanceof HTMLButtonElement ? btn.textContent : "";
  if (btn instanceof HTMLButtonElement) {
    btn.disabled = true;
    btn.textContent = "Posting…";
  }
  try {
    const res = await fetch("/api/macro-review/post", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prUrl: session.prUrl,
        token: session.token,
        owner: session.data.target?.owner,
        repo: session.data.target?.repo,
        pr: session.data.target?.pr,
        body: macro.body,
        event: macro.event ?? "COMMENT",
      }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? json.hint ?? "Post failed");
    showToast("Posted macro review on GitHub");
  } catch (err) {
    showToast(err instanceof Error ? err.message : String(err), "error");
  } finally {
    if (btn instanceof HTMLButtonElement) {
      btn.disabled = false;
      btn.textContent = prev || "Post PR comment";
    }
  }
}

function bindApproveHandlers(root) {
  root.querySelectorAll("[data-approve-slice]").forEach((btn) => {
    btn.addEventListener("click", () => void approveSlice(btn));
  });
  root.querySelector("#approve-pr-btn")?.addEventListener("click", () => void approveFullPr());
}

function approveSlice(btn) {
  const session = window.__cedarSession;
  if (!session) return;
  const componentId = btn.dataset.approveSlice;
  if (!componentId) return;

  session.sliceApprovals.add(componentId);
  showToast(`Marked approved · ${btn.dataset.componentName ?? componentId}`);
  patchSliceApprovalState(componentId);
}

async function approveFullPr() {
  const session = window.__cedarSession;
  if (!session) return;
  const btn = document.getElementById("approve-pr-btn");
  const status = document.getElementById("approve-status");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Approving…";
  }

  try {
    const res = await fetch("/api/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prUrl: session.prUrl,
        token: session.token,
        owner: session.data.target?.owner,
        repo: session.data.target?.repo,
        pr: session.data.target?.pr,
        scope: "pr",
        headSha: session.data.pull.headSha,
        event: "APPROVE",
      }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(githubApiErrorMessage(body, res.statusText));
    if (status) {
      status.textContent = `Approved on GitHub · review #${body.review?.id ?? ""}`;
      status.classList.remove("hidden");
    }
    if (btn) {
      btn.textContent =
        body.review?.state === "APPROVED" ? "Approved" : "Review posted";
    }
    showToast(
      body.hint ??
        (body.review?.state === "APPROVED"
          ? "Pull request approved on GitHub"
          : "Review posted on GitHub")
    );
  } catch (err) {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Approve full PR";
    }
    showToast(err instanceof Error ? err.message : String(err), "error");
  }
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}