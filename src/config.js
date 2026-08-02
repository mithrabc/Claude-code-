import { homedir } from "node:os";
import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Minimal .env loader (no dependency). Reads KEY=VALUE lines from a .env file in
 * the project root and populates process.env for any key not already set, so a
 * real environment variable always wins over the file.
 */
function loadDotEnv() {
  const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  let text;
  try {
    text = readFileSync(join(projectRoot, ".env"), "utf8");
  } catch {
    return; // no .env file — that's fine
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    // Strip matching surrounding quotes.
    if (val.length >= 2 && /^(["']).*\1$/.test(val)) val = val.slice(1, -1);
    if (key && process.env[key] === undefined) process.env[key] = val;
  }
}

loadDotEnv();

function parseBool(value, fallback) {
  if (value === undefined) return fallback;
  return /^(1|true|yes|on)$/i.test(value);
}

export const config = {
  // Network
  host: process.env.HOST || "0.0.0.0",
  port: Number(process.env.PORT || 4517),

  // Shared-secret auth. Strongly recommended when exposed beyond localhost.
  // If empty, the server runs open (fine for a trusted LAN / tunnel only).
  authToken: process.env.AUTH_TOKEN || "",

  // Working directory Claude Code operates in.
  workspace: resolve(process.env.WORKSPACE || process.cwd()),

  // Path to the Claude Code CLI.
  claudeBin: process.env.CLAUDE_BIN || "claude",

  // Model override passed to the CLI (empty = CLI default).
  model: process.env.CLAUDE_MODEL || "",

  // Permission mode for the headless session. "acceptEdits" or "bypassPermissions"
  // let tools run without an interactive prompt (there is no human at the terminal).
  permissionMode: process.env.PERMISSION_MODE || "acceptEdits",

  // Force the built-in mock backend instead of spawning the real CLI.
  // Handy for developing the UI where the CLI is unavailable.
  mock: parseBool(process.env.MOCK, false),

  home: homedir(),
};
