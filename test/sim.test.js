import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeInput, applyInput, WALK_SPEED, RUN_SPEED, WORLD_HALF_SIZE, WALK_LIMIT, TICK_RATE } from "../shared/sim.js";

const dt = 1 / TICK_RATE;
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} !== ${b}`);

test("walking one second covers WALK_SPEED units", () => {
  const p = { x: 0, z: 0, rotY: 0 };
  for (let i = 0; i < TICK_RATE; i++) applyInput(p, sanitizeInput({ x: 1, z: 0 }), dt);
  close(p.x, WALK_SPEED);
  close(p.z, 0);
});

test("running is faster than walking", () => {
  const p = { x: 0, z: 0, rotY: 0 };
  for (let i = 0; i < TICK_RATE; i++) applyInput(p, sanitizeInput({ x: 0, z: 1, run: true }), dt);
  close(p.z, RUN_SPEED);
});

test("oversized input vectors can't speed-hack", () => {
  const i = sanitizeInput({ x: 1000, z: 1000 });
  close(Math.hypot(i.x, i.z), 1);
});

test("garbage input means standing still", () => {
  for (const raw of [null, undefined, "hi", { x: "5" }, { x: NaN, z: Infinity }, { run: "yes" }]) {
    const i = sanitizeInput(raw);
    assert.equal(i.x, 0); assert.equal(i.z, 0); assert.equal(i.run, false);
  }
});

test("players can't leave the festival grounds", () => {
  const p = { x: WORLD_HALF_SIZE - 0.1, z: -WORLD_HALF_SIZE + 0.1, rotY: 0 };
  for (let i = 0; i < 100; i++) applyInput(p, sanitizeInput({ x: 1, z: -1, run: true }), dt);
  assert.equal(p.x, WALK_LIMIT);
  assert.equal(p.z, -WALK_LIMIT);
});

test("standing still keeps facing direction", () => {
  const p = { x: 0, z: 0, rotY: 1.23 };
  applyInput(p, sanitizeInput({}), dt);
  assert.equal(p.rotY, 1.23);
});

// ---------- Collision ----------
import {
  setLayoutSolids, setSolids, resolveSolids, blockedAt, inWater, separatePlayers, randomSpawn,
  PLAYER_RADIUS, PLAYER_GAP, PUSH_SPEED, CART_SPEED,
} from "../shared/sim.js";
import { defaultLayout, FENCE, SPAWN, TYPES, forestTrees } from "../shared/layout.js";
import { applyLayout, VENDORS, vendorFront } from "../shared/venue.js";
import { GIVERS, QUESTS, LOST_SPOTS, CAMP_TENTS, PICKUP_RANGE, TALK_RANGE } from "../shared/quests-data.js";
import { campSolids } from "../shared/camps.js";

const ITEMS = defaultLayout().items;
const item = (id) => ITEMS.find((i) => i.id === id);
// Hold a direction for some seconds, like a player would.
function walk(p, x, z, seconds, run = true) {
  const input = sanitizeInput({ x, z, run });
  for (let i = 0; i < seconds * TICK_RATE; i++) applyInput(p, input, dt);
  return p;
}
// Each collision test sets up the solids it needs and clears them again, so the movement tests
// above (which expect open ground) aren't affected by the order tests run in.
function withLayout(fn) {
  setLayoutSolids(ITEMS);
  try { fn(); } finally { setLayoutSolids([]); setSolids("camps", []); }
}

test("the grounds follow the fence: one number sizes the world", () => {
  assert.equal(WORLD_HALF_SIZE, FENCE + 1);
  assert.ok(FENCE >= 198, "the map is at least twice as big each way as the old ±99");
  assert.ok(Math.abs(SPAWN.x) < FENCE && Math.abs(SPAWN.z) < FENCE);
});

test("walking into a stage stops you", () => withLayout(() => {
  const stage = item("stage_main");                      // 32 × 14 m, centered on (0, -110)
  const p = walk({ x: 0, z: -90, rotY: 0 }, 0, -1, 10);  // run straight at its front for 10 seconds
  const front = stage.z + 7;
  close(p.x, 0);
  assert.ok(Math.abs(p.z - (front + PLAYER_RADIUS)) < 1e-6, `stopped at the stage front, z=${p.z}`);
  assert.ok(!blockedAt(p.x, p.z));
  // A stall, a camping tent, a picnic table and the Ferris wheel are solid too.
  for (const type of ["stall", "tent", "table", "wheel"]) {
    const it = ITEMS.find((i) => i.type === type);
    assert.ok(blockedAt(it.x, it.z), `${type} is solid`);
    const q = walk({ x: it.x + 8, z: it.z, rotY: 0 }, -1, 0, 5, false);   // walk at it from the east for 15 m
    assert.ok(q.x > it.x, `${type} can't be walked through`);
  }
}));

