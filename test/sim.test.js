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
