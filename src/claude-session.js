import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { config } from "./config.js";

/**
 * Drives a persistent Claude Code conversation in headless streaming mode.
 *
 * Each user prompt spawns `claude -p ... --output-format stream-json`, whose
 * JSON-lines output is parsed and re-emitted as high-level events. The CLI's
 * session id is captured from the first turn and passed via `--resume` on
 * subsequent turns, so the conversation keeps its full history and working
 * context across prompts.
 *
 * Events:
 *   "system"  {subtype, sessionId, raw}   session init / metadata
 *   "delta"   {text}                       incremental assistant text
 *   "message" {role, text}                 a complete assistant message
 *   "tool"    {name, input}                a tool invocation started
 *   "result"  {text, cost, durationMs, isError}  turn finished
 *   "error"   {message}                     runner-level failure
 *   "exit"    {code}                        CLI process exited
 */
export class ClaudeSession extends EventEmitter {
  constructor() {
    super();
    this.claudeSessionId = null;
    this.child = null;
    this.busy = false;
    // Working directory Claude Code runs in; changeable at runtime.
    this.cwd = config.workspace;
  }

  get running() {
    return this.child !== null;
  }

  /** Start over with a brand-new conversation on the next prompt. */
  reset() {
    this.claudeSessionId = null;
  }

  /**
   * Switch the working directory. The CLI session id is tied to a directory, so
   * this also starts a fresh conversation. Refuses while a turn is in flight.
   */
  setCwd(dir) {
    if (this.busy) throw new Error("Can't switch workspace while a turn is running");
    this.cwd = dir;
    this.reset();
  }

  /** Send one user prompt. Rejects if a turn is already in flight. */
  send(prompt) {
    if (this.busy) {
      throw new Error("A turn is already in progress");
    }
    if (config.mock) {
      return this.#runMock(prompt);
    }
    return this.#runCli(prompt);
  }

  /** Terminate the in-flight turn, if any. */
  stop() {
    if (this.child) {
      this.child.kill("SIGTERM");
    }
  }

  #buildArgs(prompt) {
    const args = [
      "-p",
      prompt,
      "--output-format",
      "stream-json",
      "--include-partial-messages",
      "--verbose",
      "--permission-mode",
      config.permissionMode,
    ];
    if (this.claudeSessionId) {
      args.push("--resume", this.claudeSessionId);
    }
    if (config.model) {
      args.push("--model", config.model);
    }
    return args;
  }

  #runCli(prompt) {
    this.busy = true;
    const args = this.#buildArgs(prompt);
    const child = spawn(config.claudeBin, args, {
      cwd: this.cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.child = child;

    let buffer = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      let nl;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line) this.#handleLine(line);
      }
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", (err) => {
      this.emit("error", { message: `Failed to launch Claude CLI: ${err.message}` });
    });

    child.on("close", (code) => {
      if (buffer.trim()) this.#handleLine(buffer.trim());
      this.child = null;
      this.busy = false;
      if (code !== 0 && code !== null) {
        const detail = stderr.trim() || `exited with code ${code}`;
        this.emit("error", { message: `Claude CLI ${detail}` });
      }
      this.emit("exit", { code });
    });
  }

  #handleLine(line) {
    let evt;
    try {
      evt = JSON.parse(line);
    } catch {
      // Non-JSON output (e.g. a stray log line) — surface it as raw text.
      this.emit("delta", { text: line + "\n" });
      return;
    }

    switch (evt.type) {
      case "system":
        if (evt.session_id) this.claudeSessionId = evt.session_id;
        this.emit("system", {
          subtype: evt.subtype,
          sessionId: evt.session_id || null,
          raw: evt,
        });
        break;

      case "stream_event": {
        // Partial assistant text deltas.
        const e = evt.event;
        if (e?.type === "content_block_delta" && e.delta?.type === "text_delta") {
          this.emit("delta", { text: e.delta.text });
        }
        break;
      }

      case "assistant": {
        if (evt.session_id) this.claudeSessionId = evt.session_id;
        const blocks = evt.message?.content || [];
        const text = blocks
          .filter((b) => b.type === "text")
          .map((b) => b.text)
          .join("");
        for (const b of blocks) {
          if (b.type === "tool_use") {
            this.emit("tool", { name: b.name, input: b.input });
          }
        }
        if (text) this.emit("message", { role: "assistant", text });
        break;
      }

      case "result":
        if (evt.session_id) this.claudeSessionId = evt.session_id;
        this.emit("result", {
          text: evt.result || "",
          cost: evt.total_cost_usd ?? null,
          durationMs: evt.duration_ms ?? null,
          isError: Boolean(evt.is_error),
          sessionId: this.claudeSessionId,
        });
        break;

      default:
        // Ignore unknown event types (forward compatibility).
        break;
    }
  }

  // --- Mock backend: streams a canned reply so the UI works without the CLI ---
  #runMock(prompt) {
    this.busy = true;
    if (!this.claudeSessionId) this.claudeSessionId = "mock-" + Date.now();
    this.emit("system", {
      subtype: "init",
      sessionId: this.claudeSessionId,
      raw: { mock: true },
    });

    const reply =
      `You said: "${prompt}".\n\n` +
      "This is the mock backend — set MOCK=0 (and install the Claude CLI) " +
      "to talk to the real Claude Code.\n";
    const words = reply.split(/(\s+)/);
    let i = 0;
    const timer = setInterval(() => {
      if (i >= words.length) {
        clearInterval(timer);
        this.busy = false;
        this.emit("result", {
          text: reply,
          cost: 0,
          durationMs: words.length * 25,
          isError: false,
          sessionId: this.claudeSessionId,
        });
        this.emit("exit", { code: 0 });
        return;
      }
      this.emit("delta", { text: words[i++] });
    }, 25);
  }
}
