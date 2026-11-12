// The festival layout: every placeable thing on the grounds, as plain data the festival builder
// (client/builder.html) edits and the game builds from. Used by the server (rules, vendors, quests)
// and the browser (3D world, maps), so it's one source of truth.
//
// A layout is { version, items: [...] }. Every item has an id, a type, a position (x, z in meters;
// north is -z) and a rotation (rot, in degrees, clockwise seen from above... see facing() below).
// The fence (±FENCE) and the main gate (south side) are fixed.

export const LAYOUT_VERSION = 2;       // 2: the bigger four-section grounds (a saved v1 layout is set aside, see server/layout.js)
// The size of the grounds. The fence stands at ±FENCE on both axes; the walkable limit in
// shared/sim.js, the ground, the maps and the builder all follow this one number, and the gate and
// the spawn point are placed from it. Change the size HERE and nowhere else.
export const FENCE = 199;
export const GATE = { x: 0, z: FENCE, width: 14, label: "Main gate" };
export const SPAWN = { x: 0, z: FENCE - 20, radius: 7 };   // new arrivals appear just inside the gate
export const MAX_ITEMS = 1200;
export const MAX_LAMPS = 24;           // each lamp is a real light; lots of them slow phones down

// What a stage plays. The genre is data on each stage (set it in the festival builder); a DJ's mix
// has to match it (server/dj.js). "" means an open stage: any genre.
export const GENRES = [
  { id: "edm",    name: "EDM" },
  { id: "hiphop", name: "Rap / R&B" },
  { id: "rock",   name: "Rock / Alternative" },
  { id: "roots",  name: "Bluegrass & more" },
];
export const genreById = (id) => GENRES.find((g) => g.id === id) ?? null;
export const genreName = (id) => genreById(id)?.name ?? "Open stage";

// Art installations and service tents (the "art" layout type): a few simple, glowing shapes to fill
// the grounds with things to look at and landmarks to meet at. size is the footprint (w × d meters).
export const ART = {
  ring:    { name: "Light ring", size: [7, 1.2] },
  totem:   { name: "Glow totem", size: [2, 2] },
  pyramid: { name: "Neon pyramid", size: [5, 5] },
  info:    { name: "Info tent", size: [5, 4] },
  medic:   { name: "First aid tent", size: [5, 4] },
};

// What can be placed, with its size on the ground (w × d meters at rot 0) for maps and hit-testing,
// and which extra fields it has. The builder's palette and property panel are generated from this.
// solid: players can't walk through it (shared/sim.js). "box" = its whole footprint, a number = a
// round post of that radius (a tree is only as wide as its trunk), "water" = blocked unless a bridge
// crosses it. Everything else is walk-through (ground, signs overhead, hanging lights, people).
export const TYPES = {
  stage:    { label: "Stage", icon: "🎤", size: (i) => (i.variant === "side" ? [14, 8] : [32, 14]), fields: ["variant", "label", "genre"], solid: "box" },
  stall:    { label: "Vendor stall", icon: "🏪", size: (i) => (i.style === "tent" ? [6.4, 4.6] : [7.4, 4.4]), fields: ["style", "vendor", "name", "kind", "color"], solid: "box" },
  area:     { label: "Ground area", icon: "🟫", size: (i) => [i.w, i.d], fields: ["w", "d", "color", "label"] },
  path:     { label: "Path", icon: "🟤", size: (i) => [i.w, i.d], fields: ["w", "d"] },
  water:    { label: "River / lake", icon: "🌊", size: (i) => [i.w, i.d], fields: ["w", "d", "label"], solid: "water" },
  bridge:   { label: "Bridge", icon: "🌉", size: (i) => [i.w, i.d], fields: ["w", "d"] },
  forest:   { label: "Forest", icon: "🌳", size: (i) => [i.w, i.d], fields: ["w", "d"] },
  wheel:    { label: "Ferris wheel", icon: "🎡", size: () => [12, 5], fields: ["label"], solid: "box" },
  stop:     { label: "Shuttle stop", icon: "🚌", size: () => [3, 2], fields: ["label"] },
  art:      { label: "Art / service tent", icon: "🗿", size: (i) => ART[i.variant]?.size ?? [3, 3], fields: ["variant", "label"], solid: "box" },
  arch:     { label: "Entrance sign", icon: "⛩️", size: (i) => [i.w, 1], fields: ["text", "w", "color"] },
  lights:   { label: "String lights", icon: "💡", size: (i) => [i.w, i.d], fields: ["w", "d"] },
  lamp:     { label: "Hanging lamp", icon: "🏮", size: () => [1.6, 1.6], fields: ["color"] },
  pathring: { label: "Path loop", icon: "⭕", size: (i) => [i.r * 2 + 6, i.r * 2 + 6], fields: ["r"] },
  table:    { label: "Picnic table", icon: "🪑", size: () => [2.1, 3], fields: [], solid: "box" },
  tent:     { label: "Camping tent", icon: "⛺", size: () => [3.2, 3.2], fields: ["color", "orders"], solid: "box" },
  tree:     { label: "Tree", icon: "🌲", size: () => [5, 5], fields: [], solid: 0.45 },
  npc:      { label: "Character", icon: "🧍", size: () => [1.6, 1.6], fields: ["ref"] },
  spot:     { label: "Totem hiding spot", icon: "✨", size: () => [2, 2], fields: ["where"] },
};

