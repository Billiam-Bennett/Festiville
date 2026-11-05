import * as THREE from "three";
import { buildFestival } from "./world.js";
import { createControls } from "./controls.js";
import { connectMultiplayer, defaultAvatar } from "./multiplayer.js";
import { createCast } from "./cast.js";
import { CHARACTERS, DEFAULT_LOOK, lookById } from "../shared/characters.js";
import { setupQuests } from "./quests-ui.js";
import { setupVenue } from "./venue-ui.js";
import { setupChat } from "./chat-ui.js";
import { setupModeration } from "./moderation-ui.js";
import { setupReports } from "./reports-ui.js";
import { setupEmotes } from "./emote-ui.js";
import { ACCESSORIES, SLOTS, accessoryById, normalizeAccessories } from "../shared/accessories.js";
import { normalizeRecipe, partById, bodyById } from "../shared/parts.js";
import { createLookBuilder, createPreview } from "./look-builder.js";
import { setupCamps } from "./camps.js";
import { setupShop } from "./shop-ui.js";
import { UNLOCK_PRICES } from "../shared/economy.js";
import { createCameraRig } from "./camera.js";
import { applyLayout } from "../shared/venue.js";

// Where the game server is. When the game server itself serves this page (npm start, or hosted behind
// HTTPS), it's the same address as the page. From the dev page server (npm run client, port 5173) it's
// port 2567 on the same machine. Override with ?server=wss://your-host
const params = new URLSearchParams(location.search);
const wsProto = location.protocol === "https:" ? "wss" : "ws";
const SERVER_URL = params.get("server")
  || (location.port === "5173" || location.protocol === "file:" ? `${wsProto}://${location.hostname || "localhost"}:2567` : `${wsProto}://${location.host}`);

const $ = (id) => document.getElementById(id);

// The festival layout (what the festival builder saved). If the server can't be reached, the
// built-in starting layout is used and the join screen explains the connection problem.
try {
  const r = await fetch(SERVER_URL.replace(/^ws/, "http") + "/api/layout");
  if (r.ok) applyLayout((await r.json()).layout);
} catch {}

// --- Renderer + scene (visible behind the join screen) ---
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 400);
camera.position.set(0, 30, 60);
camera.lookAt(0, 0, 0);
const { stalls } = buildFestival(THREE, scene);
const rig = createCameraRig(THREE, camera, renderer.domElement, scene);

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const controls = createControls($("joystick"));

// Characters load on demand; until one arrives (or if it fails), players see a simple placeholder.
const cast = createCast(THREE, { placeholder: (p) => defaultAvatar(THREE, p) });
const makeAvatar = (p) => cast.make(p);

// --- Account (join screen) ---
// You sign in (or create an account) first; the server then remembers your badges, your last
// character, and any premium looks unlocked for you. The session token lives in localStorage.
const API = SERVER_URL.replace(/^ws/, "http") + "/api";
let token = "";
let account = null;
try { token = localStorage.getItem("fv-token") || ""; } catch {}
const saveToken = (t) => { token = t; try { t ? localStorage.setItem("fv-token", t) : localStorage.removeItem("fv-token"); } catch {} };

