// Credits: the festival's in-game currency. Shared so the server (which owns every balance) and the
// browser (which shows prices) agree on the numbers.
//
// How you get credits:
//   - everyone starts with STARTING_CREDITS
//   - side quests pay credits (QUEST_REWARDS): the full amount the first time, less on repeats,
//     and repeats stop paying after DAILY_REPEAT_CAP credits in a day (so quests can't be farmed)
//   - buying a credit pack with real money (CREDIT_PACKS). The packs and the hook are here, but no
//     payment provider is connected yet: grant credits with `npm run account -- credits <user> +500`.
//
// What credits buy (SHOP below): things for your camp (including featured ones like a PA system),
// a longer 10×20 camp spot, and premium personal items you wear around the festival. The basic
// 10×10 camp spot is FREE for every member; the 20×20 comes with premium membership and can't be
// bought with credits. (Ad space for businesses will be sold in dollars, not credits; see README.)
//
// The economy, as agreed: 100 credits ≈ $1. Small things 40–150 (one play session), mid-range 200–500
// (a few days of play or a few dollars), showpieces 600–1,000 (mostly bought, or about a week of play).
// Credits have no cash value, aren't refundable, can't be transferred between players, and don't expire.
//
// Prices are whole credits. Change them freely; nothing stores a price.

import { lookById } from "./characters.js";
import { accessoryById } from "./accessories.js";
import { partById } from "./parts.js";

export const STARTING_CREDITS = 500;
export const DAILY_REPEAT_CAP = 300;   // most credits a player can earn from REPEATING quests per UTC day

// Quest rewards, by quest id (shared/quests-data.js).
export const QUEST_REWARDS = {
  lostfound:  { first: 150, repeat: 40 },
  soundcheck: { first: 250, repeat: 70 },
  vendorrush: { first: 200, repeat: 60 },
  getweird:   { first: 180, repeat: 50 },   // business (sponsored) quest; same anti-farm rules as the rest
};

// Credit packs for real money. NOT LIVE: no payment provider is connected (see server/shop.js →
// grantPack, which a payment webhook will call). usd is what the store page will charge.
// The terms shown to players next to the packs (keep in step with the README).
export const CREDIT_TERMS = "Credits have no cash value, can't be refunded or transferred to other players, and never expire.";

export const CREDIT_PACKS = [
  { id: "pack_small",  credits: 500,  usd: 4.99,  name: "Handful" },
  { id: "pack_medium", credits: 1200, usd: 9.99,  name: "Pocketful", note: "+20% bonus" },
  { id: "pack_large",  credits: 2600, usd: 19.99, name: "Backpack",  note: "+30% bonus" },
];

// ---------- Premium membership ----------
// Premium in FestiVille IS the Hyre Personal membership of the Hyre Not Fyre app: there's no separate
// FestiVille price (Billiam, Nov 12, 2026). A premium member is an account with this unlock on it, on
// the same unlock list as premium looks (server/entitlements.js → isPremiumMember). Until FestiVille
// accounts are linked to Hyre Not Fyre, staff grant it by hand:
//   npm run account -- unlock <username> premium
// FestiVille charges nothing itself; MEMBERSHIP is only what the game tells players (name and price).
export const PREMIUM_MEMBERSHIP = "premium";
export const MEMBERSHIP = { name: "Hyre Personal", price: "$5/month or $50/year", app: "Hyre Not Fyre" };

// ---------- The golf cart ----------
// A premium, rideable status item (shared/rides.js), parked at your camp. Who gets one hasn't been
// decided, so both ways are built and this is the switch:
//   premium: true   every premium member has one (what's on now)
//   price: N        ALSO sell it in the shop for N credits to anyone (null = not for sale)
// An account can also be given one directly: npm run account -- unlock <username> golfcart
export const GOLF_CART = { id: "golfcart", name: "Golf cart", premium: true, price: null };

