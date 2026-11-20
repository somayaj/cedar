import { cursorChat } from "./cursor-llm.js";
import { openRouterChat, parseJsonFromModel } from "./openrouter.js";
import { resolveAiModel } from "./default-model.js";
import { cursorApiKey, openRouterApiKey, resolveAiProviderName } from "./ai-credentials.js";

export { parseJsonFromModel, resolveAiModel };

export function hasAiProvider() {
  return resolveAiProviderName() !== null;
}

export function activeAiProvider() {
  return resolveAiProviderName();
}

/**
 * @param {Parameters<typeof openRouterChat>[0]} opts
 */
export async function aiChat(opts) {
  const provider = resolveAiProviderName();
  const withJson =
    opts.json && provider === "cursor"
      ? {
          ...opts,
          messages: opts.messages.map((m, i) =>
            m.role === "system" && i === opts.messages.findIndex((x) => x.role === "system")
              ? {
                  ...m,
                  content: `${JSON_ONLY_INSTRUCTION}\n\n${m.content}`,
                }
              : m
          ),
        }
      : opts;

  if (provider === "cursor") return cursorChat(withJson);
  if (provider === "openrouter") return openRouterChat(opts);
  if (cursorApiKey() || openRouterApiKey()) {
    const forced = String(process.env.CEDAR_AI_PROVIDER ?? "").trim().toLowerCase();
    if (forced === "cursor") {
      throw new Error("CEDAR_AI_PROVIDER=cursor but CURSOR_API_KEY is missing or empty");
    }
    if (forced === "openrouter") {
      throw new Error("CEDAR_AI_PROVIDER=openrouter but OPENROUTER_API_KEY is missing or empty");
    }
  }
  throw new Error("Set CURSOR_API_KEY (Cursor Integrations) or OPENROUTER_API_KEY");
}

const JSON_ONLY_INSTRUCTION =
  "OUTPUT: Reply with exactly one JSON object. No preamble, no explanation, no markdown code fences. The first non-whitespace character must be {.";