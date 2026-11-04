import { test } from "node:test";
import assert from "node:assert/strict";
import { QuestSystem } from "../server/quests.js";
import { QUESTS, giverById, CREW_MAX } from "../shared/quests-data.js";

// Helpers: a tiny world with players at positions we control.
function world(names = ["A", "B", "C", "D", "E"]) {
  const qs = new QuestSystem({ rng: () => 0.42 });
  const pos = new Map();
  for (const n of names) { qs.join(n, n); pos.set(n, { x: 0, z: 0 }); }
  let now = 0;
  const at = (id, p) => pos.set(id, { x: p.x, z: p.z });
  const tick = (dt = 0.05) => { now += dt; qs.tick(pos, now, dt); };
  const events = (id, type) => qs.drainEvents().filter((e) => (!id || e.to === id) && (!type || e.type === type));
  return { qs, pos, at, tick, events, now: () => now };
}
const near = (g) => ({ x: g.x + 1, z: g.z });

test("invite → accept forms a crew; decline notifies the inviter", () => {
  const w = world();
  w.qs.invite("A", "B", 0);
  assert.equal(w.events("B", "invite").length, 1);
  w.qs.respond("B", true, 1);
  const crew = w.qs.crews.get(w.qs.players.get("A").crewId);
  assert.deepEqual(crew.members, ["A", "B"]);
  assert.equal(w.qs.players.get("B").crewId, crew.id);

  w.qs.invite("A", "C", 2);
  w.qs.drainEvents();
  w.qs.respond("C", false, 3);
  assert.match(w.events("A", "toast")[0].text, /not right now/);
  assert.equal(w.qs.players.get("C").crewId, "");
});

test("invites expire, and crews cap at the max", () => {
  const w = world();
  w.qs.invite("A", "B", 0);
  w.qs.respond("B", true, 100);            // way past the 30s window
  assert.equal(w.qs.players.get("B").crewId, "");

  const w2 = world();
  for (const id of ["B", "C", "D"]) { w2.qs.invite("A", id, 0); w2.qs.respond(id, true, 1); }
  assert.equal(w2.qs.crews.get(w2.qs.players.get("A").crewId).members.length, CREW_MAX);
  w2.qs.drainEvents();
  w2.qs.invite("A", "E", 2);
  assert.match(w2.events("A", "toast")[0].text, /full/);
});

test("talking requires being close to the quest giver", () => {
  const w = world();
  const g = giverById("juniper");
  w.qs.talk("A", "juniper", { x: g.x + 20, z: g.z });
  assert.match(w.events("A", "toast")[0].text, /closer/);
  w.qs.talk("A", "juniper", near(g));
  const offer = w.events("A", "offer")[0];
  assert.equal(offer.questId, "lostfound");
  assert.equal(offer.blocked, "");
});

test("Lost & Found solo: pick up 3 pieces, return to Juniper, earn the Finder badge", () => {
  const w = world();
  const g = giverById("juniper");
  w.at("A", near(g));
  w.qs.startQuest("A", "juniper", w.pos, 0);
  const crew = w.qs.crews.get(w.qs.players.get("A").crewId);
  assert.equal(crew.quest.items.length, 3);
  assert.equal(crew.temp, true);

  // Going back early does nothing.
  w.tick();
  assert.ok(crew.quest);

  for (const item of [...crew.quest.items]) { w.at("A", item); w.tick(); }
  assert.equal(crew.quest.stage, "return");
  w.at("A", near(g)); w.tick();
  assert.equal(crew.quest, null);
  assert.ok(w.qs.players.get("A").badges.has("Finder"));
  assert.equal(w.qs.players.get("A").crewId, "", "temporary solo crew is cleaned up");
});

test("Lost & Found with a crew: any member's pickup counts for everyone", () => {
  const w = world();
  w.qs.invite("A", "B", 0); w.qs.respond("B", true, 0);
  const g = giverById("juniper");
  w.at("A", near(g));
  w.qs.startQuest("A", "juniper", w.pos, 0);
  const crew = w.qs.crews.get(w.qs.players.get("A").crewId);
  const [i1, i2, i3] = crew.quest.items;
  w.at("A", i1); w.at("B", i2); w.tick();
  w.at("B", i3); w.tick();
  w.at("B", near(g)); w.tick();
  assert.ok(w.qs.players.get("A").badges.has("Finder"));
  assert.ok(w.qs.players.get("B").badges.has("Finder"));
  assert.equal(w.qs.players.get("A").crewId, crew.id, "real crews stay together after a quest");
});

