import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveCursorModel } from "./default-model.js";
import { ensureCursorBridge, bridgeBaseUrl } from "./cursor-bridge-spawn.js";
import { emitBridgeSse } from "./review-progress.js";

const SESSION_IDLE_MS = Number(process.env.CEDAR_CURSOR_SESSION_IDLE_MS ?? 90_000);

/** @type {{ sessionId: string | null, cwd: string, model: string, mode: string, lastUsedAt: number } | null} */
let cedarSession = null;

function resolveCursorMode() {
  const raw = (process.env.CEDAR_CURSOR_MODE ?? "plan").toLowerCase();
  if (raw === "agent" || raw === "ask" || raw === "plan") return raw;
  return "plan";
}

async function bridgeFetch(pathname, init) {
  await ensureCursorBridge();
  const url = `${bridgeBaseUrl()}${pathname}`;
  const res = await fetch(url, init);
  return res;
}

/**
 * @param {string} [modeOverride]
 */
async function ensureBridgeSession(modeOverride) {
  const cwd = process.cwd();
  const apiKey = process.env.CURSOR_API_KEY;
  if (!apiKey) throw new Error("CURSOR_API_KEY is not set");

  const model = resolveCursorModel();
  const mode = modeOverride ?? resolveCursorMode();
  const now = Date.now();

  if (
    cedarSession?.sessionId &&
    cedarSession.cwd === cwd &&
    cedarSession.model === model &&
    cedarSession.mode === mode &&
    now - cedarSession.lastUsedAt < SESSION_IDLE_MS
  ) {
    return cedarSession.sessionId;
  }

  if (cedarSession?.sessionId) {
    try {
      await bridgeFetch(`/sessions/${encodeURIComponent(cedarSession.sessionId)}`, {
        method: "DELETE",
      });
    } catch {
      /* ignore stale session cleanup */
    }
  }

  const res = await bridgeFetch("/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd, apiKey, model, mode }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? `bridge session create failed (${res.status})`);
  }
  const body = await res.json();
  cedarSession = {
    sessionId: body.sessionId,
    cwd,
    model,
    mode,
    lastUsedAt: now,
  };
  return body.sessionId;
}

/**
 * @param {import("node:http").IncomingMessage | Response} body
 * @returns {Promise<string>}
 */
async function collectSseText(res) {
  if (!res.body) throw new Error("cursor bridge returned empty body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  /** @type {string | null} */
  let doneSummary = null;
  let terminalError = null;

  /** @param {string} chunk */
  function handleDataLine(payload) {
    if (!payload) return;
    let event;
    try {
      event = JSON.parse(payload);
    } catch {
      return;
    }
    emitBridgeSse(event);
    if (event.type === "text" && event.text) text += event.text;
    if (event.type === "done") {
      if (event.summary) doneSummary = String(event.summary);
      if (event.status === "error") {
        terminalError = event.error ?? event.summary ?? "Cursor agent run failed";
      }
    }
    if (event.type === "error" && event.error) terminalError = String(event.error);
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let idx;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      for (const line of block.split("\n")) {
        if (line.startsWith("data:")) handleDataLine(line.slice(5).trim());
      }
    }
  }

  if (terminalError) throw new Error(terminalError);

  const streamText = text.trim();
  const summaryText = doneSummary?.trim() ?? "";
  const merged = pickBestModelText(streamText, summaryText);
  if (!merged) throw new Error("Cursor bridge returned no text");
  return merged;
}

/**
 * Prefer the payload that actually contains JSON (Composer often streams prose first).
 * @param {string} streamText
 * @param {string} summaryText
 */
function pickBestModelText(streamText, summaryText) {
  const streamHasJson = streamText.includes("{");
  const summaryHasJson = summaryText.includes("{");
  if (summaryHasJson && !streamHasJson) return summaryText;
  if (streamHasJson && !summaryHasJson) return streamText;
  if (summaryHasJson && streamHasJson) {
    return summaryText.length > streamText.length ? summaryText : streamText;
  }
  return summaryText || streamText;
}

/**
 * Pre-create a bridge session so the first review skips cold agent startup.
 */
export async function warmCursorBridgeSession() {
  if (!process.env.CURSOR_API_KEY) return false;
  if (process.env.CEDAR_CURSOR_BRIDGE === "false") return false;
  try {
    await ensureBridgeSession();
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {{
 *   messages: { role: string, content: string }[],
 *   model?: string,
 *   mode?: "agent" | "ask" | "plan",
 *   reviewAgent?: boolean,
 * }} opts
 */
export async function cursorBridgeChat(opts) {
  const system =
    opts.messages.find((m) => m.role === "system")?.content?.trim() ?? "";
  const dialogue = opts.messages
    .filter((m) => m.role !== "system")
    .map((m) => `${m.role.toUpperCase()}:\n${m.content}`)
    .join("\n\n");

  const wantsJson = opts.json || /Return JSON only|JSON object/i.test(system);
  const mode = opts.mode ?? resolveCursorMode();
  const isQa = mode === "ask";
  const reviewAgentLead =
    opts.reviewAgent && mode === "agent" && wantsJson
      ? `[Technical code review (Composer agent). You MAY use read/search tools to inspect callers, types, tests, and related modules in this repo.
Do NOT create, edit, or delete files. Do NOT run destructive or mutating commands.
Your ONLY output is raw JSON per SYSTEM INSTRUCTIONS — first character must be {. No markdown fences.]\n\n`
      : "";
  const jsonOnly =
    reviewAgentLead ||
    (!isQa && mode !== "agent"
      ? wantsJson
        ? `[Plan mode — output raw JSON only: first character must be {. No prose, no fences. Do not edit files or run commands.]\n\n`
        : `[Plan mode — do not edit, create, or delete files, and do not run shell commands.]\n\n`
      : isQa
        ? "[Ask mode — answer questions only. Do not edit files or run commands.]\n\n"
        : "");

  const prompt = system
    ? `${jsonOnly}SYSTEM INSTRUCTIONS:\n${system}\n\n---\n\n${dialogue}`
    : `${jsonOnly}${dialogue}`;

  const model = resolveCursorModel(opts.model);

  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      emitBridgeSse({ type: "activity", text: "Sending to Cursor agent…", phase: "start" });
      const sessionId = await ensureBridgeSession(mode);
      const res = await bridgeFetch(`/sessions/${encodeURIComponent(sessionId)}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, model, mode }),
      });

      if (res.status === 404) {
        cedarSession = null;
        throw new Error("cursor bridge session expired");
      }
      if (res.status === 409) {
        throw new Error("cursor bridge busy");
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `cursor bridge chat failed (${res.status})`);
      }

      if (cedarSession) cedarSession.lastUsedAt = Date.now();
      return await collectSseText(res);
    } catch (err) {
      lastError = err;
      const message = err instanceof Error ? err.message : String(err);
      if (attempt === 0 && /expired|session not found|404/i.test(message)) {
        cedarSession = null;
        continue;
      }
      throw err;
    }
  }
  throw lastError ?? new Error("cursor bridge chat failed");
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const CURSOR_BRIDGE_DIR = path.join(__dirname, "..", "cursor-bridge");