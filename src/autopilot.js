import { EventEmitter } from "node:events";
import { config } from "./config.js";

/**
 * Autopilot: drives the shared ClaudeSession unattended, turn after turn.
 *
 * Starting it sends the goal (wrapped with autopilot instructions) as a normal
 * prompt. Each time a turn finishes without the completion marker, the next
 * "continue" prompt is sent automatically after a short breather, until Claude
 * ends a reply with the marker line, the turn cap is hit, a turn errors, or a
 * human stops it.
 *
 * Emits "status" {state, goal, turn, maxTurns} on every transition:
 *   started | turn | done | maxTurns | stopped | error
 */
export const DONE_MARKER = "AUTOPILOT DONE";

// The marker must stand on its own line — quoting it mid-sentence (as the
// instructions themselves do) must not read as completion.
const DONE_RE = new RegExp(`^\\s*${DONE_MARKER}\\s*[.!]?\\s*$`, "im");

const NEXT_TURN_DELAY_MS = 1500;
const HARD_TURN_CAP = 50;

function initialPrompt(goal) {
  return (
    `${goal}\n\n` +
    `(Autopilot mode: you are working unattended — no human will reply between ` +
    `turns. Work step by step and verify as you go. When the goal is fully ` +
    `complete, end your reply with the exact line "${DONE_MARKER}". Otherwise ` +
    `just keep going.)`
  );
}

const CONTINUE_PROMPT =
  "Continue working toward the autopilot goal. If it is now fully complete " +
  `and verified, end your reply with the exact line "${DONE_MARKER}".`;

export class Autopilot extends EventEmitter {
  /**
   * @param session the shared ClaudeSession
   * @param send    function(text) that echoes + submits a prompt (may throw)
   */
  constructor(session, send) {
    super();
    this.session = session;
    this.send = send;
    this.active = false;
    this.goal = "";
    this.turn = 0;
    this.maxTurns = 0;
    this.timer = null;

    session.on("result", (e) => this.#onResult(e));
    // If a turn dies without ever producing a result (e.g. the CLI failed to
    // launch), "result" never fires — catch it on process exit instead.
    session.on("exit", () => {
      if (this.active && !this.timer) this.#finish("error");
    });
  }

  get status() {
    return { active: this.active, goal: this.goal, turn: this.turn, maxTurns: this.maxTurns };
  }

  /** Begin an autopilot run. Returns {ok} or {ok:false, error}. */
  start(goal, maxTurns) {
    goal = (goal || "").trim();
    if (!goal) return { ok: false, error: "No autopilot goal provided." };
    if (this.active) return { ok: false, error: "Autopilot is already running." };
    if (this.session.busy) return { ok: false, error: "Busy — wait for the current turn to finish." };

    const requested = Number(maxTurns) || config.autopilotMaxTurns;
    this.maxTurns = Math.min(Math.max(Math.floor(requested), 1), HARD_TURN_CAP);
    this.goal = goal;
    this.turn = 1;
    this.active = true;
    this.#emitStatus("started");
    try {
      this.send(initialPrompt(goal));
    } catch {
      this.#finish("error");
      return { ok: false, error: "Could not start the first autopilot turn." };
    }
    return { ok: true };
  }

  /** Cancel the run (does not kill an in-flight turn — the server does that). */
  stop() {
    if (!this.active) return;
    this.#clearTimer();
    this.#finish("stopped");
  }

  #onResult(e) {
    if (!this.active) return;
    if (e.isError) return this.#finish("error");
    if (DONE_RE.test(e.text || "")) return this.#finish("done");
    if (this.turn >= this.maxTurns) return this.#finish("maxTurns");
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.active) return;
      this.turn++;
      this.#emitStatus("turn");
      try {
        this.send(CONTINUE_PROMPT);
      } catch {
        this.#finish("error");
      }
    }, NEXT_TURN_DELAY_MS);
  }

  #finish(state) {
    this.#clearTimer();
    this.active = false;
    this.#emitStatus(state);
  }

  #clearTimer() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  #emitStatus(state) {
    this.emit("status", { state, ...this.status });
  }
}
