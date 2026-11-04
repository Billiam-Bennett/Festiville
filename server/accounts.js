// Player accounts: username + password, sign-in sessions, and saved progress (badges, last look,
// unlocked premium looks).
//
// Saved in data/ (FV_DATA_DIR to move it), next to the vendor files:
//   accounts.json   one entry per player. Passwords are stored ONLY as scrypt hashes with a random salt.
//   sessions.json   sign-in sessions, keyed by a SHA-256 hash of the session token (never the token itself).
//   credits-ledger.jsonl   every credit earned or spent, one JSON line each (append-only audit trail;
//                   the balance itself lives on the account).
// JSON files are fine for a few thousand players; move to a real database (SQLite/Postgres) behind
// these same methods before a big launch.
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, statSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { FOREVER, untilText } from "./moderation.js";
import { STARTING_CREDITS, FREE_CAMP_ITEMS } from "../shared/economy.js";

const scrypt = promisify(scryptCb);
const DEFAULT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
const SESSION_DAYS = 30;
const KEY_LEN = 64;
const RESERVED = new Set(["admin", "administrator", "festiville", "mod", "moderator", "staff", "support", "system", "server", "you", "someone", "raver"]);

export const USERNAME_RULES = "3–16 letters, numbers or _";
export const PASSWORD_MIN = 8;

// Returns an error message, or "" if the username is acceptable.
export function checkUsername(u) {
  if (typeof u !== "string" || !/^[A-Za-z0-9_]{3,16}$/.test(u)) return `Usernames are ${USERNAME_RULES}.`;
  if (RESERVED.has(u.toLowerCase())) return "That username is reserved. Pick another.";
  return "";
}
export function checkPassword(p, username = "") {
  if (typeof p !== "string" || p.length < PASSWORD_MIN) return `Passwords need at least ${PASSWORD_MIN} characters.`;
  if (p.length > 128) return "That password is too long (128 characters max).";
  if (username && p.toLowerCase().includes(username.toLowerCase())) return "Your password can't contain your username.";
  return "";
}

const sha = (s) => createHash("sha256").update(s).digest("hex");

export class AccountStore {
  constructor({ dir = process.env.FV_DATA_DIR || DEFAULT_DIR, now = () => Date.now() } = {}) {
    this.file = join(dir, "accounts.json");
    this.sessionsFile = join(dir, "sessions.json");
    this.ledgerFile = join(dir, "credits-ledger.jsonl");
    this.now = now;
    this.load();
    this.pruneSessions();
  }

  // Read both files. Also called when they change on disk, so `npm run account -- ...` (a separate
  // program) can unlock looks or reset passwords while the game server is running.
  load() {
    this.accounts = readJson(this.file).accounts ?? {};          // id -> account
    this.sessions = readJson(this.sessionsFile).sessions ?? {};  // sha(token) -> { accountId, expires }
    this.byName = new Map(Object.values(this.accounts).map((a) => [a.username.toLowerCase(), a.id]));
    this.seen = this.mtimes();
  }
  mtimes() { return [this.file, this.sessionsFile].map((f) => { try { return statSync(f).mtimeMs; } catch { return 0; } }).join("|"); }
  refresh() { if (this.mtimes() !== this.seen) this.load(); }

  // ---------- Sign up / sign in ----------
  async signup(username, password) {
    this.refresh();
    const bad = checkUsername(username) || checkPassword(password, username);
    if (bad) return { error: bad, status: 400 };
    if (this.byName.has(username.toLowerCase())) return { error: "That username is taken.", status: 409 };
    const salt = randomBytes(16);
    const hash = await scrypt(password, salt, KEY_LEN);
    if (this.byName.has(username.toLowerCase())) return { error: "That username is taken.", status: 409 };   // raced while hashing
    const id = "a_" + randomBytes(9).toString("base64url");
    const account = {
      id, username, createdAt: new Date(this.now()).toISOString(),
      password: { salt: salt.toString("base64"), hash: hash.toString("base64") },
      badges: [], look: "", recipe: "", unlocks: [], accessories: [],
      credits: STARTING_CREDITS, campItems: [],
    };
    this.accounts[id] = account;
    this.byName.set(username.toLowerCase(), id);
    this.save();
    this.ledger(account, STARTING_CREDITS, "welcome", STARTING_CREDITS);
    return { account: this.public(account), token: this.newSession(id) };
  }

