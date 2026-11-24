// Headless crowd benchmark: runs client/bench.html in Chromium for a few crowd sizes and prints a table.
//
//   npm run bench                          # 50 / 100 / 200 avatars, crowd view
//   npm run bench -- --n 200 --view all    # one size, everything in view
//   npm run bench -- --json bench.json     # also save the raw numbers
//   npm run bench -- --shot out/ --lineup "female;0;top=top_sweater:0;bottom=bottom_skirt:0|…" --focus legs
//                                          # screenshot a lineup instead (see client/bench.js for options)
//
// Needs Playwright with Chromium (preinstalled in the cloud dev container; else `npx playwright install chromium`).
// There's no GPU in CI containers, so WebGL runs on SwiftShader (CPU): absolute FPS is far below a real
// device, but before/after comparisons on the same machine are meaningful. three.js is served from
// node_modules instead of the CDN so the run works offline.
import http from "node:http";
import { createRequire } from "node:module";
import { readFile, mkdir } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { serveStatic } from "../server/static.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf("--" + k); return i >= 0 ? args[i + 1] : d; };
const sizes = String(opt("n", "50,100,200")).split(",").map(Number);
const view = opt("view", "crowd");
const seconds = opt("seconds", "6");
const extra = opt("query", "");
const shotDir = opt("shot", null);

const server = http.createServer(async (req, res) => { if (!(await serveStatic(req, res))) res.writeHead(404).end(); });
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}/client/`;

const browser = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-precise-memory-info"],
});

async function open(query, viewport = { width: 1280, height: 720 }) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errors.push(`${m.type()}: ${m.text()}`); });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  await page.route(/cdn\.jsdelivr\.net\/npm\/three@[^/]+\/(.*)$/, async (route) => {
    const rel = route.request().url().replace(/^.*\/npm\/three@[^/]+\//, "");
    try {
      route.fulfill({ body: await readFile(join(root, "node_modules/three", rel)), contentType: "text/javascript" });
    } catch { route.abort(); }
  });
  await page.goto(base + "bench.html?" + query);
  await page.waitForFunction(() => window.__bench?.done, null, { timeout: 600_000 });
  return { page, errors, result: await page.evaluate(() => window.__bench) };
}

if (opt("lineup", null)) {
  const q = new URLSearchParams({ lineup: opt("lineup"), pose: opt("pose", "idle"), at: opt("at", "0.4"),
    cam: opt("cam", "front"), focus: opt("focus", "full") });
  const { page, errors, result } = await open(q.toString() + (extra ? "&" + extra : ""), { width: Number(opt("w", 900)), height: Number(opt("h", 700)) });
  const file = join(shotDir ?? ".", opt("name", "lineup") + ".png");
  await mkdir(dirname(file), { recursive: true });
  await page.screenshot({ path: file });
  console.log("saved", file);
  if (result.error) console.log(result.error);
  if (result.layers?.length && args.includes("--layers")) console.log(result.layers.join("\n"));
  if (errors.length) console.log(errors.join("\n"));
} else {
  const rows = [];
  for (const n of sizes) {
    const { page, errors, result } = await open(`n=${n}&view=${view}&seconds=${seconds}${extra ? "&" + extra : ""}`);
    result.consoleErrors = errors.length;
    rows.push(result);
    if (shotDir) { await mkdir(shotDir, { recursive: true }); await page.screenshot({ path: join(shotDir, `crowd-${view}-${n}.png`) }); }
    if (errors.length) console.log(`n=${n}:`, errors.slice(0, 5).join("\n  "));
    await page.close();
  }
  const cols = ["n", "loadMs", "fps", "frameMsP50", "frameMsP95", "updateMs", "renderMs", "drawCalls", "triangles",
    "visibleAvatars", "lod", "textures", "texMB", "geometries", "geoMB", "programs", "glbFetches", "heapMB", "consoleErrors"];
  console.log(`\nview=${view}${extra ? " " + extra : ""}`);
  console.log("| " + cols.join(" | ") + " |\n|" + cols.map(() => "---").join("|") + "|");
  for (const r of rows) console.log("| " + cols.map((c) => r[c] ?? "").join(" | ") + " |");
  if (opt("json", null)) writeFileSync(opt("json"), JSON.stringify(rows, null, 2));
}
await browser.close();
server.close();
