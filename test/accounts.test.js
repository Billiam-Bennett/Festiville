import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AccountStore, checkUsername, checkPassword } from "../server/accounts.js";
import { createApi } from "../server/api.js";
import { canUseLook, resolveLook } from "../server/entitlements.js";

function tempStore(opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), "fv-acct-"));
  return { store: new AccountStore({ dir, ...opts }), dir, done: () => rmSync(dir, { recursive: true, force: true }) };
}

test("username and password rules", () => {
  assert.equal(checkUsername("billy_3"), "");
  assert.match(checkUsername("ab"), /3–16/);
  assert.match(checkUsername("has space"), /3–16/);
  assert.match(checkUsername("x".repeat(17)), /3–16/);
  assert.match(checkUsername("Admin"), /reserved/);
  assert.equal(checkPassword("correct horse"), "");
  assert.match(checkPassword("short"), /8/);
  assert.match(checkPassword("billy12345", "Billy"), /username/);
});

test("sign up, sign in, and the password is never stored as-is", async () => {
  const { store, dir, done } = tempStore();
  try {
    const up = await store.signup("Billy", "festival-pass-1");
    assert.equal(up.account.username, "Billy");
    assert.ok(up.token.length > 30);
    assert.equal(store.accountForToken(up.token).username, "Billy");
    assert.ok(!readFileSync(join(dir, "accounts.json"), "utf8").includes("festival-pass-1"));
    assert.ok(!readFileSync(join(dir, "sessions.json"), "utf8").includes(up.token));
    assert.equal((await store.signup("billy", "another-pass-1")).status, 409);          // names are case-insensitive
    assert.equal((await store.login("BILLY", "festival-pass-1")).account.username, "Billy");
    assert.equal((await store.login("Billy", "wrong-pass-123")).status, 401);
    assert.equal((await store.login("nobody", "festival-pass-1")).status, 401);          // same answer as a wrong password
    assert.equal(up.account.password, undefined);                                         // hash never leaves the server
  } finally { done(); }
});

test("sessions: logout, expiry, and signing out everywhere on a password reset", async () => {
  let now = Date.parse("2026-09-30T00:00:00Z");
  const { store, done } = tempStore({ now: () => now });
  try {
    const { token } = await store.signup("Sky", "dance-all-night");
    const second = (await store.login("Sky", "dance-all-night")).token;
    store.logout(token);
    assert.equal(store.accountForToken(token), null);
    assert.ok(store.accountForToken(second));
    now += 31 * 86400_000;                                                               // 30-day sessions
    assert.equal(store.accountForToken(second), null);
    const third = (await store.login("Sky", "dance-all-night")).token;
    await store.setPassword("Sky", "brand-new-pass");
    assert.equal(store.accountForToken(third), null);
    assert.equal((await store.login("Sky", "dance-all-night")).status, 401);
    assert.ok((await store.login("Sky", "brand-new-pass")).token);
  } finally { done(); }
});

test("progress is saved: badges, last look, unlocks; and picked up by another copy of the store", async () => {
  const { store, dir, done } = tempStore();
  try {
    const { account } = await store.signup("Rook", "tacos-forever");
    store.setBadges(account.id, ["Finder", "Runner", "Finder"]);
    store.setLook(account.id, "kate");
    const other = new AccountStore({ dir });                                              // e.g. the `npm run account` command
    assert.deepEqual(other.get(account.id).badges, ["Finder", "Runner"]);
    assert.equal(other.get(account.id).look, "kate");
    other.unlock("rook", "bigvegas");
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(store.findByName("Rook").unlocks, ["bigvegas"]);                    // the running server notices
  } finally { done(); }
});

test("premium looks need an unlock; free looks don't", () => {
  const acct = { unlocks: ["bigvegas"] };
  assert.ok(canUseLook(null, "bryce"));
  assert.ok(!canUseLook(null, "bigvegas"));
  assert.ok(canUseLook(acct, "bigvegas"));
  assert.ok(!canUseLook(acct, "jackie"));
  assert.equal(resolveLook(acct, "jackie"), "michelle");
  assert.equal(resolveLook(acct, "nonsense"), "michelle");
});

// ---------- HTTP ----------
async function withApi(fn, opts) {
  const t = tempStore();
  const api = createApi({ accounts: t.store }, opts);
  const server = http.createServer(async (req, res) => { if (!(await api(req, res))) res.writeHead(404).end(); });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body, token) => {
    const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body && JSON.stringify(body) });
    return { status: r.status, body: r.status === 204 ? null : await r.json() };
  };
  try { await fn({ call, store: t.store }); } finally { server.close(); t.done(); }
}

test("API: sign up, check who I am, sign out, sign back in", async () => {
  await withApi(async ({ call }) => {
    const up = await call("POST", "/api/signup", { username: "Juniper", password: "lost-my-totem" });
    assert.equal(up.status, 201);
    assert.equal((await call("GET", "/api/me", null, up.body.token)).body.username, "Juniper");
    assert.equal((await call("GET", "/api/me")).status, 401);
    assert.equal((await call("POST", "/api/signup", { username: "juniper", password: "lost-my-totem" })).status, 409);
    assert.equal((await call("POST", "/api/signup", { username: "x", password: "lost-my-totem" })).status, 400);
    assert.equal((await call("POST", "/api/logout", {}, up.body.token)).status, 204);
    assert.equal((await call("GET", "/api/me", null, up.body.token)).status, 401);
    const back = await call("POST", "/api/login", { username: "Juniper", password: "lost-my-totem" });
    assert.equal(back.status, 200);
    assert.equal(back.body.account.password, undefined);
    assert.equal((await call("GET", "/api/login")).status, 405);
  });
});

test("API: repeated wrong passwords get locked out, even with the right one", async () => {
  await withApi(async ({ call }) => {
    await call("POST", "/api/signup", { username: "Dex", password: "soundcheck-1-2" });
    for (let i = 0; i < 3; i++) assert.equal((await call("POST", "/api/login", { username: "Dex", password: "guess" + i })).status, 401);
    assert.equal((await call("POST", "/api/login", { username: "Dex", password: "soundcheck-1-2" })).status, 429);
  }, { badLoginsPerMinute: 3 });
});

test("API: too many sign-ups from one place are slowed down", async () => {
  await withApi(async ({ call }) => {
    assert.equal((await call("POST", "/api/signup", { username: "one_1", password: "password-one" })).status, 201);
    assert.equal((await call("POST", "/api/signup", { username: "two_2", password: "password-two" })).status, 201);
    assert.equal((await call("POST", "/api/signup", { username: "three_3", password: "password-three" })).status, 429);
  }, { signupsPerHour: 2 });
});

test("behind an HTTPS proxy, rate limits use the player's IP only when told to trust the proxy", async () => {
  const { clientIp } = await import("../server/api.js");
  const req = { headers: { "x-forwarded-for": "6.6.6.6, 203.0.113.9" }, socket: { remoteAddress: "10.0.0.2" } };
  assert.equal(clientIp(req, false), "10.0.0.2");         // header ignored: anyone could fake it
  assert.equal(clientIp(req, true), "203.0.113.9");       // the address our own proxy added last
  assert.equal(clientIp({ headers: {}, socket: { remoteAddress: "10.0.0.2" } }, true), "10.0.0.2");
});
