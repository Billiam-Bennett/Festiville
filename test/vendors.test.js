import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sanitizeListing, upcoming, formatDates } from "../shared/listings.js";
import { VendorStore } from "../server/vendors.js";
import { createApi } from "../server/api.js";

const good = { name: "Hippie Dips", tagline: "GET WEIRD", link: "hippiedips.com", items: [{ name: "Smoothie", price: "8.50" }], next: [] };

// ---------- Listing rules ----------
test("a listing is cleaned up: trimmed, prices parsed, website fixed, blank rows dropped", () => {
  const { listing } = sanitizeListing({
    ...good, name: "  Hippie   Dips ", items: [{ name: "Smoothie", price: "$8.50" }, { name: "  ", price: 3 }, { name: "Water" }],
  });
  assert.equal(listing.name, "Hippie Dips");
  assert.equal(listing.link, "https://hippiedips.com/");
  assert.deepEqual(listing.items, [{ name: "Smoothie", price: 8.5 }, { name: "Water" }]);
});

test("bad listings are refused with a message a vendor can act on", () => {
  assert.match(sanitizeListing({ ...good, name: "" }).error, /name/);
  assert.match(sanitizeListing({ ...good, link: "javascript:alert(1)" }).error, /website/);
  assert.match(sanitizeListing({ ...good, items: [{ name: "Taco", price: "free" }] }).error, /price/);
  assert.match(sanitizeListing({ ...good, items: [{ name: "Taco", price: -1 }] }).error, /price/);
  assert.match(sanitizeListing({ ...good, next: [{ event: "Fest", start: "2026-10-18", end: "2026-10-16" }] }).error, /before/);
  assert.match(sanitizeListing({ ...good, next: [{ event: "Fest", start: "2026-02-30" }] }).error, /start date/);
  assert.match(sanitizeListing({ ...good, next: [{ where: "Ocala", start: "2026-10-16" }] }).error, /event name/);
  assert.match(sanitizeListing({ ...good, items: Array.from({ length: 31 }, (_, i) => ({ name: "x" + i })) }).error, /30/);
});

test("text is capped and control characters are stripped", () => {
  const { listing } = sanitizeListing({ ...good, name: "A".repeat(100), tagline: "hi\u0000<b>there</b>\nfriend" });
  assert.equal(listing.name.length, 32);
  assert.equal(listing.tagline, "hi <b>there</b> friend");   // HTML is kept as text; the game escapes it when shown
});

test("upcoming stops hide past ones and sort soonest first; dates format nicely", () => {
  const next = [
    { event: "B", start: "2026-11-06", end: "2026-11-08" },
    { event: "Past", start: "2026-09-01", end: "2026-09-03" },
    { event: "A", start: "2026-10-16", end: "2026-10-18" },
    { event: "Today", start: "2026-09-28", end: "2026-09-30" },
  ];
  assert.deepEqual(upcoming(next, "2026-09-30").map((s) => s.event), ["Today", "A", "B"]);
  const now = new Date(2026, 8, 30);
  assert.equal(formatDates("2026-10-16", "2026-10-18", now), "Oct 16–18");
  assert.equal(formatDates("2026-10-30", "2026-11-01", now), "Oct 30 – Nov 1");
  assert.equal(formatDates("2026-10-16", "", now), "Oct 16");
  assert.equal(formatDates("2027-01-02", "2027-01-04", now), "Jan 2–4, 2027");
});

// ---------- Store ----------
function tempStore(opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), "fv-vendors-"));
  return { store: new VendorStore({ dir, ...opts }), dir, done: () => rmSync(dir, { recursive: true, force: true }) };
}

test("store falls back to the starting listing, saves edits to disk, and reloads them", () => {
  const { store, dir, done } = tempStore();
  try {
    assert.equal(store.get("hippiedips").name, "Hippie Dips");
    assert.equal(store.get("hippiedips").updatedAt, null);
    assert.equal(store.get("nope"), null);
    const seen = [];
    store.onChange((l) => seen.push(l.name));
    const { listing } = store.update("hippiedips", { ...good, name: "Hippie Dips!" });
    assert.equal(listing.name, "Hippie Dips!");
    assert.equal(listing.color, "#ff5fa2");                          // layout facts still come from venue.js
    assert.deepEqual(seen, ["Hippie Dips!"]);
    assert.equal(new VendorStore({ dir }).get("hippiedips").name, "Hippie Dips!");   // survives a restart
    assert.equal(store.update("nope", good).status, 404);
    assert.equal(store.update("hippiedips", { ...good, name: "" }).status, 400);
  } finally { done(); }
});

