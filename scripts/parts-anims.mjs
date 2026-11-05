// Rebuild the parts bodies' animations: client/assets/parts/<body>/anims.json for every body.
//
//   npm run parts-anims              (both bodies)
//   npm run parts-anims -- female    (one body)
//
// Where the animations come from (all CC0 except the classic four, see client/assets/parts/CREDITS.md):
//   • Idle, Walk, Run, Dance: the classic characters' animations (client/assets/characters/remy.anims.json).
//   • Wave, Cheer, Jump, SitDown/SitIdle/StandUp: KayKit "Character Animations" by Kay Lousberg (CC0).
//   • Bounce (a second dance), ThumbsUp: Quaternius "Universal Animation Library" 1 and 2 (CC0).
//   • Clap, Point, FistPump: made right here (no CC0 pack had them): poses keyed on top of Idle with
//     simple two-bone IK, below. Same license as this repository's own code.
// The CC0 packs are downloaded once into .cache/anim-sources/ (not committed; ~25 MB).
// Everything is fitted with scripts/retarget.mjs, so it lines up with each body's own skeleton.
//
// The game's emote list is shared/emotes.js; each emote names the clip(s) it plays.
import * as THREE from "three";
import { existsSync, mkdirSync, writeFileSync, statSync } from "node:fs";
import { BODIES } from "../shared/parts.js";
import { loadTarget, sourceFor, retargetClip, parseSpec, reduceKeys } from "./retarget.mjs";

const CACHE = ".cache/anim-sources";
const MIRROR = "https://media.githubusercontent.com/media/series-ai/jam-ready-assets/HEAD";
const SOURCES = {
  "UAL1_Standard.glb": `${MIRROR}/quaternius-universal-animation-library/3D/characters/UAL1_Standard.glb`,
  "UAL2_Standard.glb": `${MIRROR}/quaternius-universal-animation-library-2/3D/characters/UAL2_Standard.glb`,
  "Rig_Medium_Simulation.glb": `${MIRROR}/kaykit-character-animations/3D/characters/Animations/gltf/Rig_Medium/Rig_Medium_Simulation.glb`,
  "Rig_Medium_MovementBasic.glb": `${MIRROR}/kaykit-character-animations/3D/characters/Animations/gltf/Rig_Medium/Rig_Medium_MovementBasic.glb`,
};
const CLASSIC = "client/assets/characters/remy.anims.json";
const src = (file) => `${CACHE}/${file}`;

// Name=source#Clip@start-end (see scripts/retarget.mjs).
const RETARGETED = [
  `Idle=${CLASSIC}#Idle`,
  `Walk=${CLASSIC}#Walk`,
  `Run=${CLASSIC}#Run`,
  `Dance=${CLASSIC}#Dance`,
  `Wave=${src("Rig_Medium_Simulation.glb")}#Waving`,
  `Cheer=${src("Rig_Medium_Simulation.glb")}#Cheering@0.1-1.5`,
  `SitDown=${src("Rig_Medium_Simulation.glb")}#Sit_Floor_Down@0-0.9`,
  `SitIdle=${src("Rig_Medium_Simulation.glb")}#Sit_Floor_Idle`,
  `StandUp=${src("Rig_Medium_Simulation.glb")}#Sit_Floor_StandUp@0-1.07`,
  `Jump=${src("Rig_Medium_MovementBasic.glb")}#Jump_Full_Short`,
  `Bounce=${src("UAL1_Standard.glb")}#Dance_Loop`,
  `ThumbsUp=${src("UAL2_Standard.glb")}#Yes`,
];

async function download() {
  mkdirSync(CACHE, { recursive: true });
  for (const [file, url] of Object.entries(SOURCES)) {
    const path = src(file);
    if (existsSync(path) && statSync(path).size > 1000) continue;
    console.log(`Downloading ${file}…`);
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Couldn't download ${url} (${r.status}). Download it by hand into ${CACHE}/`);
    writeFileSync(path, Buffer.from(await r.arrayBuffer()));
  }
}

// ---------- Hand-made clips ----------
// Poses are set on the body's own skeleton, frame by frame, on top of the (already fitted) Idle.
// Directions are in the character's space: +x = its left, +y = up, +z = forward.
const FPS = 30;
const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
const smooth = (t) => t * t * (3 - 2 * t);
// Piecewise-smooth curve through [time, value] keys.
function curve(keys, t) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1] = keys[i], [t0, v0] = keys[i - 1];
    if (t <= t1) return v0 + (v1 - v0) * smooth((t - t0) / (t1 - t0));
  }
  return keys[keys.length - 1][1];
}

