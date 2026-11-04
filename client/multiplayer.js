// Drop-in multiplayer hookup for the FestiVille Three.js client.
//
// Usage (inside your existing game component):
//
//   import * as THREE from "three";
//   import { connectMultiplayer } from "./multiplayer.js";
//
//   const mp = await connectMultiplayer({
//     url: "ws://localhost:2567",
//     THREE, scene,
//     localObject: playerMesh,                 // your existing player object
//     getInput: () => ({ x: moveX, z: moveZ, run: shiftHeld }),  // -1..1 from your controls
//     profile: { name },
//     createRemoteAvatar: (p) => kit.create(p),   // optional: see character.js
//   });
//
//   // in your animation loop:
//   mp.update(deltaSeconds);
//
//   // on unmount:
//   mp.leave();
//
// IMPORTANT: once connected, stop moving playerMesh yourself —
// this module moves it (predicting locally, corrected by the server).

import { Client } from "colyseus.js";
import { TICK_RATE, sanitizeInput, applyInput } from "../shared/sim.js";

const SNAP_DISTANCE = 3;      // if we're this far off from the server, teleport instead of smoothing
const CORRECTION = 0.15;      // how quickly the local player eases toward the server's position
const REMOTE_SMOOTHING = 12;  // higher = remote players follow their server position more tightly
const TURN_SPEED = 12;        // how quickly characters turn to face where they're going

// Turn smoothly toward an angle, taking the short way around.
function turnToward(obj, target, dt) {
  let d = target - obj.rotation.y;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  obj.rotation.y += d * Math.min(1, TURN_SPEED * dt);
}

