// Look after player accounts from the command line (works while the game server is running).
//
//   npm run account -- list                              every account, with badges and unlocks
//   npm run account -- info <username>
//   npm run account -- unlock <username> <look>          give a premium look (e.g. bigvegas), accessory
//                                                        (e.g. wings) or character part (e.g. hair_afro)
//   npm run account -- lock <username> <look>            take it away again
//   npm run account -- unlock <username> premium         make them a premium member: the 20×20 camp spot
//                                                        and the premium camp bundle (lock … premium undoes it)
//   npm run account -- unlock <username> golfcart        give one account a golf cart
//   npm run account -- credits <username>                balance and recent credit history
//   npm run account -- credits <username> +500 [note]    give credits (e.g. they bought a pack); -200 takes some away
//   npm run account -- camp-release <username>           take back their camp spot (no refund)
//   npm run account -- reset-password <username> <new password>   also signs them out everywhere
//   npm run account -- sign-out <username>               end all their sign-ins
//
// Moderation:
//   npm run account -- make-admin <username>             festival organizer: staff tools + the festival builder
//   npm run account -- make-mod <username>               festival staff: mute/kick/ban from the player card
//   npm run account -- remove-mod <username>
//   npm run account -- mute <username> <minutes|forever>
//   npm run account -- unmute <username>
//   npm run account -- ban <username> <days|forever> [reason...]   also kicks them out if they're playing
//   npm run account -- unban <username>
//   npm run account -- reports                           open reports, with the reported player's chat
//   npm run account -- close-report <report id>
//   npm run account -- history <username>                reports about them and staff actions on them
//
// DJs and stage music (server/dj.js):
//   npm run account -- dj-rules                          show the DJ rules
//   npm run account -- dj-rules signup=open order=schedule set=45
//                                                        change them: signup=approved|open, order=first-come|schedule|organizer,
//                                                        set=<minutes per set> (0 = until the DJ or staff end it)
//   npm run account -- dj-list                           every DJ, and what's on each stage
//   npm run account -- dj-approve <username>             let a DJ link mixes (when signup=approved)
//   npm run account -- dj-remove <username> [reason]     stop their sets; they can't link mixes again until restored
//   npm run account -- dj-restore <username>
//   npm run account -- dj-stop <stage id> [reason]       stop what's playing on a stage (e.g. stage_main)
//   npm run account -- dj-log [username]                 the record: who linked what, and every stop and removal
import { AccountStore } from "../server/accounts.js";
import { CHARACTERS } from "../shared/characters.js";
import { ACCESSORIES } from "../shared/accessories.js";
import { PARTS } from "../shared/parts.js";
import { unlockableById } from "../server/shop.js";
import { CampStore } from "../server/camps.js";
import { PREMIUM_MEMBERSHIP, MEMBERSHIP, GOLF_CART } from "../shared/economy.js";
import { ModerationStore, REASONS, untilText } from "../server/moderation.js";
import { DjStore } from "../server/dj.js";
import { LayoutStore } from "../server/layout.js";
import { stages } from "../shared/venue.js";
import { genreName } from "../shared/layout.js";

const [cmd, username, arg, ...rest] = process.argv.slice(2);
const mod = new ModerationStore();
const store = new AccountStore();
const fail = (msg) => { console.error(msg); process.exit(1); };
const flags = (a) => [a.role === "admin" && "ORGANIZER", a.role === "mod" && "STAFF", store.isMuted(a) && `muted ${untilText(a.mutedUntil)}`, store.isBanned(a) && `BANNED ${untilText(a.bannedUntil)}`].filter(Boolean).join(", ");
const show = (a) => console.log(`${a.username.padEnd(18)} badges: ${a.badges.join(", ") || "-"}   unlocked: ${a.unlocks.join(", ") || "-"}   credits: ${store.balance(a)}   last look: ${a.recipe ? "parts " + a.recipe : a.look || "-"}   joined: ${a.createdAt.slice(0, 10)}${flags(a) ? "   [" + flags(a) + "]" : ""}`);
// "30" -> 30 (minutes or days), "forever" -> 0
const amount = (v, what) => {
  if (v === "forever") return 0;
  const n = Number(v);
  if (!(n > 0)) fail(`Give a number of ${what}, or "forever".`);
  return n;
};
const printReport = (r) => {
  console.log(`\n${r.id}  ${r.at.slice(0, 16).replace("T", " ")} UTC  ${r.status.toUpperCase()}${r.outcome ? " (" + r.outcome + ")" : ""}`);
  console.log(`  ${r.reporter.name} reported ${r.target.name}: ${REASONS[r.reason] ?? r.reason}${r.note ? ` — "${r.note}"` : ""}`);
  if (r.chat.length) for (const l of r.chat) console.log(`    ${l.at.slice(11, 16)} [${l.channel}] ${r.target.name}: ${l.text}`);
  else console.log("    (no recent chat from them)");
};
const need = () => store.findByName(username) ?? fail(`No account called "${username}".`);