  async login(username, password) {
    this.refresh();
    const account = typeof username === "string" ? this.accounts[this.byName.get(username.toLowerCase())] : null;
    // Hash even when the user doesn't exist, so response time doesn't reveal which usernames are real.
    const salt = account ? Buffer.from(account.password.salt, "base64") : DUMMY_SALT;
    const hash = await scrypt(typeof password === "string" ? password.slice(0, 128) : "", salt, KEY_LEN);
    const expected = account ? Buffer.from(account.password.hash, "base64") : DUMMY_HASH;
    if (!account || !timingSafeEqual(hash, expected)) return { error: "Wrong username or password.", status: 401 };
    const ban = this.bannedMessage(account);
    if (ban) return { error: ban, status: 403 };
    return { account: this.public(account), token: this.newSession(account.id) };
  }

  async setPassword(username, password) {
    const account = this.findByName(username);
    if (!account) return { error: "No such player." };
    const bad = checkPassword(password, account.username);
    if (bad) return { error: bad };
    const salt = randomBytes(16);
    account.password = { salt: salt.toString("base64"), hash: (await scrypt(password, salt, KEY_LEN)).toString("base64") };
    this.signOutEverywhere(account.id);
    this.save();
    return { ok: true };
  }

  // ---------- Sessions ----------
  newSession(accountId) {
    const token = randomBytes(32).toString("base64url");
    this.sessions[sha(token)] = { accountId, expires: this.now() + SESSION_DAYS * 86400_000 };
    this.saveSessions();
    return token;
  }

  // The account a session token belongs to, or null if it's unknown or expired.
  accountForToken(token) {
    if (typeof token !== "string" || token.length < 20 || token.length > 100) return null;
    this.refresh();
    const s = this.sessions[sha(token)];
    if (!s) return null;
    if (s.expires < this.now()) { delete this.sessions[sha(token)]; this.saveSessions(); return null; }
    return this.accounts[s.accountId] ?? null;
  }

  logout(token) {
    if (typeof token === "string" && this.sessions[sha(token)]) { delete this.sessions[sha(token)]; this.saveSessions(); }
  }

  signOutEverywhere(accountId) {
    for (const [k, s] of Object.entries(this.sessions)) if (s.accountId === accountId) delete this.sessions[k];
    this.saveSessions();
  }

  pruneSessions() {
    const now = this.now();
    let changed = false;
    for (const [k, s] of Object.entries(this.sessions)) if (s.expires < now || !this.accounts[s.accountId]) { delete this.sessions[k]; changed = true; }
    if (changed) this.saveSessions();
  }

  // ---------- Progress ----------
  findByName(username) { this.refresh(); return this.accounts[this.byName.get(String(username).toLowerCase())] ?? null; }
  get(id) { return this.accounts[id] ?? null; }

  setBadges(id, badges) {
    this.refresh();
    const a = this.accounts[id];
    if (!a) return;
    const next = [...new Set(badges)].sort();
    if (next.join(",") === [...a.badges].sort().join(",")) return;
    a.badges = next;
    this.save();
  }

  setLook(id, look) {
    this.refresh();
    const a = this.accounts[id];
    if (a && a.look !== look) { a.look = look; this.save(); }
  }

  // Their parts-based character recipe (shared/parts.js), or "" when they play a classic character.
  setRecipe(id, recipe) {
    this.refresh();
    const a = this.accounts[id];
    const next = typeof recipe === "string" ? recipe : "";
    if (a && (a.recipe ?? "") !== next) { a.recipe = next; this.save(); }
  }

  // Remember the accessories a player last wore, so they're pre-selected next time.
  setAccessories(id, list) {
    this.refresh();
    const a = this.accounts[id];
    if (!a) return;
    const next = Array.isArray(list) ? list : String(list || "").split(",").filter(Boolean);
    if ((a.accessories ?? []).join(",") !== next.join(",")) { a.accessories = next; this.save(); }
  }

  // Premium looks this player may use (granted by `npm run account -- unlock`, later by payments).
  unlock(username, lookId) {
    const a = this.findByName(username);
    if (!a) return false;
    if (!a.unlocks.includes(lookId)) { a.unlocks.push(lookId); this.save(); }
    return true;
  }
  lock(username, lookId) {
    const a = this.findByName(username);
    if (!a) return false;
    a.unlocks = a.unlocks.filter((l) => l !== lookId);
    this.save();
    return true;
  }

  // Grant an unlock by account id (the shop uses this after taking the credits).
  grant(id, unlockId) {
    this.refresh();
    const a = this.accounts[id];
    if (!a) return false;
    if (!a.unlocks.includes(unlockId)) { a.unlocks.push(unlockId); this.save(); }
    return true;
  }

  // ---------- Credits ----------
  // Accounts made before credits existed start with the welcome amount the first time we look.
  balance(a) { return Number.isInteger(a?.credits) ? a.credits : STARTING_CREDITS; }

