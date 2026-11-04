import { test } from "node:test";
import assert from "node:assert/strict";
import { ACCESSORIES, SLOTS, normalizeAccessories, accessoryById } from "../shared/accessories.js";
import { canUseAccessory, resolveAccessories } from "../server/entitlements.js";

test("every accessory has a known slot and a tier", () => {
  for (const a of ACCESSORIES) {
    assert.ok(SLOTS.includes(a.slot), `${a.id} slot`);
    assert.ok(a.tier === "free" || a.tier === "premium", `${a.id} tier`);
  }
});

test("normalize: at most one per slot, known ids only, stable order", () => {
  assert.deepEqual(normalizeAccessories("cap,tophat,sunnies,bogus,glowstick"), ["cap", "sunnies", "glowstick"]);  // cap wins the head slot
  assert.deepEqual(normalizeAccessories(["sunnies", "cap"]), ["cap", "sunnies"]);                                  // SLOTS order (head before face)
  assert.deepEqual(normalizeAccessories(null), []);
  assert.deepEqual(normalizeAccessories(["wings"]), ["wings"]);
});

test("free accessories are open; premium need an unlock", () => {
  assert.ok(canUseAccessory(null, "cap"));
  assert.ok(canUseAccessory(null, "sunnies"));
  assert.ok(!canUseAccessory(null, "tophat"));
  assert.ok(!canUseAccessory(null, "wings"));
  assert.ok(canUseAccessory({ unlocks: ["wings"] }, "wings"));
  assert.ok(!canUseAccessory({ unlocks: ["wings"] }, "halo"));
  assert.ok(!canUseAccessory(null, "nonsense"));
});

test("resolveAccessories drops premium ones the player hasn't unlocked", () => {
  assert.deepEqual(resolveAccessories(null, ["cap", "wings", "sunnies"]), ["cap", "sunnies"]);     // wings removed
  assert.deepEqual(resolveAccessories({ unlocks: ["wings"] }, ["wings", "tophat"]), ["wings"]);   // only the unlocked premium survives (both are 'head'? no: wings=back, tophat=head → both kept by slot, tophat dropped by lock)
  assert.deepEqual(resolveAccessories({ unlocks: ["tophat"] }, ["cap", "tophat"]), ["cap"]);       // cap already took the head slot in normalize
});
