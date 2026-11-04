// Vendors and where everything is. The layout itself (what's placed where) is shared/layout.js data,
// edited with the festival builder (client/builder.html) and saved by the server in data/layout.json.
// applyLayout() turns a layout into the lists the rest of the game reads (VENDORS, ZONE_LABELS, quest
// positions), in place, so every module that imported them sees the new layout.
//
// The vendor listings below (names, menus, prices, upcoming stops) are only the STARTING versions,
// and apart from the Hippie Dips notes they're placeholders. Vendors edit their own listing with a
// private link (npm run vendor-link -- <vendor id>); the server saves those edits in data/vendors.json
// and they override what's here. Stall positions come from the layout.
import { FENCE, GATE, defaultLayout, facing, rad, TYPES } from "./layout.js";
import { GIVERS, AMBIENT, QUESTS, LOST_SPOTS, CAMP_TENTS } from "./quests-data.js";
export { FENCE, GATE };

// kind: "food" shows a menu; "goods" shows what they sell. Prices are in dollars.
// next: upcoming stops — { event, where, start, end } with dates as "YYYY-MM-DD" (end optional).
// Past stops hide themselves. An empty list shows "No dates posted yet".
const FOOD = [
  {
    id: "noodle", name: "Noodle Nomad", color: "#e84a5f", tagline: "Wok-fired noodles, fast.",
    items: [
      { name: "Pad thai", price: 14 }, { name: "Garlic lo mein", price: 12 },
      { name: "Pork dumplings (6)", price: 9 }, { name: "Thai iced tea", price: 5 },
    ],
    next: [{ event: "Neon Pines Fest", start: "2026-10-23", end: "2026-10-25", where: "Ocala, FL" }],
  },
  {
    id: "rae", name: "Mama Rae's Tacos", color: "#ffb347", tagline: "Street tacos off the flat-top. Ask about the campground delivery run!",
    items: [
      { name: "Carne asada tacos (3)", price: 12 }, { name: "Veggie tacos (3)", price: 10 },
      { name: "Elote", price: 6 }, { name: "Horchata", price: 5 },
    ],
    next: [{ event: "Harvest Moon Gathering", start: "2026-10-16", end: "2026-10-18", where: "Asheville, NC" }, { event: "Riverbend Jam", start: "2026-11-06", end: "2026-11-08", where: "Chattanooga, TN" }],
  },
  {
    id: "bbq", name: "Smoke Signals BBQ", color: "#8b4a2b", tagline: "Low and slow since sunrise.",
    items: [
      { name: "Brisket sandwich", price: 15 }, { name: "Pulled pork plate", price: 14 },
      { name: "Smoked mac & cheese", price: 7 }, { name: "Sweet tea", price: 4 },
    ],
    next: [{ event: "Harvest Moon Gathering", start: "2026-10-16", end: "2026-10-18", where: "Asheville, NC" }, { event: "Gulf Coast Groove", start: "2026-11-13", end: "2026-11-15", where: "Pensacola, FL" }],
  },
  {
    id: "crepes", name: "Cosmic Crepes", color: "#bb6bd9", tagline: "Sweet and savory, folded to order.",
    items: [
      { name: "Nutella banana", price: 10 }, { name: "Strawberry cream", price: 10 },
      { name: "Ham & brie", price: 12 }, { name: "Spinach feta", price: 11 },
    ],
    next: [{ event: "Neon Pines Fest", start: "2026-10-23", end: "2026-10-25", where: "Ocala, FL" }],
  },
  {
    id: "hippiedips", name: "Hippie Dips", color: "#ff5fa2", tagline: "GET WEIRD. Smoothies, fruit cones & festival comfort food.",
    link: "https://hippiedips.com",
    items: [
      { name: "Fruit smoothies" },
      { name: "Fruit cones" },
      { name: "Soups, salads & sandwiches" },
      { name: "Breakfast" },
    ],
    next: [],
  },
  {
    id: "pizza", name: "Pizza Portal", color: "#f2994a", tagline: "Wood-fired slices out of a converted school bus.",
    items: [
      { name: "Cheese slice", price: 6 }, { name: "Pepperoni slice", price: 7 },
      { name: "Veggie slice", price: 7 }, { name: "Garlic knots", price: 5 },
    ],
    next: [],
  },
  {
    id: "lemonade", name: "Shake It Lemonade", color: "#f2c94c", tagline: "Fresh-squeezed, shaken, ice cold.",
    items: [
      { name: "Classic lemonade", price: 6 }, { name: "Strawberry lemonade", price: 7 },
      { name: "Arnold Palmer", price: 7 }, { name: "Refill (bring your cup)", price: 3 },
    ],
    next: [{ event: "Riverbend Jam", start: "2026-11-06", end: "2026-11-08", where: "Chattanooga, TN" }],
  },
  {
    id: "coffee", name: "Sunrise Coffee Co.", color: "#6fcf97", tagline: "For the ones who never went to sleep.",
    items: [
      { name: "Cold brew", price: 5 }, { name: "Chai latte", price: 6 },
      { name: "Breakfast burrito", price: 10 }, { name: "Blueberry muffin", price: 4 },
    ],
    next: [{ event: "Gulf Coast Groove", start: "2026-11-13", end: "2026-11-15", where: "Pensacola, FL" }],
  },
];

