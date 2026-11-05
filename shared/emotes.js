// Emotes: dances, waves, jumps and sitting. Shared so the server (which decides who is doing what,
// and tells everyone) and the browser (menu, keys and animations) agree on the list.
//
// Each player has { emote, emoteSeq } in the synced room state (server/schema.js):
//   emote     "" or an id below; everyone plays it on that player's character
//   emoteSeq  counts up every time an emote starts, so waving twice in a row waves twice for everyone
// The server also keeps when a one-shot emote ends (not synced) and clears it then.
//
// Fields:
//   clip       the animation to play (client/assets/parts/<body>/anims.json, see scripts/parts-anims.mjs)
//   fallback   clip to use when a character doesn't have `clip` (classic characters only have Dance)
//   loop       keeps going until you move or pick another emote; otherwise it lasts `duration` seconds
//   intro/outro  played once before the loop / after it ends (only when standing still)
//   moving     allowed while moving (walking doesn't cancel it)
//   key        keyboard shortcut (KeyboardEvent.code)
export const EMOTES = [
  { id: "dance",    name: "Dance",     icon: "💃", key: "Digit1", clip: "Dance",    loop: true },
  { id: "bounce",   name: "Bounce",    icon: "🕺", key: "Digit2", clip: "Bounce",   loop: true, fallback: "Dance" },
  { id: "fistpump", name: "Fist pump", icon: "✊", key: "Digit3", clip: "FistPump", loop: true, fallback: "Dance" },
  { id: "clap",     name: "Clap",      icon: "👏", key: "Digit4", clip: "Clap",     loop: true },
  { id: "wave",     name: "Wave",      icon: "👋", key: "Digit5", clip: "Wave",     duration: 2.1 },
  { id: "cheer",    name: "Cheer",     icon: "🙌", key: "Digit6", clip: "Cheer",    duration: 2.8 },
  { id: "point",    name: "Point",     icon: "👉", key: "Digit7", clip: "Point",    duration: 2 },
  { id: "thumbsup", name: "Thumbs up", icon: "👍", key: "Digit8", clip: "ThumbsUp", duration: 2.5 },
  { id: "sit",      name: "Sit",       icon: "🧘", key: "Digit9", clip: "SitIdle",  loop: true, intro: "SitDown", outro: "StandUp" },
  { id: "jump",     name: "Jump",      icon: "🦘", key: "Space",  clip: "Jump",     duration: 1.15, moving: true },
];

const BY_ID = new Map(EMOTES.map((e) => [e.id, e]));
export const emoteById = (id) => BY_ID.get(id) ?? null;

// Starting emotes faster than this is ignored (stops a held key or a script from flooding the room).
export const EMOTE_COOLDOWN = 0.25;

/** Fresh per-player emote state (the server keeps one per player). */
export const newEmoteState = () => ({ emote: "", emoteSeq: 0, endsAt: 0, lastStart: -Infinity });

/**
 * A player asked to start emote `id` ("" = stop). Mutates `s`; returns true if anything changed.
 * now: seconds (any clock that only goes forward); moving: is the player moving this tick.
 */
export function startEmote(s, id, { now, moving = false }) {
  if (typeof id !== "string") return false;
  const current = emoteById(s.emote);
  if (current && !current.loop && current.moving && now < s.endsAt) return false;   // finish the jump first
  if (id === "") {
    if (!s.emote) return false;
    s.emote = ""; s.endsAt = 0;
    return true;
  }
  const e = emoteById(id);
  if (!e) return false;
  if (moving && !e.moving) return false;                   // sitting down mid-run: no
  if (e.loop && s.emote === id) return false;              // already doing it
  if (now - s.lastStart < EMOTE_COOLDOWN) return false;
  s.emote = id;
  s.emoteSeq = (s.emoteSeq + 1) % 1000000;
  s.endsAt = e.loop ? 0 : now + e.duration;
  s.lastStart = now;
  return true;
}

/** Once per server tick: end one-shot emotes on time, and anything walking cancels. Returns true if changed. */
export function updateEmote(s, { now, moving = false }) {
  if (!s.emote) return false;
  const e = emoteById(s.emote);
  if (!e || (!e.loop && now >= s.endsAt) || (moving && !e.moving)) {
    s.emote = ""; s.endsAt = 0;
    return true;
  }
  return false;
}
