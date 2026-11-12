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
  { id: "juniper", name: "Juniper", role: "Lost raver", x: -12, z: -38, quest: "lostfound", look: "sophie",
    recipe: "female;2;hair=hair_ponytail:5;eyebrows=brows_soft:2;top=top_crop:2;bottom=bottom_shorts:8;shoes=shoes_boots:1" },
  { id: "dex", name: "Dex", role: "Stage manager", x: 9, z: -94, quest: "soundcheck", look: "bryce",
    recipe: "male;5;hair=hair_short:0;eyebrows=brows_bold:0;top=top_tee:1;bottom=bottom_pants:8;shoes=shoes_boots:1" },
  { id: "rae", name: "Mama Rae", role: "Taco stand", x: -51, z: 5, quest: "vendorrush", look: "jody" },
  { id: "sunny", name: "Sunny", role: "Hippie Dips street team", x: -7, z: 174, quest: "getweird", look: "kate" },
];

// Ambient NPCs — characters standing around the festival to make it feel populated.
// No dialogue or quest; they idle in place. Positions are just off the main foot-traffic paths.
// The campers get a random parts-based look, seeded by their id so everyone sees the same one.
export const AMBIENT = [
  { id: "greeter",    name: "Ez",       role: "Greeter",         x: 6,   z: 176, look: "michelle" },
  { id: "camper1",    name: "Ridley",   role: "Camper",          x: -32, z: 158, look: "remy", recipe: randomRecipe(seededRandom("camper1")) },
  { id: "camper2",    name: "Ash",      role: "Camper",          x: 32,  z: 158, look: "kate", recipe: randomRecipe(seededRandom("camper2")) },
  { id: "photog",     name: "Zoe",      role: "Photographer",    x: -6,  z: -80, look: "sophie" },
  { id: "medic",      name: "Doc",      role: "Medic tent",      x: 30,  z: 70,  look: "adam" },
  { id: "dj",         name: "K-Bass",   role: "East stage DJ",   x: 152, z: -12, look: "bigvegas" },
  { id: "artist",     name: "Nyx",      role: "Face painter",    x: -28, z: 8,   look: "jackie" },
  { id: "host",       name: "Salty",    role: "Food court host", x: -40, z: -2,  look: "bryce" },
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
    pitch: "The Main Stage and the East Stage are out of sync and I can't be in two places at once. I need one of you at each stage at the same time.",
    howTo: "Needs a crew of 2 or more. One person stands on the main stage marker and another on the East Stage marker (through the forest path) for 3 seconds.",
    holdSeconds: 3,
    markers: {
      main: { x: 0, z: -100, label: "Main stage" },
      side: { x: 151, z: -20, label: "East stage" },
    },
    markerRadius: 4,
    timeLimit: 240,
  },
  vendorrush: {
    name: "Vendor Rush",
    giver: "rae",
    minCrew: 1,
    badge: "Runner",
    pitch: "Campers keep ordering tacos and I can't leave the stand. Grab orders from me and run them out to the campground before they go cold!",
    howTo: "Pick up an order at Mama Rae's, carry it to the tent marked on your screen, and repeat. One order at a time per person. Crews get more orders but split the running.",
    timeLimit: 240,         // the Campground is across the bridge now
    ordersBase: 3,          // solo gets 3; each extra crewmate adds 1
    handoffRange: 3.5,
  },

  // ---------- Business (sponsored) quests ----------
  // A business quest is a normal quest plus a sponsor. Copy this one to make another: it needs no new
  // code, only this entry, a giver in GIVERS above (and a spot for them in the layout), and a reward
  // in QUEST_REWARDS (shared/economy.js). The same anti-farm rules apply as for every quest.
  //
  //   type: "business"      uses the business-quest rules in server/quests.js: walk to the sponsor's
  //                         stall, talk to the vendor, do the task there, before the timer runs out
  //   giver, pitch, howTo   who hands it out and what they say (like any quest)
  //   timeLimit             seconds
  //   sponsor.name          shown as "Sponsored by …" in the quest dialog and the tracker
  //   sponsor.stall         the vendor id of their stall (shared/venue.js); the quest ends there
  //   sponsor.message       one line from the sponsor, shown with the quest. Part of the quest, not an ad pop-up.
  //   sponsor.link          optional: their website, shown in the quest dialog
  //   vendorLine            what the vendor says when you talk to them at the stall
  //   task.label            what you do there, for the tracker
  //   task.holdSeconds      how long someone from the crew has to stay at the counter
  //   task.range            how close to the front of the stall counts (meters)
  //
  // Businesses don't write these themselves: they ask the organizer, who adds the quest here.
  getweird: {
    type: "business",
    name: "Get Weird Run",
    giver: "sunny",
    minCrew: 1,
    badge: "Dip Runner",
    pitch: "Hippie Dips is blending for the whole Food Court and they're slammed. Run over to their stall, tell them Sunny sent you, and help them get a batch out!",
    howTo: "Cross the bridge to the Food Court and find the Hippie Dips stall (orange light). Talk to them, then stay at the counter while the batch blends. A crewmate can hold the counter for you.",
    timeLimit: 180,
    sponsor: {
      name: "Hippie Dips",
      stall: "hippiedips",
      message: "GET WEIRD. Smoothies, fruit cones & festival comfort food.",
      link: "https://hippiedips.com",
    },
    vendorLine: "Sunny sent you? Perfect timing. Hold this blender lid down while I pour, and don't let go!",
    task: { label: "Hold the blender lid at the counter", holdSeconds: 5, range: 4 },
  },
};

// Places a lost totem piece can turn up (3 are picked at random each time).
// These are the fallbacks; the layout's own hiding spots replace them (shared/venue.js).
export const LOST_SPOTS = [
  { x: 24, z: -108, where: "beside the main stage" },
  { x: -24, z: -88, where: "near the front rail" },
  { x: 173, z: -8, where: "behind the east stage" },
  { x: -64, z: -10, where: "at the north end of the food court" },
  { x: -66, z: 58, where: "behind the last food stall" },
  { x: -48, z: 158, where: "between the tents" },
  { x: 120, z: 180, where: "at the back of the campground" },
  { x: 147, z: -84, where: "under the string lights" },
  { x: -186, z: -40, where: "by the tree line" },
  { x: 185, z: -100, where: "at the far end of Shakedown Street" },
];

// Tents that order tacos (in the Campground, across the bridge).
export const CAMP_TENTS = [
  { x: -24, z: 122 }, { x: -40, z: 122 }, { x: 24, z: 122 }, { x: 40, z: 122 },
  { x: -24, z: 136 }, { x: -56, z: 136 }, { x: 24, z: 136 }, { x: 56, z: 136 },
];

export const giverById = (id) => GIVERS.find((g) => g.id === id);
export const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