  // Add (delta > 0) or take (delta < 0) credits. Never goes below zero. Every change is written to
  // the ledger with a reason ("quest:lostfound", "buy:wings", "pack:pack_small", "console", …).
  // Returns { balance } or { error }.
  changeCredits(id, delta, reason, extra = {}) {
    this.refresh();
    const a = this.accounts[id];
    if (!a) return { error: "No such player." };
    if (!Number.isSafeInteger(delta) || Math.abs(delta) > 10_000_000) return { error: "That's not a valid amount." };
    const have = this.balance(a);
    if (have + delta < 0) return { error: `That costs ${-delta} credits and you have ${have}.`, short: -delta - have };
    a.credits = have + delta;
    Object.assign(a, extra);
    this.save();
    this.ledger(a, delta, reason, a.credits);
    return { balance: a.credits };
  }

  ledger(a, delta, reason, balance) {
    try {
      mkdirSync(dirname(this.ledgerFile), { recursive: true });
      appendFileSync(this.ledgerFile, JSON.stringify({ at: new Date(this.now()).toISOString(), account: a.id, user: a.username, delta, balance, reason }) + "\n");
    } catch (err) { console.error(`Couldn't write the credits ledger: ${err.message}`); }
  }

  // The last few ledger lines for one account (for `npm run account -- credits <user>`).
  ledgerFor(id, limit = 20) {
    try {
      return readFileSync(this.ledgerFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((l) => l.account === id).slice(-limit);
    } catch { return []; }
  }

  // Camp items this player owns (the free ones are always included).
  campItems(a) { return [...new Set([...FREE_CAMP_ITEMS, ...(a?.campItems ?? [])])]; }
  addCampItem(id, itemId) {
    this.refresh();
    const a = this.accounts[id];
    if (!a) return false;
    a.campItems ??= [];
    if (!a.campItems.includes(itemId)) { a.campItems.push(itemId); this.save(); }
    return true;
  }

  // ---------- Moderation ----------
  // Staff ("mod") can mute, kick and ban from the player card in-game. Set with `npm run account -- make-mod`.
  // Roles: "mod" = festival staff (moderation). "admin" = organizer: moderation plus the festival builder.
  isStaff(a) { return a?.role === "mod" || a?.role === "admin"; }
  isAdmin(a) { return a?.role === "admin"; }
  setRole(username, role) {
    const a = this.findByName(username);
    if (!a) return false;
    a.role = role === "mod" || role === "admin" ? role : "";
    this.save();
    return true;
  }
  // kind: "mute" | "ban". minutes: 0 = forever, -1 = lift it.
  restrict(id, kind, minutes, reason = "") {
    this.refresh();
    const a = this.accounts[id];
    if (!a) return null;
    const until = minutes < 0 ? 0 : minutes === 0 ? FOREVER : this.now() + minutes * 60_000;
    if (kind === "ban") { a.bannedUntil = until; a.banReason = until ? String(reason).slice(0, 200) : ""; if (until) this.signOutEverywhere(id); }
    else a.mutedUntil = until;
    this.save();
    return until;
  }
  isMuted(a) { return !!a && (a.mutedUntil ?? 0) > this.now(); }
  isBanned(a) { return !!a && (a.bannedUntil ?? 0) > this.now(); }
  mutedMessage(a) { return this.isMuted(a) ? `Staff muted your chat ${untilText(a.mutedUntil, this.now())}.` : ""; }
  bannedMessage(a) {
    if (!this.isBanned(a)) return "";
    return `This account is banned ${untilText(a.bannedUntil, this.now())}.${a.banReason ? ` Reason: ${a.banReason}` : ""}`;
  }

  // What the player's own browser may see about their account. Never includes the password hash.
  public(a) {
    return {
      id: a.id, username: a.username, badges: [...a.badges], look: a.look, unlocks: [...a.unlocks], createdAt: a.createdAt,
      role: a.role ?? "", mutedUntil: this.isMuted(a) ? a.mutedUntil : 0,
      accessories: [...(a.accessories ?? [])],
      recipe: a.recipe ?? "",
      credits: this.balance(a), campItems: this.campItems(a),
    };
  }

  save() { writeJson(this.file, { accounts: this.accounts }); this.seen = this.mtimes(); }
  saveSessions() { writeJson(this.sessionsFile, { sessions: this.sessions }); this.seen = this.mtimes(); }
}

const DUMMY_SALT = randomBytes(16);
const DUMMY_HASH = randomBytes(KEY_LEN);

function readJson(file) {
  if (!existsSync(file)) return {};
  try { return JSON.parse(readFileSync(file, "utf8")); }
  catch (err) { console.error(`Couldn't read ${file}: ${err.message}`); return {}; }
}

function writeJson(file, data) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, file);
}

let shared = null;
export const accountStore = () => (shared ??= new AccountStore());
