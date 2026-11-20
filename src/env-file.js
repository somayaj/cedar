import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ENV_FILE_PATH = path.join(__dirname, "..", ".env");

export function envFileExists() {
  return fs.existsSync(ENV_FILE_PATH);
}
const EXAMPLE_PATH = path.join(__dirname, "..", ".env.example");

/**
 * @param {string} value
 */
function formatEnvValue(value) {
  if (/[\s#"'\\]/.test(value)) {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return value;
}

/**
 * @param {string} key
 */
function escapeRegExp(key) {
  return key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * @param {string} content
 * @param {string} key
 * @param {string} value
 */
function upsertEnvLine(content, key, value) {
  const line = `${key}=${formatEnvValue(value)}`;
  const re = new RegExp(`^${escapeRegExp(key)}=.*$`, "m");
  if (re.test(content)) {
    return content.replace(re, line);
  }
  const sep = content.length && !content.endsWith("\n") ? "\n" : "";
  return `${content}${sep}${line}\n`;
}

/**
 * @returns {string}
 */
export function readEnvFileContent() {
  if (fs.existsSync(ENV_FILE_PATH)) {
    return fs.readFileSync(ENV_FILE_PATH, "utf8");
  }
  if (fs.existsSync(EXAMPLE_PATH)) {
    return fs.readFileSync(EXAMPLE_PATH, "utf8");
  }
  return "";
}

/**
 * Merge keys into project `.env` and apply to `process.env` for the current API process.
 *
 * @param {Record<string, string | undefined>} updates
 */
export function upsertProjectEnv(updates) {
  let content = readEnvFileContent();
  if (!content.trim()) {
    content = "# Cedar local configuration\n";
  }

  /** @type {string[]} */
  const applied = [];

  for (const [key, raw] of Object.entries(updates)) {
    if (raw === undefined) continue;
    const value = String(raw).trim();
    if (!value) continue;
    content = upsertEnvLine(content, key, value);
    process.env[key] = value;
    applied.push(key);
  }

  if (applied.includes("CURSOR_API_KEY") && !process.env.CEDAR_AI_PROVIDER?.trim()) {
    content = upsertEnvLine(content, "CEDAR_AI_PROVIDER", "cursor");
    process.env.CEDAR_AI_PROVIDER = "cursor";
    applied.push("CEDAR_AI_PROVIDER");
  }

  fs.writeFileSync(ENV_FILE_PATH, content, "utf8");

  return { path: ENV_FILE_PATH, applied };
}