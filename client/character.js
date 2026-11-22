// Realistic animated characters (Mixamo-style rigged GLB models).
//
// loadCharacterKit() loads the model and animations ONCE; kit.create(profile) then makes a
// lightweight copy per player that shares the mesh and textures, so a crowd stays affordable.
//
// Each character blends Idle, Walk and Run by how fast it's moving, with the legs cycling exactly as
// fast as it really moves so the feet stay planted (client/motion.js), leans into turns, and plays
// emotes over the top (shared/emotes.js: Dance, Wave, Jump, Sit…).
//
// To use your own Mixamo character, see README → "Use your own Mixamo character".
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";
import { buildAccessory } from "./accessories.js";
import { normalizeAccessories } from "../shared/accessories.js";
import { emoteById } from "../shared/emotes.js";
import { measureGait, locomotion, clipTime, leanFor, wrapAngle, ease, DEFAULT_GAIT } from "./motion.js";

// Mixamo bones are named "mixamorigHead" (sometimes with a number, "mixamorig2Head"); normalize so
// we can find them on any rig.
const boneKey = (n) => n.replace(/^mixamorig\d*/, "");
const SLOT_BONE = { head: "Head", face: "Head", back: "Spine2", hand: "RightHand" };

const TARGET_HEIGHT = 1.7;   // meters; every model is scaled to this so the camera and name tags line up
const FADE = 0.25;           // seconds to blend into or out of an emote
const LOCO = ["Idle", "Walk", "Run"];