const GOODS = [
  { id: "tiedye", name: "Tie-Dye Tent", color: "#ff4fa3", tagline: "Hand-dyed, one of a kind.", items: [{ name: "Tie-dye tee", price: 25 }, { name: "Tapestry", price: 40 }, { name: "Bandana", price: 8 }] },
  { id: "pins", name: "Pins & Patches", color: "#56ccf2", tagline: "Enamel pins for every hat.", items: [{ name: "Enamel pin", price: 12 }, { name: "Iron-on patch", price: 8 }, { name: "Pin board", price: 30 }] },
  { id: "crystals", name: "Crystal Cove", color: "#9b51e0", tagline: "Stones, wraps and good energy.", items: [{ name: "Wire-wrapped pendant", price: 35 }, { name: "Amethyst cluster", price: 20 }, { name: "Tumbled stone", price: 3 }] },
  { id: "grilledcheese", name: "Grilled Cheese Guy", color: "#f2c94c", kind: "food", tagline: "A Shakedown classic. Cash or trade.", items: [{ name: "Grilled cheese", price: 5 }, { name: "Add tomato", price: 1 }, { name: "Cold water", price: 2 }] },
  { id: "hats", name: "Hat Rack", color: "#27ae60", tagline: "Bucket hats, trucker hats, wizard hats.", items: [{ name: "Bucket hat", price: 22 }, { name: "Trucker hat", price: 20 }, { name: "Wizard hat", price: 30 }] },
  { id: "hoops", name: "Hoop Shop", color: "#eb5757", tagline: "Hula hoops, poi and flow toys.", items: [{ name: "Polypro hoop", price: 35 }, { name: "LED poi (pair)", price: 45 }, { name: "Flow lesson", price: 15 }] },
  { id: "glow", name: "Glow Gear", color: "#4fe3ff", tagline: "Light up the night.", items: [{ name: "Glow sticks (10)", price: 5 }, { name: "LED gloves", price: 18 }, { name: "Light-up totem", price: 25 }] },
  { id: "vinyl", name: "Vinyl Stash", color: "#333333", tagline: "Records, tapes and bootlegs of last night's set.", items: [{ name: "Used LP", price: 12 }, { name: "Live tape", price: 8 }, { name: "Slipmat", price: 15 }] },
  { id: "hemp", name: "Hemp & Beads", color: "#8a6a45", tagline: "Handmade jewelry.", items: [{ name: "Hemp bracelet", price: 6 }, { name: "Beaded anklet", price: 10 }, { name: "Custom name bracelet", price: 12 }] },
  { id: "posters", name: "Poster Pit", color: "#f2994a", tagline: "Screen-printed show posters.", items: [{ name: "Show poster", price: 30 }, { name: "Art print", price: 20 }, { name: "Sticker sheet", price: 6 }] },
  { id: "kandi", name: "Kandi Corner", color: "#ff7ad9", tagline: "PLUR bracelets. Trade one, make a friend.", items: [{ name: "Kandi single", price: 2 }, { name: "Kandi cuff", price: 15 }, { name: "Bead kit", price: 10 }] },
  { id: "stickers", name: "Sticker Swap", color: "#b8ff6b", tagline: "Stickers for your cooler, water bottle and forehead.", items: [{ name: "Sticker", price: 3 }, { name: "Holo sticker", price: 5 }, { name: "Mystery pack", price: 10 }] },
];
const GOODS_NEXT = [
  [{ event: "Harvest Moon Gathering", start: "2026-10-16", end: "2026-10-18", where: "Asheville, NC" }],
  [{ event: "Neon Pines Fest", start: "2026-10-23", end: "2026-10-25", where: "Ocala, FL" }, { event: "Gulf Coast Groove", start: "2026-11-13", end: "2026-11-15", where: "Pensacola, FL" }],
  [{ event: "Riverbend Jam", start: "2026-11-06", end: "2026-11-08", where: "Chattanooga, TN" }],
  [],
];

// Every vendor we have a starting listing for, by id (the builder offers these when placing a stall).
export const CATALOG = Object.fromEntries([
  ...FOOD.map((v) => [v.id, { ...v, kind: "food" }]),
  ...GOODS.map((v, i) => [v.id, { kind: "goods", next: GOODS_NEXT[i % GOODS_NEXT.length], ...v }]),
]);