test("walking around a stage works: you slide along it and carry on", () => withLayout(() => {
  const stage = item("stage_main");
  const p = walk({ x: 0, z: -95, rotY: 0 }, 1, -1, 12);  // push north-east into the front
  assert.ok(p.x > stage.x + 16, `slid past the corner, x=${p.x}`);
  assert.ok(p.z < stage.z - 7, `and on behind the stage, z=${p.z}`);
}));

test("trees are as solid as their trunks, and the forest paths are clear", () => withLayout(() => {
  const forest = ITEMS.find((i) => i.type === "forest");
  const trees = forestTrees(forest, ITEMS);
  assert.ok(trees.length > 50);
  assert.deepEqual(trees, forestTrees(forest, ITEMS), "the same trees every time, on the server and in every browser");
  const tree = trees[0];
  assert.ok(blockedAt(tree.x, tree.z));
  assert.ok(!blockedAt(tree.x + 1.5, tree.z), "you can walk between the trees");
  // The forest path from the loop to the East Side: a straight walk, nothing in the way.
  const p = walk({ x: 34, z: -50, rotY: 0 }, 1, 0, 12);
  assert.ok(p.x > 108 && Math.abs(p.z + 50) < 1e-6, `walked the forest path: ${p.x}, ${p.z}`);
}));

test("the river can only be crossed on a bridge", () => withLayout(() => {
  const river = item("river");
  const bank = river.z - river.d / 2;
  const wet = walk({ x: 50, z: 80, rotY: 0 }, 0, 1, 10);                 // straight at the water
  assert.ok(wet.z <= bank && wet.z > bank - 1, `stopped on the bank, z=${wet.z}`);
  assert.ok(inWater(50, river.z) && !inWater(0, river.z));
  const slid = walk({ x: 50, z: 80, rotY: 0 }, 1, 1, 6);                 // diagonal: slides along the bank
  assert.ok(slid.x > 60 && slid.z <= bank);
  const over = walk({ x: 0, z: 80, rotY: 0 }, 0, 1, 10);                 // over the main bridge
  assert.ok(over.z > river.z + river.d / 2 + 5, `crossed, z=${over.z}`);
  const rail = walk({ x: 0, z: river.z, rotY: 0 }, 1, 0, 5);             // can't step off the side of the bridge
  assert.ok(rail.x <= item("bridge_main").d / 2 && !inWater(rail.x, rail.z));
}));

test("you still can't leave the grounds, even running into a corner full of trees", () => withLayout(() => {
  const p = walk({ x: FENCE - 12, z: -(FENCE - 12), rotY: 0 }, 1, -1, 10);
  assert.ok(p.x <= WALK_LIMIT && p.z >= -WALK_LIMIT);
  assert.ok(Math.abs(p.x) <= FENCE && Math.abs(p.z) <= FENCE);
}));

test("two players can't stand in the same spot, but nobody gets trapped", () => withLayout(() => {
  const a = { x: 10, z: 10 }, b = { x: 10, z: 10 };
  separatePlayers([a, b], dt);
  assert.ok(Math.hypot(a.x - b.x, a.z - b.z) > 0, "they start to drift apart on the first tick");
  for (let i = 0; i < 3 * TICK_RATE; i++) separatePlayers([a, b], dt);
  assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= PLAYER_GAP - 0.01, "and end up a body apart");
  const settled = { ...a };
  assert.equal(separatePlayers([a, b], dt), 0, "then they're left alone");
  assert.deepEqual(a, settled);

  // It's a soft push (slower than walking), so you can always walk through a crowd.
  assert.ok(PUSH_SPEED < WALK_SPEED);
  const crowd = Array.from({ length: 12 }, (_, i) => ({ x: 20 + (i % 4) * 0.5, z: 20 + Math.floor(i / 4) * 0.5 }));
  const me = { x: 18, z: 20.5, rotY: 0 };
  for (let i = 0; i < 4 * TICK_RATE; i++) { applyInput(me, sanitizeInput({ x: 1, z: 0 }), dt); separatePlayers([me, ...crowd], dt); }
  assert.ok(me.x > 24, `walked through the crowd, x=${me.x}`);

  // Being nudged never pushes anyone into a wall or the river, and riders are left alone.
  const stage = item("stage_main");
  const wall = { x: 0, z: stage.z + 7 + PLAYER_RADIUS }, shover = { x: 0, z: stage.z + 7 + PLAYER_RADIUS + 0.2 };
  for (let i = 0; i < 40; i++) separatePlayers([wall, shover], dt);
  assert.ok(!blockedAt(wall.x, wall.z) && wall.z >= stage.z + 7 + PLAYER_RADIUS - 1e-6);
  const rider = { x: 5, z: 5, ride: "wheel:0" }, walker = { x: 5, z: 5 };
  separatePlayers([rider, walker], dt);
  assert.deepEqual([rider.x, rider.z, walker.x, walker.z], [5, 5, 5, 5]);
}));

