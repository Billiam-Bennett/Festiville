// Moderation: player reports and a log of what staff did about them.
//
// Saved in data/moderation.json (FV_DATA_DIR to move it):
//   reports  what players reported, with the reported player's last few chat lines as evidence
//            (taken from the server's own copy, so nobody can fake them)
//   log      every staff action (mute, kick, ban...), who did it and why
//
// Who counts as staff, and who is muted or banned, lives on the account (server/accounts.js).
// Staff act in-game from the player card, or from the command line (`npm run account -- ...`).
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

const DEFAULT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "data");

export const REASONS = {
  harassment: "Harassment or bullying",
  hate: "Hate speech",
  sexual: "Sexual content",
  spam: "Spam or scams",
  cheating: "Cheating",
  other: "Something else",
};

// What staff can do from the player card. minutes: 0 = no time limit.
export const ACTIONS = {
  mute15: { kind: "mute", minutes: 15, label: "Mute 15 min" },
  mute24h: { kind: "mute", minutes: 24 * 60, label: "Mute 1 day" },
  kick: { kind: "kick", label: "Kick" },
  ban1d: { kind: "ban", minutes: 24 * 60, label: "Ban 1 day" },
  ban7d: { kind: "ban", minutes: 7 * 24 * 60, label: "Ban 7 days" },
  banForever: { kind: "ban", minutes: 0, label: "Ban forever" },
};

export const FOREVER = Date.parse("9999-12-31T00:00:00Z");
export const REPORT_LIMITS = { perWindow: 5, windowMs: 10 * 60_000, noteMax: 200, evidenceLines: 10 };

// "for 15 more minutes", "for 3 more hours", "for 2 more days", or "permanently", for messages to
// players. (Durations, not clock times: the server's time zone isn't the player's.)
export function untilText(ms, now = Date.now()) {
  if (ms >= FOREVER) return "permanently";
  const min = Math.max(1, Math.ceil((ms - now) / 60_000));
  if (min < 90) return `for ${min} more minute${min === 1 ? "" : "s"}`;
  const h = Math.round(min / 60);
  if (h < 36) return `for ${h} more hours`;
  return `for ${Math.round(h / 24)} more days`;
}

