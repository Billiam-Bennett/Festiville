import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import {
  BODIES, PARTS, PART_SLOTS, SKIN_TONES, SHAPE_KINDS, BUILDS, FACES, HEIGHTS, partById, partsFor, defaultPart, partModel,
  bodyModel, shapeMorphs, heightScale,
  normalizeRecipe, parseRecipe, formatRecipe, randomRecipe, seededRandom, recipePartIds, MAX_RECIPE_LENGTH,
} from "../shared/parts.js";
import { CHARACTERS } from "../shared/characters.js";
import { ACCESSORIES } from "../shared/accessories.js";
import { GIVERS, AMBIENT } from "../shared/quests-data.js";
import { canUsePart, resolveRecipe, resolveAppearance } from "../server/entitlements.js";

const LOCKED = process.env.FV_UNLOCK_ALL !== "1";

// ---------- Catalog ----------
test("catalog: every part has a known slot, bodies and tier; ids are unique and file-safe", () => {
  const ids = new Set();
  for (const p of PARTS) {
    assert.ok(PART_SLOTS.some((s) => s.id === p.slot), `${p.id} slot`);
    assert.ok(p.tier === "free" || p.tier === "premium", `${p.id} tier`);
    assert.ok(p.bodies.length && p.bodies.every((b) => BODIES.some((x) => x.id === b)), `${p.id} bodies`);
    assert.match(p.id, /^[a-z0-9_-]{1,32}$/);
    assert.ok(!ids.has(p.id), `duplicate ${p.id}`);
    ids.add(p.id);
  }
  // Unlocks are one list per account, so part ids must not collide with characters or accessories.
  for (const other of [...CHARACTERS, ...ACCESSORIES]) assert.ok(!ids.has(other.id), `${other.id} is both a part and a character/accessory`);
  assert.deepEqual(BODIES.map((b) => b.id), ["female", "male"]);
});

test("catalog: every required slot has a free default for every body", () => {
  for (const b of BODIES) for (const s of PART_SLOTS.filter((s) => s.required)) {
    const d = defaultPart(b.id, s.id);
    assert.ok(d && d.tier === "free" && d.bodies.includes(b.id), `${b.id}/${s.id}`);
  }
  for (const s of PART_SLOTS) assert.ok(s.colors.length > 0, `${s.id} colors`);
});

test("catalog: the accessory slot is optional and every body has accessories", () => {
  const slot = PART_SLOTS.find((s) => s.id === "accessory");
  assert.ok(slot && !slot.required);
  for (const b of BODIES) assert.ok(partsFor(b.id, "accessory").length >= 5, b.id);
  // Tops were the thinnest slot.
  for (const b of BODIES) assert.ok(partsFor(b.id, "top").length >= 13, b.id);
});

test("catalog: shapes have a default first, unique ids, and sane heights", () => {
  assert.deepEqual(SHAPE_KINDS.map((k) => k.id), ["build", "face", "height"]);
  for (const k of SHAPE_KINDS) {
    const ids = k.options.map((o) => o.id);
    assert.equal(new Set(ids).size, ids.length, k.id);
    for (const id of ids) assert.match(id, /^[a-z0-9_-]{1,16}$/);
    assert.ok(!PART_SLOTS.some((s) => s.id === k.id), `${k.id} is also a slot`);
  }
  assert.equal(HEIGHTS[0].scale, 1);
  for (const h of HEIGHTS) assert.ok(h.scale > 0.85 && h.scale < 1.15, h.id);
});

// ---------- Asset contract (the files the catalog points at) ----------
const ASSETS = new URL("../client/assets/", import.meta.url);
const glbJson = (path) => {
  const b = readFileSync(new URL(path, ASSETS));
  return JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString("utf8"));
};
const MANIFEST = JSON.parse(readFileSync(new URL("parts/manifest.json", ASSETS), "utf8"));
const HIDE_SLOTS = ["top", "bottom", "shoes", "accessory"];   // client/avatar.js, scripts/make-parts.py

test("assets: every catalog part has its file and a manifest entry in the right slot", () => {
  for (const p of PARTS) for (const b of p.bodies) {
    const path = partModel(b, p.id);
    assert.ok(existsSync(new URL(path, ASSETS)), `${p.id}: ${path} is missing`);
    const entry = MANIFEST.bodies[b].parts[path.split("/").pop().replace(/\.glb$/, "")];
    assert.ok(entry, `${p.id}: no manifest entry for ${path}`);
    assert.equal(entry.slot, p.slot, `${p.id}: manifest slot`);
    if (HIDE_SLOTS.includes(p.slot)) assert.ok(Number.isInteger(entry.hideBit) && entry.hideBit >= 0 && entry.hideBit < 24, `${p.id}: hide bit`);
  }
  // Hide bits are unique within a slot (each bit means one part).
  for (const b of BODIES) for (const slot of HIDE_SLOTS) {
    const bits = Object.values(MANIFEST.bodies[b.id].parts).filter((e) => e.slot === slot).map((e) => e.hideBit);
    assert.equal(new Set(bits).size, bits.length, `${b.id}/${slot} hide bits`);
  }
});

