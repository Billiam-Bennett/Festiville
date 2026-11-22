// How characters and golf carts move: the maths behind walking, running, turning and driving, kept
// apart from Three.js so it can be tested on its own (test/motion.test.js).
//
// Feet that stay planted. Walk and Run clips are made "in place": the hips stay put and each foot
// slides back along the ground while it carries the weight. How fast it slides is how fast the clip
// "walks". character.js measures that once per clip (measureGait) and then plays the legs exactly as
// fast as the character really moves, so the feet don't skate. Walk and Run share one step cycle, lined
// up so both plant the left foot at the same moment, and blend by speed (locomotion).

export const GAIT = {
  idleToMove: [0.12, 0.9],     // m/s: standing below the first, fully walking above the second
  walkToRun: [1.9, 5.0],       // m/s: Walk blends into Run across this range. The game walks at 3 m/s
                               //   (brisk), which is a fast walk with a little jog in it; running is 6.5.
  minRate: 0.6,                // the legs never cycle slower than this × the clip's own speed (while
                               //   starting and stopping) ...
  maxRate: 1.8,                // ... or faster than this; between the two the feet are locked to the ground
  turnStep: { full: 5, max: 0.5 },   // turning on the spot: take small steps (rad/s for the most, how much)
  lean: { gain: 0.18, max: 0.14 },   // lean into turns: share of the physical lean, and the most (radians)
};

// Used when a clip can't be measured (a rig without foot bones). Measured from the Mixamo clips the
// game ships (scripts/retarget.mjs, scripts/parts-anims.mjs) on a 1.7 m character.
export const DEFAULT_GAIT = { Walk: { speed: 1.65, phase: 0.21 }, Run: { speed: 3.75, phase: 0.28 } };

export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
// Ease `from` toward `to` at `rate` per second, the same at any frame rate.
export const ease = (from, to, rate, dt) => from + (to - from) * (1 - Math.exp(-rate * dt));

/**
 * How fast a Walk or Run clip moves its feet, from samples over one cycle.
 * samples: [{ t, hipZ, feet: [{ y, z }, { y, z }] }] (left foot first), in time order over [0, duration],
 * in meters in the character's own frame (it faces +z). Returns { speed (m/s), phase (0..1, when the
 * left foot is furthest forward) } or null when the samples don't look like a walk cycle.
 */
export function measureGait(samples, duration) {
  if (!Array.isArray(samples) || samples.length < 8 || !(duration > 0)) return null;
  const speeds = [];
  for (let f = 0; f < 2; f++) {
    // A foot is on the ground for the lowest part of its cycle (60% of a walk, 35% of a run); the lowest
    // 30% of samples is safely inside that for both.
    const ys = samples.map((s) => s.feet[f].y).sort((a, b) => a - b);
    const cut = ys[Math.floor((ys.length - 1) * 0.3)];
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1], b = samples[i];
      if (a.feet[f].y > cut || b.feet[f].y > cut || !(b.t > a.t)) continue;
      // Relative to the hips, so clips that do move forward (root motion) measure the same.
      speeds.push(-((b.feet[f].z - b.hipZ) - (a.feet[f].z - a.hipZ)) / (b.t - a.t));
    }
  }
  if (speeds.length < 4) return null;
  speeds.sort((a, b) => a - b);
  const speed = speeds[speeds.length >> 1];
  if (!(speed > 0.3 && speed < 15)) return null;
  let best = samples[0];
  for (const s of samples) if (s.feet[0].z - s.hipZ > best.feet[0].z - best.hipZ) best = s;
  return { speed, phase: (best.t / duration) % 1 };
}

/**
 * How much Idle, Walk and Run to show at `speed` (m/s), and how fast to cycle the legs.
 * gait: { Walk, Run } each { speed, phase, duration } or null when the character doesn't have it.
 * turn: how fast the character is turning (rad/s), so turning on the spot takes a few steps.
 * Returns { idle, walk, run } weights (adding up to 1) and `rate`, step cycles per second.
 */
export function locomotion(speed, gait = {}, { turn = 0 } = {}) {
  const W = gait.Walk ?? null, R = gait.Run ?? null;
  if (!W && !R) return { idle: 1, walk: 0, run: 0, rate: 0 };
  const s = Math.max(0, speed || 0);
  const move = smoothstep(GAIT.idleToMove[0], GAIT.idleToMove[1], s);
  const step = (1 - move) * Math.min(GAIT.turnStep.max, Math.abs(turn) / GAIT.turnStep.full);
  const share = Math.max(move, step);
  const run = !R ? 0 : !W ? 1 : smoothstep(GAIT.walkToRun[0], GAIT.walkToRun[1], s);
  const a = W ?? R, b = R ?? W;
  const stride = lerp(a.speed * a.duration, b.speed * b.duration, run);   // meters per step cycle
  const natural = lerp(a.duration, b.duration, run);                       // seconds per cycle at the clips' own speed
  const rate = clamp(s / stride, GAIT.minRate / natural, GAIT.maxRate / natural);
  return { idle: 1 - share, walk: share * (1 - run), run: share * run, rate };
}

/** Where in its clip a Walk or Run is at step phase `phase` (0..1): seconds. */
export const clipTime = (g, phase) => ((((phase + g.phase) % 1) + 1) % 1) * g.duration;

/**
 * Lean into a turn: the sideways tilt (radians, about the forward axis; negative tips the head to the
 * character's left) for someone moving at `speed` m/s while turning at `turn` rad/s (positive = left).
 */
export function leanFor(speed, turn) {
  const physical = Math.atan((Math.max(0, speed) * turn) / 9.8);
  return -clamp(physical * GAIT.lean.gain, -GAIT.lean.max, GAIT.lean.max);
}

// ---------- Golf carts ----------
export const CART_POSE = {
  wheelRadius: 0.26,      // meters (client/rides-ui.js cartMesh)
  wheelbase: 1.5,         // front axle to back axle
  maxSteer: 0.45,         // radians the front wheels turn at most
  roll: 0.006,            // body roll per (m/s × rad/s): leans out of a turn ...
  maxRoll: 0.05,          // ... up to about 3°
  pitch: 0.004,           // nose lifts when speeding up and dips when braking, per m/s² ...
  maxPitch: 0.035,        // ... up to about 2°
};

/**
 * The look of a moving cart: front wheel steering, body roll and pitch.
 * speed m/s, turn rad/s (positive = left), accel m/s². Angles in radians, in the cart's own frame
 * (steer: positive turns the wheels left; roll: rotation about forward, positive tips the roof right,
 * out of a left turn; pitch: rotation about the axle, negative lifts the nose).
 */
export function cartPose(speed, turn, accel) {
  const C = CART_POSE;
  const steer = speed > 0.5 ? clamp(Math.atan((turn * C.wheelbase) / speed), -C.maxSteer, C.maxSteer) : 0;
  const roll = clamp(speed * turn * C.roll, -C.maxRoll, C.maxRoll);
  const pitch = -clamp(accel * C.pitch, -C.maxPitch, C.maxPitch);
  return { steer, roll, pitch };
}
