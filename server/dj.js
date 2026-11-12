// DJ sets on the stages: who is a DJ, what's linked to which stage and when, and a record of who
// linked what. Saved in data/dj.json (FV_DATA_DIR to move it), following the same pattern as the
// player reports in server/moderation.js: a small store, a log of every action, staff tools in the
// game and on the command line. No networking in here (test/dj.test.js tests it directly).
//
//   rules  the open decisions (who can DJ, who picks the order, how long a set is); see shared/dj.js
//   djs    DJ profiles by account id: name, link to their own page, approved / removed
//   sets   DJ slots: stage, DJ, mix title + link, when. Nothing is hard-coded; a stage plays whatever
//          set is booked on it right now.
//   log    every signup, link, stop and removal: who, when, which link
//
// Only links are stored. The audio stays on SoundCloud / Mixcloud / YouTube.
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { cleanRules, cleanDjName, cleanTitle, cleanPageLink, parseMixLink, genreById, DJ_LIMITS, PROVIDERS } from "../shared/dj.js";
import { genreName } from "../shared/layout.js";

const DEFAULT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
const LIVE = new Set(["booked", "pending"]);   // sets that aren't over
const KEEP_DAYS = 14;                           // finished sets are dropped after this (the log keeps the record)
const note = (v) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, DJ_LIMITS.reason) : "");