test("assets: each body.glb has hide masks for every clothing slot and a morph target for every shape", () => {
  for (const b of BODIES) {
    const j = glbJson(bodyModel(b.id));
    const skin = j.meshes.find((m) => "_HIDE_TOP" in m.primitives[0].attributes);
    assert.ok(skin, `${b.id}: no hide masks`);
    for (const slot of HIDE_SLOTS) assert.ok(`_HIDE_${slot.toUpperCase()}` in skin.primitives[0].attributes, `${b.id}: _hide_${slot}`);
    const names = skin.extras?.targetNames ?? [];
    for (const k of SHAPE_KINDS.filter((k) => k.morph)) for (const o of k.options.slice(1)) {
      assert.ok(names.includes(k.morph + o.id), `${b.id}: body.glb has no morph target ${k.morph}${o.id}`);
    }
    assert.ok(j.extensionsUsed?.includes("KHR_mesh_quantization"));
    for (const m of j.meshes) for (const p of m.primitives) {
      assert.equal(p.targets?.length ?? 0, names.length, `${b.id}/${m.name}: every mesh has the same targets`);
    }
  }
});

// ---------- Recipes ----------
const FULL = "female;3;hair=hair_bob:4;eyebrows=brows_soft:1;top=top_tank:2;bottom=bottom_shorts:8;shoes=shoes_sneakers:0";

test("normalize: a canonical recipe comes back unchanged", () => {
  assert.equal(normalizeRecipe(FULL), FULL);
  assert.equal(normalizeRecipe(normalizeRecipe(FULL)), FULL);
  assert.equal(formatRecipe(parseRecipe(FULL)), FULL);
});

test("normalize: slot order is fixed, duplicates and unknowns are dropped", () => {
  assert.equal(
    normalizeRecipe("female;3;shoes=shoes_boots:1;top=top_tee:2;top=top_tank:5;bogus=x:1;hair=nope:2;bottom=bottom_pants:0"),
    "female;3;top=top_tee:2;bottom=bottom_pants:0;shoes=shoes_boots:1",
  );
});

test("normalize: wrong slot, wrong body and bad colors are cleaned", () => {
  // top_tee in the hair slot is ignored; the tube top doesn't fit the male body -> default top; colors out of range -> 0.
  assert.equal(normalizeRecipe("male;99;hair=top_tee:1;top=top_crop:3;bottom=bottom_skirt:99"), "male;0;top=top_tee:0;bottom=bottom_skirt:0");
  assert.equal(normalizeRecipe("male;-1;top=top_tank:1.5;bottom=bottom_pants:x"), "male;0;top=top_tank:0;bottom=bottom_pants:0");
});

test("normalize: required slots are filled with the default; optional ones may be empty", () => {
  assert.equal(normalizeRecipe("female;2"), "female;2;top=top_tee:0;bottom=bottom_pants:0");
  assert.equal(normalizeRecipe("female"), "female;0;top=top_tee:0;bottom=bottom_pants:0");
});

test("normalize: shapes come right after the skin, defaults are left out, unknown shapes become the default", () => {
  assert.equal(normalizeRecipe("male;5;height=tall;top=top_puffer:0;face=round;build=heavy;bottom=bottom_jeans:2"),
    "male;5;build=heavy;face=round;height=tall;top=top_puffer:0;bottom=bottom_jeans:2");
  assert.equal(normalizeRecipe("female;1;build=average;face=classic;height=average"), "female;1;top=top_tee:0;bottom=bottom_pants:0");
  assert.equal(normalizeRecipe("female;1;build=huge;face=round;face=heart;height=1.4"), "female;1;face=round;top=top_tee:0;bottom=bottom_pants:0");
  assert.deepEqual(parseRecipe("female;1").shape, { build: "average", face: "classic", height: "average" });
  // Recipes made before shapes and accessories existed are untouched.
  assert.equal(normalizeRecipe(FULL), FULL);
  // Object form.
  assert.equal(normalizeRecipe({ body: "male", skin: 2, shape: { build: "slim", height: "short" }, parts: { accessory: { id: "acc_fedora", color: 4 } } }),
    "male;2;build=slim;height=short;top=top_tee:0;bottom=bottom_pants:0;accessory=acc_fedora:4");
});

