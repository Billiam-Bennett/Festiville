// Parts-based characters: players build their own look from a base body (with a build, face and
// height) plus hair, eyebrows, clothes, a hat, an accessory and a bag. Shared so the server can check a player's recipe (server/entitlements.js) and the
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
// body.glb also holds the body SHAPES (BUILDS and FACES below) as morph targets named "build_<id>" and
// "face_<id>"; the game bakes the chosen ones into the body and refits the parts to match, so parts are
// exported once per body, never per shape.
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

// Body shapes. A recipe stores each by id (build=heavy); the first entry of each list is the default
// and is left out of the recipe, so recipes made before shapes existed still mean the same thing.
// Builds and faces are morph targets in body.glb ("build_slim", "face_round", … made by SHAPES in
// scripts/make-parts.py); height just scales the whole avatar. To add one: add it to SHAPES there,
// re-run the script, then add it here. Only ever ADD entries (ids are stored in saved recipes).
export const BUILDS = [
  { id: "average",  name: "Average" },
  { id: "slim",     name: "Slim" },
  { id: "heavy",    name: "Heavy" },
  { id: "athletic", name: "Athletic" },
];
export const FACES = [
  { id: "classic", name: "Classic" },
  { id: "round",   name: "Round" },
  { id: "angular", name: "Angular" },
  { id: "heart",   name: "Heart" },
];
export const HEIGHTS = [
  { id: "average", name: "Average", scale: 1 },
  { id: "short",   name: "Short",   scale: 0.94 },
  { id: "tall",    name: "Tall",    scale: 1.06 },
];
// In recipe order. morph: the morph target name prefix in body.glb (none for height).
export const SHAPE_KINDS = [
  { id: "build",  name: "Build",  options: BUILDS,  morph: "build_" },
  { id: "face",   name: "Face",   options: FACES,   morph: "face_" },
  { id: "height", name: "Height", options: HEIGHTS },
];
export const shapeKindById = (id) => SHAPE_KINDS.find((k) => k.id === id) ?? null;
// The body.glb morph targets a recipe's shape uses, e.g. ["build_heavy", "face_round"] (none for defaults).
export const shapeMorphs = (shape = {}) => SHAPE_KINDS.filter((k) => k.morph && shape[k.id] && shape[k.id] !== k.options[0].id)
  .map((k) => k.morph + shape[k.id]);
export const heightScale = (shape = {}) => HEIGHTS.find((h) => h.id === shape.height)?.scale ?? 1;

// The slots, in recipe order. required: a recipe always has one (the first free part that fits the
// body is the default). emptyChance: how often randomRecipe() leaves an optional slot empty.
// formerly: slots this slot's parts used to live in; a recipe that still names one of its parts under
// the old slot is moved over (hats were in "accessory" until they got their own slot).
export const PART_SLOTS = [
  { id: "hair",     name: "Hair",     required: false, colors: HAIR_COLORS,  emptyChance: 0.1 },
  { id: "eyebrows", name: "Eyebrows", required: false, colors: HAIR_COLORS,  emptyChance: 0.05 },
  { id: "top",      name: "Top",      required: true,  colors: CLOTH_COLORS },
  { id: "bottom",   name: "Bottom",   required: true,  colors: CLOTH_COLORS },
  { id: "shoes",    name: "Shoes",    required: false, colors: CLOTH_COLORS, emptyChance: 0 },
  { id: "hat",      name: "Hat",      required: false, colors: CLOTH_COLORS, emptyChance: 0.7, formerly: ["accessory"] },
  { id: "accessory", name: "Accessory", required: false, colors: CLOTH_COLORS, emptyChance: 0.6 },
  { id: "bag",      name: "Bag",      required: false, colors: CLOTH_COLORS, emptyChance: 0.75 },
];

