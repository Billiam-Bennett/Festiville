// One festival "instance". The server owns every player's position;
// clients only send what they WANT to do (inputs), never where they are.
import { Room, ServerError, ErrorCode } from "colyseus";
import { FestivalState, Player, Crew } from "./schema.js";
import { QuestSystem } from "./quests.js";
import { resolveLook, resolveAccessories } from "./entitlements.js";
import { vendorStore } from "./vendors.js";
import { ChatSystem } from "./chat.js";
import { accountStore } from "./accounts.js";
import { layoutStore } from "./layout.js";
import { moderationStore, ACTIONS, REASONS, untilText } from "./moderation.js";

// Which room/connection each signed-in account is using, across all rooms in this server process.
// Signing in somewhere new closes the older connection (close code 4100) instead of letting one
// account appear twice.
const online = new Map();   // account id -> client
export const SIGNED_IN_ELSEWHERE = 4100;
export const KICKED = 4101;
export const BANNED = 4102;
const CHAT_EVIDENCE = 10;   // last few chat lines per player, attached to reports about them

// Tell every staff member online (in any room) how many reports are open, for the 🛡️ button.
let lastStaffCount = -1;
function notifyStaffCount() {
  const count = moderationStore().open().length;
  lastStaffCount = count;
  for (const [accountId, c] of online) if (accountStore().isStaff(accountStore().get(accountId))) c.send("modCount", { count });
}

// How hard the server is working, for /api/health and the once-a-minute log line (server/index.js).
// A tick has 50 ms (20 per second); if ticks regularly take more than ~25 ms, this process is full.
export const serverStats = { rooms: 0, players: 0, ticks: 0, tickMsTotal: 0, tickMsMax: 0 };
export function takeTickStats() {
  const out = { avgTickMs: serverStats.ticks ? +(serverStats.tickMsTotal / serverStats.ticks).toFixed(2) : 0, maxTickMs: +serverStats.tickMsMax.toFixed(2) };
  serverStats.ticks = 0; serverStats.tickMsTotal = 0; serverStats.tickMsMax = 0;
  return out;
}
import { TICK_RATE, sanitizeInput, applyInput, randomSpawn } from "../shared/sim.js";

const EMOTES = new Set(["", "dance"]);
const HEX = /^#[0-9a-fA-F]{6}$/;
const cleanColor = (c, fallback) => (typeof c === "string" && HEX.test(c) ? c : fallback);

export class FestivalRoom extends Room {
  // Players per festival instance. When a room is full, joinOrCreate opens another copy of the festival.
  maxClients = Number(process.env.FV_ROOM_SIZE) || 100;