// ---------- Camp spots ----------
// The rule: every member gets ONE free 10×10 spot, like camping at a real festival. Premium members
// get a 20×20 (plus the premium bundle below). The 10×20 is a credit upgrade in between.
// One camp per account; you can move it, upgrade it or give it back.
// Sizes are named in feet like real festival camping; in the game, 10 ft ≈ 3 m. w × d in meters.
// price is in credits (0 = free). premium: true = comes with membership, never sold for credits.
export const PLOTS = [
  { id: "plot_10x10", name: "10×10 spot", w: 3, d: 3, price: 0 },
  { id: "plot_10x20", name: "10×20 spot", w: 3, d: 6, price: 450 },
  { id: "plot_20x20", name: "20×20 spot", w: 6, d: 6, price: 0, premium: true },
];
export const FREE_PLOT = "plot_10x10";
export const PREMIUM_PLOT = "plot_20x20";
export const plotById = (id) => PLOTS.find((p) => p.id === id) ?? null;
export const plotRank = (id) => PLOTS.findIndex((p) => p.id === id);

// ---------- Things for your camp ----------
// place: "ground" takes a slot inside the spot; "edge" goes around/above it (no slot).
// group: at most one item of a group is set up at a time (e.g. one tent).
// on:    sits on another item and is only set up while that one is ("tent" = whichever tent is up,
//        "firepit" = the fire pit). Uses no slot of its own.
// featured: the showpiece items (shown with a ★ in the shop).
// premium: comes with premium membership (PREMIUM_BUNDLE) and isn't sold for credits.
// cat: which heading it's listed under in the Camp tab (CAMP_CATEGORIES).
// Every camp comes with the basic tent for free.
export const CAMP_CATEGORIES = [
  { id: "shelter", name: "Shelter" },
  { id: "hangout", name: "Sitting and hanging out" },
  { id: "show",    name: "Light and show" },
  { id: "food",    name: "Food and drink" },
  { id: "social",  name: "Social and fun" },
];
export const CAMP_ITEMS = [
  // Shelter / tent
  { id: "tent_basic",  name: "Dome tent",      price: 0,   place: "ground", group: "tent", cat: "shelter" },
  { id: "tent_bell",   name: "Bell tent",      price: 300, place: "ground", group: "tent", cat: "shelter" },
  { id: "tent_led",    name: "LED tent",       price: 0,   place: "ground", group: "tent", cat: "shelter", premium: true },
  { id: "canopy",      name: "Shade canopy",   price: 180, place: "ground", cat: "shelter" },
  { id: "tapestry",    name: "Tent tapestry",  price: 120, place: "edge", on: "tent", cat: "shelter" },
  { id: "tentflag",    name: "Tent-top flag",  price: 60,  place: "edge", on: "tent", cat: "shelter" },
  // Sitting and hanging out
  { id: "chairs",      name: "Camp chairs",    price: 60,  place: "ground", cat: "hangout" },
  { id: "cooler",      name: "Cooler",         price: 40,  place: "ground", cat: "hangout" },
  { id: "firepit",     name: "Fire pit",       price: 150, place: "ground", cat: "hangout" },
  { id: "hammock",     name: "Hammock",        price: 150, place: "ground", cat: "hangout" },
  { id: "couch",       name: "Inflatable couch", price: 140, place: "ground", cat: "hangout" },
  { id: "picnictable", name: "Picnic table",   price: 120, place: "ground", cat: "hangout" },
  { id: "rug",         name: "Ground rug",     price: 50,  place: "edge", cat: "hangout" },
  { id: "grate",       name: "Cooking grate",  price: 40,  place: "edge", on: "firepit", group: "overfire", cat: "hangout" },
  // Light and show
  { id: "pa",          name: "PA system",      price: 600, place: "ground", featured: true, cat: "show" },
  { id: "lights",      name: "String lights",  price: 80,  place: "edge", cat: "show" },
  { id: "flag",        name: "Camp flag",      price: 100, place: "edge", cat: "show" },
  { id: "neon",        name: "Neon name sign", price: 500, place: "edge", featured: true, cat: "show" },
  { id: "lasers",      name: "Laser rig",      price: 900, place: "edge", featured: true, cat: "show" },
  { id: "discoball",   name: "Disco ball",     price: 700, place: "edge", featured: true, cat: "show" },
  { id: "fireworks",   name: "Fireworks launcher", price: 800, place: "edge", featured: true, cat: "show" },
  { id: "totempole",   name: "Lit totem pole", price: 450, place: "edge", cat: "show" },
  { id: "lanterns",    name: "Lanterns on posts", price: 120, place: "edge", cat: "show" },
  { id: "glowsticks",  name: "Glow stick border", price: 40, place: "edge", cat: "show" },
  // Food and drink
  { id: "grill",       name: "Grill and camp kitchen", price: 250, place: "ground", cat: "food" },
  { id: "tacostand",   name: "Mini taco stand", price: 500, place: "ground", featured: true, cat: "food" },
  { id: "drinkstation", name: "Lemonade stand", price: 200, place: "ground", cat: "food" },
  { id: "cookpot",     name: "Campfire cooking pot", price: 60, place: "edge", on: "firepit", group: "overfire", cat: "food" },
  // Social and fun
  { id: "moviescreen", name: "Outdoor movie screen", price: 700, place: "ground", featured: true, cat: "social" },
  { id: "hottub",      name: "Hot tub",        price: 850, place: "ground", featured: true, cat: "social" },
  { id: "photoframe",  name: "Photo booth frame", price: 300, place: "ground", cat: "social" },
  { id: "signpost",    name: "Camp signpost",  price: 80,  place: "edge", cat: "social" },
  { id: "flowers",     name: "Flower garden",  price: 90,  place: "edge", cat: "social" },
  { id: "dog",         name: "Camp dog",       price: 400, place: "edge", cat: "social" },
];
export const campItemById = (id) => CAMP_ITEMS.find((i) => i.id === id) ?? null;
export const FREE_CAMP_ITEMS = CAMP_ITEMS.filter((i) => i.price === 0 && !i.premium).map((i) => i.id);

