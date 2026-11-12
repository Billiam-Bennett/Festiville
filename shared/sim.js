// Shared movement simulation: speed, the edge of the grounds, and collision. The only dependency is
// the layout data, so the SAME code runs on the server (authoritative) and in the browser
// (client-side prediction). If you change movement rules, change them here and both sides stay in sync.
//
// Collision lives here on purpose: the server runs it for every step, so a modified browser can't
// walk through a stage. What is solid comes from the layout (TYPES[...].solid in shared/layout.js),
// from players' camps (shared/camps.js → campSolids) and from each player being a small circle.
import { FENCE, SPAWN, TYPES, forestTrees } from "./layout.js";

export const TICK_RATE = 20;              // server simulation steps per second
export const WALK_SPEED = 3;              // meters per second (a brisk festival stroll)
export const RUN_SPEED = 6.5;             // sprinting between stages
export const CART_SPEED = 11;             // driving a golf cart (shared/rides.js)
export const WORLD_HALF_SIZE = FENCE + 1; // the grounds span ±this on X and Z; follows the fence in shared/layout.js
export const WALK_LIMIT = WORLD_HALF_SIZE - 2;   // players stop just inside the fence
export const PLAYER_RADIUS = 0.4;         // a player is a circle this big
export const CART_RADIUS = 1.0;           // a golf cart is wider
export const TREE_RADIUS = 0.45;          // a tree is as solid as its trunk, not its branches

/**
 * Sanitize an input message from a client. Never trust the client:
 * anything malformed becomes "standing still".
 */
export function sanitizeInput(raw) {
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  let x = num(raw?.x);
  let z = num(raw?.z);
  const len = Math.hypot(x, z);
  if (len > 1) { x /= len; z /= len; }   // no speed hacks via long vectors
  return { x, z, run: raw?.run === true, seq: Math.max(0, Math.floor(num(raw?.seq))) };
}

// ---------- What is solid ----------
// A solid is a circle { x, z, r } or a box { x, z, hw, hd, cos, sin } (center, half sizes, rotation).
// Solids come in named groups so one group can be replaced without touching the rest:
//   "layout"  stages, stalls, tents, tables, trees, the Ferris wheel (setLayoutSolids)
//   "camps"   what's set up in players' camps (setSolids("camps", …))
// Water is separate: it isn't pushed out of like a wall, you simply can't step into it, unless you
// are on a bridge.
const CELL = 8;                            // meters per grid cell (so a step only checks what's nearby)
const world = { groups: new Map(), grid: new Map(), water: [], bridges: [] };

const boxOf = (it, [w, d] = TYPES[it.type].size(it)) => {
  const a = ((it.rot || 0) * Math.PI) / 180;
  return { x: it.x, z: it.z, hw: w / 2, hd: d / 2, cos: Math.cos(a), sin: Math.sin(a) };
};

/** The solids, water and bridges a layout's items make. */
export function layoutSolids(items) {
  const solids = [], water = [], bridges = [];
  for (const it of items ?? []) {
    const t = TYPES[it.type];
    if (!t) continue;
    if (it.type === "bridge") bridges.push(boxOf(it));
    else if (it.type === "forest") for (const tr of forestTrees(it, items)) solids.push({ x: tr.x, z: tr.z, r: TREE_RADIUS });
    else if (t.solid === "water") water.push(boxOf(it));
    else if (t.solid === "box") solids.push(boxOf(it));
    else if (typeof t.solid === "number") solids.push({ x: it.x, z: it.z, r: t.solid });
  }
  return { solids, water, bridges };
}

/** Make a layout's items solid (called whenever the layout is applied, shared/venue.js). */
export function setLayoutSolids(items) {
  const { solids, water, bridges } = layoutSolids(items);
  world.water = water; world.bridges = bridges;
  setSolids("layout", solids);
}

