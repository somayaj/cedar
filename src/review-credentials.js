import { AsyncLocalStorage } from "node:async_hooks";

/** @type {AsyncLocalStorage<{ cursorApiKey?: string } | undefined>} */
const store = new AsyncLocalStorage();

/**
 * Per-request Cursor key override (form / review body) layered on process.env.
 *
 * @param {{ cursorApiKey?: string }} overrides
 * @param {() => Promise<T>} fn
 * @template T
 */
export function runWithReviewCredentials(overrides, fn) {
  const key = overrides.cursorApiKey?.trim();
  if (!key) return fn();
  return store.run({ cursorApiKey: key }, fn);
}

/**
 * @returns {string | undefined}
 */
export function reviewCursorApiKeyOverride() {
  return store.getStore()?.cursorApiKey;
}