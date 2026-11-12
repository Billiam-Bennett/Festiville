import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AccountStore } from "../server/accounts.js";
import { buy, rewardQuest, grantPack } from "../server/shop.js";
import { CampStore, upgradeCost, claimCamp, upgradeCamp } from "../server/camps.js";
import { isPremiumMember, ownedCampItems } from "../server/entitlements.js";
import {
  STARTING_CREDITS, PLOTS, CAMP_ITEMS, CAMP_CATEGORIES, UNLOCK_PRICES, QUEST_REWARDS, DAILY_REPEAT_CAP, CREDIT_PACKS,
  unlockableById, shopCatalog, plotById, campItemById, PREMIUM_MEMBERSHIP, PREMIUM_BUNDLE, FREE_CAMP_ITEMS, LED_COLORS,
} from "../shared/economy.js";
import { checkSpot, campSlots, groundCapacity, cleanCampItems, campSolids } from "../shared/camps.js";
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
  for (let k = 1; k < PLOTS.length; k++) assert.ok(PLOTS[k].w * PLOTS[k].d > PLOTS[k - 1].w * PLOTS[k - 1].d, "spots get bigger");
  // The camp rule: the 10×10 is free for everyone, the 10×20 is a credit upgrade, the 20×20 is premium only.
  assert.deepEqual(PLOTS.map((p) => [p.id, p.price, !!p.premium]), [["plot_10x10", 0, false], ["plot_10x20", 450, false], ["plot_20x20", 0, true]]);
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

