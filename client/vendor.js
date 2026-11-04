// The vendor edit page: vendor.html?v=<stall id>#key=<private edit key>
// Loads the stall's listing from the game server, lets the vendor edit it with a live preview,
// and saves it. Every player in the game sees the change as soon as it's saved.
import { sanitizeListing, upcoming, formatDates, formatPrice, localDate, LIMITS } from "../shared/listings.js";
import { ZONE_LABELS } from "../shared/venue.js";
import { TRUCK, sanitizeTruck } from "../shared/truck-data.js";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const id = params.get("v") || "";
// The API lives on the game server. Opened from the dev page server (port 5173) it's on 2567 of the
// same machine; opened from the game server itself it's this same address. ?api= overrides both.
const API = (params.get("api") || (location.port === "5173" ? `${location.protocol}//${location.hostname}:2567` : location.origin)).replace(/\/+$/, "");

// The key rides in the #fragment so it never reaches a server log. Remember it on this device
// so the vendor can come back to plain vendor.html?v=... later.
const storeKey = `fv-vendor-key:${id}`;
let key = new URLSearchParams(location.hash.slice(1)).get("key") || "";
try { if (key) localStorage.setItem(storeKey, key); else key = localStorage.getItem(storeKey) || ""; } catch {}

let stall = null;       // layout facts: zone, kind, color
let model = null;       // what's being edited
let saved = "";         // JSON of the last saved version, to spot unsaved changes
let saving = false;

start();

async function start() {
  if (!id) return problem("Missing stall", "This page needs the full edit link the festival sent you.");
  if (!key) return problem("Missing edit key", "Open the full edit link the festival sent you. It ends with #key=…");
  let res;
  try {
    res = await fetch(`${API}/api/vendors/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${key}` } });
  } catch {
    return problem("Can't reach the festival", "The game server isn't answering. Check your connection and try again in a minute.");
  }
  const body = await res.json().catch(() => ({}));
  if (res.status === 404) return problem("Stall not found", "This link points at a stall that doesn't exist. Ask the festival for a new link.");
  if (!res.ok) return problem("Something went wrong", body.error || `The server said ${res.status}.`);
  if (!body.canEdit) {
    try { localStorage.removeItem(storeKey); } catch {}
    return problem("This link doesn't work anymore", "Edit links stop working when the festival makes a new one. Ask them to send you a fresh link.");
  }
  stall = { zone: body.zone, zoneLabel: body.zoneLabel, kind: body.kind, color: body.color };
  load(body);
  $("loading").hidden = true;
  $("editor").hidden = false;
  $("bar").hidden = false;
  setStatus(body.updatedAt ? `Last saved ${ago(body.updatedAt)}` : "Not edited yet. This is the festival's starting version.");
}

function load(l) {
  model = {
    name: l.name ?? "", tagline: l.tagline ?? "", link: l.link ?? "",
    items: (l.items ?? []).map((it) => ({ name: it.name ?? "", price: it.price ?? "" })),
    next: (l.next ?? []).map((s) => ({ event: s.event ?? "", where: s.where ?? "", start: s.start ?? "", end: s.end ?? "" })),
    truck: l.truck ? { ...l.truck } : null,
  };
  saved = snapshot();
  $("where").textContent = `${stall.zoneLabel ?? ZONE_LABELS[stall.zone] ?? ""} · ${stall.kind === "food" ? "Food" : "Goods"}`;
  $("items-title").textContent = stall.kind === "food" ? "Menu" : "What you sell";
  $("f-name").value = model.name;
  $("title").textContent = model.name || "Your stall";
  $("f-tagline").value = model.tagline;
  $("f-link").value = model.link;
  renderItems();
  renderStops();
  setupTruck();   // food stalls get the truck designer; others hide it
  changed();
}

// ---------- Fields ----------
$("f-name").addEventListener("input", (e) => { model.name = e.target.value; $("title").textContent = model.name.trim() || "Your stall"; truckScene?.setName(model.name); changed(); });
$("f-tagline").addEventListener("input", (e) => { model.tagline = e.target.value; changed(); });
$("f-link").addEventListener("input", (e) => { model.link = e.target.value; changed(); });