// Which way something faces (the direction its front/counter points), from its rotation.
// rot 0 faces south (+z, toward the gate); 90 faces east (+x); 180 north; -90 west.
export const facing = (rot) => ({ x: Math.round(Math.sin((rot * Math.PI) / 180) * 1e6) / 1e6, z: Math.round(Math.cos((rot * Math.PI) / 180) * 1e6) / 1e6 });
export const rad = (deg) => (deg * Math.PI) / 180;

// ---------- Forests ----------
// A forest is one layout item that stands for many trees, so a whole wood is a single thing to place
// and the browser can draw it in two draw calls. Where its trees stand is worked out here, the same
// on the server (tree trunks are solid) and in every browser: a jittered grid seeded by the forest's
// position, skipping anything that would stand on a path, a bridge, water or a path loop.
export const FOREST_SPACING = 6.5;   // meters between trees, roughly
function rng(seed) { let s = Math.max(1, Math.abs(Math.round(seed)) % 2147483647); return () => ((s = (s * 16807) % 2147483647) / 2147483647); }

// Is (x, z) within `margin` of a (possibly rotated) rectangle item?
function nearRect(it, x, z, margin = 0) {
  const [w, d] = TYPES[it.type].size(it);
  const a = -rad(it.rot || 0), dx = x - it.x, dz = z - it.z;
  const lx = dx * Math.cos(a) - dz * Math.sin(a), lz = dx * Math.sin(a) + dz * Math.cos(a);
  return Math.abs(lx) <= w / 2 + margin && Math.abs(lz) <= d / 2 + margin;
}

export function forestTrees(forest, items = []) {
  const clear = items.filter((i) => i.type === "path" || i.type === "bridge" || i.type === "water");
  const rings = items.filter((i) => i.type === "pathring");
  const r = rng(forest.x * 131 + forest.z * 977 + forest.w * 13 + forest.d * 7 + 11);
  const nx = Math.max(1, Math.round(forest.w / FOREST_SPACING)), nz = Math.max(1, Math.round(forest.d / FOREST_SPACING));
  const a = rad(forest.rot || 0), cos = Math.cos(a), sin = Math.sin(a);
  const out = [];
  for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) {
    const lx = ((i + 0.5) / nx - 0.5) * forest.w + (r() - 0.5) * FOREST_SPACING * 0.7;
    const lz = ((k + 0.5) / nz - 0.5) * forest.d + (r() - 0.5) * FOREST_SPACING * 0.7;
    const seed = r();
    const x = round1(forest.x + lx * cos + lz * sin), z = round1(forest.z - lx * sin + lz * cos);
    if (Math.abs(x) > FENCE - 1.5 || Math.abs(z) > FENCE - 1.5) continue;
    if (clear.some((c) => nearRect(c, x, z, 2.2))) continue;
    if (rings.some((c) => Math.abs(Math.hypot(x - c.x, z - c.z) - c.r) < 5.2)) continue;
    out.push({ x, z, seed });
  }
  return out;
}

