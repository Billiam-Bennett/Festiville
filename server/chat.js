// Chat rules: who hears a message and how fast people can talk. No networking here, so it's tested
// directly (test/chat.test.js); server/FestivalRoom.js does the actual sending.
//
// Two channels:
//   "near"  everyone within NEAR_RANGE meters of you hears it (like talking out loud at a festival)
//   "crew"  only your crew hears it, wherever they are on the grounds
export const CHAT = {
  maxLength: 140,     // characters per message
  nearRange: 25,      // meters
  burst: 5,           // at most this many messages...
  window: 10,         // ...per this many seconds
  minGap: 0.5,        // seconds between two messages
};

// Words to hide (replaced with ****). Kept empty on purpose: fill it in for your community.
// Matching is whole-word and case-insensitive.
export const BLOCKED_WORDS = [];

export class ChatSystem {
  constructor({ blocked = BLOCKED_WORDS } = {}) {
    this.sent = new Map();   // player id -> recent send times
    this.blocked = blocked.length
      ? new RegExp(`\\b(${blocked.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "gi")
      : null;
  }

  leave(id) { this.sent.delete(id); }

  // raw: { text, channel } from the client.
  // positions: Map id -> { x, z }.  crewOf(id): array of member ids in that player's crew (or []).
  // Returns { to: [ids], channel, text } to deliver, { error } to tell the sender, or null to ignore.
  send(fromId, raw, { now, positions, crewOf }) {
    const channel = raw?.channel === "crew" ? "crew" : "near";
    let text = clean(raw?.text);
    if (!text) return null;
    if (this.blocked) text = text.replace(this.blocked, (w) => "*".repeat(w.length));

    const times = (this.sent.get(fromId) ?? []).filter((t) => now - t < CHAT.window);
    if (times.length && now - times[times.length - 1] < CHAT.minGap) return { error: "Slow down a little." };
    if (times.length >= CHAT.burst) return { error: "You're sending messages too fast. Wait a few seconds." };

    let to;
    if (channel === "crew") {
      const members = crewOf(fromId) ?? [];
      if (members.length < 2) return { error: "You're not in a crew yet. Tap a player to invite them." };
      to = [...members];
    } else {
      const me = positions.get(fromId);
      if (!me) return null;
      to = [];
      for (const [id, p] of positions) if (Math.hypot(p.x - me.x, p.z - me.z) <= CHAT.nearRange) to.push(id);
    }
    times.push(now);
    this.sent.set(fromId, times);
    return { to, channel, text };
  }
}

// One line of plain text: no control characters, spaces collapsed, length capped.
export function clean(v) {
  if (typeof v !== "string") return "";
  return v.replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, " ").replace(/\s+/g, " ").trim().slice(0, CHAT.maxLength);
}
