import http from "node:http";
import { Server } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { FestivalRoom, serverStats, takeTickStats } from "./FestivalRoom.js";
import { createApi } from "./api.js";
import { serveStatic } from "./static.js";
import { vendorStore } from "./vendors.js";
import { accountStore } from "./accounts.js";
import { layoutStore } from "./layout.js";

const port = Number(process.env.PORT) || 2567;
const started = Date.now();

// Settings for hosting (all optional; see README "Hosting"):
//   PORT                 port to listen on (default 2567)
//   FV_DATA_DIR          where accounts, vendors and reports are saved (default ./data)
//   FV_TRUST_PROXY=1     behind an HTTPS proxy (Caddy, a load balancer): use the player's real IP for rate limits
//   FV_ROOM_SIZE         players per festival instance (default 100)
//   FV_SIGNUPS_PER_HOUR  new accounts per IP per hour (default 10; raise it for load tests)
//   FV_ADMIN_KEY         optional key that can edit any vendor stall

// One web server for everything: sign-in and the vendor API (/api/...), the game page (/client/...),
// and Colyseus's own matchmaking + WebSocket traffic (Colyseus hooks in its routes first).
let lastTicks = { avgTickMs: 0, maxTickMs: 0 };
const stats = () => ({
  players: serverStats.players, rooms: serverStats.rooms, ...lastTicks,
  memoryMB: Math.round(process.memoryUsage().rss / 1048576), uptimeMin: Math.round((Date.now() - started) / 60000),
});
const layout = layoutStore();   // load the saved festival layout before anything uses it
console.log(`Festival layout: ${layout.layout.items.length} things${layout.updatedAt ? `, last saved ${layout.updatedAt} by ${layout.updatedBy}` : " (the starting layout)"}`);
const api = createApi({ vendors: vendorStore(), accounts: accountStore(), layout }, {
  stats,
  trustProxy: process.env.FV_TRUST_PROXY === "1",
  signupsPerHour: Number(process.env.FV_SIGNUPS_PER_HOUR) || 10,
});
// Once a minute: how busy this server is. If avgTickMs creeps past ~25, this process is getting full.
setInterval(() => {
  lastTicks = takeTickStats();
  const s = stats();
  if (s.players) console.log(`[stats] ${s.players} players in ${s.rooms} room(s), tick ${s.avgTickMs} ms avg / ${s.maxTickMs} ms max (budget 50), ${s.memoryMB} MB`);
}, 60_000).unref();
const httpServer = http.createServer(async (req, res) => {
  if (await api(req, res)) return;
  if (await serveStatic(req, res)) return;
  res.writeHead(404).end("Not found");
});

const gameServer = new Server({ transport: new WebSocketTransport({ server: httpServer }) });

// joinOrCreate("festival") fills an existing room until maxClients, then opens a new one.
gameServer.define("festival", FestivalRoom);

gameServer.listen(port).then(() => {
  console.log(`FestiVille server listening on ws://localhost:${port}`);
  console.log(`Game page: http://localhost:${port}/   Festival builder: http://localhost:${port}/client/builder.html`);
});
