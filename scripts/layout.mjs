// Manage the festival layout from the command line (works while the server is running).
//
//   npm run layout -- show                    a summary of what's placed
//   npm run layout -- export mylayout.json    save the current layout to a file (a backup, or to edit by hand)
//   npm run layout -- import mylayout.json    load a layout from a file (checked before it's saved)
//   npm run layout -- history                 list saved previous versions
//   npm run layout -- restore <file>          put a previous version back (from history)
//   npm run layout -- reset                   go back to the built-in starting layout
// Normally you'll use the visual builder instead: /client/builder.html (sign in as an organizer).
import { readFileSync, writeFileSync } from "node:fs";
import { LayoutStore } from "../server/layout.js";
import { defaultLayout } from "../shared/layout.js";

const [cmd, arg] = process.argv.slice(2);
const store = new LayoutStore();
const fail = (m) => { console.error(m); process.exit(1); };

const summary = (layout) => {
  const by = {};
  for (const it of layout.items) by[it.type] = (by[it.type] ?? 0) + 1;
  return Object.entries(by).map(([t, n]) => `${n} ${t}`).join(", ");
};

switch (cmd) {
  case "show": {
    const { layout, updatedAt, updatedBy } = store.current();
    console.log(updatedAt ? `Last saved ${updatedAt} by ${updatedBy}.` : "Using the built-in starting layout.");
    console.log(`${layout.items.length} things: ${summary(layout)}`);
    break;
  }
  case "export": {
    if (!arg) fail("Give a filename, e.g. npm run layout -- export mylayout.json");
    writeFileSync(arg, JSON.stringify(store.current().layout, null, 1));
    console.log(`Wrote ${arg}.`);
    break;
  }
  case "import": {
    if (!arg) fail("Give a filename to import.");
    let data;
    try { data = JSON.parse(readFileSync(arg, "utf8")); } catch (e) { fail(`Couldn't read ${arg}: ${e.message}`); }
    const out = store.save(data.items ? data : data.layout, "console");
    if (out.error) fail(out.error);
    console.log(`Imported ${arg}: ${summary(out.layout)}.`);
    out.warnings.forEach((w) => console.log("  note: " + w));
    break;
  }
  case "history": {
    const h = store.history();
    if (!h.length) { console.log("No saved previous versions yet."); break; }
    h.forEach((f) => console.log("  " + f));
    console.log(`Restore one with: npm run layout -- restore ${h[0]}`);
    break;
  }
  case "restore": {
    if (!arg) fail("Give a version filename (see: npm run layout -- history).");
    const out = store.restore(arg, "console");
    if (out.error) fail(out.error);
    console.log(`Restored ${arg}.`);
    break;
  }
  case "reset": {
    const out = store.save(defaultLayout(), "console");
    console.log(`Reset to the starting layout (${out.layout.items.length} things). The previous one is in history.`);
    break;
  }
  default:
    console.log("Usage: npm run layout -- show | export <file> | import <file> | history | restore <file> | reset");
}
