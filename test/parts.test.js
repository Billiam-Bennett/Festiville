import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BODIES, PARTS, PART_SLOTS, SKIN_TONES, partById, partsFor, defaultPart,
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

test("resolveAppearance: unlocked premium parts survive", { skip: !LOCKED && "FV_UNLOCK_ALL=1" }, () => {
  const acct = { unlocks: ["hair_afro", "shoes_platform"] };
  const wanted = "female;6;hair=hair_afro:9;top=top_crop:2;bottom=bottom_skirt:3;shoes=shoes_platform:5";
  assert.equal(resolveAppearance(acct, { recipe: wanted }, { look: "kate" }).recipe, wanted);
});