  onCreate() {
    this.setState(new FestivalState());
    this.inputs = new Map();   // sessionId -> latest sanitized input
    this.quests = new QuestSystem();
    this.chat = new ChatSystem();
    this.accountOf = new Map();   // sessionId -> account id
    this.recentChat = new Map();  // sessionId -> that player's last few chat lines (evidence for reports)
    this.sinceBanCheck = 0;
    this.elapsed = 0;          // seconds since the room opened (NOT this.clock: Colyseus uses that name)

    // Crews and quests. Everything is re-checked on the server (distance, crew size, etc.).
    const str = (v) => (typeof v === "string" ? v.slice(0, 40) : "");
    this.onMessage("invite", (client, targetId) => this.quests.invite(client.sessionId, str(targetId), this.elapsed));
    this.onMessage("inviteReply", (client, accept) => this.quests.respond(client.sessionId, accept === true, this.elapsed));
    this.onMessage("leaveCrew", (client) => this.quests.leaveCrew(client.sessionId));
    this.onMessage("talk", (client, giverId) => this.quests.talk(client.sessionId, str(giverId), this.state.players.get(client.sessionId)));
    this.onMessage("startQuest", (client, giverId) => this.quests.startQuest(client.sessionId, str(giverId), this.positions(), this.elapsed));
    this.onMessage("abandonQuest", (client) => this.quests.abandon(client.sessionId));

    // Clients send input ~20x/sec. We keep only the latest one per player,
    // so spamming messages can't make anyone move faster.
    this.onMessage("input", (client, raw) => {
      const input = sanitizeInput(raw);
      const prev = this.inputs.get(client.sessionId);
      if (prev && input.seq <= prev.seq) return;   // ignore old/out-of-order packets
      this.inputs.set(client.sessionId, input);
    });

    this.onMessage("emote", (client, name) => {
      const p = this.state.players.get(client.sessionId);
      if (p && EMOTES.has(name)) p.emote = name;
    });

    // Change your character and accessories mid-game (the "Looks" button). The server re-checks
    // entitlements (premium looks/accessories need an unlock) and saves the choice to the account.
    this.onMessage("appearance", (client, raw = {}) => {
      const p = this.state.players.get(client.sessionId);
      const account = this.account(client.sessionId);
      if (!p || !account) return;
      if (typeof raw.look === "string" && raw.look) {
        const look = resolveLook(account, raw.look);
        if (p.look !== look) { p.look = look; accountStore().setLook(account.id, look); }
      }
      if (raw.accessories !== undefined) {
        const acc = resolveAccessories(account, raw.accessories);
        const str = acc.join(",");
        if (p.accessories !== str) { p.accessories = str; accountStore().setAccessories(account.id, acc); }
      }
    });

    // Chat: the server decides who hears it (nearby players, or your crew) and enforces rate limits.
    this.onMessage("chat", (client, raw) => {
      const account = this.account(client.sessionId);
      const muted = accountStore().mutedMessage(account);
      if (muted) return client.send("toast", { text: muted, error: true });
      const out = this.chat.send(client.sessionId, raw, {
        now: this.elapsed,
        positions: this.positions(),
        crewOf: (id) => this.quests.crews.get(this.quests.players.get(id)?.crewId)?.members ?? [],
      });
      if (!out) return;
      if (out.error) return client.send("toast", { text: out.error, error: true });
      const name = this.state.players.get(client.sessionId)?.name ?? "Someone";
      const msg = { from: client.sessionId, name, text: out.text, channel: out.channel };
      const lines = this.recentChat.get(client.sessionId) ?? [];
      lines.push({ text: out.text, channel: out.channel, at: new Date().toISOString() });
      this.recentChat.set(client.sessionId, lines.slice(-CHAT_EVIDENCE));
      for (const id of out.to) this.clients.find((c) => c.sessionId === id)?.send("chat", msg);
    });

    // Moderation: anyone can report a player; staff can mute, kick or ban (checked here, not in the browser).
    this.onMessage("report", (client, raw) => this.handleReport(client, raw ?? {}));
    this.onMessage("mod", (client, raw) => this.handleModAction(client, raw ?? {}));
    // The staff Reports screen: the open-report count (for the button), the full list, and decisions.
    this.onMessage("modCount", (client) => { if (accountStore().isStaff(this.account(client.sessionId))) client.send("modCount", { count: moderationStore().open().length }); });
    this.onMessage("modQueue", (client) => this.sendQueue(client));
    this.onMessage("modDecide", (client, raw) => this.handleDecision(client, raw ?? {}));

    // Vendor listings: a player asks for the full set once their game is ready to show it,
    // then gets each edit as it's saved.
    this.onMessage("vendors", (client) => client.send("vendors", vendorStore().all()));
    this.stopVendorUpdates = vendorStore().onChange((listing) => this.broadcast("vendor", listing));
    // A new layout from the festival builder: tell everyone (they refresh to walk the new grounds).
    this.stopLayoutUpdates = layoutStore().onChange(() => this.broadcast("layout", {}));

    const dt = 1 / TICK_RATE;
    serverStats.rooms++;
    this.setSimulationInterval(() => {
      const t0 = performance.now();
      this.tick(dt);
      const ms = performance.now() - t0;
      serverStats.ticks++; serverStats.tickMsTotal += ms;
      if (ms > serverStats.tickMsMax) serverStats.tickMsMax = ms;
    }, 1000 / TICK_RATE);
    this.setPatchRate(1000 / TICK_RATE);           // send state diffs at the same rate
  }

  tick(dt) {
    this.elapsed += dt;
    this.sinceBanCheck += dt;
    if (this.sinceBanCheck >= 5) { this.sinceBanCheck = 0; this.checkRestrictions(); }
    this.state.time = Math.round(this.elapsed * 10) / 10;
    this.state.players.forEach((player, sessionId) => {
      const input = this.inputs.get(sessionId);
      if (!input) return;
      applyInput(player, input, dt);
      if (player.emote && (input.x !== 0 || input.z !== 0)) player.emote = "";   // walking off ends the dance
      player.lastSeq = input.seq;
    });
    this.quests.tick(this.positions(), this.elapsed, dt);
    this.syncQuests();
  }

  positions() {
    const m = new Map();
    this.state.players.forEach((p, id) => m.set(id, { x: p.x, z: p.z }));
    return m;
  }

