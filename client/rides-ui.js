// Rides in the browser: the Ferris wheel (get on, ride round, the view over the whole festival from up
// top), the golf cart (🛺 to drive and step out; everyone sees who's in a cart; a cart waits at its
// owner's camp, or for a while in golf cart parking 🅿️) and the shuttle between the sections. The server decides all of it (server/rides.js);
// this file only shows it and asks.
import { WHEEL, wheelOf, onWheel, rideGondola, gondolaPos, fromBottom, boardPoint, stopsOf, stopAt, parkingFor, nearestLot, decodeParked, cartSolids } from "../shared/rides.js";
import { parkedCartSpot, campSolids } from "../shared/camps.js";
import { setSolids } from "../shared/sim.js";
import { LAYOUT } from "../shared/venue.js";
import { CABIN_FLOOR } from "./world.js";
import { CART_POSE, cartPose, ease, wrapAngle } from "./motion.js";

// Where up to four riders sit in a cabin (meters, in the wheel's own frame): two on the back bench
// facing out over the festival, two on the front bench facing them. [x, z, turn]
const SEATS = [[-0.4, -0.55, 0], [0.4, -0.55, 0], [-0.4, 0.55, Math.PI], [0.4, 0.55, Math.PI]];
const CABIN_SEAT = { hipY: 0.5 };                 // hips just above the bench (world.js: CABIN_BENCH)
const CART_SEAT = { hipY: 1.0, hands: "wheel" };  // on the cart's seat cushion, hands on the wheel
const CART_OFFSET = 0.1;                          // the cart sits this far ahead of its driver's hips (sim.js WATER_REACH.cart)

