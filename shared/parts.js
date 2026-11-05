// Parts-based characters: players build their own look from a base body plus hair, eyebrows and
// clothes. Shared so the server can check a player's recipe (server/entitlements.js) and the
// browser can build it (client/avatar.js) and offer it in the picker (client/look-builder.js).
//
// The art comes from MakeHuman (MPFB in Blender, CC0 assets). Every file is rigged to ONE shared
// skeleton with Mixamo bone names (mixamorigHips, mixamorigHead, …), so one animation set fits all.
//
// FILE LAYOUT (the "asset contract"; see README → "Adding characters"):
//   client/assets/parts/<body>/body.glb       the base body: skinned mesh + the mixamorig* skeleton
//   client/assets/parts/<body>/<partId>.glb   one per part, skinned to bones with the same names
//   client/assets/parts/<body>/anims.json     the body's animations (Idle, Walk, Run, optional Dance), shared by
//                                             every part combination; written by `npm run retarget` (see scripts/retarget.mjs)
//   client/assets/parts/manifest.json         written by scripts/make-parts.py: each part's slot and hide bit
// <body> is "female" or "male". A part is exported once per body it supports (listed in `bodies`).
//
// TO ADD A PART: export it from Blender as client/assets/parts/<body>/<id>.glb for each body,
// then add a line to PARTS below. Ids are short, lowercase, unique across ALL parts, characters
// and accessories (premium unlocks share one list per account), and use only a-z, 0-9, _ and -.
//
// COLORS are tinted in the game, not baked into the files: the game multiplies each material's
// base color by the chosen swatch, so author tintable textures in light grey / white. Parts with
// tint: false keep their own printed colors (the picker shows no swatches for them). Materials
// whose name contains "eye", "teeth", "tongue", "lash", "fixed" or "notint" are never tinted.
//
// tier: "free" for everyone, or "premium" (a paid cosmetic), exactly like characters and
// accessories: `npm run account -- unlock <user> <partId>`. Premium never gates anything but looks.

export const BODIES = [
  { id: "female", name: "Female" },
  { id: "male",   name: "Male" },
];

// Skin tones, light to deep. The index is what's stored in a recipe, so only ever ADD to the end
// (changing or reordering an entry changes everyone who picked it).
export const SKIN_TONES = [
  "#f6d7c3", "#eac0a2", "#d9a37f", "#c68642", "#a8693f", "#8d5524", "#6b3e1f", "#4a2a17",
];

// Same rule as skin tones: append only.
export const HAIR_COLORS = [
  "#1b1512", "#3b2a20", "#6a4630", "#a8743f", "#e2c47c", "#b5482a", "#d9d6d0", "#ff4fa3", "#5ad1ff", "#9b7bff",
];
export const CLOTH_COLORS = [
  "#f4f1ea", "#22222a", "#ff4fa3", "#ffd36b", "#5ad1ff", "#7ee081", "#9b7bff", "#ff7a3d", "#3a5ba0", "#8a6a4f",
];

// The slots, in recipe order. required: a recipe always has one (the first free part that fits the
// body is the default). emptyChance: how often randomRecipe() leaves an optional slot empty.
export const PART_SLOTS = [
  { id: "hair",     name: "Hair",     required: false, colors: HAIR_COLORS,  emptyChance: 0.1 },
  { id: "eyebrows", name: "Eyebrows", required: false, colors: HAIR_COLORS,  emptyChance: 0.05 },
  { id: "top",      name: "Top",      required: true,  colors: CLOTH_COLORS },
  { id: "bottom",   name: "Bottom",   required: true,  colors: CLOTH_COLORS },
  { id: "shoes",    name: "Shoes",    required: false, colors: CLOTH_COLORS, emptyChance: 0 },
];

