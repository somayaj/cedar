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
  if (hasCursor) return "cursor";
  if (hasOpenRouter) return "openrouter";
  return null;
}