test("business quests follow the same anti-farm rules: full first time, less on repeat, capped per day", async () => {
  const { store, done } = temp();
  try {
    const { account } = await store.signup("Sponsored", "tacos-forever");
    const day = Date.UTC(2026, 10, 11, 12);
    const r = QUEST_REWARDS.getweird;
    assert.equal(QUESTS.getweird.type, "business");
    assert.ok(r.first > r.repeat && r.repeat > 0);
    assert.equal(rewardQuest(store, account.id, "getweird", day), r.first);
    assert.equal(rewardQuest(store, account.id, "getweird", day), r.repeat);
    let repeats = r.repeat;
    for (let i = 0; i < 20; i++) repeats += rewardQuest(store, account.id, "getweird", day);
    assert.equal(repeats, DAILY_REPEAT_CAP);
    assert.equal(rewardQuest(store, account.id, "vendorrush", day), QUEST_REWARDS.vendorrush.first);   // a first time still pays in full
    assert.equal(rewardQuest(store, account.id, "vendorrush", day), 0);                                // but the day's repeats are used up
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
// Open grass in the west half of the Campground (see defaultLayout in shared/layout.js).
const SPOT = { x: -90, z: 130 };

test("camp spots must be inside the Campground and clear of tents, paths and other camps", () => {
  assert.equal(checkSpot(LAYOUT_ITEMS, [], { ...SPOT, plot: "plot_10x10" }), "");                 // open grass in the campground
  assert.equal(checkSpot(LAYOUT_ITEMS, [], { x: 90, z: 130, plot: "plot_20x20" }), "");           // the east half counts too
  assert.match(checkSpot(LAYOUT_ITEMS, [], { x: 0, z: 0, plot: "plot_10x10" }), /inside the Campground/);
  assert.match(checkSpot(LAYOUT_ITEMS, [], { x: -41, z: 137, plot: "plot_10x10" }), /too close to a camping tent/);
  assert.match(checkSpot(LAYOUT_ITEMS, [], { x: -90, z: 150, plot: "plot_10x10" }), /too close to a path/);     // the lanes stay clear
  assert.match(checkSpot(LAYOUT_ITEMS, [], { x: -14.5, z: 130, plot: "plot_10x10" }), /inside the Campground/);   // pokes out the side
  const other = [{ id: "pal", owner: "Pal", ...SPOT, plot: "plot_10x10" }];
  assert.match(checkSpot(LAYOUT_ITEMS, other, { x: SPOT.x + 1, z: SPOT.z, plot: "plot_10x10" }), /Pal's camp/);
  assert.equal(checkSpot(LAYOUT_ITEMS, other, { x: SPOT.x + 1, z: SPOT.z, plot: "plot_10x10", selfId: "pal" }), "");
  assert.equal(checkSpot([], [], { x: 0, z: 150, plot: "plot_10x10" }), "This festival has no Campground right now.");
  assert.match(checkSpot(LAYOUT_ITEMS, [], { ...SPOT, plot: "huge" }), /size/);
});

test("the Campground has room for a festival's worth of free 10×10 camps", () => {
  // Pack 10×10s on a grid and count how many fit: everyone gets one, so this has to be a big number.
  const camps = [];
  for (let x = -168; x <= 168; x += 4) for (let z = 114; z <= 186; z += 4) {
    if (!checkSpot(LAYOUT_ITEMS, camps, { x, z, plot: "plot_10x10" })) camps.push({ id: `c${camps.length}`, owner: "x", x, z, plot: "plot_10x10" });
  }
  assert.ok(camps.length >= 1000, `only ${camps.length} spots fit`);
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
    assert.ok(camps.place("a1", "Rook", { x: -90.2, z: 128.1, plot: "plot_10x10" }, ["tent_basic"]).camp);
    assert.deepEqual(camps.of("a1"), { ...camps.of("a1"), x: -90, z: 128, items: ["tent_basic"] });       // snapped, free tent set up
    assert.match(camps.place("a2", "Pal", { x: -90, z: 128, plot: "plot_10x10" }, []).error, /Rook's camp/);
    assert.equal(camps.setItems("a1", ["tent_basic", "chairs"], ["tent_basic"]).camp.items.join(), "tent_basic");   // not owned
    assert.match(camps.place("a1", "Rook", { x: -90, z: 114, plot: "plot_10x20" }, ["tent_basic"]).error, /inside the Campground/);   // too near the edge to grow
    assert.ok(camps.place("a1", "Rook", { x: -90, z: 128, plot: "plot_10x20" }, ["tent_basic"]).camp);              // upgrade in place
    assert.equal(new CampStore({ dir, layoutItems: () => LAYOUT_ITEMS }).of("a1").plot, "plot_10x20");               // saved
    assert.deepEqual(camps.all().map((c) => c.id), ["rook"]);
    assert.ok(camps.release("a1"));
    assert.ok(!camps.release("a1"));
    assert.deepEqual(seen.at(-1), ["rook", null]);
    assert.equal(upgradeCost("plot_10x10", "plot_10x20"), plotById("plot_10x20").price);   // the 10×10 was free
    assert.equal(upgradeCost("plot_10x10", "plot_20x20"), 0);                              // premium: never credits
    assert.equal(upgradeCost("plot_20x20", "plot_10x10"), null);
  } finally { done(); }
});

// ---------- The camp rule: free 10×10 for everyone, 20×20 + bundle for premium ----------
function campWorld() {
  const t = temp();
  return { ...t, camps: new CampStore({ dir: t.dir, layoutItems: () => LAYOUT_ITEMS }) };
}
const ledger = (dir) => readFileSync(join(dir, "credits-ledger.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));

test("a free account claims a 10×10 for 0 credits, and is refused a 20×20", async () => {
  const { dir, store, camps, done } = campWorld();
  try {
    const { account } = await store.signup("Freebie", "tacos-forever");
    const a = store.get(account.id);
    assert.equal(isPremiumMember(a), false);
    const opts = { premium: isPremiumMember(a), owned: ownedCampItems(store, a) };

    const no = claimCamp(store, camps, a, { ...SPOT, plot: "plot_20x20" }, opts);
    assert.match(no.error, /premium membership/);
    assert.equal(camps.of(a.id), null);

    const out = claimCamp(store, camps, a, { ...SPOT, plot: "plot_10x10" }, opts);
    assert.ok(out.ok, out.error);
    assert.match(out.text, /free/i);
    assert.equal(camps.of(a.id).plot, "plot_10x10");
    assert.deepEqual(camps.of(a.id).items, ["tent_basic"]);
    assert.equal(store.balance(store.get(a.id)), STARTING_CREDITS);                       // cost nothing
    assert.deepEqual(ledger(dir).map((l) => l.reason), ["welcome"]);                      // and nothing was charged
    assert.match(claimCamp(store, camps, a, { x: -100, z: 130, plot: "plot_10x10" }, opts).error, /already have a camp/);   // one camp per account

    // The 20×20 can't be bought with credits either, however many you have.
    store.changeCredits(a.id, 5000, "console");
    assert.match(upgradeCamp(store, camps, a, "plot_20x20", opts).error, /premium membership/);
    assert.equal(camps.of(a.id).plot, "plot_10x10");
    assert.equal(store.balance(store.get(a.id)), STARTING_CREDITS + 5000);

    // The 10×20 is the credit upgrade in between.
    assert.ok(upgradeCamp(store, camps, a, "plot_10x20", opts).ok);
    assert.equal(store.balance(store.get(a.id)), STARTING_CREDITS + 5000 - plotById("plot_10x20").price);

    // Give it back, claim a free one again.
    assert.ok(camps.release(a.id));
    assert.ok(claimCamp(store, camps, a, { ...SPOT, plot: "plot_10x10" }, opts).ok);
  } finally { done(); }
});

test("a premium account claims a 20×20 with the premium bundle set up", async () => {
  const { store, camps, done } = campWorld();
  try {
    const { account } = await store.signup("Baller", "tacos-forever");
    store.unlock("Baller", PREMIUM_MEMBERSHIP);
    const a = store.get(account.id);
    assert.equal(isPremiumMember(a), true);
    const owned = ownedCampItems(store, a);
    for (const id of PREMIUM_BUNDLE) assert.ok(owned.includes(id), id);
    const opts = { premium: true, owned };

    const out = claimCamp(store, camps, a, { x: 90, z: 130, plot: "plot_20x20" }, opts);
    assert.ok(out.ok, out.error);
    assert.equal(camps.of(a.id).plot, "plot_20x20");
    assert.deepEqual(camps.of(a.id).items, PREMIUM_BUNDLE);                                // LED tent, neon, lights, flag
    assert.equal(store.balance(store.get(a.id)), STARTING_CREDITS);                       // no credits involved

    // The bundle is theirs already, so the shop won't sell it to them.
    assert.match(buy(store, a.id, "neon", { premium: true }).error, /comes with your premium camp/);
    assert.match(buy(store, a.id, "tent_led", { premium: true }).error, /comes with your premium camp/);
    assert.equal(store.balance(store.get(a.id)), STARTING_CREDITS);

    // The LED tent's colour can be changed (to one of the offered colours).
    assert.equal(camps.setLed(a.id, LED_COLORS[2]).camp.led, LED_COLORS[2]);
    assert.equal(camps.setLed(a.id, "url(evil)").camp.led, LED_COLORS[0]);
  } finally { done(); }
});

test("premium upgrade from the free 10×10 costs nothing and adds the bundle; non-members can't have the LED tent", async () => {
  const { store, camps, done } = campWorld();
  try {
    const { account } = await store.signup("Climber", "tacos-forever");
    const a = store.get(account.id);
    buy(store, a.id, "chairs");
    assert.ok(claimCamp(store, camps, a, { ...SPOT, plot: "plot_10x10" }, { premium: false, owned: ownedCampItems(store, a) }).ok);
    camps.setItems(a.id, ["tent_basic", "chairs"], ownedCampItems(store, a));
    // Not a member: the LED tent isn't for sale and can't be set up.
    assert.match(buy(store, a.id, "tent_led").error, /isn't for sale/);
    assert.ok(!camps.setItems(a.id, ["tent_led", "chairs"], ownedCampItems(store, a)).camp.items.includes("tent_led"));
    assert.ok(buy(store, a.id, "lights").ok);                                              // but the lights are sold to anyone
    const before = store.balance(store.get(a.id));

    store.unlock("Climber", PREMIUM_MEMBERSHIP);
    const out = upgradeCamp(store, camps, store.get(a.id), "plot_20x20", { premium: true, owned: ownedCampItems(store, store.get(a.id)) });
    assert.ok(out.ok, out.error);
    assert.equal(camps.of(a.id).plot, "plot_20x20");
    assert.deepEqual(camps.of(a.id).items, [...PREMIUM_BUNDLE, "chairs"]);                 // kept their chairs, tent swapped for the LED one
    assert.equal(store.balance(store.get(a.id)), before);
  } finally { done(); }
});

// ---------- Camp items ----------
test("every camp item has a category, a placement and a price on the agreed scale", () => {
  const cats = new Set(CAMP_CATEGORIES.map((c) => c.id));
  for (const i of CAMP_ITEMS) {
    assert.ok(cats.has(i.cat), `${i.id} category`);
    assert.ok(Number.isInteger(i.price) && i.price >= 0 && i.price <= 900, `${i.id} price`);
    if (i.featured) assert.ok(i.price >= 500, `${i.id} is a showpiece`);
    if (i.on) assert.ok(i.place === "edge" && (i.on === "tent" || campItemById(i.on)), `${i.id} sits on something real`);
    if (i.premium) assert.ok(PREMIUM_BUNDLE.includes(i.id) && i.price === 0, `${i.id} is in the premium bundle`);
  }
  assert.deepEqual(FREE_CAMP_ITEMS, ["tent_basic"]);
  // The prices that were already in the shop haven't moved.
  const was = { tent_bell: 300, chairs: 60, cooler: 40, firepit: 150, canopy: 180, hammock: 150, pa: 600, lights: 80, flag: 100, neon: 500, lasers: 900, discoball: 700 };
  for (const [id, price] of Object.entries(was)) assert.equal(campItemById(id).price, price, id);
  // The new ones from the brief are all here.
  for (const id of ["tent_led", "tapestry", "tentflag", "couch", "picnictable", "rug", "grate", "fireworks", "totempole", "lanterns", "glowsticks",
    "grill", "tacostand", "drinkstation", "cookpot", "moviescreen", "hottub", "photoframe", "signpost", "flowers", "dog"]) assert.ok(campItemById(id), id);
  assert.ok(!shopCatalog().some((i) => i.id === "tent_led"), "the LED tent isn't sold for credits");
  assert.ok(shopCatalog().some((i) => i.id === "hottub" && i.kind === "camp" && i.featured));
});

test("new camp items can be bought and set up; things that sit on the tent or the fire pit need it", async () => {
  const { store, done } = temp();
  try {
    const { account } = await store.signup("Decorator", "tacos-forever");
    store.changeCredits(account.id, 20000, "console");
    for (const i of CAMP_ITEMS.filter((i) => i.price > 0 && !i.premium)) assert.ok(buy(store, account.id, i.id).ok, i.id);
    const owned = store.campItems(store.get(account.id));
    assert.equal(owned.length, CAMP_ITEMS.length - 1);                                     // everything but the premium LED tent

    // Edge items never use ground space, so all of them fit even on the free 10×10.
    const edge = CAMP_ITEMS.filter((i) => i.place === "edge" && !i.on).map((i) => i.id);
    assert.deepEqual(cleanCampItems(["tent_basic", ...edge], owned, "plot_10x10"), ["tent_basic", ...edge]);

    // A grate or pot needs the fire pit, and only one of them hangs over it at a time.
    assert.deepEqual(cleanCampItems(["tent_basic", "grate"], owned, "plot_10x10"), ["tent_basic"]);
    assert.deepEqual(cleanCampItems(["tent_basic", "firepit", "grate", "cookpot"], owned, "plot_10x10"), ["tent_basic", "firepit", "grate"]);
    assert.deepEqual(cleanCampItems(["cookpot", "firepit"], owned, "plot_10x10"), ["cookpot", "firepit"]);   // order doesn't matter
    // A tent flag or tapestry needs a tent.
    assert.deepEqual(cleanCampItems(["tentflag", "tapestry"], owned, "plot_10x10"), []);
    assert.deepEqual(cleanCampItems(["tent_bell", "tentflag", "tapestry"], owned, "plot_10x10"), ["tent_bell", "tentflag", "tapestry"]);

    // Ground items still have to fit: 2 on a 10×10, 12 on the 20×20.
    const ground = CAMP_ITEMS.filter((i) => i.place === "ground" && !i.group).map((i) => i.id);
    assert.equal(cleanCampItems(ground, owned, "plot_10x10").length, groundCapacity("plot_10x10"));
    assert.equal(cleanCampItems(ground, owned, "plot_20x20").length, Math.min(ground.length, groundCapacity("plot_20x20")));

    // What's set up is solid where it stands (the tent and each ground item), and nothing else.
    const solids = campSolids({ x: 10, z: 20, plot: "plot_10x10", items: ["tent_basic", "hottub", "rug", "lanterns"] });
    assert.equal(solids.length, 2);
    for (const s of solids) assert.ok(Math.abs(s.x - 10) <= 1.5 && Math.abs(s.z - 20) <= 1.5 && s.r > 0);
  } finally { done(); }
});
