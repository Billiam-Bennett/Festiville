// The cast: every character players can pick. Shared so the server can check a player's choice.
//
// To add a character: put its .glb in client/assets/characters/, fit the animations to it with
//   npm run retarget -- client/assets/characters/<id>.glb Idle=idle.glb Walk=walk.glb Run=run.glb Dance=dance.glb
// (that writes <id>.anims.json next to it), then add a line below. See README → "Adding characters".
//
// tier: "free" for everyone, or "premium" (a paid cosmetic). Premium never gates anything but looks:
// everyone can walk, hang out, crew up and quest. The SERVER decides who may use a premium look
// (server/entitlements.js), so it can't be unlocked by editing the browser.
export const CHARACTERS = [
  // Free — the everyday cast, six looks so a fresh player has real variety without paying.
  { id: "michelle", name: "Michelle",  model: "characters/michelle.glb", tier: "free" },
  { id: "remy",     name: "Remy",      model: "characters/remy.glb",     tier: "free" },
  { id: "sophie",   name: "Sophie",    model: "characters/sophie.glb",   tier: "free" },
  { id: "bryce",    name: "Bryce",     model: "characters/bryce.glb",    tier: "free" },
  { id: "kate",     name: "Kate",      model: "characters/kate.glb",     tier: "free" },
  { id: "jody",     name: "Jody",      model: "characters/jody.glb",     tier: "free" },
  // Premium — the distinctive looks. Server enforces entitlement; the picker just shows a lock.
  { id: "bigvegas", name: "Big Vegas", model: "characters/bigvegas.glb", tier: "premium" },
  { id: "jackie",   name: "Jackie",    model: "characters/jackie.glb",   tier: "premium" },
  { id: "adam",     name: "Adam",      model: "characters/adam.glb",     tier: "premium" },
];

export const DEFAULT_LOOK = CHARACTERS.find((c) => c.tier === "free").id;
export const lookById = (id) => CHARACTERS.find((c) => c.id === id) ?? null;
// Animations fitted to each character live next to its model.
export const animsFor = (c) => c.model.replace(/\.glb$/i, ".anims.json");
