import { Agent } from "@cursor/sdk";
import { resolveComposerReviewMode } from "./composer-review-mode.js";
import { resolveCursorModel } from "./default-model.js";
import { cursorBridgeChat } from "./cursor-bridge-client.js";
import { cursorApiKey } from "./ai-credentials.js";

/**
 * @param {{
 *   messages: { role: string, content: string }[],
 *   model?: string,
 * }} opts
 */
export async function cursorChat(opts) {
  const apiKey = cursorApiKey();
  if (!apiKey) {
    throw new Error("CURSOR_API_KEY is not set");
  }

  const useBridge = process.env.CEDAR_CURSOR_BRIDGE !== "false";
  if (useBridge) {
    try {
      return await cursorBridgeChat(opts);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (process.env.CEDAR_CURSOR_BRIDGE_STRICT === "true") {
        throw err;
      }
      console.warn(`[cedar] Cursor bridge unavailable (${message}); using Agent.prompt fallback`);
    }
  }

  return cursorChatOneShot(opts);
}

/**
 * Legacy one-shot path (no session warming).
 * @param {Parameters<typeof cursorChat>[0]} opts
 */
async function cursorChatOneShot(opts) {
  const apiKey = cursorApiKey();
  if (!apiKey) {
    throw new Error("CURSOR_API_KEY is not set");
  }

  const system =
    opts.messages.find((m) => m.role === "system")?.content?.trim() ?? "";
  const wantsJson = Boolean(opts.json);
  const dialogue = opts.messages
    .filter((m) => m.role !== "system")
    .map((m) => `${m.role.toUpperCase()}:\n${m.content}`)
    .join("\n\n");

  const baseOptions = {
    apiKey,
    model: { id: resolveCursorModel(opts.model) },
    tools: [],
    name: "cedar-pr-review",
    local: { cwd: process.cwd(), settingSources: [] },
  };

  let lastError;
  for (const useSystemPrompt of [Boolean(system), false]) {
    try {
      const jsonLead = wantsJson
        ? "Reply with raw JSON only (starts with {). No markdown fences or preamble.\n\n"
        : "";
      const prompt = useSystemPrompt
        ? `${jsonLead}${dialogue}`
        : system
          ? `${jsonLead}SYSTEM INSTRUCTIONS:\n${system}\n\n---\n\n${dialogue}`
          : `${jsonLead}${dialogue}`;

      const options = useSystemPrompt
        ? { ...baseOptions, systemPrompt: system }
        : baseOptions;

      const result = await Agent.prompt(prompt, options);
      if (result.status === "error") {
        throw new Error(result.error?.message ?? "Cursor agent run failed");
      }
      const text = result.result?.trim();
      if (!text) throw new Error("Cursor agent returned no text");
      return text;
    } catch (err) {
      lastError = err;
      const message = err instanceof Error ? err.message : String(err);
      if (!useSystemPrompt || !/custom system prompt/i.test(message)) break;
    }
  }

  throw lastError ?? new Error("Cursor chat failed");
}

/**
 * Composer slice/macro review — bridge plan mode when available, else Agent.prompt one-shot.
 *
 * @param {Parameters<typeof cursorChat>[0]} opts
 */
export async function composerReviewChat(opts) {
  const apiKey = cursorApiKey();
  if (!apiKey) throw new Error("CURSOR_API_KEY is not set");

  const mode = opts.mode ?? resolveComposerReviewMode();
  const withJson = { ...opts, json: true };

  if (process.env.CEDAR_CURSOR_BRIDGE !== "false") {
    try {
      return await cursorBridgeChat({
        ...withJson,
        mode,
        reviewAgent: mode === "agent",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (process.env.CEDAR_CURSOR_BRIDGE_STRICT === "true") {
        throw err;
      }
      console.warn(`[cedar] Composer review bridge unavailable (${message}); using Agent.prompt fallback`);
    }
  }

  return cursorChatOneShot(withJson);
}