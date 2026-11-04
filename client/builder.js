// The festival builder: a top-down map you edit, plus a walk-around 3D preview.
// It reads and writes the same layout the game uses (shared/layout.js), through the server's
// /api/layout (organizers only). Publishing tells everyone in the game to refresh.
import * as THREE from "three";
import { TYPES, FENCE, GATE, sanitizeLayout, defaultLayout, facing, rad } from "../shared/layout.js";
import { CATALOG, applyLayout, LAYOUT, VENDORS } from "../shared/venue.js";
import { GIVERS, AMBIENT } from "../shared/quests-data.js";
import { drawMap, fitCanvas } from "./map.js";
import { buildFestival, disposeFestival } from "./world.js";

const $ = (id) => document.getElementById(id);
const API = new URLSearchParams(location.search).get("api") || (location.port === "5173" ? `${location.protocol}//${location.hostname}:2567/api` : "/api");
const PEOPLE = Object.fromEntries([...GIVERS, ...AMBIENT].map((p) => [p.id, p.name + (GIVERS.includes(p) ? " (quest giver)" : "")]));
const REQUIRED = GIVERS.map((g) => g.id);
const rules = { knownRefs: Object.keys(PEOPLE), requiredRefs: REQUIRED };

let token = "";
try { token = localStorage.getItem("fv-token") || ""; } catch {}
const saveToken = (t) => { token = t; try { t ? localStorage.setItem("fv-token", t) : localStorage.removeItem("fv-token"); } catch {} };
const authed = (extra = {}) => ({ "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra });

let toastTimer = 0;
function toast(msg, ms = 3200) {
  $("toast").textContent = msg; $("toast").classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $("toast").classList.remove("show"), ms);
}

// ---------- Sign in as an organizer ----------
async function checkAdmin() {
  if (!token) return false;
  try { const r = await fetch(`${API}/me`, { headers: authed() }); return r.ok && (await r.json()).role === "admin"; } catch { return false; }
}
$("g-go").onclick = async () => {
  const username = $("g-user").value.trim(), password = $("g-pass").value;
  $("g-err").textContent = "";
  try {
    const r = await fetch(`${API}/login`, { method: "POST", headers: authed(), body: JSON.stringify({ username, password }) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return ($("g-err").textContent = data.error || "Couldn't sign in.");
    if (data.account.role !== "admin") return ($("g-err").textContent = "That account isn't a festival organizer. Ask the owner to run: npm run account -- make-admin " + data.account.username);
    saveToken(data.token); start();
  } catch { $("g-err").textContent = `Couldn't reach the server at ${API}.`; }
};
$("g-pass").addEventListener("keydown", (e) => e.key === "Enter" && $("g-go").click());

// ---------- Layout state, with undo ----------
let layout = defaultLayout();     // { version, items }
let selected = null;              // item id
let dirty = false;
const undoStack = [], redoStack = [];

function snapshot() { undoStack.push(JSON.stringify(layout)); if (undoStack.length > 100) undoStack.shift(); redoStack.length = 0; }
function commit({ preview = true, dirty: d = true } = {}) {
  dirty = d;
  applyLayout(layout);            // keep VENDORS/zones in sync so the map colors and names are right
  draw();
  if (preview && mode === "3d") rebuild3d();
  syncSaved();
  syncProps();
}
function undo() { if (!undoStack.length) return; redoStack.push(JSON.stringify(layout)); layout = JSON.parse(undoStack.pop()); selected = null; commit(); }
function redo() { if (!redoStack.length) return; undoStack.push(JSON.stringify(layout)); layout = JSON.parse(redoStack.pop()); selected = null; commit(); }

const itemById = (id) => layout.items.find((i) => i.id === id);
function syncSaved() {
  $("btn-undo").disabled = !undoStack.length; $("btn-redo").disabled = !redoStack.length;
  $("saved").textContent = dirty ? "Unpublished changes" : (published ? `Published ${new Date(published).toLocaleString()}` : "");
}
let published = null;

// ---------- Palette ----------
function buildPalette() {
  $("pal").innerHTML = Object.entries(TYPES).map(([type, t]) =>
    `<button data-type="${type}"><span class="i">${t.icon}</span>${t.label}</button>`).join("");
  $("pal").onclick = (e) => { const b = e.target.closest("[data-type]"); if (b) placing = placing === b.dataset.type ? null : b.dataset.type, hint(), highlightPalette(); };
}
let placing = null;
const highlightPalette = () => { for (const b of $("pal").children) b.classList.toggle("primary", b.dataset.type === placing); };

// ---------- Vendor ids (for new vendors made in the builder) ----------
const VENDOR_ID = /^[a-z0-9][a-z0-9-]{1,23}$/;
const isCustomVendor = (id) => !!id && !CATALOG[id];              // a vendor typed here, not from the catalog
const slugify = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "stall";
function vendorTaken(id, exceptId) {
  return !!CATALOG[id] || layout.items.some((i) => i.type === "stall" && i.vendor === id && i.id !== exceptId);
}
function freshVendorId(from = "vendor") {
  let base = slugify(from), id = base, n = 2;
  if (base.length < 2) base = "vendor";
  while (vendorTaken(id)) id = `${base}-${n++}`;
  return id;
}

// A fresh item of a type at (x, z), with sensible defaults.
let addN = 0;
function newItem(type, x, z) {
  const id = `${type}_${Date.now().toString(36)}${addN++}`;
  const base = { id, type, x: round1(x), z: round1(z), rot: 0 };
  switch (type) {
    case "stage": return { ...base, variant: "side", label: "New Stage" };
    case "stall": { const free = Object.keys(CATALOG).find((v) => !layout.items.some((i) => i.type === "stall" && i.vendor === v)) || freshVendorId(); return { ...base, style: "booth", vendor: free }; }
    case "area": return { ...base, w: 24, d: 20, color: "#9b7b52", label: "New Area" };
    case "arch": return { ...base, text: "WELCOME", w: 12, color: "#ff4fa3" };
    case "lights": return { ...base, w: 30, d: 10 };
    case "lamp": return { ...base, color: "#ffd9a0" };
    case "pathring": return { ...base, r: 20 };
    case "tent": return { ...base, color: "#f2994a", orders: false };
    case "npc": { const free = Object.keys(PEOPLE).find((r) => !layout.items.some((i) => i.type === "npc" && i.ref === r)) || REQUIRED[0]; return { ...base, ref: free }; }
    case "spot": return { ...base, where: "somewhere on the grounds" };
    default: return base;
  }
}

// ---------- 2D map + editing ----------
const cv = $("map2d");
let view = { cx: 0, cz: 0, scale: 3.4 };
let mode = "2d";

function draw() {
  const { ctx, w, h } = fitCanvas(cv);
  const scale = view.scale;
  drawMap(ctx, { cx: view.cx, cz: view.cz, scale, w, h, labels: scale >= 2.6, trees: true }, { players: [] }, layout, VENDORS);
  // Outline the selected item.
  const it = selected && itemById(selected);
  if (it) {
    const [rw, rd] = TYPES[it.type].size(it);
    const X = (x) => w / 2 + (x - view.cx) * scale, Z = (z) => h / 2 + (z - view.cz) * scale;
    ctx.save(); ctx.translate(X(it.x), Z(it.z)); ctx.rotate(rad(it.rot || 0));
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.setLineDash([5, 4]);
    ctx.strokeRect(-rw * scale / 2 - 3, -rd * scale / 2 - 3, rw * scale + 6, rd * scale + 6);
    ctx.setLineDash([]);
    // a little nub showing which way it faces (front = +z at rot 0)
    ctx.fillStyle = "#4fe3ff"; ctx.beginPath(); ctx.arc(0, rd * scale / 2 + 8, 4, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}

const toWorld = (px, py) => { const r = cv.getBoundingClientRect(); return { x: view.cx + (px - r.left - r.width / 2) / view.scale, z: view.cz + (py - r.top - r.height / 2) / view.scale }; };

// Topmost item at a world point (small things win over big areas).
function pick(x, z) {
  const hits = layout.items.filter((it) => {
    const [w, d] = TYPES[it.type].size(it), a = -rad(it.rot || 0), dx = x - it.x, dz = z - it.z;
    const lx = dx * Math.cos(a) - dz * Math.sin(a), lz = dx * Math.sin(a) + dz * Math.cos(a);
    const pad = it.type === "npc" || it.type === "lamp" || it.type === "spot" || it.type === "tent" || it.type === "tree" ? 1.5 : 0.5;
    return Math.abs(lx) <= w / 2 + pad && Math.abs(lz) <= d / 2 + pad;
  });
  const area = (it) => TYPES[it.type].size(it).reduce((a, b) => a * b, 1);
  return hits.sort((a, b) => area(a) - area(b))[0] ?? null;
}

let drag = null;   // { id, dxWorld, dzWorld } or { pan: true, ... }
cv.addEventListener("pointerdown", (e) => {
  cv.setPointerCapture(e.pointerId);
  const p = toWorld(e.clientX, e.clientY);
  if (placing) {
    snapshot();
    const it = newItem(placing, clampF(p.x), clampF(p.z));
    layout.items.push(it); selected = it.id;
    if (!e.shiftKey) { placing = null; highlightPalette(); hint(); }
    commit();
    return;
  }
  const hit = pick(p.x, p.z);
  if (hit) { selected = hit.id; drag = { id: hit.id, ox: p.x - hit.x, oz: p.z - hit.z, moved: false }; syncProps(); draw(); }
  else { selected = null; drag = { pan: true, sx: e.clientX, sy: e.clientY, cx: view.cx, cz: view.cz }; syncProps(); draw(); }
});
cv.addEventListener("pointermove", (e) => {
  if (!drag) { if (!placing) { const p = toWorld(e.clientX, e.clientY); cv.style.cursor = pick(p.x, p.z) ? "move" : "grab"; } else cv.style.cursor = "crosshair"; return; }
  const p = toWorld(e.clientX, e.clientY);
  if (drag.pan) { const r = cv.getBoundingClientRect(); view.cx = drag.cx - (e.clientX - drag.sx) / view.scale; view.cz = drag.cz - (e.clientY - drag.sy) / view.scale; draw(); return; }
  const it = itemById(drag.id); if (!it) return;
  if (!drag.moved) { snapshot(); drag.moved = true; }
  it.x = round1(clampF(p.x - drag.ox)); it.z = round1(clampF(p.z - drag.oz));
  applyLayout(layout); draw(); syncProps();
});
const endDrag = () => { if (drag && drag.moved) commit(); drag = null; };
cv.addEventListener("pointerup", endDrag);
cv.addEventListener("pointercancel", endDrag);
cv.addEventListener("wheel", (e) => { e.preventDefault(); const f = e.deltaY < 0 ? 1.12 : 1 / 1.12; view.scale = Math.min(14, Math.max(1.4, view.scale * f)); draw(); }, { passive: false });

const clampF = (v) => Math.min(FENCE - 1, Math.max(-(FENCE - 1), v));
const round1 = (v) => Math.round(v * 10) / 10;

// ---------- Property panel ----------
function syncProps() {
  const it = selected && itemById(selected);
  if (!it) { $("props-title").textContent = "Nothing selected"; $("props-body").innerHTML = `<p class="muted">Click something on the map to edit it, or pick a piece from the left to add one.</p>`; return; }
  const t = TYPES[it.type];
  $("props-title").textContent = `${t.icon} ${t.label}`;
  const f = [];
  const num = (key, label, min, max, step = 1) => `<div class="field"><label>${label}</label><input type="number" data-k="${key}" value="${it[key] ?? 0}" min="${min}" max="${max}" step="${step}"></div>`;
  const txt = (key, label, ph = "") => `<div class="field"><label>${label}</label><input type="text" data-k="${key}" value="${(it[key] ?? "").toString().replace(/"/g, "&quot;")}" placeholder="${ph}"></div>`;
  const col = (key, label) => `<div class="field"><label>${label}</label><input type="color" data-k="${key}" value="${it[key] ?? "#ffffff"}"></div>`;
  const check = (key, label) => `<div class="field check"><input type="checkbox" data-k="${key}" ${it[key] ? "checked" : ""}><label style="margin:0">${label}</label></div>`;
  const sel = (key, label, opts) => `<div class="field"><label>${label}</label><select data-k="${key}">${opts.map(([v, n]) => `<option value="${v}" ${it[key] === v ? "selected" : ""}>${n}</option>`).join("")}</select></div>`;

  if (it.type === "stall") { f.push(...stallFields(it, { sel, col, txt })); }
  else for (const field of t.fields) {
    if (field === "variant") f.push(sel("variant", "Kind of stage", [["main", "Main stage (big)"], ["side", "Side stage (small)"]]));
    else if (field === "ref") f.push(sel("ref", "Character", Object.entries(PEOPLE)));
    else if (field === "color") f.push(col("color", "Color"));
    else if (field === "label") f.push(txt("label", "Label on the map"));
    else if (field === "text") f.push(txt("text", "Sign text"));
    else if (field === "where") f.push(txt("where", "Hint (\"beside the main stage\")"));
    else if (field === "w") f.push(num("w", "Width (m)", 2, 198, 1));
    else if (field === "d") f.push(num("d", "Depth (m)", 2, 198, 1));
    else if (field === "r") f.push(num("r", "Radius (m)", 5, 90, 1));
    else if (field === "orders") f.push(check("orders", "Takes taco orders (Vendor Rush)"));
  }
  f.push(`<div class="field"><label>Turn (degrees)</label><input type="number" data-k="rot" value="${it.rot || 0}" step="15"></div>`);
  f.push(`<div class="row" style="margin-top:6px"><button id="p-rotate" class="ghost">Rotate 90°</button><button id="p-dup" class="ghost">Duplicate</button></div>`);
  f.push(`<div class="row" style="margin-top:6px"><button id="p-del" class="danger">Delete</button></div>`);
  if (it.type === "npc" && REQUIRED.includes(it.ref)) f.push(`<p class="muted" style="margin-top:8px">${PEOPLE[it.ref]} — this quest giver can be moved but not removed.</p>`);
  $("props-body").innerHTML = f.join("");

  for (const el of $("props-body").querySelectorAll("[data-k]")) {
    el.onchange = () => {
      snapshot();
      const k = el.dataset.k;
      let v = el.type === "checkbox" ? el.checked : el.type === "number" ? Number(el.value) : el.value;
      if (k === "ref") {   // no two npcs share a character
        if (layout.items.some((o) => o !== it && o.type === it.type && o[k] === v)) { toast("That character is already placed."); syncProps(); return; }
      }
      it[k] = v;
      commit();
    };
  }
  if (it.type === "stall") wireStall(it);
  $("p-rotate").onclick = () => { snapshot(); it.rot = (((it.rot || 0) + 90 + 180) % 360) - 180; commit(); };
  $("p-dup").onclick = () => {
    snapshot();
    const c = { ...it, id: `${it.type}_${Date.now().toString(36)}${addN++}`, x: clampF(it.x + 4), z: clampF(it.z + 4) };
    // A stall's vendor and an NPC's character are one-per-festival, so a copy needs a free one.
    if (c.type === "stall") {
      if (isCustomVendor(it.vendor)) { c.vendor = freshVendorId(it.name || "vendor"); c.name = (it.name || "New Vendor") + " copy"; }   // keep the menu, new id
      else { const free = Object.keys(CATALOG).find((v) => !layout.items.some((i) => i.type === "stall" && i.vendor === v)); if (!free) return toast("Every catalog vendor is already placed. Make a new vendor instead."); c.vendor = free; delete c.name; }
    }
    if (c.type === "npc") { const free = Object.keys(PEOPLE).find((r) => !layout.items.some((i) => i.type === "npc" && i.ref === r)); if (!free) return toast("Every character is already placed."); c.ref = free; }
    layout.items.push(c); selected = c.id; commit();
  };
  $("p-del").onclick = () => {
    if (it.type === "npc" && REQUIRED.includes(it.ref)) return toast(`${PEOPLE[it.ref]} runs a quest and can't be removed.`);
    snapshot(); layout.items = layout.items.filter((o) => o !== it); selected = null; commit();
  };
}

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// The panel for a stall: pick an existing vendor, or make a new one with its own name and menu.
function stallFields(it, { sel, col, txt }) {
  const out = [sel("style", "Stall style", [["booth", "Food truck / booth"], ["tent", "Pop-up tent"]])];
  const opts = [["__new__", "➕ New vendor…"], ...Object.keys(CATALOG).map((v) => [v, CATALOG[v].name])];
  if (isCustomVendor(it.vendor)) opts.push([it.vendor, `${it.name || it.vendor} (new)`]);
  out.push(`<div class="field"><label>Vendor</label><select data-vendor-select>${opts.map(([v, n]) => `<option value="${v}" ${it.vendor === v ? "selected" : ""}>${esc(n)}</option>`).join("")}</select></div>`);

  if (isCustomVendor(it.vendor)) {
    out.push(txt("name", "Vendor name"));
    out.push(`<div class="field"><label>Short id (used in their edit link)</label><input type="text" data-vendor-id value="${esc(it.vendor)}" maxlength="24" autocapitalize="off" spellcheck="false"></div>`);
    out.push(txt("tagline", "Tagline (one line)"));
    out.push(sel("kind", "Sells", [["food", "Food"], ["goods", "Goods"]]));
    out.push(col("color", "Color"));
    out.push(menuEditor(it));
    out.push(`<p class="muted" style="margin-top:2px">This is the starting menu. Once you publish, the vendor can keep it up to date with their own edit link (<code>npm run vendor-link -- ${esc(it.vendor)}</code>).</p>`);
  } else {
    out.push(`<p class="muted" style="margin:2px 0 8px">Menu and upcoming stops come from ${esc(CATALOG[it.vendor]?.name || it.vendor)} — they edit those with their vendor link.</p>`);
    out.push(txt("name", "Name shown (optional override)"));
    out.push(col("color", "Color (optional override)"));
  }
  return out;
}

function menuEditor(it) {
  const rows = (it.items || []).map((m, i) => `
    <div class="menu-row" data-i="${i}">
      <input type="text" data-mn value="${esc(m.name)}" placeholder="${it.kind === "goods" ? "Item" : "Dish"}">
      <input type="text" data-mp value="${m.price ?? ""}" placeholder="$" inputmode="decimal">
      <button type="button" data-mrm title="Remove">✕</button>
    </div>`).join("");
  return `<div class="field"><label>Menu ${it.kind === "goods" ? "(what they sell)" : "(dishes & prices)"}</label>
    <div id="menu-rows">${rows || '<p class="muted" style="margin:0 0 6px">No items yet.</p>'}</div>
    <button type="button" id="menu-add" class="ghost">+ Add item</button></div>`;
}

function wireStall(it) {
  $("props-body").querySelector("[data-vendor-select]").onchange = (e) => {
    const v = e.target.value;
    snapshot();
    if (v === "__new__") {
      it.vendor = freshVendorId(it.name || "new vendor");
      if (!it.name) it.name = "New Vendor";
      if (!it.kind) it.kind = it.style === "tent" ? "goods" : "food";
      if (!it.color) it.color = "#ff8a3d";
      it.items = it.items || [];
    } else if (vendorTaken(v, it.id)) { toast("That vendor is already placed."); syncProps(); return; }
    else { it.vendor = v; delete it.name; delete it.tagline; delete it.items; delete it.kind; }   // catalog vendor brings its own listing
    commit();
  };
  const idEl = $("props-body").querySelector("[data-vendor-id]");
  if (idEl) idEl.onchange = () => {
    const raw = slugify(idEl.value);
    if (!VENDOR_ID.test(raw)) { toast("Ids are 2–24 letters, numbers or dashes."); idEl.value = it.vendor; return; }
    if (vendorTaken(raw, it.id)) { toast("Another stall already uses that id."); idEl.value = it.vendor; return; }
    snapshot(); it.vendor = raw; commit();
  };
  const add = $("props-body").querySelector("#menu-add");
  if (add) add.onclick = () => { snapshot(); it.items = [...(it.items || []), { name: "" }]; commit(); };
  for (const row of $("props-body").querySelectorAll(".menu-row")) {
    const i = Number(row.dataset.i);
    const nameEl = row.querySelector("[data-mn]"), priceEl = row.querySelector("[data-mp]");
    let dirtied = false;
    const touch = () => { if (!dirtied) { snapshot(); dirtied = true; } };
    const apply = () => {
      const name = nameEl.value.trim();
      const raw = priceEl.value.trim().replace(/[$,\s]/g, "");
      const price = raw === "" ? null : Number(raw);
      it.items[i] = price != null && Number.isFinite(price) && price >= 0 ? { name, price: Math.round(price * 100) / 100 } : { name };
    };
    nameEl.oninput = priceEl.oninput = () => { touch(); apply(); dirty = true; syncSaved(); if (mode === "3d") { /* wait for blur */ } };
    nameEl.onchange = priceEl.onchange = () => { apply(); dirtied = false; commit(); };
    row.querySelector("[data-mrm]").onclick = () => { snapshot(); it.items.splice(i, 1); commit(); };
  }
}

// ---------- 3D preview ----------
let renderer, scene, camera, world3d, raf = 0, look = { yaw: 0.6, pitch: -0.5, dist: 90, tx: 0, tz: 0 };
function ensure3d() {
  if (renderer) return;
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  $("view3d").appendChild(renderer.domElement);
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(60, 1, 0.1, 600);
  let d = null;
  const el = renderer.domElement;
  el.addEventListener("pointerdown", (e) => { d = { x: e.clientX, y: e.clientY, ...look, pan: e.button === 2 || e.shiftKey }; el.setPointerCapture(e.pointerId); });
  el.addEventListener("pointermove", (e) => {
    if (!d) return;
    if (d.pan) { look.tx = d.tx - (e.clientX - d.x) * 0.15; look.tz = d.tz - (e.clientY - d.y) * 0.15; }
    else { look.yaw = d.yaw - (e.clientX - d.x) * 0.005; look.pitch = Math.max(-1.4, Math.min(-0.1, d.pitch - (e.clientY - d.y) * 0.005)); }
  });
  el.addEventListener("pointerup", () => (d = null));
  el.addEventListener("contextmenu", (e) => e.preventDefault());
  el.addEventListener("wheel", (e) => { e.preventDefault(); look.dist = Math.min(260, Math.max(18, look.dist * (e.deltaY < 0 ? 0.9 : 1.1))); }, { passive: false });
}
function rebuild3d() {
  ensure3d();
  applyLayout(layout);
  if (world3d) disposeFestival(world3d);
  world3d = buildFestival(THREE, scene, LAYOUT, VENDORS).group;
}
function loop3d() {
  raf = requestAnimationFrame(loop3d);
  const r = $("view3d").getBoundingClientRect();
  if (r.width && (renderer.domElement.width !== Math.round(r.width * Math.min(devicePixelRatio, 2)))) { renderer.setSize(r.width, r.height); camera.aspect = r.width / r.height; camera.updateProjectionMatrix(); }
  const cx = look.tx + Math.cos(look.yaw) * Math.cos(look.pitch) * look.dist;
  const cy = -Math.sin(look.pitch) * look.dist;
  const cz = look.tz + Math.sin(look.yaw) * Math.cos(look.pitch) * look.dist;
  camera.position.set(cx, cy, cz); camera.lookAt(look.tx, 0, look.tz);
  renderer.render(scene, camera);
}

function setMode(m) {
  mode = m;
  $("map2d").style.display = m === "2d" ? "block" : "none";
  $("view3d").style.display = m === "3d" ? "block" : "none";
  $("btn-2d").classList.toggle("primary", m === "2d");
  $("btn-3d").classList.toggle("primary", m === "3d");
  hint();
  if (m === "3d") { rebuild3d(); if (!raf) loop3d(); }
  else { cancelAnimationFrame(raf); raf = 0; draw(); }
}
function hint() {
  $("hint").textContent = mode === "3d"
    ? "Drag to look around · scroll to zoom · shift-drag (or right-drag) to move. This is exactly what players see."
    : placing ? `Click the map to place a ${TYPES[placing].label.toLowerCase()} (hold Shift to place several). Esc to cancel.`
    : "Click the map to select · drag to move · scroll to zoom. Pick a piece on the left to add one.";
}

// ---------- Top bar ----------
$("btn-2d").onclick = () => setMode("2d");
$("btn-3d").onclick = () => setMode("3d");
$("btn-undo").onclick = undo;
$("btn-redo").onclick = redo;
$("btn-reset").onclick = () => { if (confirm("Start over from the built-in festival? Your unpublished changes will be lost (published grounds stay until you publish this).")) { snapshot(); layout = defaultLayout(); selected = null; commit(); toast("Reset to the starting festival. Publish to make it live."); } };
$("btn-save").onclick = async () => {
  const out = sanitizeLayout(layout, rules);
  if (out.error) return toast(out.error);
  $("btn-save").disabled = true; $("btn-save").textContent = "Publishing…";
  try {
    const r = await fetch(`${API}/layout`, { method: "PUT", headers: authed(), body: JSON.stringify({ layout }) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { toast(data.error || `Couldn't publish (error ${r.status}).`); return; }
    layout = data.layout; published = data.updatedAt;
    commit({ preview: false, dirty: false });
    toast("Published! Everyone in the game will be asked to refresh." + (data.warnings?.length ? " Note: " + data.warnings.join(" ") : ""), 6000);
  } catch { toast(`Couldn't reach the server at ${API}.`); }
  finally { $("btn-save").disabled = false; $("btn-save").textContent = "Publish"; }
};
addEventListener("keydown", (e) => {
  if (["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;
  if (e.key === "Escape") { placing = null; highlightPalette(); hint(); }
  if ((e.ctrlKey || e.metaKey) && e.key === "z") { e.preventDefault(); undo(); }
  if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.shiftKey && e.key === "z"))) { e.preventDefault(); redo(); }
  if ((e.key === "Delete" || e.key === "Backspace") && selected) { const it = itemById(selected); if (it && !(it.type === "npc" && REQUIRED.includes(it.ref))) { snapshot(); layout.items = layout.items.filter((o) => o !== it); selected = null; commit(); } }
});
addEventListener("resize", () => mode === "2d" && draw());

// ---------- Start ----------
async function start() {
  $("gate").hidden = true; $("app").hidden = false;
  buildPalette();
  try {
    const r = await fetch(`${API}/layout`, { headers: authed() });
    if (r.ok) { const d = await r.json(); const out = sanitizeLayout(d.layout, rules); layout = out.layout ?? defaultLayout(); published = d.updatedAt; }
  } catch { toast("Couldn't load the current layout; starting from the built-in one."); }
  applyLayout(layout);
  setMode("2d");
  syncSaved(); syncProps();
}

(async () => { if (await checkAdmin()) start(); })();
