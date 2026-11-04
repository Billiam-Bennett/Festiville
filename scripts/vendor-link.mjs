// Make (or cancel) a vendor's private edit link.
//
//   npm run vendor-link -- --list                         show every stall id
//   npm run vendor-link -- hippiedips                     new edit link for Hippie Dips
//   npm run vendor-link -- hippiedips --base https://play.festiville.com
//   npm run vendor-link -- hippiedips --revoke            old link stops working, no new one
//
// Each new link replaces the previous one for that stall. Send the link to the vendor privately:
// anyone who has it can edit that stall's listing. Works while the game server is running.
import { VendorStore } from "../server/vendors.js";
import { VENDORS, ZONE_LABELS } from "../shared/venue.js";

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, name.startsWith("--base") ? 2 : 1)[1] ?? true : null; };
const base = (flag("--base") || process.env.FV_PUBLIC_URL || "http://localhost:2567").replace(/\/+$/, "");
const revoke = flag("--revoke");
const list = flag("--list");
const id = args[0];

if (list || !id) {
  console.log("Stalls:");
  for (const v of VENDORS) console.log(`  ${v.id.padEnd(14)} ${v.name.padEnd(22)} ${ZONE_LABELS[v.zone]}`);
  if (!id) console.log("\nUsage: npm run vendor-link -- <stall id> [--base https://your-site] [--revoke]");
  process.exit(0);
}

const store = new VendorStore();
if (!store.has(id)) {
  console.error(`No stall with id "${id}". Run: npm run vendor-link -- --list`);
  process.exit(1);
}
const v = VENDORS.find((x) => x.id === id);
if (revoke) {
  store.revokeKey(id);
  console.log(`Edit link for ${v.name} cancelled.`);
} else {
  const key = store.issueKey(id);
  // The key goes after "#", so browsers never send it to any server in the address or as a referrer.
  console.log(`Edit link for ${v.name} (any older link for this stall no longer works):\n`);
  console.log(`  ${base}/client/vendor.html?v=${encodeURIComponent(id)}#key=${key}\n`);
  console.log("Send it to the vendor privately. Anyone with this link can edit this stall's listing.");
}