test("edit keys: only the right key for the right stall works; new keys replace old ones; keys aren't stored", () => {
  const { store, dir, done } = tempStore();
  try {
    const k1 = store.issueKey("hippiedips");
    assert.ok(store.canEdit("hippiedips", k1));
    assert.ok(!store.canEdit("rae", k1));                               // one stall's key can't edit another
    assert.ok(!store.canEdit("hippiedips", k1 + "x"));
    assert.ok(!store.canEdit("hippiedips", ""));
    assert.ok(!readFileSync(join(dir, "vendor-keys.json"), "utf8").includes(k1));   // only a hash on disk
    const k2 = store.issueKey("hippiedips");
    assert.ok(!store.canEdit("hippiedips", k1) && store.canEdit("hippiedips", k2));
    store.revokeKey("hippiedips");
    assert.ok(!store.canEdit("hippiedips", k2));
  } finally { done(); }
});

test("the admin key can edit any stall, but only if it's long enough", () => {
  const strong = tempStore({ adminKey: "festival-admin-key-123" });
  const weak = tempStore({ adminKey: "short" });
  try {
    assert.ok(strong.store.canEdit("rae", "festival-admin-key-123"));
    assert.ok(!weak.store.canEdit("rae", "short"));
  } finally { strong.done(); weak.done(); }
});

// ---------- HTTP API ----------
async function withApi(fn, opts) {
  const t = tempStore();
  const api = createApi({ vendors: t.store }, opts);
  const server = http.createServer(async (req, res) => { if (!(await api(req, res))) res.writeHead(404).end(); });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body, key) => {
    const r = await fetch(base + path, {
      method, headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
    return { status: r.status, body: r.status === 204 ? null : await r.json(), headers: r.headers };
  };
  try { await fn({ call, store: t.store }); } finally { server.close(); t.done(); }
}

test("API: anyone can read listings; saving needs the stall's key", async () => {
  await withApi(async ({ call, store }) => {
    const all = await call("GET", "/api/vendors");
    assert.equal(all.status, 200);
    assert.equal(all.body.vendors.length, 20);
    assert.equal(all.headers.get("access-control-allow-origin"), "*");
    assert.equal((await call("GET", "/api/vendors/rae")).body.name, "Mama Rae's Tacos");
    assert.equal((await call("GET", "/api/vendors/nope")).status, 404);

    assert.equal((await call("PUT", "/api/vendors/hippiedips", good)).status, 401);
    assert.equal((await call("PUT", "/api/vendors/hippiedips", good, "wrong-key-wrong-key")).status, 401);
    const key = store.issueKey("hippiedips");
    assert.equal((await call("GET", "/api/vendors/hippiedips", undefined, key)).body.canEdit, true);
    assert.equal((await call("GET", "/api/vendors/hippiedips", undefined, "nope-nope-nope-nope")).body.canEdit, false);
    assert.equal((await call("GET", "/api/vendors/hippiedips")).body.canEdit, undefined);
    const saved = await call("PUT", "/api/vendors/hippiedips", { ...good, tagline: "Fresh!" }, key);
    assert.equal(saved.status, 200);
    assert.equal(saved.body.tagline, "Fresh!");
    assert.equal((await call("GET", "/api/vendors/hippiedips")).body.tagline, "Fresh!");
    assert.equal((await call("PUT", "/api/vendors/rae", good, key)).status, 401);   // wrong stall
    assert.equal((await call("PUT", "/api/vendors/hippiedips", "{not json", key)).status, 400);
    assert.equal((await call("PUT", "/api/vendors/hippiedips", { ...good, name: "" }, key)).status, 400);
    assert.equal((await call("PUT", "/api/vendors/hippiedips", { ...good, tagline: "x".repeat(40000) }, key)).status, 413);
    assert.equal((await call("OPTIONS", "/api/vendors/hippiedips")).status, 204);
    assert.equal((await call("DELETE", "/api/vendors/hippiedips", undefined, key)).status, 405);
  });
});

test("API: guessing keys gets locked out for a minute", async () => {
  await withApi(async ({ call, store }) => {
    const key = store.issueKey("rae");
    for (let i = 0; i < 3; i++) assert.equal((await call("PUT", "/api/vendors/rae", good, "guess-guess-guess" + i)).status, 401);
    assert.equal((await call("PUT", "/api/vendors/rae", good, key)).status, 429);   // even the right key waits
  }, { badKeysPerMinute: 3 });
});