/** Replace one named group of solids. */
export function setSolids(group, solids) {
  world.groups.set(group, solids ?? []);
  world.grid = new Map();
  for (const list of world.groups.values()) for (const s of list) {
    const ex = s.r ?? Math.abs(s.hw * s.cos) + Math.abs(s.hd * s.sin), ez = s.r ?? Math.abs(s.hw * s.sin) + Math.abs(s.hd * s.cos);
    const pad = CART_RADIUS + 0.5;
    for (let ix = Math.floor((s.x - ex - pad) / CELL); ix <= Math.floor((s.x + ex + pad) / CELL); ix++) {
      for (let iz = Math.floor((s.z - ez - pad) / CELL); iz <= Math.floor((s.z + ez + pad) / CELL); iz++) {
        const key = ix * 4096 + iz;
        let cell = world.grid.get(key);
        if (!cell) world.grid.set(key, (cell = []));
        cell.push(s);
      }
    }
  }
}

const inBox = (b, x, z, margin = 0) => {
  const dx = x - b.x, dz = z - b.z;
  const lx = dx * b.cos - dz * b.sin, lz = dx * b.sin + dz * b.cos;
  return Math.abs(lx) <= b.hw + margin && Math.abs(lz) <= b.hd + margin;
};
/** Is (x, z) in water (and not on a bridge)? */
export function inWater(x, z) {
  if (!world.water.some((w) => inBox(w, x, z))) return false;
  return !world.bridges.some((b) => inBox(b, x, z));
}

// Push a circle at p (radius r) out of one solid. Returns true if it moved.
function pushOut(p, s, r) {
  if (s.r !== undefined) {
    const dx = p.x - s.x, dz = p.z - s.z, d = Math.hypot(dx, dz), min = s.r + r;
    if (d >= min) return false;
    if (d < 1e-6) { p.x = s.x + min; return true; }
    p.x = s.x + (dx / d) * min; p.z = s.z + (dz / d) * min;
    return true;
  }
  const dx = p.x - s.x, dz = p.z - s.z;
  let lx = dx * s.cos - dz * s.sin, lz = dx * s.sin + dz * s.cos;   // into the box's own frame
  const cx = clamp(lx, -s.hw, s.hw), cz = clamp(lz, -s.hd, s.hd);
  if (cx === lx && cz === lz) {
    // Center inside the box: leave by the nearest side.
    const px = s.hw - Math.abs(lx), pz = s.hd - Math.abs(lz);
    if (px < pz) lx = (lx < 0 ? -1 : 1) * (s.hw + r); else lz = (lz < 0 ? -1 : 1) * (s.hd + r);
  } else {
    const ox = lx - cx, oz = lz - cz, d = Math.hypot(ox, oz);
    if (d >= r) return false;
    lx = cx + (ox / d) * r; lz = cz + (oz / d) * r;
  }
  p.x = s.x + lx * s.cos + lz * s.sin; p.z = s.z - lx * s.sin + lz * s.cos;
  return true;
}

/** Move a circle out of anything solid it overlaps. Mutates and returns p ({ x, z }). */
export function resolveSolids(p, r = PLAYER_RADIUS) {
  for (let pass = 0; pass < 3; pass++) {
    const cell = world.grid.get(Math.floor(p.x / CELL) * 4096 + Math.floor(p.z / CELL));
    if (!cell) break;
    let moved = false;
    for (const s of cell) if (pushOut(p, s, r)) moved = true;
    if (!moved) break;
  }
  p.x = clamp(p.x, -WALK_LIMIT, WALK_LIMIT);
  p.z = clamp(p.z, -WALK_LIMIT, WALK_LIMIT);
  return p;
}

/** Would a circle at (x, z) overlap something solid, or be in water? (For spawn points and tests.) */
export function blockedAt(x, z, r = PLAYER_RADIUS) {
  if (inWater(x, z)) return true;
  const p = resolveSolids({ x, z }, r);
  return Math.abs(p.x - x) > 1e-6 || Math.abs(p.z - z) > 1e-6;
}