// How fast each Walk/Run clip moves its feet, measured once per clip (every avatar of a character
// shares its clips). Stored per meter of hip height, so taller and shorter builds of the same body
// (client/avatar.js) take longer and shorter steps.
const gaitCache = new WeakMap();
const DEFAULT_HIPS = 0.95;   // DEFAULT_GAIT was measured on a 1.7 m character, hips this high
function gaitOf(THREE, root, model, clip, bones, kind) {
  if (!clip) return null;
  let hipHeight = DEFAULT_HIPS;
  if (bones.Hips) {
    root.updateMatrixWorld(true);
    hipHeight = root.worldToLocal(bones.Hips.getWorldPosition(new THREE.Vector3())).y;
  }
  if (!(hipHeight > 0.2)) hipHeight = DEFAULT_HIPS;
  if (!gaitCache.has(clip)) {
    const feet = [bones.LeftToeBase ?? bones.LeftFoot, bones.RightToeBase ?? bones.RightFoot];
    let g = null;
    if (feet[0] && feet[1] && bones.Hips) {
      const mixer = new THREE.AnimationMixer(model);
      mixer.clipAction(clip).play();
      const v = new THREE.Vector3(), at = (b) => root.worldToLocal(b.getWorldPosition(v));
      const samples = [], N = 48;
      for (let i = 0; i <= N; i++) {
        const t = (i / N) * clip.duration;
        mixer.setTime(Math.min(t, clip.duration - 1e-4));
        root.updateMatrixWorld(true);
        samples.push({ t, hipZ: at(bones.Hips).z, feet: feet.map((b) => { const p = at(b); return { y: p.y, z: p.z }; }) });
      }
      mixer.stopAllAction();
      mixer.uncacheRoot(model);
      g = measureGait(samples, clip.duration);
    }
    gaitCache.set(clip, g ? { perHip: g.speed / hipHeight, phase: g.phase, guess: false }
      : { perHip: DEFAULT_GAIT[kind].speed / DEFAULT_HIPS, phase: DEFAULT_GAIT[kind].phase, guess: true });
  }
  const c = gaitCache.get(clip);
  return { speed: c.perHip * hipHeight, phase: c.phase, duration: clip.duration, guess: c.guess };
}

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
  // The body sits in its own group so it can lean into turns (about the feet) while the name tag and
  // the shadow stay level.
  const body = new THREE.Group();
  body.add(model);
  root.add(body);
  root.add(contactShadow(THREE));
  const tag = nameTag(THREE, profile.name);
  tag.position.y = height + 0.3;
  root.add(tag);
  root.userData.setTag = (name, sub) => tag.userData.draw(name, sub);

  const bones = {};
  model.traverse((n) => { if (n.isBone && !bones[boneKey(n.name)]) bones[boneKey(n.name)] = n; });

  // How this character's Walk and Run move their feet (before any animation touches the bones).
  const gait = { Walk: gaitOf(THREE, root, model, clips.Walk, bones, "Walk"), Run: gaitOf(THREE, root, model, clips.Run, bones, "Run") };

  const mixer = new THREE.AnimationMixer(model);
  const actions = Object.fromEntries(Object.entries(clips).map(([k, c]) => [k, mixer.clipAction(c)]));
  // Idle, Walk and Run always play together, weighted by speed. Walk and Run don't run on their own
  // clocks: each frame we put them at the shared step phase (so they plant the same foot together).
  for (const k of LOCO) {
    const a = actions[k];
    if (!a) continue;
    a.setLoop(THREE.LoopRepeat, Infinity);
    a.play();
    a.setEffectiveWeight(k === "Idle" ? 1 : 0);
    if (k !== "Idle") a.timeScale = 0;
  }
  let smoothSpeed = 0;
  let stepPhase = 0;

  // ---------- Cosmetic accessories (hats, glasses, glow sticks, wings) ----------
  // Attached to the root (not the bones) and moved to the right bone's spot each frame, so they
  // follow the walk/dance bob and the body's facing without fighting each rig's bind pose.
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

  // ---------- Sitting on a ride (golf cart, Ferris wheel) ----------
  // Rides set root.userData.seat = { hipY, hands } (or null to stand). The character plays Idle and we
  // bend it into a seated pose on top: thighs forward, shins down, hips lowered onto the seat, and with
  // hands: "wheel" the arms reach for a steering wheel. Bones are aimed in world space, so this works
  // on any Mixamo rig (classic characters and build-your-own) without needing a sitting animation.
  root.userData.seat = null;
  const shadow = root.children.find((c) => c.userData.contactShadow);
  const seatBones = ["Hips", "LeftUpLeg", "LeftLeg", "LeftFoot", "RightUpLeg", "RightLeg", "RightFoot",
    "LeftArm", "LeftForeArm", "LeftHand", "RightArm", "RightForeArm", "RightHand"];
  const canSit = ["Hips", "LeftUpLeg", "LeftLeg", "LeftFoot", "RightUpLeg", "RightLeg", "RightFoot"].every((k) => bones[k]);
  const S = { a: new THREE.Vector3(), b: new THREE.Vector3(), v: new THREE.Vector3(), d: new THREE.Vector3(),
    fwd: new THREE.Vector3(), left: new THREE.Vector3(), down: new THREE.Vector3(0, -1, 0), up: new THREE.Vector3(0, 1, 0),
    q: new THREE.Quaternion(), qw: new THREE.Quaternion(), qp: new THREE.Quaternion() };
  // Turn `bone` (in world space, the shortest way) so the line from it to `child` points along `dir`.
  function aim(bone, child, dir) {
    bone.getWorldPosition(S.a); child.getWorldPosition(S.b);
    S.v.subVectors(S.b, S.a);
    if (S.v.lengthSq() < 1e-8) return;
    S.q.setFromUnitVectors(S.v.normalize(), dir);
    bone.getWorldQuaternion(S.qw);
    bone.parent.getWorldQuaternion(S.qp);
    bone.quaternion.copy(S.qp.invert().multiply(S.q.multiply(S.qw)));
    bone.updateMatrixWorld(true);
  }
  const mix = (out, ...terms) => { out.set(0, 0, 0); for (let i = 0; i < terms.length; i += 2) out.addScaledVector(terms[i], terms[i + 1]); return out.normalize(); };
  function sitPose(seat) {
    S.fwd.set(0, 0, 1).applyQuaternion(root.getWorldQuaternion(S.qw)).setY(0).normalize();   // characters face +z
    S.left.crossVectors(S.up, S.fwd);
    for (const [side, s] of [["Left", 1], ["Right", -1]]) {
      aim(bones[`${side}UpLeg`], bones[`${side}Leg`], mix(S.d, S.fwd, 1, S.left, 0.1 * s, S.down, 0.12));   // thigh: forward
      aim(bones[`${side}Leg`], bones[`${side}Foot`], mix(S.d, S.down, 1, S.fwd, 0.18));                       // shin: down
      if (seat.hands === "wheel" && bones[`${side}Arm`] && bones[`${side}ForeArm`] && bones[`${side}Hand`]) {
        aim(bones[`${side}Arm`], bones[`${side}ForeArm`], mix(S.d, S.fwd, 0.55, S.down, 0.75, S.left, 0.08 * s));
        aim(bones[`${side}ForeArm`], bones[`${side}Hand`], mix(S.d, S.fwd, 1, S.down, 0.05, S.left, -0.28 * s));
      }
    }
    // Lower (or raise) the whole body so the hips rest on the seat.
    bones.Hips.getWorldPosition(S.a);
    root.getWorldPosition(S.b);
    model.position.y += S.b.y + seat.hipY - S.a.y;   // root is never scaled, so world meters = root meters
    model.updateMatrixWorld(true);
  }

  // ---------- Turning ----------
  // How fast the character is turning (whoever sets its facing: multiplayer.js, rides, quest NPCs), so
  // it can lean into the turn, or take a few steps when it turns on the spot.
  const fwd = new THREE.Vector3(), qYaw = new THREE.Quaternion();
  const yawNow = () => { fwd.set(0, 0, 1).applyQuaternion(root.getWorldQuaternion(qYaw)); return Math.atan2(fwd.x, fwd.z); };
  let lastYaw = null, turnRate = 0, lean = 0;

  // ---------- Mixing ----------
  // Each frame the weights of everything playing add up to 1 (otherwise the rest pose shows through):
  // Idle/Walk/Run share `locoWeight` by speed, and emote clips fade in and out over `fade` seconds.
  const fading = new Map();   // emote clip action -> its weight (it keeps fading out after it's done)
  let emoteAct = null, fade = FADE, locoWeight = 1;

  // Called every frame by multiplayer.js with the character's measured speed (m/s) and its emote.
  root.userData.animate = (dt, speed, emote = "", emoteSeq = 0) => {
    const seat = canSit ? root.userData.seat : null;
    if (seat) { speed = 0; emote = ""; }   // riding: no walk cycle, no emotes
    if (shadow) shadow.visible = !root.userData.seat;
    if (!(speed >= 0 && speed < 30)) speed = 0;   // not a number, or a jump across the map
    smoothSpeed = ease(smoothSpeed, speed, 10, dt);
    const yaw = yawNow();
    if (dt > 0 && lastYaw !== null) turnRate = ease(turnRate, wrapAngle(yaw - lastYaw) / dt, 8, dt);
    lastYaw = yaw;
    playing.t += dt;
    const moving = smoothSpeed >= 0.35;
    let em = pick(moving, emote || "", emoteSeq ?? 0);
    if (em && LOCO.includes(em.k)) em = null;

    // An emote starting, moving on (sitting down → sitting) or ending.
    const key = em ? `${em.k}|${playing.id}|${playing.seq}|${em.phase}` : "";
    if (key !== currentKey) {
      fade = em?.phase === "out" || currentKey.includes("|out") ? 0.4 : FADE;
      const next = em ? actions[em.k] : null;
      if (next) {
        next.setLoop(em.once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
        next.clampWhenFinished = !!em.once;
        next.reset().play();   // the same clip again (waving twice) restarts it where it is
        if (!fading.has(next)) fading.set(next, 0);
      }
      emoteAct = next;
      currentKey = key;
    }
    const step = dt / fade;
    for (const [a, w] of fading) {
      const nw = a === emoteAct ? Math.min(1, w + step) : Math.max(0, w - step);
      if (nw === 0 && a !== emoteAct) { a.stop(); fading.delete(a); } else fading.set(a, nw);
    }
    locoWeight = emoteAct ? Math.max(0, locoWeight - step) : Math.min(1, locoWeight + step);

    // Walking and running: both at the shared step phase, as fast as the feet really move.
    const loco = locomotion(smoothSpeed, gait, { turn: seat ? 0 : turnRate });
    stepPhase = (stepPhase + loco.rate * dt) % 1;
    for (const k of ["Walk", "Run"]) if (actions[k] && gait[k]) actions[k].time = clipTime(gait[k], stepPhase);
    let total = locoWeight;
    for (const [a, w] of fading) if (a.enabled) total += w;
    const n = total > 0 ? 1 / total : 0;
    const share = { Idle: loco.idle, Walk: loco.walk, Run: loco.run };
    for (const k of LOCO) actions[k]?.setEffectiveWeight(share[k] * locoWeight * n);
    for (const [a, w] of fading) a.setEffectiveWeight(w * n);

    // Characters without a Jump animation (classic ones) still hop.
    const hop = emote === "jump" && !actions.Jump ? Math.max(0, Math.sin(Math.PI * Math.min(1, playing.t / 0.6))) * 0.35 : 0;
    model.position.y = baseY + hop;
    // Lean into turns (not while seated or doing an emote).
    lean = seat ? 0 : ease(lean, leanFor(smoothSpeed, turnRate) * locoWeight, 8, dt);
    body.rotation.z = lean;
    mixer.update(dt);
    body.updateMatrixWorld();
    if (seat) sitPose(seat);
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
  m.userData.contactShadow = true;
  return m;
}