// ---------- Menu rows ----------
$("add-item").onclick = () => {
  if (model.items.length >= LIMITS.items) return setStatus(`Up to ${LIMITS.items} items.`, "bad");
  model.items.push({ name: "", price: "" });
  renderItems();
  $("items").lastElementChild?.querySelector("input")?.focus();
  changed();
};
function renderItems() {
  const box = $("items");
  box.replaceChildren();
  if (!model.items.length) box.append(el("p", { className: "empty", textContent: "Nothing listed yet. Add your first item." }));
  model.items.forEach((it, i) => {
    const row = el("div", { className: "item" });
    const name = el("input", { value: it.name, maxLength: LIMITS.itemName, placeholder: "Item name", ariaLabel: `Item ${i + 1} name` });
    name.oninput = () => { it.name = name.value; changed(); };
    const priceWrap = el("div", { className: "price" });
    const price = el("input", { value: it.price === "" ? "" : String(it.price), inputMode: "decimal", placeholder: "Price", ariaLabel: `Item ${i + 1} price` });
    price.oninput = () => { it.price = price.value; changed(); };
    priceWrap.append(price);
    const up = el("button", { type: "button", className: "icon up", textContent: "↑", title: "Move up", ariaLabel: `Move item ${i + 1} up`, disabled: i === 0 });
    up.onclick = () => { [model.items[i - 1], model.items[i]] = [model.items[i], model.items[i - 1]]; renderItems(); changed(); };
    const del = el("button", { type: "button", className: "icon", textContent: "×", title: "Remove", ariaLabel: `Remove item ${i + 1}` });
    del.onclick = () => { model.items.splice(i, 1); renderItems(); changed(); };
    row.append(name, priceWrap, up, del);
    box.append(row);
  });
}

// ---------- Upcoming stops ----------
$("add-stop").onclick = () => {
  if (model.next.length >= LIMITS.next) return setStatus(`Up to ${LIMITS.next} stops.`, "bad");
  model.next.push({ event: "", where: "", start: "", end: "" });
  renderStops();
  $("stops").lastElementChild?.querySelector("input")?.focus();
  changed();
};
function renderStops() {
  const box = $("stops");
  box.replaceChildren();
  if (!model.next.length) box.append(el("p", { className: "empty", textContent: "No stops added. Add where players can find you next." }));
  const today = localDate();
  model.next.forEach((s, i) => {
    const past = (s.end || s.start) && (s.end || s.start) < today;
    const card = el("div", { className: "stop" + (past ? " past" : "") });
    const top = el("div", { className: "top" });
    const event = el("input", { value: s.event, maxLength: LIMITS.event, placeholder: "Event name", ariaLabel: `Stop ${i + 1} event` });
    event.oninput = () => { s.event = event.value; changed(); };
    const del = el("button", { type: "button", className: "icon", textContent: "×", title: "Remove", ariaLabel: `Remove stop ${i + 1}` });
    del.onclick = () => { model.next.splice(i, 1); renderStops(); changed(); };
    top.append(event, del);
    const where = el("input", { value: s.where, maxLength: LIMITS.where, placeholder: "City, State", ariaLabel: `Stop ${i + 1} location` });
    where.oninput = () => { s.where = where.value; changed(); };
    const dates = el("div", { className: "dates" });
    const startL = el("label", { textContent: "Starts" }), endL = el("label", { textContent: "Ends (optional)" });
    const start = el("input", { type: "date", value: s.start });
    const end = el("input", { type: "date", value: s.end, min: s.start });
    start.onchange = () => { s.start = start.value; end.min = start.value; if (s.end && s.end < s.start) { s.end = ""; end.value = ""; } renderStopTag(); changed(); };
    end.onchange = () => { s.end = end.value; renderStopTag(); changed(); };
    startL.append(start); endL.append(end);
    dates.append(startL, endL);
    const tag = el("span", { className: "tag" });
    const renderStopTag = () => {
      const isPast = (s.end || s.start) && (s.end || s.start) < localDate();
      card.classList.toggle("past", !!isPast);
      tag.textContent = isPast ? "Already happened, hidden from players" : "";
    };
    renderStopTag();
    card.append(top, where, dates, tag);
    box.append(card);
  });
}

// ---------- Food truck designer ----------
// Only food stalls get a truck. `truckDraft` is always a full design; model.truck holds the tidy
// version (null when it's all defaults) that gets saved.
let truckDraft = null;
let truckScene = null;        // { setTruck, setName } once the 3D preview is ready
const COLOR_FIELDS = [["body", "Body"], ["awning", "Awning"], ["stripe", "Stripe"], ["trim", "Trim & wheels"]];

