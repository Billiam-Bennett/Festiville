// Fit animations onto your character and save them for the game.
//
// Usage:
//   node scripts/retarget.mjs client/assets/characters/sam.glb Idle=anims/idle.glb Walk=anims/walk.glb Run=anims/run.glb
//
// Writes client/assets/characters/sam.anims.json (next to the model). Use --out file.json to write elsewhere. The game needs at least Idle; Walk and Run are strongly
// recommended; Dance is optional (Dance=anims/dance.glb, or leave a "dance" animation inside
// character.glb). Download animations from Mixamo with "In Place" checked.
//
// Sources:
//   Name=file.glb            the file's longest animation
//   Name=file.glb#Clip       one animation by name
//   Name=file.glb#Clip@0.3-1.4  only that part of it (seconds)
//   Name=file.anims.json#Clip  another character's already-fitted animations (the .glb next to it
//                            supplies that character's rest pose), e.g. client/assets/characters/remy.anims.json#Walk
// Source rigs can be Mixamo (mixamorig* bones) or one of the non-Mixamo rigs in BONE_MAPS below
// (Quaternius "Universal Animation Library" and KayKit "Character Animations"); the rig is detected
// from its bone names. To support another rig, add a name map there.
//
// The parts bodies' animations (client/assets/parts/<body>/anims.json) are rebuilt by
// scripts/parts-anims.mjs, which calls this script with the full list of sources.
//
// How it works:
//   1. Rest poses are lined up first: each target bone is turned so it points the same way as the
//      matching source bone does in the source's rest pose (e.g. the MakeHuman bodies rest in an
//      A-pose and Mixamo rigs in a T-pose; without this, every arm would hang 45° too low).
//   2. Each frame, every source bone's rotation is converted to world space, re-applied to the
//      lined-up target rest pose, then converted back to local. So animations made for one rig look
//      right on another, even when their bones point differently.
//   3. The hips' movement (sitting down, jumping, the dance bob) is copied too, scaled by hip height.
//   4. Keyframes that a straight line between their neighbours already predicts are dropped, which
//      keeps the file small.
// Options: --out file.json, --no-align (skip step 1), --no-hips (rotation only, like older versions).
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { readFileSync, writeFileSync } from "node:fs";

const FPS = 30;
const ROT_TOLERANCE = 0.0015;   // quaternion component error allowed when dropping keys (~0.2°)
const POS_TOLERANCE = 0.002;    // hip position error allowed, as a fraction of hip height (~2 mm)

// Mixamo bones are "mixamorigHips", "mixamorig:Hips" or "mixamorig7Hips"; the loader strips the ":".
// Normalize by stripping the prefix so source and target line up.
const norm = (n) => n.replace(/^mixamorig\d*:?/, "");

// ---------- Non-Mixamo source rigs: their bone name (as three.js sanitizes it) -> Mixamo name ----------
const SIDES = [["l", "Left"], ["r", "Right"]];
const FINGERS = [["thumb", "Thumb"], ["index", "Index"], ["middle", "Middle"], ["ring", "Ring"], ["pinky", "Pinky"]];
const UAL = {   // Quaternius Universal Animation Library (UE-mannequin-style names)
  pelvis: "Hips", spine_01: "Spine", spine_02: "Spine1", spine_03: "Spine2", neck_01: "Neck", Head: "Head",
};
for (const [s, S] of SIDES) {
  Object.assign(UAL, {
    [`clavicle_${s}`]: `${S}Shoulder`, [`upperarm_${s}`]: `${S}Arm`, [`lowerarm_${s}`]: `${S}ForeArm`, [`hand_${s}`]: `${S}Hand`,
    [`thigh_${s}`]: `${S}UpLeg`, [`calf_${s}`]: `${S}Leg`, [`foot_${s}`]: `${S}Foot`, [`ball_${s}`]: `${S}ToeBase`,
  });
  for (const [f, F] of FINGERS) for (const i of [1, 2, 3]) UAL[`${f}_0${i}_${s}`] = `${S}Hand${F}${i}`;
}
const KAYKIT = { hips: "Hips", spine: "Spine", chest: "Spine2", head: "Head" };   // KayKit Rig_Medium / Rig_Large
for (const [s, S] of SIDES) {
  Object.assign(KAYKIT, {
    [`upperarm${s}`]: `${S}Arm`, [`lowerarm${s}`]: `${S}ForeArm`, [`wrist${s}`]: `${S}Hand`,
    [`hand${s}`]: `${S}HandMiddle1`,   // no fingers: the hand bone just gives the palm's direction
    [`upperleg${s}`]: `${S}UpLeg`, [`lowerleg${s}`]: `${S}Leg`, [`foot${s}`]: `${S}Foot`, [`toes${s}`]: `${S}ToeBase`,
  });
}
export const BONE_MAPS = { ual: UAL, kaykit: KAYKIT };

