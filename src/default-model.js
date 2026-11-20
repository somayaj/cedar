import { resolveAiProviderName } from "./ai-credentials.js";

export const DEFAULT_CURSOR_MODEL = "composer-2.5";

/** Used only when Cursor is not the active AI provider. */
export const DEFAULT_OPENROUTER_MODEL = "anthropic/claude-sonnet-4.6";

export function resolveCursorModel(explicit) {
  return explicit ?? process.env.CURSOR_MODEL ?? DEFAULT_CURSOR_MODEL;
}

export function resolveOpenRouterModel(explicit) {
  return explicit ?? process.env.OPENROUTER_MODEL ?? DEFAULT_OPENROUTER_MODEL;
}

export function resolveAiModel(explicit) {
  if (resolveAiProviderName() === "cursor") return resolveCursorModel(explicit);
  return resolveOpenRouterModel(explicit);
}