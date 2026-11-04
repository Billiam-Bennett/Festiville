// Look after player accounts from the command line (works while the game server is running).
//
//   npm run account -- list                              every account, with badges and unlocks
//   npm run account -- info <username>
//   npm run account -- unlock <username> <look>          give a premium look (e.g. bigvegas)
//   npm run account -- lock <username> <look>            take it away again
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
import { AccountStore } from "../server/accounts.js";
import { CHARACTERS, lookById } from "../shared/characters.js";
import { ACCESSORIES, accessoryById } from "../shared/accessories.js";
import { ModerationStore, REASONS, untilText } from "../server/moderation.js";

const [cmd, username, arg, ...rest] = process.argv.slice(2);
const mod = new ModerationStore();
const store = new AccountStore();
const fail = (msg) => { console.error(msg); process.exit(1); };
const flags = (a) => [a.role === "admin" && "ORGANIZER", a.role === "mod" && "STAFF", store.isMuted(a) && `muted ${untilText(a.mutedUntil)}`, store.isBanned(a) && `BANNED ${untilText(a.bannedUntil)}`].filter(Boolean).join(", ");
const show = (a) => console.log(`${a.username.padEnd(18)} badges: ${a.badges.join(", ") || "-"}   unlocked: ${a.unlocks.join(", ") || "-"}   last look: ${a.look || "-"}   joined: ${a.createdAt.slice(0, 10)}${flags(a) ? "   [" + flags(a) + "]" : ""}`);
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
    // Works for premium characters AND premium accessories (hats, wings, …).
    const item = lookById(arg) || accessoryById(arg);
    if (!item) fail(`No character or accessory called "${arg}".\n  Characters: ${CHARACTERS.filter((c) => c.tier === "premium").map((c) => c.id).join(", ")}\n  Accessories: ${ACCESSORIES.filter((a) => a.tier === "premium").map((a) => a.id).join(", ")}`);
    if (item.tier !== "premium") fail(`${item.name} is already free for everyone.`);
    store[cmd](username, item.id);
    console.log(`${cmd === "unlock" ? "Unlocked" : "Locked"} ${item.name} for ${username}. They'll see it next time they join.`);
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
  default:
    console.log("Usage: npm run account -- list | info <user> | unlock <user> <look> | lock <user> <look> | reset-password <user> <password> | sign-out <user>");
    console.log("       roles: make-admin <user> | make-mod <user> | remove-admin / remove-mod <user>");
    console.log("       moderation: mute <user> <minutes|forever> | unmute <user> | ban <user> <days|forever> [reason] | unban <user> | reports | close-report <id> | history <user>");
}
