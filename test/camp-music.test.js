import { test } from "node:test";
import assert from "node:assert/strict";
import { composeLoop, BARS, STEPS_PER_BAR } from "../client/camp-music.js";
import { MUSIC_STYLES, DEFAULT_MUSIC, musicById } from "../shared/camps.js";

const MINOR = [0, 2, 3, 5, 7, 8, 10];

test("every style makes a full 4-bar loop at its tempo", () => {
  for (const m of MUSIC_STYLES) {
    const loop = composeLoop(m.id, "Rook");
    assert.equal(loop.style, m.id);
    assert.equal(loop.bpm, m.bpm);
    assert.equal(loop.steps, BARS * STEPS_PER_BAR);
    assert.ok(Math.abs(loop.duration - (BARS * 4 * 60) / m.bpm) < 1e-9, `${m.id} duration`);
    const kinds = new Set(loop.events.map((e) => e.kind));
    assert.ok(kinds.has("kick") && kinds.has("bass") && kinds.has("hat"), `${m.id} has drums and bass`);
    assert.ok(kinds.has("chord") || kinds.has("pad"), `${m.id} has chords`);
  }
});

test("everything stays inside the loop, in a sensible range, and in the key", () => {
  for (const m of MUSIC_STYLES) for (const seed of ["a", "Rook", "Glowcamp", "Neon531", "x".repeat(40)]) {
    const loop = composeLoop(m.id, seed);
    for (const e of loop.events) {
      assert.ok(Number.isInteger(e.step) && e.step >= 0 && e.step < loop.steps, `${m.id} step ${e.step}`);
      assert.ok(e.step + (e.len ?? 1) <= loop.steps, `${m.id} ${e.kind} at ${e.step} rings past the loop`);
      assert.ok(e.vel > 0 && e.vel <= 1, `${m.id} vel`);
      for (const n of e.notes ?? []) {
        assert.ok(n >= 24 && n <= 84, `${m.id} note ${n} out of range`);
        assert.ok(MINOR.includes(((n - loop.key) % 12 + 12) % 12), `${m.id} note ${n} is outside the key`);
      }
    }
    assert.deepEqual(loop.events.map((e) => e.step), [...loop.events.map((e) => e.step)].sort((a, b) => a - b), "events in time order");
  }
});

test("the same camp always gets the same tune; different camps usually differ", () => {
  assert.deepEqual(composeLoop("house", "Rook"), composeLoop("house", "Rook"));
  const tunes = new Set(["Rook", "Ash", "Juniper", "Dex", "Neon531", "Glowcamp", "Pal", "Zoe"].map((seed) => JSON.stringify(composeLoop("house", seed))));
  assert.ok(tunes.size >= 4, `only ${tunes.size} different tunes for 8 camps`);
});

test("an unknown style falls back to the default", () => {
  assert.equal(composeLoop("polka", "Rook").style, DEFAULT_MUSIC);
  assert.ok(musicById(DEFAULT_MUSIC));
});