// One step from `from` toward (x, z): stay inside the fence, don't enter water (slide along the
// bank instead), then slide around anything solid.
const TRY = { x: 0, z: 0 };
function step(from, x, z, r) {
  x = clamp(x, -WALK_LIMIT, WALK_LIMIT); z = clamp(z, -WALK_LIMIT, WALK_LIMIT);
  if (world.water.length && inWater(x, z) && !inWater(from.x, from.z)) {
    if (!inWater(x, from.z)) z = from.z;
    else if (!inWater(from.x, z)) x = from.x;
    else { x = from.x; z = from.z; }
  }
  TRY.x = x; TRY.z = z;
  resolveSolids(TRY, r);
  // Being pushed out of a wall must not push you into the river.
  if (world.water.length && inWater(TRY.x, TRY.z) && !inWater(from.x, from.z)) { TRY.x = from.x; TRY.z = from.z; }
  return TRY;
}

/**
 * Advance one player by dt seconds given a sanitized input.
 * Mutates and returns `player` (needs x, z, rotY fields; `ride: "cart"` makes it a golf cart).
 */
export function applyInput(player, input, dt) {
  const cart = player.ride === "cart";
  const speed = cart ? CART_SPEED : input.run ? RUN_SPEED : WALK_SPEED;
  if (input.x !== 0 || input.z !== 0) {
    const to = step(player, player.x + input.x * speed * dt, player.z + input.z * speed * dt, cart ? CART_RADIUS : PLAYER_RADIUS);
    player.x = to.x; player.z = to.z;
    player.rotY = Math.atan2(input.x, input.z);   // face the direction of travel
  }
  return player;
}

// ---------- Players and players ----------
// A soft push, not a wall: two players standing inside each other drift apart, but slower than
// walking speed, so a crowd can always be walked through and nobody can be boxed in.
export const PLAYER_GAP = 0.7;     // players closer than this (center to center) are nudged apart
export const PUSH_SPEED = 1.2;     // meters per second, each

/**
 * Nudge overlapping players apart. `players` is an iterable of objects with x, z (and optionally
 * `ride`; anyone riding something is left alone). Mutates them. Server only: browsers just follow.
 */
export function separatePlayers(players, dt) {
  const cells = new Map();
  const list = [];
  for (const p of players) {
    if (p.ride) continue;
    list.push(p);
    const key = Math.floor(p.x) * 4096 + Math.floor(p.z);
    let c = cells.get(key);
    if (!c) cells.set(key, (c = []));
    c.push(p);
  }
  const max = PUSH_SPEED * dt;
  const moved = new Map();   // player -> where they were before being nudged
  for (const a of list) {
    const ix = Math.floor(a.x), iz = Math.floor(a.z);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const c = cells.get((ix + dx) * 4096 + (iz + dz));
      if (!c) continue;
      for (const b of c) {
        if (b === a) continue;
        let ox = a.x - b.x, oz = a.z - b.z;
        const d = Math.hypot(ox, oz);
        if (d >= PLAYER_GAP - 1e-3) continue;
        if (d < 1e-4) { const ang = (list.indexOf(a) * 2.399963) % (Math.PI * 2); ox = Math.cos(ang); oz = Math.sin(ang); }
        else { ox /= d; oz /= d; }
        const push = Math.min(max, (PLAYER_GAP - d) / 2);         // each of the pair moves its half
        if (!moved.has(a)) moved.set(a, { x: a.x, z: a.z });
        a.x += ox * push; a.z += oz * push;
      }
    }
  }
  for (const [p, before] of moved) {
    resolveSolids(p);
    if (inWater(p.x, p.z)) { p.x = before.x; p.z = before.z; }
  }
  return moved.size;
}

/** Somewhere to appear: near the spawn point (just inside the gate), not inside anything. */
export function randomSpawn(radius = SPAWN.radius, center = SPAWN) {
  for (let i = 0; i < 30; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * radius;
    const x = center.x + Math.cos(a) * r, z = center.z + Math.sin(a) * r;
    if (!blockedAt(x, z)) return { x, z };
  }
  return resolveSolids({ x: center.x, z: center.z });
}

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
