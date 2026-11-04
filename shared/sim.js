// Shared movement simulation. No dependencies, so the SAME code runs on the
// server (authoritative) and in the browser (client-side prediction).
// If you change movement rules, change them here and both sides stay in sync.

export const TICK_RATE = 20;              // server simulation steps per second
export const WALK_SPEED = 3;              // meters per second (a brisk festival stroll)
export const RUN_SPEED = 6.5;             // sprinting between stages
export const WORLD_HALF_SIZE = 100;       // festival grounds span -100..100 on X and Z (match your Three.js map)
export const WALK_LIMIT = WORLD_HALF_SIZE - 2;   // the perimeter fence stands at ±99; players stop just inside it

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

/**
 * Advance one player by dt seconds given a sanitized input.
 * Mutates and returns `player` (needs x, z, rotY fields).
 */
export function applyInput(player, input, dt) {
  const speed = input.run ? RUN_SPEED : WALK_SPEED;
  if (input.x !== 0 || input.z !== 0) {
    player.x = clamp(player.x + input.x * speed * dt, -WALK_LIMIT, WALK_LIMIT);
    player.z = clamp(player.z + input.z * speed * dt, -WALK_LIMIT, WALK_LIMIT);
    player.rotY = Math.atan2(input.x, input.z);   // face the direction of travel
  }
  return player;
}

export function randomSpawn(radius = 10) {
  const a = Math.random() * Math.PI * 2;
  const r = Math.random() * radius;
  return { x: Math.cos(a) * r, z: Math.sin(a) * r };
}

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
