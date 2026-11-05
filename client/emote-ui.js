// Emote menu: the "Emote" button opens a grid of emotes (shared/emotes.js); keys 1-9 pick one,
// Space jumps and E toggles dancing. The server decides and tells everyone (see multiplayer.js),
// so this only sends requests and shows which emote you're doing.
//
//   const emotes = setupEmotes({ mp, button: $("dance") });
//   emotes.update();   // every frame, keeps the highlight in sync with the server
import { EMOTES, emoteById } from "../shared/emotes.js";

const CSS = `
  #emote-menu { position: fixed; right: 16px; bottom: 96px; display: grid; grid-template-columns: repeat(5, 56px);
    gap: 6px; padding: 8px; border-radius: 16px; background: var(--panel, rgba(20,12,32,.85));
    border: 1px solid rgba(255,255,255,.15); backdrop-filter: blur(6px); z-index: 5; }
  @media (pointer: fine) { #emote-menu { bottom: 120px; } }
  #emote-menu button { width: 56px; height: 56px; padding: 2px 0 0; border-radius: 12px; font-size: 24px; line-height: 1;
    background: rgba(255,255,255,.08); border: 2px solid transparent; color: inherit; display: grid; place-items: center; }
  #emote-menu button small { font-size: 9px; opacity: .8; white-space: nowrap; }
  #emote-menu button[aria-pressed="true"] { border-color: var(--pink, #ff4fa3); background: rgba(255,79,163,.3); }
  body.chatting #emote-menu { visibility: hidden; }
`;

const keyLabel = (code) => (code === "Space" ? "Space" : code.replace(/^Digit/, ""));

export function setupEmotes({ mp, button }) {
  if (!document.getElementById("emote-menu-css")) {
    const style = document.createElement("style");
    style.id = "emote-menu-css";
    style.textContent = CSS;
    document.head.append(style);
  }
  const menu = document.createElement("div");
  menu.id = "emote-menu";
  menu.hidden = true;
  menu.setAttribute("role", "menu");
  const buttons = new Map();
  for (const e of EMOTES) {
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("role", "menuitem");
    b.setAttribute("aria-pressed", "false");
    b.title = `${e.name} (${keyLabel(e.key)})`;
    b.setAttribute("aria-label", e.name);
    b.innerHTML = `<span aria-hidden="true">${e.icon}</span><small>${e.name}</small>`;
    b.addEventListener("click", () => { play(e.id); if (!e.loop) menu.hidden = true; });
    menu.append(b);
    buttons.set(e.id, b);
  }
  document.body.append(menu);

  button.textContent = "Emote";
  button.title = "Emotes: 1-9, Space to jump, E to dance";
  button.setAttribute("aria-haspopup", "menu");
  const onButton = () => { menu.hidden = !menu.hidden; };
  button.addEventListener("click", onButton);

  const current = () => mp.room.state?.players?.get(mp.room.sessionId)?.emote ?? "";
  // Picking the loop you're already doing stops it (tap Dance again to stop dancing).
  function play(id) {
    const def = emoteById(id);
    mp.emote(def?.loop && current() === id ? "" : id);
  }

  const typing = () => ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName) || document.body.classList.contains("chatting");
  const byKey = new Map(EMOTES.map((e) => [e.key, e.id]));
  function onKey(e) {
    if (typing() || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === "KeyE") return play("dance");
    if (e.code === "Escape") { menu.hidden = true; return; }
    const id = byKey.get(e.code);
    if (!id) return;
    if (e.code === "Space") e.preventDefault();   // don't scroll or "click" a focused button
    play(id);
  }
  addEventListener("keydown", onKey);

  let shown = null;
  function update() {
    const id = current();
    if (id === shown) return;
    shown = id;
    for (const [k, b] of buttons) b.setAttribute("aria-pressed", String(k === id));
    button.setAttribute("aria-pressed", String(!!emoteById(id)?.loop));
  }

  function dispose() {
    removeEventListener("keydown", onKey);
    button.removeEventListener("click", onButton);
    menu.remove();
  }
  return { update, play, dispose };
}