// Which bone each bone points at, for lining up rest poses (first one present on both rigs wins).
const AIM = { Spine: ["Spine1", "Spine2", "Neck"], Spine1: ["Spine2", "Neck"], Spine2: ["Neck", "Head"], Neck: ["Head"] };
for (const [, S] of SIDES) {
  Object.assign(AIM, {
    [`${S}Shoulder`]: [`${S}Arm`], [`${S}Arm`]: [`${S}ForeArm`], [`${S}ForeArm`]: [`${S}Hand`], [`${S}Hand`]: [`${S}HandMiddle1`],
    [`${S}UpLeg`]: [`${S}Leg`], [`${S}Leg`]: [`${S}Foot`], [`${S}Foot`]: [`${S}ToeBase`],
  });
  for (const [, F] of FINGERS) { AIM[`${S}Hand${F}1`] = [`${S}Hand${F}2`]; AIM[`${S}Hand${F}2`] = [`${S}Hand${F}3`]; }
}

// Rebuild the .glb without materials/textures: we only need bones and animation,
// and texture decoding doesn't work outside a browser.
function animationOnlyGlb(b) {
  if (b.toString("utf8", 0, 4) !== "glTF") throw new Error("not a .glb file");
  const jsonLen = b.readUInt32LE(12);
  const j = JSON.parse(b.subarray(20, 20 + jsonLen).toString());
  delete j.images; delete j.textures; delete j.samplers; delete j.materials;
  for (const m of j.meshes ?? []) for (const prim of m.primitives ?? []) delete prim.material;
  let json = Buffer.from(JSON.stringify(j));
  json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const rest = b.subarray(20 + jsonLen);   // the binary chunk, untouched
  const header = Buffer.alloc(20);
  header.write("glTF", 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(20 + json.length + rest.length, 8);
  header.writeUInt32LE(json.length, 12); header.write("JSON", 16);
  const out = Buffer.concat([header, json, rest]);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
}

const loaded = new Map();
function loadGlb(path) {
  if (!loaded.has(path)) {
    let buf;
    try { buf = animationOnlyGlb(readFileSync(path)); } catch (e) { throw new Error(`${path}: ${e.message}`); }
    loaded.set(path, new GLTFLoader().parseAsync(buf, ""));
  }
  return loaded.get(path);
}

// A rig: its bones by Mixamo name, with rest-pose world rotations/positions.
function rig(scene) {
  scene.updateMatrixWorld(true);
  const all = [];
  scene.traverse((n) => { if (n.isBone || /^mixamorig/.test(n.name)) all.push(n); });
  const names = new Set(all.map((n) => n.name));
  const kind = all.some((n) => /^mixamorig/.test(n.name)) ? "mixamo"
    : Object.entries(BONE_MAPS).sort(([, a], [, b]) => score(b) - score(a))[0][0];
  function score(map) { return Object.keys(map).filter((k) => names.has(k)).length; }
  const toMixamo = kind === "mixamo" ? (n) => (/^mixamorig/.test(n) ? norm(n) : null) : (n) => BONE_MAPS[kind][n] ?? null;
  const bones = {};
  for (const n of all) {
    const m = toMixamo(n.name);
    if (m && !bones[m]) bones[m] = { node: n, restWorldQ: n.getWorldQuaternion(new THREE.Quaternion()), restWorldP: n.getWorldPosition(new THREE.Vector3()) };
  }
  if (!bones.Hips) throw new Error(`no hips bone found (rig looks like "${kind}")`);
  // Hip height above the lowest foot, in world units, to scale hip movement between rigs.
  const feet = ["LeftFoot", "RightFoot", "LeftToeBase", "RightToeBase"].map((k) => bones[k]?.restWorldP.y).filter((y) => y !== undefined);
  const ground = feet.length ? Math.min(...feet) : 0;
  return { scene, kind, bones, hipHeight: Math.max(1e-6, bones.Hips.restWorldP.y - ground) };
}

// Turn quaternion `q` so direction `from` (world) ends up along `to`, and return the turn.
const aimTurn = (from, to) => new THREE.Quaternion().setFromUnitVectors(from.clone().normalize(), to.clone().normalize());

// Target rest rotations (world) lined up with the source's rest pose.
function alignedRest(S, T, align) {
  const out = {};
  for (const [name, t] of Object.entries(T.bones)) {
    let q = t.restWorldQ.clone();
    const s = S.bones[name];
    const aim = align && s && (AIM[name] ?? []).find((c) => S.bones[c] && T.bones[c]);
    if (aim) {
      const tDir = T.bones[aim].restWorldP.clone().sub(t.restWorldP);
      const sDir = S.bones[aim].restWorldP.clone().sub(s.restWorldP);
      if (tDir.lengthSq() > 1e-12 && sDir.lengthSq() > 1e-12) {
        let turn = aimTurn(tDir, sDir);
        // Hands: also match the palm's roll (the line across the knuckles), when both rigs have fingers.
        const side = name.match(/^(Left|Right)Hand$/)?.[1];
        const a = side && `${side}HandIndex1`, b = side && `${side}HandPinky1`;
        if (side && S.bones[a] && S.bones[b] && T.bones[a] && T.bones[b]) {
          const axis = sDir.clone().normalize();
          const flat = (v) => v.sub(axis.clone().multiplyScalar(v.dot(axis))).normalize();
          const tAcross = flat(T.bones[b].restWorldP.clone().sub(T.bones[a].restWorldP).applyQuaternion(turn));
          const sAcross = flat(S.bones[b].restWorldP.clone().sub(S.bones[a].restWorldP));
          if (Number.isFinite(tAcross.x) && Number.isFinite(sAcross.x)) turn = aimTurn(tAcross, sAcross).multiply(turn);
        }
        q = turn.multiply(q);
      }
    }
    out[name] = q;
  }
  return out;
}

async function sourceFor(path, wanted) {
  if (/\.anims\.json$/i.test(path)) {
    const gltf = await loadGlb(path.replace(/\.anims\.json$/i, ".glb"));   // fitted animations: rest pose from their model
    const clips = JSON.parse(readFileSync(path, "utf8")).map((c) => THREE.AnimationClip.parse(c));
    const c = wanted ? clips.find((a) => a.name.toLowerCase() === wanted.toLowerCase()) : clips[0];
    if (!c) throw new Error(`${path} has no animation called "${wanted}" (it has: ${clips.map((a) => a.name).join(", ")})`);
    return { scene: gltf.scene, clip: c };
  }
  const gltf = await loadGlb(path);
  if (!gltf.animations.length) throw new Error(`${path} has no animation in it`);
  if (wanted) {
    const c = gltf.animations.find((a) => a.name.toLowerCase() === wanted.toLowerCase());
    if (!c) throw new Error(`${path} has no animation called "${wanted}" (it has: ${gltf.animations.map((a) => a.name).join(", ")})`);
    return { scene: gltf.scene, clip: c };
  }
  return { scene: gltf.scene, clip: [...gltf.animations].sort((a, b) => b.duration - a.duration)[0] };   // the longest one
}

// Drop keys that linear interpolation between kept neighbours reproduces within `tol`.
export function reduceKeys(times, values, size, tol) {
  const n = times.length;
  if (n <= 2) return { times, values };
  const keep = [0];
  let a = 0;
  for (let b = 2; b < n; b++) {
    // Can keys a+1..b-1 be dropped if we jump straight from a to b?
    let ok = true;
    for (let i = a + 1; i < b && ok; i++) {
      const u = (times[i] - times[a]) / (times[b] - times[a]);
      for (let k = 0; k < size; k++) {
        const lerp = values[a * size + k] + (values[b * size + k] - values[a * size + k]) * u;
        if (Math.abs(lerp - values[i * size + k]) > tol) { ok = false; break; }
      }
    }
    if (!ok) { keep.push(b - 1); a = b - 1; }
  }
  keep.push(n - 1);
  // A track that never moves still keeps two keys, so the bone is driven for the whole clip.
  return {
    times: keep.map((i) => times[i]),
    values: keep.flatMap((i) => Array.from(values.slice(i * size, i * size + size))),
  };
}

// Retarget one clip from a source scene onto target rig T. Returns { clip, matched }.
// start/end (seconds) keep only part of the source clip.
export function retargetClip(T, src, name, { align = true, hips = true, start = 0, end = Infinity } = {}) {
  const S = rig(src.scene);
  const restAligned = alignedRest(S, T, align);
  const mixer = new THREE.AnimationMixer(src.scene);
  mixer.clipAction(src.clip).play();
  const from = Math.max(0, Math.min(start, src.clip.duration));
  const duration = Math.min(end, src.clip.duration) - from;
  if (!(duration > 0)) throw new Error(`${name}: empty time range ${start}-${end} (the clip is ${src.clip.duration.toFixed(2)}s)`);
  const frames = Math.max(2, Math.round(duration * FPS) + 1);

  // Target bones in parent-before-child order, with their parent's (static) world rotation if the
  // parent isn't a bone we animate.
  const order = [];
  T.scene.traverse((n) => { const m = /^mixamorig/.test(n.name) ? norm(n.name) : null; if (m && T.bones[m]?.node === n) order.push(m); });
  const parentBone = (m) => { let p = T.bones[m].node.parent; while (p && !(/^mixamorig/.test(p.name) && T.bones[norm(p.name)]?.node === p)) p = p.parent; return p ? norm(p.name) : null; };
  const parents = Object.fromEntries(order.map((m) => [m, parentBone(m)]));
  const staticParentQ = Object.fromEntries(order.map((m) => [m, T.bones[m].node.parent.getWorldQuaternion(new THREE.Quaternion())]));
  const restLocal = Object.fromEntries(order.map((m) => [m, T.bones[m].node.quaternion.clone()]));
  const hipsParentInv = T.bones.Hips.node.parent.matrixWorld.clone().invert();
  const hipScale = T.hipHeight / S.hipHeight;
  const matched = order.filter((m) => S.bones[m] && src.clip.tracks.some((t) => t.name.startsWith(S.bones[m].node.name + "."))).length;

  const times = [];
  const vals = Object.fromEntries(order.map((m) => [m, []]));
  const hipPos = [];
  const w = {};
  const sq = new THREE.Quaternion(), sp = new THREE.Vector3();
  for (let f = 0; f < frames; f++) {
    const time = Math.min(f / FPS, duration);
    times.push(+time.toFixed(3));
    mixer.setTime(from + time);
    src.scene.updateMatrixWorld(true);
    for (const m of order) {
      const parentW = parents[m] ? w[parents[m]] : staticParentQ[m];
      const s = S.bones[m];
      w[m] = s
        ? s.node.getWorldQuaternion(sq).clone().multiply(s.restWorldQ.clone().invert()).multiply(restAligned[m])
        : parentW.clone().multiply(restLocal[m]);
      const local = parentW.clone().invert().multiply(w[m]).normalize();
      const prev = vals[m].length ? vals[m].slice(-4) : null;
      // Keep neighbouring keys in the same hemisphere so interpolation (and key dropping) behaves.
      if (prev && prev[0] * local.x + prev[1] * local.y + prev[2] * local.z + prev[3] * local.w < 0) local.set(-local.x, -local.y, -local.z, -local.w);
      vals[m].push(local.x, local.y, local.z, local.w);
    }
    if (hips) {
      const delta = S.bones.Hips.node.getWorldPosition(sp).clone().sub(S.bones.Hips.restWorldP).multiplyScalar(hipScale);
      hipPos.push(...T.bones.Hips.restWorldP.clone().add(delta).applyMatrix4(hipsParentInv).toArray());
    }
  }
  mixer.stopAllAction();

  const round = (arr, d) => arr.map((v) => +v.toFixed(d));
  const tracks = order.map((m) => {
    const r = reduceKeys(times, vals[m], 4, ROT_TOLERANCE);
    return new THREE.QuaternionKeyframeTrack(`${T.bones[m].node.name}.quaternion`, r.times, round(r.values, 4));
  });
  if (hips) {
    const localScale = T.bones.Hips.node.parent.getWorldScale(new THREE.Vector3()).y || 1;
    const tol = (POS_TOLERANCE * T.hipHeight) / localScale;
    const r = reduceKeys(times, hipPos, 3, tol);
    const digits = Math.max(4, Math.ceil(-Math.log10(tol)) + 1);
    tracks.push(new THREE.VectorKeyframeTrack(`${T.bones.Hips.node.name}.position`, r.times, round(r.values, digits)));
  }
  return { clip: new THREE.AnimationClip(name, duration, tracks), matched, total: order.length, kind: S.kind };
}

export { sourceFor };
export async function loadTarget(path) {
  const gltf = await loadGlb(path);
  const T = rig(gltf.scene);
  if (T.kind !== "mixamo") throw new Error(`${path} doesn't look like a Mixamo-rigged character (no "mixamorig" bones)`);
  return T;
}

// Parse "Name=file.glb#Clip@start-end" into { name, path, wanted, start, end } (#Clip and @range optional).
export function parseSpec(pair) {
  const eq = pair.indexOf("=");
  const name = eq > 0 ? pair.slice(0, eq) : "";
  let spec = eq > 0 ? pair.slice(eq + 1) : "";
  let start = 0, end = Infinity;
  const range = spec.match(/@([\d.]*)-([\d.]*)$/);
  if (range) { spec = spec.slice(0, range.index); start = Number(range[1] || 0); end = range[2] ? Number(range[2]) : Infinity; }
  const [path, wanted] = spec.split("#");
  if (!name || !path) throw new Error(`Expected Name=file.glb, got "${pair}"`);
  return { name, path, wanted, start, end };
}

export async function retargetAll(charPath, pairs, { out, align = true, hips = true, log = console.log } = {}) {
  const T = await loadTarget(charPath);
  const clips = [];
  for (const pair of pairs) {
    const { name, path, wanted, start, end } = parseSpec(pair);
    const src = await sourceFor(path, wanted);
    const r = retargetClip(T, src, name, { align, hips, start, end });
    const json = THREE.AnimationClip.toJSON(r.clip);
    clips.push(json);
    log(`✓ ${name}: ${r.clip.duration.toFixed(2)}s from ${r.kind} rig, ${r.matched}/${r.total} bones matched, ${(JSON.stringify(json).length / 1024).toFixed(0)} KB`);
  }
  const dest = out ?? charPath.replace(/\.glb$/i, ".anims.json");
  writeFileSync(dest, JSON.stringify(clips));
  log(`Saved ${dest} (${(JSON.stringify(clips).length / 1024).toFixed(0)} KB)`);
  return clips;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const take = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args.splice(i, 1).length > 0 : false; };
  const outIdx = args.indexOf("--out");
  const out = outIdx >= 0 ? args.splice(outIdx, 2)[1] : undefined;
  const align = !take("--no-align");
  const hips = !take("--no-hips");
  const [charPath, ...pairs] = args;
  if (!charPath || !pairs.length) {
    console.error("Usage: node scripts/retarget.mjs character.glb Idle=idle.glb Walk=walk.glb Run=run.glb [--out file.json] [--no-align] [--no-hips]");
    process.exit(1);
  }
  await retargetAll(charPath, pairs, { out, align, hips });
}
