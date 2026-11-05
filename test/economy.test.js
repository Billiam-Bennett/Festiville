import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AccountStore } from "../server/accounts.js";
import { buy, rewardQuest, grantPack } from "../server/shop.js";
import { CampStore, upgradeCost } from "../server/camps.js";
import {
  STARTING_CREDITS, PLOTS, CAMP_ITEMS, UNLOCK_PRICES, QUEST_REWARDS, DAILY_REPEAT_CAP, CREDIT_PACKS,
  unlockableById, shopCatalog, plotById,
} from "../shared/economy.js";
import { checkSpot, campSlots, groundCapacity, cleanCampItems } from "../shared/camps.js";
import { defaultLayout } from "../shared/layout.js";
import { QUESTS } from "../shared/quests-data.js";

function temp() {
  const dir = mkdtempSync(join(tmpdir(), "fv-econ-"));
  return { dir, store: new AccountStore({ dir }), done: () => rmSync(dir, { recursive: true, force: true }) };
}
const LAYOUT_ITEMS = defaultLayout().items;

// ---------- Catalog ----------
test("catalog: every priced unlock is a real premium item; camp items and plots are sane", () => {
  for (const [id, price] of Object.entries(UNLOCK_PRICES)) {
    assert.equal(unlockableById(id)?.tier, "premium", id);
    assert.ok(Number.isInteger(price) && price > 0, id);
  }
  const ids = new Set();
  for (const i of CAMP_ITEMS) {
    assert.ok(!ids.has(i.id) && !unlockableById(i.id), `${i.id} unique`); ids.add(i.id);
    assert.ok(["ground", "edge"].includes(i.place), i.id);
  }
  assert.ok(CAMP_ITEMS.some((i) => i.price === 0 && i.group === "tent"), "a free tent comes with every camp");
  for (let k = 1; k < PLOTS.length; k++) assert.ok(PLOTS[k].price > PLOTS[k - 1].price && PLOTS[k].w * PLOTS[k].d > PLOTS[k - 1].w * PLOTS[k - 1].d);
  assert.ok(STARTING_CREDITS >= PLOTS[0].price, "a new player can afford the smallest camp spot");
  // 100 credits ≈ $1, and bigger packs never give less per dollar than smaller ones.
  let perDollar = 0;
  for (const p of CREDIT_PACKS) {
    const rate = p.credits / p.usd;
    assert.ok(rate >= 100, `${p.id} gives at least 100 credits per dollar`);
    assert.ok(rate >= perDollar, `${p.id} is at least as good a deal as the smaller packs`);
    perDollar = rate;
  }
  for (const id of Object.keys(QUEST_REWARDS)) assert.ok(QUESTS[id], id);
  assert.ok(shopCatalog().some((i) => i.id === "totem" && i.kind === "wear"));
  assert.ok(shopCatalog().some((i) => i.id === "pa" && i.kind === "camp" && i.featured));
});

