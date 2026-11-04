import { test } from "node:test";
import assert from "node:assert/strict";
import { ChatSystem, CHAT, clean } from "../server/chat.js";

const positions = new Map([
  ["a", { x: 0, z: 0 }],
  ["b", { x: 10, z: 0 }],                 // close to a
  ["c", { x: CHAT.nearRange + 5, z: 0 }], // too far from a to hear
]);
const crews = { a: ["a", "c"], c: ["a", "c"], b: [] };
const ctx = (now) => ({ now, positions, crewOf: (id) => crews[id] ?? [] });

test("nearby chat reaches people within range, including the sender", () => {
  const out = new ChatSystem().send("a", { text: "hey!", channel: "near" }, ctx(0));
  assert.deepEqual(out.to.sort(), ["a", "b"]);
  assert.equal(out.channel, "near");
});

test("crew chat reaches the whole crew wherever they are, and needs a crew", () => {
  const chat = new ChatSystem();
  assert.deepEqual(chat.send("a", { text: "meet at the side stage", channel: "crew" }, ctx(0)).to, ["a", "c"]);
  assert.match(chat.send("b", { text: "hello?", channel: "crew" }, ctx(0)).error, /not in a crew/);
});

test("messages are cleaned: trimmed, one line, capped; empty ones are ignored", () => {
  assert.equal(clean("  hi\n\tthere  "), "hi there");
  assert.equal(clean("x".repeat(500)).length, CHAT.maxLength);
  assert.equal(clean("a‮b"), "a b");               // no sneaky right-to-left tricks
  assert.equal(new ChatSystem().send("a", { text: "   " }, ctx(0)), null);
  assert.equal(new ChatSystem().send("a", { text: 42 }, ctx(0)), null);
  assert.equal(new ChatSystem().send("a", { text: "hi", channel: "shout" }, ctx(0)).channel, "near");   // unknown channel -> nearby
});

test("rate limits: a short gap between messages, and a cap per window", () => {
  const chat = new ChatSystem();
  assert.ok(chat.send("a", { text: "1" }, ctx(0)).to);
  assert.match(chat.send("a", { text: "2" }, ctx(0.1)).error, /Slow down/);
  let t = 0;
  for (let i = 1; i < CHAT.burst; i++) assert.ok(chat.send("a", { text: "m" }, ctx((t += 1))).to);
  assert.match(chat.send("a", { text: "one too many" }, ctx((t += 1))).error, /too fast/);
  assert.ok(chat.send("a", { text: "later" }, ctx(t + CHAT.window)).to);          // window has passed
  assert.ok(chat.send("b", { text: "others unaffected" }, ctx(t)).to);
});

test("blocked words are masked", () => {
  const chat = new ChatSystem({ blocked: ["badword"] });
  assert.equal(chat.send("a", { text: "you BADWORD, not badwords" }, ctx(0)).text, "you *******, not badwords");
});