test("shapes: morph names and height scale", () => {
  assert.deepEqual(shapeMorphs(parseRecipe("female;1;build=heavy;face=heart").shape), ["build_heavy", "face_heart"]);
  assert.deepEqual(shapeMorphs(parseRecipe("female;1").shape), []);
  assert.equal(heightScale(parseRecipe("male;1;height=tall").shape), HEIGHTS.find((h) => h.id === "tall").scale);
  assert.equal(heightScale(parseRecipe("male;1").shape), 1);
});

test("normalize: the accessory slot is optional, last, and only takes accessories", () => {
  assert.equal(normalizeRecipe("female;3;accessory=acc_shades:2;hair=hair_bob:1"), "female;3;hair=hair_bob:1;top=top_tee:0;bottom=bottom_pants:0;accessory=acc_shades:2");
  assert.equal(normalizeRecipe("female;3;accessory=hair_bob:1;hair=acc_shades:2"), "female;3;top=top_tee:0;bottom=bottom_pants:0");
  assert.equal(normalizeRecipe("male;0;accessory=acc_gloves:99"), "male;0;top=top_tee:0;bottom=bottom_pants:0;accessory=acc_gloves:0");
});

test("normalize: the longest possible recipe fits MAX_RECIPE_LENGTH", () => {
  for (const b of BODIES) {
    const longest = (list) => list.reduce((a, x) => (x.id.length > a.id.length ? x : a));
    const r = { body: b.id, skin: SKIN_TONES.length - 1, shape: {}, parts: {} };
    for (const k of SHAPE_KINDS) r.shape[k.id] = longest(k.options).id;
    for (const s of PART_SLOTS) r.parts[s.id] = { id: longest(partsFor(b.id, s.id)).id, color: s.colors.length - 1 };
    const str = formatRecipe(r);
    assert.ok(str.length <= MAX_RECIPE_LENGTH, `${str.length}: ${str}`);
    assert.equal(normalizeRecipe(str), str);
  }
});

test("normalize: not a recipe -> empty string (classic character)", () => {
  for (const bad of [null, undefined, "", 42, [], "alien;1;top=top_tee:0", ";;;", "x".repeat(MAX_RECIPE_LENGTH + 1)]) {
    assert.equal(normalizeRecipe(bad), "", JSON.stringify(bad));
  }
});

test("normalize: object form works too", () => {
  assert.equal(normalizeRecipe({ body: "male", skin: 4, parts: { hair: { id: "hair_short", color: 2 }, top: "top_tank" } }),
    "male;4;hair=hair_short:2;top=top_tank:0;bottom=bottom_pants:0");
  assert.deepEqual(recipePartIds(FULL), ["hair_bob", "brows_soft", "top_tank", "bottom_shorts", "shoes_sneakers"]);
});

test("randomRecipe: always valid, free-only by default, and repeatable with a seed", () => {
  for (let i = 0; i < 200; i++) {
    const r = randomRecipe(seededRandom("npc" + i));
    assert.equal(normalizeRecipe(r), r, r);
    assert.ok(recipePartIds(r).every((id) => partById(id).tier === "free"), r);
    const parsed = parseRecipe(r);
    assert.ok(parsed.skin >= 0 && parsed.skin < SKIN_TONES.length);
  }
  assert.equal(randomRecipe(seededRandom("dex")), randomRecipe(seededRandom("dex")));
  // Over many draws every build, face, height and accessory shows up.
  const shapes = new Set(), accs = new Set();
  const many = seededRandom("variety");
  for (let i = 0; i < 400; i++) {
    const p = parseRecipe(randomRecipe(many));
    for (const k of SHAPE_KINDS) shapes.add(`${k.id}=${p.shape[k.id]}`);
    if (p.parts.accessory) accs.add(p.parts.accessory.id);
  }
  for (const k of SHAPE_KINDS) for (const o of k.options) assert.ok(shapes.has(`${k.id}=${o.id}`), `${k.id}=${o.id} never picked`);
  assert.ok(accs.size >= 3);
  assert.notEqual(randomRecipe(seededRandom("a")), randomRecipe(seededRandom("b")));
  assert.ok(randomRecipe(Math.random, { body: "male" }).startsWith("male;"));
  // allow() can open premium parts (e.g. the player's unlocks); with everything allowed we eventually see one.
  const seen = new Set();
  const rng = seededRandom("premium");
  for (let i = 0; i < 300; i++) for (const id of recipePartIds(randomRecipe(rng, { allow: () => true }))) seen.add(id);
  assert.ok([...seen].some((id) => partById(id).tier === "premium"));
  // Works with a body that has a part list of its own (female-only parts never land on male).
  for (let i = 0; i < 100; i++) {
    const r = randomRecipe(rng, { body: "male", allow: () => true });
    assert.ok(recipePartIds(r).every((id) => partById(id).bodies.includes("male")), r);
  }
});