test("camps are solid where things stand, and walkable in between", () => withLayout(() => {
  const camp = { x: -90, z: 130, plot: "plot_20x20", items: ["tent_led", "hottub", "pa", "neon", "rug"] };
  setSolids("camps", campSolids(camp));
  const solids = campSolids(camp);
  assert.equal(solids.length, 3);                                       // the tent, the hot tub, the PA: not the sign or the rug
  for (const s of solids) assert.ok(blockedAt(s.x, s.z));
  assert.ok(!blockedAt(camp.x + 2.6, camp.z + 2.6), "the grass of the spot is open, so friends can hang out there");
  const p = walk({ x: solids[0].x, z: solids[0].z + 6, rotY: 0 }, 0, -1, 4, false);
  assert.ok(p.z > solids[0].z, "can't walk through the tent");
  setSolids("camps", []);
  assert.ok(!blockedAt(solids[0].x, solids[0].z), "packing up the camp clears it");
}));

test("a golf cart is faster than running and still can't go through things", () => withLayout(() => {
  assert.ok(CART_SPEED > RUN_SPEED);
  const p = walk({ x: 0, z: 60, rotY: 0, ride: "cart" }, 0, -1, 1);
  close(p.z, 60 - CART_SPEED);
  const stage = item("stage_main");
  const q = walk({ x: 0, z: -90, rotY: 0, ride: "cart" }, 0, -1, 5);
  assert.ok(q.z > stage.z + 7 + PLAYER_RADIUS, "a cart is wider than a person and stops further out");
}));

test("collision doesn't break the quests: every giver, marker, hiding spot, order tent and stall can be reached", () => {
  applyLayout(defaultLayout());
  try {
    for (const g of GIVERS) assert.ok(!blockedAt(g.x, g.z), `${g.name} isn't standing inside something`);
    for (const [k, m] of Object.entries(QUESTS.soundcheck.markers)) assert.ok(!blockedAt(m.x, m.z), `Soundcheck ${k} marker is open ground`);
    // Something you only have to get NEAR counts if the closest open ground to it is in range.
    const reach = (pt) => { const p = resolveSolids({ x: pt.x, z: pt.z }); return inWater(p.x, p.z) ? Infinity : Math.hypot(p.x - pt.x, p.z - pt.z); };
    assert.ok(LOST_SPOTS.length >= 10);
    for (const s of LOST_SPOTS) assert.ok(reach(s) < PICKUP_RANGE - 0.5, `totem spot ${s.where} can be reached`);
    assert.ok(CAMP_TENTS.length >= 8);
    for (const t of CAMP_TENTS) assert.ok(reach(t) < QUESTS.vendorrush.handoffRange - 0.5, `order tent ${t.x},${t.z} can be reached`);
    assert.ok(Math.hypot(GIVERS.find((g) => g.id === "rae").x - VENDORS.find((v) => v.id === "rae").x, 0) < TALK_RANGE + 1);
    for (const v of VENDORS) { const f = vendorFront(v); assert.ok(!blockedAt(f.x, f.z), `the front of ${v.name} is open`); }
    for (let i = 0; i < 50; i++) { const s = randomSpawn(); assert.ok(!blockedAt(s.x, s.z) && Math.hypot(s.x - SPAWN.x, s.z - SPAWN.z) <= SPAWN.radius + 1e-9); }

    // And you can actually get there on foot: Vendor Rush's run from Mama Rae's, over the bridge, to a tent.
    const rae = GIVERS.find((g) => g.id === "rae");
    const p = { x: rae.x, z: rae.z, rotY: 0 };
    let seconds = 0;
    const go = (tx, tz) => { for (let i = 0; i < 4000 && Math.hypot(tx - p.x, tz - p.z) > 1.5; i++) { applyInput(p, sanitizeInput({ x: tx - p.x, z: tz - p.z, run: true }), dt); seconds += dt; } };
    go(0, 30); go(0, 110); go(CAMP_TENTS[0].x, CAMP_TENTS[0].z + 3);
    assert.ok(Math.hypot(CAMP_TENTS[0].x - p.x, CAMP_TENTS[0].z - p.z) <= QUESTS.vendorrush.handoffRange, `reached the tent: ${p.x}, ${p.z}`);
    assert.ok(seconds * 5 < QUESTS.vendorrush.timeLimit, `three deliveries fit in the time limit (one way takes ${seconds.toFixed(0)} s)`);
  } finally { setLayoutSolids([]); }
});