// The catalog. Files come from scripts/make-parts.py (MakeHuman CC0 assets): `file` is the exported
// file name in client/assets/parts/<body>/ (a string, or { female, male } when each body uses its own).
// The first free part in each required slot (per body) is that slot's default.
// tint: false = the part keeps its own printed colors/pattern (no swatches). Hair and eyebrows are
// exported light grey, so they take the hair color swatches.
const BOTH = ["female", "male"];
export const PARTS = [
  // Hair
  { id: "hair_short",    name: "Short",        slot: "hair",     bodies: BOTH, tier: "free",    file: "short02" },
  { id: "hair_bob",      name: "Bob",          slot: "hair",     bodies: BOTH, tier: "free",    file: "bob01" },
  { id: "hair_long",     name: "Long",         slot: "hair",     bodies: BOTH, tier: "free",    file: "long01" },
  { id: "hair_ponytail", name: "Ponytail",     slot: "hair",     bodies: BOTH, tier: "free",    file: "ponytail01" },
  { id: "hair_braid",    name: "Braid",        slot: "hair",     bodies: BOTH, tier: "free",    file: "braid01" },
  { id: "hair_cropped",  name: "Cropped",      slot: "hair",     bodies: BOTH, tier: "free",    file: "short01" },
  { id: "hair_buzz",     name: "Buzz",         slot: "hair",     bodies: BOTH, tier: "free",    file: "short04" },
  { id: "hair_messy",    name: "Messy",        slot: "hair",     bodies: BOTH, tier: "free",    file: "cortu_short_messy_hair" },
  { id: "hair_bun",      name: "Bun",          slot: "hair",     bodies: BOTH, tier: "free",    file: "rehmanpolanski_hair_bun_brown" },
  { id: "hair_frbraid",  name: "French braid", slot: "hair",     bodies: BOTH, tier: "premium", file: "elvs_french_braid_variation" },
  { id: "hair_headband", name: "Headband",     slot: "hair",     bodies: BOTH, tier: "premium", file: "sonntag78_blond_with_headband" },
  { id: "hair_afro",     name: "Afro",         slot: "hair",     bodies: BOTH, tier: "premium", file: "afro01" },
  // Eyebrows
  { id: "brows_soft",    name: "Soft",         slot: "eyebrows", bodies: BOTH, tier: "free",    file: "eyebrow001" },
  { id: "brows_arched",  name: "Arched",       slot: "eyebrows", bodies: BOTH, tier: "free",    file: "eyebrow006" },
  { id: "brows_bold",    name: "Bold",         slot: "eyebrows", bodies: BOTH, tier: "free",    file: "eyebrow010" },
  // Tops
  { id: "top_tee",       name: "Grey tee",     slot: "top",      bodies: BOTH, tier: "free",    file: "toigo_basic_tucked_t-shirt", tint: false },
  { id: "top_loosetee",  name: "White tee",    slot: "top",      bodies: BOTH, tier: "free",    tint: false,
    file: { female: "joepal_crude_t-shirt_female", male: "elvs_crude_t-shirt_male" } },
  { id: "top_tank",      name: "Giraffe tank", slot: "top",      bodies: BOTH, tier: "free",    file: "toigo_keyhole_tank_top", tint: false },
  { id: "top_camisole",  name: "Camisole",     slot: "top",      bodies: BOTH, tier: "free",    file: "toigo_camisole_top", tint: false },
  { id: "top_halter",    name: "Halter",       slot: "top",      bodies: BOTH, tier: "free",    file: "toigo_turtleneck_halter_top", tint: false },
  { id: "top_crop",      name: "Tube top",     slot: "top",      bodies: ["female"], tier: "free", file: "skalldyrssuppe_tube_top_funky_colors", tint: false },
  { id: "top_polo",      name: "Polo",         slot: "top",      bodies: BOTH, tier: "free",    file: "namuhekam_male_polo_shirt", tint: false },
  { id: "top_sweater",   name: "Sweater",      slot: "top",      bodies: BOTH, tier: "premium", file: "toigo_fisherman_sweater", tint: false },
  // Bottoms
  { id: "bottom_pants",  name: "Black pants",  slot: "bottom",   bodies: BOTH, tier: "free",    file: "toigo_wool_pants", tint: false },
  { id: "bottom_shorts", name: "Jean shorts",  slot: "bottom",   bodies: BOTH, tier: "free",    file: "cortu_jeans_shorts", tint: false },
  { id: "bottom_harem",  name: "Harem pants",  slot: "bottom",   bodies: BOTH, tier: "free",    file: "toigo_harem_pants", tint: false },
  { id: "bottom_skirt",  name: "Plaid mini",   slot: "bottom",   bodies: BOTH, tier: "free",    file: "frankyaye_mini_skirt_01", tint: false },
  { id: "bottom_ruffle", name: "Ruffle skirt", slot: "bottom",   bodies: BOTH, tier: "free",    file: "toigo_tiered_mini_skirt", tint: false },
  { id: "bottom_cargo",  name: "Cargo pants",  slot: "bottom",   bodies: BOTH, tier: "premium", file: "cortu_cargo_pants", tint: false },
  { id: "bottom_maxi",   name: "Maxi skirt",   slot: "bottom",   bodies: BOTH, tier: "premium", file: "toigo_long_full_skirt", tint: false },
  // Shoes
  { id: "shoes_sneakers",name: "Brown sneakers", slot: "shoes",  bodies: BOTH, tier: "free",    file: "shoes01", tint: false },
  { id: "shoes_grey",    name: "Grey sneakers",  slot: "shoes",  bodies: BOTH, tier: "free",    file: "shoes05", tint: false },
  { id: "shoes_blue",    name: "Blue sneakers",  slot: "shoes",  bodies: BOTH, tier: "free",    file: "shoes06", tint: false },
  { id: "shoes_black",   name: "Black sneakers", slot: "shoes",  bodies: BOTH, tier: "free",    file: "shoes04", tint: false },
  { id: "shoes_dark",    name: "Dark sneakers",  slot: "shoes",  bodies: BOTH, tier: "free",    file: "shoes02", tint: false },
  { id: "shoes_combat",  name: "Combat boots",   slot: "shoes",  bodies: BOTH, tier: "free",    file: "shoes03", tint: false },
  { id: "shoes_boots",   name: "Ankle boots",    slot: "shoes",  bodies: BOTH, tier: "free",    file: "toigo_ankle_boots_male", tint: false },
  { id: "shoes_flats",   name: "Flats",          slot: "shoes",  bodies: BOTH, tier: "free",    file: "toigo_flats", tint: false },
  { id: "shoes_platform",name: "Go-go platforms", slot: "shoes", bodies: BOTH, tier: "premium", file: "scailman_gogo_platform_boots", tint: false },
  { id: "shoes_tall",    name: "Tall boots",     slot: "shoes",  bodies: BOTH, tier: "premium", file: "culturalibre_male_boots", tint: false },
];

