import { resolveOpenRouterModel } from "./default-model.js";
import { openRouterApiKey } from "./ai-credentials.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/**
 * @param {{
 *   messages: { role: string, content: string }[],
 *   model?: string,
 *   json?: boolean,
 *   temperature?: number,
 *   maxTokens?: number,
 * }} opts
 */
export async function openRouterChat(opts) {
  const apiKey = openRouterApiKey();
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }

  const model = resolveOpenRouterModel(opts.model);

  const body = {
    model,
    messages: opts.messages,
    temperature: opts.temperature ?? 0.2,
    max_tokens: opts.maxTokens ?? 4096,
  };

  if (opts.json) {
    body.response_format = { type: "json_object" };
  }

  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.OPENROUTER_REFERER ?? "http://localhost:5173",
      "X-Title": process.env.OPENROUTER_APP_NAME ?? "cedar-pr-review",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenRouter ${res.status}: ${text.slice(0, 400)}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("OpenRouter returned no message content");
  }
  return content;
}

export { parseJsonFromModel } from "./parse-model-json.js";