// ---------- The starting layout ----------
// Four sections. Three festival sections sit north of the river, side by side, with a belt of forest
// between them and forest paths through it:
//   Main Field (middle)  the main stage, the path loop, the Food Court, the Ferris wheel
//   East Side            the east stage and Shakedown Street
//   The Grove (west)     two small stages in the trees
// The Campground is the fourth section, on its own south of the river (the gate side): you come in
// through the gate, walk up the lane between the two halves of the Campground, and cross the bridge.
// The section names, colors and what's in them are just layout data: rename or refill them in the
// festival builder. Each stage has a genre (GENRES above), also editable there.
export function defaultLayout() {
  const items = [];
  let n = 0;
  const add = (type, props) => items.push({ id: `${type}${++n}`, type, rot: 0, ...props });
  const F = FENCE;

  // --- Sections (big ground areas; smaller areas inside them win when naming where a stall is) ---
  add("area", { id: "sec_main", x: 0, z: -55, w: 150, d: 270, color: "#40703a", label: "Main Field" });
  add("area", { id: "sec_east", x: 147, z: -55, w: 96, d: 270, color: "#46733c", label: "East Side" });
  add("area", { id: "sec_west", x: -147, z: -55, w: 96, d: 270, color: "#3a6634", label: "The Grove" });
  add("area", { id: "camp", x: -92, z: 150, w: 156, d: 76, color: "#44743a", label: "Campground West" });
  add("area", { id: "camp2", x: 92, z: 150, w: 156, d: 76, color: "#44743a", label: "Campground East" });
  add("area", { id: "plaza", x: 0, z: 184, w: 26, d: 24, color: "#9b7b52", label: "Entrance Plaza" });

  // --- The river, with the Campground on the far side, and three bridges ---
  add("water", { id: "river", x: 0, z: 95, w: F * 2, d: 14, label: "Festival River" });
  add("bridge", { id: "bridge_main", x: 0, z: 95, rot: 90, w: 22, d: 10 });
  add("bridge", { id: "bridge_east", x: 120, z: 95, rot: 90, w: 22, d: 5 });
  add("bridge", { id: "bridge_west", x: -120, z: 95, rot: 90, w: 22, d: 5 });

  // --- Paths: the lane from the gate, the camp cross-lane, the river walk, the way up to the loop,
  //     and the forest paths out to the east and west sections ---
  add("path", { x: 0, z: 152, rot: 90, w: 94, d: 8 });            // gate → main bridge
  add("path", { x: 0, z: 150, w: 340, d: 5 });                    // across both halves of the Campground
  add("path", { x: 120, z: 128, rot: 90, w: 44, d: 4 });          // camp lane → east footbridge
  add("path", { x: -120, z: 128, rot: 90, w: 44, d: 4 });
  add("path", { x: 0, z: 78, w: 364, d: 6 });                     // the river walk, north bank
  add("path", { x: 0, z: 28, rot: 90, w: 94, d: 6 });             // main bridge → the path loop
  add("path", { x: 70, z: -50, w: 78, d: 6 });                    // forest path east
  add("path", { x: -70, z: -50, w: 78, d: 6 });                   // forest path west
  add("pathring", { x: 0, z: -50, r: 31 });

  // --- Forest: belts between the sections, and a tree line inside the fence ---
  add("forest", { x: 87, z: -57, w: 24, d: 262 });
  add("forest", { x: -87, z: -57, w: 24, d: 262 });
  add("forest", { x: 0, z: -(F - 5), w: F * 2 - 4, d: 8 });
  add("forest", { x: F - 5, z: -6, w: 8, d: F * 2 - 30 });
  add("forest", { x: -(F - 5), z: -6, w: 8, d: F * 2 - 30 });
  add("forest", { x: 105, z: F - 5, w: 180, d: 8 });
  add("forest", { x: -105, z: F - 5, w: 180, d: 8 });
  add("lights", { x: 70, z: -50, w: 78, d: 5 });                  // bulbs over the forest paths: part of the festival
  add("lights", { x: -70, z: -50, w: 78, d: 5 });

  // --- Stages, one genre each ---
  add("stage", { id: "stage_main", x: 0, z: -110, variant: "main", label: "Main Stage", genre: "edm" });
  add("stage", { id: "stage_east", x: 160, z: -20, rot: -90, variant: "side", label: "East Stage", genre: "hiphop" });
  add("stage", { id: "stage_rock", x: -160, z: -110, rot: 90, variant: "side", label: "Garage Stage", genre: "rock" });
  add("stage", { id: "stage_porch", x: -160, z: 20, rot: 90, variant: "side", label: "Back Porch Stage", genre: "roots" });

  // --- The Ferris wheel: a landmark you can see from every section ---
  add("wheel", { id: "wheel", x: 45, z: 35, label: "Ferris Wheel" });

  // --- Shuttle stops: a free ride between the sections (shared/rides.js → SHUTTLE) ---
  for (const [id, x, z, label] of [
    ["stop_gate", 12, 184, "Main Gate"], ["stop_campw", -60, 145, "Campground West"], ["stop_campe", 60, 145, "Campground East"],
    ["stop_food", -10, 62, "Food Court & Ferris Wheel"], ["stop_main", 24, -86, "Main Stage"],
    ["stop_east", 114, -56, "East Side"], ["stop_grove", -114, -56, "The Grove"],
  ]) add("stop", { id, x, z, label });

  // --- Info & First Aid, by the main bridge where everyone passes ---
  add("area", { id: "help", x: 28, z: 64, w: 30, d: 12, color: "#8f7a5a", label: "Info & First Aid" });
  add("art", { x: 20, z: 63, variant: "info", label: "Info" });
  add("art", { x: 36, z: 63, variant: "medic", label: "First Aid" });

  // --- Art Field (East Side, south of the stage): installations to wander through ---
  add("area", { id: "artfield", x: 147, z: 35, w: 70, d: 50, color: "#3f6b45", label: "Art Field" });
  for (const [variant, x, z, rot] of [["ring", 130, 22, 0], ["totem", 150, 18, 0], ["pyramid", 166, 34, 45], ["ring", 140, 46, 60], ["totem", 160, 54, 0], ["totem", 126, 44, 0]]) add("art", { x, z, rot, variant });

  // --- Food Court (Main Field, near the bridge): booths down the west edge facing east ---
  add("area", { id: "food", x: -48, z: 25, w: 26, d: 66, color: "#9b7b52", label: "Food Court" });
  ["noodle", "rae", "bbq", "crepes", "hippiedips", "pizza", "lemonade", "coffee"].forEach((vendor, i) =>
    add("stall", { x: -56, z: -3 + i * 8, rot: 90, style: "booth", vendor }));
  for (const [x, z] of [[-44, 7], [-44, 19], [-44, 31], [-44, 43], [-38, 13], [-38, 25], [-38, 37]]) add("table", { x, z });
  add("arch", { x: -33, z: 25, rot: 90, text: "FOOD COURT", w: 12, color: "#ffb347" });
  for (const z of [9, 25, 41]) add("lamp", { x: -42, z, color: "#ffcf8a" });

  // --- Shakedown Street (East Side): two rows of tents facing the lane ---
  add("area", { id: "shakedown", x: 147, z: -100, w: 60, d: 18, color: "#a58556", label: "Shakedown Street" });
  ["tiedye", "pins", "crystals", "grilledcheese", "hats", "hoops", "glow", "vinyl", "hemp", "posters", "kandi", "stickers"].forEach((vendor, i) => {
    const north = i % 2 === 0;
    add("stall", { x: [123, 132, 141, 150, 159, 168][Math.floor(i / 2)], z: north ? -108 : -92, rot: north ? 0 : 180, style: "tent", vendor });
  });
  add("arch", { x: 116, z: -100, rot: -90, text: "SHAKEDOWN STREET", w: 11, color: "#b44fff" });
  add("lights", { x: 147, z: -100, w: 60, d: 11 });
  for (const x of [127, 147, 167]) add("lamp", { x, z: -100, color: "#ffd9a0" });

  // --- The Grove: somewhere to sit between the two small stages ---
  for (const [x, z] of [[-140, -40], [-146, -48], [-134, -52]]) add("table", { x, z });
  add("lamp", { x: -140, z: -46, color: "#bfe8a0" });
  add("lamp", { x: -140, z: 20, color: "#ffcf8a" });
  add("lamp", { x: -140, z: -110, color: "#ff9a7a" });
  add("lamp", { x: 142, z: -20, color: "#c79aff" });

  // --- Campground: a few tents by the lane (the ones marked "orders" are where Vendor Rush delivers),
  //     the rest is open grass for members' camps ---
  add("arch", { x: 0, z: 110, text: "CAMPGROUND", w: 10, color: "#7ee081" });
  for (const z of [118, 168]) add("lamp", { x: 0, z, color: "#ffd9a0" });
  const tentColors = ["#f2994a", "#2d9cdb", "#eb5757", "#27ae60", "#9b51e0", "#f2c94c"];
  const r = rng(7);
  let t = 0;
  for (const side of [-1, 1]) for (const z of [122, 136, 172]) for (const x of [24, 40, 56]) {
    add("tent", { x: side * x, z, rot: Math.round(r() * 180), color: tentColors[t % tentColors.length], orders: z !== 172 && t % 3 !== 2 });
    t++;
  }

  // Characters (quest givers and people hanging around): positions only; who they are lives in quests-data.js.
  const people = {
    juniper: [-12, -38], dex: [9, -94], rae: [-51, 5], sunny: [-7, 174],
    greeter: [6, 176], camper1: [-32, 158], camper2: [32, 158], photog: [-6, -80], medic: [30, 70], dj: [152, -12], artist: [-28, 8], host: [-40, -2],
  };
  for (const [ref, [x, z]] of Object.entries(people)) add("npc", { x, z, ref });

  // Where Lost & Found totem pieces can turn up (3 picked each time).
  for (const [x, z, where] of [
    [24, -108, "beside the main stage"], [-24, -88, "near the front rail"], [173, -8, "behind the east stage"],
    [-64, -10, "at the north end of the food court"], [-66, 58, "behind the last food stall"], [-48, 158, "between the tents"],
    [120, 180, "at the back of the campground"], [147, -84, "under the string lights"], [-186, -40, "by the tree line"],
    [185, -100, "at the far end of Shakedown Street"], [0, 95, "on the main bridge"], [-140, -70, "in the Grove"],
    [70, -46, "on the forest path"], [45, 46, "under the Ferris wheel"],
  ]) add("spot", { x, z, where });

  return { version: LAYOUT_VERSION, items };
}
const round1 = (v) => Math.round(v * 10) / 10;