export const bodyById = (id) => BODIES.find((b) => b.id === id) ?? null;
export const partSlotById = (id) => PART_SLOTS.find((s) => s.id === id) ?? null;
export const partById = (id) => PARTS.find((p) => p.id === id) ?? null;
// Parts that fit a body in a slot, in catalog order.
export const partsFor = (body, slot) => PARTS.filter((p) => p.slot === slot && p.bodies.includes(body));
// The default part for a slot: first free one that fits the body (null for an optional slot is fine).
export const defaultPart = (body, slot) => partsFor(body, slot).find((p) => p.tier === "free") ?? null;
// Where the files live, relative to client/assets/.
export const bodyModel = (body) => `parts/${body}/body.glb`;
export function partModel(body, partId) {
  const f = partById(partId)?.file ?? partId;
  return `parts/${body}/${typeof f === "string" ? f : f[body] ?? partId}.glb`;
}
// The part's swatch color, or null when the part keeps its own colors (tint: false).
export const partTintHex = (partId, slot, i) => (partById(partId)?.tint === false ? null : partColorHex(slot, i));
export const partsAnims = (body) => `parts/${body}/anims.json`;

export const skinHex = (i) => SKIN_TONES[i] ?? SKIN_TONES[0];
export const partColorHex = (slot, i) => { const c = partSlotById(slot)?.colors ?? []; return c[i] ?? c[0] ?? "#ffffff"; };

// ---------- Recipes ----------
// A recipe is one short, deterministic string: body, skin tone index, then slot=part:color for each
// filled slot, in PART_SLOTS order, joined with ";". Colors are palette indices. Empty slots are left out.
//   female;3;hair=hair_bob:4;eyebrows=brows_soft:1;top=top_tank:2;bottom=bottom_shorts:8;shoes=shoes_sneakers:0
// It's what the server stores on the account and syncs to other players.
export const MAX_RECIPE_LENGTH = 300;
const ID = /^[a-z0-9_-]{1,32}$/;
const index = (v, len) => { const n = Number(v); return Number.isInteger(n) && n >= 0 && n < len ? n : 0; };