// ---------- Credits ----------
test("new players start with credits, and every change is in the ledger", async () => {
  const { dir, store, done } = temp();
  try {
    const { account } = await store.signup("Cash", "tacos-forever");
    assert.equal(account.credits, STARTING_CREDITS);
    assert.equal(store.changeCredits(account.id, 25, "console").balance, STARTING_CREDITS + 25);
    const tooMuch = store.changeCredits(account.id, -100000, "buy:x");
    assert.match(tooMuch.error, /costs/);
    assert.equal(store.balance(store.get(account.id)), STARTING_CREDITS + 25);   // unchanged
    assert.ok(store.changeCredits(account.id, 1.5, "x").error);
    const lines = readFileSync(join(dir, "credits-ledger.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(lines.map((l) => [l.delta, l.reason]), [[STARTING_CREDITS, "welcome"], [25, "console"]]);
    assert.equal(new AccountStore({ dir }).balance(new AccountStore({ dir }).get(account.id)), STARTING_CREDITS + 25);
  } finally { done(); }
});

test("accounts from before credits existed get the starting amount", () => {
  const { store, done } = temp();
  try { assert.equal(store.balance({ id: "old" }), STARTING_CREDITS); } finally { done(); }
});

// ---------- Shop ----------
test("buying a premium item takes the credits and unlocks it; can't buy twice or go negative", async () => {
  const { store, done } = temp();
  try {
    const { account } = await store.signup("Shopper", "tacos-forever");
    const out = buy(store, account.id, "totem");
    assert.ok(out.ok, out.error);
    assert.equal(out.balance, STARTING_CREDITS - UNLOCK_PRICES.totem);
    assert.ok(store.get(account.id).unlocks.includes("totem"));
    assert.match(buy(store, account.id, "totem").error, /already own/);
    assert.match(buy(store, account.id, "bigvegas").error, /costs/);           // 800 > what's left
    assert.ok(!store.get(account.id).unlocks.includes("bigvegas"));
    assert.match(buy(store, account.id, "cap").error, /isn't for sale/);        // free accessory
    assert.match(buy(store, account.id, "tent_basic").error, /isn't for sale/); // free camp item
    assert.match(buy(store, account.id, "nonsense").error, /isn't for sale/);
  } finally { done(); }
});

test("buying a camp item adds it to the player's camp items", async () => {
  const { store, done } = temp();
  try {
    const { account } = await store.signup("Camper", "tacos-forever");
    assert.ok(buy(store, account.id, "chairs").ok);
    assert.deepEqual(store.campItems(store.get(account.id)).sort(), ["chairs", "tent_basic"]);
    assert.match(buy(store, account.id, "chairs").error, /already own/);
  } finally { done(); }
});

test("quest credits: full first time, smaller repeats, capped per day", async () => {
  const { store, done } = temp();
  try {
    const { account } = await store.signup("Quester", "tacos-forever");
    const day1 = Date.UTC(2026, 10, 4, 12), day2 = Date.UTC(2026, 10, 5, 12);
    const r = QUEST_REWARDS.soundcheck;
    assert.equal(rewardQuest(store, account.id, "soundcheck", day1), r.first);
    let repeats = 0;
    for (let i = 0; i < 20; i++) repeats += rewardQuest(store, account.id, "soundcheck", day1);
    assert.equal(repeats, DAILY_REPEAT_CAP);                                    // capped
    assert.equal(rewardQuest(store, account.id, "soundcheck", day2), r.repeat); // new day
    assert.equal(rewardQuest(store, account.id, "lostfound", day2), QUEST_REWARDS.lostfound.first);
    assert.equal(rewardQuest(store, account.id, "nope", day2), 0);
    assert.equal(store.balance(store.get(account.id)), STARTING_CREDITS + r.first + DAILY_REPEAT_CAP + r.repeat + QUEST_REWARDS.lostfound.first);
  } finally { done(); }
});

test("credit packs: a payment credits once, even if the webhook arrives twice", async () => {
  const { store, done } = temp();
  try {
    const { account } = await store.signup("Buyer", "tacos-forever");
    const pack = CREDIT_PACKS[0];
    assert.equal(grantPack(store, account.id, pack.id, "pay_123").credits, pack.credits);
    assert.equal(grantPack(store, account.id, pack.id, "pay_123").credits, 0);
    assert.equal(store.balance(store.get(account.id)), STARTING_CREDITS + pack.credits);
    assert.ok(grantPack(store, account.id, "pack_fake", "pay_9").error);
    assert.ok(grantPack(store, account.id, pack.id, "").error);
  } finally { done(); }
});

// ---------- Camps ----------
test("camp spots must be inside the Campground and clear of tents, trees and other camps", () => {
  assert.equal(checkSpot(LAYOUT_ITEMS, [], { x: -24, z: 50, plot: "plot_10x10" }), "");          // open grass in the campground
  assert.match(checkSpot(LAYOUT_ITEMS, [], { x: 0, z: 0, plot: "plot_10x10" }), /inside the Campground/);
  assert.match(checkSpot(LAYOUT_ITEMS, [], { x: -30, z: 55, plot: "plot_10x10" }), /too close to a camping tent/);
  assert.match(checkSpot(LAYOUT_ITEMS, [], { x: 35.5, z: 50, plot: "plot_10x10" }), /inside the Campground/);   // pokes out the side
  const other = [{ id: "pal", owner: "Pal", x: -24, z: 50, plot: "plot_10x10" }];
  assert.match(checkSpot(LAYOUT_ITEMS, other, { x: -23, z: 50, plot: "plot_10x10" }), /Pal's camp/);
  assert.equal(checkSpot(LAYOUT_ITEMS, other, { x: -23, z: 50, plot: "plot_10x10", selfId: "pal" }), "");
  assert.equal(checkSpot([], [], { x: 0, z: 65, plot: "plot_10x10" }), "This festival has no Campground right now.");
  assert.match(checkSpot(LAYOUT_ITEMS, [], { x: -24, z: 50, plot: "huge" }), /size/);
});

test("camp slots and capacity grow with the spot; items are cleaned to what's owned and fits", () => {
  const caps = PLOTS.map((p) => groundCapacity(p.id));
  assert.ok(caps[0] >= 2 && caps[1] > caps[0] && caps[2] > caps[1], String(caps));
  for (const p of PLOTS) for (const s of campSlots(p.id)) {
    assert.ok(Math.abs(s.x) <= p.w / 2 && Math.abs(s.z) <= p.d / 2, `${p.id} slot inside`);
  }
  const owned = ["tent_basic", "tent_bell", "chairs", "cooler", "firepit", "pa", "lights", "neon"];
  // One tent; ground items up to capacity (2 on a 10×10); edge items free; not-owned dropped.
  assert.deepEqual(cleanCampItems(["tent_basic", "tent_bell", "chairs", "cooler", "firepit", "lights", "neon", "lasers"], owned, "plot_10x10"),
    ["tent_basic", "chairs", "cooler", "lights", "neon"]);
  assert.deepEqual(cleanCampItems(["pa", "chairs", "cooler"], owned, "plot_10x20"), ["pa", "chairs", "cooler"]);
  assert.deepEqual(cleanCampItems("junk", owned, "plot_10x10"), []);
});

test("camp store: place, move, items, release; saved and announced", () => {
  const { dir, done } = temp();
  try {
    const camps = new CampStore({ dir, layoutItems: () => LAYOUT_ITEMS });
    const seen = [];
    camps.onChange((camp, id) => seen.push([id, camp?.plot ?? null]));
    assert.ok(camps.place("a1", "Rook", { x: -24.2, z: 52.1, plot: "plot_10x10" }, ["tent_basic"]).camp);
    assert.deepEqual(camps.of("a1"), { ...camps.of("a1"), x: -24, z: 52, items: ["tent_basic"] });       // snapped, free tent set up
    assert.match(camps.place("a2", "Pal", { x: -24, z: 52, plot: "plot_10x10" }, []).error, /Rook's camp/);
    assert.equal(camps.setItems("a1", ["tent_basic", "chairs"], ["tent_basic"]).camp.items.join(), "tent_basic");   // not owned
    assert.match(camps.place("a1", "Rook", { x: -24, z: 49, plot: "plot_10x20" }, ["tent_basic"]).error, /inside the Campground/);   // too near the edge to grow
    assert.ok(camps.place("a1", "Rook", { x: -24, z: 52, plot: "plot_10x20" }, ["tent_basic"]).camp);              // upgrade in place
    assert.equal(new CampStore({ dir, layoutItems: () => LAYOUT_ITEMS }).of("a1").plot, "plot_10x20");               // saved
    assert.deepEqual(camps.all().map((c) => c.id), ["rook"]);
    assert.ok(camps.release("a1"));
    assert.ok(!camps.release("a1"));
    assert.deepEqual(seen.at(-1), ["rook", null]);
    assert.equal(upgradeCost("plot_10x10", "plot_20x20"), plotById("plot_20x20").price - plotById("plot_10x10").price);
    assert.equal(upgradeCost("plot_20x20", "plot_10x10"), null);
  } finally { done(); }
});