// The catalog. Files come from scripts/make-parts.py (MakeHuman CC0 assets): `file` is the exported
// file name in client/assets/parts/<body>/ (a string, or { female, male } when each body uses its own).
// The first free part in each required slot (per body) is that slot's default.
// license: every part is CC0 unless it says otherwise. A "CC-BY" part also names its `author` (and the
// original's, for an adaptation), and must be credited in client/assets/parts/CREDITS.md (a test checks).
// tint: false = the part keeps its own printed colors/pattern (no swatches). Hair and eyebrows are
// exported light grey, so they take the hair color swatches. Plain hats and accessories (white, grey
// felt) take the cloth swatches; printed ones (3D glasses, leopard frames…) keep their own colors.
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
  { id: "hair_bangsbob", name: "Bob with bangs", slot: "hair",   bodies: BOTH, tier: "free",    file: "toigo_blunt_bob_with_bangs" },
  { id: "hair_invbob",   name: "Inverted bob", slot: "hair",     bodies: BOTH, tier: "free",    file: "toigo_inverted_bob" },
  { id: "hair_short6",   name: "Swept short",  slot: "hair",     bodies: BOTH, tier: "free",    file: "culturalibre_hair_06" },
  { id: "hair_shaggy",   name: "Shaggy",       slot: "hair",     bodies: BOTH, tier: "free",    file: "cortu_shaggy_green_hair" },
  { id: "hair_twinbraid",name: "Double braid", slot: "hair",     bodies: BOTH, tier: "free",    file: "elvs_double_mh_braid" },
  { id: "hair_braidbun", name: "Braided bun",  slot: "hair",     bodies: BOTH, tier: "free",    file: "elvs_reverse_french_braid_bun" },
  { id: "hair_anime",    name: "Anime",        slot: "hair",     bodies: BOTH, tier: "premium", file: "learning_anime_hair" },
  { id: "hair_cloud",    name: "Curly cloud",  slot: "hair",     bodies: BOTH, tier: "premium", file: "cortu_strawberry_cloud_hair" },
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
  { id: "top_puffer",    name: "Puffer jacket", slot: "top",     bodies: BOTH, tier: "free",    file: "puffer_jacket", tint: false },
  { id: "top_striped",   name: "Striped shirt", slot: "top",     bodies: BOTH, tier: "free",    file: "striped_shirt", tint: false },
  { id: "top_longsleeve",name: "Long-sleeve tee", slot: "top",   bodies: BOTH, tier: "free",    file: "logo_longsleeve", tint: false },
  { id: "top_logotee",   name: "Logo tee",     slot: "top",      bodies: BOTH, tier: "free",    file: "logo_tee", tint: false },
  { id: "top_sportcrop", name: "Sports crop",  slot: "top",      bodies: ["female"], tier: "free", file: "sport_crop", tint: false },
  { id: "top_labcoat",   name: "Long coat",    slot: "top",      bodies: BOTH, tier: "free",    tint: false,
    file: { female: "crude_lab_coat_open_female", male: "male_crude_labcoat" } },
  { id: "top_suit",      name: "Suit jacket",  slot: "top",      bodies: BOTH, tier: "premium", file: "suit_jacket", tint: false },
  { id: "top_bodice",    name: "Bodice top",   slot: "top",      bodies: ["female"], tier: "free", file: "toigo_bodice-style_top", tint: false },
  { id: "top_pinksuit",  name: "Pink blazer",  slot: "top",      bodies: BOTH, tier: "free",    file: "pink_suit_jacket", tint: false },
  { id: "top_tux",       name: "White dinner jacket", slot: "top", bodies: BOTH, tier: "premium", file: "dinner_jacket", tint: false },
  // Bottoms
  { id: "bottom_pants",  name: "Black pants",  slot: "bottom",   bodies: BOTH, tier: "free",    file: "toigo_wool_pants", tint: false },
  { id: "bottom_shorts", name: "Jean shorts",  slot: "bottom",   bodies: BOTH, tier: "free",    file: "cortu_jeans_shorts", tint: false },
  { id: "bottom_harem",  name: "Harem pants",  slot: "bottom",   bodies: BOTH, tier: "free",    file: "toigo_harem_pants", tint: false },
  { id: "bottom_skirt",  name: "Plaid mini",   slot: "bottom",   bodies: BOTH, tier: "free",    file: "frankyaye_mini_skirt_01", tint: false },
  { id: "bottom_ruffle", name: "Ruffle skirt", slot: "bottom",   bodies: BOTH, tier: "free",    file: "toigo_tiered_mini_skirt", tint: false },
  { id: "bottom_cargo",  name: "Cargo pants",  slot: "bottom",   bodies: BOTH, tier: "premium", file: "cortu_cargo_pants", tint: false },
  { id: "bottom_maxi",   name: "Maxi skirt",   slot: "bottom",   bodies: BOTH, tier: "premium", file: "toigo_long_full_skirt", tint: false },
  { id: "bottom_jeans",  name: "Jeans",        slot: "bottom",   bodies: BOTH, tier: "free",    file: "jeans", tint: false },
  { id: "bottom_leggings", name: "Leggings",   slot: "bottom",   bodies: BOTH, tier: "free",    file: "leggings", tint: false },
  { id: "bottom_belted", name: "Belted shorts", slot: "bottom",  bodies: BOTH, tier: "free",    file: "belted_shorts", tint: false },
  { id: "bottom_pencil", name: "Pencil skirt", slot: "bottom",   bodies: BOTH, tier: "free",    file: "pencil_skirt", tint: false },
  { id: "bottom_floral", name: "Floral skirt", slot: "bottom",   bodies: BOTH, tier: "free",    file: "toigo_skirt_with_lace_ruffle", tint: false },
  { id: "bottom_tiered", name: "Tiered skirt", slot: "bottom",   bodies: BOTH, tier: "free",    file: "toigo_tiered_skirt", tint: false },
  { id: "bottom_pinksuit", name: "Pink trousers", slot: "bottom", bodies: BOTH, tier: "free",   file: "pink_suit_trousers", tint: false },
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
  { id: "shoes_bowflats",name: "Bow flats",      slot: "shoes",  bodies: BOTH, tier: "free",    file: "toigo_ballet_flats_with_bows", tint: false },
  { id: "shoes_tbar",    name: "T-bar shoes",    slot: "shoes",  bodies: BOTH, tier: "free",    file: "cortu_t-bar", tint: false },
  { id: "shoes_cuffed",  name: "Cuffed boots",   slot: "shoes",  bodies: BOTH, tier: "free",    file: "grinsegold_female_pirate_boots", tint: false },
  { id: "shoes_rain",    name: "Rain boots",     slot: "shoes",  bodies: BOTH, tier: "free",    file: "scailman_semitransparent_water_boots", tint: false },
  { id: "shoes_booties", name: "Stiletto booties", slot: "shoes", bodies: BOTH, tier: "premium", file: "toigo_stiletto_booties", tint: false },
  { id: "shoes_overknee",name: "Over-knee boots", slot: "shoes", bodies: BOTH, tier: "premium", file: "cortu_floppy_overknee_shoes", tint: false },
  // Hats (ids keep the acc_ prefix: hats were accessories before they got their own slot)
  { id: "acc_fedora",    name: "Fedora",         slot: "hat", bodies: BOTH, tier: "free",    file: "fedora01" },
  { id: "acc_fedoratilt",name: "Tilted fedora",  slot: "hat", bodies: BOTH, tier: "free",    file: "fedora_cocked" },
  { id: "acc_widehat",   name: "Wide-brim hat",  slot: "hat", bodies: BOTH, tier: "free",    file: "crude_hat" },
  { id: "hat_newsboy",   name: "Newsboy cap",    slot: "hat", bodies: BOTH, tier: "free",    file: "jujube_newsboy_cap" },
  { id: "hat_cloche",    name: "Cloche",         slot: "hat", bodies: BOTH, tier: "free",    file: "aethelraed_unraed_cloche_hat", tint: false },
  { id: "hat_santa",     name: "Santa hat",      slot: "hat", bodies: BOTH, tier: "premium", file: "joepal_xmas_cap", tint: false },
  // Accessories
  { id: "acc_shades",    name: "Visor shades",   slot: "accessory", bodies: BOTH, tier: "free",    file: "crude_lab_glasses" },
  { id: "acc_gloves",    name: "Gloves",         slot: "accessory", bodies: BOTH, tier: "free",    file: "crude_gloves" },
  { id: "acc_mask",      name: "Masquerade mask", slot: "accessory", bodies: BOTH, tier: "premium", file: "crude_theater_mask" },
  { id: "acc_longgloves",name: "Opera gloves",   slot: "accessory", bodies: BOTH, tier: "premium", file: "crude_long_gloves" },
  { id: "acc_3d",        name: "3D glasses",     slot: "accessory", bodies: BOTH, tier: "free",    file: "ews_3d_glasses", tint: false },
  { id: "acc_leopard",   name: "Leopard sunnies", slot: "accessory", bodies: BOTH, tier: "free",   file: "toigo_round_glasses_leopard", tint: false },
  { id: "acc_redframes", name: "Red frames",     slot: "accessory", bodies: BOTH, tier: "free",    file: "spamrakuen_sagerfrogs_glasses_01", tint: false },
  { id: "acc_frames",    name: "Black frames",   slot: "accessory", bodies: BOTH, tier: "free",    file: "spamrakuen_tbm_glasses_frames_01", tint: false },
  { id: "acc_leather",   name: "Leather gloves", slot: "accessory", bodies: BOTH, tier: "free",    file: "toigo_gloves_short", tint: false },
  { id: "acc_hero",      name: "Hero mask",      slot: "accessory", bodies: BOTH, tier: "premium", file: "culturalibre_hero_mask_2", tint: false },
  // Bags (CC-BY: credited in client/assets/parts/CREDITS.md)
  { id: "bag_satchel",   name: "Satchel",        slot: "bag", bodies: BOTH, tier: "free",    file: "punkduck_handbag01", tint: false,
    license: "CC-BY", author: "punkduck" },
  { id: "bag_sling",     name: "Sling purse",    slot: "bag", bodies: BOTH, tier: "free",    file: "elvs_sling_purse1", tint: false,
    license: "CC-BY", author: "Elvaerwyn" },
  { id: "bag_shopping",  name: "Shopping bag",   slot: "bag", bodies: BOTH, tier: "free",    file: "punkduck_shopping_bag01", tint: false,
    license: "CC-BY", author: "punkduck" },
  { id: "bag_suitcase",  name: "Suitcase",       slot: "bag", bodies: BOTH, tier: "premium", file: "culturalibre_suitcase", tint: false,
    license: "CC-BY", author: "culturalibre", originalAuthor: "Duion" },
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
// A recipe is one short, deterministic string: body, skin tone index, then kind=id for each non-default
// body shape (SHAPE_KINDS order), then slot=part:color for each filled slot, in PART_SLOTS order, joined
// with ";". Colors are palette indices. Default shapes and empty slots are left out.
//   female;3;hair=hair_bob:4;eyebrows=brows_soft:1;top=top_tank:2;bottom=bottom_shorts:8;shoes=shoes_sneakers:0
//   male;5;build=heavy;face=round;top=top_puffer:0;bottom=bottom_jeans:0;hat=acc_fedora:3;accessory=acc_3d:0
// It's what the server stores on the account and syncs to other players.
export const MAX_RECIPE_LENGTH = 300;
const ID = /^[a-z0-9_-]{1,32}$/;
const index = (v, len) => { const n = Number(v); return Number.isInteger(n) && n >= 0 && n < len ? n : 0; };

