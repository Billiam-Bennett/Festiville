// Realistic animated characters (Mixamo-style rigged GLB models).
//
// loadCharacterKit() loads the model and animations ONCE; kit.create(profile) then makes a
// lightweight copy per player that shares the mesh and textures, so a crowd stays affordable.
//
// Each character picks its animation from how fast it's moving:
//   standing still → Idle, slow → Walk, fast → Run, plus emotes (shared/emotes.js: Dance, Wave, Jump, Sit…).
//
// To use your own Mixamo character, see README → "Use your own Mixamo character".
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";
import { buildAccessory } from "./accessories.js";
import { normalizeAccessories } from "../shared/accessories.js";
import { emoteById } from "../shared/emotes.js";

// Mixamo bones are named "mixamorigHead" (sometimes with a number, "mixamorig2Head"); normalize so
// we can find them on any rig.
const boneKey = (n) => n.replace(/^mixamorig\d*/, "");
const SLOT_BONE = { head: "Head", face: "Head", back: "Spine2", hand: "RightHand" };

const TARGET_HEIGHT = 1.7;   // meters; every model is scaled to this so the camera and name tags line up
const FADE = 0.25;           // seconds to blend between animations
// Roughly how fast each animation moves its feet, so playback speed can match movement speed.
const ANIM_SPEED = { Walk: 1.6, Run: 4.2 };

// Match an animation clip's name to the kinds the game uses.
// Models name their animations differently ("idle", "Walking", "SambaDance"...), so match loosely.
const KINDS = [["Dance", /samba|danc/i], ["Idle", /idle/i], ["Run", /run/i], ["Walk", /walk/i]];
export function collectClips(THREE, gltfAnimations = [], extraJson = []) {
  const clips = {};
  for (const c of gltfAnimations) {
    const kind = KINDS.find(([, re]) => re.test(c.name))?.[0];
    if (kind && !clips[kind]) clips[kind] = c;
  }
  for (const json of extraJson ?? []) clips[json.name] = THREE.AnimationClip.parse(json);   // retarget.mjs names them Idle, Walk, …
  return clips;
}

export async function loadCharacterKit(THREE, { modelUrl, animsUrl }) {
  const [gltf, extra] = await Promise.all([
    new GLTFLoader().loadAsync(modelUrl),
    fetch(animsUrl).then((r) => (r.ok ? r.json() : [])).catch(() => []),
  ]);

  const clips = collectClips(THREE, gltf.animations, extra);
  if (!clips.Idle) throw new Error("Character kit needs at least an Idle animation");

  // Normalize size (Mixamo exports are sometimes in centimeters).
  const box = new THREE.Box3().setFromObject(gltf.scene);
  const scale = TARGET_HEIGHT / Math.max(box.max.y - box.min.y, 0.01);

  gltf.scene.traverse((n) => {
    if (n.isMesh) n.frustumCulled = false;   // skinned meshes can animate outside their bind-pose bounds
  });

  function create(profile = {}) {
    const model = SkeletonUtils.clone(gltf.scene);
    model.scale.setScalar(scale);
    model.position.y = -box.min.y * scale;
    return rigAvatar(THREE, model, clips, profile, TARGET_HEIGHT);
  }

  return { create, animations: Object.keys(clips) };
}

