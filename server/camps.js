// Player camps, saved in data/camps.json (FV_DATA_DIR to move it). Camps belong to accounts and stay
// up when their owner is offline; every festival room shows them all.
//
// The rules (where a spot may go, what fits in it) are in shared/camps.js; prices in shared/economy.js.
// This file keeps the records and tells the game rooms when one changes.
//
// Crew camps: an owner can share their camp with their crew. Campmates set up things THEY own in it
// (each item remembers who brought it); you pack away your own things, and the owner can pack away
// anything. Nobody pays for anyone else's things: credits never move between players.
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { checkSpot, cleanCampItems, snap, musicById, DEFAULT_MUSIC } from "../shared/camps.js";
import { plotById, plotRank, campItemById } from "../shared/economy.js";
import { LAYOUT } from "../shared/venue.js";
import { CREW_MAX } from "../shared/quests-data.js";

export const MAX_MATES = CREW_MAX - 1;   // a crew camp holds a whole crew

const DEFAULT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "data");

export class CampStore {
  constructor({ dir = process.env.FV_DATA_DIR || DEFAULT_DIR, layoutItems = () => LAYOUT.items } = {}) {
    this.file = join(dir, "camps.json");
    this.layoutItems = layoutItems;
    this.listeners = new Set();
    this.load();
  }

  load() {
    let data = {};
    if (existsSync(this.file)) {
      try { data = JSON.parse(readFileSync(this.file, "utf8")); }
      catch (err) { console.error(`Couldn't read ${this.file}: ${err.message}`); }
    }
    // account id -> { owner, x, z, plot, items, music, mates: [account ids], mateNames: { id: name },
    //                by: { item id: account id of whoever set it up (missing = the owner) }, updatedAt }
    this.camps = data.camps ?? {};
    this.seen = this.mtime();
  }
  mtime() { try { return statSync(this.file).mtimeMs; } catch { return 0; } }
  // Picks up `npm run account -- camp-release <user>` while the server runs.
  refresh() {
    if (this.mtime() === this.seen) return;
    const before = this.camps;
    this.load();
    for (const id of new Set([...Object.keys(before), ...Object.keys(this.camps)])) {
      if (JSON.stringify(before[id]) !== JSON.stringify(this.camps[id])) this.emit(id);
    }
  }

  // What everyone may see about a camp. The public id is the owner's name, and people are named, not
  // identified by account id. by: who set up each item ({ item id: name }).
  public(accountId) {
    const c = this.camps[accountId];
    if (!c) return null;
    const by = Object.fromEntries(c.items.map((i) => [i, this.nameIn(accountId, this.byOf(accountId, i))]));
    return { id: c.owner.toLowerCase(), owner: c.owner, x: c.x, z: c.z, plot: c.plot, items: [...c.items], music: c.music ?? DEFAULT_MUSIC, mates: (c.mates ?? []).map((m) => this.nameIn(accountId, m)), by };
  }
  byOf(ownerId, item) { return this.camps[ownerId]?.by?.[item] ?? ownerId; }
  nameIn(ownerId, id) { const c = this.camps[ownerId]; return id === ownerId ? c.owner : c.mateNames?.[id] ?? "someone"; }
  // The owner of the crew camp this account is a campmate in, or null.
  mateOf(accountId) { this.refresh(); return Object.keys(this.camps).find((o) => (this.camps[o].mates ?? []).includes(accountId)) ?? null; }
  all() { this.refresh(); return Object.keys(this.camps).map((id) => this.public(id)); }
  of(accountId) { this.refresh(); return this.camps[accountId] ?? null; }

  // Would this spot work? "" if yes, else the reason.
  check(accountId, x, z, plot) {
    this.refresh();
    const others = Object.entries(this.camps).filter(([id]) => id !== accountId).map(([, c]) => ({ ...c, id: c.owner }));
    return checkSpot(this.layoutItems(), others, { x, z, plot });
  }

