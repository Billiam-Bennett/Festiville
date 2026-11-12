// Rides: who is on the Ferris wheel and who is driving a golf cart. All the rules, with no networking
// in here (the game room feeds in positions and requests and copies `rideOf()` into the synced state;
// test/rides.test.js tests this directly).
import { WHEEL, SHUTTLE, freeGondola, fromBottom, nextBottom, boardPoint, gondolaPos, stopsOf, stopAt } from "../shared/rides.js";
import { resolveSolids, inWater } from "../shared/sim.js";
import { MEMBERSHIP } from "../shared/economy.js";

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export class RideSystem {
  constructor() {
    this.wheel = new Map();   // player id -> { gondola, endsAt }
    this.carts = new Set();   // player ids driving a cart
    this.events = [];
  }

  // What goes in the player's synced `ride` field.
  rideOf(id) {
    const w = this.wheel.get(id);
    return w ? `wheel:${w.gondola}` : this.carts.has(id) ? "cart" : "";
  }
  onWheel(id) { return this.wheel.has(id); }
  leave(id) { this.wheel.delete(id); this.carts.delete(id); }

  // ---------- Ferris wheel ----------
  // wheel: the layout's wheel item (or null). pos: where the player is. now: room time in seconds.
  board(id, pos, now, wheel) {
    if (!wheel) return this.err(id, "There's no Ferris wheel on the grounds right now.");
    if (this.wheel.has(id)) return;
    if (!pos || dist(pos, wheel) > WHEEL.boardRange) return this.err(id, "Walk up to the Ferris wheel to get on.");
    const taken = new Map();
    for (const r of this.wheel.values()) taken.set(r.gondola, (taken.get(r.gondola) ?? 0) + 1);
    const gondola = freeGondola(now, taken);
    if (gondola < 0) return this.err(id, "The Ferris wheel is full. Catch the next one!");
    this.carts.delete(id);   // the cart goes back to your camp
    // One slow turn: you get off the next time your gondola is back at the bottom.
    this.wheel.set(id, { gondola, endsAt: nextBottom(gondola, now, WHEEL.period * 0.5) });
    this.emit(id, { type: "toast", text: "You're on the Ferris wheel. Enjoy the view! You'll get off when you're back at the bottom." });
  }

  // Step off early: only while your gondola is near the ground.
  off(id, now, wheel) {
    const r = this.wheel.get(id);
    if (!r) return null;
    if (fromBottom(r.gondola, now) > WHEEL.offArc) { this.err(id, "You can get off when your gondola comes back down."); return null; }
    return this.unload(id, wheel);
  }

  unload(id, wheel) {
    this.wheel.delete(id);
    return wheel ? boardPoint(wheel) : null;   // where to put them back on the ground
  }

  // Every tick. Returns [{ id, x, z, off }]: where each rider is (their gondola, seen from above),
  // or with off: true, where they were just set down because the turn is over or the wheel is gone.
  tick(now, wheel) {
    const out = [];
    for (const [id, r] of this.wheel) {
      if (!wheel || now >= r.endsAt) {
        const at = this.unload(id, wheel);
        out.push({ id, off: true, ...(at ?? {}) });
        this.emit(id, { type: "toast", text: wheel ? "Back on the ground. Hope you enjoyed the ride!" : "The Ferris wheel was moved, so you're back on the ground." });
      } else {
        const g = gondolaPos(wheel, r.gondola, now);
        out.push({ id, x: g.x, z: g.z });
      }
    }
    return out;
  }

  // ---------- Golf cart ----------
  // owns: does this account have a cart (server/entitlements.js → hasGolfCart). hasCamp: carts are
  // parked at your camp, so you need one.
  cart(id, on, { owns = false, hasCamp = false } = {}) {
    if (!on) { this.carts.delete(id); return; }
    if (!owns) return this.err(id, `Golf carts are for premium members (${MEMBERSHIP.name}).`);
    if (!hasCamp) return this.err(id, "Your golf cart is parked at your camp. Claim your camp spot first (🪙 → Camp).");
    if (this.wheel.has(id)) return this.err(id, "Get off the Ferris wheel first.");
    this.carts.add(id);
  }

  // ---------- Shuttle ----------
  // Take the shuttle from the stop you're at to stop `toId`. Returns where to put you ({ x, z }), or
  // null (with a toast saying why). busy: your crew is on a timed quest. rng: for where you land.
  shuttle(id, pos, toId, items, { busy = false, rng = Math.random } = {}) {
    if (this.wheel.has(id)) { this.err(id, "Get off the Ferris wheel first."); return null; }
    if (this.carts.has(id)) { this.err(id, "You're in your golf cart. Just drive!"); return null; }
    if (busy) { this.err(id, "The shuttle doesn't run while you're on a timed quest. Run for it!"); return null; }
    const from = pos && stopAt(items, pos);
    if (!from) { this.err(id, "Walk up to a shuttle stop (🚌) to ride."); return null; }
    const to = stopsOf(items).find((s) => s.id === toId);
    if (!to || to.id === from.id) { this.err(id, "Pick where you want to go."); return null; }
    // Step off somewhere near the stop that's open ground.
    for (let i = 0; i < 12; i++) {
      const a = rng() * Math.PI * 2, r = 1 + rng() * SHUTTLE.landing;
      const p = resolveSolids({ x: to.x + Math.cos(a) * r, z: to.z + Math.sin(a) * r });
      if (!inWater(p.x, p.z)) {
        this.emit(id, { type: "toast", text: `🚌 Next stop: ${to.label}.` });
        return { x: p.x, z: p.z, stop: to.id };
      }
    }
    return resolveSolids({ x: to.x, z: to.z });
  }

  emit(to, event) { this.events.push({ to, ...event }); }
  err(to, text) { this.emit(to, { type: "toast", text, error: true }); }
  drainEvents() { const e = this.events; this.events = []; return e; }
}
