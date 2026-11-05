// Fit Mixamo animations onto your character and save them for the game.
//
// Usage:
//   node scripts/retarget.mjs client/assets/characters/sam.glb Idle=anims/idle.glb Walk=anims/walk.glb Run=anims/run.glb
//
// Writes client/assets/characters/sam.anims.json (next to the model). Use --out file.json to write elsewhere. The game needs at least Idle; Walk and Run are strongly
// recommended; Dance is optional (Dance=anims/dance.glb, or leave a "dance" animation inside
// character.glb). Download animations from Mixamo with "In Place" checked.
//
// A source can also be another character's already-fitted animations: Walk=client/assets/characters/remy.anims.json#Walk
// (the .glb next to it supplies that character's rest pose). That's how the parts bodies get theirs:
//   node scripts/retarget.mjs client/assets/parts/female/body.glb Idle=client/assets/characters/remy.anims.json#Idle … --out client/assets/parts/female/anims.json
//
// How it works: each animation's bone rotations are converted to world space, re-applied to your
// character's own rest pose, then converted back. So animations made for one Mixamo rig look right
// on another, even when their bones point slightly differently.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const outIdx = args.indexOf("--out");
const outPath = outIdx >= 0 ? args.splice(outIdx, 2)[1] : null;
const [charPath, ...pairs] = args;
if (!charPath || !pairs.length) {
  console.error("Usage: node scripts/retarget.mjs character.glb Idle=idle.glb Walk=walk.glb Run=run.glb");
  process.exit(1);
}
const FPS = 30;
const san = (n) => THREE.PropertyBinding.sanitizeNodeName(n);
// Different Mixamo characters prefix bones as "mixamorigHips" or "mixamorig1Hips", "mixamorig7Hips" etc.
// Normalize by stripping the digits after "mixamorig" so source and target line up.
const norm = (n) => n.replace(/^mixamorig\d+/, "mixamorig");

// Read the node tree straight from the .glb JSON (no textures needed).
function graph(path) {
  const b = readFileSync(path);
  if (b.toString("utf8", 0, 4) !== "glTF") throw new Error(`${path} is not a .glb file`);
  const j = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString());
  // A node's rest rotation is stored either as "rotation" or inside a full transform "matrix".
  const restOf = (n) => {
    if (n.matrix) { const q = new THREE.Quaternion(); new THREE.Matrix4().fromArray(n.matrix).decompose(new THREE.Vector3(), q, new THREE.Vector3()); return q; }
    return new THREE.Quaternion(...(n.rotation || [0, 0, 0, 1]));
  };
  const nodes = j.nodes.map((n, i) => ({ name: san(n.name || "node" + i), rest: restOf(n), parent: null, children: n.children || [] }));
  nodes.forEach((n) => n.children.forEach((c) => (nodes[c].parent = n)));
  const order = [];
  const visit = (n) => { order.push(n); n.children.forEach((c) => visit(nodes[c])); };
  nodes.filter((n) => !n.parent).forEach(visit);
  const worldRest = new Map();
  for (const n of order) worldRest.set(n, (n.parent ? worldRest.get(n.parent).clone() : new THREE.Quaternion()).multiply(n.rest));
  return { order, worldRest, byName: Object.fromEntries(nodes.map((n) => [norm(n.name), n])) };
}

// Rebuild the .glb without materials/textures: we only need bones and animation,
// and texture decoding doesn't work outside a browser.
function animationOnlyGlb(b) {
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

async function pickClip(path, wanted) {
  if (/\.anims\.json$/i.test(path)) {
    const clips = JSON.parse(readFileSync(path, "utf8")).map((c) => THREE.AnimationClip.parse(c));
    const c = wanted ? clips.find((a) => a.name.toLowerCase() === wanted.toLowerCase()) : clips[0];
    if (!c) throw new Error(`${path} has no animation called "${wanted}" (it has: ${clips.map((a) => a.name).join(", ")})`);
    return c;
  }
  const b = readFileSync(path);
  const gltf = await new Promise((res, rej) => new GLTFLoader().parse(animationOnlyGlb(b), "", res, rej));
  if (!gltf.animations.length) throw new Error(`${path} has no animation in it`);
  if (wanted) {
    const c = gltf.animations.find((a) => a.name.toLowerCase() === wanted.toLowerCase());
    if (!c) throw new Error(`${path} has no animation called "${wanted}" (it has: ${gltf.animations.map((a) => a.name).join(", ")})`);
    return c;
  }
  return gltf.animations.sort((a, b) => b.duration - a.duration)[0];   // the longest one
}

const T = graph(charPath);
const targetBones = T.order.filter((n) => n.name.startsWith("mixamorig"));
if (!targetBones.length) throw new Error(`${charPath} doesn't look like a Mixamo-rigged character (no "mixamorig" bones)`);
const out = [];

for (const pair of pairs) {
  // Name=file.glb uses the file's (longest) animation; Name=file.glb#walk picks one by name.
  const [name, spec] = pair.split("=");
  const [path, wanted] = (spec ?? "").split("#");
  if (!name || !path) throw new Error(`Expected Name=file.glb, got "${pair}"`);
  const S = graph(path.replace(/\.anims\.json$/i, ".glb"));   // fitted animations: rest pose from their model
  const clip = await pickClip(path, wanted);
  const interp = {};
  for (const t of clip.tracks) {
    const [bone, prop] = t.name.split(".");
    if (prop === "quaternion") interp[norm(bone)] = t.createInterpolant();
  }
  const matched = targetBones.filter((n) => interp[norm(n.name)]).length;
  const frames = Math.round(clip.duration * FPS) + 1;
  const times = [];
  const vals = Object.fromEntries(targetBones.map((n) => [n.name, []]));

  for (let f = 0; f < frames; f++) {
    const time = Math.min(f / FPS, clip.duration);
    times.push(+time.toFixed(3));
    const sw = new Map();
    for (const n of S.order) {
      const local = interp[norm(n.name)] ? new THREE.Quaternion().fromArray(interp[norm(n.name)].evaluate(time)) : n.rest;
      sw.set(n, (n.parent ? sw.get(n.parent).clone() : new THREE.Quaternion()).multiply(local));
    }
    const tw = new Map();
    for (const n of T.order) {
      const parentW = n.parent ? tw.get(n.parent) : new THREE.Quaternion();
      const s = S.byName[norm(n.name)];
      const w = s && interp[norm(n.name)]
        ? sw.get(s).clone().multiply(S.worldRest.get(s).clone().invert()).multiply(T.worldRest.get(n))
        : parentW.clone().multiply(n.rest);
      tw.set(n, w);
      if (vals[n.name]) vals[n.name].push(...parentW.clone().invert().multiply(w).toArray().map((v) => +v.toFixed(4)));
    }
  }
  const tracks = targetBones.map((n) => new THREE.QuaternionKeyframeTrack(`${n.name}.quaternion`, times, vals[n.name]));
  out.push(THREE.AnimationClip.toJSON(new THREE.AnimationClip(name, clip.duration, tracks)));
  console.log(`✓ ${name}: ${clip.duration.toFixed(2)}s, ${matched}/${targetBones.length} bones matched`);
}

const dest = outPath ?? charPath.replace(/\.glb$/i, ".anims.json");
writeFileSync(dest, JSON.stringify(out));
console.log(`Saved ${dest}`);