function poser(T) {
  const b = (n) => T.bones[n].node;
  const wq = (n) => b(n).getWorldQuaternion(new THREE.Quaternion());
  const wp = (n) => b(n).getWorldPosition(new THREE.Vector3());
  const update = () => T.scene.updateMatrixWorld(true);
  // Turn bone n (in world space) by quaternion `turn`.
  const turnWorld = (n, turn) => {
    const parentQ = b(n).parent.getWorldQuaternion(new THREE.Quaternion());
    b(n).quaternion.copy(parentQ.clone().invert().multiply(turn).multiply(parentQ.multiply(b(n).quaternion)));
    b(n).updateMatrixWorld(true);
  };
  const aim = (n, from, to) => turnWorld(n, new THREE.Quaternion().setFromUnitVectors(from.clone().normalize(), to.clone().normalize()));

  // Two-bone IK: put the end of upper→lower→end at `target`, bending toward `pole`.
  function ik(upper, lower, end, target, pole) {
    update();
    const A = wp(upper), B = wp(lower), C = wp(end);
    const l1 = A.distanceTo(B), l2 = B.distanceTo(C);
    const toT = target.clone().sub(A);
    const d = Math.min(Math.max(toT.length(), Math.abs(l1 - l2) + 1e-3), l1 + l2 - 1e-3);
    const n = toT.normalize();
    const p = pole.clone().sub(n.clone().multiplyScalar(pole.dot(n))).normalize();
    const cosA = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d);
    const E = A.clone().add(n.clone().multiplyScalar(l1 * cosA)).add(p.multiplyScalar(l1 * Math.sqrt(Math.max(0, 1 - cosA * cosA))));
    aim(upper, B.clone().sub(A), E.clone().sub(A));
    update();
    aim(lower, wp(end).sub(wp(lower)), A.clone().add(n.multiplyScalar(d)).sub(wp(lower)));
    update();
  }

  // Hand: point its fingers along `along` with the palm facing `palm`.
  function hand(side, along, palm) {
    update();
    const H = `${side}Hand`;
    const fwd = () => wp(`${H}Middle1`).sub(wp(H)).normalize();
    aim(H, fwd(), along);
    update();
    const f = fwd();
    const across = wp(`${H}Pinky1`).sub(wp(`${H}Index1`)).normalize();
    const nrm = f.clone().cross(across).multiplyScalar(side === "Left" ? -1 : 1);   // current palm direction
    const flat = (v) => v.clone().sub(f.clone().multiplyScalar(v.dot(f))).normalize();
    aim(H, flat(nrm), flat(palm));
  }

  // Curl fingers toward the palm: amount 0 (straight) … 1 (fist), per finger.
  function curl(side, amounts) {
    for (const [finger, amount] of Object.entries(amounts)) {
      for (const i of [1, 2, 3]) {
        update();
        const H = `${side}Hand`;
        const f = wp(`${H}Middle1`).sub(wp(H)).normalize();
        const across = wp(`${H}Pinky1`).sub(wp(`${H}Index1`)).normalize();
        const palm = f.clone().cross(across).multiplyScalar(side === "Left" ? -1 : 1);
        const n = `${H}${finger}${i}`;
        if (!T.bones[n]) continue;
        const axis = finger === "Thumb" ? f.clone().cross(palm).normalize().negate().add(palm.clone().multiplyScalar(0.3)).normalize()
          : f.clone().cross(palm).normalize();
        const angle = amount * (finger === "Thumb" ? [0.3, 0.6, 0.6] : [1.3, 1.5, 1.0])[i - 1];
        turnWorld(n, new THREE.Quaternion().setFromAxisAngle(axis, angle));
      }
    }
  }
  return { b, wp, wq, update, ik, hand, curl, turnWorld };
}

const FIST = { Index: 1, Middle: 1, Ring: 1, Pinky: 1, Thumb: 1 };

