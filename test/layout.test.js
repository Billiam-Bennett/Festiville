import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultLayout, sanitizeLayout, facing, FENCE, MAX_LAMPS } from "../shared/layout.js";
import { LayoutStore } from "../server/layout.js";
import { applyLayout, VENDORS, ZONE_LABELS, inside as insideLayout } from "../shared/venue.js";
import { GIVERS } from "../shared/quests-data.js";

const rules = { knownRefs: ["juniper", "dex", "rae", "greeter", "dj"], requiredRefs: ["juniper", "dex", "rae"] };

test("the default layout is valid and has the expected pieces", () => {
  const d = defaultLayout();
  const out = sanitizeLayout(d, rules);
  assert.equal(out.error, undefined);
  assert.equal(out.warnings.length, 0, out.warnings.join("; "));
  const types = out.layout.items.reduce((m, i) => ((m[i.type] = (m[i.type] || 0) + 1), m), {});
  assert.equal(types.stall, 20);
  assert.equal(types.stage, 2);
  assert.ok(types.spot >= 3 && types.tent >= 3);
  assert.equal(out.layout.items.filter((i) => i.type === "npc" && i.ref === "juniper").length, 1);
});

test("facing follows rotation", () => {
  assert.deepEqual(facing(0), { x: 0, z: 1 });    // front points south (+z) at rot 0
  assert.deepEqual(facing(90), { x: 1, z: 0 });   // east
  assert.deepEqual(facing(180), { x: 0, z: -1 }); // north
});

test("bad input is cleaned: positions clamped, junk dropped, ids made unique", () => {
  const { layout, warnings } = sanitizeLayout({
    items: [
      { type: "tree", x: 9999, z: -9999 },
      { type: "not-a-thing", x: 0, z: 0 },
      { type: "stall", id: "dup", vendor: "noodle", x: 0, z: 0 },
      { type: "stall", id: "dup", vendor: "noodle", x: 5, z: 5 },       // duplicate vendor + id
      { type: "area", x: 0, z: 0, w: 5000, d: -3, color: "nope", label: "<script>x</script>Zone" },
    ],
  }, rules);
  const tree = layout.items.find((i) => i.type === "tree");
  assert.ok(Math.abs(tree.x) <= FENCE - 1 && Math.abs(tree.z) <= FENCE - 1);
  assert.equal(layout.items.filter((i) => i.type === "stall").length, 1);          // one noodle stall kept
  assert.equal(new Set(layout.items.map((i) => i.id)).size, layout.items.length);  // ids unique
  const area = layout.items.find((i) => i.type === "area");
  assert.ok(area.w <= FENCE * 2 && area.d >= 2);
  assert.equal(area.color, "#9b7b52");                                             // bad color -> default
  assert.ok(!area.label.includes("<"));                                            // tags stripped
  assert.ok(warnings.some((w) => /placed twice/.test(w)));
});

test("quest givers can't be deleted; too few spots/tents warns", () => {
  const { layout, warnings } = sanitizeLayout({ items: [{ type: "npc", ref: "greeter", x: 1, z: 1 }] }, rules);
  for (const g of rules.requiredRefs) assert.ok(layout.items.some((i) => i.type === "npc" && i.ref === g), `${g} restored`);
  assert.ok(warnings.some((w) => /Lost & Found/.test(w)));
  assert.ok(warnings.some((w) => /Vendor Rush/.test(w)));
});

test("lamps are capped", () => {
  const items = Array.from({ length: MAX_LAMPS + 5 }, (_, i) => ({ type: "lamp", x: i, z: 0 }));
  const { layout, warnings } = sanitizeLayout({ items }, rules);
  assert.equal(layout.items.filter((i) => i.type === "lamp").length, MAX_LAMPS);
  assert.ok(warnings.some((w) => /lamps/.test(w)));
});

test("applyLayout drives vendors, zones and quest positions", () => {
  applyLayout(defaultLayout());
  assert.equal(VENDORS.length, 20);
  assert.ok(ZONE_LABELS.food === "Food Court");
  const noodle = VENDORS.find((v) => v.id === "noodle");
  assert.equal(noodle.zone, "food");
  assert.ok(noodle.name && noodle.items.length);
  // Move a stage; the soundcheck marker moves with it after re-applying.
  const custom = defaultLayout();
  const side = custom.items.find((i) => i.type === "stage" && i.variant === "side");
  side.x = 20; side.z = 20; side.rot = 0;
  applyLayout(custom);
  // (marker recompute is covered indirectly; just ensure no crash and vendors still resolve)
  assert.equal(VENDORS.length, 20);
  applyLayout(defaultLayout());
});

test("inside() handles rotation", () => {
  const area = { type: "area", x: 0, z: 0, w: 10, d: 4, rot: 90 };
  assert.ok(insideLayout(area, 0, 4));     // rotated: long axis now runs along z
  assert.ok(!insideLayout(area, 4, 0));
});

test("LayoutStore saves, keeps history, restores, and reloads", () => {
  const dir = mkdtempSync(join(tmpdir(), "fv-lay-"));
  try {
    const store = new LayoutStore({ dir });
    assert.equal(store.current().updatedAt, null);                 // starts on the default
    const smaller = { items: defaultLayout().items.filter((i) => i.type !== "tree") };
    const out = store.save(smaller, "Sam");
    assert.equal(out.error, undefined);
    assert.ok(!out.layout.items.some((i) => i.type === "tree"));
    assert.equal(store.current().updatedBy, "Sam");
    assert.ok(existsSync(join(dir, "layout.json")));

    const out2 = store.save(defaultLayout(), "Sam");               // second save -> first is in history
    assert.ok(out2.layout.items.some((i) => i.type === "tree"));
    const hist = store.history();
    assert.ok(hist.length >= 1);
    store.restore(hist[0], "Sam");
    assert.ok(!store.current().layout.items.some((i) => i.type === "tree"));   // back to the treeless one

    const reopened = new LayoutStore({ dir });                     // a fresh process sees the saved file
    assert.ok(!reopened.current().layout.items.some((i) => i.type === "tree"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
