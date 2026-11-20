/**
 * @param {string} name
 */
function trimEnv(name) {
  const v = process.env[name];
  if (v == null) return "";
  return String(v).trim();
}

export function cursorApiKey() {
  return trimEnv("CURSOR_API_KEY");
}

export function openRouterApiKey() {
  return trimEnv("OPENROUTER_API_KEY");
}

/** @returns {"cursor" | "openrouter" | null} */
export function resolveAiProviderName() {
  const forced = trimEnv("CEDAR_AI_PROVIDER").toLowerCase();
  const hasCursor = Boolean(cursorApiKey());
  const hasOpenRouter = Boolean(openRouterApiKey());

  if (forced === "openrouter") {
    return hasOpenRouter ? "openrouter" : null;
  }
  if (forced === "cursor") {
    return hasCursor ? "cursor" : null;
  }
  // Default: Cursor when CURSOR_API_KEY is set — OpenRouter only as fallback with no Cursor key.
  if (hasCursor) return "cursor";
  if (hasOpenRouter) return "openrouter";
  return null;
}

/** AI slice review uses Composer/Cursor only (not OpenRouter). */
export function sliceReviewAiAvailable() {
  return Boolean(cursorApiKey());
}