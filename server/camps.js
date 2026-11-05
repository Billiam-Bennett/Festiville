// Player camps, saved in data/camps.json (FV_DATA_DIR to move it). Camps belong to accounts and stay
// up when their owner is offline; every festival room shows them all.
//
// The rules (where a spot may go, what fits in it) are in shared/camps.js; prices in shared/economy.js.
// This file keeps the records and tells the game rooms when one changes.
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { checkSpot, cleanCampItems, snap } from "../shared/camps.js";
import { plotById, plotRank } from "../shared/economy.js";
import { LAYOUT } from "../shared/venue.js";

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
    this.camps = data.camps ?? {};   // account id -> { owner, x, z, plot, items, updatedAt }
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

  // What everyone may see about a camp. The public id is the owner's name, not their account id.
  public(accountId) {
    const c = this.camps[accountId];
    return c ? { id: c.owner.toLowerCase(), owner: c.owner, x: c.x, z: c.z, plot: c.plot, items: [...c.items] } : null;
  }
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
    this.camps[accountId] = {
      owner, x, z, plot,
      items: cleanCampItems(items ?? prev?.items ?? ["tent_basic"], owned, plot),
      updatedAt: new Date().toISOString(),
    };
    this.save(accountId);
    return { camp: this.public(accountId) };
  }

  setItems(accountId, items, owned) {
    const c = this.of(accountId);
    if (!c) return { error: "Claim a camp spot first." };
    c.items = cleanCampItems(items, owned, c.plot);
    c.updatedAt = new Date().toISOString();
    this.save(accountId);
    return { camp: this.public(accountId) };
  }

  release(accountId) {
    this.refresh();
    if (!this.camps[accountId]) return false;
    const pub = this.public(accountId);
    delete this.camps[accountId];
    this.save(accountId, pub.id);
    return true;
  }

  // Keep the owner's name current (e.g. on join), so signs and the public id match.
  rename(accountId, owner) {
    const c = this.of(accountId);
    if (c && c.owner !== owner) { const old = c.owner.toLowerCase(); c.owner = owner; this.save(accountId, old); }
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
