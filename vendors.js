// Vendor listings: what each stall sells and where it'll be next, editable by the vendor.
//
// Storage is two small JSON files in data/ (FV_DATA_DIR to move it):
//   vendors.json      the edited listings, keyed by vendor id. Anything not edited yet falls back
//                     to the starting listing in shared/venue.js.
//   vendor-keys.json  a SHA-256 hash of each vendor's private edit key (never the key itself).
// Plenty for a few hundred vendors; swap in a real database behind the same methods later.
//
// Who can edit: whoever holds that vendor's edit key (issued by `npm run vendor-link -- <id>`),
// or the festival admin key in the FV_ADMIN_KEY environment variable, which can edit any stall.
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { VENDORS, ZONE_LABELS } from "../shared/venue.js";
import { sanitizeListing } from "../shared/listings.js";

const DEFAULT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
const pick = (v) => ({ name: v.name, tagline: v.tagline ?? "", link: v.link ?? "", items: v.items ?? [], next: v.next ?? [], ...(v.truck ? { truck: v.truck } : {}) });
const hash = (key) => createHash("sha256").update(String(key)).digest();

export class VendorStore {
  constructor({ dir = process.env.FV_DATA_DIR || DEFAULT_DIR, adminKey = process.env.FV_ADMIN_KEY || "" } = {}) {
    this.dir = dir;
    this.file = join(dir, "vendors.json");
    this.keysFile = join(dir, "vendor-keys.json");
    this.adminHash = adminKey.length >= 12 ? hash(adminKey) : null;   // ignore weak admin keys
    this.listeners = new Set();
    this.edited = readJson(this.file).vendors ?? {};
  }

  has(id) { return VENDORS.some((v) => v.id === id); }

  // The public listing for one stall: layout facts plus the (edited or starting) listing.
  get(id) {
    const v = VENDORS.find((x) => x.id === id);
    if (!v) return null;
    const e = this.edited[id];
    return { id, zone: v.zone, zoneLabel: ZONE_LABELS[v.zone] ?? "", kind: v.kind, color: v.color, ...(e ? pick(e) : pick(v)), updatedAt: e?.updatedAt ?? null };
  }

  all() { return VENDORS.map((v) => this.get(v.id)); }

  // Returns { listing } or { error, status }.
  update(id, raw) {
    if (!this.has(id)) return { error: "No stall with that id.", status: 404 };
    const { listing, error } = sanitizeListing(raw);
    if (error) return { error, status: 400 };
    this.edited[id] = { ...listing, updatedAt: new Date().toISOString() };
    writeJson(this.file, { vendors: this.edited });
    const pub = this.get(id);
    for (const fn of this.listeners) { try { fn(pub); } catch (err) { console.error(err); } }
    return { listing: pub };
  }

  // Go back to the starting listing from shared/venue.js.
  reset(id) {
    delete this.edited[id];
    writeJson(this.file, { vendors: this.edited });
    const pub = this.get(id);
    for (const fn of this.listeners) fn(pub);
    return pub;
  }

  // Subscribe to edits (the game rooms use this to push changes to players). Returns an unsubscribe function.
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  // Make a new private edit key for a stall. Replaces any older key, so old links stop working.
  issueKey(id) {
    if (!this.has(id)) throw new Error(`No stall with id "${id}"`);
    const key = randomBytes(18).toString("base64url");
    const keys = readJson(this.keysFile);
    keys[id] = hash(key).toString("hex");
    writeJson(this.keysFile, keys);
    return key;
  }

  revokeKey(id) {
    const keys = readJson(this.keysFile);
    delete keys[id];
    writeJson(this.keysFile, keys);
  }

  // Is `key` allowed to edit stall `id`? (Reads the keys file each time so new links work without a restart.)
  canEdit(id, key) {
    if (typeof key !== "string" || key.length < 12 || key.length > 200) return false;
    const h = hash(key);
    if (this.adminHash && timingSafeEqual(h, this.adminHash)) return true;
    const stored = readJson(this.keysFile)[id];
    if (typeof stored !== "string" || stored.length !== 64) return false;
    return timingSafeEqual(h, Buffer.from(stored, "hex"));
  }
}

function readJson(file) {
  if (!existsSync(file)) return {};
  try { return JSON.parse(readFileSync(file, "utf8")); }
  catch (err) { console.error(`Couldn't read ${file}: ${err.message}`); return {}; }
}

// Write to a temp file then rename, so a crash mid-write can't leave a half-written file.
function writeJson(file, data) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, file);
}

// The one store the game server uses.
let shared = null;
export const vendorStore = () => (shared ??= new VendorStore());
