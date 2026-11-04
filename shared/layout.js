// The festival layout: every placeable thing on the grounds, as plain data the festival builder
// (client/builder.html) edits and the game builds from. Used by the server (rules, vendors, quests)
// and the browser (3D world, maps), so it's one source of truth.
//
// A layout is { version, items: [...] }. Every item has an id, a type, a position (x, z in meters;
// north is -z) and a rotation (rot, in degrees, clockwise seen from above... see facing() below).
// The fence (±FENCE) and the main gate (south side) are fixed.

export const LAYOUT_VERSION = 1;
export const FENCE = 99;
export const GATE = { x: 0, z: FENCE, width: 14, label: "Main gate" };
export const MAX_ITEMS = 1200;
export const MAX_LAMPS = 24;           // each lamp is a real light; lots of them slow phones down

// What can be placed, with its size on the ground (w × d meters at rot 0) for maps and hit-testing,
// and which extra fields it has. The builder's palette and property panel are generated from this.
export const TYPES = {
  stage:    { label: "Stage", icon: "🎤", size: (i) => (i.variant === "side" ? [14, 8] : [32, 14]), fields: ["variant", "label"] },
  stall:    { label: "Vendor stall", icon: "🏪", size: (i) => (i.style === "tent" ? [6.4, 4.6] : [7.4, 4.4]), fields: ["style", "vendor", "name", "kind", "color"] },
  area:     { label: "Ground area", icon: "🟫", size: (i) => [i.w, i.d], fields: ["w", "d", "color", "label"] },
  arch:     { label: "Entrance sign", icon: "⛩️", size: (i) => [i.w, 1], fields: ["text", "w", "color"] },
  lights:   { label: "String lights", icon: "💡", size: (i) => [i.w, i.d], fields: ["w", "d"] },
  lamp:     { label: "Hanging lamp", icon: "🏮", size: () => [1.6, 1.6], fields: ["color"] },
  pathring: { label: "Path loop", icon: "⭕", size: (i) => [i.r * 2 + 6, i.r * 2 + 6], fields: ["r"] },
  table:    { label: "Picnic table", icon: "🪑", size: () => [2.1, 3], fields: [] },
  tent:     { label: "Camping tent", icon: "⛺", size: () => [3.2, 3.2], fields: ["color", "orders"] },
  tree:     { label: "Tree", icon: "🌲", size: () => [5, 5], fields: [] },
  npc:      { label: "Character", icon: "🧍", size: () => [1.6, 1.6], fields: ["ref"] },
  spot:     { label: "Totem hiding spot", icon: "✨", size: () => [2, 2], fields: ["where"] },
};

// Which way something faces (the direction its front/counter points), from its rotation.
// rot 0 faces south (+z, toward the gate); 90 faces east (+x); 180 north; -90 west.
export const facing = (rot) => ({ x: Math.round(Math.sin((rot * Math.PI) / 180) * 1e6) / 1e6, z: Math.round(Math.cos((rot * Math.PI) / 180) * 1e6) / 1e6 });
export const rad = (deg) => (deg * Math.PI) / 180;

// ---------- The starting layout (what FestiVille looked like before the builder) ----------
function rng(seed) { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); }