// Wrap a ready-to-animate model (already scaled and standing on y=0) into a player avatar: contact
// shadow, name tag, animation picking by speed, and cosmetic accessories. Used by classic characters
// (above) and parts-based ones (client/avatar.js). Works without clips too (the model just stands).
export function rigAvatar(THREE, model, clips, profile = {}, height = TARGET_HEIGHT) {
  const root = new THREE.Group();
  root.add(model);
  root.add(contactShadow(THREE));
  const tag = nameTag(THREE, profile.name);
  tag.position.y = height + 0.3;
  root.add(tag);
  root.userData.setTag = (name, sub) => tag.userData.draw(name, sub);

  const mixer = new THREE.AnimationMixer(model);
  const actions = Object.fromEntries(Object.entries(clips).map(([k, c]) => [k, mixer.clipAction(c)]));
  let current = actions.Idle ?? null;
  current?.play();
  let smoothSpeed = 0;

  // ---------- Cosmetic accessories (hats, glasses, glow sticks, wings) ----------
  // Attached to the root (not the bones) and moved to the right bone's spot each frame, so they
  // follow the walk/dance bob and the body's facing without fighting each rig's bind pose.
  const bones = {};
  model.traverse((n) => { if (n.isBone) bones[boneKey(n.name)] = n; });
  const worn = [];
  const tmp = new THREE.Vector3();
  for (const id of normalizeAccessories(profile.accessories)) {
    const a = buildAccessory(THREE, id);
    const bone = a && bones[SLOT_BONE[a.slot]];
    if (!a || !bone) continue;
    root.add(a.group);
    worn.push({ ...a, bone });
  }
  function placeAccessories(dt) {
    for (const w of worn) {
      w.bone.getWorldPosition(tmp);
      root.worldToLocal(tmp);
      w.group.position.set(tmp.x + w.offset[0], tmp.y + w.offset[1], tmp.z + w.offset[2]);
      if (w.spin) w.group.rotation.y += dt * 1.5;
    }
  }

  // ---------- Emotes (shared/emotes.js) ----------
  // The server says which emote a player is doing and bumps emoteSeq each time one starts. We play
  // its intro once (sitting down), then its clip; when it ends standing still, its outro (standing up).
  const baseY = model.position.y;
  const playing = { id: "", seq: -1, t: 0, outro: null };
  const lengthOf = (k) => actions[k]?.getClip().duration ?? 0;
  let currentKey = "";

  // Which clip to show right now (and a key that changes whenever it should restart).
  function pick(moving, emote, seq) {
    const def = emoteById(emote);
    if (emote !== playing.id || seq !== playing.seq) {
      const prev = emoteById(playing.id);
      const wasPlaying = prev && (prev.loop || playing.t < (prev.duration ?? 0));
      playing.outro = !def && wasPlaying && prev.outro && actions[prev.outro] ? prev.outro : null;
      Object.assign(playing, { id: emote, seq, t: 0 });
    }
    if (def && (!moving || def.moving)) {
      if (def.intro && actions[def.intro] && playing.t < lengthOf(def.intro)) return { k: def.intro, once: true, phase: "in" };
      const k = actions[def.clip] ? def.clip : actions[def.fallback] ? def.fallback : null;
      if (k) return { k, once: !def.loop && lengthOf(k) >= (def.duration ?? 0) - 0.1, phase: "main" };
    } else if (playing.outro && !moving && playing.t < lengthOf(playing.outro)) {
      return { k: playing.outro, once: true, phase: "out" };
    }
    return null;
  }

  // Called every frame by multiplayer.js with the character's measured speed (m/s) and its emote.
  root.userData.animate = (dt, speed, emote = "", emoteSeq = 0) => {
    smoothSpeed += (speed - smoothSpeed) * Math.min(1, dt * 10);
    playing.t += dt;
    const moving = smoothSpeed >= 0.35;
    const em = pick(moving, emote || "", emoteSeq ?? 0);
    let want = em?.k ?? (!moving ? "Idle" : smoothSpeed < 4 ? "Walk" : "Run");
    if (!actions[want]) want = actions.Walk ? "Walk" : "Idle";
    const next = actions[want];
    const key = em ? `${want}|${playing.id}|${playing.seq}|${em.phase}` : want;
    if (next && key !== currentKey) {
      next.setLoop(em?.once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
      next.clampWhenFinished = !!em?.once;
      if (next === current) next.reset();
      else {
        next.reset().play();
        current?.crossFadeTo(next, em?.phase === "out" || currentKey.includes("|out") ? 0.4 : FADE, false);
      }
      current = next;
      currentKey = key;
    }
    if (next) next.timeScale = ANIM_SPEED[want] ? Math.min(1.8, Math.max(0.7, smoothSpeed / ANIM_SPEED[want])) : 1;
    // Characters without a Jump animation (classic ones) still hop.
    const hop = emote === "jump" && !actions.Jump ? Math.max(0, Math.sin(Math.PI * Math.min(1, playing.t / 0.6))) * 0.35 : 0;
    model.position.y = baseY + hop;
    mixer.update(dt);
    model.updateMatrixWorld();
    placeAccessories(dt);
  };
  root.userData.dispose = () => mixer.stopAllAction();
  return root;
}

// Name tag with an optional second line (quest badges). Call tag.userData.draw(name, sub) to update it.
export function nameTag(THREE, text) {
  // Drawn large so it stays crisp on high-density phone screens.
  const c = document.createElement("canvas");
  c.width = 512; c.height = 176;
  const x = c.getContext("2d");
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  s.scale.set(1.2, 0.4125, 1);
  s.userData.draw = (name, sub = "") => {
    x.clearRect(0, 0, 512, 176);
    x.fillStyle = "rgba(23,14,34,0.8)";
    x.beginPath(); x.roundRect(12, 16, 488, 96, 48); x.fill();
    x.fillStyle = "#fff";
    x.font = "bold 58px system-ui, sans-serif";
    x.textAlign = "center"; x.textBaseline = "middle";
    x.fillText(name || "Raver", 256, 66, 460);
    if (sub) {
      x.font = "bold 34px system-ui, sans-serif";
      const w = Math.min(488, x.measureText(sub).width + 40);
      x.fillStyle = "rgba(23,14,34,0.8)";
      x.beginPath(); x.roundRect(256 - w / 2, 120, w, 48, 24); x.fill();
      x.fillStyle = "#ffd36b";
      x.fillText(sub, 256, 145, 460);
    }
    tex.needsUpdate = true;
  };
  s.userData.draw(text);
  s.center.set(0.5, 0.7);   // keep the name line where it was; badges hang below it
  return s;
}

function contactShadow(THREE) {
  const m = new THREE.Mesh(
    new THREE.CircleGeometry(0.35, 24),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.015;
  return m;
}