// Recipe string (or object) -> { body, skin, shape: { build, face, height }, parts: { slot: { id, color } } },
// or null if it isn't a recipe at all. Cleans as it goes: unknown slots/parts/shapes are dropped (unknown
// shapes become the default), out-of-range colors become 0, parts that don't fit the body are dropped, and
// required slots get their default.
// Does NOT check unlocks; that's the server's job (server/entitlements.js).
export function parseRecipe(input) {
  let body, skin, wanted = [], shapes = {};
  if (typeof input === "string") {
    if (!input || input.length > MAX_RECIPE_LENGTH) return null;
    const [b, s, ...rest] = input.trim().split(";");
    body = b; skin = s;
    for (const tok of rest) {
      const eq = tok.indexOf("=");
      if (eq < 0) continue;
      const key = tok.slice(0, eq).trim();
      if (shapeKindById(key)) { shapes[key] ??= tok.slice(eq + 1).trim(); continue; }
      const [id, color] = tok.slice(eq + 1).split(":");
      wanted.push([key, id?.trim(), color]);
    }
  } else if (input && typeof input === "object") {
    body = input.body; skin = input.skin;
    if (input.shape && typeof input.shape === "object") shapes = input.shape;
    for (const [slot, v] of Object.entries(input.parts ?? {})) {
      if (typeof v === "string") wanted.push([slot, v, 0]);
      else if (v && typeof v === "object") wanted.push([slot, v.id, v.color]);
    }
  } else return null;

  body = typeof body === "string" ? body.trim() : "";
  if (!bodyById(body)) return null;
  const out = { body, skin: index(skin, SKIN_TONES.length), shape: {}, parts: {} };
  for (const k of SHAPE_KINDS) {
    const want = shapes[k.id];
    out.shape[k.id] = (typeof want === "string" && k.options.find((o) => o.id === want)?.id) || k.options[0].id;
  }
  // Parts in their own slot first; then parts named under a slot they used to live in move to their
  // own slot (if it's still free), so an explicit hat=… beats an old accessory=<hat>.
  for (const moved of [false, true]) for (const [slotId, id, color] of wanted) {
    let slot = partSlotById(slotId);
    const part = typeof id === "string" && ID.test(id) ? partById(id) : null;
    if (moved) {
      if (!slot || !part || part.slot === slot.id || !partSlotById(part.slot)?.formerly?.includes(slot.id)) continue;
      slot = partSlotById(part.slot);
    }
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

// { body, skin, shape, parts } -> canonical recipe string (assumes it's already clean; use normalizeRecipe otherwise).
export function formatRecipe(r) {
  const bits = [r.body, String(r.skin)];
  for (const k of SHAPE_KINDS) {
    const v = r.shape?.[k.id];
    if (v && v !== k.options[0].id) bits.push(`${k.id}=${v}`);
  }
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
  const r = { body: b, skin: Math.floor(rng() * SKIN_TONES.length) % SKIN_TONES.length, shape: {}, parts: {} };
  for (const slot of PART_SLOTS) {
    const options = partsFor(b, slot.id).filter(allow);
    const skip = !slot.required && rng() < (slot.emptyChance ?? 0);
    if (!options.length || skip) continue;
    r.parts[slot.id] = { id: pick(options).id, color: Math.floor(rng() * slot.colors.length) % slot.colors.length };
  }
  // Shapes last (so older seeds still pick the same parts). About half keep each default.
  for (const k of SHAPE_KINDS) r.shape[k.id] = rng() < 0.5 ? k.options[0].id : pick(k.options.slice(1)).id;
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
