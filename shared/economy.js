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
// What credits buy (SHOP below): a camp spot in the Campground and bigger spots, things for your camp
// (including featured ones like a PA system), and premium personal items you wear around the
// festival. (Ad space for businesses will be sold in dollars, not credits; see README.)
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

// ---------- Camp spots ----------
// Sizes are named in feet like real festival camping; in the game, 10 ft ≈ 3 m. w × d in meters.
// slots: how many ground items (tents, chairs, PA…) fit; edge items (lights, flags, signs) don't use slots.
// price is the total; upgrading pays the difference.
export const PLOTS = [
  { id: "plot_10x10", name: "10×10 spot", w: 3, d: 3, price: 200 },
  { id: "plot_10x20", name: "10×20 spot", w: 3, d: 6, price: 450 },
  { id: "plot_20x20", name: "20×20 spot", w: 6, d: 6, price: 900 },
];
export const plotById = (id) => PLOTS.find((p) => p.id === id) ?? null;
export const plotRank = (id) => PLOTS.findIndex((p) => p.id === id);

// ---------- Things for your camp ----------
// place: "ground" takes a slot inside the spot; "edge" goes around/above it (no slot).
// group: at most one item of a group is set up at a time (e.g. one tent).
// featured: the showpiece items (shown with a ★ in the shop).
// Every camp comes with the basic tent for free.
export const CAMP_ITEMS = [
  { id: "tent_basic",  name: "Dome tent",      price: 0,   place: "ground", group: "tent" },
  { id: "tent_bell",   name: "Bell tent",      price: 300, place: "ground", group: "tent" },
  { id: "chairs",      name: "Camp chairs",    price: 60,  place: "ground" },
  { id: "cooler",      name: "Cooler",         price: 40,  place: "ground" },
  { id: "firepit",     name: "Fire pit",       price: 150, place: "ground" },
  { id: "canopy",      name: "Shade canopy",   price: 180, place: "ground" },
  { id: "hammock",     name: "Hammock",        price: 150, place: "ground" },
  { id: "pa",          name: "PA system",      price: 600, place: "ground", featured: true },
  { id: "lights",      name: "String lights",  price: 80,  place: "edge" },
  { id: "flag",        name: "Camp flag",      price: 100, place: "edge" },
  { id: "neon",        name: "Neon name sign", price: 500, place: "edge", featured: true },
  { id: "lasers",      name: "Laser rig",      price: 900, place: "edge", featured: true },
  { id: "discoball",   name: "Disco ball",     price: 700, place: "edge", featured: true },
];
export const campItemById = (id) => CAMP_ITEMS.find((i) => i.id === id) ?? null;
export const FREE_CAMP_ITEMS = CAMP_ITEMS.filter((i) => i.price === 0).map((i) => i.id);

// ---------- Premium personal items and looks ----------
// Prices for things that are unlocked on your account (the same unlocks `npm run account -- unlock`
// grants): premium accessories (shared/accessories.js), premium classic characters
// (shared/characters.js) and premium character parts (shared/parts.js). Anything premium that
// isn't priced here can't be bought, only granted.
export const UNLOCK_PRICES = {
  // Wear: accessories
  shutters: 150, heartglasses: 200, tophat: 250, totem: 350, halo: 400, wings: 500,
  // Looks: character parts
  hair_afro: 200, bottom_cargo: 200, top_hoodie: 250, shoes_platform: 250,
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
  const camp = CAMP_ITEMS.filter((i) => i.price > 0).map((i) => ({ id: i.id, name: i.name, price: i.price, kind: "camp", featured: !!i.featured }));
  return [...unlocks, ...camp];
}
