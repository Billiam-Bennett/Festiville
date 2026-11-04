// Load test: many fake players join, walk around and chat, and we measure how the server holds up.
//
//   npm run loadtest -- 200                       200 players against the server on this computer
//   npm run loadtest -- 500 wss://play.you.com    500 players against the hosted server, for 2 minutes
//   npm run loadtest -- 300 ws://localhost:2567 5  ...for 5 minutes
//
// Start the server with a higher sign-up limit first, since every fake player needs an account:
//   FV_SIGNUPS_PER_HOUR=100000 npm start          (Windows: set FV_SIGNUPS_PER_HOUR=100000 && npm start)
// Fake players are called lt_0001, lt_0002, ...; later runs sign back in with the same accounts.
//
// What it reports every 5 seconds:
//   players     connected fake players, and how many festival rooms they filled
//   response    time from pressing a key to the server confirming the move (p50 / p95). Under 150 ms feels fine.
//   updates/s   state updates each player receives per second (the server sends 20)
//   tick        from the server's /api/health: how long each 50 ms game tick takes (fine under ~25 ms)
//
// One computer can only simulate so many players: past ~300, run this from a second machine, or several.
import { Client } from "colyseus.js";

const count = Number(process.argv[2]) || 100;
const url = (process.argv[3] || "ws://localhost:2567").replace(/\/+$/, "");
const minutes = Number(process.argv[4]) || 2;
const api = url.replace(/^ws/, "http") + "/api";
const CONCURRENT_SIGNINS = 8;
const LINES = ["anyone at main stage?", "this set is fire", "where's the taco truck", "love the lights", "who wants to crew up", "grilled cheese line is short rn"];

const bots = [];
let failed = 0, signinErrors = new Map();
const latencies = [];      // ms, since the last report
let patches = 0;

async function signIn(i) {
  const username = `lt_${String(i).padStart(4, "0")}`;
  const password = `loadtest-password-${i * 7919}`;
  const post = (path) => fetch(`${api}/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
  let r = await post("login");
  if (r.status === 401) r = await post("signup");
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(r.status === 429 ? "429 rate-limited (start the server with FV_SIGNUPS_PER_HOUR=100000)" : `${r.status} ${body.error ?? ""}`);
  return body.token;
}

async function startBot(i) {
  const token = await signIn(i);
  const room = await new Client(url).joinOrCreate("festival", { token });
  const bot = { room, seq: 0, sent: new Map(), heading: Math.random() * Math.PI * 2, running: Math.random() < 0.3 };
  room.onStateChange(() => {
    patches++;
    const me = room.state.players?.get(room.sessionId);
    if (!me) return;
    for (const [seq, t] of bot.sent) {
      if (seq > me.lastSeq) break;
      if (seq === me.lastSeq) latencies.push(performance.now() - t);
      bot.sent.delete(seq);
    }
  });
  room.onLeave(() => { bot.gone = true; });
  // Walk around like a person: mostly forward, turning now and then, sometimes standing still.
  bot.walk = setInterval(() => {
    if (Math.random() < 0.02) bot.heading += (Math.random() - 0.5) * 2;
    const still = (Date.now() / 1000 + i) % 20 < 4;
    const seq = ++bot.seq;
    bot.sent.set(seq, performance.now());
    if (bot.sent.size > 200) bot.sent.delete(bot.sent.keys().next().value);
    room.send("input", still ? { x: 0, z: 0, run: false, seq } : { x: Math.cos(bot.heading), z: Math.sin(bot.heading), run: bot.running, seq });
  }, 50);
  bot.talk = setInterval(() => room.send("chat", { text: LINES[Math.floor(Math.random() * LINES.length)], channel: "near" }), 20000 + Math.random() * 20000);
  return bot;
}

const pct = (arr, p) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

console.log(`Load test: ${count} players → ${url} for ${minutes} min`);
const t0 = Date.now();
let next = 1;
await Promise.all(Array.from({ length: CONCURRENT_SIGNINS }, async () => {
  while (next <= count) {
    const i = next++;
    try { bots.push(await startBot(i)); }
    catch (err) { failed++; const k = String(err.message ?? err); signinErrors.set(k, (signinErrors.get(k) ?? 0) + 1); }
    if (i % 50 === 0) console.log(`  ${bots.length} joined, ${failed} failed…`);
  }
}));
console.log(`${bots.length} joined in ${((Date.now() - t0) / 1000).toFixed(0)} s${failed ? `, ${failed} failed:` : ""}`);
for (const [msg, n] of signinErrors) console.log(`  ${n}× ${msg}`);
if (!bots.length) process.exit(1);

const reports = [];
let last = Date.now();
const report = async () => {
  const secs = (Date.now() - last) / 1000; last = Date.now();
  const live = bots.filter((b) => !b.gone);
  const rooms = new Set(live.map((b) => b.room.roomId)).size;
  const p50 = pct(latencies, 0.5), p95 = pct(latencies, 0.95);
  const ups = live.length ? patches / live.length / secs : 0;
  latencies.length = 0; patches = 0;
  let health = {};
  try { health = await (await fetch(`${api}/health`)).json(); } catch {}
  const tick = health.avgTickMs !== undefined ? `tick ${health.avgTickMs} ms avg / ${health.maxTickMs} max (last minute), ${health.memoryMB} MB` : "";
  console.log(`players ${live.length} in ${rooms} room(s) | response ${p50.toFixed(0)} / ${p95.toFixed(0)} ms | updates/s ${ups.toFixed(1)} | ${tick}`);
  reports.push({ live: live.length, p95, ups, tick: health.avgTickMs ?? 0 });
};
const timer = setInterval(report, 5000);

setTimeout(async () => {
  clearInterval(timer);
  await report();
  const steady = reports.slice(Math.floor(reports.length / 3));   // skip warm-up
  const worstP95 = Math.max(...steady.map((r) => r.p95));
  const minUps = Math.min(...steady.map((r) => r.ups));
  const dropped = bots.filter((b) => b.gone).length;
  console.log("\n--- Result ---");
  console.log(`${bots.length} players joined, ${dropped} dropped during the test, ${failed} couldn't join.`);
  console.log(`Worst response (p95): ${worstP95.toFixed(0)} ms. Lowest update rate: ${minUps.toFixed(1)}/s (target 20).`);
  const ok = worstP95 < 150 && minUps > 15 && dropped === 0 && failed === 0;
  console.log(ok ? "✅ The server handled this many players comfortably."
    : failed ? "⚠️  Some players couldn't join; see the reasons listed after joining."
    : "⚠️  The server is struggling at this size (or this computer can't simulate this many; try from a second machine).");
  for (const b of bots) { clearInterval(b.walk); clearInterval(b.talk); try { b.room.leave(); } catch {} }
  setTimeout(() => process.exit(ok ? 0 : 1), 500);
}, minutes * 60_000);