function setupTruck() {
  const box = $("truck-box");
  if (stall.kind !== "food") { box.hidden = true; return; }
  box.hidden = false;
  truckDraft = { ...TRUCK.defaults, awning: stall.color, stripe: stall.color, ...(model.truck || {}) };
  buildTruckControls();
  ensureTruckScene();
}

function commitTruck() {
  model.truck = sanitizeTruck(truckDraft);
  truckScene?.setTruck({ name: model.name, color: stall.color, truck: truckDraft });
  changed();
}

function buildTruckControls() {
  const host = $("truck-controls");
  host.replaceChildren();
  for (const [key, label] of COLOR_FIELDS) {
    const wrap = el("div", { className: "tctl" });
    wrap.append(el("label", { textContent: label }));
    const row = el("div", { className: "swatches" });
    for (const c of TRUCK.swatches) {
      const b = el("button", { type: "button", className: "sw", title: c });
      b.style.background = c;
      b.setAttribute("aria-pressed", String(truckDraft[key] === c));
      b.onclick = () => { truckDraft[key] = c; syncSwatches(key, row, custom); commitTruck(); };
      row.append(b);
    }
    const custom = el("input", { type: "color", value: truckDraft[key], title: "Custom color" });
    custom.oninput = () => { truckDraft[key] = custom.value; syncSwatches(key, row, custom); commitTruck(); };
    row.append(custom);
    wrap.append(row);
    host.append(wrap);
  }
  const tctl = el("div", { className: "tctl" });
  tctl.append(el("label", { textContent: "Roof topper" }));
  const sel = el("select");
  for (const [id, name] of TRUCK.toppers) sel.append(el("option", { value: id, textContent: name, selected: truckDraft.topper === id }));
  sel.onchange = () => { truckDraft.topper = sel.value; commitTruck(); };
  tctl.append(sel);
  host.append(tctl);
}
function syncSwatches(key, row, custom) {
  for (const sw of row.querySelectorAll(".sw")) sw.setAttribute("aria-pressed", String(sw.title === truckDraft[key]));
  custom.value = truckDraft[key];
}

$("truck-reset").onclick = () => {
  truckDraft = { ...TRUCK.defaults, awning: stall.color, stripe: stall.color };
  buildTruckControls();
  commitTruck();
};

// Lazy 3D preview: a small rotating scene using the real in-game truck model.
async function ensureTruckScene() {
  if (truckScene) { truckScene.setTruck({ name: model.name, color: stall.color, truck: truckDraft }); return; }
  let THREE, buildTruck;
  try {
    THREE = await import("three");
    ({ buildTruck } = await import("./truck.js"));
  } catch { $("truck3d").textContent = ""; return; }   // no preview if three can't load; controls still work
  const host = $("truck3d");
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  host.replaceChildren(renderer.domElement);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight("#ffffff", "#444466", 1.5));
  const sun = new THREE.DirectionalLight("#fff", 1.4); sun.position.set(6, 10, 6); scene.add(sun);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  let group = null;
  const rebuild = (opts) => { if (group) { scene.remove(group); group.traverse((o) => { o.geometry?.dispose?.(); }); } group = buildTruck(THREE, opts); scene.add(group); };
  rebuild({ name: model.name, color: stall.color, truck: truckDraft });

  let yaw = 0.7, pitch = 0.5, drag = null, auto = true;
  host.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, y: e.clientY, yaw, pitch }; auto = false; host.setPointerCapture(e.pointerId); });
  host.addEventListener("pointermove", (e) => { if (!drag) return; yaw = drag.yaw + (e.clientX - drag.x) * 0.01; pitch = Math.max(0.1, Math.min(1.2, drag.pitch - (e.clientY - drag.y) * 0.01)); });
  host.addEventListener("pointerup", () => (drag = null));
  const size = () => { const r = host.getBoundingClientRect(); if (r.width) { renderer.setSize(r.width, r.height); camera.aspect = r.width / r.height; camera.updateProjectionMatrix(); } };
  size(); addEventListener("resize", size);
  renderer.setAnimationLoop(() => {
    if (auto) yaw += 0.004;
    const d = 13;
    camera.position.set(Math.sin(yaw) * d, 2.5 + pitch * 4, Math.cos(yaw) * d);
    camera.lookAt(0, 2.2, 0);
    renderer.render(scene, camera);
  });
  truckScene = { setTruck: rebuild, setName: (n) => group?.userData.setName?.(n) };
}

