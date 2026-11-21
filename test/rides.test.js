import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RideSystem } from "../server/rides.js";
import { WHEEL, gondolaAngle, gondolaPos, fromBottom, freeGondola, nextBottom, boardPoint, wheelOf, rideGondola, onWheel, SHUTTLE, stopsOf, stopAt } from "../shared/rides.js";
import { defaultLayout, sanitizeLayout } from "../shared/layout.js";
import { setLayoutSolids, blockedAt, RUN_SPEED, CART_SPEED } from "../shared/sim.js";
import { AccountStore } from "../server/accounts.js";
import { hasGolfCart, isPremiumMember } from "../server/entitlements.js";
import { buy } from "../server/shop.js";
import { GOLF_CART, PREMIUM_MEMBERSHIP, STARTING_CREDITS } from "../shared/economy.js";

const ITEMS = defaultLayout().items;
const wheel = wheelOf(ITEMS);

test("the Ferris wheel is on the map, tall enough to see the whole festival, and turns slowly", () => {
  assert.ok(wheel, "the default layout has a Ferris wheel");
  assert.ok(WHEEL.hub + WHEEL.radius >= 30, "the top is high above the stages");
  assert.ok(WHEEL.hub - WHEEL.radius > 0, "gondolas clear the ground");
  assert.ok(WHEEL.period >= 90, "one turn takes a while");
  // Bottom at angle 0, top half a turn later, back to the bottom after one period.
  assert.equal(gondolaPos(wheel, 0, 0).y, WHEEL.hub - WHEEL.radius);
  assert.ok(Math.abs(gondolaPos(wheel, 0, WHEEL.period / 2).y - (WHEEL.hub + WHEEL.radius)) < 1e-9);
  assert.ok(fromBottom(0, WHEEL.period) < 1e-9);
  // Gondolas are spread evenly round the wheel and stay on it.
  for (let n = 0; n < WHEEL.gondolas; n++) {
    const g = gondolaPos(wheel, n, 37);
    assert.ok(Math.abs(Math.hypot(g.x - wheel.x, g.z - wheel.z, g.y - WHEEL.hub) - WHEEL.radius) < 1e-9);
  }
  assert.ok(Math.abs(gondolaAngle(3, 0) - (3 / WHEEL.gondolas) * Math.PI * 2) < 1e-9);
  // You board from open ground next to it; the wheel itself is solid.
  setLayoutSolids(ITEMS);
  try {
    const b = boardPoint(wheel);
    assert.ok(!blockedAt(b.x, b.z) && Math.hypot(b.x - wheel.x, b.z - wheel.z) <= WHEEL.boardRange);
    assert.ok(blockedAt(wheel.x, wheel.z));
  } finally { setLayoutSolids([]); }
  // One wheel per festival; the builder can move it.
  const two = sanitizeLayout({ items: [{ type: "wheel", x: 0, z: 0 }, { type: "wheel", x: 50, z: 0 }] });
  assert.equal(two.layout.items.filter((i) => i.type === "wheel").length, 1);
  assert.ok(two.warnings.some((w) => /Ferris wheel/.test(w)));
});

test("riding the wheel: walk up, get on, go round once, get set down at the bottom", () => {
  const rides = new RideSystem();
  const near = boardPoint(wheel);
  let now = 1000;

  rides.board("A", { x: wheel.x + 60, z: wheel.z }, now, wheel);
  assert.match(rides.drainEvents()[0].text, /Walk up to the Ferris wheel/);
  assert.equal(rides.rideOf("A"), "");

  rides.board("A", near, now, wheel);
  const ride = rides.rideOf("A");
  assert.ok(onWheel(ride), "everyone can see they're on the wheel: it's in the synced state");
  const n = rideGondola(ride);
  assert.ok(fromBottom(n, now) <= Math.PI / WHEEL.gondolas + 1e-9, "into the gondola nearest the ground");
  assert.equal(rides.drainEvents()[0].error, undefined);

  // While riding, the server reports where the gondola is; halfway round that's the top.
  let top = 0, offAt = null;
  for (let i = 0; i < WHEEL.period * 20 * 2 && !offAt; i++) {
    now += 0.05;
    const [r] = rides.tick(now, wheel);
    top = Math.max(top, gondolaPos(wheel, n, now).y);
    if (r.off) offAt = { now, ...r };
    else assert.ok(Math.abs(r.x - gondolaPos(wheel, n, now).x) < 1e-9);
  }
  assert.ok(top > WHEEL.hub + WHEEL.radius - 0.5, "went over the top");
  assert.ok(offAt, "the ride ends by itself");
  assert.ok(offAt.now - 1000 >= WHEEL.period * 0.5 && offAt.now - 1000 <= WHEEL.period * 1.5, `one slow turn (${(offAt.now - 1000).toFixed(0)} s)`);
  assert.ok(fromBottom(n, offAt.now) < 0.05, "you get off at the bottom");
  assert.deepEqual({ x: offAt.x, z: offAt.z }, near, "and are set down next to the wheel");
  assert.equal(rides.rideOf("A"), "");
});

