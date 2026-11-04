// Chat: speech bubbles over heads, a small chat log, and the typing bar.
//   Enter (or the 💬 button) opens the bar; Enter sends, Esc closes. Tab switches Nearby / Crew.
//   Nearby messages reach players within ~25 m; Crew messages reach your crew anywhere.
//   Tap a player and choose Mute to hide their messages (just for you, until you leave).
// The server decides who receives what (server/chat.js); this file only shows it.
const BUBBLE_SECONDS = 6;
const LOG_SECONDS = 12;      // log lines fade out after this unless you're typing
const LOG_KEEP = 40;

export function setupChat({ THREE, mp, quests }) {
  const room = mp.room;
  const myId = room.sessionId;
  const $ = (id) => document.getElementById(id);
  const muted = new Set();
  let channel = "near";

  $("chat").hidden = false;
  $("chat-btn").hidden = false;

  // ---------- Receiving ----------
  room.onMessage("chat", (m) => {
    if (!m || muted.has(m.from)) return;
    addLine(m);
    showBubble(m);
  });

  function addLine(m) {
    const li = document.createElement("li");
    li.className = m.channel === "crew" ? "crew" : "";
    if (m.channel === "crew") li.append(tag("span", "chan", "Crew"));
    li.append(tag("b", m.from === myId ? "me" : "", m.from === myId ? "You" : m.name), document.createTextNode(" " + m.text));
    li.dataset.t = String(performance.now());
    $("chat-log").append(li);
    while ($("chat-log").children.length > LOG_KEEP) $("chat-log").firstChild.remove();
    $("chat-log").scrollTop = $("chat-log").scrollHeight;
  }

  // ---------- Bubbles ----------
  const bubbles = new Map();   // player id -> { sprite, until }
  function showBubble(m) {
    const obj = mp.avatarOf(m.from);
    if (!obj) return;
    bubbles.get(m.from)?.sprite.parent?.remove(bubbles.get(m.from).sprite);
    const sprite = bubbleSprite(THREE, m.text, m.channel === "crew");
    sprite.position.y = 2.25;
    obj.add(sprite);
    bubbles.set(m.from, { sprite, obj, until: performance.now() + BUBBLE_SECONDS * 1000 });
  }

  // ---------- Sending ----------
  const open = () => {
    $("chat-form").hidden = false;
    document.body.classList.add("chatting");
    syncChannel();
    $("chat-input").focus();
  };
  const close = () => {
    $("chat-form").hidden = true;
    document.body.classList.remove("chatting");
    $("chat-input").blur();
  };
  $("chat-btn").onclick = () => ($("chat-form").hidden ? open() : close());
  $("chat-close").onclick = close;
  $("chat-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const text = $("chat-input").value.trim();
    if (text) room.send("chat", { text, channel });
    $("chat-input").value = "";
    if (matchMedia("(pointer: fine)").matches) close();   // desktop: back to walking; phones keep the bar open
  });
  $("chat-chan").onclick = () => { channel = channel === "near" ? "crew" : "near"; syncChannel(); $("chat-input").focus(); };
  $("chat-input").addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); close(); }
    if (e.key === "Tab") { e.preventDefault(); $("chat-chan").click(); }
    e.stopPropagation();   // typing "e" or "m" shouldn't dance or open the map
  });
  addEventListener("keydown", (e) => {
    if (e.key === "Enter" && $("chat-form").hidden && !["INPUT", "TEXTAREA", "BUTTON"].includes(document.activeElement?.tagName)) {
      e.preventDefault();
      open();
    }
  });

  const inCrew = () => {
    const crewId = room.state.players.get(myId)?.crewId;
    return !!crewId && (room.state.crews.get(crewId)?.members.split(",").filter(Boolean).length ?? 0) > 1;
  };
  function syncChannel() {
    if (!inCrew()) channel = "near";
    $("chat-chan").textContent = channel === "crew" ? "Crew" : "Nearby";
    $("chat-chan").classList.toggle("crew", channel === "crew");
    $("chat-chan").disabled = !inCrew();
    $("chat-chan").title = inCrew() ? "Switch between Nearby and Crew (Tab)" : "Join a crew to chat with them anywhere";
    $("chat-input").placeholder = channel === "crew" ? "Message your crew…" : "Say something to people nearby…";
  }

  // ---------- Mute (from the player card) ----------
  function mute(id) {
    muted.add(id);
    const b = bubbles.get(id);
    if (b) { b.sprite.parent?.remove(b.sprite); bubbles.delete(id); }
  }
  $("pc-mute").onclick = () => {
    const id = $("player-card").dataset.player;
    if (!id) return;
    if (muted.has(id)) muted.delete(id); else mute(id);
    syncMute();
  };
  const syncMute = () => {
    const id = $("player-card").dataset.player;
    const label = muted.has(id) ? "Unmute" : "Mute";
    if ($("pc-mute").textContent !== label) $("pc-mute").textContent = label;
  };

  // ---------- Every frame ----------
  let lastCrew = null;
  function update() {
    const now = performance.now();
    for (const [id, b] of bubbles) {
      const left = b.until - now;
      if (left <= 0 || !b.obj.parent) { b.sprite.parent?.remove(b.sprite); bubbles.delete(id); continue; }
      b.sprite.material.opacity = Math.min(1, left / 600);
    }
    const typing = !$("chat-form").hidden;
    for (const li of $("chat-log").children) li.classList.toggle("old", !typing && now - Number(li.dataset.t) > LOG_SECONDS * 1000);
    const crew = inCrew();
    if (crew !== lastCrew) { lastCrew = crew; if (typing) syncChannel(); }
    if (!$("player-card").hidden) syncMute();
  }

  return { update, open, close, mute };
}

