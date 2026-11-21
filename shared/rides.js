// Rides: the Ferris wheel and the golf cart. Shared so the server (who is on what) and the browser
// (where to draw them) agree on the numbers.
//
// A player's `ride` field in the synced room state says what they're on:
//   ""           on foot
//   "wheel:<n>"  in gondola n of the Ferris wheel (can't walk, emote or start a quest until they get off)
//   "cart"       driving their golf cart (faster than running; shared/sim.js → CART_SPEED)
// The shuttle (below) isn't a ride you stay on: it takes you from one stop to another straight away.
import { rad } from "./layout.js";

// ---------- The Ferris wheel ----------
// Free to ride: it's part of hanging out. Where it stands is a "wheel" item in the layout
// (shared/layout.js), so the festival builder can move it; the first one on the map is the ride.
// The wheel turns all the time, on the room's clock, so everyone sees every gondola in the same place.
export const WHEEL = {
  gondolas: 12,
  seats: 4,          // players per gondola
  radius: 15,        // meters, hub to gondola
  hub: 18,           // hub height: gondolas go from 3 m to 33 m, above everything else on the grounds
  period: 150,       // seconds for one slow turn
  boardRange: 9,     // how close to the wheel you have to be to get on
  offArc: 0.5,       // you can step off while your gondola is within this angle (radians) of the bottom
};

// Gondola n's angle at room time t (seconds): 0 is the bottom, π the top.
export function gondolaAngle(n, t) {
  const a = (t / WHEEL.period + n / WHEEL.gondolas) * Math.PI * 2;
  return a % (Math.PI * 2);
}
// How far (radians, 0..π) a gondola is from the bottom.
export const fromBottom = (n, t) => { const a = gondolaAngle(n, t); return Math.min(a, Math.PI * 2 - a); };

// Where gondola n is in the world at time t. The wheel turns in the plane of its long side.
export function gondolaPos(wheel, n, t) {
  const a = gondolaAngle(n, t), r = rad(wheel.rot || 0);
  const side = Math.sin(a) * WHEEL.radius;
  return { x: wheel.x + side * Math.cos(r), y: WHEEL.hub - Math.cos(a) * WHEEL.radius, z: wheel.z - side * Math.sin(r) };
}

// Where you get on and off: on the ground in front of the wheel.
export function boardPoint(wheel) {
  const r = rad(wheel.rot || 0);
  return { x: wheel.x + Math.sin(r) * 5, z: wheel.z + Math.cos(r) * 5 };
}

// The gondola to get into right now: the one nearest the bottom that has a free seat.
// taken: Map gondola -> riders in it. Returns -1 if every seat on the wheel is taken.
export function freeGondola(t, taken = new Map()) {
  let best = -1, bestD = Infinity;
  for (let n = 0; n < WHEEL.gondolas; n++) {
    if ((taken.get(n) ?? 0) >= WHEEL.seats) continue;
    const d = fromBottom(n, t);
    if (d < bestD) { bestD = d; best = n; }
  }
  return best;
}

// When (room time) gondola n is next at the bottom, at least `after` seconds from t.
export function nextBottom(n, t, after = 0) {
  const turns = (t + after) / WHEEL.period + n / WHEEL.gondolas;
  return (Math.ceil(turns - 1e-9) - n / WHEEL.gondolas) * WHEEL.period;
}

export const wheelOf = (items) => (items ?? []).find((i) => i.type === "wheel") ?? null;
export const rideGondola = (ride) => (typeof ride === "string" && ride.startsWith("wheel:") ? Number(ride.slice(6)) : -1);
export const onWheel = (ride) => rideGondola(ride) >= 0;

// ---------- The golf cart ----------
// A status thing as much as transport: everyone can see who's in a cart. It's parked at your camp
// when you're not driving it. Who gets one is in shared/economy.js (GOLF_CART).
export const CART = { id: "golfcart", name: "Golf cart", seats: 1 };   // no passenger seat in this version

// ---------- The shuttle ----------
// Free for everyone, like the Ferris wheel: on the bigger grounds nobody should have to run for two
// minutes to reach a stage. Stops are "stop" items in the layout (move or add them in the festival
// builder). Walk up to a stop, pick another one, and you're there. It doesn't run while your crew is on a
// timed quest (otherwise Vendor Rush would be one tap), and not while you're in a golf cart (just drive).
export const SHUTTLE = { range: 6, landing: 2.5 };
export const stopsOf = (items) => (items ?? []).filter((i) => i.type === "stop");
// The stop you're standing at, or null.
export function stopAt(items, pos, range = SHUTTLE.range) {
  let best = null, bestD = range;
  for (const s of stopsOf(items)) {
    const d = Math.hypot(s.x - pos.x, s.z - pos.z);
    if (d <= bestD) { best = s; bestD = d; }
  }
  return best;
}

