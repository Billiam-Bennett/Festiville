// DJ music on the stages. Shared so the server (who may link what, where) and the browser (what to
// play and how loud) agree.
//
// The deal: DJs give their music for free, for exposure. Nobody is paid. A DJ LINKS a mix that is
// already on SoundCloud, Mixcloud or YouTube and the game plays that stream; no audio is ever stored
// on the FestiVille server. Each stage has a genre (shared/layout.js → GENRES) and a mix has to match it.
import { GENRES, genreById } from "./layout.js";
export { GENRES, genreById };

// ---------- Rules the organizer hasn't decided yet ----------
// These are settings, not code: they live in data/dj.json and can be changed while the server runs
//   npm run account -- dj-rules signup=open order=schedule set=45
// The values below are only what a fresh server starts with.
//   signup      "approved": only DJs that staff have approved can link a mix   |  "open": any member who signs up as a DJ
//   order       "first-come": a linked mix goes on now, or queues behind what's playing
//               "schedule":   the DJ picks a start time that's free
//               "organizer":  a linked mix waits until staff put it on
//   setMinutes  how long a set lasts (0 = until the DJ or staff end it; only with "first-come" on a free stage)
export const DJ_RULE_DEFAULTS = { signup: "approved", order: "first-come", setMinutes: 60 };
export const DJ_RULE_CHOICES = { signup: ["approved", "open"], order: ["first-come", "schedule", "organizer"] };
export const DJ_LIMITS = { name: 24, title: 60, link: 200, reason: 200, maxSetMinutes: 240, scheduleDays: 14, queuePerStage: 12 };

// Shown on the DJ signup, and the DJ has to tick it.
export const DJ_TERMS = "Only link music that is your own: your own tracks, or mixes you made and have the right to share. "
  + "You're sharing it for exposure and aren't paid. Festival staff can stop a set or remove a DJ at any time, and every link is logged with your account.";

export function cleanRules(raw = {}) {
  const r = { ...DJ_RULE_DEFAULTS };
  if (DJ_RULE_CHOICES.signup.includes(raw.signup)) r.signup = raw.signup;
  if (DJ_RULE_CHOICES.order.includes(raw.order)) r.order = raw.order;
  if (Number.isFinite(raw.setMinutes) && raw.setMinutes >= 0) r.setMinutes = Math.min(DJ_LIMITS.maxSetMinutes, Math.round(raw.setMinutes));
  return r;
}

const text = (v, max) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max) : "");
export const cleanDjName = (v) => text(v, DJ_LIMITS.name);
export const cleanTitle = (v) => text(v, DJ_LIMITS.title);

// A DJ's own page (any https link: their SoundCloud, Linktree, website…). "" if it isn't one.
export function cleanPageLink(v) {
  if (typeof v !== "string" || v.length > DJ_LIMITS.link) return "";
  try {
    const u = new URL(v.trim());
    return u.protocol === "https:" && u.hostname.includes(".") && !u.username && !u.password ? u.href : "";
  } catch { return ""; }
}

// ---------- Mix links ----------
// Only these three, only https. Returns { provider, url, id? } with a tidy canonical url, or
// { error } saying what's wrong in words a DJ can act on.
const YT_ID = /^[A-Za-z0-9_-]{11}$/;
export const PROVIDERS = { soundcloud: "SoundCloud", mixcloud: "Mixcloud", youtube: "YouTube" };

export function parseMixLink(raw) {
  if (typeof raw !== "string" || !raw.trim()) return { error: "Paste a link to your mix." };
  if (raw.length > DJ_LIMITS.link) return { error: "That link is too long." };
  let u;
  try { u = new URL(raw.trim()); } catch { return { error: "That doesn't look like a link. It should start with https://" }; }
  if (u.protocol !== "https:") return { error: "The link has to start with https://" };
  if (u.username || u.password) return { error: "That doesn't look like a normal link." };
  const host = u.hostname.toLowerCase().replace(/^(www|m)\./, "");
  const path = u.pathname.replace(/\/+$/, "");
  const parts = path.split("/").filter(Boolean);

  if (host === "soundcloud.com") {
    if (parts.length < 2 || ["discover", "search", "upload", "you", "stream"].includes(parts[0])) return { error: "Link the track or set itself (soundcloud.com/your-name/your-mix)." };
    return { provider: "soundcloud", url: `https://soundcloud.com${path}` };
  }
  if (host === "on.soundcloud.com") return { error: "That's a SoundCloud short link. Open it and copy the full link from the address bar." };
  if (host === "mixcloud.com") {
    if (parts.length < 2 || ["discover", "search", "upload", "live"].includes(parts[0])) return { error: "Link the show itself (mixcloud.com/your-name/your-mix)." };
    return { provider: "mixcloud", url: `https://www.mixcloud.com/${parts[0]}/${parts[1]}/`, id: `/${parts[0]}/${parts[1]}/` };
  }
  if (host === "youtu.be") {
    if (!YT_ID.test(parts[0] ?? "")) return { error: "That YouTube link doesn't have a video in it." };
    return { provider: "youtube", url: `https://www.youtube.com/watch?v=${parts[0]}`, id: parts[0] };
  }
  if (host === "youtube.com" || host === "music.youtube.com") {
    const id = parts[0] === "watch" ? u.searchParams.get("v") : ["live", "embed", "shorts"].includes(parts[0]) ? parts[1] : "";
    if (!YT_ID.test(id ?? "")) return { error: "Link the video itself (youtube.com/watch?v=…), not a channel or playlist." };
    return { provider: "youtube", url: `https://www.youtube.com/watch?v=${id}`, id };
  }
  return { error: "Mixes have to be on SoundCloud, Mixcloud or YouTube." };
}

// ---------- How loud a stage is where you're standing ----------
// Loud at the stage, fading with distance, silent by the time you reach the Campground.
// near: full volume inside this many meters. far: silent beyond this.
export const STAGE_AUDIO = { main: { near: 18, far: 150 }, side: { near: 12, far: 85 } };
export function stageVolume(distance, variant = "main") {
  const { near, far } = STAGE_AUDIO[variant] ?? STAGE_AUDIO.main;
  if (!(distance > near)) return 1;
  if (distance >= far) return 0;
  const k = (far - distance) / (far - near);
  return k * k;   // falls off faster at first, like sound does
}

// Which stage you'd hear, and how loud: the loudest one with a set playing. sets: [{ stage: { x, z, variant }, … }].
export function loudest(pos, sets) {
  let best = null;
  for (const s of sets) {
    const volume = stageVolume(Math.hypot(pos.x - s.stage.x, pos.z - s.stage.z), s.stage.variant);
    if (volume > 0 && (!best || volume > best.volume)) best = { set: s, volume };
  }
  return best;
}
