import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AccountStore } from "../server/accounts.js";
import { huntDay, huntSpots, describePlace, collectToken, foundToday, secondsToNextHunt } from "../server/hunt.js";
import { HUNT, STARTING_CREDITS } from "../shared/economy.js";
import { applyLayout, FENCE, LAYOUT } from "../shared/venue.js";
import { defaultLayout } from "../shared/layout.js";
import { blockingBoxes } from "../shared/camps.js";

applyLayout(defaultLayout());

function temp() {
  const dir = mkdtempSync(join(tmpdir(), "fv-hunt-"));
  return { dir, store: new AccountStore({ dir }), done: () => rmSync(dir, { recursive: true, force: true }) };
}

test("each day has its own tokens, the same for everyone", () => {
  const a = huntSpots("2026-11-23"), b = huntSpots("2026-11-23"), c = huntSpots("2026-11-24");
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.map((s) => [s.x, s.z]), c.map((s) => [s.x, s.z]));
  assert.equal(a.length, HUNT.tokens);
  assert.deepEqual(a.map((s) => s.i), [...Array(HUNT.tokens).keys()]);
});

test("tokens are inside the fence, clear of stalls/tents/trees, spread out, with a hint", () => {
  const blocks = blockingBoxes(LAYOUT.items);
  for (let d = 0; d < 60; d++) {
    const day = huntDay(Date.UTC(2026, 11, 1) + d * 86400_000);   // 60 days in a row
    const spots = huntSpots(day);
    assert.equal(spots.length, HUNT.tokens, day);
    for (const s of spots) {
      assert.ok(Math.abs(s.x) < FENCE - 7 && Math.abs(s.z) < FENCE - 7, `${day} token ${s.i} inside the fence`);
      assert.ok(!blocks.some((b) => s.x > b.x0 && s.x < b.x1 && s.z > b.z0 && s.z < b.z1), `${day} token ${s.i} is inside a ${blocks.find((b) => s.x > b.x0 && s.x < b.x1 && s.z > b.z0 && s.z < b.z1)?.type}`);
      assert.ok(typeof s.hint === "string" && s.hint.length > 5, `${day} hint`);
      for (const t of spots) if (t !== s) assert.ok(Math.hypot(s.x - t.x, s.z - t.z) >= 25, `${day} tokens ${s.i} and ${t.i} too close`);
    }
  }
});

test("hints point at real places", () => {
  assert.match(describePlace(0, 65), /Campground/);
  assert.match(describePlace(-14, -46), /south-west of the Main Stage/);
  assert.match(describePlace(12, -44), /Right by Dex/);                 // quest givers are landmarks too
  assert.match(describePlace(0, 94), /north of the main gate/);
  assert.match(describePlace(-80, -80), /fence, north-west side/);
});

test("collecting: must be close, once per token per day, bonus for all of them", async () => {
  const { dir, store, done } = temp();
  try {
    const { account } = await store.signup("Hunter", "tacos-forever");
    const day = "2026-11-23", spots = huntSpots(day);
    const at = (s, off = 0) => ({ x: s.x + off, z: s.z });
    assert.match(collectToken(store, account.id, { day, spots, i: 0, pos: at(spots[0], HUNT.range + 0.5) }).error, /closer/);
    assert.match(collectToken(store, account.id, { day, spots, i: 99, pos: at(spots[0]) }).error, /no token/);
    let total = 0;
    for (const s of spots) {
      const out = collectToken(store, account.id, { day, spots, i: s.i, pos: at(s, 1) });
      assert.ok(!out.error, out.error);
      total += out.credits;
      assert.equal(out.complete, s.i === spots.length - 1);
      assert.match(collectToken(store, account.id, { day, spots, i: s.i, pos: at(s) }).error, /already/);
    }
    assert.equal(total, HUNT.tokens * HUNT.perToken + HUNT.bonus);
    assert.equal(store.balance(store.get(account.id)), STARTING_CREDITS + total);
    assert.deepEqual(foundToday(store.get(account.id), day), [0, 1, 2, 3, 4]);
    // The next day starts fresh.
    const next = "2026-11-24", spots2 = huntSpots(next);
    assert.deepEqual(foundToday(store.get(account.id), next), []);
    assert.equal(collectToken(store, account.id, { day: next, spots: spots2, i: 2, pos: at(spots2[2]) }).credits, HUNT.perToken);
    // Every token is in the credits ledger, the last one marked complete.
    const reasons = readFileSync(join(dir, "credits-ledger.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l).reason);
    assert.ok(reasons.includes(`hunt:${day}:4:complete`) && reasons.includes(`hunt:${next}:2`), reasons.join());
  } finally { done(); }
});

test("hunt days are UTC days", () => {
  assert.equal(huntDay(Date.UTC(2026, 10, 23, 23, 59)), "2026-11-23");
  assert.equal(huntDay(Date.UTC(2026, 10, 24, 0, 0)), "2026-11-24");
  assert.equal(secondsToNextHunt(Date.UTC(2026, 10, 23, 23, 0)), 3600);
});
