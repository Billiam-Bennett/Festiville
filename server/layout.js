// The saved festival layout (what the festival builder edits), in data/layout.json.
// On startup the server applies it to shared/venue.js, so vendors, quests and the maps all follow it.
// Every save keeps the previous version in data/layout-history/ (the newest 30), so a bad edit can be undone:
//   npm run layout -- history        list saved versions
//   npm run layout -- restore <file> put one back
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, readdirSync, unlinkSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { sanitizeLayout, defaultLayout } from "../shared/layout.js";
import { applyLayout } from "../shared/venue.js";
import { GIVERS, AMBIENT } from "../shared/quests-data.js";

const DEFAULT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
const KEEP = 30;
export const layoutRules = () => ({ knownRefs: [...GIVERS, ...AMBIENT].map((p) => p.id), requiredRefs: GIVERS.map((g) => g.id) });

export class LayoutStore {
  constructor({ dir = process.env.FV_DATA_DIR || DEFAULT_DIR, now = () => Date.now() } = {}) {
    this.dir = dir;
    this.file = join(dir, "layout.json");
    this.historyDir = join(dir, "layout-history");
    this.now = now;
    this.listeners = new Set();
    this.load();
  }

  load() {
    let saved = null;
    if (existsSync(this.file)) {
      try { saved = JSON.parse(readFileSync(this.file, "utf8")); }
      catch (err) { console.error(`Couldn't read ${this.file} (${err.message}); using the starting layout.`); }
    }
    const out = saved ? sanitizeLayout(saved.layout, layoutRules()) : null;
    this.layout = out?.layout ?? defaultLayout();
    this.updatedAt = saved?.updatedAt ?? null;
    this.updatedBy = saved?.updatedBy ?? null;
    applyLayout(this.layout);
    this.seen = this.mtime();
  }
  mtime() { try { return statSync(this.file).mtimeMs; } catch { return 0; } }
  refresh() { if (this.mtime() !== this.seen) { this.load(); this.emit(); } }

  current() { this.refresh(); return { layout: this.layout, updatedAt: this.updatedAt, updatedBy: this.updatedBy }; }

  // Returns { layout, warnings, updatedAt } or { error }.
  save(raw, by = "console") {
    const out = sanitizeLayout(raw, layoutRules());
    if (out.error) return out;
    mkdirSync(this.historyDir, { recursive: true });
    if (existsSync(this.file)) {
      const stamp = new Date(this.now()).toISOString().replace(/[:.]/g, "-");
      writeFileSync(join(this.historyDir, `layout-${stamp}.json`), readFileSync(this.file));
      const old = readdirSync(this.historyDir).filter((f) => f.endsWith(".json")).sort();
      for (const f of old.slice(0, Math.max(0, old.length - KEEP))) unlinkSync(join(this.historyDir, f));
    }
    this.layout = out.layout;
    this.updatedAt = new Date(this.now()).toISOString();
    this.updatedBy = by;
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ updatedAt: this.updatedAt, updatedBy: by, layout: this.layout }, null, 1));
    renameSync(tmp, this.file);
    this.seen = this.mtime();
    applyLayout(this.layout);
    this.emit();
    return { layout: this.layout, warnings: out.warnings, updatedAt: this.updatedAt };
  }

  history() { try { return readdirSync(this.historyDir).filter((f) => f.endsWith(".json")).sort().reverse(); } catch { return []; } }
  restore(name, by = "console") {
    if (!/^layout-[\w-]+\.json$/.test(name) || !existsSync(join(this.historyDir, name))) return { error: `No saved version called ${name}.` };
    return this.save(JSON.parse(readFileSync(join(this.historyDir, name), "utf8")).layout, by);
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { for (const fn of this.listeners) { try { fn(this.current()); } catch (err) { console.error(err); } } }
}

let shared = null;
export const layoutStore = () => (shared ??= new LayoutStore());