// ---------- The current layout, and what's derived from it ----------
export const LAYOUT = { version: 1, items: [] };
export const VENDORS = [];            // one per placed stall: listing + { x, z, rotY, facing, zone }
export const ZONE_LABELS = {};        // zone id -> name shown on vendor cards ("Food Court", ...)
export const QUEST_DEFAULTS = {
  lost: LOST_SPOTS.map((s) => ({ ...s })), camp: CAMP_TENTS.map((t) => ({ ...t })),
  markers: JSON.parse(JSON.stringify(QUESTS.soundcheck.markers)),
  people: Object.fromEntries([...GIVERS, ...AMBIENT].map((p) => [p.id, { x: p.x, z: p.z }])),
};

// Is point (x, z) inside a (possibly rotated) rectangle item?
export function inside(item, x, z, [w, d] = TYPES[item.type].size(item)) {
  const a = -rad(item.rot || 0), dx = x - item.x, dz = z - item.z;
  const lx = dx * Math.cos(a) - dz * Math.sin(a), lz = dx * Math.sin(a) + dz * Math.cos(a);
  return Math.abs(lx) <= w / 2 && Math.abs(lz) <= d / 2;
}

export function applyLayout(layout) {
  const items = Array.isArray(layout?.items) ? layout.items : defaultLayout().items;
  LAYOUT.items = items;
  const replace = (arr, next) => { arr.length = 0; arr.push(...next); };

  // Zones: named ground areas. A stall belongs to the named area it stands in.
  for (const k of Object.keys(ZONE_LABELS)) delete ZONE_LABELS[k];
  const areas = items.filter((i) => i.type === "area" && i.label);
  for (const a of areas) ZONE_LABELS[a.id] = a.label;
  ZONE_LABELS.grounds = "Around the grounds";

  replace(VENDORS, items.filter((i) => i.type === "stall").map((i) => {
    // A catalog vendor brings its full listing; a new vendor uses the starting listing typed in the
    // builder (name/tagline/menu on the stall itself), which the vendor can later edit with their link.
    const base = CATALOG[i.vendor] ?? { id: i.vendor, name: i.vendor, kind: i.style === "tent" ? "goods" : "food", color: "#ff4fa3", tagline: i.tagline ?? "", items: i.items ?? [], next: [] };
    const zone = areas.find((a) => inside(a, i.x, i.z))?.id ?? "grounds";
    return {
      ...base, id: i.vendor, name: i.name || base.name, kind: i.kind || base.kind, color: i.color || base.color,
      tagline: i.tagline ?? base.tagline, items: i.items ?? base.items,
      style: i.style, zone, x: i.x, z: i.z, rotY: rad(i.rot), facing: facing(i.rot),
    };
  }));

  // Quests: characters stand where they're placed; stage markers sit in front of the stages;
  // hiding spots and ordering tents come from the layout when there are enough of them.
  for (const p of [...GIVERS, ...AMBIENT]) {
    const it = items.find((i) => i.type === "npc" && i.ref === p.id);
    const pos = it ?? QUEST_DEFAULTS.people[p.id];
    p.x = pos.x; p.z = pos.z; p.hidden = !it && !GIVERS.includes(p);
    p.rotY = it?.rot ? rad(it.rot) : undefined;   // 0 = "face the middle of the grounds"
  }
  const spots = items.filter((i) => i.type === "spot");
  replace(LOST_SPOTS, spots.length >= 3 ? spots.map((s) => ({ x: s.x, z: s.z, where: s.where })) : QUEST_DEFAULTS.lost);
  const tents = items.filter((i) => i.type === "tent" && i.orders);
  replace(CAMP_TENTS, tents.length >= 3 ? tents.map((t) => ({ x: t.x, z: t.z })) : QUEST_DEFAULTS.camp);
  const markers = QUESTS.soundcheck.markers;
  for (const variant of ["main", "side"]) {
    const st = items.find((i) => i.type === "stage" && i.variant === variant);
    const f = st && facing(st.rot), ahead = variant === "main" ? 10 : 9;
    Object.assign(markers[variant], st ? { x: Math.round(st.x + f.x * ahead), z: Math.round(st.z + f.z * ahead) } : QUEST_DEFAULTS.markers[variant]);
  }
  return LAYOUT;
}

export const vendorById = (id) => VENDORS.find((v) => v.id === id) ?? null;
// Where to stand to browse a stall: a few steps in front of its counter.
export const vendorFront = (v) => ({ x: v.x + v.facing.x * 4, z: v.z + v.facing.z * 4 });

applyLayout(defaultLayout());   // until the server's saved layout arrives
