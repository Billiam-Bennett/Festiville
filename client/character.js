// Realistic animated characters (Mixamo-style rigged GLB models).
//
// loadCharacterKit() loads the model and animations ONCE; kit.create(profile) then makes a
// lightweight copy per player that shares the mesh and textures, so a crowd stays affordable.
//
// Each character picks its animation from how fast it's moving:
//   standing still → Idle, slow → Walk, fast → Run, and "dance" emote → Dance.
//
// To use your own Mixamo character, see README → "Use your own Mixamo character".
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";
import { buildAccessory } from "./accessories.js";
import { normalizeAccessories } from "../shared/accessories.js";

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

  // Called every frame by multiplayer.js with the character's measured speed (m/s).
  root.userData.animate = (dt, speed, emote) => {
    smoothSpeed += (speed - smoothSpeed) * Math.min(1, dt * 10);
    let want = smoothSpeed < 0.35 ? (emote === "dance" && actions.Dance ? "Dance" : "Idle")
      : smoothSpeed < 4 ? "Walk" : "Run";
    if (!actions[want]) want = actions.Walk ? "Walk" : "Idle";
    const next = actions[want];
    if (next && next !== current) {
      next.reset().play();
      current?.crossFadeTo(next, FADE, false);
      current = next;
    }
    if (next) next.timeScale = ANIM_SPEED[want] ? Math.min(1.8, Math.max(0.7, smoothSpeed / ANIM_SPEED[want])) : 1;
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