  // Put (or move/resize) a camp. Doesn't charge anything: the caller takes the credits first.
  // Returns { camp } or { error }.
  place(accountId, owner, { x, z, plot, items }, owned) {
    x = snap(x); z = snap(z);
    const why = this.check(accountId, x, z, plot);
    if (why) return { error: why };
    const prev = this.camps[accountId];
    // Things already in the camp stay (campmates' things count as owned: they were checked when added).
    const ownedHere = [...new Set([...owned, ...(prev?.items ?? [])])];
    this.camps[accountId] = {
      owner, x, z, plot,
      items: cleanCampItems(items ?? prev?.items ?? ["tent_basic"], ownedHere, plot),
      music: prev?.music ?? DEFAULT_MUSIC,
      mates: prev?.mates ?? [], mateNames: prev?.mateNames ?? {}, by: prev?.by ?? {},
      updatedAt: new Date().toISOString(),
    };
    this.tidy(accountId);
    this.save(accountId);
    return { camp: this.public(accountId) };
  }

  // The owner replaces their own set-up items in one go (campmates' things stay).
  setItems(accountId, items, owned) {
    const c = this.of(accountId);
    if (!c) return { error: "Claim a camp spot first." };
    const theirs = c.items.filter((i) => this.byOf(accountId, i) !== accountId);
    const mine = cleanCampItems(items, owned, c.plot).filter((i) => !theirs.includes(i));
    c.items = cleanCampItems([...mine, ...theirs], [...owned, ...theirs], c.plot);
    for (const i of mine) if (c.by) delete c.by[i];   // the owner's own (no entry = the owner)
    this.tidy(accountId);
    c.updatedAt = new Date().toISOString();
    this.save(accountId);
    return { camp: this.public(accountId) };
  }

  // Set up (on) or pack away (off) one item in the camp owned by `campOwnerId`, as `byId` (the owner
  // or a campmate). You can only set up things you own; you pack away your own things, and the owner
  // can pack away anything. Returns { camp } or { error }.
  setItem(campOwnerId, byId, itemId, on, owned) {
    const c = this.of(campOwnerId);
    if (!c) return { error: "That camp isn't there any more." };
    if (byId !== campOwnerId && !(c.mates ?? []).includes(byId)) return { error: "You're not part of that camp." };
    const item = campItemById(itemId);
    if (!item) return { error: "That's not a camp item." };
    const who = (id) => this.nameIn(campOwnerId, id);
    if (on) {
      if (!owned.includes(itemId)) return { error: `You don't own ${item.name} yet. It's in the shop.` };
      if (c.items.includes(itemId)) {
        const holder = this.byOf(campOwnerId, itemId);
        return holder === byId ? { camp: this.public(campOwnerId) } : { error: `${who(holder)} already set up their ${item.name} here.` };
      }
      let next = [...c.items];
      const same = item.group && next.find((i) => campItemById(i)?.group === item.group);
      if (same) {
        const holder = this.byOf(campOwnerId, same);
        if (holder !== byId && byId !== campOwnerId) return { error: `There's already a ${campItemById(same).name.toLowerCase()} here (${who(holder)}'s).` };
        next = next.filter((i) => i !== same);   // swap tents
      }
      next.push(itemId);
      const cleaned = cleanCampItems(next, next, c.plot);
      if (!cleaned.includes(itemId)) return { error: "No ground space left. Pack something away or upgrade the spot." };
      c.items = cleaned;
      c.by = { ...(c.by ?? {}), [itemId]: byId };
    } else {
      if (!c.items.includes(itemId)) return { camp: this.public(campOwnerId) };
      const holder = this.byOf(campOwnerId, itemId);
      if (holder !== byId && byId !== campOwnerId) return { error: holder === campOwnerId ? `Only ${c.owner} can pack that away.` : `Only ${who(holder)} or ${c.owner} can pack that away.` };
      c.items = c.items.filter((i) => i !== itemId);
    }
    this.tidy(campOwnerId);
    c.updatedAt = new Date().toISOString();
    this.save(campOwnerId);
    return { camp: this.public(campOwnerId) };
  }

  // What the camp's PA system plays (shared/camps.js → MUSIC_STYLES). The owner picks, or whoever
  // brought the PA to a crew camp.
  setMusic(campOwnerId, style, byId = campOwnerId) {
    const c = this.of(campOwnerId);
    if (!c) return { error: "Claim a camp spot first." };
    if (byId !== campOwnerId && this.byOf(campOwnerId, "pa") !== byId) return { error: `Only ${c.owner} or whoever brought the PA picks the music.` };
    if (!musicById(style)) return { error: "Pick a music style." };
    c.music = style;
    c.updatedAt = new Date().toISOString();
    this.save(campOwnerId);
    return { camp: this.public(campOwnerId) };
  }