async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(`${API}/${path}`, {
    method, body: body && JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  const data = res.status === 204 ? null : await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

let authMode = "login";
function setAuthMode(mode) {
  authMode = mode;
  $("tab-login").setAttribute("aria-selected", mode === "login");
  $("tab-signup").setAttribute("aria-selected", mode === "signup");
  $("auth-btn").textContent = mode === "login" ? "Sign in" : "Create account";
  $("auth-hint").hidden = mode === "login";
  $("password").autocomplete = mode === "login" ? "current-password" : "new-password";
  $("join-error").textContent = "";
}
$("tab-login").onclick = () => setAuthMode("login");
$("tab-signup").onclick = () => setAuthMode("signup");
$("pw-show").onclick = () => {
  const show = $("password").type === "password";
  $("password").type = show ? "text" : "password";
  $("pw-show").textContent = show ? "Hide" : "Show";
};

function showSignedIn(a) {
  account = a;
  $("auth").hidden = true;
  $("signed-in").hidden = false;
  $("me-name").textContent = a.username;
  $("me-badges").textContent = a.badges.length ? `★ ${a.badges.join(" · ")}` : "No badges yet. Find a quest giver (yellow !) to earn some.";
  const i = CHARACTERS.findIndex((c) => c.id === a.look);
  if (i >= 0) lookIndex = i;
  let saved = a.accessories ?? [];
  try { if (!saved.length) saved = (localStorage.getItem("fv-accessories") || "").split(","); } catch {}
  chosen = new Set(normalizeAccessories(saved).filter((id) => accUnlocked(accessoryById(id))));
  renderAccessories();
  // A saved recipe means they last played a character they built; otherwise the classic picker.
  let localRecipe = "";
  try { localRecipe = localStorage.getItem("fv-recipe") || ""; } catch {}
  if (normalizeRecipe(a.recipe || localRecipe)) pkBuilder.set(a.recipe || localRecipe);
  pkBuilder.refresh();   // lock notes depend on the account's unlocks
  setJoinMode(a.recipe ? "parts" : "classic");
  showLook();
}
function showSignedOut(message = "") {
  account = null;
  $("auth").hidden = false;
  $("signed-in").hidden = true;
  $("join-error").textContent = message;
  }
$("sign-out").onclick = async () => {
  try { await api("logout", { method: "POST" }); } catch {}
  saveToken("");
  $("password").value = "";
  showSignedOut();
};

async function submitAuth() {
  const username = $("username").value.trim(), password = $("password").value;
  if (!username || !password) { $("join-error").textContent = "Enter a username and password."; return; }
  $("auth-btn").disabled = true;
  $("join-error").textContent = "";
  try {
    const r = await api(authMode, { method: "POST", body: { username, password } });
    if (!r.ok) { $("join-error").textContent = r.data?.error || `Couldn't ${authMode === "login" ? "sign in" : "create the account"} (error ${r.status}).`; return; }
    saveToken(r.data.token);
    $("password").value = "";
    showSignedIn(r.data.account);
  } catch {
    $("join-error").textContent = `Couldn't reach the server at ${API}. Is it running (npm start)?`;
  } finally {
    $("auth-btn").disabled = false;
  }
}

// --- Character picker (join screen) ---
let lookIndex = 0;
try { lookIndex = Math.max(0, CHARACTERS.findIndex((c) => c.id === localStorage.getItem("fv-look"))); } catch {}
let preview = null;
let chosen = new Set();   // accessory ids the player has on (at most one per slot)
const unlocked = (c) => c.tier !== "premium" || !!account?.unlocks?.includes(c.id);
const accUnlocked = (a) => !!a && (a.tier !== "premium" || !!account?.unlocks?.includes(a.id));
function showLook() {
  const c = CHARACTERS[lookIndex];
  $("pk-name").textContent = c.name;
  $("pk-tier").textContent = c.tier !== "premium" ? "Free" : unlocked(c) ? "Premium · unlocked for you ✓" : "Premium look · locked, you'll play as the default";
  $("pk-tier").className = c.tier === "premium" ? "tier premium" : "tier";
  $("pk-count").textContent = `${lookIndex + 1} / ${CHARACTERS.length}`;
  refreshPreview();
}
function refreshPreview() {
  if (preview) { preview.userData.dispose?.(); scene.remove(preview); }
  preview = makeAvatar({ name: account?.username || "You", look: CHARACTERS[lookIndex].id, recipe: joinRecipe(), accessories: [...chosen] });
  scene.add(preview);
}

// --- Build your own (parts-based characters, shared/parts.js) ---
// "classic" = a whole character from the picker above; "parts" = a recipe from the builder.
let joinMode = "classic";
const partUnlocked = (p) => !!p && (p.tier !== "premium" || !!account?.unlocks?.includes(p.id));
// Part files arrive separately from the code. Until a body's files are installed, say what others will see.
const partsMissing = {};
function partsNote(recipe, fallbackName, builder) {
  const body = recipe.split(";")[0];
  if (!(body in partsMissing)) {
    partsMissing[body] = false;
    cast.partsReady(body).then((ok) => { if (!ok) { partsMissing[body] = true; builder()?.refresh(); } });
  }
  return partsMissing[body] ? `The ${bodyById(body)?.name.toLowerCase() ?? body} body's part files aren't installed on this server yet, so you'll appear as ${fallbackName} (your classic character) for now.` : "";
}
const pkBuilder = createLookBuilder({
  host: $("pk-builder"),
  isUnlocked: partUnlocked,
  onChange: (recipe) => { try { localStorage.setItem("fv-recipe", recipe); } catch {} refreshPreview(); },
  explain: (recipe) => partsNote(recipe, CHARACTERS[lookIndex].name, () => pkBuilder),
});
try { const r = localStorage.getItem("fv-recipe"); if (normalizeRecipe(r)) pkBuilder.set(r); } catch {}
const joinRecipe = () => (joinMode === "parts" ? pkBuilder.get() : "");
function setJoinMode(mode) {
  joinMode = mode;
  $("pk-classic").setAttribute("aria-selected", String(mode === "classic"));
  $("pk-build").setAttribute("aria-selected", String(mode === "parts"));
  // The classic picker stays visible in "parts" mode only as the fallback note; hide it to keep things simple.
  $("pk-picker").hidden = mode !== "classic";
  $("pk-builder").hidden = mode !== "parts";
  if (account) refreshPreview();
}
$("pk-classic").onclick = () => setJoinMode("classic");
$("pk-build").onclick = () => setJoinMode("parts");
$("pk-prev").onclick = () => { lookIndex = (lookIndex + CHARACTERS.length - 1) % CHARACTERS.length; showLook(); };
$("pk-next").onclick = () => { lookIndex = (lookIndex + 1) % CHARACTERS.length; showLook(); };

// Accessory chips: tap to toggle; one per slot (a second in the same slot replaces the first).
// Premium ones you haven't unlocked are shown locked.
function renderAccessories() {
  const host = $("accessories");
  host.replaceChildren();
  for (const a of ACCESSORIES) {
    const b = document.createElement("button");
    b.type = "button";
    const locked = !accUnlocked(a);
    b.className = locked ? "locked" : "";
    b.setAttribute("aria-pressed", String(chosen.has(a.id)));
    b.textContent = a.name;
    if (a.tier === "premium") { const lk = document.createElement("span"); lk.className = "lk"; lk.textContent = locked ? "🔒" : "★"; b.append(lk); }
    b.onclick = () => {
      if (locked) {
        $("join-error").textContent = UNLOCK_PRICES[a.id] != null
          ? `${a.name} is premium: ${UNLOCK_PRICES[a.id]} credits in the 🪙 Shop once you're in the festival.`
          : `${a.name} is a premium accessory.`;
        return;
      }
      if (chosen.has(a.id)) chosen.delete(a.id);
      else { for (const id of [...chosen]) if (accessoryById(id)?.slot === a.slot) chosen.delete(id); chosen.add(a.id); }
      try { localStorage.setItem("fv-accessories", [...chosen].join(",")); } catch {}
      renderAccessories();
      refreshPreview();
    };
    host.append(b);
  }
}
let mp = null;
let me = null;
let quests = null;
let venue = null;
let chat = null;
let moderation = null;
let camps = null;
let shop = null;
let removedText = "";   // why staff removed you, if they did
// Add ?debug to the URL to poke at the game from the browser console (window.__gs).
if (params.has("debug")) window.__gs = { THREE, scene, camera, get mp() { return mp; } };

// --- Change your look mid-game (the 👕 button) ---
let lkIndex = 0, lkChosen = new Set(), lkMode = "classic";
let lkPreview = null;
const lkBuilder = createLookBuilder({
  host: $("lk-builder"),
  isUnlocked: partUnlocked,
  onChange: () => showLkPreview(),
  explain: (recipe) => partsNote(recipe, CHARACTERS[lkIndex].name, () => lkBuilder),
});
function setLkMode(mode) {
  lkMode = mode;
  $("lk-classic").setAttribute("aria-selected", String(mode === "classic"));
  $("lk-build").setAttribute("aria-selected", String(mode === "parts"));
  $("lk-classic-field").hidden = mode !== "classic";
  $("lk-builder").hidden = mode !== "parts";
  showLkPreview();
}
$("lk-classic").onclick = () => setLkMode("classic");
$("lk-build").onclick = () => setLkMode("parts");
// Live 3D preview of what you're picking, in its own little canvas (WebGL can be missing; then skip it).
function showLkPreview() {
  if (!lkPreview) { try { lkPreview = createPreview(THREE, $("lk-preview")); } catch { return; } }
  $("lk-preview").hidden = false;
  $("looks").classList.add("wide");
  lkPreview.show(makeAvatar({ name: account?.username || "You", look: CHARACTERS[lkIndex].id, recipe: lkMode === "parts" ? lkBuilder.get() : "", accessories: [...lkChosen] }));
  lkPreview.start();
}
function closeLooks() {
  $("looks").hidden = true;
  lkPreview?.stop();
  lkPreview?.show(null);
}
function openLooks() {
  if (!mp) return;
  const p = mp.room.state.players.get(mp.room.sessionId);
  lkIndex = Math.max(0, CHARACTERS.findIndex((c) => c.id === p?.look));
  lkChosen = new Set(normalizeAccessories(p?.accessories || "").filter((id) => accUnlocked(accessoryById(id))));
  if (p?.recipe) lkBuilder.set(p.recipe);
  else { try { const r = localStorage.getItem("fv-recipe"); if (normalizeRecipe(r)) lkBuilder.set(r); } catch {} }
  renderLooks();
  $("looks").hidden = false;
  setLkMode(p?.recipe ? "parts" : "classic");
}
function renderLooks() {
  const c = CHARACTERS[lkIndex];
  $("lk-name").textContent = c.name;
  $("lk-tier").textContent = c.tier !== "premium" ? "Free" : unlocked(c) ? "Premium · unlocked ✓" : "Premium · locked, you'll stay as the default";
  const host = $("lk-accessories");
  host.replaceChildren();
  for (const a of ACCESSORIES) {
    const b = document.createElement("button");
    b.type = "button";
    const locked = !accUnlocked(a);
    b.className = locked ? "locked" : "";
    b.setAttribute("aria-pressed", String(lkChosen.has(a.id)));
    b.textContent = a.name;
    if (a.tier === "premium") { const lk = document.createElement("span"); lk.className = "lk"; lk.textContent = locked ? "🔒" : "★"; b.append(lk); }
    b.onclick = () => {
      if (locked) return;
      if (lkChosen.has(a.id)) lkChosen.delete(a.id);
      else { for (const id of [...lkChosen]) if (accessoryById(id)?.slot === a.slot) lkChosen.delete(id); lkChosen.add(a.id); }
      renderLooks();
      showLkPreview();
    };
    host.append(b);
  }
}
$("lk-prev").onclick = () => { lkIndex = (lkIndex + CHARACTERS.length - 1) % CHARACTERS.length; renderLooks(); showLkPreview(); };
$("lk-next").onclick = () => { lkIndex = (lkIndex + 1) % CHARACTERS.length; renderLooks(); showLkPreview(); };
$("lk-close").onclick = closeLooks;
$("looks-btn").onclick = () => ($("looks").hidden ? openLooks() : closeLooks());
$("lk-apply").onclick = () => {
  if (!mp) return;
  // In "Build your own" the classic look is still sent: it's what people without the part files see.
  const look = CHARACTERS[lkIndex].id, accessories = [...lkChosen];
  const recipe = lkMode === "parts" ? lkBuilder.get() : "";
  mp.room.send("appearance", { look, recipe, accessories });
  try {
    localStorage.setItem("fv-look", look); localStorage.setItem("fv-accessories", accessories.join(","));
    if (recipe) localStorage.setItem("fv-recipe", recipe);
  } catch {}
  closeLooks();
};

// --- Join ---
$("join-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!account) return submitAuth();
  const profile = { token, look: CHARACTERS[lookIndex].id, recipe: joinRecipe(), name: account.username, accessories: [...chosen] };
  try { localStorage.setItem("fv-look", profile.look); localStorage.setItem("fv-accessories", profile.accessories.join(",")); } catch {}

  $("join-btn").disabled = true;
  $("join-error").textContent = "";
  $("join-btn").textContent = "Connecting…";
  if (preview) { preview.userData.dispose?.(); scene.remove(preview); preview = null; }
  me = null;
  try {
    mp = await connectMultiplayer({
      url: SERVER_URL, THREE, scene,
      // The server decides your final look (premium looks need unlocking), so build your avatar from its answer.
      localObject: (room) => { me = makeAvatar(room.state.players.get(room.sessionId) ?? profile); scene.add(me); return me; },
      onLocalRebuilt: (obj) => { me = obj; },   // the Looks button changed our avatar; keep our reference current
      getInput: controls.getInput,
      profile: { token: profile.token, look: profile.look, recipe: profile.recipe, accessories: profile.accessories },
      createRemoteAvatar: (p) => makeAvatar(p),
    });
    mp.room.onMessage("removed", (m) => (removedText = m.text));
    // The organizers saved a new layout in the festival builder.
    mp.room.onMessage("layout", () => quests.toast("The festival layout was just updated. Refresh the page to see the new grounds.", "big", 10000));
    mp.room.onLeave((code) => showDisconnected(code));
    quests = setupQuests({ THREE, scene, camera, renderer, mp, makeAvatar });
    venue = setupVenue({ THREE, scene, camera, renderer, mp, stalls, rig, quests, myAvatar: () => me });
    chat = setupChat({ THREE, mp, quests });
    moderation = setupModeration({ mp, quests, chat, account });
    setupReports({ mp, quests, isStaff: moderation.isStaff });
    camps = setupCamps({ THREE, scene, mp });
    shop = setupShop({ mp, toast: quests.toast, account, camps, me: () => mp.room.state.players.get(mp.room.sessionId) });
    emotes?.dispose();
    emotes = setupEmotes({ mp, button: $("dance") });
    const gotRecipe = mp.room.state.players.get(mp.room.sessionId)?.recipe ?? "";
    if (profile.recipe && gotRecipe !== normalizeRecipe(profile.recipe)) {
      // The server swapped premium parts this account hasn't unlocked (or doesn't know a part yet).
      const lost = profile.recipe.split(";").slice(2).map((t) => t.split("=")[1]?.split(":")[0]).filter((id) => id && !gotRecipe.includes(`=${id}:`));
      const names = lost.map((id) => partById(id)?.name ?? id).join(", ");
      if (!gotRecipe) quests.toast("This server doesn't support built characters yet, so you're your classic character. Restart the server (npm start) after updating.", "error", 9000);
      else quests.toast(names ? `${names}: premium, so you got the default for now.` : "The server adjusted your character.");
    }
    const gotLook = mp.room.state.players.get(mp.room.sessionId)?.look;
    if (gotLook && gotLook !== profile.look) {
      const wanted = lookById(profile.look), got = lookById(gotLook)?.name ?? "the default look";
      // Only blame "premium" when it really is a premium look. Otherwise the server is out of date:
      // its character list doesn't match this page (usually an old server still running).
      if (wanted?.tier === "premium") quests.toast(`${wanted.name} is a premium look. You're playing as ${got} for now.`);
      else quests.toast(`The server doesn't know ${wanted?.name ?? "that character"} yet, so you're ${got}. Restart the server (close its window, then npm start).`, "error", 9000);
      console.warn(`Server gave look "${gotLook}" instead of "${profile.look}". If "${profile.look}" is free, the server is running an older shared/characters.js.`);
    }
    $("join").hidden = true;
    $("hud").hidden = false;
    $("dance").hidden = false;
    $("looks-btn").hidden = false;
  } catch (err) {
    console.error(err);
    if (me) scene.remove(me);
    me = null;
    const msg = String(err?.message ?? err ?? "");
    if (mp) { try { mp.leave(); } catch {} mp = null; }
    $("join-btn").disabled = false;
    $("join-btn").textContent = "Enter the festival";
    if (/banned/i.test(msg)) { saveToken(""); return showSignedOut(msg); }
    if (/sign in again|auth/i.test(msg)) { saveToken(""); return showSignedOut("Your sign-in expired. Please sign in again."); }
        // Show the real reason: a connection problem and a bug look very different.
    const network = /connect|websocket|network|failed to fetch|ECONNREFUSED|1006/i.test(msg) || err instanceof Event || !msg;
    $("join-error").textContent = network
      ? `Couldn't reach the server at ${SERVER_URL}. Is it running (npm start)?`
      : `Something went wrong joining: ${msg}`;
  }
});

// Already signed in on this device? Check the saved token is still good.
(async () => {
  if (!token) return showSignedOut();
  try {
    const r = await api("me");
    if (r.ok) return showSignedIn(r.data);
    saveToken("");
    showSignedOut("Your sign-in expired. Please sign in again.");
  } catch {
    showSignedOut(`Couldn't reach the server at ${API}. Is it running (npm start)?`);
  }
})();

// Emotes (the Emote button, keys 1-9, Space to jump, E to dance): client/emote-ui.js.
let emotes = null;
// After you click or tap a button, let go of it: otherwise pressing Enter (to chat) "clicks" it again.
// Keyboard presses (detail 0) keep focus, so keyboard-only players can still tab through buttons.
document.addEventListener("click", (e) => { if (e.detail > 0) e.target.closest?.("button")?.blur(); }, true);

function showDisconnected(code) {
  // 4100: this account signed in from another window or device, which takes over.
  // 4101 kicked / 4102 banned by festival staff (the server sends the reason just before).
  $("hud-status").textContent = code === 4100 ? "You signed in somewhere else. Refresh to play here."
    : (code === 4101 || code === 4102) && removedText ? removedText
    : "Disconnected. Refresh to rejoin.";
  $("hud-status").classList.add("bad");
}

// --- Game loop ---
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);   // clamp so a background tab doesn't cause a huge jump

  if (mp && me) {
    mp.update(dt);
    quests?.update(dt);
    venue?.update(dt);
    chat?.update(dt);
    camps?.update(dt);
    shop?.update(dt);
    moderation?.update();
    rig.update(dt, me.position);   // camera follows you; scroll / pinch / +/- to zoom
    $("hud-online").textContent = `${mp.onlineCount()} online`;
    emotes?.update();   // keep the Emote menu in sync with the server (moving ends a dance)
  } else {
    // Join screen: slowly circle the character you're picking.
    // Frame the character beside the form on wide screens, above it on phones.
    const t = clock.elapsedTime * 0.25;
    const wide = innerWidth >= 800;
    const shift = wide ? 1.1 : 0;                   // look a bit to the right so the character sits left
    camera.position.set(Math.sin(t) * 4.2, 1.9, Math.cos(t) * 4.2);
    camera.lookAt(Math.cos(t) * shift, wide ? 1.05 : 0.15, -Math.sin(t) * shift);
    preview?.userData.animate?.(dt, 0, "dance");
  }
  renderer.render(scene, camera);
});