test("quest givers and NPCs with a recipe use valid recipes and keep a classic fallback look", () => {
  const withRecipe = [...GIVERS, ...AMBIENT].filter((g) => g.recipe);
  assert.ok(withRecipe.length > 0);
  for (const g of withRecipe) {
    assert.equal(normalizeRecipe(g.recipe), g.recipe, g.id);
    assert.ok(CHARACTERS.some((c) => c.id === g.look), `${g.id} fallback look`);
  }
});

// ---------- Server entitlements ----------
test("parts: free are open, premium need an unlock", { skip: !LOCKED && "FV_UNLOCK_ALL=1" }, () => {
  assert.ok(canUsePart(null, "hair_bob"));
  assert.ok(!canUsePart(null, "hair_afro"));
  assert.ok(canUsePart({ unlocks: ["hair_afro"] }, "hair_afro"));
  assert.ok(!canUsePart({ unlocks: ["hair_afro"] }, "top_sweater"));
  assert.ok(!canUsePart(null, "nonsense"));
});

test("resolveRecipe swaps locked premium parts for the free default, keeping the color", { skip: !LOCKED && "FV_UNLOCK_ALL=1" }, () => {
  const wanted = "male;2;hair=hair_afro:3;top=top_sweater:4;bottom=bottom_cargo:1;shoes=shoes_platform:2";
  assert.equal(resolveRecipe(null, wanted), "male;2;hair=hair_short:3;top=top_tee:4;bottom=bottom_pants:1;shoes=shoes_sneakers:2");
  assert.equal(resolveRecipe({ unlocks: ["top_sweater"] }, wanted), "male;2;hair=hair_short:3;top=top_sweater:4;bottom=bottom_pants:1;shoes=shoes_sneakers:2");
  assert.equal(resolveRecipe(null, FULL), FULL);   // all free: untouched
  assert.equal(resolveRecipe(null, "garbage"), "");
  assert.equal(resolveRecipe(null, ""), "");
});

test("resolveAppearance: a player has a recipe or a classic look; accessories ride on top", { skip: !LOCKED && "FV_UNLOCK_ALL=1" }, () => {
  const acct = { unlocks: [] };
  const was = { look: "kate", recipe: FULL, accessories: ["cap"] };
  // Join with a recipe (and the classic look as fallback).
  assert.deepEqual(resolveAppearance(acct, { look: "remy", recipe: FULL, accessories: ["sunnies", "wings"] }, {}),
    { look: "remy", recipe: FULL, accessories: ["sunnies"] });
  // Asking for just a look switches to the classic character.
  assert.deepEqual(resolveAppearance(acct, { look: "jody" }, was), { look: "jody", recipe: "", accessories: ["cap"] });
  // An explicit empty recipe does too.
  assert.equal(resolveAppearance(acct, { recipe: "" }, was).recipe, "");
  // Only accessories: look and recipe are kept.
  assert.deepEqual(resolveAppearance(acct, { accessories: [] }, was), { look: "kate", recipe: FULL, accessories: [] });
  // Nothing asked: whatever they had (e.g. the saved account defaults on join).
  assert.deepEqual(resolveAppearance(acct, {}, was), was);
  // Premium checks apply to everything.
  const r = resolveAppearance(acct, { look: "bigvegas", recipe: "female;1;hair=hair_afro:0", accessories: ["wings"] }, {});
  assert.equal(r.look, "michelle");
  assert.equal(r.recipe, "female;1;hair=hair_short:0;top=top_tee:0;bottom=bottom_pants:0");
  assert.deepEqual(r.accessories, []);
  // Garbage recipe -> classic character.
  assert.equal(resolveAppearance(acct, { look: "kate", recipe: "drop table" }, {}).recipe, "");
});

test("resolveRecipe keeps the body shape (shapes are free) and swaps a locked accessory like any part", { skip: !LOCKED && "FV_UNLOCK_ALL=1" }, () => {
  const wanted = "female;2;build=athletic;face=angular;height=short;top=top_puffer:0;bottom=bottom_jeans:0;accessory=acc_mask:3";
  assert.equal(resolveRecipe(null, wanted), "female;2;build=athletic;face=angular;height=short;top=top_puffer:0;bottom=bottom_jeans:0;accessory=acc_fedora:3");
  assert.equal(resolveRecipe({ unlocks: ["acc_mask"] }, wanted), wanted);
});

test("resolveAppearance: unlocked premium parts survive", { skip: !LOCKED && "FV_UNLOCK_ALL=1" }, () => {
  const acct = { unlocks: ["hair_afro", "shoes_platform"] };
  const wanted = "female;6;hair=hair_afro:9;top=top_crop:2;bottom=bottom_skirt:3;shoes=shoes_platform:5";
  assert.equal(resolveAppearance(acct, { recipe: wanted }, { look: "kate" }).recipe, wanted);
});