export function defaultLayout() {
  const items = [];
  let n = 0;
  const add = (type, props) => items.push({ id: `${type}${++n}`, type, rot: 0, ...props });

  add("pathring", { x: 0, z: 0, r: 31 });
  add("area", { id: "camp", x: 0, z: 65, w: 72, d: 34, color: "#44743a", label: "Campground" });
  add("area", { id: "food", x: -52, z: 0, w: 26, d: 66, color: "#9b7b52", label: "Food Court" });
  add("area", { id: "shakedown", x: 64, z: -38, w: 60, d: 18, color: "#a58556", label: "Shakedown Street" });
  add("stage", { x: 0, z: -60, variant: "main", label: "Main Stage" });
  add("stage", { x: 65, z: 10, rot: -90, variant: "side", label: "Side Stage" });

  // Food court: booths down the west edge facing east, tables, arch, lamps.
  ["noodle", "rae", "bbq", "crepes", "hippiedips", "pizza", "lemonade", "coffee"].forEach((vendor, i) =>
    add("stall", { x: -60, z: -28 + i * 8, rot: 90, style: "booth", vendor }));
  for (const [x, z] of [[-48, -18], [-48, -6], [-48, 6], [-48, 18], [-42, -12], [-42, 0], [-42, 12]]) add("table", { x, z });
  add("arch", { x: -37, z: 0, rot: 90, text: "FOOD COURT", w: 12, color: "#ffb347" });
  for (const z of [-16, 0, 16]) add("lamp", { x: -46, z, color: "#ffcf8a" });

  // Shakedown Street: two rows of tents facing the lane, banner at the west end, bulbs overhead.
  ["tiedye", "pins", "crystals", "grilledcheese", "hats", "hoops", "glow", "vinyl", "hemp", "posters", "kandi", "stickers"].forEach((vendor, i) => {
    const north = i % 2 === 0;
    add("stall", { x: [40, 49, 58, 67, 76, 85][Math.floor(i / 2)], z: north ? -46 : -30, rot: north ? 0 : 180, style: "tent", vendor });
  });
  add("arch", { x: 33, z: -38, rot: -90, text: "SHAKEDOWN STREET", w: 11, color: "#b44fff" });
  add("lights", { x: 64, z: -38, w: 60, d: 11 });
  for (const x of [44, 64, 84]) add("lamp", { x, z: -38, color: "#ffd9a0" });

  // Campground tents; the ones marked "orders" are where Vendor Rush deliveries go.
  const r = rng(7);
  const tentColors = ["#f2994a", "#2d9cdb", "#eb5757", "#27ae60", "#9b51e0", "#f2c94c"];
  const ordering = new Set(["-30,55", "-18,55", "6,55", "30,55", "-6,65", "6,65", "-30,75", "18,75"]);
  for (let i = 0; i < 18; i++) {
    const x = -30 + (i % 6) * 12, z = 55 + Math.floor(i / 6) * 10;
    add("tent", { x, z, rot: Math.round(r() * 180), color: tentColors[i % tentColors.length], orders: ordering.has(`${x},${z}`) });
  }
  // Tree line just inside the fence.
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2, rr = 91 + r() * 5;
    add("tree", { x: round1(Math.cos(a) * rr), z: round1(Math.sin(a) * rr) });
  }

  // Characters (quest givers and people hanging around) — positions only; who they are lives in quests-data.js.
  const people = {
    juniper: [-12, 12], dex: [9, -46], rae: [-55, -20],
    greeter: [0, 8], camper1: [-14, 62], camper2: [22, 62], photog: [-6, -30], medic: [40, 20], dj: [60, 6], artist: [-35, -14], host: [-44, -26],
  };
  for (const [ref, [x, z]] of Object.entries(people)) add("npc", { x, z, ref });

  // Where Lost & Found totem pieces can turn up (3 picked each time).
  for (const [x, z, where] of [
    [22, -58, "beside the main stage"], [-24, -40, "near the front rail"], [70, 22, "behind the side stage"],
    [-62, -37, "at the north end of the food court"], [-65, 34, "behind the last food stall"], [-18, 68, "between the tents"],
    [26, 78, "at the back of the campground"], [40, -20, "under the string lights"], [-85, 10, "by the tree line"],
    [95, -38, "at the far end of Shakedown Street"],
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
  let lamps = 0, auto = 0;
  const lim = FENCE - 1;
  for (const r of raw.items) {
    if (!r || typeof r !== "object" || !TYPES[r.type]) continue;
    let id = typeof r.id === "string" && ID.test(r.id) && !ids.has(r.id) ? r.id : "";
    while (!id || ids.has(id)) id = `${r.type}_x${++auto}`;
    ids.add(id);
    const it = { id, type: r.type, x: round1(num(r.x, -lim, lim, 0)), z: round1(num(r.z, -lim, lim, 0)), rot: Math.round(((num(r.rot, -1e6, 1e6, 0) % 360) + 540) % 360 - 180) };
    const color = (d) => (HEX.test(r.color) ? r.color.toLowerCase() : d);
    switch (r.type) {
      case "stage": it.variant = r.variant === "side" ? "side" : "main"; it.label = text(r.label, 30) || (it.variant === "side" ? "Side Stage" : "Main Stage"); break;
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
