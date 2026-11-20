/** @type {{ totalSlices: number, completedSlices: number, phase: string, incrementalSlices: boolean }} */
const state = {
  totalSlices: 0,
  completedSlices: 0,
  phase: "idle",
  incrementalSlices: false,
};

/** @type {{ pct: number, label: string, detail: string }} */
let lastProgress = { pct: 0, label: "Review", detail: "" };

const CURSOR_BG_START = 55;
const CURSOR_MACRO_SPAN = 12;
const CURSOR_SLICE_START = 67;
const CURSOR_SLICE_SPAN = 26;

/** @type {Record<string, number>} */
const PHASE_PCT = {
  fetch: 12,
  breakouts: 28,
  partition: 36,
  review: 52,
  "cursor-slices-skipped": 58,
  "cursor-slices": 75,
  macro: 92,
  "cursor-report": 98,
  done: 100,
};

/**
 * @param {number} pct
 * @param {string} label
 * @param {string} [detail]
 */
export function setReviewProgress(pct, label, detail) {
  const dock = document.getElementById("cedar-review-progress-dock");
  if (!dock) return;
  dock.hidden = false;
  const fill = document.getElementById("cedar-review-progress-fill");
  const labelEl = document.getElementById("cedar-review-progress-label");
  const detailEl = document.getElementById("cedar-review-progress-detail");
  const pctEl = document.getElementById("cedar-review-progress-pct");
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  if (fill instanceof HTMLElement) fill.style.width = `${clamped}%`;
  if (labelEl) labelEl.textContent = label;
  if (detailEl) detailEl.textContent = detail ?? "";
  if (pctEl) pctEl.textContent = `${clamped}%`;
  dock.setAttribute("aria-valuenow", String(clamped));
  lastProgress = { pct: clamped, label, detail: detail ?? "" };
}

/**
 * Re-apply last progress after DOM rebuild (e.g. renderResults).
 */
export function restoreReviewProgressDock() {
  const dock = document.getElementById("cedar-review-progress-dock");
  if (!dock || lastProgress.pct <= 0) return;
  dock.hidden = false;
  setReviewProgress(lastProgress.pct, lastProgress.label, lastProgress.detail);
}

/**
 * @param {number} completed
 * @param {number} total
 * @param {{ inFlight?: boolean }} [opts]
 */
function cursorMacroBackgroundPct(completed, total, inFlight) {
  const safeTotal = Math.max(1, total);
  let frac = completed / safeTotal;
  if (inFlight) frac = Math.min(1, (completed + 0.5) / safeTotal);
  return CURSOR_BG_START + frac * CURSOR_MACRO_SPAN;
}

function cursorSliceBackgroundPct(completed, total, opts) {
  const safeTotal = Math.max(1, total);
  let frac = completed / safeTotal;
  if (opts?.inFlight) frac = Math.min(1, (completed + 0.35) / safeTotal);
  return CURSOR_SLICE_START + frac * CURSOR_SLICE_SPAN;
}

/**
 * @param {string} detail
 */
function parseSliceIndexFromDetail(detail) {
  const m = String(detail).match(/\((\d+)\/(\d+)\)/);
  if (!m) return null;
  return { index: Number.parseInt(m[1], 10), total: Number.parseInt(m[2], 10) };
}

export function showReviewProgressDock() {
  const dock = document.getElementById("cedar-review-progress-dock");
  if (dock) dock.hidden = false;
}

/**
 * @param {{ delayMs?: number }} [opts]
 */
export function hideReviewProgressDock(opts) {
  const dock = document.getElementById("cedar-review-progress-dock");
  if (!dock) return;
  const hide = () => {
    dock.hidden = true;
    state.phase = "idle";
    state.totalSlices = 0;
    state.completedSlices = 0;
    state.incrementalSlices = false;
    lastProgress = { pct: 0, label: "Review", detail: "" };
  };
  if (opts?.delayMs) setTimeout(hide, opts.delayMs);
  else hide();
}

