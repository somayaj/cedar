import { applyCursorBackgroundProgress, hideReviewProgressDock, setReviewProgress } from "./review-progress-ui.js";

/**
 * @param {object} payload
 * @param {(event: Record<string, unknown>) => void} onEvent
 */
export async function postCursorReviewStream(payload, onEvent) {
  const res = await fetch("/api/cursor-review/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(payload),
  });

  if (!res.ok && res.headers.get("content-type")?.includes("application/json")) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? res.statusText);
  }
  if (!res.body) throw new Error("Cursor review stream returned no body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let idx;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      for (const line of block.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const raw = line.slice(5).trim();
        if (!raw) continue;
        let event;
        try {
          event = JSON.parse(raw);
        } catch {
          continue;
        }
        onEvent(event);
        if (event.type === "error") {
          throw new Error(event.error ?? "Cursor review failed");
        }
      }
    }
  }
}

/**
 * @param {Record<string, unknown>} event
 * @param {() => void} refreshUi
 */
export function applyCursorBackgroundEvent(event, refreshUi) {
  if (!event || typeof event !== "object") return;
  const session = window.__cedarSession;
  if (!session?.data) return;

  applyCursorBackgroundProgress(/** @type {{ type?: string, completed?: number, total?: number, phase?: string }} */ (event));

  if (event.type === "cursor_macro" && event.macroReview != null) {
    session.data.macroReview = event.macroReview;
    if (event.cursorReviewSummary) session.data.cursorReviewSummary = event.cursorReviewSummary;
    refreshUi();
    return;
  }

  if (event.type === "cursor_slice" && event.componentId && event.microResult) {
    const id = String(event.componentId);
    const idx = session.data.microResults.findIndex((r) => r.componentId === id);
    if (idx >= 0) {
      session.data.microResults[idx] = { ...session.data.microResults[idx], ...event.microResult };
    }
    session.data.cursorReviewPending = true;
    refreshUi();
    return;
  }

  if (event.type === "cursor_done") {
    if (Array.isArray(event.microResults)) session.data.microResults = event.microResults;
    if (event.macroReview != null) session.data.macroReview = event.macroReview;
    if (event.cursorReviewSummary) session.data.cursorReviewSummary = event.cursorReviewSummary;
    session.data.cursorReviewPending = false;
    setReviewProgress(100, "Cursor review complete", "Macro + slice findings are ready.");
    hideReviewProgressDock({ delayMs: 3500 });
    refreshUi();
  }
}