#!/usr/bin/env node
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import qrcode from "qrcode-terminal";
import { config } from "./config.js";
import { ClaudeSession } from "./claude-session.js";
import { getLanIp } from "./net.js";

const PUBLIC_DIR = fileURLToPath(new URL("../public", import.meta.url));

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
};

// ---------------------------------------------------------------------------
// Shared conversation state. All connected clients view/drive the same session.
// ---------------------------------------------------------------------------
const session = new ClaudeSession();
const clients = new Set();

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) ws.send(data);
  }
}

// Re-emit session events to every connected browser.
session.on("system", (e) => broadcast({ type: "system", ...e }));
session.on("delta", (e) => broadcast({ type: "delta", text: e.text }));
session.on("tool", (e) => broadcast({ type: "tool", name: e.name, input: e.input }));
session.on("result", (e) =>
  broadcast({
    type: "result",
    cost: e.cost,
    durationMs: e.durationMs,
    isError: e.isError,
    sessionId: e.sessionId,
  })
);
session.on("error", (e) => broadcast({ type: "error", message: e.message }));
session.on("exit", () => broadcast({ type: "idle", busy: session.busy }));

// ---------------------------------------------------------------------------
// HTTP: serve the static UI.
// ---------------------------------------------------------------------------
async function serveStatic(req, res) {
  let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (path === "/") path = "/index.html";
  // Prevent path traversal.
  const safe = normalize(path).replace(/^(\.\.[/\\])+/, "");
  const file = join(PUBLIC_DIR, safe);
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": MIME[extname(file)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
  }
}

const httpServer = createServer((req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, busy: session.busy }));
    return;
  }
  serveStatic(req, res);
});

// ---------------------------------------------------------------------------
// WebSocket: command channel.
// ---------------------------------------------------------------------------
const wss = new WebSocketServer({ noServer: true });

function authorized(req) {
  if (!config.authToken) return true;
  const url = new URL(req.url, "http://x");
  const token = url.searchParams.get("token") || req.headers["x-auth-token"];
  return token === config.authToken;
}

httpServer.on("upgrade", (req, socket, head) => {
  if (!authorized(req)) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
});

function isDir(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return null; // does not exist / not accessible
  }
}

/**
 * Resolve a requested workspace to an allowed, existing directory.
 * Returns { ok, path } or { ok:false, error }.
 */
function resolveWorkspace(requested) {
  if (!requested || typeof requested !== "string") {
    return { ok: false, error: "No path provided." };
  }
  const target = resolve(requested);
  const inList = config.workspaces.includes(target);
  if (!inList && !config.allowAnyWorkspace) {
    return { ok: false, error: "That workspace is not in the allowed list." };
  }
  const dir = isDir(target); // true = directory, false = exists but not a dir, null = missing
  if (dir === null) return { ok: false, error: `Path not found: ${target}` };
  if (dir === false) return { ok: false, error: `Not a directory: ${target}` };
  return { ok: true, path: target };
}

wss.on("connection", (ws) => {
  clients.add(ws);
  ws.send(
    JSON.stringify({
      type: "hello",
      workspace: session.cwd,
      workspaces: config.workspaces,
      allowAny: config.allowAnyWorkspace,
      model: config.model || "(cli default)",
      mock: config.mock,
      busy: session.busy,
      sessionId: session.claudeSessionId,
    })
  );

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    handleClientMessage(ws, msg);
  });

  ws.on("close", () => clients.delete(ws));
  ws.on("error", () => clients.delete(ws));
});

function handleClientMessage(ws, msg) {
  switch (msg.type) {
    case "prompt": {
      const text = (msg.text || "").trim();
      if (!text) return;
      if (session.busy) {
        ws.send(JSON.stringify({ type: "error", message: "Busy — a turn is already running." }));
        return;
      }
      // Echo the user's prompt to every client so all views stay in sync.
      broadcast({ type: "user", text });
      broadcast({ type: "busy", busy: true });
      try {
        session.send(text);
      } catch (err) {
        broadcast({ type: "error", message: err.message });
        broadcast({ type: "busy", busy: false });
      }
      break;
    }
    case "stop":
      session.stop();
      break;
    case "reset":
      session.reset();
      broadcast({ type: "reset" });
      break;
    case "setWorkspace": {
      if (session.busy) {
        ws.send(
          JSON.stringify({ type: "error", message: "Can't switch workspace while a turn is running." })
        );
        return;
      }
      const res = resolveWorkspace(msg.path);
      if (!res.ok) {
        ws.send(JSON.stringify({ type: "error", message: res.error }));
        return;
      }
      if (res.path === session.cwd) return; // no-op
      try {
        session.setCwd(res.path);
      } catch (err) {
        ws.send(JSON.stringify({ type: "error", message: err.message }));
        return;
      }
      broadcast({ type: "workspace", workspace: res.path, workspaces: config.workspaces });
      break;
    }
    default:
      break;
  }
}

// Keep the "busy" flag on clients accurate after each turn.
session.on("exit", () => broadcast({ type: "busy", busy: false }));

httpServer.listen(config.port, config.host, () => {
  const auth = config.authToken ? "token required" : "OPEN (no token set)";
  console.log(`claude-remote listening on http://${config.host}:${config.port}`);
  console.log(`  workspace : ${config.workspace}`);
  console.log(`  backend   : ${config.mock ? "MOCK" : config.claudeBin}`);
  console.log(`  auth      : ${auth}`);
  if (!config.authToken) {
    console.log("  ⚠  No AUTH_TOKEN set — do not expose this beyond a trusted network.");
  }
  printPhoneAccess();
});

/**
 * Print the phone URL and, unless disabled, a scannable QR code for it.
 * Set QR=0 to skip the QR (e.g. on a terminal that mangles block characters).
 */
function printPhoneAccess() {
  const query = config.authToken ? `/?token=${encodeURIComponent(config.authToken)}` : "/";
  const bound = config.host === "0.0.0.0" || config.host === "::";
  const ip = bound ? getLanIp() : config.host;
  if (!ip) {
    console.log("  (no LAN address detected — reachable at localhost only)");
    return;
  }
  const url = `http://${ip}:${config.port}${query}`;
  console.log(`  phone     : ${url}`);
  if (/^(0|false|no|off)$/i.test(process.env.QR || "")) return;
  qrcode.generate(url, { small: true }, (qr) => {
    console.log("\n  Scan to open on your phone (same Wi-Fi):\n");
    console.log(
      qr
        .split("\n")
        .map((line) => "  " + line)
        .join("\n")
    );
  });
}

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    session.stop();
    httpServer.close(() => process.exit(0));
  });
}
