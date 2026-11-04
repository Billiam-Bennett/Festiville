import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { ModerationStore, REPORT_LIMITS, untilText, FOREVER } from "../server/moderation.js";
import { AccountStore } from "../server/accounts.js";

const temp = () => { const dir = mkdtempSync(join(tmpdir(), "fv-mod-")); return { dir, done: () => rmSync(dir, { recursive: true, force: true }) }; };
const A = { id: "a_1", name: "Billy" }, B = { id: "a_2", name: "Troll" }, C = { id: "a_3", name: "Sky" };

test("reports: need a reason, keep the reported player's chat, no self-reports, no duplicates", () => {
  const { dir, done } = temp();
  try {
    const m = new ModerationStore({ dir });
    assert.match(m.report({ reporter: A, target: B, reason: "nope" }).error, /reason/);
    assert.match(m.report({ reporter: A, target: A, reason: "spam" }).error, /yourself/);
    const chat = Array.from({ length: 15 }, (_, i) => ({ text: "line " + i, channel: "near", at: new Date().toISOString() }));
    const r = m.report({ reporter: A, target: B, reason: "harassment", note: "  kept\nfollowing me  ", chat });
    assert.ok(r.ok && !r.duplicate);
    const saved = new ModerationStore({ dir }).open()[0];
    assert.equal(saved.note, "kept following me");
    assert.equal(saved.chat.length, REPORT_LIMITS.evidenceLines);
    assert.equal(saved.chat.at(-1).text, "line 14");
    assert.ok(m.report({ reporter: A, target: B, reason: "spam" }).duplicate);
    assert.equal(m.open().length, 1);
  } finally { done(); }
});

test("reports: one player can't flood staff", () => {
  const { dir, done } = temp();
  try {
    const m = new ModerationStore({ dir });
    for (let i = 0; i < REPORT_LIMITS.perWindow; i++) assert.ok(m.report({ reporter: A, target: { id: "t" + i, name: "T" + i }, reason: "spam" }).ok);
    assert.match(m.report({ reporter: A, target: C, reason: "spam" }).error, /lot of reports/);
    assert.ok(m.report({ reporter: C, target: A, reason: "spam" }).ok);   // others still can
  } finally { done(); }
});

test("a staff action closes open reports about that player and is logged", () => {
  const { dir, done } = temp();
  try {
    const m = new ModerationStore({ dir });
    m.report({ reporter: A, target: B, reason: "hate" });
    m.report({ reporter: C, target: B, reason: "hate" });
    m.record({ by: "Sky", target: B, action: "ban", minutes: 1440, reason: "slurs" });
    assert.equal(m.open().length, 0);
    assert.equal(m.forTarget("a_2")[0].outcome, "ban");
    assert.equal(m.log[0].reason, "slurs");
  } finally { done(); }
});

test("mutes and bans on accounts: expire, block sign-in, sign out everywhere", async () => {
  let now = Date.parse("2026-09-30T12:00:00Z");
  const { dir, done } = temp();
  try {
    const s = new AccountStore({ dir, now: () => now });
    const { account, token } = await s.signup("Troll", "under-a-bridge");
    s.restrict(account.id, "mute", 15);
    assert.ok(s.isMuted(s.get(account.id)));
    assert.match(s.mutedMessage(s.get(account.id)), /15 more minutes/);
    now += 16 * 60_000;
    assert.ok(!s.isMuted(s.get(account.id)));

    s.restrict(account.id, "ban", 24 * 60, "spamming");
    assert.equal(s.accountForToken(token), null);                     // kicked out of every sign-in
    const bad = await s.login("Troll", "under-a-bridge");
    assert.equal(bad.status, 403);
    assert.match(bad.error, /banned for 24 more hours\. Reason: spamming/);
    assert.equal((await s.login("Troll", "wrong-password")).status, 401);   // a wrong password doesn't reveal the ban
    now += 25 * 3600_000;
    assert.ok((await s.login("Troll", "under-a-bridge")).token);

    s.restrict(account.id, "ban", 0);
    assert.match(s.bannedMessage(s.get(account.id)), /permanently/);
    s.restrict(account.id, "ban", -1);
    assert.ok(!s.isBanned(s.get(account.id)));
  } finally { done(); }
});

test("staff role", async () => {
  const { dir, done } = temp();
  try {
    const s = new AccountStore({ dir });
    const { account } = await s.signup("Sky", "dance-all-night");
    assert.ok(!s.isStaff(s.get(account.id)));
    s.setRole("sky", "mod");
    assert.ok(s.isStaff(s.get(account.id)));
    assert.equal(s.public(s.get(account.id)).role, "mod");
    s.setRole("sky", "");
    assert.ok(!s.isStaff(s.get(account.id)));
  } finally { done(); }
});