// ---------- Checking a layout (the server checks everything the builder sends) ----------
const HEX = /^#[0-9a-fA-F]{6}$/;
const ID = /^[A-Za-z0-9_-]{1,32}$/;
const VENDOR_ID = /^[a-z0-9][a-z0-9-]{1,23}$/;
const text = (v, max) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max) : "");
const num = (v, lo, hi, dflt) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt);

// knownRefs: ids of characters from quests-data.js; requiredRefs: quest givers (must stay on the map).
// Returns { layout, warnings } or { error }.
export function sanitizeLayout(raw, { knownRefs = [], requiredRefs = [] } = {}) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.items)) return { error: "That isn't a festival layout." };
  if (raw.items.length > MAX_ITEMS) return { error: `Too many things (${raw.items.length}); the limit is ${MAX_ITEMS}.` };
  const items = [], ids = new Set(), vendors = new Set(), refs = new Set(), warnings = [];
  let lamps = 0, auto = 0, wheels = 0;
  const lim = FENCE - 1;
  for (const r of raw.items) {
    if (!r || typeof r !== "object" || !TYPES[r.type]) continue;
    let id = typeof r.id === "string" && ID.test(r.id) && !ids.has(r.id) ? r.id : "";
    while (!id || ids.has(id)) id = `${r.type}_x${++auto}`;
    ids.add(id);
    const it = { id, type: r.type, x: round1(num(r.x, -lim, lim, 0)), z: round1(num(r.z, -lim, lim, 0)), rot: Math.round(((num(r.rot, -1e6, 1e6, 0) % 360) + 540) % 360 - 180) };
    const color = (d) => (HEX.test(r.color) ? r.color.toLowerCase() : d);
    switch (r.type) {
      case "stage":
        it.variant = r.variant === "side" ? "side" : "main";
        it.label = text(r.label, 30) || (it.variant === "side" ? "Side Stage" : "Main Stage");
        it.genre = genreById(r.genre) ? r.genre : "";
        break;
      case "path": it.w = round1(num(r.w, 2, FENCE * 2, 30)); it.d = round1(num(r.d, 2, 30, 6)); break;
      case "water": it.w = round1(num(r.w, 4, FENCE * 2, 60)); it.d = round1(num(r.d, 4, FENCE * 2, 14)); it.label = text(r.label, 30); break;
      case "bridge": it.w = round1(num(r.w, 4, 80, 22)); it.d = round1(num(r.d, 3, 30, 8)); break;
      case "forest": it.w = round1(num(r.w, 6, FENCE * 2, 30)); it.d = round1(num(r.d, 6, FENCE * 2, 30)); break;
      case "wheel":
        if (wheels++) { warnings.push("Only one Ferris wheel for now; the extra one was left out."); ids.delete(id); continue; }
        it.label = text(r.label, 30) || "Ferris Wheel";
        break;
      case "stall": {
        it.style = r.style === "tent" ? "tent" : "booth";
        const v = typeof r.vendor === "string" ? r.vendor.toLowerCase() : "";
        if (!VENDOR_ID.test(v)) { warnings.push(`A stall had an invalid vendor id and was left out.`); ids.delete(id); continue; }
        if (vendors.has(v)) { warnings.push(`Vendor "${v}" was placed twice; kept the first.`); ids.delete(id); continue; }
        vendors.add(v);
        it.vendor = v;
        if (text(r.name, 40)) it.name = text(r.name, 40);
        if (r.kind === "food" || r.kind === "goods") it.kind = r.kind;
        if (HEX.test(r.color)) it.color = r.color.toLowerCase();
        // A brand-new vendor (not in the catalog) can carry a starting listing made in the builder:
        // a tagline and a simple menu. Real vendors still edit their own listing with their link.
        if (text(r.tagline, 140)) it.tagline = text(r.tagline, 140);
        if (Array.isArray(r.items)) {
          const menu = [];
          for (const m of r.items) {
            const n = text(m?.name, 60);
            if (!n) continue;
            let price = null;
            if (m?.price !== "" && m?.price != null) {
              const p = typeof m.price === "number" ? m.price : Number(String(m.price).replace(/[$,\s]/g, ""));
              if (Number.isFinite(p) && p >= 0 && p <= 9999) price = Math.round(p * 100) / 100;
            }
            menu.push(price == null ? { name: n } : { name: n, price });
            if (menu.length >= 30) break;
          }
          if (menu.length) it.items = menu;
        }
        break;
      }
      case "area": it.w = round1(num(r.w, 2, FENCE * 2, 20)); it.d = round1(num(r.d, 2, FENCE * 2, 20)); it.color = color("#9b7b52"); it.label = text(r.label, 30); break;
      case "arch": it.text = text(r.text, 24) || "WELCOME"; it.w = round1(num(r.w, 4, 30, 12)); it.color = color("#ff4fa3"); break;
      case "lights": it.w = round1(num(r.w, 4, 120, 30)); it.d = round1(num(r.d, 2, 40, 10)); break;
      case "lamp": if (++lamps > MAX_LAMPS) { warnings.push(`Only ${MAX_LAMPS} lamps are allowed; the extras were left out.`); ids.delete(id); continue; } it.color = color("#ffd9a0"); break;
      case "pathring": it.r = round1(num(r.r, 5, 90, 31)); break;
      case "tent": it.color = color("#f2994a"); it.orders = r.orders === true; break;
      case "npc": {
        if (!knownRefs.includes(r.ref) || refs.has(r.ref)) { ids.delete(id); continue; }
        refs.add(r.ref); it.ref = r.ref; break;
      }
      case "spot": it.where = text(r.where, 60) || "somewhere on the grounds"; break;
      case "art": it.variant = ART[r.variant] ? r.variant : "totem"; it.label = text(r.label, 30); break;
      case "stop": it.label = text(r.label, 30) || "Shuttle stop"; break;
    }
    items.push(it);
  }
  // Quest givers can move but not disappear (their quests would become impossible).
  const defaults = defaultLayout().items;
  for (const ref of requiredRefs) {
    if (refs.has(ref)) continue;
    const d = defaults.find((i) => i.type === "npc" && i.ref === ref);
    if (d) { items.push({ ...d, id: ids.has(d.id) ? `npc_${ref}` : d.id }); warnings.push(`Quest giver "${ref}" can't be removed, so they're back at their usual spot.`); }
  }
  if (items.filter((i) => i.type === "spot").length < 3) warnings.push("Lost & Found needs at least 3 totem hiding spots; it'll use the usual ones until you add them.");
  if (items.filter((i) => i.type === "tent" && i.orders).length < 3) warnings.push("Vendor Rush needs at least 3 tents marked \"takes orders\"; it'll use the usual ones until you add them.");
  return { layout: { version: LAYOUT_VERSION, items }, warnings };
}