function tag(name, className, text) {
  const e = document.createElement(name);
  if (className) e.className = className;
  e.textContent = text;
  return e;
}

// A rounded speech bubble with a little tail, wrapped to at most 3 lines.
function bubbleSprite(THREE, text, crew) {
  const W = 512, pad = 26, lineH = 44, font = "600 34px system-ui, sans-serif";
  const c = document.createElement("canvas");
  const x = c.getContext("2d");
  x.font = font;
  const lines = wrap(x, text, W - pad * 2, 3);
  const textW = Math.max(...lines.map((l) => x.measureText(l).width));
  const bw = Math.min(W, Math.ceil(textW + pad * 2)), bh = lines.length * lineH + pad * 1.4, tail = 18;
  c.width = W; c.height = Math.ceil(bh + tail + 4);
  x.font = font;
  const left = (W - bw) / 2;
  x.fillStyle = crew ? "#d8fbff" : "#ffffff";
  x.strokeStyle = crew ? "#4fe3ff" : "rgba(0,0,0,.25)";
  x.lineWidth = 4;
  x.beginPath();
  x.roundRect(left + 2, 2, bw - 4, bh, 22);
  x.moveTo(W / 2 - 14, bh + 1); x.lineTo(W / 2, bh + tail); x.lineTo(W / 2 + 14, bh + 1);
  x.fill(); x.stroke();
  x.fillStyle = "#1c1228"; x.textAlign = "center"; x.textBaseline = "middle";
  lines.forEach((l, i) => x.fillText(l, W / 2, pad * 0.7 + lineH * (i + 0.5)));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  const worldW = 1.9;
  s.scale.set(worldW, worldW * (c.height / W), 1);
  s.center.set(0.5, 0);
  s.renderOrder = 10;
  return s;
}

function wrap(ctx, text, maxW, maxLines) {
  const words = text.split(" ");
  const lines = [];
  let line = "";
  for (let w of words) {
    while (ctx.measureText(w).width > maxW) {                 // break very long words
      let cut = w.length;
      while (cut > 1 && ctx.measureText(w.slice(0, cut)).width > maxW) cut--;
      if (line) { lines.push(line); line = ""; }
      lines.push(w.slice(0, cut)); w = w.slice(cut);
    }
    const next = line ? line + " " + w : w;
    if (ctx.measureText(next).width > maxW && line) { lines.push(line); line = w; } else line = next;
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    let last = lines[maxLines - 1];
    while (last && ctx.measureText(last + "…").width > maxW) last = last.slice(0, -1);
    lines[maxLines - 1] = last + "…";
  }
  return lines;
}