// Each maker poses one frame at time t (Idle is already applied) and returns how strongly the pose
// replaces Idle (0…1), so clips can ease in from and out to Idle.
const MADE = {
  // Clapping along to the music, loops (4 claps in 2 s, 120 bpm).
  Clap: {
    duration: 2,
    pose(P, t) {
      const chest = P.wp("Spine2");
      const beat = (t * 2) % 1;                               // 0 → 1 each clap
      const gap = 0.025 + 0.13 * curve([[0, 1], [0.35, 0], [0.45, 0], [1, 1]], beat);   // hands meet at 0.35-0.45
      const bob = 0.02 * Math.sin(beat * Math.PI * 2);
      for (const [side, s] of [["Left", 1], ["Right", -1]]) {
        const target = chest.clone().add(v3(s * gap, -0.04 + bob, 0.32));
        P.ik(`${side}Arm`, `${side}ForeArm`, `${side}Hand`, target, v3(s * 0.8, -1, -0.4));
        P.hand(side, v3(-s * 0.25, 0.75, 0.6), v3(-s, 0, 0));
        P.curl(side, { Index: 0.1, Middle: 0.1, Ring: 0.15, Pinky: 0.2, Thumb: 0.1 });
      }
      return 1;
    },
  },
  // Point ahead, with a little jab, then back to Idle.
  Point: {
    duration: 2,
    pose(P, t) {
      const w = curve([[0, 0], [0.35, 1], [1.55, 1], [2, 0]], t);
      if (w === 0) return 0;
      const jab = 0.06 * curve([[0.35, 0], [0.55, 1], [0.75, 0], [0.95, 1], [1.15, 0]], t);
      const shoulder = P.wp("RightArm");
      P.ik("RightArm", "RightForeArm", "RightHand", shoulder.clone().add(v3(-0.12, 0.12, 0.5 + jab)), v3(-1, -0.6, -0.2));
      P.hand("Right", v3(-0.1, 0.18, 1), v3(0.2, -1, 0));
      P.curl("Right", { Index: 0, Middle: 1, Ring: 1, Pinky: 1, Thumb: 0.8 });
      return w;
    },
  },
  // Fist pump on the beat (128 bpm), loops; knees bounce with it.
  FistPump: {
    duration: 60 / 128 * 4,
    pose(P, t) {
      const beat = (t * 128 / 60) % 1;
      const up = curve([[0, 0.25], [0.18, 1], [0.5, 0.55], [1, 0.25]], beat);
      const dip = 0.05 * curve([[0, 0], [0.15, 1], [0.6, 0.2], [1, 0]], beat);
      // Bounce: lower the hips, keep the feet planted.
      const feet = ["Left", "Right"].map((s) => P.wp(`${s}Foot`));
      const hipsAt = P.wp("Hips").add(v3(0, -dip, 0));
      P.b("Hips").position.copy(P.b("Hips").parent.worldToLocal(hipsAt));
      P.update();
      ["Left", "Right"].forEach((s, i) => P.ik(`${s}UpLeg`, `${s}Leg`, `${s}Foot`, feet[i], v3(0, 0, 1)));
      const shoulder = P.wp("RightArm");
      P.ik("RightArm", "RightForeArm", "RightHand", shoulder.clone().add(v3(-0.1, 0.1 + 0.45 * up, 0.18)), v3(-0.6, -0.2, -1));
      P.hand("Right", v3(-0.05, 1, 0.2), v3(0.6, 0, 0.5));
      P.curl("Right", FIST);
      const lShoulder = P.wp("LeftArm");
      P.ik("LeftArm", "LeftForeArm", "LeftHand", lShoulder.clone().add(v3(0.18, -0.3, 0.2)), v3(1, -0.3, -1));
      P.curl("Left", { Index: 0.5, Middle: 0.55, Ring: 0.6, Pinky: 0.65, Thumb: 0.3 });
      return 1;
    },
  },
};

