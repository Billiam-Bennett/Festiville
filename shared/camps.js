// Player camps in the Campground: where a spot may go, and where the things in it stand.
// Shared so the server enforces it and the browser can show "you can claim here" before asking.
//
// A camp: { id, owner, x, z, plot, items } — x/z is the CENTER of the spot (meters), plot is an id
// from shared/economy.js (10×10, 10×20, 20×20), items are the camp items set up there.
import { TYPES } from "./layout.js";
import { inside } from "./venue.js";
import { plotById, campItemById } from "./economy.js";

export const GAP = 0.6;   // meters kept clear between spots and around tents/trees

// Ground areas that count as campground: the "Campground" area (id "camp" or any area labelled camp…).
export const campAreas = (items) => items.filter((i) => i.type === "area" && (i.id === "camp" || /camp/i.test(i.label ?? "")));

// Things in the layout a camp can't sit on top of.
const BLOCKING = new Set(["stage", "stall", "arch", "table", "tent", "tree", "npc", "spot", "lamp", "path", "water", "bridge", "wheel", "forest"]);

// Axis-aligned box around a (possibly rotated) layout item.
function boxOf(item) {
  const [w, d] = TYPES[item.type].size(item);
  const a = ((item.rot || 0) * Math.PI) / 180;
  const hw = (Math.abs(w * Math.cos(a)) + Math.abs(d * Math.sin(a))) / 2;
  const hd = (Math.abs(w * Math.sin(a)) + Math.abs(d * Math.cos(a))) / 2;
  return { x0: item.x - hw, x1: item.x + hw, z0: item.z - hd, z1: item.z + hd };
}
const overlaps = (a, b, gap = 0) => a.x0 < b.x1 + gap && b.x0 < a.x1 + gap && a.z0 < b.z1 + gap && b.z0 < a.z1 + gap;
export const plotBox = (x, z, plot) => ({ x0: x - plot.w / 2, x1: x + plot.w / 2, z0: z - plot.d / 2, z1: z + plot.d / 2 });

// Snap a spot's center to a half-meter grid so spots line up neatly.
export const snap = (v) => Math.round(v * 2) / 2;

// Can a spot of `plotId` go with its center at (x, z)? `camps` are the existing camps; the one with
// id `selfId` (moving or upgrading your own) is ignored. Returns "" if fine, else why not.
export function checkSpot(layoutItems, camps, { x, z, plot: plotId, selfId = "" }) {
  const plot = plotById(plotId);
  if (!plot) return "Unknown spot size.";
  if (!Number.isFinite(x) || !Number.isFinite(z)) return "That's not a place.";
  const areas = campAreas(layoutItems);
  if (!areas.length) return "This festival has no Campground right now.";
  const box = plotBox(x, z, plot);
  const corners = [[box.x0, box.z0], [box.x1, box.z0], [box.x0, box.z1], [box.x1, box.z1]];
  if (!areas.some((a) => corners.every(([cx, cz]) => inside(a, cx, cz)))) return "Camp spots have to be fully inside the Campground. Walk further in.";
  const blocker = layoutItems.find((i) => BLOCKING.has(i.type) && TYPES[i.type] && overlaps(box, boxOf(i), GAP));
  if (blocker) return `That's too close to a ${TYPES[blocker.type].label.toLowerCase()}. Move a few steps.`;
  const neighbor = camps.find((c) => c.id !== selfId && plotById(c.plot) && overlaps(box, plotBox(c.x, c.z, plotById(c.plot)), GAP));
  if (neighbor) return `That overlaps ${neighbor.owner}'s camp. Move a few steps.`;
  return "";
}

// Where ground items stand inside a spot (local x/z from the center; -z is the back).
// Slot 0 is the tent's place at the back; the rest are for other ground items (about 1.4 m each).
const SLOTS = {
  plot_10x10: [[0, -0.6], [-0.8, 0.9], [0.8, 0.9]],
  plot_10x20: [[0, -2.0], [-0.75, -0.3], [0.75, -0.3], [-0.75, 1.1], [0.75, 1.1], [-0.75, 2.4], [0.75, 2.4]],
  plot_20x20: [[-1.4, -1.6], ...[-2.25, -0.75, 0.75, 2.25].flatMap((z) => [-2.25, -0.75, 0.75, 2.25].map((x) => [x, z]))
    .filter(([x, z]) => !(x < 0 && z < 0))],
};
export function campSlots(plotId) {
  return (SLOTS[plotId] ?? []).map(([x, z], i) => (i === 0 ? { x, z, tent: true } : { x, z }));
}
// How many ground items besides the tent fit in a spot.
export const groundCapacity = (plotId) => Math.max(0, campSlots(plotId).length - 1);

// Clean a requested set of items to set up: owned ones only, one per group, ground items within
// capacity (in the order asked). Edge items (lights, flags, signs…) don't use space. Items that sit
// on another one (a flag on the tent, a pot over the fire pit) are dropped if that one isn't set up.
export function cleanCampItems(requested, owned, plotId) {
  const list = Array.isArray(requested) ? requested : [];
  const out = [], groups = new Set();
  let ground = 0;
  const cap = groundCapacity(plotId);
  for (const id of list) {
    const item = campItemById(id);
    if (!item || !owned.includes(id) || out.includes(id)) continue;
    if (item.group) { if (groups.has(item.group)) continue; groups.add(item.group); }
    if (item.place === "ground" && item.group !== "tent") { if (ground >= cap) { if (item.group) groups.delete(item.group); continue; } ground++; }
    out.push(id);
  }
  const has = (what) => out.some((id) => id === what || campItemById(id).group === what);
  return out.filter((id) => { const on = campItemById(id).on; return !on || has(on); });
}

// What's solid in a camp (shared/sim.js): the tent and each ground item, as circles where they stand.
// The grass of the spot itself stays walkable, so friends can come and sit at your camp.
// A parked golf cart: just in front of the camp, beside the owner's stake.
export function parkedCartSpot(camp) {
  const plot = plotById(camp.plot);
  return plot ? { x: camp.x + plot.w / 2 - 1.1, z: camp.z + plot.d / 2 + 1.4 } : null;
}

// cart: is the owner's golf cart parked there right now (not while they're driving it).
export function campSolids(camp, { cart = !!camp.cart } = {}) {
  const slots = campSlots(camp.plot);
  const out = [];
  const park = cart ? parkedCartSpot(camp) : null;
  if (park) out.push({ x: park.x, z: park.z, r: 0.9 });
  let next = 1;
  for (const id of camp.items ?? []) {
    const item = campItemById(id);
    if (item?.place !== "ground") continue;
    const s = item.group === "tent" ? slots[0] : slots[next++];
    if (s) out.push({ x: camp.x + s.x, z: camp.z + s.z, r: item.group === "tent" ? 1.0 : 0.55 });
  }
  return out;
}