// Recipe string (or object) -> { body, skin, parts: { slot: { id, color } } }, or null if it isn't a
// recipe at all. Cleans as it goes: unknown slots/parts are dropped, out-of-range colors become 0,
// parts that don't fit the body are dropped, and required slots get their default.
// Does NOT check unlocks; that's the server's job (server/entitlements.js).
export function parseRecipe(input) {
  let body, skin, wanted = [];
  if (typeof input === "string") {
    if (!input || input.length > MAX_RECIPE_LENGTH) return null;
    const [b, s, ...rest] = input.trim().split(";");
    body = b; skin = s;
    for (const tok of rest) {
      const eq = tok.indexOf("=");
      if (eq < 0) continue;
      const [id, color] = tok.slice(eq + 1).split(":");
      wanted.push([tok.slice(0, eq).trim(), id?.trim(), color]);
    }
  } else if (input && typeof input === "object") {
    body = input.body; skin = input.skin;
    for (const [slot, v] of Object.entries(input.parts ?? {})) {
      if (typeof v === "string") wanted.push([slot, v, 0]);
      else if (v && typeof v === "object") wanted.push([slot, v.id, v.color]);
    }
  } else return null;

  body = typeof body === "string" ? body.trim() : "";
  if (!bodyById(body)) return null;
  const out = { body, skin: index(skin, SKIN_TONES.length), parts: {} };
  for (const [slotId, id, color] of wanted) {
    const slot = partSlotById(slotId);
    const part = typeof id === "string" && ID.test(id) ? partById(id) : null;
    if (!slot || !part || part.slot !== slot.id || out.parts[slot.id] || !part.bodies.includes(body)) continue;
    out.parts[slot.id] = { id: part.id, color: index(color, slot.colors.length) };
  }
  for (const slot of PART_SLOTS) {
    if (!slot.required || out.parts[slot.id]) continue;
    const d = defaultPart(body, slot.id);
    if (d) out.parts[slot.id] = { id: d.id, color: 0 };
  }
  return out;
}

// { body, skin, parts } -> canonical recipe string (assumes it's already clean; use normalizeRecipe otherwise).
export function formatRecipe(r) {
  const bits = [r.body, String(r.skin)];
  for (const slot of PART_SLOTS) {
    const p = r.parts[slot.id];
    if (p) bits.push(`${slot.id}=${p.id}:${p.color}`);
  }
  return bits.join(";");
}

// Clean a requested recipe (string or object) into its canonical string, or "" if it isn't a valid
// recipe (no recipe = the player uses a classic whole character). Like normalizeAccessories().
export function normalizeRecipe(input) {
  const r = parseRecipe(input);
  return r ? formatRecipe(r) : "";
}

// Every part id a recipe uses (for entitlement checks).
export const recipePartIds = (recipe) => Object.values(parseRecipe(recipe)?.parts ?? {}).map((p) => p.id);

// A random, valid recipe. rng() returns 0..1 (Math.random, or seededRandom(…) for repeatable NPCs).
// By default only free parts are used; pass allow(part) to include e.g. the player's unlocked ones.
export function randomRecipe(rng = Math.random, { body, allow = (p) => p.tier === "free" } = {}) {
  const pick = (list) => list[Math.min(list.length - 1, Math.floor(rng() * list.length))];
  const b = bodyById(body) ? body : pick(BODIES).id;
  const r = { body: b, skin: Math.floor(rng() * SKIN_TONES.length) % SKIN_TONES.length, parts: {} };
  for (const slot of PART_SLOTS) {
    const options = partsFor(b, slot.id).filter(allow);
    const skip = !slot.required && rng() < (slot.emptyChance ?? 0);
    if (!options.length || skip) continue;
    r.parts[slot.id] = { id: pick(options).id, color: Math.floor(rng() * slot.colors.length) % slot.colors.length };
  }
  return normalizeRecipe(r);   // fills any required slot `allow` left empty
}

// Small deterministic RNG from a string seed (mulberry32), so an NPC looks the same on every screen.
export function seededRandom(seed) {
  let h = 1779033703 ^ String(seed).length;
  for (const ch of String(seed)) { h = Math.imul(h ^ ch.charCodeAt(0), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
