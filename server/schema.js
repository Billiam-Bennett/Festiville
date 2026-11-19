// Room state that Colyseus automatically syncs to every client.
// Only put things here that OTHER players need to see.
import { Schema, MapSchema, defineTypes } from "@colyseus/schema";

export class Player extends Schema {
  constructor() {
    super();
    this.name = "Raver";
    this.x = 0;
    this.z = 0;
    this.rotY = 0;
    this.lastSeq = 0;          // last input the server applied (for client reconciliation)
    this.emote = "";           // "" or an emote id from shared/emotes.js ("dance", "wave", "jump", …); everyone sees it
    this.emoteSeq = 0;         // counts up each time an emote starts, so repeating one replays it for everyone
    this.crewId = "";          // "" when not in a crew
    this.badges = "";          // comma-separated badge names earned from quests
    this.look = "";            // character id from shared/characters.js (also the fallback when a recipe can't be shown)
    this.recipe = "";          // parts-based character (shared/parts.js), or "" for the classic `look`
    this.staff = false;        // festival staff (moderators) get a STAFF tag
    this.accessories = "";     // comma-separated cosmetic accessory ids (shared/accessories.js)
    this.ride = "";            // "" on foot, "wheel:<n>" in a Ferris wheel gondola, "cart" driving a golf cart (shared/rides.js)
    // Avatar fields — map these to your existing avatar builder.
    this.skinTone = "#c68642";
    this.shirtColor = "#ff4fa3";
  }
}
defineTypes(Player, {
  name: "string",
  x: "number",
  z: "number",
  rotY: "number",
  lastSeq: "number",
  emote: "string",
  emoteSeq: "number",
  crewId: "string",
  badges: "string",
  look: "string",
  recipe: "string",
  staff: "boolean",
  accessories: "string",
  ride: "string",
  skinTone: "string",
  shirtColor: "string",
});

// A crew (party) of up to 4. Quest progress is JSON so new quest types don't need schema changes.
export class Crew extends Schema {
  constructor() {
    super();
    this.leader = "";
    this.members = "";         // comma-separated session ids
    this.quest = "";           // JSON from QuestSystem.publicQuest(), or "" when no quest
  }
}
defineTypes(Crew, {
  leader: "string",
  members: "string",
  quest: "string",
});

export class FestivalState extends Schema {
  constructor() {
    super();
    this.players = new MapSchema();
    this.crews = new MapSchema();
    this.time = 0;             // server clock in seconds, so browsers can show quest timers
  }
}
defineTypes(FestivalState, {
  players: { map: Player },
  crews: { map: Crew },
  time: "number",
});