// The premium bundle: what a premium member's camp gets on top of the 20×20, free. It's the
// "you can find my camp in the dark" set. Members don't buy these; non-members can still buy the
// neon sign, string lights and flag for credits (the LED tent is premium only).
export const PREMIUM_BUNDLE = ["tent_led", "neon", "lights", "flag"];

// Colours a premium member can set their LED tent to.
export const LED_COLORS = ["#ff4fa3", "#4fe3ff", "#7ee081", "#ffd36b", "#b44fff", "#ff7a3d", "#ffffff"];
export const cleanLedColor = (c) => (LED_COLORS.includes(c) ? c : LED_COLORS[0]);

// ---------- Premium personal items and looks ----------
// Prices for things that are unlocked on your account (the same unlocks `npm run account -- unlock`
// grants): premium accessories (shared/accessories.js), premium classic characters
// (shared/characters.js) and premium character parts (shared/parts.js). Anything premium that
// isn't priced here can't be bought, only granted.
export const UNLOCK_PRICES = {
  // Wear: accessories
  shutters: 150, heartglasses: 200, tophat: 250, totem: 350, halo: 400, wings: 500,
  // Looks: character parts
  hair_afro: 200, hair_frbraid: 200, hair_headband: 200,
  bottom_cargo: 200, bottom_maxi: 200, top_sweater: 250, shoes_platform: 250, shoes_tall: 250,
  top_suit: 300, acc_mask: 200, acc_longgloves: 150,
  // Looks: classic characters
  bigvegas: 800, jackie: 800, adam: 800,
};

// Anything premium that unlocks on an account: a classic character, an accessory or a character part.
export const unlockableById = (id) => lookById(id) || accessoryById(id) || partById(id) || null;

// Everything the shop sells besides camp spots, as one list:
// { id, name, price, kind: "wear" | "look" | "camp", featured? }.
export function shopCatalog() {
  const unlocks = Object.entries(UNLOCK_PRICES).map(([id, price]) => {
    const item = unlockableById(id);
    return item && item.tier === "premium" ? { id, name: item.name, price, kind: accessoryById(id) ? "wear" : "look" } : null;
  }).filter(Boolean);
  const camp = CAMP_ITEMS.filter((i) => i.price > 0 && !i.premium).map((i) => ({ id: i.id, name: i.name, price: i.price, kind: "camp", featured: !!i.featured }));
  return [...unlocks, ...camp];
}