  // Copy crew/quest state into the synced schema (only fields that changed get sent),
  // and deliver one-off events (invites, toasts, quest offers) to specific players.
  syncQuests() {
    const qs = this.quests;
    for (const [id, crew] of qs.crews) {
      let c = this.state.crews.get(id);
      if (!c) { c = new Crew(); this.state.crews.set(id, c); }
      const members = crew.members.join(",");
      const quest = qs.publicQuest(crew);
      if (c.leader !== crew.leader) c.leader = crew.leader;
      if (c.members !== members) c.members = members;
      if (c.quest !== quest) c.quest = quest;
    }
    for (const id of [...this.state.crews.keys()]) if (!qs.crews.has(id)) this.state.crews.delete(id);
    this.state.players.forEach((p, id) => {
      const qp = qs.players.get(id);
      if (!qp) return;
      const badges = [...qp.badges].join(",");
      if (p.crewId !== qp.crewId) p.crewId = qp.crewId;
      if (p.badges !== badges) {
        p.badges = badges;
        const accountId = this.accountOf.get(id);
        if (accountId) accountStore().setBadges(accountId, [...qp.badges]);   // badges survive restarts
      }
    });
    for (const ev of qs.drainEvents()) {
      const { to, type, ...msg } = ev;
      this.clients.find((c) => c.sessionId === to)?.send(type, msg);
    }
  }

  account(sessionId) {
    const id = this.accountOf.get(sessionId);
    return id ? accountStore().get(id) : null;
  }

  handleReport(client, { target, reason, note }) {
    const me = this.account(client.sessionId);
    const them = typeof target === "string" ? this.account(target) : null;
    if (!me || !them) return client.send("toast", { text: "That player isn't here anymore.", error: true });
    const out = moderationStore().report({
      reporter: { id: me.id, name: me.username },
      target: { id: them.id, name: them.username },
      reason, note, chat: this.recentChat.get(target) ?? [],
    });
    if (out.error) return client.send("toast", { text: out.error, error: true });
    client.send("toast", { text: out.duplicate ? `You already reported ${them.username}. Staff will look at it.` : `Thanks. Your report about ${them.username} was sent to festival staff.` });
    if (out.duplicate) return;
    console.log(`[report] ${me.username} reported ${them.username}: ${reason}${note ? ` (${note})` : ""}`);
    // Let any staff who are online right now know (in any room).
    for (const [accountId, c] of online) {
      if (accountStore().isStaff(accountStore().get(accountId))) c.send("toast", { text: `Report: ${me.username} reported ${them.username} (${REASONS[reason]})`, error: true });
    }
    notifyStaffCount();
  }

  handleModAction(client, { target, action, reason }) {
    const me = this.account(client.sessionId);
    if (!accountStore().isStaff(me) || !ACTIONS[action]) return client.send("toast", { text: "Only festival staff can do that.", error: true });
    const them = typeof target === "string" ? this.account(target) : null;
    if (!them) return client.send("toast", { text: "That player isn't here anymore.", error: true });
    this.applyAction(client, me, them, action, reason);
  }

  // Mute / kick / ban one account, from the player card or the Reports screen. Works on players who
  // are offline or in another room too (except kick, which needs them online). Returns true if done.
  applyAction(client, me, them, action, reason) {
    const act = ACTIONS[action];
    if (!act) return false;
    const fail = (text) => { client.send("toast", { text, error: true }); return false; };
    if (them.id === me.id) return fail("You can't do that to yourself.");
    if (accountStore().isStaff(them)) return fail("Staff can't act on other staff. Use the command line.");
    const why = typeof reason === "string" ? reason.slice(0, 200) : "";
    const theirClient = online.get(them.id);
    if (act.kind === "kick" && !theirClient) return fail(`${them.username} isn't online, so there's nothing to kick. Mute or ban instead.`);

    if (act.kind === "mute") {
      const until = accountStore().restrict(them.id, "mute", act.minutes, why);
      theirClient?.send("toast", { text: `Festival staff muted your chat ${untilText(until)}.`, error: true });
    } else if (act.kind === "ban") {
      accountStore().restrict(them.id, "ban", act.minutes, why);
      this.remove(theirClient, BANNED, accountStore().bannedMessage(accountStore().get(them.id)));
    } else {
      this.remove(theirClient, KICKED, "Festival staff removed you from the festival. You can rejoin, but please follow the festival rules.");
    }
    moderationStore().record({ by: me.username, target: { id: them.id, name: them.username }, action: act.kind, minutes: act.minutes ?? 0, reason: why });
    console.log(`[staff] ${me.username}: ${act.label} ${them.username}${why ? ` (${why})` : ""}`);
    client.send("toast", { text: `${act.label}: ${them.username}. Done.` });
    notifyStaffCount();
    return true;
  }

  // Reports screen: send this staff member the open reports, marking who's online right now.
  sendQueue(client) {
    if (!accountStore().isStaff(this.account(client.sessionId))) return;
    accountStore().refresh();
    const groups = moderationStore().queue().map((g) => {
      const a = accountStore().get(g.target.id);
      return {
        ...g,
        online: online.has(g.target.id),
        staff: accountStore().isStaff(a),
        mutedUntil: accountStore().isMuted(a) ? a.mutedUntil : 0,
        bannedUntil: accountStore().isBanned(a) ? a.bannedUntil : 0,
      };
    });
    client.send("modQueue", { groups, count: moderationStore().open().length });
  }

