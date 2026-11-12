// Crews and side quests: all the rules, with no networking in here.
// The game room (FestivalRoom.js) feeds in player positions and requests; this decides
// what happens and returns "events" (messages to show specific players).
// Keeping it separate means it can be tested without running a server (test/quests.test.js).
import {
  CREW_MAX, TALK_RANGE, PICKUP_RANGE, INVITE_TTL,
  QUESTS, LOST_SPOTS, CAMP_TENTS, giverById, dist,
} from "../shared/quests-data.js";
import { vendorById, vendorFront } from "../shared/venue.js";

// Where a business quest ends: a few steps in front of the sponsor's stall, or null if that stall
// isn't on the map right now.
function sponsorSpot(q) {
  const v = vendorById(q.sponsor?.stall);
  return v ? vendorFront(v) : null;
}

export class QuestSystem {
  constructor({ rng = Math.random } = {}) {
    this.rng = rng;
    this.players = new Map();   // id -> { id, name, crewId, badges:Set }
    this.crews = new Map();     // id -> { id, leader, members:[ids], quest:null|{...} }
    this.invites = new Map();   // invitee id -> { from, crewId, expires }
    this.nextCrew = 1;
    this.events = [];
  }

  // ---------- players ----------
  join(id, name) { this.players.set(id, { id, name, crewId: "", badges: new Set() }); }

  leave(id) {
    this.leaveCrew(id, { silent: true });
    this.invites.delete(id);
    this.players.delete(id);
  }

  // ---------- crews ----------
  invite(fromId, toId, now) {
    const from = this.players.get(fromId), to = this.players.get(toId);
    if (!from || !to || fromId === toId) return this.err(fromId, "That player isn't here anymore.");
    if (to.crewId && to.crewId === from.crewId) return this.err(fromId, `${to.name} is already in your crew.`);
    if (to.crewId) return this.err(fromId, `${to.name} is already in a crew.`);
    const crew = from.crewId ? this.crews.get(from.crewId) : this.createCrew(fromId);
    if (crew.members.length >= CREW_MAX) return this.err(fromId, `Your crew is full (${CREW_MAX} max).`);
    this.invites.set(toId, { from: fromId, crewId: crew.id, expires: now + INVITE_TTL });
    this.emit(toId, { type: "invite", from: fromId, fromName: from.name, crewSize: crew.members.length });
    this.emit(fromId, { type: "toast", text: `Invite sent to ${to.name}.` });
  }

  respond(toId, accept, now) {
    const inv = this.invites.get(toId);
    this.invites.delete(toId);
    const to = this.players.get(toId);
    if (!inv || !to) return;
    const crew = this.crews.get(inv.crewId);
    const fromName = this.players.get(inv.from)?.name ?? "They";
    if (!accept) return this.emit(inv.from, { type: "toast", text: `${to.name} said not right now.` });
    if (now > inv.expires || !crew) return this.err(toId, "That invite expired.");
    if (to.crewId) return this.err(toId, "Leave your current crew first.");
    if (crew.members.length >= CREW_MAX) return this.err(toId, `${fromName}'s crew is full.`);
    crew.members.push(toId);
    crew.temp = false;   // a real crew now; it sticks around after quests
    to.crewId = crew.id;
    this.emitCrew(crew, { type: "toast", text: `${to.name} joined the crew!` });
  }

  leaveCrew(id, { silent = false } = {}) {
    const p = this.players.get(id);
    const crew = p && this.crews.get(p.crewId);
    if (!crew) return;
    crew.members = crew.members.filter((m) => m !== id);
    p.crewId = "";
    if (crew.quest) this.dropCarried(crew, id);
    if (!silent) this.emit(id, { type: "toast", text: "You left the crew." });
    if (!crew.members.length) { this.crews.delete(crew.id); return; }
    if (crew.leader === id) crew.leader = crew.members[0];
    this.emitCrew(crew, { type: "toast", text: `${p.name} left the crew.` });
    const q = crew.quest && QUESTS[crew.quest.id];
    if (q && crew.members.length < q.minCrew) this.finish(crew, false, `${q.name} needs a crew of ${q.minCrew}. Quest stopped.`);
  }

  createCrew(leaderId, { temp = false } = {}) {
    const crew = { id: `c${this.nextCrew++}`, leader: leaderId, members: [leaderId], quest: null, temp };
    this.crews.set(crew.id, crew);
    this.players.get(leaderId).crewId = crew.id;
    return crew;
  }

