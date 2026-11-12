import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DjStore } from "../server/dj.js";
import { parseMixLink, stageVolume, loudest, cleanRules, cleanPageLink, DJ_RULE_DEFAULTS, DJ_TERMS, STAGE_AUDIO } from "../shared/dj.js";
import { defaultLayout, sanitizeLayout, GENRES, genreName } from "../shared/layout.js";

const ITEMS = defaultLayout().items;
const STAGES = ITEMS.filter((i) => i.type === "stage");
const MAIN = STAGES.find((s) => s.id === "stage_main");
const MIX = "https://soundcloud.com/dj-nova/sunrise-set";
const MIN = 60_000;

function temp(rules = { signup: "open" }) {
  const dir = mkdtempSync(join(tmpdir(), "fv-dj-"));
  let t = Date.UTC(2026, 10, 11, 20);
  const store = new DjStore({ dir, now: () => t });
  store.setRules(rules);
  return { dir, store, tick: (ms) => (t += ms), now: () => t, done: () => rmSync(dir, { recursive: true, force: true }) };
}
const nova = { id: "a_nova", name: "Nova" }, rex = { id: "a_rex", name: "Rex" }, mod = { id: "a_mod", name: "Staffer" };
const signup = (store, a, extra = {}) => store.signup(a, { name: `DJ ${a.name}`, link: `https://soundcloud.com/${a.name.toLowerCase()}`, own: true, ...extra });
const edm = (extra = {}) => ({ stage: MAIN.id, title: "Sunrise Set", url: MIX, genre: "edm", ...extra });

// ---------- Stages have a genre (layout data) ----------
test("every stage has a genre, as data on the stage, and the four genres each have one", () => {
  assert.deepEqual(GENRES.map((g) => g.id), ["edm", "hiphop", "rock", "roots"]);
  assert.equal(STAGES.length, 4);
  assert.deepEqual(STAGES.map((s) => s.genre).sort(), ["edm", "hiphop", "rock", "roots"]);
  assert.equal(genreName(MAIN.genre), "EDM");
  // It's editable like any other field: the builder's save keeps a valid genre and drops a made-up one.
  const edited = sanitizeLayout({ items: [{ type: "stage", x: 0, z: 0, genre: "rock" }, { type: "stage", x: 50, z: 0, genre: "polka" }, { type: "stage", x: 90, z: 0 }] }).layout.items;
  assert.deepEqual(edited.map((s) => s.genre), ["rock", "", ""]);
  assert.equal(genreName(""), "Open stage");
});