export function renderReviewProgressDockHtml() {
  return `<div id="cedar-review-progress-dock" class="cedar-review-progress-dock cedar-glass mb-5 px-4 py-3 sm:px-5" role="region" aria-label="Review progress"
    aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" hidden>
    <div class="flex flex-wrap items-center justify-between gap-2">
      <p id="cedar-review-progress-label" class="text-xs font-medium text-zinc-200">Review</p>
      <span id="cedar-review-progress-pct" class="font-mono text-[10px] tabular-nums text-zinc-500">0%</span>
    </div>
    <div class="cedar-review-progress-track mt-2" aria-hidden="true">
      <div id="cedar-review-progress-fill" class="cedar-review-progress-fill"></div>
    </div>
    <p id="cedar-review-progress-detail" class="mt-1.5 text-[10px] leading-snug text-zinc-500"></p>
  </div>`;
}

/**
 * @param {{ type?: string, id?: string, label?: string, status?: string, detail?: string }} event
 */
export function applyReviewProgressFromPhaseEvent(event) {
  if (event?.type !== "phase") return;
  const id = String(event.id ?? "");
  const label = String(event.label ?? "Working…");
  const detail = event.detail ? String(event.detail) : "";
  let pct = PHASE_PCT[id] ?? null;
  if (event.status === "running" && id === "fetch") pct = 6;
  if (event.status === "running" && id === "breakouts") pct = 18;
  if (event.status === "running" && id === "partition") pct = 32;
  if (event.status === "running" && id === "review") pct = 44;
  if (event.status === "running" && id === "cursor-slices") {
    const parsed = parseSliceIndexFromDetail(detail);
    if (parsed) {
      state.incrementalSlices = true;
      state.totalSlices = parsed.total;
      const inFlight = !/finding\(s\)/i.test(detail);
      const completed = inFlight ? Math.max(0, parsed.index - 1) : parsed.index;
      state.completedSlices = completed;
      pct = cursorSliceBackgroundPct(completed, parsed.total, { inFlight });
    } else if (state.incrementalSlices && state.totalSlices > 0) {
      pct = cursorSliceBackgroundPct(state.completedSlices, state.totalSlices);
    } else {
      pct = 62;
    }
  }
  if (event.status === "skipped" && id === "cursor-slices") pct = PHASE_PCT["cursor-slices-skipped"];
  if (event.status === "running" && id === "macro") {
    pct = state.incrementalSlices
      ? cursorMacroBackgroundPct(0, 1, true)
      : CURSOR_BG_START + CURSOR_MACRO_SPAN * 0.35;
  }
  if (event.status === "done" && id === "macro") {
    pct = CURSOR_SLICE_START;
  }
  if (event.status === "skipped" && id === "macro") pct = 58;
  if (event.status === "done" && id === "cursor-report") pct = 98;
  if (pct == null && event.status === "done") pct = PHASE_PCT[id] ?? undefined;
  if (pct != null) {
    if (
      state.incrementalSlices &&
      id === "cursor-slices" &&
      event.status === "running" &&
      lastProgress.pct > pct
    ) {
      /* keep slice ramp from cursor_progress / in-flight bumps */
    } else {
      setReviewProgress(pct, label, detail);
    }
    state.phase = id;
  }
  if (id === "cursor-slices" && event.status === "done") {
    if (state.totalSlices > 0) state.completedSlices = state.totalSlices;
  }
}

/**
 * @param {{ type?: string, completed?: number, total?: number, phase?: string }} event
 */
export function applyCursorBackgroundProgress(event) {
  if (event?.type !== "cursor_progress") return;
  const total = Number(event.total) || state.totalSlices || 1;
  const completed = Number(event.completed) || 0;
  const phase = event.phase === "macro" ? "macro" : "cursor-slices";
  state.incrementalSlices = true;
  state.totalSlices = total;
  state.completedSlices = completed;
  if (phase === "macro") {
    const inFlight = completed < total;
    const pct = cursorMacroBackgroundPct(completed, total, inFlight);
    const detail =
      typeof event.detail === "string" && event.detail
        ? event.detail
        : inFlight
          ? "Whole-PR themes first…"
          : "Macro review complete";
    setReviewProgress(pct, "Cursor · macro review (entire PR)", detail);
    return;
  }
  const inFlight = completed < total;
  const pct = cursorSliceBackgroundPct(completed, total, { inFlight });
  const detail =
    typeof event.detail === "string" && event.detail
      ? event.detail
      : `${completed} of ${total} slices${inFlight ? " · reviewing…" : ""}`;
  setReviewProgress(pct, "Cursor · slice review (background)", detail);
}