  // ---------- quest givers ----------
  talk(id, giverId, pos) {
    const g = giverById(giverId);
    if (!g || !pos || dist(pos, g) > TALK_RANGE) return this.err(id, "Get a little closer to talk.");
    const q = QUESTS[g.quest];
    const p = this.players.get(id);
    const crew = p.crewId ? this.crews.get(p.crewId) : null;
    const size = crew ? crew.members.length : 1;
    let blocked = "";
    if (crew?.quest) blocked = `Your crew is already on "${QUESTS[crew.quest.id].name}".`;
    else if (size < q.minCrew) blocked = `You need a crew of at least ${q.minCrew}. Tap another player to invite them.`;
    else if (q.type === "business" && !sponsorSpot(q)) blocked = `${q.sponsor.name} isn't set up at the festival right now. Check back later.`;
    this.emit(id, {
      type: "offer", giverId, questId: g.quest, giverName: g.name, name: q.name,
      pitch: q.pitch, howTo: q.howTo, badge: q.badge, crewSize: size,
      done: p.badges.has(q.badge), blocked,
      ...(q.sponsor ? { sponsor: { name: q.sponsor.name, message: q.sponsor.message, link: q.sponsor.link ?? "" } } : {}),
    });
  }

  startQuest(id, giverId, positions, now) {
    const g = giverById(giverId);
    const pos = positions.get(id);
    if (!g || !pos || dist(pos, g) > TALK_RANGE) return this.err(id, "Get a little closer to talk.");
    const q = QUESTS[g.quest];
    const p = this.players.get(id);
    const existing = p.crewId ? this.crews.get(p.crewId) : null;
    if (existing?.quest) return this.err(id, `Your crew is already on "${QUESTS[existing.quest.id].name}".`);
    if ((existing?.members.length ?? 1) < q.minCrew) return this.err(id, `${q.name} needs a crew of at least ${q.minCrew}. Tap another player to invite them.`);
    const spot = q.type === "business" ? sponsorSpot(q) : null;
    if (q.type === "business" && !spot) return this.err(id, `${q.sponsor.name} isn't set up at the festival right now. Check back later.`);
    const crew = existing ?? this.createCrew(id, { temp: true });

    const quest = { id: g.quest, startedBy: id, endsAt: q.timeLimit ? now + q.timeLimit : 0 };
    if (g.quest === "lostfound") {
      quest.items = this.pick(LOST_SPOTS, q.pieces).map((s, i) => ({ id: i, x: s.x, z: s.z, where: s.where, found: false }));
      quest.stage = "search";
    }
    if (g.quest === "soundcheck") quest.hold = 0;
    if (g.quest === "vendorrush") {
      const n = Math.min(q.ordersBase + crew.members.length - 1, CAMP_TENTS.length);
      quest.orders = this.pick(CAMP_TENTS, n).map((t, i) => ({ id: i, x: t.x, z: t.z, state: "waiting", carrier: "" }));
    }
    if (q.type === "business") Object.assign(quest, { stage: "go", hold: 0, x: spot.x, z: spot.z });
    crew.quest = quest;
    this.emitCrew(crew, { type: "questStart", questId: g.quest, name: q.name, by: p.name });
  }

  abandon(id) {
    const crew = this.crews.get(this.players.get(id)?.crewId);
    if (!crew?.quest) return;
    this.finish(crew, false, `${this.players.get(id).name} ended the quest.`);
  }

  // Business quests: someone in the crew talks to the vendor at the sponsor's stall.
  vendorTalk(id, positions) {
    const crew = this.crews.get(this.players.get(id)?.crewId);
    const quest = crew?.quest, q = quest && QUESTS[quest.id];
    if (!q || q.type !== "business") return;
    const pos = positions.get(id);
    if (!pos || dist(pos, quest) > q.task.range) return this.err(id, `Get a little closer to the ${q.sponsor.name} stall to talk.`);
    if (quest.stage === "task") return;
    quest.stage = "task";
    quest.hold = 0;
    this.emitCrew(crew, { type: "sponsorTalk", questId: quest.id, sponsor: q.sponsor.name, line: q.vendorLine, message: q.sponsor.message, task: q.task.label, by: this.name(id) });
  }

  // ---------- every server tick ----------
  tick(positions, now, dt) {
    for (const [id, inv] of this.invites) if (now > inv.expires) this.invites.delete(id);
    for (const crew of this.crews.values()) {
      const quest = crew.quest;
      if (!quest) continue;
      const q = QUESTS[quest.id];
      if (quest.endsAt && now > quest.endsAt) { this.finish(crew, false, `Time's up on ${q.name}. Talk to ${giverById(q.giver).name} to try again.`); continue; }
      const members = crew.members.map((m) => ({ id: m, ...positions.get(m) })).filter((m) => m.x !== undefined);
      if (quest.id === "lostfound") this.tickLostFound(crew, quest, q, members);
      if (quest.id === "soundcheck") this.tickSoundcheck(crew, quest, q, members, dt);
      if (quest.id === "vendorrush") this.tickVendorRush(crew, quest, q, members);
      if (q.type === "business") this.tickBusiness(crew, quest, q, members, dt);
    }
  }

