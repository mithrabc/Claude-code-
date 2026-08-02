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
| `WORKSPACE`       | _cwd_          | Directory Claude Code operates in.                             |
| `CLAUDE_BIN`      | `claude`       | Path to the Claude Code CLI.                                   |
| `CLAUDE_MODEL`    | _(cli default)_| Model override passed to `--model`.                            |
| `PERMISSION_MODE` | `acceptEdits`  | Headless permission mode (`acceptEdits` / `bypassPermissions`).|
| `MOCK`            | `0`            | `1` uses the built-in mock backend.                            |

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
  channel. All clients share one conversation and see the same stream.
- **`src/claude-session.js`** — spawns `claude -p … --output-format stream-json`
  per turn, parses the JSON-lines events, and captures the CLI session id so the
  next prompt resumes the same conversation with full history.
- **`public/`** — a dependency-free, mobile-first web client.

The only runtime dependency is [`ws`](https://github.com/websockets/ws).

## License

MIT