export class DjStore {
  constructor({ dir = process.env.FV_DATA_DIR || DEFAULT_DIR, now = () => Date.now() } = {}) {
    this.file = join(dir, "dj.json");
    this.now = now;
    this.listeners = new Set();
    this.load();
  }
  load() {
    let data = {};
    if (existsSync(this.file)) {
      try { data = JSON.parse(readFileSync(this.file, "utf8")); }
      catch (err) { console.error(`Couldn't read ${this.file}: ${err.message}`); }
    }
    this.rulesData = cleanRules(data.rules);
    this.djs = data.djs ?? {};
    this.sets = data.sets ?? [];
    this.log = data.log ?? [];
    this.seen = this.mtime();
  }
  mtime() { try { return statSync(this.file).mtimeMs; } catch { return 0; } }
  // Picks up `npm run account -- dj-…` while the server runs.
  refresh() { if (this.mtime() !== this.seen) { this.load(); this.emit(); } }
  save() {
    const cutoff = this.now() - KEEP_DAYS * 86400_000;
    this.sets = this.sets.filter((s) => LIVE.has(s.status) || Date.parse(s.at) > cutoff);
    if (this.log.length > 5000) this.log = this.log.slice(-5000);
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ rules: this.rulesData, djs: this.djs, sets: this.sets, log: this.log }, null, 1));
    renameSync(tmp, this.file);
    this.seen = this.mtime();
    this.emit();
  }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { for (const fn of this.listeners) { try { fn(); } catch (err) { console.error(err); } } }
  record(by, action, extra = {}) { this.log.push({ at: new Date(this.now()).toISOString(), by, action, ...extra }); }

  // ---------- Rules ----------
  rules() { this.refresh(); return { ...this.rulesData }; }
  setRules(patch, by = "console") {
    this.refresh();
    this.rulesData = cleanRules({ ...this.rulesData, ...patch });
    this.record(by, "rules", { rules: { ...this.rulesData } });
    this.save();
    return this.rules();
  }

  // ---------- DJ profiles ----------
  dj(accountId) { this.refresh(); return this.djs[accountId] ?? null; }
  // May this account link a mix? "" if yes, else why not.
  whyNot(accountId, { staff = false } = {}) {
    const d = this.dj(accountId);
    if (!d) return "Sign up as a DJ first.";
    if (d.removed) return "Festival staff removed you as a DJ, so you can't link mixes.";
    if (this.rulesData.signup === "approved" && !d.approved && !staff) return "Thanks for signing up! Festival staff approve DJs before they go on. You'll be able to link a mix once you're approved.";
    return "";
  }

  // account: { id, name }. own must be true: the DJ confirms it's their own music (DJ_TERMS).
  signup(account, { name, link, own } = {}) {
    this.refresh();
    if (!account?.id) return { error: "Sign in first." };
    if (own !== true) return { error: "Tick the box to confirm it's your own music or your own mixes." };
    const djName = cleanDjName(name);
    if (djName.length < 2) return { error: "Pick a DJ name (2 letters or more)." };
    const page = cleanPageLink(link);
    if (!page) return { error: "Add a link to your own page (it has to start with https://), so people who like your set can find you." };
    const prev = this.djs[account.id];
    if (prev?.removed) return { error: "Festival staff removed you as a DJ. Ask them if you think that was a mistake." };
    this.djs[account.id] = {
      id: account.id, account: account.name, name: djName, link: page,
      approved: prev?.approved ?? false, removed: false,
      at: prev?.at ?? new Date(this.now()).toISOString(), ownMusic: true,
    };
    this.record(account.name, prev ? "profile" : "signup", { dj: { id: account.id, name: djName }, link: page });
    this.save();
    return { ok: true, dj: this.publicDj(account.id), approved: this.rulesData.signup === "open" || this.djs[account.id].approved };
  }

  publicDj(accountId) {
    const d = this.djs[accountId];
    return d ? { name: d.name, link: d.link } : null;
  }

  // ---------- Sets (DJ slots) ----------
  // What's on a stage right now, and what's booked after it.
  current(stageId, now = this.now()) {
    return this.sets.filter((s) => s.stage === stageId && s.status === "booked" && s.startsAt <= now && (!s.endsAt || now < s.endsAt))
      .sort((a, b) => a.startsAt - b.startsAt)[0] ?? null;
  }
  upNext(stageId, now = this.now()) {
    return this.sets.filter((s) => s.stage === stageId && s.status === "booked" && s.startsAt > now).sort((a, b) => a.startsAt - b.startsAt);
  }
  // When a stage is next free (after everything booked on it), or Infinity if an open-ended set is on.
  freeAt(stageId, now = this.now()) {
    let t = now;
    for (const s of this.sets) {
      if (s.stage !== stageId || s.status !== "booked") continue;
      if (!s.endsAt) return Infinity;
      if (s.endsAt > t) t = s.endsAt;
    }
    return t;
  }

  // Link a mix to a stage. stages: [{ id, label, genre }] from the layout. Returns { ok, set, text } or { error }.
  link(account, { stage: stageId, title, url, genre, startsAt } = {}, { stages = [], staff = false } = {}) {
    this.refresh();
    const now = this.now();
    const why = account?.id ? this.whyNot(account.id, { staff }) : "Sign in first.";
    if (why) return { error: why };
    const stage = stages.find((s) => s.id === stageId);
    if (!stage) return { error: "Pick a stage." };
    const mix = parseMixLink(url);
    if (mix.error) return mix;
    const name = cleanTitle(title);
    if (name.length < 2) return { error: "Give your mix a title." };
    // A stage plays one genre; the mix has to match it. (A stage with no genre takes anything.)
    if (!genreById(genre)) return { error: "Pick the genre of your mix." };
    if (stage.genre && genre !== stage.genre) {
      const fits = stages.filter((s) => s.genre === genre).map((s) => s.label);
      return { error: `${stage.label} plays ${genreName(stage.genre)}, and your mix is ${genreName(genre)}.${fits.length ? ` Try ${fits.join(" or ")}.` : ""}` };
    }
    if (this.sets.some((s) => s.dj === account.id && LIVE.has(s.status) && (!s.endsAt || s.endsAt > now))) return { error: "You already have a set on or coming up. End it first, or wait until it's done." };
    if (this.sets.filter((s) => s.stage === stage.id && LIVE.has(s.status) && (!s.endsAt || s.endsAt > now)).length >= DJ_LIMITS.queuePerStage) return { error: `${stage.label} is fully booked for now. Try another stage or come back later.` };

    const rules = this.rulesData;
    const length = rules.setMinutes * 60_000;
    const d = this.djs[account.id];
    const set = {
      id: "s_" + randomBytes(5).toString("hex"), stage: stage.id, dj: account.id, djName: d.name,
      title: name, url: mix.url, provider: mix.provider, ...(mix.id ? { mixId: mix.id } : {}), genre,
      startsAt: 0, endsAt: 0, status: "booked", at: new Date(now).toISOString(),
    };
    let text;
    if (rules.order === "organizer" && !staff) {
      set.status = "pending";
      text = `Thanks! Your mix is waiting for festival staff to put it on ${stage.label}.`;
    } else if (rules.order === "schedule") {
      const start = Number(startsAt);
      if (!Number.isFinite(start) || start < now - 60_000) return { error: "Pick a start time that's still to come." };
      if (start > now + DJ_LIMITS.scheduleDays * 86400_000) return { error: `Sets can be booked up to ${DJ_LIMITS.scheduleDays} days ahead.` };
      const len = length || 60 * 60_000;
      const clash = this.sets.find((s) => s.stage === stage.id && s.status === "booked" && (!s.endsAt || s.endsAt > now) && start < (s.endsAt || Infinity) && s.startsAt < start + len);
      if (clash) return { error: `${stage.label} is taken then (${clash.djName}). Pick another time.` };
      set.startsAt = Math.max(start, now); set.endsAt = set.startsAt + len;
      text = set.startsAt <= now + 1000 ? `You're on ${stage.label} now!` : `Booked! You're on ${stage.label} at the time you picked.`;
    } else {
      const free = this.freeAt(stage.id, now);
      if (free === Infinity) return { error: `${this.current(stage.id, now)?.djName ?? "Someone"} is playing ${stage.label} with no end time. Try another stage, or ask staff.` };
      if (!length && free > now) return { error: `${stage.label} is busy right now. Try again when the set is over.` };
      set.startsAt = free; set.endsAt = length ? free + length : 0;
      text = free <= now ? `You're on ${stage.label} now!` : `You're in the queue for ${stage.label}: about ${Math.max(1, Math.round((free - now) / 60_000))} min to go.`;
    }
    this.sets.push(set);
    // The record of who linked what.
    this.record(account.name, "link", { dj: { id: account.id, name: d.name }, set: set.id, stage: stage.id, title: name, url: mix.url, genre, status: set.status });
    this.save();
    return { ok: true, set, text };
  }

  // Staff put a waiting mix on (order = "organizer"): it goes on now, or queues behind what's playing.
  approveSet(setId, by) {
    this.refresh();
    const set = this.sets.find((s) => s.id === setId && s.status === "pending");
    if (!set) return { error: "That mix isn't waiting anymore." };
    const now = this.now(), free = this.freeAt(set.stage, now);
    if (free === Infinity) return { error: "That stage has a set with no end time on it. Stop it first." };
    const length = (this.rulesData.setMinutes || 60) * 60_000;
    Object.assign(set, { status: "booked", startsAt: free, endsAt: free + length });
    this.record(by, "approve-set", { dj: { id: set.dj, name: set.djName }, set: set.id, stage: set.stage, url: set.url });
    this.save();
    return { ok: true, set };
  }

  // Close a set and move what's queued behind it on that stage forward, so the stage isn't silent.
  close(set, status) {
    const now = this.now();
    const wasPlaying = set.status === "booked" && set.startsAt <= now && (!set.endsAt || set.endsAt > now);
    const gap = set.status === "booked" && set.endsAt ? set.endsAt - Math.max(now, set.startsAt) : 0;
    set.status = status;
    set.endedAt = new Date(now).toISOString();
    if (wasPlaying && set.endsAt) set.endsAt = now;
    if (this.rulesData.order !== "schedule" && gap > 0) {
      for (const s of this.sets) if (s.stage === set.stage && s.status === "booked" && s.startsAt >= (set.endsAt || now)) { s.startsAt -= gap; if (s.endsAt) s.endsAt -= gap; }
    }
  }

  // A DJ ends their own set (playing, queued or waiting).
  end(account, setId) {
    this.refresh();
    const set = this.sets.find((s) => s.id === setId && s.dj === account?.id && LIVE.has(s.status));
    if (!set) return { error: "That set is already over." };
    this.close(set, "ended");
    this.record(account.name, "end", { dj: { id: set.dj, name: set.djName }, set: set.id, stage: set.stage });
    this.save();
    return { ok: true };
  }

  // ---------- Moderation ----------
  // Stop a set (the takedown path): by set id, or whatever is playing on a stage.
  stop(target, by, reason = "") {
    this.refresh();
    const set = this.sets.find((s) => s.id === target && LIVE.has(s.status)) ?? this.current(target);
    if (!set) return { error: "Nothing to stop there." };
    this.close(set, "stopped");
    this.record(by, "stop", { dj: { id: set.dj, name: set.djName }, set: set.id, stage: set.stage, title: set.title, url: set.url, reason: note(reason) });
    this.save();
    return { ok: true, set };
  }

  // Remove a DJ: every set of theirs stops, and they can't link again until restored.
  removeDj(accountId, by, reason = "") {
    this.refresh();
    const d = this.djs[accountId];
    if (!d) return { error: "That player isn't a DJ." };
    d.removed = true; d.approved = false;
    let stopped = 0;
    for (const s of this.sets) if (s.dj === accountId && LIVE.has(s.status)) { this.close(s, "stopped"); stopped++; }
    this.record(by, "remove", { dj: { id: accountId, name: d.name }, stopped, reason: note(reason) });
    this.save();
    return { ok: true, stopped };
  }
  restoreDj(accountId, by) {
    this.refresh();
    const d = this.djs[accountId];
    if (!d) return { error: "That player isn't a DJ." };
    d.removed = false;
    this.record(by, "restore", { dj: { id: accountId, name: d.name } });
    this.save();
    return { ok: true };
  }
  approveDj(accountId, by) {
    this.refresh();
    const d = this.djs[accountId];
    if (!d) return { error: "That player hasn't signed up as a DJ." };
    if (d.removed) return { error: "That DJ was removed. Restore them first." };
    d.approved = true;
    this.record(by, "approve", { dj: { id: accountId, name: d.name } });
    this.save();
    return { ok: true };
  }

  // ---------- What goes to the browser ----------
  publicSet(s) {
    const d = this.djs[s.dj];
    return { id: s.id, title: s.title, url: s.url, provider: s.provider, ...(s.mixId ? { mixId: s.mixId } : {}), genre: s.genre, startsAt: s.startsAt, endsAt: s.endsAt, dj: { name: s.djName, link: d?.link ?? "" } };
  }
  // Everyone: each stage with its genre, what's playing and what's next. `now` lets browsers line up their clocks.
  public(stages = [], now = this.now()) {
    this.refresh();
    return {
      now, rules: { ...this.rulesData },
      stages: stages.map((st) => {
        const cur = this.current(st.id, now);
        return { id: st.id, label: st.label, genre: st.genre ?? "", playing: cur ? this.publicSet(cur) : null, next: this.upNext(st.id, now).slice(0, 3).map((s) => this.publicSet(s)) };
      }),
    };
  }
  // A signature that changes whenever what's playing anywhere changes (the room rebroadcasts then).
  playingKey(stages = [], now = this.now()) { return stages.map((st) => this.current(st.id, now)?.id ?? "-").join("|"); }

  // One player's own DJ side: their profile, whether they may link, and their sets that aren't over.
  mine(accountId, { staff = false } = {}) {
    const d = this.dj(accountId);
    if (!d) return { dj: null, canLink: false, why: "", sets: [] };
    const why = this.whyNot(accountId, { staff });
    const now = this.now();
    return {
      dj: { name: d.name, link: d.link, approved: d.approved, removed: d.removed }, canLink: !why, why,
      sets: this.sets.filter((s) => s.dj === accountId && LIVE.has(s.status) && (!s.endsAt || s.endsAt > now)).map((s) => ({ ...this.publicSet(s), stage: s.stage, status: s.status })),
    };
  }
  // Staff: every DJ, mixes waiting to be put on, and the recent record.
  staffView() {
    this.refresh();
    return {
      djs: Object.values(this.djs).map((d) => ({ id: d.id, account: d.account, name: d.name, link: d.link, approved: d.approved, removed: d.removed })),
      pending: this.sets.filter((s) => s.status === "pending").map((s) => ({ ...this.publicSet(s), stage: s.stage })),
      log: this.log.slice(-30).reverse(),
    };
  }
  logFor(accountId) { this.refresh(); return this.log.filter((l) => l.dj?.id === accountId); }
}

export const providerName = (p) => PROVIDERS[p] ?? p;

let shared = null;
export const djStore = () => (shared ??= new DjStore());