  // Walk to the sponsor's stall ("go"), talk to the vendor ("talk", see vendorTalk), then do the task
  // there: someone from the crew stays at the counter for task.holdSeconds ("task").
  tickBusiness(crew, quest, q, members, dt) {
    const there = members.filter((m) => dist(m, quest) <= q.task.range);
    if (quest.stage === "go" && there.length) {
      quest.stage = "talk";
      this.emitCrew(crew, { type: "toast", text: `${this.name(there[0].id)} made it to ${q.sponsor.name}. Talk to them at the counter.` });
    }
    if (quest.stage !== "task") return;
    quest.hold = there.length ? quest.hold + dt : 0;
    if (quest.hold >= q.task.holdSeconds) this.finish(crew, true);
  }

  tickLostFound(crew, quest, q, members) {
    for (const item of quest.items) {
      if (item.found) continue;
      const finder = members.find((m) => dist(m, item) <= PICKUP_RANGE);
      if (!finder) continue;
      item.found = true;
      const n = quest.items.filter((i) => i.found).length;
      this.emitCrew(crew, { type: "toast", text: `${this.name(finder.id)} found a totem piece ${item.where} (${n}/${quest.items.length})` });
      if (n === quest.items.length) {
        quest.stage = "return";
        this.emitCrew(crew, { type: "toast", text: "All pieces found! Bring them back to Juniper." });
      }
    }
    if (quest.stage === "return" && members.some((m) => dist(m, giverById(q.giver)) <= TALK_RANGE)) this.finish(crew, true);
  }

  tickSoundcheck(crew, quest, q, members, dt) {
    const onMain = members.filter((m) => dist(m, q.markers.main) <= q.markerRadius);
    const onSide = members.filter((m) => dist(m, q.markers.side) <= q.markerRadius);
    // Needs two DIFFERENT people (the markers are far apart, but be strict anyway).
    const synced = onMain.length > 0 && onSide.some((s) => onMain.some((m) => m.id !== s.id));
    quest.onMain = onMain.map((m) => m.id);
    quest.onSide = onSide.map((m) => m.id);
    quest.hold = synced ? quest.hold + dt : 0;
    if (quest.hold >= q.holdSeconds) this.finish(crew, true);
  }

  tickVendorRush(crew, quest, q, members) {
    const stand = giverById(q.giver);
    for (const m of members) {
      const carrying = quest.orders.find((o) => o.state === "carried" && o.carrier === m.id);
      if (carrying && dist(m, carrying) <= q.handoffRange) {
        carrying.state = "delivered";
        carrying.carrier = "";
        const left = quest.orders.filter((o) => o.state !== "delivered").length;
        this.emitCrew(crew, { type: "toast", text: `${this.name(m.id)} delivered an order! ${left ? `${left} to go.` : ""}` });
        if (!left) return this.finish(crew, true);
      } else if (!carrying && dist(m, stand) <= q.handoffRange) {
        const next = quest.orders.find((o) => o.state === "waiting");
        if (next) {
          next.state = "carried";
          next.carrier = m.id;
          this.emit(m.id, { type: "toast", text: "Order up! Run it to the marked tent." });
        }
      }
    }
  }

  // ---------- helpers ----------
  finish(crew, success, text) {
    const questId = crew.quest.id;
    const q = QUESTS[questId];
    crew.quest = null;
    if (success) {
      for (const m of crew.members) this.players.get(m)?.badges.add(q.badge);
      this.emitCrew(crew, { type: "questDone", success: true, questId, name: q.name, badge: q.badge });
    } else {
      this.emitCrew(crew, { type: "questDone", success: false, name: q.name, text });
    }
    // A solo "crew" that only existed for this quest goes away when it ends.
    if (crew.temp) {
      for (const m of crew.members) { const p = this.players.get(m); if (p) p.crewId = ""; }
      this.crews.delete(crew.id);
    }
  }

  dropCarried(crew, id) {
    for (const o of crew.quest.orders ?? []) if (o.carrier === id) { o.state = "waiting"; o.carrier = ""; }
  }

  pick(list, n) {
    const a = [...list];
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(this.rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a.slice(0, n);
  }

  name(id) { return this.players.get(id)?.name ?? "Someone"; }
  emit(to, event) { this.events.push({ to, ...event }); }
  emitCrew(crew, event) { for (const m of crew.members) this.emit(m, event); }
  err(to, text) { this.emit(to, { type: "toast", text, error: true }); }
  drainEvents() { const e = this.events; this.events = []; return e; }

  // What the browser needs to draw quest stuff for a crew (sent as JSON in the synced state).
  publicQuest(crew) {
    const quest = crew.quest;
    if (!quest) return "";
    const out = { id: quest.id, endsAt: quest.endsAt };
    if (quest.items) { out.items = quest.items; out.stage = quest.stage; }
    if (quest.id === "soundcheck") { out.hold = +quest.hold.toFixed(1); out.onMain = quest.onMain ?? []; out.onSide = quest.onSide ?? []; }
    if (quest.orders) out.orders = quest.orders;
    if (QUESTS[quest.id].type === "business") Object.assign(out, { stage: quest.stage, hold: +quest.hold.toFixed(1), x: quest.x, z: quest.z });
    return JSON.stringify(out);
  }
}
