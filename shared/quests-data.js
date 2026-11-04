// Quest content shared by the server (rules) and the browser (what to draw).
// To add or tweak a quest, start here: who gives it, where things are, what it says.
// Positions are in meters on the festival map (see client/world.js for the landmarks).

import { randomRecipe, seededRandom } from "./parts.js";

export const CREW_MAX = 4;
export const TALK_RANGE = 5;          // how close you must be to a quest giver to talk
export const PICKUP_RANGE = 2.5;      // how close to walk to grab a quest item
export const INVITE_TTL = 30;         // seconds an invite stays open

// Characters standing around the grounds who hand out quests.
// look: a classic character (shared/characters.js). recipe (optional): a parts-based character
// (shared/parts.js) shown instead when the part files are installed; `look` stays as the fallback.
export const GIVERS = [
  { id: "juniper", name: "Juniper", role: "Lost raver", x: -12, z: 12, quest: "lostfound", look: "sophie",
    recipe: "female;2;hair=hair_ponytail:5;eyebrows=brows_soft:2;top=top_crop:2;bottom=bottom_shorts:8;shoes=shoes_boots:1" },
  { id: "dex", name: "Dex", role: "Stage manager", x: 9, z: -46, quest: "soundcheck", look: "bryce",
    recipe: "male;5;hair=hair_short:0;eyebrows=brows_bold:0;top=top_tee:1;bottom=bottom_jeans:8;shoes=shoes_boots:1" },
  { id: "rae", name: "Mama Rae", role: "Taco stand", x: -55, z: -20, quest: "vendorrush", look: "jody" },
];

// Ambient NPCs — characters standing around the festival to make it feel populated.
// No dialogue or quest; they idle in place. Positions are just off the main foot-traffic paths.
// The campers get a random parts-based look, seeded by their id so everyone sees the same one.
export const AMBIENT = [
  { id: "greeter",    name: "Ez",       role: "Greeter",         x: 0,   z: 8,   look: "michelle" },
  { id: "camper1",    name: "Ridley",   role: "Camper",          x: -14, z: 62,  look: "remy", recipe: randomRecipe(seededRandom("camper1")) },
  { id: "camper2",    name: "Ash",      role: "Camper",          x: 22,  z: 62,  look: "kate", recipe: randomRecipe(seededRandom("camper2")) },
  { id: "photog",     name: "Zoe",      role: "Photographer",    x: -6,  z: -30, look: "sophie" },
  { id: "medic",      name: "Doc",      role: "Medic tent",      x: 40,  z: 20,  look: "adam" },
  { id: "dj",         name: "K-Bass",   role: "Side stage DJ",   x: 60,  z: 6,   look: "bigvegas" },
  { id: "artist",     name: "Nyx",      role: "Face painter",    x: -35, z: -14, look: "jackie" },
  { id: "host",       name: "Salty",    role: "Food court host", x: -44, z: -26, look: "bryce" },
];

export const QUESTS = {
  lostfound: {
    name: "Lost & Found",
    giver: "juniper",
    minCrew: 1,
    badge: "Finder",
    pitch: "I lost my totem last night and it came apart. Three pieces are somewhere on the grounds. Can you find them and bring them back?",
    howTo: "Walk over the glowing pieces to pick them up, then return to Juniper. Crewmates can grab pieces too.",
    pieces: 3,
  },
  soundcheck: {
    name: "Soundcheck",
    giver: "dex",
    minCrew: 2,
    badge: "Sound Tech",
    pitch: "Both stages are out of sync and I can't be in two places at once. I need one of you at each stage at the same time.",
    howTo: "Needs a crew of 2 or more. One person stands on the main stage marker and another on the side stage marker for 3 seconds.",
    holdSeconds: 3,
    markers: {
      main: { x: 0, z: -50, label: "Main stage" },
      side: { x: 56, z: 10, label: "Side stage" },
    },
    markerRadius: 4,
    timeLimit: 180,
  },
  vendorrush: {
    name: "Vendor Rush",
    giver: "rae",
    minCrew: 1,
    badge: "Runner",
    pitch: "Campers keep ordering tacos and I can't leave the stand. Grab orders from me and run them out to the campground before they go cold!",
    howTo: "Pick up an order at Mama Rae's, carry it to the tent marked on your screen, and repeat. One order at a time per person. Crews get more orders but split the running.",
    timeLimit: 150,
    ordersBase: 3,          // solo gets 3; each extra crewmate adds 1
    handoffRange: 3.5,
  },
};

// Places a lost totem piece can turn up (3 are picked at random each time).
export const LOST_SPOTS = [
  { x: 22, z: -58, where: "beside the main stage" },
  { x: -24, z: -40, where: "near the front rail" },
  { x: 70, z: 22, where: "behind the side stage" },
  { x: -62, z: -37, where: "at the north end of the food court" },
  { x: -65, z: 34, where: "behind the last food stall" },
  { x: -18, z: 68, where: "between the tents" },
  { x: 26, z: 78, where: "at the back of the campground" },
  { x: 40, z: -20, where: "under the string lights" },
  { x: -85, z: 10, where: "by the tree line" },
  { x: 95, z: -38, where: "at the far end of Shakedown Street" },
];

// Tents that order tacos (in the campground, south side).
export const CAMP_TENTS = [
  { x: -30, z: 55 }, { x: -18, z: 55 }, { x: -6, z: 65 }, { x: 6, z: 65 },
  { x: 18, z: 75 }, { x: 30, z: 55 }, { x: -24, z: 75 }, { x: 12, z: 55 },
];

export const giverById = (id) => GIVERS.find((g) => g.id === id);
export const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