test("untilText talks in durations", () => {
  const now = 0;
  assert.equal(untilText(15 * 60_000, now), "for 15 more minutes");
  assert.equal(untilText(3 * 3600_000, now), "for 3 more hours");
  assert.equal(untilText(7 * 86400_000, now), "for 7 more days");
  assert.equal(untilText(FOREVER, now), "permanently");
});

test("command line: make-mod, ban, reports, unban", async () => {
  const { dir, done } = temp();
  try {
    const s = new AccountStore({ dir });
    await s.signup("Sky", "dance-all-night");
    await s.signup("Troll", "under-a-bridge");
    new ModerationStore({ dir }).report({ reporter: { id: s.findByName("sky").id, name: "Sky" }, target: { id: s.findByName("troll").id, name: "Troll" }, reason: "spam", chat: [{ text: "buy gold", channel: "near", at: new Date().toISOString() }] });
    const run = (...args) => execFileSync(process.execPath, ["scripts/account.mjs", ...args], { env: { ...process.env, FV_DATA_DIR: dir }, encoding: "utf8" });
    assert.match(run("make-mod", "Sky"), /now festival staff/);
    assert.match(run("reports"), /Sky reported Troll: Spam or scams[\s\S]*buy gold/);
    assert.match(run("ban", "Troll", "3", "spam", "links"), /Banned Troll for 3 more days/);
    assert.match(run("list"), /Troll.*BANNED[\s\S]*|Sky.*STAFF/);
    assert.match(run("reports"), /0 open reports/);
    assert.match(run("history", "Troll"), /console: ban \(4320 min\) — spam links/);
    assert.match(run("unban", "Troll"), /Unbanned/);
    const fresh = new AccountStore({ dir });
    assert.ok(!fresh.isBanned(fresh.findByName("troll")));
    assert.ok(fresh.isStaff(fresh.findByName("sky")));
  } finally { done(); }
});

test("reports screen: open reports grouped by player, newest first, with chat and history", () => {
  let now = Date.parse("2026-10-29T12:00:00Z");
  const { dir, done } = temp();
  try {
    const m = new ModerationStore({ dir, now: () => now });
    const line = (text, min) => ({ text, channel: "near", at: new Date(Date.parse("2026-10-29T11:00:00Z") + min * 60_000).toISOString() });
    m.report({ reporter: A, target: B, reason: "harassment", note: "rude", chat: [line("hey", 1), line("go away", 2)] });
    now += 60_000;
    m.report({ reporter: C, target: B, reason: "hate", chat: [line("go away", 2), line("worse", 3)] });   // overlapping evidence
    now += 60_000;
    m.report({ reporter: B, target: C, reason: "spam" });
    const q = m.queue();
    assert.equal(q.length, 2);
    assert.equal(q[0].target.id, "a_3");                 // most recent activity first
    const troll = q[1];
    assert.equal(troll.reports.length, 2);
    assert.equal(troll.reports[0].reporter, "Sky");       // newest report first within a player
    assert.deepEqual(troll.chat.map((l) => l.text), ["hey", "go away", "worse"]);   // merged, no repeats, in order
    assert.equal(troll.earlierReports, 0);
  } finally { done(); }
});

test("reports screen: dismiss closes that player's reports, is logged, and isn't counted as a staff action", () => {
  const { dir, done } = temp();
  try {
    const m = new ModerationStore({ dir });
    m.report({ reporter: A, target: B, reason: "other" });
    m.report({ reporter: C, target: B, reason: "other" });
    m.report({ reporter: A, target: C, reason: "spam" });
    assert.equal(m.dismiss("a_2", "Sky", "just joking around"), 2);
    assert.equal(m.dismiss("a_2", "Sky"), 0);                  // nothing left to dismiss
    assert.equal(m.open().length, 1);
    assert.equal(m.forTarget("a_2")[0].outcome, "dismissed");
    assert.equal(m.log.at(-1).action, "dismiss");
    assert.equal(m.log.at(-1).reason, "just joking around");
    // A new report later: the old ones show as "earlier", and the dismissal isn't a past action.
    m.report({ reporter: { id: "a_9", name: "New" }, target: B, reason: "spam" });
    m.record({ by: "Sky", target: B, action: "mute", minutes: 15 });
    m.report({ reporter: { id: "a_8", name: "Newer" }, target: B, reason: "spam" });
    const g = m.queue().find((x) => x.target.id === "a_2");
    assert.equal(g.reports.length, 1);
    assert.equal(g.earlierReports, 3);
    assert.deepEqual(g.pastActions.map((a) => a.action), ["mute"]);
    // Survives a restart.
    assert.equal(new ModerationStore({ dir }).queue().find((x) => x.target.id === "a_2").earlierReports, 3);
  } finally { done(); }
});
