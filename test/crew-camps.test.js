import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CampStore, MAX_MATES } from "../server/camps.js";
import { defaultLayout } from "../shared/layout.js";

const LAYOUT_ITEMS = defaultLayout().items;
const ALL = ["tent_basic", "tent_bell", "chairs", "cooler", "firepit", "canopy", "hammock", "pa", "lights", "flag", "neon", "lasers", "discoball"];

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "fv-crew-"));
  const camps = new CampStore({ dir, layoutItems: () => LAYOUT_ITEMS });
  // Rook owns a 10×20 camp with a tent and chairs.
  assert.ok(camps.place("rook", "Rook", { x: -24, z: 52, plot: "plot_10x20", items: ["tent_basic", "chairs"] }, ["tent_basic", "chairs"]).camp);
  return { dir, camps, done: () => rmSync(dir, { recursive: true, force: true }) };
}

test("sharing adds the crew as campmates; they show by name, not account id", () => {
  const { camps, done } = setup();
  try {
    const out = camps.share("rook", [{ id: "ash", name: "Ash" }, { id: "rook", name: "Rook" }, { id: "zoe", name: "Zoe" }]);
    assert.deepEqual(out, { added: ["Ash", "Zoe"], skipped: [] });
    const pub = camps.public("rook");
    assert.deepEqual(pub.mates, ["Ash", "Zoe"]);
    assert.equal(camps.mateOf("ash"), "rook");
    assert.equal(camps.mateOf("rook"), null);
    assert.ok(!JSON.stringify(pub).includes('"ash"'), "no account ids in public data");
    assert.deepEqual(camps.share("rook", [{ id: "ash", name: "Ash" }]), { added: [], skipped: [] });   // already in
  } finally { done(); }
});