switch (cmd) {
  case "list": {
    const all = Object.values(store.accounts);
    all.forEach(show);
    console.log(`${all.length} account${all.length === 1 ? "" : "s"}`);
    break;
  }
  case "info": show(need()); break;
  case "unlock":
  case "lock": {
    need();
    if (arg === PREMIUM_MEMBERSHIP) {
      store[cmd](username, PREMIUM_MEMBERSHIP);
      console.log(cmd === "unlock" ? `${username} is now a premium member (${MEMBERSHIP.name}): they can claim or upgrade to the 20×20 camp spot, with the premium camp bundle.`
        : `${username} is no longer a premium member. Their camp stays as it is until they change it.`);
      break;
    }
    if (arg === GOLF_CART.id) {
      store[cmd](username, GOLF_CART.id);
      console.log(cmd === "unlock" ? `${username} now has a golf cart, parked at their camp.` : `${username}'s golf cart was taken back${GOLF_CART.premium ? " (premium members still have the one that comes with membership)" : ""}.`);
      break;
    }
    // Works for premium characters, accessories (hats, wings, …) and character parts (hair, clothes, …).
    const item = unlockableById(arg);
    if (!item) fail(`No character, accessory or part called "${arg}".\n  Characters: ${CHARACTERS.filter((c) => c.tier === "premium").map((c) => c.id).join(", ")}\n  Accessories: ${ACCESSORIES.filter((a) => a.tier === "premium").map((a) => a.id).join(", ")}\n  Parts: ${PARTS.filter((p) => p.tier === "premium").map((p) => p.id).join(", ")}`);
    if (item.tier !== "premium") fail(`${item.name} is already free for everyone.`);
    store[cmd](username, item.id);
    console.log(`${cmd === "unlock" ? "Unlocked" : "Locked"} ${item.name} for ${username}. They'll see it next time they join.`);
    break;
  }
  case "credits": {
    const a = need();
    if (arg) {
      if (!/^[+-]\d+$/.test(arg)) fail('Give an amount like +500 or -200.');
      const out = store.changeCredits(a.id, Number(arg), `console${rest.length ? ": " + rest.join(" ") : ""}`);
      if (out.error) fail(out.error);
      console.log(`${a.username} now has ${out.balance} credits. They'll see it next time they open the 🪙 Shop.`);
    } else {
      console.log(`${a.username} has ${store.balance(a)} credits.`);
      for (const l of store.ledgerFor(a.id)) console.log(`  ${l.at.slice(0, 16).replace("T", " ")} UTC  ${l.delta > 0 ? "+" : ""}${l.delta}  → ${l.balance}   ${l.reason}`);
    }
    break;
  }
  case "camp-release": {
    const a = need();
    if (!new CampStore().release(a.id)) fail(`${a.username} doesn't have a camp.`);
    console.log(`Released ${a.username}'s camp spot. It disappears from the festival within a few seconds.`);
    break;
  }
  case "reset-password": {
    need();
    const out = await store.setPassword(username, arg ?? "");
    if (out.error) fail(out.error);
    console.log(`New password set for ${username}, and they've been signed out everywhere.`);
    break;
  }
  case "sign-out": store.signOutEverywhere(need().id); console.log(`${username} is signed out everywhere.`); break;
  case "make-mod":
  case "make-admin":
  case "remove-mod":
  case "remove-admin":
    need(); store.setRole(username, cmd === "make-mod" ? "mod" : cmd === "make-admin" ? "admin" : "");
    console.log(cmd === "make-admin" ? `${username} is now a festival organizer: staff tools in the game, and the festival builder (/client/builder.html).`
      : cmd === "make-mod" ? `${username} is now festival staff. They'll see staff tools on the player card within a few seconds (or after rejoining).`
      : `${username} is now a regular player.`);
    break;
  case "mute":
  case "ban": {
    const a = need();
    const n = amount(arg, cmd === "mute" ? "minutes" : "days");
    const minutes = cmd === "mute" ? n : n * 24 * 60;
    const reason = rest.join(" ");
    const until = store.restrict(a.id, cmd, minutes, reason);
    mod.record({ by: "console", target: { id: a.id, name: a.username }, action: cmd, minutes, reason });
    console.log(`${cmd === "mute" ? "Muted" : "Banned"} ${a.username} ${untilText(until)}.${cmd === "ban" ? " If they're playing, they'll be removed within 5 seconds." : ""}`);
    break;
  }
  case "unmute":
  case "unban": {
    const a = need();
    store.restrict(a.id, cmd === "unmute" ? "mute" : "ban", -1);
    mod.record({ by: "console", target: { id: a.id, name: a.username }, action: cmd });
    console.log(`${cmd === "unmute" ? "Unmuted" : "Unbanned"} ${a.username}.`);
    break;
  }
  case "reports": {
    const open = mod.open();
    open.forEach(printReport);
    console.log(`\n${open.length} open report${open.length === 1 ? "" : "s"}. Close one with: npm run account -- close-report <id>`);
    break;
  }
  case "close-report":
    if (!mod.close(username, "console", "no action")) fail(`No report with id "${username}".`);
    console.log(`Closed ${username}.`);
    break;
  case "history": {
    const a = need();
    show(a);
    mod.forTarget(a.id).forEach(printReport);
    const acts = mod.log.filter((l) => l.target.id === a.id);
    if (acts.length) console.log("\nStaff actions:");
    for (const l of acts) console.log(`  ${l.at.slice(0, 16).replace("T", " ")} UTC  ${l.by}: ${l.action}${l.minutes ? ` (${l.minutes} min)` : ""}${l.reason ? ` — ${l.reason}` : ""}`);
    break;
  }
  case "dj-rules": {
    const dj = new DjStore();
    const patch = {};
    for (const kv of [username, arg, ...rest].filter(Boolean)) {
      const [k, v] = kv.split("=");
      if (k === "signup" || k === "order") patch[k] = v;
      else if (k === "set") patch.setMinutes = Number(v);
      else fail(`Unknown rule "${kv}". Use signup=approved|open, order=first-come|schedule|organizer, set=<minutes>.`);
    }
    const r = Object.keys(patch).length ? dj.setRules(patch, "console") : dj.rules();
    console.log(`Who can DJ: ${r.signup === "open" ? "any member who signs up" : "DJs that staff approve"}`);
    console.log(`Who picks the order: ${r.order === "schedule" ? "DJs pick a free time" : r.order === "organizer" ? "staff put mixes on" : "first come, first served"}`);
    console.log(`Set length: ${r.setMinutes ? `${r.setMinutes} minutes` : "until the DJ or staff end it"}`);
    if (Object.keys(patch).length) console.log("Saved. The game picks this up within a few seconds.");
    break;
  }
  case "dj-list": {
    const dj = new DjStore();
    new LayoutStore();
    for (const d of Object.values(dj.djs)) console.log(`${d.name.padEnd(20)} ${d.account.padEnd(16)} ${d.removed ? "REMOVED" : d.approved ? "approved" : "not approved"}   ${d.link}`);
    if (!Object.keys(dj.djs).length) console.log("No DJs have signed up yet.");
    console.log("");
    for (const st of stages()) {
      const cur = dj.current(st.id);
      console.log(`${st.id.padEnd(14)} ${st.label} (${genreName(st.genre)}): ${cur ? `${cur.djName} · ${cur.title} · ${cur.url}` : "nothing on"}`);
      for (const n of dj.upNext(st.id)) console.log(`${"".padEnd(14)}   next: ${n.djName} · ${n.title} at ${new Date(n.startsAt).toISOString().slice(0, 16).replace("T", " ")} UTC`);
    }
    break;
  }
  case "dj-approve":
  case "dj-remove":
  case "dj-restore": {
    const a = need();
    const dj = new DjStore();
    const out = cmd === "dj-approve" ? dj.approveDj(a.id, "console") : cmd === "dj-remove" ? dj.removeDj(a.id, "console", [arg, ...rest].filter(Boolean).join(" ")) : dj.restoreDj(a.id, "console");
    if (out.error) fail(out.error);
    if (cmd === "dj-remove") mod.record({ by: "console", target: { id: a.id, name: a.username }, action: "dj-remove", reason: [arg, ...rest].filter(Boolean).join(" ") });
    console.log(cmd === "dj-approve" ? `${a.username} can link mixes now.` : cmd === "dj-remove" ? `Removed ${a.username} as a DJ${out.stopped ? ` and stopped ${out.stopped} set${out.stopped === 1 ? "" : "s"}` : ""}.` : `${a.username} can DJ again.`);
    break;
  }
  case "dj-stop": {
    const dj = new DjStore();
    new LayoutStore();
    const out = dj.stop(username ?? "", "console", [arg, ...rest].filter(Boolean).join(" "));
    if (out.error) fail(`${out.error} Stages: ${stages().map((s) => s.id).join(", ")}`);
    console.log(`Stopped ${out.set.djName}'s set (${out.set.url}). Players stop hearing it within a few seconds.`);
    break;
  }
  case "dj-log": {
    const dj = new DjStore();
    const a = username ? need() : null;
    const lines = a ? dj.logFor(a.id) : dj.log.slice(-50);
    for (const l of lines) console.log(`${l.at.slice(0, 16).replace("T", " ")} UTC  ${l.by}: ${l.action}${l.dj ? ` ${l.dj.name}` : ""}${l.stage ? ` on ${l.stage}` : ""}${l.url ? `  ${l.url}` : ""}${l.reason ? `  "${l.reason}"` : ""}`);
    if (!lines.length) console.log("Nothing on record yet.");
    break;
  }
  default:
    console.log("Usage: npm run account -- list | info <user> | unlock <user> <look> | lock <user> <look> | reset-password <user> <password> | sign-out <user>");
    console.log("       credits: credits <user> [+N|-N] [note] | camp-release <user>");
    console.log("       roles: make-admin <user> | make-mod <user> | remove-admin / remove-mod <user>");
    console.log("       moderation: mute <user> <minutes|forever> | unmute <user> | ban <user> <days|forever> [reason] | unban <user> | reports | close-report <id> | history <user>");
    console.log("       DJs: dj-rules [signup=… order=… set=…] | dj-list | dj-approve / dj-remove / dj-restore <user> | dj-stop <stage id> [reason] | dj-log [user]");
}
