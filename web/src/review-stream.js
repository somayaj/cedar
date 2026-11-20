import { applyReviewProgressFromPhaseEvent } from "./review-progress-ui.js";

/**
 * @typedef {Record<string, unknown>} ReviewStreamEvent
 */

/**
 * @param {ReviewStreamEvent} event
 * @param {HTMLElement | null} statusEl
 * @param {HTMLElement | null} logEl
 */
export function applyReviewStreamEvent(event, statusEl, logEl) {
  if (!event || typeof event !== "object") return;
  applyReviewProgressFromPhaseEvent(/** @type {{ type?: string, id?: string, label?: string, status?: string, detail?: string }} */ (event));
  if (event.type === "phase" && statusEl) {
    const detail = event.detail ? ` · ${event.detail}` : "";
    const prefix =
      event.status === "done" ? "✓" : event.status === "skipped" ? "−" : "…";
    statusEl.textContent = `${prefix} ${event.label ?? event.id}${detail}`;
  }
  if (event.type === "activity" && statusEl && event.text) {
    statusEl.textContent = String(event.text);
  }
  if (event.type === "cursor_background" && statusEl) {
    statusEl.textContent = String(event.text ?? "Cursor review running in background…");
  }
  if (logEl && (event.type === "phase" || event.type === "activity")) {
    const line = document.createElement("li");
    line.className = "review-progress-line";
    const t = new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const body =
      event.type === "phase"
        ? `${event.label ?? event.id} (${event.status ?? "running"})${event.detail ? ` — ${event.detail}` : ""}`
        : String(event.text ?? "");
    line.textContent = `${t} ${body}`;
    logEl.appendChild(line);
    while (logEl.children.length > 80) {
      logEl.firstChild?.remove();
    }
    logEl.scrollTop = logEl.scrollHeight;
  }
}

/**
 * @param {object} payload
 * @param {(event: ReviewStreamEvent) => void} onEvent
 */
export async function postReviewStream(payload, onEvent) {
  const res = await fetch("/api/review/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(payload),
  });

  if (!res.ok && res.headers.get("content-type")?.includes("application/json")) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? res.statusText);
  }
  if (!res.body) throw new Error("Review stream returned no body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  /** @type {object | null} */
  let report = null;

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
        if (event.type === "done" && event.report) report = event.report;
        if (event.type === "error") {
          throw new Error(event.error ?? "Review failed");
        }
      }
    }
  }

  if (!report) throw new Error("Review finished without a result");
  return report;
}