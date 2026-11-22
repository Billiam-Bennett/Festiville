// Who may use which premium cosmetics.
// A player may use a premium look if it's unlocked on their account (for now you grant it with
// `npm run account -- unlock <username> <look>`; later a payment would do the same), or if the
// server is started with FV_UNLOCK_ALL=1 for testing:
//   FV_UNLOCK_ALL=1 npm start          (Mac/Linux)
//   set FV_UNLOCK_ALL=1 && npm start   (Windows)
import { CHARACTERS, lookById, DEFAULT_LOOK } from "../shared/characters.js";
import { accessoryById, normalizeAccessories } from "../shared/accessories.js";
import { PARTS, partById, parseRecipe, formatRecipe, defaultPart } from "../shared/parts.js";
import { PREMIUM_MEMBERSHIP, PREMIUM_BUNDLE, GOLF_CART } from "../shared/economy.js";

const UNLOCK_ALL = process.env.FV_UNLOCK_ALL === "1";

// Printed at startup so you can check the server has the character list you expect.
const ids = (tier) => CHARACTERS.filter((c) => c.tier === tier).map((c) => c.id).join(", ") || "none";
console.log(`Characters: free = ${ids("free")} | premium = ${ids("premium")}${UNLOCK_ALL ? " (UNLOCKED for testing)" : " (locked unless unlocked on an account)"}`);
const partIds = (tier) => PARTS.filter((p) => p.tier === tier).map((p) => p.id).join(", ") || "none";
console.log(`Character parts: free = ${partIds("free")} | premium = ${partIds("premium")}`);

export function canUseLook(account, lookId) {
  const look = lookById(lookId);
  if (!look) return false;
  return look.tier === "free" || UNLOCK_ALL || !!account?.unlocks?.includes(look.id);
}

// The look a player actually gets: what they asked for if allowed, otherwise the default.
export function resolveLook(account, requested) {
  return canUseLook(account, requested) ? requested : DEFAULT_LOOK;
}

// Cosmetic accessories: free ones are open to all; premium ones need an unlock on the account.
export function canUseAccessory(account, id) {
  const a = accessoryById(id);
  if (!a) return false;
  return a.tier === "free" || UNLOCK_ALL || !!account?.unlocks?.includes(a.id);
}

// The accessories a player actually gets: their requested set, minus any premium ones they haven't unlocked.
export function resolveAccessories(account, requested) {
  return normalizeAccessories(requested).filter((id) => canUseAccessory(account, id));
}

// Character parts (shared/parts.js): free ones are open to all; premium ones need an unlock on the account.
export function canUsePart(account, id) {
  const p = partById(id);
  if (!p) return false;
  return p.tier === "free" || UNLOCK_ALL || !!account?.unlocks?.includes(p.id);
}

// The recipe a player actually gets: their requested recipe cleaned up (normalizeRecipe rules), with
// any locked premium part swapped for the slot's free default (same color), or removed if there is none.
// "" means no recipe: the player uses a classic whole character.
export function resolveRecipe(account, requested) {
  const r = parseRecipe(requested);
  if (!r) return "";
  for (const [slot, p] of Object.entries(r.parts)) {
    if (canUsePart(account, p.id)) continue;
    const d = defaultPart(r.body, slot);
    if (d && d.id !== p.id && canUsePart(account, d.id)) r.parts[slot] = { id: d.id, color: p.color };
    else delete r.parts[slot];
  }
  return formatRecipe(r);
}

// Everything a player looks like, as the server will store and sync it. A player has EITHER a
// recipe (a parts-based character) OR just a classic look; `look` is always kept too, so browsers
// without the part files can still show something sensible.
//   requested: what the browser asked for ({ look?, recipe?, accessories? }); missing fields keep `current`.
//   Asking for a look without a recipe switches back to the classic character.
export function resolveAppearance(account, requested = {}, current = {}) {
  const wantLook = typeof requested.look === "string" && requested.look ? requested.look : current.look;
  const look = resolveLook(account, wantLook);
  const wantRecipe = typeof requested.recipe === "string" ? requested.recipe
    : typeof requested.look === "string" && requested.look ? ""
    : current.recipe ?? "";
  const recipe = resolveRecipe(account, wantRecipe);
  const accessories = resolveAccessories(account, requested.accessories !== undefined ? requested.accessories : current.accessories);
  return { look, recipe, accessories };
}

// Anything premium that can be unlocked on an account, by id (characters, accessories, parts).
export const unlockableById = (id) => lookById(id) || accessoryById(id) || partById(id) || null;

// ---------- Premium membership ----------
// A paid/premium member is an account with the "premium" unlock (the same unlock list premium looks
// use): `npm run account -- unlock <username> premium`, later a membership payment. Members get the
// 20×20 camp spot and the premium camp bundle; nothing else is gated. Hanging out is always free.
export function isPremiumMember(account) {
  return UNLOCK_ALL || !!account?.unlocks?.includes(PREMIUM_MEMBERSHIP);
}

// Camp items a player may set up: the ones they own (plus the free ones), and for premium members
// the premium bundle. `store` is the AccountStore.
export function ownedCampItems(store, account) {
  return [...new Set([...store.campItems(account), ...(isPremiumMember(account) ? PREMIUM_BUNDLE : [])])];
}

// The golf cart: premium members have one (while GOLF_CART.premium is on), and so does any account
// with the "golfcart" unlock (bought in the shop when GOLF_CART.price is set, or granted by hand).
export function hasGolfCart(account) {
  return UNLOCK_ALL || (GOLF_CART.premium && isPremiumMember(account)) || !!account?.unlocks?.includes(GOLF_CART.id);
}