  // ---------- Crew camps ----------
  // Add people ([{ id, name }], e.g. the owner's crew) as campmates. Someone already in another crew
  // camp is skipped (one crew camp each), and a camp holds MAX_MATES campmates.
  // Returns { added: [names], skipped: [reasons] } or { error }.
  share(ownerId, people) {
    const c = this.of(ownerId);
    if (!c) return { error: "Claim a camp spot first." };
    c.mates ??= []; c.mateNames ??= {};
    const added = [], skipped = [];
    for (const p of people) {
      if (!p?.id || p.id === ownerId || c.mates.includes(p.id)) continue;
      const other = this.mateOf(p.id);
      if (other) { skipped.push(`${p.name} is already part of ${this.camps[other].owner}'s camp`); continue; }
      if (c.mates.length >= MAX_MATES) { skipped.push(`${p.name} didn't fit: a crew camp holds ${MAX_MATES + 1} people`); continue; }
      c.mates.push(p.id);
      c.mateNames[p.id] = p.name;
      added.push(p.name);
    }
    if (added.length) { c.updatedAt = new Date().toISOString(); this.save(ownerId); }
    return { added, skipped };
  }

  // The owner removes a campmate (by name); their things leave with them. Returns { id, name } or { error }.
  unshare(ownerId, mateName) {
    const c = this.of(ownerId);
    const id = Object.keys(c?.mateNames ?? {}).find((m) => (c.mates ?? []).includes(m) && c.mateNames[m].toLowerCase() === String(mateName).toLowerCase());
    if (!id) return { error: "They're not in your crew camp." };
    return this.removeMate(ownerId, id);
  }

  // A campmate leaves the crew camp they're in. Returns { ownerId, name } or { error }.
  leave(mateId) {
    const ownerId = this.mateOf(mateId);
    if (!ownerId) return { error: "You're not in a crew camp." };
    return { ownerId, ...this.removeMate(ownerId, mateId) };
  }

  removeMate(ownerId, mateId) {
    const c = this.camps[ownerId];
    const name = this.nameIn(ownerId, mateId);
    c.items = c.items.filter((i) => this.byOf(ownerId, i) !== mateId);
    c.mates = (c.mates ?? []).filter((m) => m !== mateId);
    delete c.mateNames?.[mateId];
    this.tidy(ownerId);
    c.updatedAt = new Date().toISOString();
    this.save(ownerId);
    return { id: mateId, name };
  }

  // Drop "who brought it" entries for things no longer set up.
  tidy(ownerId) {
    const c = this.camps[ownerId];
    if (c?.by) c.by = Object.fromEntries(Object.entries(c.by).filter(([i, id]) => c.items.includes(i) && id !== ownerId));
  }

  release(accountId) {
    this.refresh();
    if (!this.camps[accountId]) return false;
    const pub = this.public(accountId);
    delete this.camps[accountId];
    this.save(accountId, pub.id);
    return true;
  }

  // Keep names current (e.g. on join), so signs, the public id and campmate lists match.
  rename(accountId, name) {
    const c = this.of(accountId);
    if (c && c.owner !== name) { const old = c.owner.toLowerCase(); c.owner = name; this.save(accountId, old); }
    const ownerId = this.mateOf(accountId);
    const crew = ownerId && this.camps[ownerId];
    if (crew && crew.mateNames?.[accountId] !== name) { crew.mateNames = { ...(crew.mateNames ?? {}), [accountId]: name }; this.save(ownerId); }
  }

  save(accountId, removedPublicId = "") {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ camps: this.camps }, null, 1));
    renameSync(tmp, this.file);
    this.seen = this.mtime();
    this.emit(accountId, removedPublicId);
  }

  // Listeners get (publicCamp | null, publicId) for every change. Returns an unsubscribe function.
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(accountId, removedPublicId = "") {
    const pub = this.public(accountId);
    for (const fn of this.listeners) {
      try {
        if (removedPublicId && (!pub || pub.id !== removedPublicId)) fn(null, removedPublicId);
        if (pub) fn(pub, pub.id);
      } catch (err) { console.error(err); }
    }
  }
}

// What upgrading from one spot size to another costs (the difference), or null if it isn't bigger.
export function upgradeCost(fromPlot, toPlot) {
  const a = plotById(fromPlot), b = plotById(toPlot);
  if (!a || !b || plotRank(toPlot) <= plotRank(fromPlot)) return null;
  return b.price - a.price;
}

let shared = null;
export const campStore = () => (shared ??= new CampStore());
