import { aiChat, activeAiProvider, hasAiProvider } from "./ai-chat.js";
import { cursorApiKey } from "./ai-credentials.js";
import { cursorBridgeChat } from "./cursor-bridge-client.js";
import { prChatContextFromReport } from "./pr-chat-context.js";

export { prChatContextFromReport };

const MAX_CONTEXT_CHARS = 14_000;
const MAX_MESSAGES = 12;

/**
 * @param {object} context
 */
export function buildPrChatSystemPrompt(context) {
  const block = trimContextBlock(JSON.stringify(context, null, 0));
  return [
    "You help reviewers understand a GitHub pull request that Cedar already partitioned and reviewed.",
    "Answer only from the REVIEW CONTEXT below. If the context lacks an answer, say what is missing.",
    "Be concise (markdown OK). Do not invent files, slices, or findings not in context.",
    "Do not edit the repo or run commands.",
    "",
    "REVIEW CONTEXT:",
    block,
  ].join("\n");
}

/**
 * @param {{ role: string, content: string }[]} messages
 * @param {object} context
 */
export async function answerPrChatQuestion(messages, context) {
  if (!hasAiProvider()) {
    throw new Error("Set CURSOR_API_KEY (Composer) or OPENROUTER_API_KEY on the server");
  }

  const trimmed = messages
    .filter((m) => m?.role === "user" || m?.role === "assistant")
    .slice(-MAX_MESSAGES)
    .map((m) => ({
      role: m.role,
      content: String(m.content ?? "").trim().slice(0, 4000),
    }))
    .filter((m) => m.content);

  if (!trimmed.length || trimmed[trimmed.length - 1].role !== "user") {
    throw new Error("Last message must be a user question");
  }

  const system = buildPrChatSystemPrompt(context);
  const payload = {
    messages: [{ role: "system", content: system }, ...trimmed],
    maxTokens: 1400,
  };

  if (cursorApiKey() && process.env.CEDAR_CURSOR_BRIDGE !== "false") {
    return await cursorBridgeChat({ ...payload, mode: "ask" });
  }

  return await aiChat(payload);
}

export function prChatProviderLabel() {
  const p = activeAiProvider();
  if (p === "cursor") {
    return process.env.CEDAR_CURSOR_BRIDGE === "false" ? "Cursor API" : "Cursor bridge · ask";
  }
  if (p === "openrouter") return "OpenRouter";
  return null;
}

/**
 * @param {string} raw
 */
function trimContextBlock(raw) {
  if (raw.length <= MAX_CONTEXT_CHARS) return raw;
  return `${raw.slice(0, MAX_CONTEXT_CHARS)}…`;
}