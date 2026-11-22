// Walking, running, turning and driving maths (client/motion.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { measureGait, locomotion, clipTime, leanFor, cartPose, GAIT, DEFAULT_GAIT, CART_POSE } from "../client/motion.js";

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ""} ${a} ≉ ${b} (±${tol})`);

// A made-up walk cycle: each foot is planted for 60% of the cycle and moves back at `speed` relative to
// the hips. In place the hips stay put; with root motion the hips move forward and the planted foot
// stands still. The right foot is half a cycle behind the left.
function fakeCycle({ speed = 1.5, duration = 1, rootMotion = false, leftForwardAt = 0.2, N = 60 }) {
  const reach = (speed * 0.6 * duration) / 2;   // how far ahead of the hips a foot lands
  const foot = (u) => {   // u: 0..1 through this foot's own cycle, 0 = heel down, furthest forward
    u = ((u % 1) + 1) % 1;
    if (u < 0.6) return { y: 0, z: reach * (1 - (2 * u) / 0.6) };          // planted
    const k = (u - 0.6) / 0.4;
    return { y: 0.15 * Math.sin(Math.PI * k), z: reach * (2 * k - 1) };     // swinging forward
  };
  const samples = [];
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * duration, u = t / duration - leftForwardAt;
    const hipZ = rootMotion ? speed * t : 0;
    const l = foot(u), r = foot(u - 0.5);
    samples.push({ t, hipZ, feet: [{ y: l.y, z: l.z + hipZ }, { y: r.y, z: r.z + hipZ }] });
  }
  return samples;
}

test("measures how fast a walk cycle moves its feet, in place or with root motion", () => {
  for (const rootMotion of [false, true]) {
    const g = measureGait(fakeCycle({ speed: 2, duration: 1, rootMotion }), 1);
    assert.ok(g, "measured");
    near(g.speed, 2, 0.05, `speed (root motion ${rootMotion})`);
    near(g.phase, 0.2, 0.03, "left foot furthest forward");
  }
  const run = measureGait(fakeCycle({ speed: 4, duration: 0.7, leftForwardAt: 0.3 }), 0.7);
  near(run.speed, 4, 0.1, "a faster, shorter cycle");
  near(run.phase, 0.3, 0.03);
});

test("won't guess from something that isn't a walk", () => {
  assert.equal(measureGait([], 1), null);
  const still = Array.from({ length: 20 }, (_, i) => ({ t: i / 19, hipZ: 0, feet: [{ y: 0, z: 0.1 }, { y: 0, z: -0.1 }] }));
  assert.equal(measureGait(still, 1), null, "feet that never move");
});

// The real clips: a tiny forward-kinematics pass over the build-your-own bodies and their shared
// animations, the same measurement the browser makes with Three.js.
function realGait(body, clipName) {
  const buf = fs.readFileSync(new URL(`../client/assets/parts/${body}/body.glb`, import.meta.url));
  const gltf = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString());
  const clip = JSON.parse(fs.readFileSync(new URL(`../client/assets/parts/${body}/anims.json`, import.meta.url))).find((c) => c.name === clipName);
  const nodes = gltf.nodes, parent = nodes.map(() => -1);
  nodes.forEach((n, i) => (n.children ?? []).forEach((c) => (parent[c] = i)));
  const key = (n) => (n ?? "").replace(/^mixamorig\d*:?/, "");
  const idx = Object.fromEntries(nodes.map((n, i) => [key(n.name), i]));
  const qmul = (a, b) => [a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1], a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0], a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3], a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2]];
  const qrot = (q, v) => qmul(qmul(q, [...v, 0]), [-q[0], -q[1], -q[2], q[3]]).slice(0, 3);
  const at = (track, t) => {
    const k = track.name.endsWith("quaternion") ? 4 : 3, T = track.times;
    let i = T.findIndex((x) => x > t); if (i < 1) i = i === 0 ? 1 : T.length - 1;
    const a = Math.min(1, Math.max(0, (t - T[i - 1]) / (T[i] - T[i - 1] || 1)));
    const v = Array.from({ length: k }, (_, j) => track.values[(i - 1) * k + j] * (1 - a) + track.values[i * k + j] * a);
    const l = k === 4 ? Math.hypot(...v) : 1;
    return v.map((x) => x / l);
  };
  const pose = (t) => {
    const local = nodes.map((n) => ({ p: n.translation ?? [0, 0, 0], r: n.rotation ?? [0, 0, 0, 1], s: n.scale ?? [1, 1, 1] }));
    if (clip) for (const tr of clip.tracks) {
      const dot = tr.name.lastIndexOf("."), i = idx[key(tr.name.slice(0, dot))];
      if (i == null) continue;
      if (tr.name.endsWith("quaternion")) local[i].r = at(tr, t); else if (tr.name.endsWith("position")) local[i].p = at(tr, t);
    }
    const W = [];
    const world = (i) => W[i] ?? (W[i] = parent[i] < 0 ? local[i] : (() => {
      const P = world(parent[i]), L = local[i];
      return { p: qrot(P.r, L.p.map((x, j) => x * P.s[j])).map((x, j) => x + P.p[j]), r: qmul(P.r, L.r), s: L.s.map((x, j) => x * P.s[j]) };
    })());
    return world;
  };
  const rest = pose(-1);
  for (const k of ["Hips", "LeftToeBase", "RightToeBase"]) assert.ok(idx[k] != null, `${body} body has a ${k} bone`);
  const scale = 1;   // these bodies are in meters (client/avatar.js); speeds are compared per meter of hips anyway
  const samples = [];
  for (let i = 0; i <= 48; i++) {
    const t = (i / 48) * clip.duration, w = pose(t);
    const foot = (k) => ({ y: w(idx[k]).p[1] * scale, z: w(idx[k]).p[2] * scale });
    samples.push({ t, hipZ: w(idx.Hips).p[2] * scale, feet: [foot("LeftToeBase"), foot("RightToeBase")] });
  }
  return { ...measureGait(samples, clip.duration), duration: clip.duration, hips: rest(idx.Hips).p[1] * scale };
}

test("the shipped walk and run clips measure close to the defaults", () => {
  for (const body of ["female", "male"]) {
    for (const k of ["Walk", "Run"]) {
      const g = realGait(body, k);
      // Bodies differ a little in leg length, so allow 10%.
      near(g.speed / g.hips, DEFAULT_GAIT[k].speed / 0.95, (DEFAULT_GAIT[k].speed / 0.95) * 0.1, `${body} ${k} speed per meter of hips`);
      near(g.phase, DEFAULT_GAIT[k].phase, 0.05, `${body} ${k} left foot forward`);
    }
  }
});

const SHIPPED = { Walk: { ...DEFAULT_GAIT.Walk, duration: 0.97 }, Run: { ...DEFAULT_GAIT.Run, duration: 0.7 } };
const groundSpeed = (l, g) => l.rate * (l.walk + l.run > 0
  ? (l.walk * g.Walk.speed * g.Walk.duration + l.run * g.Run.speed * g.Run.duration) / (l.walk + l.run) : 0);

test("standing, walking and running blend, adding up to one", () => {
  for (const s of [0, 0.5, 1, 2, 3, 4, 5, 6.5, 9]) {
    const l = locomotion(s, SHIPPED);
    near(l.idle + l.walk + l.run, 1, 1e-9, `weights at ${s} m/s`);
    for (const w of [l.idle, l.walk, l.run]) assert.ok(w >= 0 && w <= 1);
  }
  assert.deepEqual([locomotion(0, SHIPPED).idle, locomotion(0, SHIPPED).run], [1, 0], "standing still");
  const walk = locomotion(3, SHIPPED);   // shared/sim.js WALK_SPEED
  assert.ok(walk.walk > 0.6 && walk.run > 0.15, "walking at 3 m/s is mostly walk with a little jog");
  assert.equal(locomotion(6.5, SHIPPED).run, 1, "running at 6.5 m/s is all run");
  // Speeding up never makes the legs swap back toward walking.
  let last = 0;
  for (let s = 0; s <= 7; s += 0.25) { const r = locomotion(s, SHIPPED).run; assert.ok(r >= last); last = r; }
});

test("feet stay planted at the game's walking and running speeds", () => {
  for (const s of [1.5, 3, 4.5, 6.5]) {
    const l = locomotion(s, SHIPPED);
    near(groundSpeed(l, SHIPPED), s, 1e-6, `legs at ${s} m/s`);
    // And the playback speed stays believable.
    const natural = SHIPPED.Walk.duration + (SHIPPED.Run.duration - SHIPPED.Walk.duration) * (l.run / (l.walk + l.run));
    assert.ok(l.rate * natural <= GAIT.maxRate + 1e-9, `not faster than ${GAIT.maxRate}× at ${s} m/s`);
  }
});

test("walk and run plant the same foot at the same moment", () => {
  for (const phase of [0, 0.3, 0.75]) {
    const w = clipTime(SHIPPED.Walk, phase) / SHIPPED.Walk.duration, r = clipTime(SHIPPED.Run, phase) / SHIPPED.Run.duration;
    near((w - SHIPPED.Walk.phase + 1) % 1, (r - SHIPPED.Run.phase + 1) % 1, 1e-9, `phase ${phase}`);
  }
  near(clipTime(SHIPPED.Walk, 0), SHIPPED.Walk.phase * SHIPPED.Walk.duration, 1e-9, "phase 0 is left foot forward");
});

test("characters missing a clip still move", () => {
  const noRun = locomotion(6.5, { Walk: SHIPPED.Walk, Run: null });
  assert.equal(noRun.run, 0);
  near(noRun.walk, 1, 1e-9);
  assert.deepEqual(locomotion(5, {}), { idle: 1, walk: 0, run: 0, rate: 0 });
});

test("turning on the spot takes a few steps", () => {
  assert.equal(locomotion(0, SHIPPED, { turn: 0 }).walk, 0);
  const turning = locomotion(0, SHIPPED, { turn: 8 });
  assert.ok(turning.walk > 0.3 && turning.walk <= GAIT.turnStep.max, "steps while turning");
  assert.ok(turning.rate > 0);
});

test("leaning into turns: the right way, and not too far", () => {
  assert.equal(leanFor(3, 0), -0, "straight: upright");
  assert.ok(leanFor(3, 2) < 0, "left turn leans left (negative roll)");
  assert.ok(leanFor(3, -2) > 0, "right turn leans right");
  assert.ok(Math.abs(leanFor(6.5, 2)) > Math.abs(leanFor(3, 2)), "more lean when faster");
  assert.equal(Math.abs(leanFor(6.5, 40)), GAIT.lean.max, "capped");
  assert.equal(leanFor(0, 5), -0, "standing still: no lean");
});

test("golf cart: steering, body roll and pitch", () => {
  assert.deepEqual(cartPose(11, 0, 0), { steer: 0, roll: 0, pitch: -0 }, "straight and steady");
  const left = cartPose(11, 1.5, 0);
  assert.ok(left.steer > 0, "front wheels turn left");
  assert.ok(left.roll > 0, "body leans out of the turn");
  assert.ok(left.steer <= CART_POSE.maxSteer && left.roll <= CART_POSE.maxRoll);
  assert.equal(cartPose(0.2, 3, 0).steer, 0, "no steering when barely moving");
  assert.ok(cartPose(5, 0, 8).pitch < 0, "nose lifts speeding up");
  assert.ok(cartPose(5, 0, -8).pitch > 0, "nose dips braking");
  assert.equal(Math.abs(cartPose(11, 0, 500).pitch), CART_POSE.maxPitch, "capped");
});