test("you can only step off near the ground; gondolas fill up; leaving frees your seat", () => {
  const rides = new RideSystem();
  const near = boardPoint(wheel);
  const t0 = nextBottom(0, 500);                     // gondola 0 is exactly at the bottom
  rides.board("A", near, t0, wheel);
  assert.equal(rides.rideOf("A"), "wheel:0");
  assert.deepEqual(rides.off("A", t0 + 2, wheel), near, "just got on: can still hop off");
  rides.board("A", near, t0, wheel);
  rides.drainEvents();
  assert.equal(rides.off("A", t0 + WHEEL.period / 2, wheel), null);
  assert.match(rides.drainEvents()[0].text, /comes back down/);
  assert.equal(rides.rideOf("A"), "wheel:0");

  // Seats: the nearest gondola fills, then the next nearest, until the whole wheel is full.
  for (let i = 0; i < WHEEL.seats - 1; i++) rides.board(`B${i}`, near, t0, wheel);
  rides.board("C", near, t0, wheel);
  assert.notEqual(rides.rideOf("C"), "wheel:0");
  assert.ok(onWheel(rides.rideOf("C")));
  for (let i = 0; i < WHEEL.gondolas * WHEEL.seats; i++) rides.board(`X${i}`, near, t0, wheel);
  rides.drainEvents();
  rides.board("Late", near, t0, wheel);
  assert.match(rides.drainEvents()[0].text, /full/);
  rides.leave("A");                                   // someone disconnects
  rides.board("Late", near, t0, wheel);
  assert.equal(rides.rideOf("Late"), "wheel:0");
  assert.equal(freeGondola(t0, new Map()), 0);

  // If the organizer takes the wheel off the map mid-ride, riders are set down.
  const out = rides.tick(t0 + 1, null);
  assert.ok(out.length && out.every((r) => r.off));
  assert.equal(rides.rideOf("Late"), "");
});