// ---------- Links, not uploads ----------
test("mix links: only SoundCloud, Mixcloud and YouTube, only https, tidied up", () => {
  assert.deepEqual(parseMixLink("https://soundcloud.com/dj-nova/sunrise-set?si=abc&utm_source=x"), { provider: "soundcloud", url: MIX });
  assert.deepEqual(parseMixLink("https://m.soundcloud.com/dj-nova/sets/live-2026/"), { provider: "soundcloud", url: "https://soundcloud.com/dj-nova/sets/live-2026" });
  assert.deepEqual(parseMixLink("https://www.mixcloud.com/nova/deep-forest-mix/"), { provider: "mixcloud", url: "https://www.mixcloud.com/nova/deep-forest-mix/", id: "/nova/deep-forest-mix/" });
  const yt = { provider: "youtube", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", id: "dQw4w9WgXcQ" };
  assert.deepEqual(parseMixLink("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30s&list=PL1"), yt);
  assert.deepEqual(parseMixLink("https://youtu.be/dQw4w9WgXcQ?si=zz"), yt);
  assert.deepEqual(parseMixLink("https://music.youtube.com/watch?v=dQw4w9WgXcQ"), yt);
  assert.deepEqual(parseMixLink("https://www.youtube.com/live/dQw4w9WgXcQ"), yt);
  for (const bad of [
    "", null, 42, "not a link", "http://soundcloud.com/dj-nova/sunrise-set", "javascript:alert(1)", "https://evil.example/soundcloud.com/a/b",
    "https://soundcloud.com.evil.example/a/b", "https://soundcloud.com/dj-nova", "https://soundcloud.com/discover/sets", "https://on.soundcloud.com/AbCd",
    "https://www.youtube.com/@somechannel", "https://www.youtube.com/playlist?list=PL1", "https://youtu.be/short", "https://user:pw@soundcloud.com/a/b",
    "https://spotify.com/track/1", "https://festiville.example/uploads/mix.mp3", "https://soundcloud.com/a/" + "b".repeat(300),
  ]) assert.ok(parseMixLink(bad).error, `rejected: ${bad}`);
  assert.equal(cleanPageLink("https://linktr.ee/djnova"), "https://linktr.ee/djnova");
  for (const bad of ["http://x.com", "javascript:alert(1)", "https://localhost", "", null]) assert.equal(cleanPageLink(bad), "");
});

// ---------- Loud at the stage, quiet at the Campground ----------
test("stage volume: full at the stage, fading with distance, silent at the Campground", () => {
  assert.equal(stageVolume(0), 1);
  assert.equal(stageVolume(STAGE_AUDIO.main.near), 1);
  let last = 1;
  for (let d = 20; d <= 150; d += 10) { const v = stageVolume(d); assert.ok(v < last && v >= 0, `quieter at ${d} m`); last = v; }
  assert.equal(stageVolume(STAGE_AUDIO.main.far), 0);
  assert.ok(stageVolume(60, "side") < stageVolume(60, "main"), "small stages don't carry as far");
  // Walk from the main stage to the Campground (across the river): it fades all the way out.
  const camp = ITEMS.find((i) => i.id === "camp");
  const at = (x, z) => stageVolume(Math.hypot(x - MAIN.x, z - MAIN.z), MAIN.variant);
  assert.equal(at(MAIN.x, MAIN.z + 12), 1);
  assert.ok(at(0, -50) < 0.7 && at(0, -50) > 0.2);
  assert.ok(at(0, 20) < 0.05);
  assert.equal(at(camp.x, camp.z), 0);
  // With two stages playing you hear the louder one.
  const sets = STAGES.map((s) => ({ stage: s, id: s.id }));
  assert.equal(loudest({ x: 150, z: -20 }, sets).set.id, "stage_east");
  assert.equal(loudest({ x: 0, z: -90 }, sets).set.id, "stage_main");
  assert.equal(loudest({ x: camp.x, z: camp.z }, sets), null);
});

// ---------- The acceptance path ----------
test("a DJ signs up, links a mix to the main stage, and it's what the stage plays", () => {
  const { dir, store, done } = temp();
  try {
    assert.equal(store.public(STAGES).stages.find((s) => s.id === MAIN.id).playing, null);
    // Signing up means confirming it's your own music, with a link to your own page.
    assert.match(DJ_TERMS, /your own/);
    assert.match(store.signup(nova, { name: "DJ Nova", link: "https://soundcloud.com/dj-nova" }).error, /your own music/);
    assert.match(store.signup(nova, { name: "DJ Nova", link: "ftp://x", own: true }).error, /your own page/);
    assert.match(store.link(nova, edm(), { stages: STAGES }).error, /Sign up as a DJ/);
    assert.ok(signup(store, nova, { name: "DJ Nova", link: "https://soundcloud.com/dj-nova" }).ok);

    const out = store.link(nova, edm(), { stages: STAGES });
    assert.ok(out.ok, out.error);
    assert.match(out.text, /on Main Stage now/);
    const stage = store.public(STAGES).stages.find((s) => s.id === MAIN.id);
    assert.equal(stage.genre, "edm");
    assert.deepEqual(stage.playing.dj, { name: "DJ Nova", link: "https://soundcloud.com/dj-nova" });   // name + their own page
    assert.equal(stage.playing.title, "Sunrise Set");
    assert.equal(stage.playing.url, MIX);
    assert.equal(stage.playing.provider, "soundcloud");
    // Only the link is saved: no audio on the server.
    const saved = JSON.parse(readFileSync(join(dir, "dj.json"), "utf8"));
    assert.deepEqual(Object.keys(saved).sort(), ["djs", "log", "rules", "sets"]);
    assert.equal(saved.sets[0].url, MIX);
    // And a fresh server process sees the same thing: it's data, not code.
    assert.equal(new DjStore({ dir, now: () => Date.UTC(2026, 10, 11, 20, 5) }).current(MAIN.id).title, "Sunrise Set");
  } finally { done(); }
});

test("a mix has to match the stage's genre", () => {
  const { store, done } = temp();
  try {
    signup(store, nova);
    const wrong = store.link(nova, edm({ genre: "rock" }), { stages: STAGES });
    assert.match(wrong.error, /Main Stage plays EDM, and your mix is Rock \/ Alternative\. Try Garage Stage\./);
    assert.match(store.link(nova, edm({ genre: "" }), { stages: STAGES }).error, /genre of your mix/);
    assert.ok(store.link(nova, edm({ stage: "stage_rock", genre: "rock" }), { stages: STAGES }).ok);
    // An open stage (no genre set in the builder) takes any genre.
    signup(store, rex);
    const open = [{ id: "s1", label: "Open Mic", genre: "" }];
    assert.ok(store.link(rex, { stage: "s1", title: "Anything", url: MIX, genre: "roots" }, { stages: open }).ok);
    assert.match(store.link(rex, edm({ stage: "nowhere" }), { stages: STAGES }).error, /Pick a stage/);
  } finally { done(); }
});

test("moderation: staff can stop a set and remove a DJ, and there's a record of who linked what", () => {
  const { store, tick, done } = temp();
  try {
    signup(store, nova); signup(store, rex);
    store.link(nova, edm(), { stages: STAGES });
    store.link(rex, edm({ title: "Second Set", url: "https://youtu.be/dQw4w9WgXcQ" }), { stages: STAGES });
    tick(10 * MIN);

    // Stop what's playing on the main stage: it goes quiet for that DJ and the next set moves up.
    const stopped = store.stop(MAIN.id, mod.name, "not their own music");
    assert.ok(stopped.ok);
    assert.equal(stopped.set.djName, "DJ Nova");
    assert.equal(store.current(MAIN.id).djName, "DJ Rex", "the queued set starts instead of leaving the stage silent");
    assert.match(store.stop("stage_rock", mod.name).error, /Nothing to stop/);

    // Remove a DJ: their sets stop and they can't link again until restored.
    const removed = store.removeDj(rex.id, mod.name, "spam");
    assert.equal(removed.stopped, 1);
    assert.equal(store.current(MAIN.id), null);
    assert.match(store.link(rex, edm(), { stages: STAGES }).error, /removed you as a DJ/);
    assert.match(signup(store, rex).error, /removed you as a DJ/);
    assert.ok(store.restoreDj(rex.id, mod.name).ok);
    assert.ok(store.link(rex, edm(), { stages: STAGES }).ok);

    // The record: who linked what, and what staff did about it.
    const log = store.log.map((l) => [l.by, l.action, l.url ?? "", l.reason ?? ""]);
    assert.ok(log.some(([by, action, url]) => by === "Nova" && action === "link" && url === MIX));
    assert.ok(log.some(([by, action, url]) => by === "Rex" && action === "link" && url === "https://www.youtube.com/watch?v=dQw4w9WgXcQ"));
    assert.ok(log.some(([by, action, url, why]) => by === "Staffer" && action === "stop" && url === MIX && why === "not their own music"));
    assert.ok(log.some(([by, action, , why]) => by === "Staffer" && action === "remove" && why === "spam"));
    assert.equal(store.logFor(nova.id).filter((l) => l.action === "link").length, 1);
    assert.ok(store.staffView().djs.some((d) => d.name === "DJ Rex" && d.account === "Rex"));
  } finally { done(); }
});

// ---------- The decisions that aren't made yet are settings ----------
test("who can DJ is a setting: approved DJs only, or any member", () => {
  const { store, done } = temp({ signup: "approved" });
  try {
    assert.equal(signup(store, nova).approved, false);
    assert.match(store.link(nova, edm(), { stages: STAGES }).error, /staff approve DJs/);
    assert.equal(store.mine(nova.id).canLink, false);
    assert.ok(store.link(nova, edm(), { stages: STAGES, staff: true }).ok, "festival staff can always put a set on");
    store.end(nova, store.mine(nova.id).sets[0].id);
    assert.ok(store.approveDj(nova.id, mod.name).ok);
    assert.ok(store.link(nova, edm(), { stages: STAGES }).ok);
    // Flip the setting: anyone who signs up can play.
    store.setRules({ signup: "open" });
    signup(store, rex);
    assert.ok(store.link(rex, edm({ stage: "stage_rock", genre: "rock" }), { stages: STAGES }).ok);
  } finally { done(); }
});

test("set length and first-come order: sets queue up and take turns; one set per DJ at a time", () => {
  const { store, tick, now, done } = temp({ signup: "open", order: "first-come", setMinutes: 30 });
  try {
    signup(store, nova); signup(store, rex);
    const a = store.link(nova, edm(), { stages: STAGES });
    assert.equal(a.set.endsAt - a.set.startsAt, 30 * MIN);
    assert.match(store.link(nova, edm({ title: "Again" }), { stages: STAGES }).error, /already have a set/);
    const b = store.link(rex, edm({ title: "Second Set" }), { stages: STAGES });
    assert.match(b.text, /queue for Main Stage: about 30 min/);
    assert.equal(b.set.startsAt, a.set.endsAt);
    assert.deepEqual(store.public(STAGES).stages.find((s) => s.id === MAIN.id).next.map((s) => s.title), ["Second Set"]);
    const key = store.playingKey(STAGES);
    tick(31 * MIN);
    assert.equal(store.current(MAIN.id).djName, "DJ Rex");
    assert.notEqual(store.playingKey(STAGES), key, "the room is told when the stage changes over");
    tick(30 * MIN);
    assert.equal(store.current(MAIN.id), null);
    assert.ok(store.link(nova, edm(), { stages: STAGES }).ok, "and when your set is over you can go again");
    // A DJ can end their own set early; the stage frees up.
    assert.ok(store.end(nova, store.mine(nova.id).sets[0].id).ok);
    assert.equal(store.current(MAIN.id, now()), null);
    // No set length (0): plays until the DJ or staff end it, and nobody can queue behind it.
    store.setRules({ setMinutes: 0 });
    assert.equal(store.link(nova, edm(), { stages: STAGES }).set.endsAt, 0);
    tick(600 * MIN);
    assert.equal(store.current(MAIN.id).djName, "DJ Nova");
    assert.match(store.link(rex, edm(), { stages: STAGES }).error, /no end time/);
  } finally { done(); }
});

test("order is a setting too: DJs pick a free time (schedule), or staff put mixes on (organizer)", () => {
  const { store, tick, now, done } = temp({ signup: "open", order: "schedule", setMinutes: 60 });
  try {
    signup(store, nova); signup(store, rex);
    const at9 = now() + 60 * MIN;
    assert.match(store.link(nova, edm(), { stages: STAGES }).error, /start time/);
    assert.match(store.link(nova, edm({ startsAt: now() - 3 * 60 * MIN }), { stages: STAGES }).error, /still to come/);
    assert.match(store.link(nova, edm({ startsAt: now() + 30 * 86400_000 }), { stages: STAGES }).error, /14 days ahead/);
    assert.ok(store.link(nova, edm({ startsAt: at9 }), { stages: STAGES }).ok);
    assert.equal(store.current(MAIN.id), null, "booked for later, not playing yet");
    assert.match(store.link(rex, edm({ startsAt: at9 + 30 * MIN }), { stages: STAGES }).error, /taken then \(DJ Nova\)/);
    assert.ok(store.link(rex, edm({ startsAt: at9 + 60 * MIN }), { stages: STAGES }).ok);
    tick(61 * MIN);
    assert.equal(store.current(MAIN.id).djName, "DJ Nova");
  } finally { done(); }

  const o = temp({ signup: "open", order: "organizer", setMinutes: 45 });
  try {
    signup(o.store, nova);
    const out = o.store.link(nova, edm(), { stages: STAGES });
    assert.equal(out.set.status, "pending");
    assert.match(out.text, /waiting for festival staff/);
    assert.equal(o.store.current(MAIN.id), null);
    assert.equal(o.store.staffView().pending.length, 1);
    assert.ok(o.store.approveSet(out.set.id, mod.name).ok);
    assert.equal(o.store.current(MAIN.id).djName, "DJ Nova");
    assert.equal(o.store.current(MAIN.id).endsAt - o.store.current(MAIN.id).startsAt, 45 * MIN);
    assert.match(o.store.approveSet(out.set.id, mod.name).error, /isn't waiting/);
  } finally { o.done(); }
});

test("rules are cleaned: unknown values fall back, and a fresh server starts from the defaults", () => {
  assert.deepEqual(cleanRules({}), DJ_RULE_DEFAULTS);
  assert.deepEqual(cleanRules({ signup: "everyone", order: "chaos", setMinutes: -5 }), DJ_RULE_DEFAULTS);
  assert.deepEqual(cleanRules({ signup: "open", order: "schedule", setMinutes: 9999 }), { signup: "open", order: "schedule", setMinutes: 240 });
});
