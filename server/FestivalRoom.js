// One festival "instance". The server owns every player's position;
// clients only send what they WANT to do (inputs), never where they are.
import { Room, ServerError, ErrorCode } from "colyseus";
import { FestivalState, Player, Crew } from "./schema.js";
import { QuestSystem } from "./quests.js";
import { resolveAppearance } from "./entitlements.js";
import { vendorStore } from "./vendors.js";
import { ChatSystem } from "./chat.js";
import { accountStore } from "./accounts.js";
import { layoutStore } from "./layout.js";
import { moderationStore, ACTIONS, REASONS, untilText } from "./moderation.js";
import { buy, rewardQuest } from "./shop.js";
import { campStore, upgradeCost } from "./camps.js";
import { plotById } from "../shared/economy.js";

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
import { newEmoteState, startEmote, updateEmote } from "../shared/emotes.js";
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
    this.emotes = new Map();      // sessionId -> emote state (shared/emotes.js); emote + emoteSeq are copied into the schema
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

    // Emotes (shared/emotes.js): "dance", "wave", "jump", … to start one, "" to stop. Moving ends most of
    // them, one-shots end on their own, and the server tells everyone (emote + emoteSeq in the schema).
    this.onMessage("emote", (client, name) => {
      const input = this.inputs.get(client.sessionId);
      const moving = !!input && (input.x !== 0 || input.z !== 0);
      if (startEmote(this.emoteState(client.sessionId), name, { now: this.elapsed, moving })) this.syncEmote(client.sessionId);
    });

    // Change your character and accessories mid-game (the 👕 button). The browser sends a classic
    // { look } or a parts-based { recipe } (shared/parts.js), plus { accessories }. The server re-checks
    // entitlements (premium looks/parts/accessories need an unlock) and saves the result to the account.
    this.onMessage("appearance", (client, raw) => {
      const p = this.state.players.get(client.sessionId);
      const account = this.account(client.sessionId);
      if (!p || !account || !raw || typeof raw !== "object") return;
      this.applyAppearance(p, account, resolveAppearance(account, raw, { look: p.look, recipe: p.recipe, accessories: p.accessories }));
    });

    // Credits and the shop. Balances only ever change here on the server (server/shop.js has the rules).
    this.onMessage("wallet", (client) => this.sendWallet(client));
    this.onMessage("buy", (client, id) => {
      const account = this.account(client.sessionId);
      if (!account) return;
      const out = buy(accountStore(), account.id, typeof id === "string" ? id.slice(0, 40) : "");
      client.send("toast", { text: out.error ?? out.text, error: !!out.error });
      this.sendWallet(client);
    });

    // Your camp in the Campground: claim a spot where you stand, upgrade, move, set up items, release.
    this.onMessage("camp", (client, raw) => this.handleCamp(client, raw && typeof raw === "object" ? raw : {}));
    this.onMessage("camps", (client) => client.send("camps", campStore().all()));
    this.stopCampUpdates = campStore().onChange((camp, id) => this.broadcast("camp", { id, camp }));

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
      player.lastSeq = input.seq;
    });
    // One-shot emotes end on time; walking off ends a dance (or stands you up).
    for (const [id, st] of this.emotes) {
      const input = this.inputs.get(id);
      if (updateEmote(st, { now: this.elapsed, moving: !!input && (input.x !== 0 || input.z !== 0) })) this.syncEmote(id);
    }
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
      const client = this.clients.find((c) => c.sessionId === to);
      // Finished a quest: pay credits (server/shop.js decides how many) and tell them their new balance.
      const accountId = type === "questDone" && msg.success ? this.accountOf.get(to) : null;
      if (accountId) msg.credits = rewardQuest(accountStore(), accountId, msg.questId);
      client?.send(type, msg);
      if (accountId && client) this.sendWallet(client);
    }
  }

  // Put a resolved appearance on a player (only changed fields are synced) and save it as their default.
  applyAppearance(p, account, { look, recipe, accessories }) {
    if (p.look !== look) p.look = look;
    if (p.recipe !== recipe) p.recipe = recipe;
    const acc = accessories.join(",");
    if (p.accessories !== acc) p.accessories = acc;
    accountStore().setLook(account.id, look);
    accountStore().setRecipe(account.id, recipe);
    accountStore().setAccessories(account.id, accessories);
  }

  // The player's own credits, what they own, and their camp (private: only sent to them).
  sendWallet(client) {
    const a = this.account(client.sessionId);
    if (!a) return;
    const store = accountStore();
    client.send("wallet", { credits: store.balance(a), unlocks: [...a.unlocks], campItems: store.campItems(a), camp: campStore().public(a.id) });
  }

  handleCamp(client, { action, plot, items }) {
    const a = this.account(client.sessionId);
    const p = this.state.players.get(client.sessionId);
    if (!a || !p) return;
    const store = accountStore(), camps = campStore();
    const say = (text, error = false) => client.send("toast", { text, error });
    const mine = camps.of(a.id);
    const owned = store.campItems(a);
    if (action === "claim") {
      if (mine) return say("You already have a camp. Use Move or Upgrade instead.", true);
      const size = plotById(plot);
      if (!size) return say("Pick a spot size.", true);
      const why = camps.check(a.id, p.x, p.z, size.id);
      if (why) return say(why, true);
      const paid = store.changeCredits(a.id, -size.price, `camp:${size.id}`);
      if (paid.error) return say(paid.error, true);
      const out = camps.place(a.id, a.username, { x: p.x, z: p.z, plot: size.id, items: ["tent_basic"] }, owned);
      if (out.error) { store.changeCredits(a.id, size.price, `refund:camp:${size.id}`); return say(out.error, true); }
      say(`Your ${size.name} is yours! Set up your camp from the Camp tab.`);
    } else if (action === "upgrade") {
      if (!mine) return say("Claim a camp spot first.", true);
      const cost = upgradeCost(mine.plot, plot);
      if (cost == null) return say("Pick a bigger spot size.", true);
      const why = camps.check(a.id, mine.x, mine.z, plot);
      if (why) return say(`There isn't room to grow here (${why}) Move somewhere roomier first.`, true);
      const paid = store.changeCredits(a.id, -cost, `camp:upgrade:${plot}`);
      if (paid.error) return say(paid.error, true);
      const out = camps.place(a.id, a.username, { x: mine.x, z: mine.z, plot, items: mine.items }, owned);
      if (out.error) { store.changeCredits(a.id, cost, `refund:camp:upgrade:${plot}`); return say(out.error, true); }
      say(`Upgraded to a ${plotById(plot).name}!`);
    } else if (action === "move") {
      if (!mine) return say("Claim a camp spot first.", true);
      const out = camps.place(a.id, a.username, { x: p.x, z: p.z, plot: mine.plot, items: mine.items }, owned);
      if (out.error) return say(out.error, true);
      say("Camp moved here.");
    } else if (action === "setup") {
      const out = camps.setItems(a.id, items, owned);
      if (out.error) return say(out.error, true);
    } else if (action === "release") {
      if (!camps.release(a.id)) return say("You don't have a camp.", true);
      say("You packed up and gave back your spot.");
    }
    this.sendWallet(client);
  }

  emoteState(sessionId) {
    let st = this.emotes.get(sessionId);
    if (!st) { st = newEmoteState(); this.emotes.set(sessionId, st); }
    return st;
  }

  syncEmote(sessionId) {
    const p = this.state.players.get(sessionId), st = this.emotes.get(sessionId);
    if (!p || !st) return;
    if (p.emote !== st.emote) p.emote = st.emote;
    if (p.emoteSeq !== st.emoteSeq) p.emoteSeq = st.emoteSeq;
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
    campStore().refresh();        // picks up `npm run account -- camp-release` while running
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
    // What they asked for on the join screen, else what they wore last time (saved on the account).
    this.applyAppearance(p, account, resolveAppearance(account, options, { look: account.look, recipe: account.recipe ?? "", accessories: account.accessories }));
    p.skinTone = cleanColor(options.skinTone, p.skinTone);
    p.shirtColor = cleanColor(options.shirtColor, p.shirtColor);
    this.state.players.set(client.sessionId, p);
    serverStats.players++;
    this.quests.join(client.sessionId, p.name);
    this.quests.players.get(client.sessionId).badges = new Set(account.badges);   // saved progress
    p.badges = [...account.badges].join(",");
    campStore().rename(account.id, account.username);
    console.log(`[festival ${this.roomId}] ${p.name} joined (${this.clients.length} online)`);
  }

  onDispose() {
    serverStats.rooms--;
    this.stopVendorUpdates?.();
    this.stopLayoutUpdates?.();
    this.stopCampUpdates?.();
  }

  onLeave(client) {
    const p = this.state.players.get(client.sessionId);
    if (this.state.players.has(client.sessionId)) serverStats.players--;
    this.state.players.delete(client.sessionId);
    this.inputs.delete(client.sessionId);
    this.emotes.delete(client.sessionId);
    this.quests.leave(client.sessionId);
    this.chat.leave(client.sessionId);
    this.recentChat.delete(client.sessionId);
    const accountId = this.accountOf.get(client.sessionId);
    this.accountOf.delete(client.sessionId);
    if (accountId && online.get(accountId) === client) online.delete(accountId);
    console.log(`[festival ${this.roomId}] ${p?.name ?? client.sessionId} left (${this.clients.length} online)`);
  }
}
