// Rides in the browser: the Ferris wheel (get on, ride round, the view over the whole festival from up
// top), the golf cart (🛺 to drive and park; everyone sees who's in a cart; parked carts wait at their
// owner's camp) and the shuttle between the sections. The server decides all of it (server/rides.js);
// this file only shows it and asks.
import { WHEEL, wheelOf, onWheel, rideGondola, gondolaPos, fromBottom, boardPoint, stopsOf, stopAt } from "../shared/rides.js";
import { parkedCartSpot, campSolids } from "../shared/camps.js";
import { setSolids } from "../shared/sim.js";
import { LAYOUT } from "../shared/venue.js";
import { CABIN_FLOOR } from "./world.js";

// Where up to four riders stand in a cabin (meters, in the wheel's own frame).
const SEATS = [[-0.4, 0.35], [0.4, 0.35], [-0.4, -0.35], [0.4, -0.35]];

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
  const cartBtn = $("cart-btn");
  cartBtn.onclick = () => room.send("cart", me()?.ride !== "cart");
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
  const look = { yaw: 0, pitch: -0.25 };
  const eye = new THREE.Vector3(), at = new THREE.Vector3();
  const wheelView = (dt, camera) => {
    const input = getInput();
    look.yaw -= (input.x ?? 0) * 1.3 * dt;
    look.pitch = Math.max(-1.1, Math.min(0.35, look.pitch - (input.z ?? 0) * 0.9 * dt));
    const obj = mp.avatarOf(myId);
    if (!obj) return;
    eye.set(obj.position.x, obj.position.y + 1.65, obj.position.z);
    at.set(eye.x + Math.sin(look.yaw) * Math.cos(look.pitch), eye.y + Math.sin(look.pitch), eye.z + Math.cos(look.yaw) * Math.cos(look.pitch));
    camera.position.lerp(eye, 1 - Math.exp(-10 * dt));
    camera.lookAt(at);
  };
  let riding = false;

  // ---------- Golf carts ----------
  // A cart is built around its driver (the avatar sits in it); a parked one waits at the camp.
  function cartMesh(color = "#f4f1ea") {
    const g = new THREE.Group();
    const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, ...o });
    const gold = mat("#ffd36b", { metalness: 0.6, roughness: 0.3, emissive: "#6b4e00", emissiveIntensity: 0.4 });
    const add = (geo, m, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); g.add(o); return o; };
    add(new THREE.BoxGeometry(1.3, 0.45, 2.3), mat(color), 0, 0.5, 0);
    add(new THREE.BoxGeometry(1.32, 0.08, 2.32), gold, 0, 0.74, 0);                       // gold trim: it's premium
    add(new THREE.BoxGeometry(1.2, 0.5, 0.15), mat("#2a1b3d"), 0, 0.98, -0.45);            // seat back
    add(new THREE.BoxGeometry(1.25, 0.06, 1.7), mat(color), 0, 2.05, -0.05);               // roof
    for (const [x, z] of [[-0.6, 0.75], [0.6, 0.75], [-0.6, -0.85], [0.6, -0.85]]) add(new THREE.CylinderGeometry(0.03, 0.03, 1.3, 6), mat("#ccc"), x, 1.4, z);
    add(new THREE.PlaneGeometry(1.15, 0.7), mat("#bfe3ff", { transparent: true, opacity: 0.35, side: THREE.DoubleSide }), 0, 1.45, 0.78).rotation.x = -0.2;
    for (const [x, z] of [[-0.62, 0.75], [0.62, 0.75], [-0.62, -0.75], [0.62, -0.75]]) {
      add(new THREE.CylinderGeometry(0.26, 0.26, 0.18, 14), mat("#1a1a1a"), x, 0.26, z).rotation.z = Math.PI / 2;
    }
    const flag = add(new THREE.PlaneGeometry(0.35, 0.22), gold, 0.5, 2.45, -0.8);
    flag.material = gold; flag.material.side = THREE.DoubleSide;
    add(new THREE.CylinderGeometry(0.012, 0.012, 0.5, 4), mat("#ccc"), 0.32, 2.3, -0.8);
    return g;
  }
  const driving = new Map();   // player id -> { obj, cart } (the avatar we put a cart under)
  const parked = new Map();    // camp id -> mesh
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
      cart.position.set(0, -0.35, 0.25);   // the avatar sits on the seat, the cart sits on the ground
      obj.add(cart);
      driving.set(id, { obj, cart });
    });
    for (const [id, d] of driving) {
      if (drivers.has(id)) continue;
      d.cart.parent?.remove(d.cart);
      d.obj.position.y = 0;
      driving.delete(id);
    }
    for (const { obj } of driving.values()) obj.position.y = 0.35;

    // Parked carts (and what's solid in camps, so walking predicts the same as the server).
    const names = new Set([...drivers].map((id) => players().get(id)?.name?.toLowerCase()));
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
        const g = gondolaPos(wheel, n, t), [ox, oz] = SEATS[k % SEATS.length];
        obj.position.set(g.x + ox * cos + oz * sin, g.y - CABIN_FLOOR, g.z - ox * sin + oz * cos);
        obj.rotation.y = r;
      }
    }
    for (const id of wasRiding) if (!riders.includes(id)) { const obj = mp.avatarOf(id); if (obj) obj.position.y = 0; }
    wasRiding.clear();
    for (const id of riders) wasRiding.add(id);

    // Your own ride.
    const onIt = onWheel(p.ride);
    if (onIt !== riding) {
      riding = onIt;
      if (riding && wheel) {
        look.yaw = Math.atan2(-wheel.x, -50 - wheel.z);   // start looking out over the middle of the festival
        look.pitch = -0.25;
        rig.setView(wheelView);
      } else rig.setView(null);
    }
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
    cartBtn.title = p.ride === "cart" ? "Park your golf cart (it goes back to your camp)" : "Drive your golf cart";

    // What you can do where you're standing: get on the wheel, or take the shuttle.
    promptAction = null;
    if (!riding && p.ride !== "cart") {
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