// ---------- Golf cart parking ----------
// You can step out of your cart and leave it only in golf cart parking: "carpark" items in the layout
// (🅿️, placed in the festival builder like everything else). Each has bays side by side; a cart left
// there waits until its owner drives it again, leaves the festival, or `returnAfter` seconds pass, then
// it goes back to their camp. Stepping out anywhere else sends the cart straight home (the game warns
// you first). Parked carts are solid, and only their owner can drive them.
export const CART_PARKING = {
  bayWidth: 2.4,       // meters per bay, side by side
  bayDepth: 3.4,
  reach: 2,            // how far outside the painted lot you can still park (you don't have to be exact)
  returnAfter: 10 * 60,
  getInRange: 6,       // press 🛺 this close to your parked cart and you get in where it is
};
export const lotsOf = (items) => (items ?? []).filter((i) => i.type === "carpark");
export const bayCount = (lot) => Math.max(1, Math.floor((lot.w ?? 0) / CART_PARKING.bayWidth));

// A point in the lot's own frame (lx across the bays, lz toward its open front) to the world, and back.
function toWorld(lot, lx, lz) {
  const r = rad(lot.rot || 0), c = Math.cos(r), s = Math.sin(r);
  return { x: lot.x + lx * c + lz * s, z: lot.z - lx * s + lz * c };
}
function toLot(lot, p) {
  const r = rad(lot.rot || 0), c = Math.cos(r), s = Math.sin(r), dx = p.x - lot.x, dz = p.z - lot.z;
  return { lx: dx * c - dz * s, lz: dx * s + dz * c };
}
const bayX = (lot, k) => -lot.w / 2 + CART_PARKING.bayWidth * (k + 0.5) + (lot.w - bayCount(lot) * CART_PARKING.bayWidth) / 2;

// Where the cart in bay k stands, nose in (facing the back of the lot).
export function bayPos(lot, k) {
  const p = toWorld(lot, bayX(lot, k), 0);
  return { x: p.x, z: p.z, rotY: rad(lot.rot || 0) + Math.PI };
}
// Where you're put when you step out: just in front of your bay, on the open side.
export function stepOutPoint(lot, k) { return toWorld(lot, bayX(lot, k), lot.d / 2 + 1); }

// The parking you're in (within `reach` of its painted edges), or null.
export function lotAt(items, pos) {
  let best = null, bestD = Infinity;
  for (const lot of lotsOf(items)) {
    const { lx, lz } = toLot(lot, pos);
    const over = Math.max(Math.abs(lx) - lot.w / 2, Math.abs(lz) - lot.d / 2, 0);
    if (over <= CART_PARKING.reach && over < bestD) { best = lot; bestD = over; }
  }
  return best;
}

// Where a cart at `pos` would be parked: { lot, bay, x, z, rotY }, or { error: "restricted" } when it
// isn't in a parking, or { error: "full", lot }. taken: Set of "lotId:bay" already used by other carts.
export function parkingFor(items, pos, taken = new Set()) {
  const lot = pos && lotAt(items, pos);
  if (!lot) return { error: "restricted" };
  let best = -1, bestD = Infinity;
  for (let k = 0; k < bayCount(lot); k++) {
    if (taken.has(`${lot.id}:${k}`)) continue;
    const b = bayPos(lot, k), d = Math.hypot(b.x - pos.x, b.z - pos.z);
    if (d < bestD) { best = k; bestD = d; }
  }
  if (best < 0) return { error: "full", lot };
  return { lot, bay: best, ...bayPos(lot, best) };
}

// The nearest parking and how to get there ("60 m north-east"), for the warning.
export function nearestLot(items, pos) {
  let best = null, bestD = Infinity;
  for (const lot of lotsOf(items)) { const d = Math.hypot(lot.x - pos.x, lot.z - pos.z); if (d < bestD) { best = lot; bestD = d; } }
  if (!best) return null;
  const dirs = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
  // North is -z on the map.
  const a = Math.atan2(best.x - pos.x, -(best.z - pos.z));
  const dir = dirs[((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8];
  return { lot: best, dist: Math.round(bestD), dir };
}

// A parked cart in the synced player state: "lotId:bay:x:z:rotY" ("" when it isn't parked out).
export const encodeParked = (p) => (p ? `${p.lot.id ?? p.lot}:${p.bay}:${p.x.toFixed(2)}:${p.z.toFixed(2)}:${p.rotY.toFixed(3)}` : "");
export function decodeParked(s) {
  if (typeof s !== "string" || !s) return null;
  const [lot, bay, x, z, rotY] = s.split(":");
  const n = [bay, x, z, rotY].map(Number);
  return n.every(Number.isFinite) ? { lot, bay: n[0], x: n[1], z: n[2], rotY: n[3] } : null;
}

// What's solid about a parked cart: two posts along its length (it's 2.3 m long and 1.3 m wide).
export function cartSolids({ x, z, rotY }) {
  const fx = Math.sin(rotY), fz = Math.cos(rotY);
  return [{ x: x + fx * 0.55, z: z + fz * 0.55, r: 0.7 }, { x: x - fx * 0.55, z: z - fz * 0.55, r: 0.7 }];
}
