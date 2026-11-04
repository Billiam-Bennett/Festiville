// Small web API on the game server's port (2567), next to the WebSocket game traffic.
//
//   GET  /api/vendors          every stall's public listing
//   GET  /api/vendors/:id      one stall (send the edit key too and it also says whether it works: canEdit)
//   PUT  /api/vendors/:id      save a listing   (header  Authorization: Bearer <edit key>)
//   GET  /api/health           "ok", for uptime checks
//
//   POST /api/signup           { username, password } -> { token, account }
//   POST /api/login            { username, password } -> { token, account }
//   POST /api/logout           (Authorization: Bearer <token>) ends that sign-in
//   GET  /api/me               (Authorization: Bearer <token>) -> account
//
// CORS is open because the game page may be served from another port or domain. That's safe here:
// nothing uses cookies; everything private needs a token or key in the Authorization header.
import { defaultLayout } from "../shared/layout.js";
// Once hosted, serve this over HTTPS only, since passwords are sent to /api/login and /api/signup.
const MAX_BODY = 32 * 1024;
const WINDOW_MS = 60_000;

export function createApi({ vendors: store, accounts, layout }, opts = {}) {
  const {
    editsPerMinute = 30, badKeysPerMinute = 10, badLoginsPerMinute = 10, badLoginsPerName = 10, signupsPerHour = 10,
  } = opts;
  const edits = new RateLimiter(editsPerMinute, WINDOW_MS);
  const badKeys = new RateLimiter(badKeysPerMinute, WINDOW_MS);
  const badLogins = new RateLimiter(badLoginsPerMinute, WINDOW_MS);          // per IP
  const badNames = new RateLimiter(badLoginsPerName, 10 * WINDOW_MS);        // per username, from anywhere
  const signups = new RateLimiter(signupsPerHour, 60 * WINDOW_MS);
  const bearer = (req) => (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");

  // Returns true if it handled the request, false to let something else (e.g. a 404) take it.
  return async function handle(req, res) {
    const url = new URL(req.url, "http://x");
    if (!url.pathname.startsWith("/api/")) return false;
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, PUT, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Access-Control-Max-Age", "600");
    if (req.method === "OPTIONS") { res.writeHead(204).end(); return true; }

    const ip = clientIp(req, opts.trustProxy);
    const parts = url.pathname.split("/").filter(Boolean);   // ["api", "vendors", id?]
    try {
      if (parts[1] === "health" && parts.length === 2) return send(res, 200, { ok: true, ...(opts.stats?.() ?? {}) });

      // ---------- Festival layout (the builder) ----------
      //   GET /api/layout           the current layout, for the game and the builder
      //   GET /api/layout/default   the starting layout, for "start over" in the builder
      //   PUT /api/layout           { layout } — organizers only (accounts with the admin role)
      if (layout && parts[1] === "layout" && parts.length <= 3) {
        if (parts[2] === "default" && req.method === "GET") return send(res, 200, { layout: defaultLayout() });
        if (parts[2]) return send(res, 404, { error: "Not found" });
        if (req.method === "GET") return send(res, 200, layout.current());
        if (req.method !== "PUT") return send(res, 405, { error: "Method not allowed" });
        const who = accounts?.accountForToken(bearer(req));
        if (!who) return send(res, 401, { error: "Please sign in again." });
        if (!accounts.isAdmin(who)) return send(res, 403, { error: "Only festival organizers can change the layout. Ask the owner to run: npm run account -- make-admin " + who.username });
        if (!edits.take(ip)) return send(res, 429, { error: "Saving too fast. Wait a minute and try again." });
        const body = await readJson(req, 512 * 1024);
        if (body === TOO_BIG) return send(res, 413, { error: "That layout is too big to save." });
        if (body === BAD_JSON || !body || typeof body !== "object") return send(res, 400, { error: "Couldn't read that. Try again." });
        const out = layout.save(body.layout, who.username);
        if (out.error) return send(res, 400, { error: out.error });
        console.log(`[builder] ${who.username} saved the festival layout (${out.layout.items.length} things)`);
        return send(res, 200, out);
      }

      // ---------- Accounts ----------
      if (accounts && parts.length === 2 && ["signup", "login", "logout", "me"].includes(parts[1])) {
        const route = parts[1];
        if (route === "me") {
          if (req.method !== "GET") return send(res, 405, { error: "Method not allowed" });
          const a = accounts.accountForToken(bearer(req));
          return a ? send(res, 200, accounts.public(a)) : send(res, 401, { error: "Please sign in again." });
        }
        if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
        if (route === "logout") { accounts.logout(bearer(req)); res.writeHead(204).end(); return true; }

        const body = await readJson(req);
        if (body === TOO_BIG || body === BAD_JSON || !body || typeof body !== "object") return send(res, 400, { error: "Couldn't read that. Try again." });
        const username = typeof body.username === "string" ? body.username.trim() : "";
        const password = typeof body.password === "string" ? body.password : "";

        if (route === "signup") {
          if (signups.blocked(ip)) return send(res, 429, { error: "Too many new accounts from here. Try again later." });
          const out = await accounts.signup(username, password);
          if (out.error) return send(res, out.status, { error: out.error });
          signups.hit(ip);
          return send(res, 201, { token: out.token, account: out.account });
        }
        // login
        const nameKey = username.toLowerCase();
        if (badLogins.blocked(ip) || badNames.blocked(nameKey)) return send(res, 429, { error: "Too many wrong tries. Wait a few minutes and try again." });
        const out = await accounts.login(username, password);
        if (out.error) { badLogins.hit(ip); badNames.hit(nameKey); return send(res, out.status, { error: out.error }); }
        return send(res, 200, { token: out.token, account: out.account });
      }

      if (!store || parts[1] !== "vendors" || parts.length > 3) return send(res, 404, { error: "Not found" });
      const id = parts[2] ? decodeURIComponent(parts[2]) : null;

      if (req.method === "GET") {
        if (!id) return send(res, 200, { vendors: store.all() });
        const v = store.get(id);
        if (!v) return send(res, 404, { error: "No stall with that id." });
        // The edit page sends its key when it loads, so a bad link is caught before any typing.
        if (req.headers.authorization) {
          if (badKeys.blocked(ip)) return send(res, 429, { error: "Too many tries. Wait a minute and try again." });
          const canEdit = store.canEdit(id, req.headers.authorization.replace(/^Bearer\s+/i, ""));
          if (!canEdit) badKeys.hit(ip);
          return send(res, 200, { ...v, canEdit });
        }
        return send(res, 200, v);
      }

      if (req.method === "PUT" && id) {
        if (!store.has(id)) return send(res, 404, { error: "No stall with that id." });
        if (badKeys.blocked(ip)) return send(res, 429, { error: "Too many tries. Wait a minute and try again." });
        const key = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
        if (!store.canEdit(id, key)) {
          badKeys.hit(ip);
          return send(res, 401, { error: "This edit link isn't valid. Ask the festival for a new one." });
        }
        if (!edits.take(ip)) return send(res, 429, { error: "Saving too fast. Wait a minute and try again." });
        const body = await readJson(req);
        if (body === TOO_BIG) return send(res, 413, { error: "That's too much to save at once." });
        if (body === BAD_JSON) return send(res, 400, { error: "Couldn't read that. Try again." });
        const { listing, error, status } = store.update(id, body);
        return error ? send(res, status, { error }) : send(res, 200, listing);
      }

      return send(res, 405, { error: "Method not allowed" });
    } catch (err) {
      console.error("API error:", err);
      return send(res, 500, { error: "Something went wrong on the server." });
    }
  };
}

// The player's IP address, for rate limits. Behind an HTTPS proxy (Caddy, a load balancer) every request
// comes from the proxy, so with trustProxy on we use the address the proxy passes along instead.
// Only turn it on when the proxy is the ONLY way in; otherwise anyone could fake the header.
export function clientIp(req, trustProxy) {
  if (trustProxy) {
    const fwd = String(req.headers["x-forwarded-for"] ?? "").split(",").pop().trim();
    if (fwd) return fwd;
  }
  return req.socket.remoteAddress ?? "?";
}

function send(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
  return true;
}

const TOO_BIG = Symbol("too big"), BAD_JSON = Symbol("bad json");
function readJson(req, max = MAX_BODY) {
  return new Promise((resolve) => {
    let size = 0; const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > Math.max(max * 2, 1024 * 1024)) { req.destroy(); resolve(TOO_BIG); return; }   // something's wrong: just hang up
      if (size <= max) chunks.push(c);                                       // otherwise read to the end so we can reply
    });
    req.on("end", () => {
      if (size > max) return resolve(TOO_BIG);
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch { resolve(BAD_JSON); }
    });
    req.on("error", () => resolve(BAD_JSON));
  });
}

// Counts events per IP in a sliding one-minute window.
class RateLimiter {
  constructor(max, windowMs) { this.max = max; this.windowMs = windowMs; this.log = new Map(); }
  recent(ip) {
    const now = Date.now();
    const list = (this.log.get(ip) ?? []).filter((t) => now - t < this.windowMs);
    this.log.set(ip, list);
    if (this.log.size > 5000) for (const [k, v] of this.log) if (!v.length) this.log.delete(k);   // keep memory bounded
    return list;
  }
  blocked(ip) { return this.recent(ip).length >= this.max; }
  hit(ip) { this.recent(ip).push(Date.now()); }
  take(ip) { const l = this.recent(ip); if (l.length >= this.max) return false; l.push(Date.now()); return true; }
}