// Bake a clip: each frame, apply `base` (a clip) at time t, then let pose(P, t) adjust the skeleton.
// pose returns how strongly its adjustments replace `base` (0…1), so clips can ease in and out.
function bake(T, name, duration, base, pose) {
  const P = poser(T);
  const order = Object.keys(T.bones);
  const rest = Object.fromEntries(order.map((n) => [n, T.bones[n].node.quaternion.clone()]));
  const restHips = T.bones.Hips.node.position.clone();
  // Sample `base` ourselves: an AnimationMixer skips writing values that haven't changed since its
  // last write, so it wouldn't undo the previous frame's posing on bones that `base` keeps still.
  const byName = Object.fromEntries(order.map((n) => [T.bones[n].node.name, T.bones[n].node]));
  const baseTracks = base.tracks.map((tr) => {
    const [node, prop] = tr.name.split(".");
    return { target: byName[node]?.[prop], interp: tr.createInterpolant() };
  }).filter((x) => x.target);
  const frames = Math.round(duration * FPS) + 1;
  const times = [], vals = Object.fromEntries(order.map((n) => [n, []])), hips = [];
  const hipsScale = T.bones.Hips.node.parent.getWorldScale(new THREE.Vector3()).y || 1;
  for (let f = 0; f < frames; f++) {
    const t = Math.min(f / FPS, duration);
    times.push(+t.toFixed(3));
    for (const n of order) T.bones[n].node.quaternion.copy(rest[n]);
    T.bones.Hips.node.position.copy(restHips);
    for (const { target, interp } of baseTracks) target.fromArray(interp.evaluate(t > base.duration ? t % base.duration : t));
    P.update();
    const basePose = Object.fromEntries(order.map((n) => [n, T.bones[n].node.quaternion.clone()]));
    const baseHips = T.bones.Hips.node.position.clone();
    const w = pose(P, t);
    for (const n of order) {
      const q = basePose[n].clone().slerp(T.bones[n].node.quaternion, w);
      const prev = vals[n].slice(-4);
      if (prev.length && prev[0] * q.x + prev[1] * q.y + prev[2] * q.z + prev[3] * q.w < 0) q.set(-q.x, -q.y, -q.z, -q.w);
      vals[n].push(q.x, q.y, q.z, q.w);
    }
    hips.push(...baseHips.lerp(T.bones.Hips.node.position, w).toArray());
  }
  for (const n of order) T.bones[n].node.quaternion.copy(rest[n]);
  T.bones.Hips.node.position.copy(restHips);
  T.scene.updateMatrixWorld(true);
  const round = (a) => a.map((v) => +v.toFixed(4));
  const tracks = order.map((n) => { const r = reduceKeys(times, vals[n], 4, 0.0015); return new THREE.QuaternionKeyframeTrack(`${T.bones[n].node.name}.quaternion`, r.times, round(r.values)); });
  const r = reduceKeys(times, hips, 3, (0.002 * T.hipHeight) / hipsScale);
  tracks.push(new THREE.VectorKeyframeTrack(`${T.bones.Hips.node.name}.position`, r.times, r.values.map((v) => +v.toFixed(5))));
  return new THREE.AnimationClip(name, duration, tracks);
}

// Keep the feet on (not under) the ground: rigs with shorter legs than ours (KayKit) sit with their
// feet below the floor once fitted. Bend the knee instead, keeping each foot's angle.
function plantFeet(T, clip) {
  const restAnkle = Math.min(...["Left", "Right"].map((s) => T.bones[`${s}Foot`].restWorldP.y));
  return bake(T, clip.name, clip.duration, clip, (P) => {
    for (const s of ["Left", "Right"]) {
      const foot = P.wp(`${s}Foot`);
      if (foot.y >= restAnkle) continue;
      const footQ = P.wq(`${s}Foot`);
      const knee = P.wp(`${s}Leg`).sub(P.wp(`${s}UpLeg`));
      P.ik(`${s}UpLeg`, `${s}Leg`, `${s}Foot`, foot.setY(restAnkle), knee);
      const parentQ = P.b(`${s}Foot`).parent.getWorldQuaternion(new THREE.Quaternion());
      P.b(`${s}Foot`).quaternion.copy(parentQ.invert().multiply(footQ));
      P.update();
    }
    return 1;
  });
}
const PLANT_FEET = new Set(["SitDown", "SitIdle", "StandUp"]);

export async function buildBody(body, { log = console.log } = {}) {
  const T = await loadTarget(`client/assets/parts/${body}/body.glb`);
  const out = [];
  let idle = null;
  for (const pair of RETARGETED) {
    const { name, path, wanted, start, end } = parseSpec(pair);
    const r = retargetClip(T, await sourceFor(path, wanted), name, { start, end });
    if (name === "Idle") idle = r.clip;
    out.push(THREE.AnimationClip.toJSON(PLANT_FEET.has(name) ? plantFeet(T, r.clip) : r.clip));
    log(`  ${name}: ${r.clip.duration.toFixed(2)}s, ${r.matched}/${r.total} bones from the ${r.kind} rig`);
  }
  for (const name of Object.keys(MADE)) {
    out.push(THREE.AnimationClip.toJSON(bake(T, name, MADE[name].duration, idle, MADE[name].pose)));
    log(`  ${name}: ${MADE[name].duration.toFixed(2)}s, made by hand`);
  }
  const dest = `client/assets/parts/${body}/anims.json`;
  const text = JSON.stringify(out);
  writeFileSync(dest, text);
  log(`Saved ${dest}: ${out.length} animations, ${(text.length / 1024).toFixed(0)} KB`);
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await download();
  const wanted = process.argv.slice(2);
  for (const { id } of BODIES) if (!wanted.length || wanted.includes(id)) { console.log(`${id}:`); await buildBody(id); }
}
