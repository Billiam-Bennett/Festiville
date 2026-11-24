import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Encoder, Decoder } from "@colyseus/schema";
import { EMOTES, EMOTE_COOLDOWN, emoteById, newEmoteState, startEmote, updateEmote } from "../shared/emotes.js";
import { BODIES } from "../shared/parts.js";
import { FestivalState, Player } from "../server/schema.js";
import { reduceKeys, parseSpec } from "../scripts/retarget.mjs";

// ---------- The emote list ----------
test("emotes: ids, keys and clips are unique and complete", () => {
  const ids = new Set(), keys = new Set();
  for (const e of EMOTES) {
    assert.match(e.id, /^[a-z]{1,16}$/);
    assert.ok(!ids.has(e.id), `duplicate ${e.id}`); ids.add(e.id);
    assert.ok(!keys.has(e.key), `duplicate key ${e.key}`); keys.add(e.key);
    assert.ok(e.name && e.icon && e.clip, e.id);
    if (!e.loop) assert.ok(e.duration > 0 && e.duration <= 5, `${e.id} needs a duration`);
  }
  assert.ok(emoteById("dance")?.loop, "old clients send \"dance\"; keep it");
  assert.equal(emoteById("nope"), null);
  // Keys the game already uses for other things.
  for (const k of ["KeyE", "KeyT", "KeyM", "KeyW", "KeyA", "KeyS", "KeyD", "Enter", "Escape"]) assert.ok(!keys.has(k), k);
});

// ---------- Server rules (shared/emotes.js) ----------
test("emotes: starting, repeating and stopping", () => {
  const s = newEmoteState();
  assert.equal(startEmote(s, "wave", { now: 1 }), true);
  assert.deepEqual([s.emote, s.emoteSeq], ["wave", 1]);
  assert.equal(startEmote(s, "wave", { now: 1.1 }), false, "cooldown");
  assert.equal(startEmote(s, "wave", { now: 1 + EMOTE_COOLDOWN }), true, "waving again replays it");
  assert.equal(s.emoteSeq, 2);
  assert.equal(startEmote(s, "dance", { now: 2 }), true);
  assert.equal(startEmote(s, "dance", { now: 3 }), false, "already dancing");
  assert.equal(s.emoteSeq, 3);
  assert.equal(startEmote(s, "", { now: 3 }), true);
  assert.equal(s.emote, "");
  assert.equal(startEmote(s, "", { now: 3 }), false, "nothing to stop");
});

test("emotes: garbage is ignored", () => {
  const s = newEmoteState();
  for (const bad of [null, undefined, 5, {}, ["wave"], "WAVE", "toString", "__proto__", "constructor"]) {
    assert.equal(startEmote(s, bad, { now: 10 }), false, String(bad));
  }
  assert.deepEqual([s.emote, s.emoteSeq], ["", 0]);
});

test("emotes: one-shots end on time, loops don't", () => {
  const s = newEmoteState();
  startEmote(s, "cheer", { now: 0 });
  assert.equal(updateEmote(s, { now: emoteById("cheer").duration - 0.05 }), false);
  assert.equal(updateEmote(s, { now: emoteById("cheer").duration }), true);
  assert.equal(s.emote, "");
  startEmote(s, "clap", { now: 10 });
  assert.equal(updateEmote(s, { now: 1000 }), false);
  assert.equal(s.emote, "clap");
});

test("emotes: moving cancels them, except jumping", () => {
  const s = newEmoteState();
  startEmote(s, "sit", { now: 0 });
  assert.equal(updateEmote(s, { now: 0.05, moving: true }), true, "walking off stands you up");
  assert.equal(s.emote, "");
  assert.equal(startEmote(s, "sit", { now: 1, moving: true }), false, "can't sit down mid-run");
  assert.equal(startEmote(s, "jump", { now: 1, moving: true }), true, "can jump while running");
  assert.equal(updateEmote(s, { now: 1.5, moving: true }), false);
  assert.equal(s.emote, "jump");
});

test("emotes: a jump can't be interrupted or chained mid-air", () => {
  const s = newEmoteState();
  startEmote(s, "jump", { now: 0 });
  const seq = s.emoteSeq;
  assert.equal(startEmote(s, "jump", { now: 0.5 }), false);
  assert.equal(startEmote(s, "wave", { now: 0.5 }), false);
  assert.equal(startEmote(s, "", { now: 0.5 }), false);
  assert.equal(s.emoteSeq, seq);
  updateEmote(s, { now: emoteById("jump").duration });
  assert.equal(s.emote, "");
  assert.equal(startEmote(s, "jump", { now: emoteById("jump").duration }), true, "land, then jump again");
});

