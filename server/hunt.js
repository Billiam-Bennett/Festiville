// The daily scavenger hunt: a few tokens hidden around the grounds, the same for every player each
// (UTC) day, so friends can hunt together. Walk over a token to pick it up; each pays a few credits and
// finding them all pays a bonus (shared/economy.js → HUNT). New tokens appear at midnight UTC.
//
// No networking in here: the game room (FestivalRoom.js) checks positions and calls collectToken();
// test/hunt.test.js tests the rules directly. Progress is saved on the account (account.hunt).
import { HUNT } from "../shared/economy.js";
import { FENCE, GATE, LAYOUT, VENDORS, inside } from "../shared/venue.js";
import { GIVERS, AMBIENT } from "../shared/quests-data.js";
import { blockingBoxes } from "../shared/camps.js";
import { seededRandom } from "../shared/parts.js";

const MIN_APART = 25;    // meters between tokens, so a hunt takes you around the grounds
const EDGE = 8;          // meters kept clear of the fence

export const huntDay = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);
// Seconds until the next hunt (midnight UTC).
export const secondsToNextHunt = (now = Date.now()) => Math.ceil((Date.parse(huntDay(now)) + 86400_000 - now) / 1000);

// Today's tokens: [{ i, x, z, hint }]. Deterministic for a day and a layout, so every room and every
// restart agrees. Tokens stay clear of stalls, stages, tents and trees, and are spread out.
export function huntSpots(day, items = LAYOUT.items, vendors = VENDORS) {
  const rnd = seededRandom(`hunt|${day}`);
  const blocks = blockingBoxes(items, 1.5);
  const spots = [];
  const lim = FENCE - EDGE;
  for (let tries = 0; spots.length < HUNT.tokens && tries < 4000; tries++) {
    const x = Math.round((rnd() * 2 - 1) * lim * 10) / 10, z = Math.round((rnd() * 2 - 1) * lim * 10) / 10;
    if (blocks.some((b) => x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1)) continue;
    if (spots.some((s) => Math.hypot(s.x - x, s.z - z) < MIN_APART)) continue;
    spots.push({ i: spots.length, x, z, hint: describePlace(x, z, items, vendors) });
  }
  return spots;
}

// A rough "where to look" for a spot: the named area it's in, else a direction from the nearest landmark
// (a character, stall, stage, sign, the gate or the path loop), else which side of the grounds.
// Never the exact spot; it's a hunt.
export function describePlace(x, z, items = LAYOUT.items, vendors = VENDORS, people = [...GIVERS, ...AMBIENT.filter((a) => !a.hidden)]) {
  const area = items.find((i) => i.type === "area" && i.label && inside(i, x, z));
  if (area) return `Somewhere around the ${area.label}`;
  const marks = [
    ...people.map((p) => ({ x: p.x, z: p.z, name: p.name, r: 16 })),
    ...items.filter((i) => i.type === "stage" && i.label).map((i) => ({ x: i.x, z: i.z, name: `the ${i.label}`, r: 34 })),
    ...vendors.map((v) => ({ x: v.x, z: v.z, name: v.name, r: 18 })),
    ...items.filter((i) => i.type === "arch" && i.text).map((i) => ({ x: i.x, z: i.z, name: `the ${titleCase(i.text)} sign`, r: 18 })),
    { x: GATE.x, z: GATE.z, name: "the main gate", r: 22 },
  ].map((m) => ({ ...m, d: Math.hypot(m.x - x, m.z - z) })).filter((m) => m.d < m.r).sort((p, q) => p.d / p.r - q.d / q.r);
  if (marks.length) {
    const m = marks[0];
    return m.d < 5 ? `Right by ${m.name}` : `${m.d < 12 ? "A little" : "A short walk"} ${compass(x - m.x, z - m.z)} of ${m.name}`;
  }
  const side = compass(x, z);
  const ring = items.find((i) => i.type === "pathring" && Math.abs(Math.hypot(x - i.x, z - i.z) - i.r) < 5);
  if (ring) return `On the path loop, ${side} side`;
  if (Math.max(Math.abs(x), Math.abs(z)) > FENCE - 22) return `Out by the fence, ${side} side`;
  return Math.hypot(x, z) < 31 ? `Inside the path loop, ${side} part` : `Out in the open, ${side} part of the grounds`;
}
const titleCase = (s) => String(s).toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
// Which way (dx, dz) points, as a compass word. North is -z.
const compass = (dx, dz) => ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"][Math.round(((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360 / 45) % 8];

// Which tokens this account has found today ([] after midnight).
export const foundToday = (account, day) => (account?.hunt?.day === day ? [...account.hunt.found] : []);

// Pick up token `i` standing at `pos`. Returns { credits, bonus, found, complete, balance } or { error }.
export function collectToken(store, accountId, { day, spots, i, pos }) {
  const a = store.get(accountId);
  const spot = spots[i];
  if (!a || !spot) return { error: "There's no token there." };
  if (!pos || Math.hypot(pos.x - spot.x, pos.z - spot.z) > HUNT.range) return { error: "Get closer to the token." };
  const found = foundToday(a, day);
  if (found.includes(i)) return { error: "You already found that one today." };
  const next = [...found, i].sort((p, q) => p - q);
  const complete = next.length >= spots.length;
  const credits = HUNT.perToken + (complete ? HUNT.bonus : 0);
  const out = store.changeCredits(accountId, credits, `hunt:${day}:${i}${complete ? ":complete" : ""}`, { hunt: { day, found: next } });
  if (out.error) return out;
  return { credits, bonus: complete ? HUNT.bonus : 0, found: next, complete, balance: out.balance };
}
