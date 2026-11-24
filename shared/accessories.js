// Cosmetic accessories players can wear on top of any character (hats, glasses, glow sticks, wings…).
// Purely for looks — they never affect gameplay. Free ones are available to everyone; premium ones
// are bought with credits in the shop (prices in shared/economy.js) or granted on an account
// (npm run account -- unlock <user> <id>), same as premium characters.
// The 3D shapes live in client/accessories.js; this file is the shared list the server validates against.

export const SLOTS = ["head", "face", "back", "hand"];   // at most one item per slot

export const ACCESSORIES = [
  { id: "cap",         name: "Baseball cap",  slot: "head", tier: "free" },
  { id: "flowercrown", name: "Flower crown",  slot: "head", tier: "free" },
  { id: "tophat",      name: "Top hat",       slot: "head", tier: "premium" },
  { id: "halo",        name: "Halo",          slot: "head", tier: "premium" },
  { id: "sunnies",     name: "Sunglasses",    slot: "face", tier: "free" },
  { id: "heartglasses",name: "Heart glasses", slot: "face", tier: "premium" },
  { id: "shutters",    name: "Shutter shades",slot: "face", tier: "premium" },
  { id: "glowstick",   name: "Glow stick",    slot: "hand", tier: "free" },
  { id: "totem",       name: "Festival totem",slot: "hand", tier: "premium" },
  { id: "wings",       name: "Fairy wings",   slot: "back", tier: "premium" },
];

export const accessoryById = (id) => ACCESSORIES.find((a) => a.id === id) ?? null;

// Clean a requested set (array, or comma-separated string) into a tidy list of valid ids:
// at most one per slot, known ids only, stable order. Does NOT check unlocks — that's the server's job.
export function normalizeAccessories(requested) {
  const ids = Array.isArray(requested) ? requested : typeof requested === "string" ? requested.split(",") : [];
  const bySlot = new Map();
  for (const raw of ids) {
    const a = accessoryById(String(raw).trim());
    if (a && !bySlot.has(a.slot)) bySlot.set(a.slot, a.id);
  }
  // Keep them in SLOTS order so the stored string is deterministic.
  return SLOTS.map((s) => bySlot.get(s)).filter(Boolean);
}