test("a crew camp holds a whole crew, and you're in one crew camp at a time", () => {
  const { camps, done } = setup();
  try {
    assert.ok(camps.place("pal", "Pal", { x: 0, z: 52, plot: "plot_10x10" }, ["tent_basic"]).camp);
    camps.share("pal", [{ id: "zoe", name: "Zoe" }]);
    const people = ["a", "b", "c", "d", "zoe"].map((id) => ({ id, name: id.toUpperCase() }));
    const out = camps.share("rook", people);
    assert.equal(out.added.length, MAX_MATES);
    assert.ok(out.skipped.some((r) => /ZOE is already part of Pal's camp/.test(r)), out.skipped.join());
    assert.ok(out.skipped.some((r) => /holds/.test(r)), out.skipped.join());
  } finally { done(); }
});

test("campmates set up things they own; each item remembers who brought it", () => {
  const { camps, done } = setup();
  try {
    camps.share("rook", [{ id: "ash", name: "Ash" }]);
    assert.match(camps.setItem("rook", "ash", "pa", true, ["tent_basic"]).error, /don't own/);
    assert.match(camps.setItem("rook", "stranger", "pa", true, ALL).error, /not part of/);
    const out = camps.setItem("rook", "ash", "pa", true, ["tent_basic", "pa"]);
    assert.ok(out.camp, out.error);
    assert.equal(out.camp.by.pa, "Ash");
    assert.equal(out.camp.by.chairs, "Rook");
    // Someone else's item, or a second tent, is refused.
    assert.match(camps.setItem("rook", "ash", "chairs", true, ALL).error, /Rook already set up their Camp chairs/);
    assert.match(camps.setItem("rook", "ash", "tent_bell", true, ALL).error, /already a dome tent here \(Rook's\)/);
  } finally { done(); }
});

test("you pack away your own things; the owner can pack away anything", () => {
  const { camps, done } = setup();
  try {
    camps.share("rook", [{ id: "ash", name: "Ash" }, { id: "zoe", name: "Zoe" }]);
    camps.setItem("rook", "ash", "pa", true, ["pa"]);
    assert.match(camps.setItem("rook", "zoe", "pa", false, ALL).error, /Only Ash or Rook/);
    assert.equal(camps.setItem("rook", "ash", "chairs", false, ALL).error, "Only Rook can pack that away.");
    assert.ok(camps.setItem("rook", "ash", "pa", false, ["pa"]).camp);
    camps.setItem("rook", "ash", "pa", true, ["pa"]);
    assert.ok(!camps.setItem("rook", "rook", "pa", false, []).camp.items.includes("pa"));   // owner tidies up
  } finally { done(); }
});

test("ground space is shared", () => {
  const { camps, done } = setup();
  try {
    camps.share("rook", [{ id: "ash", name: "Ash" }]);
    // A 10×20 spot has 6 ground slots besides the tent; Rook's chairs use one.
    for (const i of ["cooler", "firepit", "canopy", "hammock", "pa"]) assert.ok(camps.setItem("rook", "ash", i, true, ALL).camp, i);
    assert.match(camps.setItem("rook", "ash", "chairs", true, ALL).error, /Rook already/);
    assert.ok(camps.place("zed", "Zed", { x: 0, z: 52, plot: "plot_10x10" }, ["tent_basic"]).camp);
    camps.share("zed", [{ id: "yan", name: "Yan" }]);
    camps.setItem("zed", "yan", "chairs", true, ALL);
    camps.setItem("zed", "yan", "cooler", true, ALL);
    assert.match(camps.setItem("zed", "yan", "firepit", true, ALL).error, /No ground space/);
    assert.ok(camps.setItem("zed", "yan", "lights", true, ALL).camp, "edge items don't need ground space");
  } finally { done(); }
});

test("moving or upgrading keeps campmates' things; removing a campmate takes their things away", () => {
  const { dir, camps, done } = setup();
  try {
    camps.share("rook", [{ id: "ash", name: "Ash" }]);
    camps.setItem("rook", "ash", "pa", true, ["pa"]);
    // Rook moves (only owns tent + chairs): Ash's PA comes along.
    const moved = camps.place("rook", "Rook", { x: -24, z: 53, plot: "plot_10x20", items: camps.of("rook").items }, ["tent_basic", "chairs"]);
    assert.ok(moved.camp.items.includes("pa"), moved.error);
    assert.equal(moved.camp.by.pa, "Ash");
    // Saved and read back by a fresh store.
    const again = new CampStore({ dir, layoutItems: () => LAYOUT_ITEMS });
    assert.deepEqual(again.public("rook").mates, ["Ash"]);
    assert.equal(again.public("rook").by.pa, "Ash");
    // Owner's setItems (replace their own things) leaves Ash's PA alone.
    assert.ok(camps.setItems("rook", ["tent_basic"], ["tent_basic", "chairs"]).camp.items.includes("pa"));
    assert.deepEqual(camps.unshare("rook", "ash"), { id: "ash", name: "Ash" });
    assert.ok(!camps.public("rook").items.includes("pa"));
    assert.deepEqual(camps.public("rook").mates, []);
    assert.match(camps.unshare("rook", "Ash").error, /not in your crew camp/);
  } finally { done(); }
});

test("a campmate can leave; names stay current; music is the owner's (or the PA's owner's) choice", () => {
  const { camps, done } = setup();
  try {
    camps.share("rook", [{ id: "ash", name: "Ash" }, { id: "zoe", name: "Zoe" }]);
    camps.setItem("rook", "ash", "pa", true, ["pa"]);
    assert.match(camps.setMusic("rook", "chill", "zoe").error, /Only Rook or whoever brought the PA/);
    assert.equal(camps.setMusic("rook", "chill", "ash").camp.music, "chill");
    assert.equal(camps.setMusic("rook", "reggae").camp.music, "reggae");
    camps.rename("ash", "AshNew");
    assert.deepEqual(camps.public("rook").mates, ["AshNew", "Zoe"]);
    assert.equal(camps.public("rook").by.pa, "AshNew");
    assert.deepEqual(camps.leave("ash"), { ownerId: "rook", id: "ash", name: "AshNew" });
    assert.match(camps.leave("ash").error, /not in a crew camp/);
    assert.deepEqual(camps.public("rook").mates, ["Zoe"]);
    assert.ok(!camps.public("rook").items.includes("pa"));
  } finally { done(); }
});