// ---------- Preview + status ----------
function changed() {
  $("tagline-count").textContent = `${model.tagline.length} / ${LIMITS.tagline}`;
  renderPreview();
  if (!saving) {
    const dirty = snapshot() !== saved;
    $("save").disabled = !dirty;
    if (dirty) setStatus("Unsaved changes");
  }
}

function renderPreview() {
  const p = $("preview");
  p.replaceChildren();
  const who = el("div", { className: "who", textContent: `${stall.zoneLabel ?? ZONE_LABELS[stall.zone] ?? ""} · ${stall.kind === "food" ? "Food" : "Goods"}` });
  const h = el("h3");
  h.append(el("i", { style: `background:${stall.color}` }), document.createTextNode(model.name.trim() || "Your stall name"));
  p.append(who, h);
  if (model.tagline.trim()) p.append(el("p", { textContent: model.tagline.trim() }));
  p.append(el("h4", { textContent: stall.kind === "food" ? "Menu" : "What they sell" }));
  const menu = el("ul", { className: "menu" });
  const items = model.items.filter((it) => it.name.trim());
  if (!items.length) menu.append(el("li", { className: "none", textContent: "Nothing listed yet." }));
  for (const it of items) {
    const li = el("li");
    li.append(el("span", { textContent: it.name.trim() }));
    const n = Number(String(it.price).replace(/[$,\s]/g, ""));
    if (String(it.price).trim() !== "" && Number.isFinite(n) && n >= 0) li.append(el("b", { textContent: formatPrice(Math.round(n * 100) / 100) }));
    menu.append(li);
  }
  p.append(menu, el("h4", { textContent: "Where they'll be next" }));
  const next = el("ul", { className: "next" });
  const stops = upcoming(model.next.filter((s) => s.event.trim() && s.start));
  if (!stops.length) next.append(el("li", { className: "none", textContent: "No dates posted yet." }));
  for (const s of stops) {
    const li = el("li");
    const what = el("span", { textContent: s.event.trim() });
    if (s.where.trim()) what.append(el("small", { textContent: s.where.trim() }));
    li.append(el("b", { textContent: formatDates(s.start, s.end) }), what);
    next.append(li);
  }
  p.append(next);
  if (model.link.trim()) p.append(el("span", { className: "site", textContent: "Website ↗", title: model.link.trim() }));
}

function setStatus(text, kind = "") {
  $("status").textContent = text;
  $("status").className = kind;
}

// ---------- Save ----------
$("save").onclick = save;
addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); if (!$("save").disabled) save(); }
});
async function save() {
  const { error } = sanitizeListing(model);   // same rules as the server: catch problems before sending
  if (error) return setStatus(error, "bad");
  saving = true;
  $("save").disabled = true;
  $("save").textContent = "Saving…";
  setStatus("");
  try {
    const res = await fetch(`${API}/api/vendors/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(model),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { setStatus(body.error || `Couldn't save (error ${res.status}).`, "bad"); $("save").disabled = false; return; }
    load(body);                                   // show exactly what the server kept (trimmed, sorted, etc.)
    setStatus("Saved. It's live in the game now.", "good");
  } catch {
    setStatus("Couldn't reach the server. Your changes are still here; try again.", "bad");
    $("save").disabled = false;
  } finally {
    saving = false;
    $("save").textContent = "Save";
  }
}

addEventListener("beforeunload", (e) => { if (model && snapshot() !== saved) { e.preventDefault(); e.returnValue = ""; } });

// ---------- Helpers ----------
function snapshot() { return JSON.stringify(model); }

function problem(title, text) {
  $("loading").hidden = true;
  $("problem").hidden = false;
  $("problem-title").textContent = title;
  $("problem-text").textContent = text;
}

function el(tag, props = {}) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "ariaLabel") e.setAttribute("aria-label", v);
    else if (k === "style") e.setAttribute("style", v);
    else e[k] = v;
  }
  return e;
}

function ago(iso) {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (!Number.isFinite(s)) return "";
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} minutes ago`;
  if (s < 86400) return `${Math.round(s / 3600)} hours ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