export async function connectMultiplayer({ url, THREE, scene, localObject, getInput, profile = {}, createRemoteAvatar, onLocalRebuilt }) {
  const client = new Client(url);
  const room = await client.joinOrCreate("festival", profile);
  const makeAvatar = createRemoteAvatar ?? ((p) => defaultAvatar(THREE, p));
  // What a player looks like right now; when this changes we rebuild their avatar (the "Looks" button).
  const sigOf = (p) => `${p.look}|${p.accessories}`;

  // localObject can be a function that builds your avatar once the server has answered (e.g. with your look).
  if (typeof localObject === "function") {
    if (!room.state?.players?.get(room.sessionId)) await new Promise((r) => room.onStateChange.once(r));
    localObject = localObject(room);
  }
  const local = { x: localObject.position.x, z: localObject.position.z, rotY: 0 };
  const lastLocal = { x: local.x, z: local.z };
  let localSig = sigOf(room.state.players.get(room.sessionId) ?? profile);
  let placedFromServer = false;
  const remotes = new Map();    // sessionId -> { object, target:{x,z,rotY} }
  let seq = 0;
  let sendTimer = 0;
  const sendEvery = 1 / TICK_RATE;

  function update(dt) {
    const players = room.state?.players;
    if (!players) return;

    // 1. Send input at the server's tick rate and predict our own movement immediately.
    sendTimer += dt;
    while (sendTimer >= sendEvery) {
      sendTimer -= sendEvery;
      const input = sanitizeInput({ ...getInput(), seq: ++seq });
      room.send("input", input);
      applyInput(local, input, sendEvery);
    }

    // 2. Reconcile with the server's authoritative position.
    const me = players.get(room.sessionId);
    // Rebuild our own avatar if the server changed our look/accessories (from the Looks button).
    if (me && sigOf(me) !== localSig) {
      localSig = sigOf(me);
      const next = makeAvatar(me);
      next.position.copy(localObject.position);
      next.rotation.y = localObject.rotation.y;
      scene.remove(localObject); localObject.userData.dispose?.();
      scene.add(next);
      localObject = next;
      onLocalRebuilt?.(next);
    }
    if (me) {
      const dx = me.x - local.x, dz = me.z - local.z;
      if (!placedFromServer || Math.hypot(dx, dz) > SNAP_DISTANCE) {
        local.x = me.x; local.z = me.z; placedFromServer = true;
      } else {
        local.x += dx * CORRECTION; local.z += dz * CORRECTION;
      }
    }
    localObject.position.x = local.x;
    localObject.position.z = local.z;
    turnToward(localObject, local.rotY, dt);
    const mySpeed = dt > 0 ? Math.hypot(local.x - lastLocal.x, local.z - lastLocal.z) / dt : 0;
    lastLocal.x = local.x; lastLocal.z = local.z;
    localObject.userData.animate?.(dt, mySpeed, me?.emote);

    // 3. Add/update remote players.
    const seen = new Set();
    players.forEach((p, id) => {
      if (id === room.sessionId) return;
      seen.add(id);
      let r = remotes.get(id);
      if (!r) {
        const object = makeAvatar(p);
        object.position.set(p.x, object.position.y, p.z);
        scene.add(object);
        r = { object, target: {}, sig: sigOf(p) };
        remotes.set(id, r);
      } else if (sigOf(p) !== r.sig) {
        // This player changed their look/accessories — rebuild them in place.
        r.sig = sigOf(p);
        const next = makeAvatar(p);
        next.position.copy(r.object.position);
        next.rotation.y = r.object.rotation.y;
        scene.remove(r.object); r.object.userData.dispose?.();
        scene.add(next);
        r.object = next;
      }
      r.target.x = p.x; r.target.z = p.z; r.target.rotY = p.rotY;
      const k = 1 - Math.exp(-REMOTE_SMOOTHING * dt);   // frame-rate-independent smoothing
      const ox = r.object.position.x, oz = r.object.position.z;
      r.object.position.x += (r.target.x - ox) * k;
      r.object.position.z += (r.target.z - oz) * k;
      turnToward(r.object, r.target.rotY, dt);
      const speed = dt > 0 ? Math.hypot(r.object.position.x - ox, r.object.position.z - oz) / dt : 0;
      r.object.userData.animate?.(dt, speed, p.emote);
    });

    // 4. Remove players who left.
    for (const [id, r] of remotes) {
      if (!seen.has(id)) { r.object.userData.dispose?.(); scene.remove(r.object); remotes.delete(id); }
    }
  }

  function leave() {
    for (const r of remotes.values()) scene.remove(r.object);
    remotes.clear();
    room.leave();
  }

  // Emotes: "dance" to start, "" to stop. Moving also stops it (the server clears it).
  const emote = (name) => room.send("emote", name);

  // The 3D object for any player (yourself included), for tapping, crew rings, etc.
  const avatarOf = (id) => (id === room.sessionId ? localObject : remotes.get(id)?.object);

  return { room, update, leave, emote, avatarOf, onlineCount: () => room.state?.players?.size ?? 0 };
}

// Placeholder avatar: a capsule in the player's shirt color with a floating name tag.
// Swap in your avatar builder via the createRemoteAvatar option.
export function defaultAvatar(THREE, p) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.35, 0.8, 4, 8),
    new THREE.MeshStandardMaterial({ color: p.shirtColor || "#ff4fa3" }),
  );
  body.position.y = 0.75;
  group.add(body);
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.3, 16, 12),
    new THREE.MeshStandardMaterial({ color: p.skinTone || "#c68642" }),
  );
  head.position.y = 1.6;
  group.add(head);
  // Small "nose" so you can tell which way someone is facing (+Z is forward).
  const nose = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 0.1, 0.15),
    new THREE.MeshStandardMaterial({ color: p.skinTone || "#c68642" }),
  );
  nose.position.set(0, 1.6, 0.32);
  group.add(nose);

  const canvas = document.createElement("canvas");
  canvas.width = 256; canvas.height = 64;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = "#fff";
  ctx.font = "bold 32px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(p.name, 128, 32);
  const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthTest: false }));
  tag.scale.set(2, 0.5, 1);
  tag.position.y = 2.2;
  group.add(tag);
  return group;
}
