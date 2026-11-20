import { activeAiProvider } from "./ai-chat.js";
import { cursorApiKey } from "./ai-credentials.js";
import { cursorBridgeChat } from "./cursor-bridge-client.js";
import { cursorChat } from "./cursor-llm.js";
import { resolveCursorModel } from "./default-model.js";
import { isCodeReviewFinding } from "./finding-meta.js";
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
    "Answer only from the REVIEW CONTEXT below (slices, codeReviewComments with file:line).",
    "When discussing review items, cite file paths and line numbers from codeReviewComments.",
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
  if (!cursorApiKey()) {
    throw new Error("Set CURSOR_API_KEY (Composer) on the server and CEDAR_AI_PROVIDER=cursor");
  }
  if (activeAiProvider() !== "cursor") {
    throw new Error("PR chat uses Composer only — set CEDAR_AI_PROVIDER=cursor and unset OPENROUTER_API_KEY");
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
  const model = resolveCursorModel();
  const payload = {
    messages: [{ role: "system", content: system }, ...trimmed],
    model,
  };

  if (process.env.CEDAR_CURSOR_BRIDGE !== "false") {
    try {
      return await cursorBridgeChat({ ...payload, mode: "ask" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn("[cedar] PR chat bridge failed, falling back to Composer API:", message);
    }
  }

  return await cursorChat(payload);
}

export function prChatProviderLabel() {
  if (!cursorApiKey()) return null;
  const model = resolveCursorModel();
  if (process.env.CEDAR_CURSOR_BRIDGE === "false") {
    return `Composer · ${model}`;
  }
  return `Composer · ${model} · ask`;
}

/**
 * @param {string} raw
 */
function trimContextBlock(raw) {
  if (raw.length <= MAX_CONTEXT_CHARS) return raw;
  return `${raw.slice(0, MAX_CONTEXT_CHARS)}…`;
}