// How much CPU one game tick costs for N players, with no networking: the same work FestivalRoom.tick()
// does every 50 ms (movement with collision, the soft push between players, quests, the Ferris wheel),
// on the real festival layout. It answers "can ONE server process run one shared world this big?"
// for the game rules alone. What it can't measure is the networking (sending every player's moves to
// every other player); for that, run the real load test (npm run loadtest, see the README).
//
//   npm run tickbench                 100, 200, 500, 1000 and 2000 players, 30 simulated seconds each
//   npm run tickbench -- 500 60       just 500 players, for 60 simulated seconds
import { TICK_RATE, sanitizeInput, applyInput, separatePlayers, randomSpawn } from "../shared/sim.js";
import { defaultLayout } from "../shared/layout.js";
import { applyLayout, LAYOUT } from "../shared/venue.js";
import { QuestSystem } from "../server/quests.js";
import { RideSystem } from "../server/rides.js";
import { wheelOf, onWheel } from "../shared/rides.js";
import { GIVERS } from "../shared/quests-data.js";

applyLayout(defaultLayout());
const counts = process.argv[2] ? [Number(process.argv[2])] : [100, 200, 500, 1000, 2000];
const seconds = Number(process.argv[3]) || 30;
const dt = 1 / TICK_RATE;
const wheel = wheelOf(LAYOUT.items);

// Where people hang out: crowds at the stages and the Food Court, campers, people in between.
const HOTSPOTS = [[0, -95, 0.3], [150, -20, 0.12], [-150, -100, 0.08], [-150, 20, 0.06], [-45, 25, 0.14], [-90, 150, 0.1], [90, 150, 0.1], [45, 40, 0.1]];
function spawnAt(rng) {
  let r = rng(), acc = 0;
  for (const [x, z, w] of HOTSPOTS) { acc += w; if (r <= acc) return randomSpawn(14, { x, z }); }
  return randomSpawn();
}

function run(n) {
  let s = 12345;
  const rng = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const players = new Map(), bots = new Map();
  const quests = new QuestSystem({ rng }), rides = new RideSystem();
  for (let i = 0; i < n; i++) {
    const id = `p${i}`, at = spawnAt(rng);
    players.set(id, { x: at.x, z: at.z, rotY: 0, ride: "" });
    // Like the load test's bots: mostly walking, turning now and then, a third of them running, some standing.
    bots.set(id, { heading: rng() * Math.PI * 2, run: rng() < 0.3, phase: rng() * 20 });
    quests.join(id, id);
  }
  // A few crews out on quests, a few riders on the wheel.
  const juniper = GIVERS.find((g) => g.id === "juniper");
  for (let i = 0; i < Math.min(40, n / 10); i++) {
    const id = `p${i}`, p = players.get(id);
    p.x = juniper.x + 1; p.z = juniper.z;
    quests.startQuest(id, "juniper", new Map([[id, p]]), 0);
  }
  for (let i = 40; i < Math.min(40 + 48, n); i++) { const p = players.get(`p${i}`); p.x = wheel.x; p.z = wheel.z + 5; rides.board(`p${i}`, p, 0, wheel); p.ride = rides.rideOf(`p${i}`); }
  quests.drainEvents(); rides.drainEvents();

  const times = [];
  const ticks = seconds * TICK_RATE;
  let now = 0;
  for (let k = 0; k < ticks; k++) {
    now += dt;
    // The inputs that arrived this tick (not timed: on the real server they arrive between ticks).
    const inputs = new Map();
    for (const [id, b] of bots) {
      if (rng() < 0.02) b.heading += (rng() - 0.5) * 2;
      const still = (now + b.phase) % 20 < 4;
      inputs.set(id, sanitizeInput(still ? { x: 0, z: 0 } : { x: Math.cos(b.heading), z: Math.sin(b.heading), run: b.run }));
    }
    const t0 = performance.now();
    // ---- what FestivalRoom.tick() does ----
    for (const [id, p] of players) if (!onWheel(p.ride)) applyInput(p, inputs.get(id), dt);
    if (rides.wheel.size) for (const r of rides.tick(now, wheel)) { const p = players.get(r.id); if (r.x !== undefined) { p.x = r.x; p.z = r.z; } if (r.off) p.ride = ""; }
    separatePlayers(players.values(), dt);
    const positions = new Map();
    for (const [id, p] of players) positions.set(id, { x: p.x, z: p.z });
    quests.tick(positions, now, dt);
    quests.drainEvents(); rides.drainEvents();
    times.push(performance.now() - t0);
    // Walkers who hit the fence turn around, like a person would.
    for (const [id, p] of players) if (Math.abs(p.x) > 190 || Math.abs(p.z) > 190) bots.get(id).heading += Math.PI;
  }
  times.sort((a, b) => a - b);
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  return { n, avg, p95: times[Math.floor(times.length * 0.95)], max: times.at(-1) };
}

console.log(`Game tick cost, no networking: ${seconds} simulated seconds per run, ${TICK_RATE} ticks a second (a 50 ms budget per tick).`);
console.log("players   avg ms   p95 ms   max ms   share of the 50 ms budget (avg)");
for (const n of counts) {
  run(Math.min(n, 50));   // warm up the JIT
  const r = run(n);
  console.log(`${String(r.n).padStart(7)}   ${r.avg.toFixed(2).padStart(6)}   ${r.p95.toFixed(2).padStart(6)}   ${r.max.toFixed(2).padStart(6)}   ${((r.avg / 50) * 100).toFixed(1)}%`);
}
console.log("\nUnder ~25 ms a tick is fine. This is only the game rules; sending updates to players costs more (see the README: Scaling).");
