// Claude Remote — browser client. Talks to the server over one WebSocket.

const $ = (sel) => document.querySelector(sel);
const transcript = $("#transcript");
const input = $("#input");
const composer = $("#composer");
const sendBtn = $("#send");
const connDot = $("#conn-dot");
const meta = $("#meta");
const menuBtn = $("#menu-btn");
const menu = $("#menu");

// Token comes from the page URL (?token=...) and is forwarded to the socket.
const pageParams = new URLSearchParams(location.search);
const token = pageParams.get("token") || "";

let ws = null;
let busy = false;
let streamingEl = null; // the assistant bubble currently being appended to
let reconnectDelay = 500;

// --- Rendering -------------------------------------------------------------
function atBottom() {
  return transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 80;
}
function scrollDown(force) {
  if (force || atBottom()) transcript.scrollTop = transcript.scrollHeight;
}

function addMsg(role, text) {
  const el = document.createElement("div");
  el.className = `msg ${role}`;
  el.textContent = text;
  transcript.appendChild(el);
  scrollDown(true);
  return el;
}

function addEvent(text, kind = "") {
  const el = document.createElement("div");
  el.className = `event ${kind}`.trim();
  el.innerHTML = text;
  transcript.appendChild(el);
  scrollDown();
  return el;
}

function ensureStream() {
  if (!streamingEl) {
    streamingEl = addMsg("assistant", "");
    streamingEl.classList.add("streaming");
  }
  return streamingEl;
}

function endStream() {
  if (streamingEl) {
    streamingEl.classList.remove("streaming");
    if (!streamingEl.textContent) streamingEl.remove();
    streamingEl = null;
  }
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// --- Busy / connection state ----------------------------------------------
function setBusy(v) {
  busy = v;
  sendBtn.disabled = v || ws?.readyState !== WebSocket.OPEN;
  if (ws?.readyState === WebSocket.OPEN) {
    connDot.className = "dot " + (v ? "busy" : "online");
  }
}

function setConnected(ok) {
  connDot.className = "dot " + (ok ? "online" : "offline");
  sendBtn.disabled = !ok || busy;
  if (!ok) meta.textContent = "reconnecting…";
}

// --- WebSocket -------------------------------------------------------------
function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const url = `${proto}://${location.host}/?${token ? "token=" + encodeURIComponent(token) : ""}`;
  ws = new WebSocket(url);

  ws.onopen = () => {
    reconnectDelay = 500;
    setConnected(true);
  };

  ws.onclose = () => {
    setConnected(false);
    endStream();
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 8000);
  };

  ws.onerror = () => ws.close();

  ws.onmessage = (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    handle(msg);
  };
}

function handle(msg) {
  switch (msg.type) {
    case "hello": {
      const bits = [msg.mock ? "MOCK" : msg.model];
      meta.textContent = shortenPath(msg.workspace) + " · " + bits.join(" ");
      setBusy(Boolean(msg.busy));
      break;
    }
    case "user":
      // Reflect prompts (including those sent from other devices).
      endStream();
      addMsg("user", msg.text);
      break;
    case "delta":
      ensureStream().textContent += msg.text;
      scrollDown();
      break;
    case "tool":
      endStream();
      addEvent(`🔧 <code>${escapeHtml(msg.name)}</code>`, "tool");
      break;
    case "result":
      endStream();
      if (msg.isError) addEvent("turn ended with an error", "error");
      else if (typeof msg.cost === "number" && msg.cost > 0) {
        addEvent(`done · $${msg.cost.toFixed(4)} · ${Math.round((msg.durationMs || 0) / 100) / 10}s`);
      }
      break;
    case "system":
      // init/metadata — no UI needed beyond keeping meta fresh.
      break;
    case "error":
      endStream();
      addEvent(escapeHtml(msg.message), "error");
      break;
    case "reset":
      addEvent("— new conversation —");
      break;
    case "busy":
      setBusy(msg.busy);
      break;
    case "idle":
      setBusy(false);
      break;
  }
}

function shortenPath(p) {
  if (!p) return "";
  const parts = p.split("/").filter(Boolean);
  return parts.length <= 2 ? p : "…/" + parts.slice(-2).join("/");
}

// --- Sending ---------------------------------------------------------------
function send() {
  const text = input.value.trim();
  if (!text || busy || ws?.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: "prompt", text }));
  input.value = "";
  autosize();
}

composer.addEventListener("submit", (e) => {
  e.preventDefault();
  send();
});

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    send();
  }
});

// Auto-grow textarea.
function autosize() {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, window.innerHeight * 0.4) + "px";
}
input.addEventListener("input", autosize);

// --- Menu ------------------------------------------------------------------
menuBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  menu.classList.toggle("hidden");
});
document.addEventListener("click", () => menu.classList.add("hidden"));
menu.addEventListener("click", (e) => {
  const action = e.target.getAttribute("data-action");
  if (!action || ws?.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: action }));
  menu.classList.add("hidden");
});

connect();
autosize();