// ---------- Sync: the room state carries emote + emoteSeq to every client ----------
test("emotes: emote and emoteSeq reach other players through the room state", () => {
  const state = new FestivalState();
  const p = new Player();
  state.players.set("a", p);
  const encoder = new Encoder(state);
  const decoded = new FestivalState();
  const decoder = new Decoder(decoded);
  decoder.decode(encoder.encodeAll());
  encoder.discardChanges();

  const s = newEmoteState();
  const sync = () => { p.emote = s.emote; p.emoteSeq = s.emoteSeq; decoder.decode(encoder.encode()); encoder.discardChanges(); };
  startEmote(s, "wave", { now: 0 }); sync();
  assert.equal(decoded.players.get("a").emote, "wave");
  assert.equal(decoded.players.get("a").emoteSeq, 1);
  startEmote(s, "wave", { now: 1 }); sync();
  assert.equal(decoded.players.get("a").emoteSeq, 2, "a repeated wave is visible as a new seq");
  updateEmote(s, { now: 10 }); sync();
  assert.equal(decoded.players.get("a").emote, "");
});

// ---------- The animation files ----------
for (const { id } of BODIES) {
  test(`anims: ${id} has every emote's clips, finite and sane`, () => {
    const text = readFileSync(new URL(`../client/assets/parts/${id}/anims.json`, import.meta.url), "utf8");
    assert.ok(text.length < 4 * 1024 * 1024, `anims.json is ${(text.length / 1048576).toFixed(1)} MB`);
    const clips = JSON.parse(text);
    const byName = new Map(clips.map((c) => [c.name, c]));
    const needed = new Set(["Idle", "Walk", "Run"]);
    for (const e of EMOTES) for (const k of [e.clip, e.intro, e.outro]) if (k) needed.add(k);
    for (const k of needed) assert.ok(byName.has(k), `${id} is missing ${k}`);
    for (const c of clips) {
      assert.ok(c.duration > 0, c.name);
      const bones = new Set();
      for (const t of c.tracks) {
        const [bone, prop] = t.name.split(".");
        assert.match(bone, /^mixamorig[A-Z]/, `${c.name}: ${t.name}`);
        const size = prop === "quaternion" ? 4 : 3;
        assert.equal(t.values.length, t.times.length * size, `${c.name}: ${t.name}`);
        assert.ok(t.times.every((x, i) => Number.isFinite(x) && x >= 0 && x <= c.duration + 1e-3 && (i === 0 || x > t.times[i - 1])), `${c.name}: ${t.name} times`);
        assert.ok(t.values.every(Number.isFinite), `${c.name}: ${t.name} has NaN/Infinity`);
        if (prop === "quaternion") {
          bones.add(bone);
          for (let i = 0; i < t.values.length; i += 4) {
            const len = Math.hypot(t.values[i], t.values[i + 1], t.values[i + 2], t.values[i + 3]);
            assert.ok(Math.abs(len - 1) < 0.002, `${c.name}: ${t.name} quaternion length ${len}`);
          }
        } else {
          assert.equal(bone, "mixamorigHips", `${c.name}: only the hips move (${t.name})`);
          for (let i = 1; i < t.values.length; i += 3) assert.ok(t.values[i] > 0 && t.values[i] < 2, `${c.name}: hip height ${t.values[i]}`);
        }
      }
      assert.equal(bones.size, 52, `${c.name} animates all 52 bones`);
    }
  });
}

// ---------- scripts/retarget.mjs helpers ----------
test("retarget: dropping keys keeps the curve within tolerance", () => {
  const times = [], values = [];
  for (let i = 0; i <= 30; i++) { times.push(i / 30); values.push(i / 30, Math.sin(i / 5)); }
  const r = reduceKeys(times, values, 2, 0.01);
  assert.ok(r.times.length < times.length && r.times.length >= 2);
  assert.equal(r.times[0], 0); assert.equal(r.times.at(-1), 1);
  for (let i = 0; i <= 30; i++) {
    const t = times[i];
    const j = r.times.findIndex((x) => x >= t);
    const a = Math.max(0, j - 1), u = j === a ? 0 : (t - r.times[a]) / (r.times[j] - r.times[a]);
    const v = r.values[a * 2 + 1] + (r.values[j * 2 + 1] - r.values[a * 2 + 1]) * u;
    assert.ok(Math.abs(v - values[i * 2 + 1]) <= 0.01 + 1e-9, `t=${t}`);
  }
  const still = reduceKeys([0, 0.5, 1], [1, 1, 1], 1, 0.001);
  assert.deepEqual(still.times, [0, 1], "a still track keeps two keys");
});

test("retarget: Name=file#Clip@start-end specs", () => {
  assert.deepEqual(parseSpec("Wave=a/b.glb#Waving@0.1-1.5"), { name: "Wave", path: "a/b.glb", wanted: "Waving", start: 0.1, end: 1.5 });
  assert.deepEqual(parseSpec("Idle=x.anims.json#Idle"), { name: "Idle", path: "x.anims.json", wanted: "Idle", start: 0, end: Infinity });
  assert.deepEqual(parseSpec("Run=r.glb@-0.7"), { name: "Run", path: "r.glb", wanted: undefined, start: 0, end: 0.7 });
  assert.throws(() => parseSpec("nope"));
});
