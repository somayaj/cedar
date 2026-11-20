/**
 * Composer sometimes emits `\d`-style escapes JSON does not allow — double the backslash.
 * @param {string} text
 */
export function repairInvalidJsonEscapes(text) {
  return text.replace(/\\(?!["\\/bfnrtu]|u[0-9a-fA-F]{4})/g, "\\\\");
}

/**
 * @param {string} raw
 */
function tryParseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch (firstErr) {
    try {
      return JSON.parse(repairInvalidJsonEscapes(raw));
    } catch {
      throw firstErr;
    }
  }
}

/**
 * Extract a JSON object/array from model output (prose, fences, or truncated).
 * @param {string} content
 */
export function parseJsonFromModel(content) {
  if (content == null || !String(content).trim()) {
    throw new Error("Model returned empty content");
  }

  const trimmed = String(content).trim();
  const errors = [];

  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    try {
      return tryParseJson(fence[1].trim());
    } catch (err) {
      errors.push(fenceErr(err));
    }
  }

  try {
    return tryParseJson(trimmed);
  } catch (err) {
    errors.push(fenceErr(err));
  }

  const objectStart = trimmed.indexOf("{");
  const arrayStart = trimmed.indexOf("[");
  const start =
    objectStart >= 0 && (arrayStart < 0 || objectStart < arrayStart) ? objectStart : arrayStart;

  if (start >= 0) {
    const slice = extractBalancedJson(trimmed, start);
    if (slice) {
      try {
        return tryParseJson(slice);
      } catch (err) {
        errors.push(fenceErr(err));
      }
    }
  }

  const preview = trimmed.slice(0, 80).replace(/\s+/g, " ");
  const looksLikeProse = /^[A-Za-z]/.test(trimmed) && !trimmed.includes("{");
  if (looksLikeProse) {
    throw new Error(
      `Model returned prose instead of JSON (starts with: "${preview}…"). Retry or check Cursor bridge.`
    );
  }
  throw new Error(
    errors[0] ?? `Could not parse JSON from model output (starts with: "${preview}…")`
  );
}

/**
 * @param {unknown} err
 */
function fenceErr(err) {
  return err instanceof Error ? err.message : String(err);
}

/**
 * @param {string} text
 * @param {number} start
 */
function extractBalancedJson(text, start) {
  const open = text[start];
  const close = open === "{" ? "}" : open === "[" ? "]" : null;
  if (!close) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === open) depth++;
    if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}