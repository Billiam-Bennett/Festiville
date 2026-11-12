// Player camps, saved in data/camps.json (FV_DATA_DIR to move it). Camps belong to accounts and stay
// up when their owner is offline; every festival room shows them all.
//
// The rules (where a spot may go, what fits in it) are in shared/camps.js; prices in shared/economy.js.
// This file keeps the records and tells the game rooms when one changes.
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { checkSpot, cleanCampItems, snap } from "../shared/camps.js";
import { plotById, plotRank, FREE_CAMP_ITEMS, PREMIUM_BUNDLE, cleanLedColor, campItemById } from "../shared/economy.js";
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
    return c ? { id: c.owner.toLowerCase(), owner: c.owner, x: c.x, z: c.z, plot: c.plot, items: [...c.items], ...(c.led ? { led: c.led } : {}), ...(c.cart ? { cart: true } : {}) } : null;
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
      ...(prev?.led ? { led: prev.led } : {}),
      ...(prev?.cart ? { cart: true } : {}),
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

  // The colour of the LED tent (premium bundle). Any camp can store one; it only shows on an LED tent.
  setLed(accountId, color) {
    const c = this.of(accountId);
    if (!c) return { error: "Claim a camp spot first." };
    c.led = cleanLedColor(color);
    c.updatedAt = new Date().toISOString();
    this.save(accountId);
    return { camp: this.public(accountId) };
  }

  // Does the owner have a golf cart? It's shown parked at their camp while they aren't driving it.
  setCart(accountId, has) {
    const c = this.of(accountId);
    if (!c || !!c.cart === !!has) return;
    if (has) c.cart = true; else delete c.cart;
    this.save(accountId);
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

// What upgrading from one spot size to another costs in credits (the difference), or null if it
// isn't bigger. The premium 20×20 is never sold for credits: it costs 0 here and the caller checks
// membership (claimCamp / upgradeCamp below).
export function upgradeCost(fromPlot, toPlot) {
  const a = plotById(fromPlot), b = plotById(toPlot);
  if (!a || !b || plotRank(toPlot) <= plotRank(fromPlot)) return null;
  return b.premium ? 0 : Math.max(0, b.price - a.price);
}

// ---------- Claiming and upgrading (the camp rule) ----------
// Every member gets one free 10×10. The 10×20 is a credit upgrade. The 20×20 is for premium members
// only and comes with the premium bundle set up. No networking here: the game room passes in the
// account store, the camp store, the account, whether they're a premium member, and what they own.
// Both return { ok, text } or { error }.

// A premium camp starts with the bundle set up: the LED tent instead of the plain one, plus the
// neon sign, string lights and flag.
function withBundle(items) {
  const rest = items.filter((id) => campItemById(id)?.group !== "tent" && !PREMIUM_BUNDLE.includes(id));
  return [...PREMIUM_BUNDLE, ...rest];
}

export function claimCamp(store, camps, account, { x, z, plot }, { premium = false, owned = FREE_CAMP_ITEMS } = {}) {
  if (camps.of(account.id)) return { error: "You already have a camp. Use Move or Upgrade instead." };
  const size = plotById(plot);
  if (!size) return { error: "Pick a spot size." };
  if (size.premium && !premium) return { error: `The ${size.name} comes with premium membership. Your free 10×10 is ready to claim.` };
  const why = camps.check(account.id, x, z, size.id);
  if (why) return { error: why };
  if (size.price > 0) {
    const paid = store.changeCredits(account.id, -size.price, `camp:${size.id}`);
    if (paid.error) return paid;
  }
  const out = camps.place(account.id, account.username, { x, z, plot: size.id, items: size.premium ? withBundle(["tent_basic"]) : ["tent_basic"] }, owned);
  if (out.error) {
    if (size.price > 0) store.changeCredits(account.id, size.price, `refund:camp:${size.id}`);
    return out;
  }
  return { ok: true, text: size.price > 0 || size.premium ? `Your ${size.name} is yours! Set up your camp from the Camp tab.` : `Your free ${size.name} is yours! Set up your camp from the Camp tab.` };
}

export function upgradeCamp(store, camps, account, plot, { premium = false, owned = FREE_CAMP_ITEMS } = {}) {
  const mine = camps.of(account.id);
  if (!mine) return { error: "Claim a camp spot first." };
  const size = plotById(plot);
  const cost = upgradeCost(mine.plot, plot);
  if (cost == null) return { error: "Pick a bigger spot size." };
  if (size.premium && !premium) return { error: `The ${size.name} comes with premium membership. It can't be bought with credits.` };
  const why = camps.check(account.id, mine.x, mine.z, plot);
  if (why) return { error: `There isn't room to grow here (${why}) Move somewhere roomier first.` };
  if (cost > 0) {
    const paid = store.changeCredits(account.id, -cost, `camp:upgrade:${plot}`);
    if (paid.error) return paid;
  }
  const out = camps.place(account.id, account.username, { x: mine.x, z: mine.z, plot, items: size.premium ? withBundle(mine.items) : mine.items }, owned);
  if (out.error) {
    if (cost > 0) store.changeCredits(account.id, cost, `refund:camp:upgrade:${plot}`);
    return out;
  }
  return { ok: true, text: `Upgraded to a ${size.name}!` };
}

let shared = null;
export const campStore = () => (shared ??= new CampStore());