test("Soundcheck needs a crew of 2, and two different people on the markers for 3 seconds", () => {
  const w = world();
  const g = giverById("dex");
  const { main, side } = QUESTS.soundcheck.markers;
  w.at("A", near(g));
  w.qs.startQuest("A", "dex", w.pos, 0);
  assert.match(w.events("A", "toast")[0].text, /crew of at least 2/);
  assert.equal(w.qs.players.get("A").crewId, "", "no orphan crew left behind");

  w.qs.invite("A", "B", 0); w.qs.respond("B", true, 0);
  w.qs.startQuest("A", "dex", w.pos, 0);
  const crew = w.qs.crews.get(w.qs.players.get("A").crewId);
  assert.ok(crew.quest);

  // Only one person in place: never completes.
  w.at("A", main); w.at("B", { x: 30, z: 30 });
  for (let i = 0; i < 100; i++) w.tick();
  assert.ok(crew.quest);

  // Both in place, but B steps off after 2s: the hold resets.
  w.at("B", side);
  for (let i = 0; i < 40; i++) w.tick();
  w.at("B", { x: 30, z: 30 }); w.tick();
  assert.equal(crew.quest.hold, 0);

  w.at("B", side);
  for (let i = 0; i < 61; i++) w.tick();
  assert.equal(crew.quest, null);
  assert.ok(w.qs.players.get("B").badges.has("Sound Tech"));
});

test("Soundcheck stops if the crew drops below 2", () => {
  const w = world();
  w.qs.invite("A", "B", 0); w.qs.respond("B", true, 0);
  w.at("A", near(giverById("dex")));
  w.qs.startQuest("A", "dex", w.pos, 0);
  w.qs.drainEvents();
  w.qs.leaveCrew("B");
  const done = w.events("A", "questDone")[0];
  assert.equal(done.success, false);
});

test("Vendor Rush: carry one order at a time from the stand to the tents", () => {
  const w = world();
  const stand = giverById("rae");
  w.at("A", near(stand));
  w.qs.startQuest("A", "rae", w.pos, 0);
  const crew = w.qs.crews.get(w.qs.players.get("A").crewId);
  assert.equal(crew.quest.orders.length, QUESTS.vendorrush.ordersBase);

  w.tick();
  const carried = crew.quest.orders.filter((o) => o.state === "carried");
  assert.equal(carried.length, 1, "only one order at a time");
  w.tick();
  assert.equal(crew.quest.orders.filter((o) => o.state === "carried").length, 1);

  for (let i = 0; i < QUESTS.vendorrush.ordersBase; i++) {
    const o = crew.quest.orders.find((x) => x.carrier === "A");
    w.at("A", o); w.tick();
    if (crew.quest) { w.at("A", near(stand)); w.tick(); }
  }
  assert.equal(crew.quest, null);
  assert.ok(w.qs.players.get("A").badges.has("Runner"));
});

test("Vendor Rush: crews get more orders, and running out of time fails the quest", () => {
  const w = world();
  w.qs.invite("A", "B", 0); w.qs.respond("B", true, 0);
  w.at("A", near(giverById("rae")));
  w.qs.startQuest("A", "rae", w.pos, 0);
  const crew = w.qs.crews.get(w.qs.players.get("A").crewId);
  assert.equal(crew.quest.orders.length, QUESTS.vendorrush.ordersBase + 1);
  w.qs.drainEvents();
  w.at("A", { x: 0, z: 0 });
  w.tick(QUESTS.vendorrush.timeLimit + 1);
  assert.equal(crew.quest, null);
  const done = w.events("A", "questDone")[0];
  assert.equal(done.success, false);
  assert.match(done.text, /Time's up/);
});

test("can't start a second quest while one is running; leaving mid-quest is clean", () => {
  const w = world();
  w.at("A", near(giverById("juniper")));
  w.qs.startQuest("A", "juniper", w.pos, 0);
  w.at("A", near(giverById("rae")));
  w.qs.drainEvents();
  w.qs.startQuest("A", "rae", w.pos, 0);
  assert.match(w.events("A", "toast")[0].text, /already on/);
  w.qs.leave("A");
  assert.equal(w.qs.crews.size, 0);
});

test("publicQuest gives the browser what it needs to draw", () => {
  const w = world();
  w.at("A", near(giverById("juniper")));
  w.qs.startQuest("A", "juniper", w.pos, 0);
  const crew = w.qs.crews.get(w.qs.players.get("A").crewId);
  const pub = JSON.parse(w.qs.publicQuest(crew));
  assert.equal(pub.id, "lostfound");
  assert.equal(pub.items.length, 3);
});

test("premium looks are locked unless the server unlocks them", async () => {
  const { resolveLook, canUseLook } = await import("../server/entitlements.js");
  const { CHARACTERS, DEFAULT_LOOK } = await import("../shared/characters.js");
  const free = CHARACTERS.find((c) => c.tier === "free");
  const premium = CHARACTERS.find((c) => c.tier === "premium");
  assert.equal(resolveLook("p1", free.id), free.id);
  assert.equal(resolveLook("p1", "not-a-real-look"), DEFAULT_LOOK);
  if (premium && process.env.FV_UNLOCK_ALL !== "1") {
    assert.equal(canUseLook("p1", premium.id), false);
    assert.equal(resolveLook("p1", premium.id), DEFAULT_LOOK);
  }
});