export class ModerationStore {
  constructor({ dir = process.env.FV_DATA_DIR || DEFAULT_DIR, now = () => Date.now() } = {}) {
    this.file = join(dir, "moderation.json");
    this.now = now;
    this.load();
  }
  load() {
    let data = {};
    if (existsSync(this.file)) {
      try { data = JSON.parse(readFileSync(this.file, "utf8")); }
      catch (err) { console.error(`Couldn't read ${this.file}: ${err.message}`); }
    }
    this.reports = data.reports ?? [];
    this.log = data.log ?? [];
    this.seen = this.mtime();
  }
  mtime() { try { return statSync(this.file).mtimeMs; } catch { return 0; } }
  refresh() { if (this.mtime() !== this.seen) this.load(); }
  save() {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ reports: this.reports, log: this.log }, null, 2));
    renameSync(tmp, this.file);
    this.seen = this.mtime();
  }

  // reporter / target: { id (account id), name }. chat: the target's recent lines [{ text, channel, at }].
  // Returns { ok, id, duplicate? } or { error }.
  report({ reporter, target, reason, note = "", chat = [] }) {
    this.refresh();
    if (!reporter?.id || !target?.id) return { error: "That player isn't here anymore." };
    if (reporter.id === target.id) return { error: "You can't report yourself." };
    if (!REASONS[reason]) return { error: "Pick a reason." };
    const now = this.now();
    const recent = this.reports.filter((r) => r.reporter.id === reporter.id && now - Date.parse(r.at) < REPORT_LIMITS.windowMs);
    const dup = recent.find((r) => r.target.id === target.id && r.status === "open");
    if (dup) return { ok: true, id: dup.id, duplicate: true };
    if (recent.length >= REPORT_LIMITS.perWindow) return { error: "You've sent a lot of reports. Staff will look at them; try again in a few minutes." };
    const r = {
      id: "r_" + randomBytes(5).toString("hex"),
      at: new Date(now).toISOString(),
      reporter: { id: reporter.id, name: reporter.name },
      target: { id: target.id, name: target.name },
      reason,
      note: cleanNote(note),
      chat: chat.slice(-REPORT_LIMITS.evidenceLines).map((l) => ({ text: String(l.text).slice(0, 200), channel: l.channel, at: l.at })),
      status: "open",
    };
    this.reports.push(r);
    this.save();
    return { ok: true, id: r.id };
  }

  open() { this.refresh(); return this.reports.filter((r) => r.status === "open"); }

  // The staff Reports screen: open reports grouped by the reported player, newest activity first.
  // Each group carries every open report about them, their recent chat (merged from all the reports,
  // oldest first), how many earlier reports were already handled, and the last few staff actions.
  queue({ maxGroups = 50 } = {}) {
    this.refresh();
    const groups = new Map();
    for (const r of this.reports) {
      let g = groups.get(r.target.id);
      if (!g) groups.set(r.target.id, (g = { target: { ...r.target }, reports: [], earlierReports: 0, lastAt: "" }));
      if (r.status !== "open") { g.earlierReports++; continue; }
      g.target.name = r.target.name;   // newest name wins
      g.reports.push({ id: r.id, at: r.at, reporter: r.reporter.name, reason: r.reason, note: r.note });
      if (r.at > g.lastAt) g.lastAt = r.at;
    }
    const out = [];
    for (const g of groups.values()) {
      if (!g.reports.length) continue;
      const open = this.reports.filter((r) => r.status === "open" && r.target.id === g.target.id);
      const seen = new Set(), chat = [];
      for (const r of open) for (const l of r.chat ?? []) {
        const key = `${l.at}|${l.text}`;
        if (!seen.has(key)) { seen.add(key); chat.push(l); }
      }
      chat.sort((a, b) => String(a.at).localeCompare(String(b.at)));
      const pastActions = this.log.filter((l) => l.target.id === g.target.id && l.action !== "dismiss")
        .slice(-5).map((l) => ({ at: l.at, by: l.by, action: l.action, minutes: l.minutes, reason: l.reason }));
      g.reports.sort((a, b) => b.at.localeCompare(a.at));
      out.push({ ...g, chat: chat.slice(-20), pastActions });
    }
    out.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
    return out.slice(0, maxGroups);
  }

  // "Nothing to do here": close every open report about this player, and log who decided that.
  // Returns how many reports were closed.
  dismiss(targetId, by = "console", note = "") {
    this.refresh();
    const at = new Date(this.now()).toISOString();
    let n = 0, target = null;
    for (const r of this.reports) {
      if (r.status !== "open" || r.target.id !== targetId) continue;
      Object.assign(r, { status: "closed", closedBy: by, closedAt: at, outcome: "dismissed" });
      target = r.target; n++;
    }
    if (!n) return 0;
    this.log.push({ at, by, target: { id: target.id, name: target.name }, action: "dismiss", minutes: 0, reason: cleanNote(note) });
    if (this.log.length > 5000) this.log = this.log.slice(-5000);
    this.save();
    return n;
  }
  forTarget(accountId) { this.refresh(); return this.reports.filter((r) => r.target.id === accountId); }

  close(id, by = "console", outcome = "") {
    this.refresh();
    const r = this.reports.find((x) => x.id === id);
    if (!r) return false;
    r.status = "closed";
    r.closedBy = by;
    r.closedAt = new Date(this.now()).toISOString();
    if (outcome) r.outcome = outcome;
    this.save();
    return true;
  }

  // Record a staff action. Closes open reports about that player when it's a mute/kick/ban.
  record({ by, target, action, minutes = 0, reason = "" }) {
    this.refresh();
    const at = new Date(this.now()).toISOString();
    this.log.push({ at, by, target: { id: target.id, name: target.name }, action, minutes, reason: cleanNote(reason) });
    if (["mute", "kick", "ban"].includes(action)) {
      for (const r of this.reports) if (r.status === "open" && r.target.id === target.id) Object.assign(r, { status: "closed", closedBy: by, closedAt: at, outcome: action });
    }
    if (this.log.length > 5000) this.log = this.log.slice(-5000);
    this.save();
  }
}

const cleanNote = (v) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, REPORT_LIMITS.noteMax) : "");

let shared = null;
export const moderationStore = () => (shared ??= new ModerationStore());
