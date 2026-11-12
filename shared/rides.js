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