export function setupRides({ THREE, scene, mp, rig, festival, getInput, toast, camps, hasCart }) {
  const room = mp.room, myId = room.sessionId;
  const $ = (id) => document.getElementById(id);
  const players = () => room.state.players;
  const me = () => players().get(myId);
  const wheel = wheelOf(LAYOUT.items);
  const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

  // A smooth copy of the room's clock (state.time moves in 0.1 s steps). The wheel turns on it.
  let t = room.state.time ?? 0;
  const time = () => t;

  // ---------- Buttons ----------
  const prompt = $("rprompt");
  let promptAction = null;
  prompt.onclick = () => promptAction?.();
  $("ride-off").onclick = () => room.send("ride", { action: "off" });
  // 🛺: get in (or call your cart over). While driving: step out. In golf cart parking the cart stays
  // there; anywhere else it goes back to your camp, so ask first.
  const cartBtn = $("cart-btn");
  const parkHere = () => { const p = me(); return p ? parkingFor(LAYOUT.items, p, takenBays()) : { error: "restricted" }; };
  cartBtn.onclick = () => {
    const p = me();
    if (!p) return;
    if (p.ride !== "cart") { room.send("cart", { on: true }); return; }
    const spot = parkHere();
    if (!spot.error) { room.send("cart", { on: false, stay: true }); return; }
    warnNoParking(spot);
  };
  function warnNoParking(spot) {
    const p = me(), near = nearestLot(LAYOUT.items, p);
    $("cw-title").textContent = spot.error === "full" ? `🅿️ ${spot.lot.label} is full` : "🅿️ No golf cart parking here";
    $("cw-text").textContent = `Golf carts can only be left in golf cart parking. If you step out here, your cart goes back to your camp.`;
    $("cw-near").textContent = near && !(spot.error === "full" && near.lot.id === spot.lot.id)
      ? `Nearest parking: ${near.lot.label}, ${near.dist} m ${near.dir}.` : "";
    $("cw-near").hidden = !$("cw-near").textContent;
    $("cart-warn").hidden = false;
    $("cw-keep").focus();
  }
  $("cw-home").onclick = () => { $("cart-warn").hidden = true; room.send("cart", { on: false }); };
  $("cw-keep").onclick = () => ($("cart-warn").hidden = true);
  addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("cart-warn").hidden) $("cart-warn").hidden = true; });
  // Bays other players' carts are parked in.
  function takenBays() {
    const out = new Set();
    players().forEach((q, id) => { const pk = id !== myId && decodeParked(q.parked); if (pk) out.add(`${pk.lot}:${pk.bay}`); });
    return out;
  }
  $("sh-close").onclick = () => ($("shuttle").hidden = true);

  function openShuttle(from) {
    const p = me();
    const list = $("sh-list");
    list.replaceChildren(...stopsOf(LAYOUT.items).filter((s) => s.id !== from.id).map((s) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn-ghost";
      b.textContent = `${s.label} · ${Math.round(dist(p, s))} m`;
      b.onclick = () => { room.send("shuttle", { to: s.id }); $("shuttle").hidden = true; };
      return b;
    }));
    $("sh-from").textContent = `You're at ${from.label}. Where to?`;
    $("shuttle").hidden = false;
  }

  // ---------- The view from the top ----------
  // While you ride, the camera sits in your cabin and you look around with WASD / the arrows / the
  // joystick (walking does nothing up there).
  const look = { yaw: 0, pitch: -0.08 };
  const eye = new THREE.Vector3(), at = new THREE.Vector3();
  const wheelView = (dt, camera) => {
    const input = getInput();
    look.yaw -= (input.x ?? 0) * 1.3 * dt;
    look.pitch = Math.max(-1.1, Math.min(0.35, look.pitch - (input.z ?? 0) * 0.9 * dt));
    const obj = mp.avatarOf(myId);
    if (!obj) return;
    eye.set(obj.position.x, obj.position.y + 1.25, obj.position.z);   // seated eye height
    at.set(eye.x + Math.sin(look.yaw) * Math.cos(look.pitch), eye.y + Math.sin(look.pitch), eye.z + Math.cos(look.yaw) * Math.cos(look.pitch));
    camera.position.lerp(eye, 1 - Math.exp(-10 * dt));
    camera.lookAt(at);
  };
  let riding = false;

  // ---------- Golf carts ----------
  // A cart is built around its driver (the avatar sits in it); a parked one waits at the camp.
  // The body (everything but the wheels) hangs on its own pivot at axle height so it can roll and pitch
  // over the wheels; each wheel can spin, and the front two steer (client/motion.js cartPose).
  const AXLE = CART_POSE.wheelRadius;
  function cartMesh(color = "#f4f1ea") {
    const g = new THREE.Group();
    const body = new THREE.Group();
    body.position.y = AXLE;
    g.add(body);
    const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, ...o });
    const gold = mat("#ffd36b", { metalness: 0.6, roughness: 0.3, emissive: "#6b4e00", emissiveIntensity: 0.4 });
    // Body parts are placed by their height above the ground, like the rest of the world.
    const add = (geo, m, x, y, z, to = body) => { const o = new THREE.Mesh(geo, m); o.position.set(x, to === body ? y - AXLE : y, z); to.add(o); return o; };
    add(new THREE.BoxGeometry(1.3, 0.45, 2.3), mat(color), 0, 0.5, 0);
    add(new THREE.BoxGeometry(1.32, 0.08, 2.32), gold, 0, 0.74, 0);                       // gold trim: it's premium
    add(new THREE.BoxGeometry(1.2, 0.5, 0.15), mat("#2a1b3d"), 0, 0.98, -0.45);            // seat back
    add(new THREE.BoxGeometry(1.15, 0.14, 0.5), mat("#2a1b3d"), 0, 0.85, -0.15);           // seat cushion
    add(new THREE.CylinderGeometry(0.035, 0.035, 0.7, 6), mat("#333"), 0, 1.0, 0.45).rotation.x = -0.6;   // steering column
    const wheel = add(new THREE.TorusGeometry(0.17, 0.025, 6, 18), mat("#222"), 0, 1.27, 0.3);
    wheel.rotation.x = -Math.PI / 2 + 0.6;
    add(new THREE.BoxGeometry(1.25, 0.06, 1.7), mat(color), 0, 2.05, -0.05);               // roof
    for (const [x, z] of [[-0.6, 0.75], [0.6, 0.75], [-0.6, -0.85], [0.6, -0.85]]) add(new THREE.CylinderGeometry(0.03, 0.03, 1.3, 6), mat("#ccc"), x, 1.4, z);
    add(new THREE.PlaneGeometry(1.15, 0.7), mat("#bfe3ff", { transparent: true, opacity: 0.35, side: THREE.DoubleSide }), 0, 1.45, 0.78).rotation.x = -0.2;
    const flag = add(new THREE.PlaneGeometry(0.35, 0.22), gold, 0.5, 2.45, -0.8);
    flag.material = gold; flag.material.side = THREE.DoubleSide;
    add(new THREE.CylinderGeometry(0.012, 0.012, 0.5, 4), mat("#ccc"), 0.32, 2.3, -0.8);
    // Wheels: pivot (steers about up) → spinner (rolls about the axle) → tyre, hub and two spokes,
    // so you can see them turn.
    const tyre = mat("#1a1a1a", { roughness: 0.9 }), hub = mat("#c9c9c9", { metalness: 0.5, roughness: 0.35 });
    const wheels = [];
    for (const [x, z] of [[-0.62, 0.75], [0.62, 0.75], [-0.62, -0.75], [0.62, -0.75]]) {
      const pivot = new THREE.Group();
      pivot.position.set(x, AXLE, z);
      const spin = new THREE.Group();
      pivot.add(spin);
      const out = Math.sign(x);   // which side faces out
      add(new THREE.CylinderGeometry(AXLE, AXLE, 0.18, 16), tyre, 0, 0, 0, spin).rotation.z = Math.PI / 2;
      add(new THREE.CylinderGeometry(0.14, 0.14, 0.03, 12), hub, out * 0.09, 0, 0, spin).rotation.z = Math.PI / 2;
      for (const turn of [0, Math.PI / 2]) add(new THREE.BoxGeometry(0.02, 0.36, 0.05), hub, out * 0.1, 0, 0, spin).rotation.x = turn;
      g.add(pivot);
      wheels.push({ pivot, spin, front: z > 0 });
    }
    g.userData.parts = { body, wheels };
    return g;
  }
  // Every frame: wheels roll as far as the cart went, the front ones steer into the turn, and the body
  // leans out of turns and rocks with speeding up and braking.
  function driveCart(d, dt) {
    const { obj, cart } = d, parts = cart.userData.parts;
    if (!parts || !(dt > 0)) return;
    const x = obj.position.x, z = obj.position.z, yaw = obj.rotation.y;
    if (!d.last) d.last = { x, z, yaw, v: 0, turn: 0, accel: 0 };
    const L = d.last;
    const moved = Math.hypot(x - L.x, z - L.z);
    const jumped = moved > 5;   // a snap from the server, not driving
    // Forward or backward along the cart's own nose.
    const sign = Math.sin(yaw) * (x - L.x) + Math.cos(yaw) * (z - L.z) < 0 ? -1 : 1;
    const v = jumped ? L.v : (sign * moved) / dt;
    const smoothV = ease(L.v, v, 10, dt);
    L.accel = ease(L.accel, (smoothV - L.v) / dt, 6, dt);
    L.turn = ease(L.turn, wrapAngle(yaw - L.yaw) / dt, 8, dt);
    L.v = smoothV;
    Object.assign(L, { x, z, yaw });
    const pose = cartPose(Math.abs(L.v), L.turn, L.accel);
    for (const w of parts.wheels) {
      if (!jumped) w.spin.rotation.x = (w.spin.rotation.x + (sign * moved) / AXLE) % (Math.PI * 2);
      if (w.front) w.pivot.rotation.y = ease(w.pivot.rotation.y, pose.steer, 12, dt);
    }
    parts.body.rotation.z = ease(parts.body.rotation.z, pose.roll, 6, dt);
    parts.body.rotation.x = ease(parts.body.rotation.x, pose.pitch, 6, dt);
  }
  const animateCarts = (dt) => { for (const d of driving.values()) driveCart(d, dt); };
  const driving = new Map();   // player id -> { obj, cart } (the avatar we put a cart under)
  const parked = new Map();    // camp id -> mesh
  const inLots = new Map();    // player id -> { key, mesh }: carts left in golf cart parking
  let campsKey = "";

  function syncCarts() {
    const drivers = new Set();
    players().forEach((p, id) => {
      const obj = mp.avatarOf(id);
      if (p.ride !== "cart" || !obj) return;
      drivers.add(id);
      const cur = driving.get(id);
      if (cur?.obj === obj) return;
      cur?.cart.parent?.remove(cur.cart);
      const cart = cartMesh();
      cart.position.set(0, 0, CART_OFFSET);   // the cart sits on the ground; the driver sits in it
      obj.add(cart);
      obj.userData.seat = CART_SEAT;
      driving.set(id, { obj, cart });
    });
    for (const [id, d] of driving) {
      if (drivers.has(id)) continue;
      d.cart.parent?.remove(d.cart);
      d.obj.userData.seat = null;
      driving.delete(id);
    }

    // Carts left in golf cart parking: drawn where they stand, solid like the server has them.
    const left = new Map();
    players().forEach((p, id) => { const pk = decodeParked(p.parked); if (pk) left.set(id, { key: p.parked, pk }); });
    for (const [id, cur] of inLots) {
      if (left.get(id)?.key === cur.key) continue;
      scene.remove(cur.mesh);
      inLots.delete(id);
    }
    for (const [id, { key, pk }] of left) {
      if (inLots.has(id)) continue;
      const mesh = cartMesh();
      mesh.position.set(pk.x, 0, pk.z);
      mesh.rotation.y = pk.rotY;
      scene.add(mesh);
      inLots.set(id, { key, mesh });
    }
    setSolids("parked carts", [...left.values()].flatMap(({ pk }) => cartSolids(pk)));

    // Parked carts at camps (and what's solid in camps, so walking predicts the same as the server).
    // A cart that's out (being driven, or left in parking) isn't at its camp.
    const names = new Set([...drivers, ...left.keys()].map((id) => players().get(id)?.name?.toLowerCase()));
    const list = camps.all();
    const key = JSON.stringify(list.map((c) => [c.id, c.x, c.z, c.plot, c.items, !!c.cart && !names.has(c.id)]));
    if (key === campsKey) return;
    campsKey = key;
    setSolids("camps", list.flatMap((c) => campSolids(c, { cart: !!c.cart && !names.has(c.id) })));
    for (const [id, mesh] of parked) { scene.remove(mesh); parked.delete(id); }
    for (const c of list) {
      if (!c.cart || names.has(c.id)) continue;
      const spot = parkedCartSpot(c);
      if (!spot) continue;
      const mesh = cartMesh();
      mesh.position.set(spot.x, 0, spot.z);
      mesh.rotation.y = Math.PI;   // nose toward the camp
      scene.add(mesh);
      parked.set(c.id, mesh);
    }
  }

  // ---------- Every frame ----------
  let since = 1;
  const wasRiding = new Set();
  function update(dt) {
    const st = room.state.time ?? 0;
    t = Math.abs(st - t) > 1 ? st : t + dt + (st - t) * Math.min(1, dt * 2);
    festival.update?.(t);
    animateCarts(dt);
    const p = me();
    if (!p) return;

    // Riders stand in their cabins, for everyone. Seats are handed out in a fixed order so every
    // browser puts the same rider in the same corner.
    const riders = [];
    players().forEach((q, id) => { if (onWheel(q.ride)) riders.push(id); });
    riders.sort();
    const seat = new Map();
    if (wheel) {
      const r = (wheel.rot || 0) * Math.PI / 180, cos = Math.cos(r), sin = Math.sin(r);
      for (const id of riders) {
        const obj = mp.avatarOf(id);
        if (!obj) continue;
        const n = rideGondola(players().get(id).ride), k = seat.get(n) ?? 0;
        seat.set(n, k + 1);
        const g = gondolaPos(wheel, n, t), [ox, oz, turn] = SEATS[k % SEATS.length];
        obj.position.set(g.x + ox * cos + oz * sin, g.y - CABIN_FLOOR, g.z - ox * sin + oz * cos);
        obj.rotation.y = r + turn;
        obj.userData.seat = CABIN_SEAT;
      }
    }
    for (const id of wasRiding) if (!riders.includes(id)) {
      const obj = mp.avatarOf(id);
      if (obj) { obj.position.y = 0; obj.userData.seat = null; }
    }
    wasRiding.clear();
    for (const id of riders) wasRiding.add(id);

    // Your own ride.
    const onIt = onWheel(p.ride);
    if (onIt !== riding) {
      riding = onIt;
      if (riding && wheel) {
        look.yaw = Math.atan2(-wheel.x, -50 - wheel.z);   // start looking out over the middle of the festival
        look.pitch = -0.08;   // just below the horizon: the festival, not the cabin wall
        rig.setView(wheelView);
      } else rig.setView(null);
    }
    // In the cabin the camera is at your own eye height, so hide your own character (everyone else
    // still sees you sitting there).
    const mine = mp.avatarOf(myId);
    if (mine) mine.visible = !riding;
    $("ride-card").hidden = !riding;
    if (riding) {
      const low = fromBottom(rideGondola(p.ride), t) <= WHEEL.offArc;
      $("ride-off").disabled = !low;
      $("ride-off").textContent = low ? "Get off" : "You can get off at the bottom";
    }

    // The cart button: only for players who have a cart; pressed while driving.
    const owns = hasCart();
    cartBtn.hidden = !owns || riding;
    cartBtn.setAttribute("aria-pressed", String(p.ride === "cart"));
    const driving = p.ride === "cart";
    const spot = driving ? parkHere() : null;
    const label = !driving ? "Drive your golf cart"
      : !spot.error ? `Step out and park here (${spot.lot.label})` : "Step out (your cart goes back to your camp)";
    cartBtn.title = label;
    cartBtn.setAttribute("aria-label", label);
    if (!driving) $("cart-warn").hidden = true;

    // What you can do where you're standing: get on the wheel, or take the shuttle.
    promptAction = null;
    if (driving && !spot.error) {
      prompt.textContent = `🅿️ Park here · ${spot.lot.label}`;
      promptAction = () => room.send("cart", { on: false, stay: true });
    } else if (!riding && !driving) {
      if (wheel && dist(p, wheel) <= WHEEL.boardRange) {
        prompt.textContent = `🎡 Ride the ${wheel.label || "Ferris wheel"} (free)`;
        promptAction = () => room.send("ride", { action: "board" });
      } else {
        const stop = stopAt(LAYOUT.items, p);
        if (stop) {
          prompt.textContent = `🚌 Shuttle from ${stop.label}`;
          promptAction = () => openShuttle(stop);
        }
      }
    }
    prompt.hidden = !promptAction || !$("prompt").hidden || !$("vprompt").hidden;
    if (!promptAction) $("shuttle").hidden = true;

    since += dt;
    if (since > 0.25) { since = 0; syncCarts(); }
  }

  return { update, time, boardPoint: () => (wheel ? boardPoint(wheel) : null) };
}
