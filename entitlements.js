// Who may use which premium cosmetics.
// A player may use a premium look if it's unlocked on their account (for now you grant it with
// `npm run account -- unlock <username> <look>`; later a payment would do the same), or if the
// server is started with FV_UNLOCK_ALL=1 for testing:
//   FV_UNLOCK_ALL=1 npm start          (Mac/Linux)
//   set FV_UNLOCK_ALL=1 && npm start   (Windows)
import { CHARACTERS, lookById, DEFAULT_LOOK } from "../shared/characters.js";
import { accessoryById, normalizeAccessories } from "../shared/accessories.js";

const UNLOCK_ALL = process.env.FV_UNLOCK_ALL === "1";

// Printed at startup so you can check the server has the character list you expect.
const ids = (tier) => CHARACTERS.filter((c) => c.tier === tier).map((c) => c.id).join(", ") || "none";
console.log(`Characters: free = ${ids("free")} | premium = ${ids("premium")}${UNLOCK_ALL ? " (UNLOCKED for testing)" : " (locked unless unlocked on an account)"}`);

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