test("the golf cart: premium members have one, it's parked at their camp, and it's faster than running", async () => {
  const dir = mkdtempSync(join(tmpdir(), "fv-ride-"));
  try {
    const store = new AccountStore({ dir });
    const { account: free } = await store.signup("Walker", "tacos-forever");
    const { account: vip } = await store.signup("Roller", "tacos-forever");
    store.unlock("Roller", PREMIUM_MEMBERSHIP);
    assert.equal(hasGolfCart(store.get(free.id)), false);
    assert.equal(hasGolfCart(store.get(vip.id)), true);
    assert.ok(CART_SPEED > RUN_SPEED * 1.5);

    const rides = new RideSystem();
    rides.cart("W", true, { owns: hasGolfCart(store.get(free.id)), hasCamp: true });
    assert.match(rides.drainEvents()[0].text, /premium members/);
    assert.equal(rides.rideOf("W"), "");
    rides.cart("R", true, { owns: true, hasCamp: false });
    assert.match(rides.drainEvents()[0].text, /parked at your camp/);
    rides.cart("R", true, { owns: true, hasCamp: true });
    assert.equal(rides.rideOf("R"), "cart", "everyone can see who's in a cart");
    // Getting on the wheel parks the cart; you can't drive from a gondola.
    rides.board("R", boardPoint(wheel), 0, wheel);
    assert.ok(onWheel(rides.rideOf("R")));
    rides.cart("R", true, { owns: true, hasCamp: true });
    assert.ok(onWheel(rides.rideOf("R")));
    rides.leave("R");
    rides.cart("R", true, { owns: true, hasCamp: true });
    rides.cart("R", false);
    assert.equal(rides.rideOf("R"), "");

    // Whether it's premium-only or also sold for credits is one switch in shared/economy.js.
    assert.deepEqual([GOLF_CART.premium, GOLF_CART.price], [true, null], "today: comes with premium, not sold");
    assert.match(buy(store, free.id, GOLF_CART.id).error, /premium membership/);
    try {
      GOLF_CART.price = 300;                           // ...flip it: now anyone can buy one
      const out = buy(store, free.id, GOLF_CART.id);
      assert.ok(out.ok, out.error);
      assert.equal(out.balance, STARTING_CREDITS - 300);
      assert.equal(hasGolfCart(store.get(free.id)), true);
      assert.equal(isPremiumMember(store.get(free.id)), false, "buying a cart doesn't make you premium");
      assert.match(buy(store, free.id, GOLF_CART.id).error, /already have a golf cart/);
      assert.match(buy(store, vip.id, GOLF_CART.id, { premium: true }).error, /already have a golf cart/);
    } finally { GOLF_CART.price = null; }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the shuttle: a free ride between the sections, from stop to stop, but not to skip a timed quest", () => {
  const stops = stopsOf(ITEMS);
  const sections = ITEMS.filter((i) => i.type === "area" && ["sec_main", "sec_east", "sec_west", "camp", "camp2"].includes(i.id));
  const inside = (a, s) => Math.abs(s.x - a.x) <= a.w / 2 && Math.abs(s.z - a.z) <= a.d / 2;
  for (const a of sections) assert.ok(stops.some((s) => inside(a, s)), `${a.label} has a shuttle stop`);
  assert.equal(new Set(stops.map((s) => s.id)).size, stops.length);
  setLayoutSolids(ITEMS);
  try {
    for (const s of stops) assert.ok(!blockedAt(s.x, s.z), `${s.label} stands on open ground`);
    const rides = new RideSystem();
    const seq = (() => { let k = 0; return () => ((k = (k * 9301 + 49297) % 233280) / 233280); })();
    const gate = stops.find((s) => s.id === "stop_gate"), stage = stops.find((s) => s.id === "stop_main");
    // Not near a stop: no ride.
    assert.equal(rides.shuttle("a", { x: 0, z: 0 }, stage.id, ITEMS), null);
    assert.match(rides.drainEvents()[0].text, /shuttle stop/);
    // At the gate stop: off you go, and you land near the Main Stage stop, on open ground.
    const at = rides.shuttle("a", { x: gate.x + 2, z: gate.z }, stage.id, ITEMS, { rng: seq });
    assert.ok(at && Math.hypot(at.x - stage.x, at.z - stage.z) <= SHUTTLE.landing + 1.5 && !blockedAt(at.x, at.z));
    assert.equal(stopAt(ITEMS, at)?.id, stage.id);
    // Not during a timed quest, not in a cart, not from the Ferris wheel, not to nowhere.
    rides.drainEvents();
    assert.equal(rides.shuttle("a", gate, stage.id, ITEMS, { busy: true }), null);
    assert.match(rides.drainEvents()[0].text, /timed quest/);
    rides.carts.add("a");
    assert.equal(rides.shuttle("a", gate, stage.id, ITEMS), null);
    rides.carts.delete("a");
    assert.equal(rides.shuttle("a", gate, "nowhere", ITEMS), null);
    assert.equal(rides.shuttle("a", gate, gate.id, ITEMS), null);
  } finally { setLayoutSolids([]); }
  // The builder keeps stops (and their names).
  const out = sanitizeLayout({ items: [{ type: "stop", x: 5, z: 5, label: "<b>Dock</b>" }, { type: "stop", x: 9, z: 9 }] });
  assert.deepEqual(out.layout.items.map((i) => i.label), ["bDock/b", "Shuttle stop"]);
});

// ---------- Golf cart parking ----------
import { CART_PARKING, lotsOf, bayCount, bayPos, stepOutPoint, lotAt, parkingFor, nearestLot, encodeParked, decodeParked, cartSolids } from "../shared/rides.js";
import { addMissingParking } from "../shared/layout.js";

const LOTS = lotsOf(ITEMS);
const lot = (id) => LOTS.find((l) => l.id === id);

test("golf cart parking: by the busy places, on open ground, with room to step out", () => {
  setLayoutSolids(ITEMS);
  assert.ok(LOTS.length >= 5, "parking in every section");
  assert.ok(Math.hypot(lot("park_wheel").x - wheel.x, lot("park_wheel").z - wheel.z) < 25, "parking by the Ferris wheel");
  const main = ITEMS.find((i) => i.id === "stage_main");
  assert.ok(Math.hypot(lot("park_main").x - main.x, lot("park_main").z - main.z) < 50, "parking by the Main Stage");
  for (const l of LOTS) {
    assert.equal(bayCount(l), 4, `${l.id} has 4 bays`);
    for (let k = 0; k < bayCount(l); k++) {
      const b = bayPos(l, k), out = stepOutPoint(l, k);
      assert.ok(!blockedAt(b.x, b.z, 1.0), `${l.id} bay ${k} is open ground`);
      assert.ok(!blockedAt(out.x, out.z), `${l.id}: you can step out of bay ${k}`);
    }
  }
});

test("golf cart parking: you park in the nearest free bay, a little outside the lines still counts, and a full lot is full", () => {
  const l = lot("park_wheel");
  assert.equal(lotAt(ITEMS, { x: l.x, z: l.z })?.id, l.id);
  assert.equal(lotAt(ITEMS, { x: l.x, z: l.z + l.d / 2 + CART_PARKING.reach - 0.1 })?.id, l.id, "just in front of the lot");
  assert.equal(lotAt(ITEMS, { x: l.x, z: l.z + l.d / 2 + CART_PARKING.reach + 1 }), null, "too far out");
  const right = bayPos(l, 3);
  const spot = parkingFor(ITEMS, { x: right.x + 0.3, z: right.z + 2 });
  assert.equal(spot.bay, 3, "the bay you drove up to");
  assert.equal(parkingFor(ITEMS, { x: right.x, z: right.z }, new Set([`${l.id}:3`])).bay, 2, "next one over when it's taken");
  const full = parkingFor(ITEMS, { x: l.x, z: l.z }, new Set([0, 1, 2, 3].map((k) => `${l.id}:${k}`)));
  assert.equal(full.error, "full");
  assert.equal(full.lot.id, l.id);
  assert.equal(parkingFor(ITEMS, { x: 0, z: 0 }).error, "restricted", "the middle of the Main Field isn't parking");
  // A parked cart faces into its bay and is solid along its length.
  const b = bayPos(l, 0);
  const [s1, s2] = cartSolids(b);
  assert.ok(Math.abs(Math.hypot(s1.x - s2.x, s1.z - s2.z) - 1.1) < 1e-9);
  assert.deepEqual(decodeParked(encodeParked({ lot: l, bay: 0, ...b })), { lot: l.id, bay: 0, x: +b.x.toFixed(2), z: +b.z.toFixed(2), rotY: +b.rotY.toFixed(3) });
  assert.equal(decodeParked(""), null);
  // The warning says where the nearest parking is.
  const near = nearestLot(ITEMS, { x: wheel.x, z: wheel.z - 30 });
  assert.equal(near.lot.id, "park_wheel");
  assert.match(near.dir, /south/);
});

test("golf cart parking: step out in parking and the cart stays; anywhere else it goes home; it waits 10 minutes", () => {
  const rides = new RideSystem();
  const l = lot("park_wheel"), inLot = { x: l.x, z: l.z }, opts = { owns: true, hasCamp: true, items: ITEMS };
  const toasts = (id) => rides.drainEvents().filter((e) => e.to === id).map((e) => e.text).join(" | ");
  rides.cart("a", true, opts);
  const out = rides.cart("a", false, { ...opts, stay: true, pos: inLot, now: 100 });
  assert.ok(out, "you're put beside your cart");
  assert.ok(!rides.carts.has("a"), "you're on foot");
  const pk = decodeParked(rides.parkedOf("a"));
  assert.equal(pk.lot, l.id);
  assert.ok(Math.hypot(out.x - pk.x, out.z - pk.z) < l.d + 1, "standing next to it");
  assert.match(toasts("a"), /Parked at Ferris Wheel parking.*10 minutes/);

  // Three more carts fill the lot; the fifth gets sent home, and is told so.
  for (const id of ["b", "c", "d"]) { rides.cart(id, true, opts); rides.cart(id, false, { ...opts, stay: true, pos: inLot, now: 100 }); }
  assert.equal(new Set([...rides.parked.values()].map((p) => p.bay)).size, 4, "four different bays");
  rides.drainEvents();
  rides.cart("e", true, opts);
  assert.equal(rides.cart("e", false, { ...opts, stay: true, pos: inLot, now: 100 }), null);
  assert.ok(!rides.parked.has("e") && !rides.carts.has("e"));
  assert.match(toasts("e"), /Ferris Wheel parking is full, so your cart went back to your camp/);

  // Not in parking: home it goes (the game warns before it asks the server for this).
  rides.cart("f", true, opts);
  rides.cart("f", false, { ...opts, stay: true, pos: { x: 0, z: 0 }, now: 100 });
  assert.ok(!rides.parked.has("f"));
  assert.match(toasts("f"), /isn't golf cart parking/);
  rides.cart("f", true, opts);
  assert.equal(rides.cart("f", false, opts), null, "plain step-out: straight home");
  assert.ok(!rides.parked.has("f"));

  // Drive again next to your parked cart: you get in where it is. From far away it comes to you.
  const atA = decodeParked(rides.parkedOf("a"));
  const back = rides.cart("a", true, { ...opts, pos: { x: atA.x + 2, z: atA.z + 2 } });
  assert.ok(Math.hypot(back.x - atA.x, back.z - atA.z) < 0.01 && Math.abs(back.rotY - atA.rotY) < 0.001, "in the driver's seat, facing the way it's parked");
  assert.ok(rides.carts.has("a") && !rides.parked.has("a"));
  assert.equal(rides.cart("b", true, { ...opts, pos: { x: 0, z: 0 } }), null);
  assert.ok(!rides.parked.has("b"), "called over from the parking");

  // After 10 minutes (or when the parking is removed, or you leave), it goes back to your camp.
  assert.deepEqual(rides.expireParked(100 + CART_PARKING.returnAfter - 1, ITEMS), []);
  rides.drainEvents();
  assert.deepEqual(rides.expireParked(100 + CART_PARKING.returnAfter, ITEMS).sort(), ["c", "d"]);
  assert.match(toasts("c"), /went back to your camp/);
  rides.cart("g", true, opts); rides.cart("g", false, { ...opts, stay: true, pos: inLot, now: 200 });
  assert.deepEqual(rides.expireParked(201, ITEMS.filter((i) => i.id !== l.id)), ["g"]);
  rides.cart("h", true, opts); rides.cart("h", false, { ...opts, stay: true, pos: inLot, now: 200 });
  rides.leave("h");
  assert.equal(rides.parkedOf("h"), "");
});

test("golf cart parking: the builder keeps it, and a layout saved before parking existed gets some", () => {
  const out = sanitizeLayout({ items: [{ type: "carpark", x: 10, z: 20, rot: 90, w: 100, d: 1 }] });
  const p = out.layout.items[0];
  assert.equal(p.type, "carpark");
  assert.equal(p.w, 40, "no wider than 40 m");
  assert.equal(p.d, 3.4, "at least a bay deep");
  assert.equal(p.label, "Golf cart parking");

  const old = defaultLayout();
  old.items = old.items.filter((i) => i.type !== "carpark");
  // Someone put a stage where the Food Court parking would go: that one is skipped.
  const food = lot("park_food");
  old.items.push({ id: "my_stage", type: "stage", variant: "side", x: food.x, z: food.z, rot: 0, label: "Mine", genre: "" });
  const added = addMissingParking(old);
  assert.ok(added.includes("park_wheel") && added.includes("park_main"));
  assert.ok(!added.includes("park_food"), "not on top of the new stage");
  assert.deepEqual(addMissingParking(old), [], "only once");
  assert.ok(sanitizeLayout(old).layout.items.some((i) => i.type === "carpark"));
});