  // Reports screen decision on one reported player: "dismiss" (nothing to do), or a staff action.
  handleDecision(client, { target, action, reason }) {
    const me = this.account(client.sessionId);
    if (!accountStore().isStaff(me)) return client.send("toast", { text: "Only festival staff can do that.", error: true });
    if (typeof target !== "string") return;
    if (action === "dismiss") {
      const n = moderationStore().dismiss(target, me.username, typeof reason === "string" ? reason : "");
      if (n) {
        console.log(`[staff] ${me.username}: dismissed ${n} report${n === 1 ? "" : "s"}`);
        client.send("toast", { text: `Dismissed ${n} report${n === 1 ? "" : "s"}.` });
        notifyStaffCount();
      }
    } else {
      accountStore().refresh();
      const them = accountStore().get(target);
      if (!them) client.send("toast", { text: "That account doesn't exist anymore.", error: true });
      else if (!ACTIONS[action]) client.send("toast", { text: "Unknown action.", error: true });
      else this.applyAction(client, me, them, action, reason);
    }
    this.sendQueue(client);
  }

  // Tell a player why, then disconnect them (works for any room, via the online map).
  remove(client, code, text) {
    if (!client) return;
    client.send("removed", { code, text });
    setTimeout(() => client.leave(code, text.slice(0, 100)), 100);
  }

  // Bans and staff changes made from the command line reach players who are already in the game.
  checkRestrictions() {
    accountStore().refresh();
    layoutStore().refresh();      // picks up `npm run layout -- restore` while running
    if (moderationStore().open().length !== lastStaffCount) notifyStaffCount();   // e.g. `npm run account -- close-report`
    this.state.players.forEach((p, sessionId) => {
      const a = this.account(sessionId);
      if (!a) return;
      if (accountStore().isBanned(a)) this.remove(this.clients.find((c) => c.sessionId === sessionId), BANNED, accountStore().bannedMessage(a));
      const staff = accountStore().isStaff(a);
      if (p.staff !== staff) p.staff = staff;
    });
  }

  // Every player must be signed in: the page sends the session token it got from /api/login or /api/signup.
  onAuth(client, options = {}) {
    const account = accountStore().accountForToken(options.token);
    if (!account) throw new ServerError(ErrorCode.AUTH_FAILED, "Please sign in again.");
    const ban = accountStore().bannedMessage(account);
    if (ban) throw new ServerError(ErrorCode.AUTH_FAILED, ban);
    return account;
  }

  onJoin(client, options = {}, account) {
    const older = online.get(account.id);
    if (older && older !== client) older.leave(SIGNED_IN_ELSEWHERE, "Signed in somewhere else");
    online.set(account.id, client);
    this.accountOf.set(client.sessionId, account.id);

    const p = new Player();
    const spawn = randomSpawn();
    p.x = spawn.x;
    p.z = spawn.z;
    p.name = account.username;
    p.staff = accountStore().isStaff(account);
    const wanted = typeof options.look === "string" && options.look ? options.look : account.look;
    p.look = resolveLook(account, wanted);
    accountStore().setLook(account.id, p.look);
    const acc = resolveAccessories(account, options.accessories ?? account.accessories);
    p.accessories = acc.join(",");
    accountStore().setAccessories(account.id, acc);
    p.skinTone = cleanColor(options.skinTone, p.skinTone);
    p.shirtColor = cleanColor(options.shirtColor, p.shirtColor);
    this.state.players.set(client.sessionId, p);
    serverStats.players++;
    this.quests.join(client.sessionId, p.name);
    this.quests.players.get(client.sessionId).badges = new Set(account.badges);   // saved progress
    p.badges = [...account.badges].join(",");
    console.log(`[festival ${this.roomId}] ${p.name} joined (${this.clients.length} online)`);
  }

  onDispose() {
    serverStats.rooms--;
    this.stopVendorUpdates?.();
    this.stopLayoutUpdates?.();
  }

  onLeave(client) {
    const p = this.state.players.get(client.sessionId);
    if (this.state.players.has(client.sessionId)) serverStats.players--;
    this.state.players.delete(client.sessionId);
    this.inputs.delete(client.sessionId);
    this.quests.leave(client.sessionId);
    this.chat.leave(client.sessionId);
    this.recentChat.delete(client.sessionId);
    const accountId = this.accountOf.get(client.sessionId);
    this.accountOf.delete(client.sessionId);
    if (accountId && online.get(accountId) === client) online.delete(accountId);
    console.log(`[festival ${this.roomId}] ${p?.name ?? client.sessionId} left (${this.clients.length} online)`);
  }
}
