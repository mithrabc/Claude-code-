import { homedir } from "node:os";
import { resolve } from "node:path";

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
