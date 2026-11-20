import { prChatContextFromReport } from "../../src/pr-chat-context.js";

/**
 * @param {object | null} report
 */
export function buildPrChatContext(report) {
  if (!report) return null;
  try {
    return prChatContextFromReport(report);
  } catch {
    return null;
  }
}

/**
 * @param {ParentNode} root
 * @param {{ getContext: () => object | null, getToken?: () => string | undefined }} opts
 */
export function wirePrChatSidebar(root, opts) {
  const card = root.querySelector(".cedar-pr-chat-card");
  const form = root.querySelector(".cedar-pr-chat-form");
  const input = root.querySelector(".cedar-pr-chat-input");
  const log = root.querySelector(".cedar-pr-chat-log");
  const status = root.querySelector(".cedar-pr-chat-status");
  const sendBtn = root.querySelector(".cedar-pr-chat-send");
  if (!(form instanceof HTMLFormElement) || !(input instanceof HTMLTextAreaElement) || !(log instanceof HTMLElement)) {
    return;
  }

  /** @type {{ role: string, content: string }[]} */
  let history = [];

  const setBusy = (busy) => {
    if (sendBtn instanceof HTMLButtonElement) sendBtn.disabled = busy;
    input.disabled = busy;
    if (status instanceof HTMLElement) {
      status.textContent = busy ? "Thinking…" : "";
      status.hidden = !busy;
    }
  };

  const appendBubble = (role, text) => {
    const item = document.createElement("div");
    item.className = `cedar-pr-chat-bubble cedar-pr-chat-bubble-${role}`;
    const label = role === "user" ? "You" : "Cedar";
    item.innerHTML = `<p class="cedar-pr-chat-bubble-label">${label}</p><div class="cedar-pr-chat-bubble-body"></div>`;
    const body = item.querySelector(".cedar-pr-chat-bubble-body");
    if (body instanceof HTMLElement) body.textContent = text;
    log.appendChild(item);
    log.scrollTop = log.scrollHeight;
  };

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const question = input.value.trim();
    if (!question) return;
    const context = opts.getContext();
    if (!context) {
      if (status instanceof HTMLElement) {
        status.hidden = false;
        status.textContent = "Run a review first.";
      }
      return;
    }

    input.value = "";
    appendBubble("user", question);
    history.push({ role: "user", content: question });
    setBusy(true);

    try {
      const res = await fetch("/api/pr-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history,
          context,
          token: opts.getToken?.(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error ?? `Chat failed (${res.status})`);
      }
      const reply = String(data.reply ?? "").trim() || "(No response)";
      history.push({ role: "assistant", content: reply });
      appendBubble("assistant", reply);
      if (status instanceof HTMLElement && data.provider) {
        status.hidden = false;
        status.textContent = data.provider;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      appendBubble("assistant", msg);
    } finally {
      setBusy(false);
    }
  });
}