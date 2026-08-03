# Claude Remote 🕹️

Drive a [Claude Code](https://claude.com/claude-code) session from any browser —
your phone, a tablet, or another laptop. Run the small server next to your
project, open the URL, and send prompts to Claude Code over a live WebSocket.
Responses stream back token-by-token, tool calls are shown inline, and multiple
devices can watch the same conversation at once.

```
┌────────────┐   WebSocket    ┌──────────────┐   spawn (stream-json)   ┌────────────┐
│  Browser   │ ◀───────────▶  │ claude-remote │ ◀────────────────────▶ │ claude CLI │
│ (phone/PC) │   prompts +    │   server.js   │   prompts + events     │  headless  │
└────────────┘   live output  └──────────────┘                        └────────────┘
```

## Requirements

- Node.js 20+
- The `claude` CLI installed and authenticated on the host (or run in **mock mode**)

## Quick start

```bash
npm install
npm start
```

Then open **http://localhost:4517** in a browser. Type a message, press Enter.

To reach it from your phone, point it at the host's LAN address
(e.g. `http://192.168.1.20:4517`) — and set an `AUTH_TOKEN` first (see below).

On startup the server prints the phone URL **and a scannable QR code** of it
(token included), so you can just point your camera at the terminal to open the
UI. Set `QR=0` to turn the QR off.

### Switch workspaces from the browser

Configure a few projects and hop between them without restarting — from the
**⋯ menu → Switch workspace…**:

```bash
WORKSPACES="/dev/api:/dev/web:/dev/infra" npm start   # ";"-separated on Windows
```

The switcher lists these (the initial `WORKSPACE` is always included). Picking
one starts a fresh Claude Code conversation in that directory, and the change is
broadcast to every connected device. To also allow opening an arbitrary typed
path, set `ALLOW_ANY_WORKSPACE=1` — off by default so the browser can only reach
the directories you listed.

### Autopilot: run autonomously 🤖

Hand Claude a goal and pocket your phone. From **⋯ menu → Autopilot…**, type a
goal (e.g. _"make the test suite pass, then update the changelog"_), pick a turn
limit, and hit **Engage autopilot**. The server then drives the session
unattended: whenever a turn finishes without the goal being complete, it
automatically sends the next *continue* prompt — no human in the loop — until:

- Claude declares completion (it's instructed to end its final reply with the
  line `AUTOPILOT DONE`),
- the turn limit is reached (default 8, per-run adjustable, hard cap 50), or
- a turn errors, or you press **Stop** in the status bar.

While engaged, a status bar above the composer shows the live turn count on
every connected device, and manual prompts are held off so they don't interleave
with the run. Because autopilot is exactly as unsupervised as it sounds, keep
`PERMISSION_MODE` and the workspace scoped to what you're happy for Claude to do
alone — and set the turn limit with cost in mind: every autopilot turn is a
full Claude Code turn.

## Windows: run on your desktop, connect from your phone

The easiest path on Windows. From the project folder in **PowerShell**:

```powershell
./scripts/start.ps1 -Workspace C:\dev\my-project
```

(or just **double-click `scripts\start.bat`** in Explorer.)

The script installs dependencies on first run, generates an `AUTH_TOKEN` once
and saves it to `.env`, then prints two links:

```
On this PC: http://localhost:4517/?token=…
On phone  : http://192.168.1.20:4517/?token=…
```

Open the **phone** link on a device on the **same Wi-Fi**. That's it.

### Windows firewall

The first time Node tries to accept connections, Windows may pop up a
**Windows Defender Firewall** dialog. Tick **Private networks** and click
**Allow access** so your phone can reach the server. If you dismissed it, or the
phone link times out, add the rule manually in an **admin** PowerShell:

```powershell
New-NetFirewallRule -DisplayName "Claude Remote" -Direction Inbound `
  -Action Allow -Protocol TCP -LocalPort 4517 -Profile Private
```

If it still won't load, confirm the phone is on the same network and that
`http://localhost:4517/?token=…` works locally on the PC first.

### Point it at a project

By default Claude Code runs in the server's working directory. To target a
specific project:

```bash
WORKSPACE=/path/to/your/project npm start
```

### Try it without the CLI

```bash
MOCK=1 npm start
```

The mock backend streams a canned reply so you can exercise the whole UI with no
CLI installed and no cost.

## Configuration

All settings are environment variables (see [`.env.example`](.env.example)):

| Variable          | Default        | Purpose                                                        |
| ----------------- | -------------- | -------------------------------------------------------------- |
| `PORT`            | `4517`         | Port to listen on.                                             |
| `HOST`            | `0.0.0.0`      | Interface to bind.                                             |
| `AUTH_TOKEN`      | _(empty)_      | Shared secret. When set, the UI needs `?token=…` to connect.   |
| `WORKSPACE`       | _cwd_          | Initial directory Claude Code operates in.                     |
| `WORKSPACES`      | _(WORKSPACE)_  | Extra dirs offered in the switcher (OS-delimited / comma list).|
| `ALLOW_ANY_WORKSPACE` | `0`        | `1` lets the switcher open any existing typed path.            |
| `CLAUDE_BIN`      | `claude`       | Path to the Claude Code CLI.                                   |
| `CLAUDE_MODEL`    | _(cli default)_| Model override passed to `--model`.                            |
| `PERMISSION_MODE` | `acceptEdits`  | Headless permission mode (`acceptEdits` / `bypassPermissions`).|
| `AUTOPILOT_MAX_TURNS` | `8`        | Default turn limit for autopilot runs (hard cap 50).           |
| `MOCK`            | `0`            | `1` uses the built-in mock backend.                            |
| `QR`              | `1`            | `0` skips the startup QR code of the phone URL.                |

## Security ⚠️

This server lets a browser run Claude Code — which can read, write, and execute
in your `WORKSPACE`. Treat access to the URL as access to that project.

- **Always set `AUTH_TOKEN`** when the server is reachable by anything other than
  `localhost`. Without it the server runs open and prints a warning.
- Put it behind HTTPS (a reverse proxy or a tunnel like Cloudflare Tunnel /
  Tailscale) before exposing it to the internet — tokens travel in the URL.
- `PERMISSION_MODE` decides how much Claude can do without asking. Because
  there's no terminal to approve prompts, tools run under this mode
  automatically; scope your `WORKSPACE` accordingly.

With a token, open:

```
http://<host>:4517/?token=YOUR_TOKEN
```

## How it works

- **`src/server.js`** — HTTP static server for the UI plus a WebSocket command
  channel. All clients share one conversation and see the same stream. Handles
  workspace switch requests, validating each against the allowed list.
- **`src/claude-session.js`** — spawns `claude -p … --output-format stream-json`
  per turn, parses the JSON-lines events, and captures the CLI session id so the
  next prompt resumes the same conversation with full history.
- **`src/autopilot.js`** — the autonomous driver: re-prompts the session after
  each finished turn until Claude emits the `AUTOPILOT DONE` marker, the turn
  limit is hit, or a human stops it.
- **`src/net.js`** — detects the LAN IPv4 used to build the phone URL / QR code.
- **`public/`** — a dependency-free, mobile-first web client.

Runtime dependencies: [`ws`](https://github.com/websockets/ws) (WebSocket) and
[`qrcode-terminal`](https://github.com/gtanner/qrcode-terminal) (startup QR) —
both zero-dependency themselves.

## License

MIT
