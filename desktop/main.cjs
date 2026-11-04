// FestiVille as a desktop app: the game in its own window, with the game server running inside it.
//
// Set it up once with "Install FestiVille app.bat" (in the festiville folder), then double-click the
// FestiVille icon on the desktop. Closing the last window stops the server. If a FestiVille server is
// already running on this computer (say, `npm start` in a terminal), the app just opens the game and
// leaves that server alone.
//
// The server's messages go to data/server.log (FestiVille menu → Server log).
//
// (CommonJS on purpose: Electron freezes on startup if an ES-module main file awaits app.whenReady().)
const { createWriteStream, mkdirSync, appendFileSync } = require("node:fs");
const { join, dirname } = require("node:path");

// Startup trace (data/app-start.log): one line per step, written straight away, so if the app ever
// gets stuck on some computer we can see exactly where.
const TRACE = join(__dirname, "..", "data", "app-start.log");
function trace(msg) {
  try { mkdirSync(dirname(TRACE), { recursive: true }); appendFileSync(TRACE, `${new Date().toISOString()} [pid ${process.pid}] ${msg}\n`); } catch {}
}
trace(`starting: Electron ${process.versions.electron}, Node ${process.versions.node}, args ${JSON.stringify(process.argv.slice(1))}`);

const { app, BrowserWindow, Menu, shell, dialog } = require("electron");
const { pathToFileURL } = require("node:url");
const { networkInterfaces } = require("node:os");
const { format } = require("node:util");

const here = __dirname;
const root = join(here, "..");
const PORT = Number(process.env.PORT) || 2567;
const ORIGIN = `http://localhost:${PORT}`;
const ICON = join(here, process.platform === "win32" ? "festiville.ico" : "icon.png");
const LOG = join(process.env.FV_DATA_DIR || join(root, "data"), "server.log");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = "true";   // the game is served from this computer over http
app.setName("FestiVille");
if (process.platform === "win32") app.setAppUserModelId("com.festiville.desktop");

let mode = "starting";        // "embedded": the server runs inside this app; "existing": someone else's
let ready = false;            // server finished starting
let extraPlayers = 0;

// ---------- The game server ----------
async function serverUp() {
  try { return (await fetch(`${ORIGIN}/api/health`, { signal: AbortSignal.timeout(1500) })).ok; }
  catch { return false; }
}

async function startServer() {
  if (await serverUp()) {
    console.log(`A FestiVille server is already running on port ${PORT}; using it.`);
    return "existing";
  }
  console.log("Starting the FestiVille server inside the app...");
  await import(pathToFileURL(join(root, "server", "index.js")).href);
  for (let i = 0; i < 120; i++) {           // up to 30 seconds
    if (await serverUp()) return "embedded";
    await sleep(250);
  }
  throw new Error("The game server didn't answer after 30 seconds.");
}

function explain(err) {
  const msg = String(err?.message ?? err);
  if (err?.code === "EADDRINUSE") return `Another program is already using port ${PORT}, so the game server can't start.\n\nClose whatever is using it (an old FestiVille server window?) and open FestiVille again.`;
  if (/Cannot find (package|module)/i.test(msg)) return `Some of the game's parts aren't installed.\n\nRun "Install FestiVille app.bat" in the festiville folder again.\n\n(${msg})`;
  return `${msg}\n\nThe server log may say more: ${LOG}`;
}

let crashShown = false;
function onCrash(err) {
  console.error("[crash]", err);
  trace(`error: ${err?.stack || err}`);
  if (!ready) {                           // still starting: nothing works yet, so say why and stop
    if (crashShown) return;
    crashShown = true;
    dialog.showErrorBox("FestiVille couldn't start", explain(err));
    app.exit(1);
  }
  // Once running, keep going (like a server would after logging the error); it's in the log.
}

// ---------- Windows ----------
// separate: a window signed in as a different player (its own storage), for testing with two accounts.
function openWindow(path = "/client/", { separate = false, partition } = {}) {
  partition ??= separate ? `player-${++extraPlayers}` : "persist:festiville";
  const win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 360, minHeight: 520,
    backgroundColor: "#140c1e", icon: ICON, title: separate ? `FestiVille (player ${extraPlayers + 1})` : "FestiVille",
    webPreferences: { partition, contextIsolation: true, sandbox: true },
  });
  if (separate) win.on("page-title-updated", (e) => e.preventDefault());   // keep "player 2" in the title
  if (path) win.loadURL(ORIGIN + path);
  else win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(LOADING));

  // Links to the game open in another app window; anything else (vendor websites) in the normal browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(ORIGIN + "/")) { const u = new URL(url); openWindow(u.pathname + u.search, { partition }); }
    else if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (url.startsWith(ORIGIN + "/")) return;
    e.preventDefault();
    if (/^https?:/i.test(url)) shell.openExternal(url);
  });
  return win;
}

const LOADING = `<!doctype html><html><body style="margin:0;height:100vh;display:grid;place-items:center;background:#140c1e;color:#fff;font:600 18px system-ui">
<div style="text-align:center"><div style="font-size:42px;font-weight:800">Festi<span style="color:#ff4fa3">Ville</span></div><p style="opacity:.75">Starting the festival…</p></div></body></html>`;

// ---------- Menu ----------
function buildMenu() {
  const restartLabel = mode === "existing" ? "Restart server (it's running in another window)" : "Restart server";
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: "FestiVille", submenu: [
      { label: "New window", accelerator: "CmdOrCtrl+N", enabled: ready, click: () => openWindow() },
      { label: "New window as another player", accelerator: "CmdOrCtrl+Shift+N", enabled: ready, click: () => openWindow("/client/", { separate: true }) },
      { type: "separator" },
      { label: "Festival builder", enabled: ready, click: () => openWindow("/client/builder.html") },
      { label: "Open in my web browser", enabled: ready, click: () => shell.openExternal(ORIGIN + "/client/") },
      { label: "Play on a phone (same Wi-Fi)…", enabled: ready, click: phoneInfo },
      { type: "separator" },
      { label: "Server log", click: () => shell.openPath(LOG) },
      { label: restartLabel, enabled: ready && mode === "embedded", click: () => { app.relaunch(); app.exit(0); } },
      { type: "separator" },
      { role: "quit", label: "Quit FestiVille" },
    ] },
    { label: "View", submenu: [
      { role: "reload" }, { role: "togglefullscreen" }, { type: "separator" },
      { role: "zoomIn" }, { role: "zoomOut" }, { role: "resetZoom" }, { type: "separator" },
      { role: "toggleDevTools", label: "Developer tools" },
    ] },
  ]));
}

function phoneInfo() {
  const ips = Object.values(networkInterfaces()).flat()
    .filter((n) => n && n.family === "IPv4" && !n.internal).map((n) => `http://${n.address}:${PORT}`);
  dialog.showMessageBox({
    type: "info", title: "Play on a phone", message: "On a phone connected to the same Wi-Fi, open:",
    detail: (ips.length ? ips.join("\n") : "(This computer isn't on a network right now.)") +
      "\n\nIf the phone can't connect, Windows Firewall may be blocking it: allow \"Electron\" on private networks.",
  });
}

// ---------- Log file ----------
function startLog() {
  try {
    mkdirSync(dirname(LOG), { recursive: true });
    const out = createWriteStream(LOG, { flags: "w" });
    for (const level of ["log", "info", "warn", "error"]) {
      const orig = console[level].bind(console);
      console[level] = (...args) => {
        out.write(`[${new Date().toLocaleTimeString()}] ${format(...args)}\n`);
        try { orig(...args); } catch {}
      };
    }
  } catch {}
}

// ---------- Start ----------
// Settings and sign-ins for the app live here. (A new folder name from the first version, which could
// freeze in the background and would otherwise block this one from opening until a restart.)
app.setPath("userData", join(app.getPath("appData"), "FestiVille App"));
const gotLock = app.requestSingleInstanceLock();
trace(`single-instance lock: ${gotLock ? "got it" : "another copy is open, handing over to it"}`);
if (!gotLock) {
  app.quit();                 // already open: the running copy opens a new window instead (below)
} else {
  startLog();
  console.log(`FestiVille app ${app.getVersion()} (Electron ${process.versions.electron})`);
  process.on("uncaughtException", onCrash);
  process.on("unhandledRejection", onCrash);
  app.on("second-instance", () => { if (ready) openWindow(); });
  app.on("window-all-closed", () => app.quit());
  app.on("child-process-gone", (_e, d) => trace(`child process gone: ${d.type} ${d.reason} (exit ${d.exitCode})`));
  app.on("render-process-gone", (_e, _w, d) => trace(`page process gone: ${d.reason} (exit ${d.exitCode})`));
  const waiting = setTimeout(() => trace("still waiting for Electron to be ready after 15 s"), 15_000);
  app.whenReady().then(() => { clearTimeout(waiting); trace("Electron ready"); return boot(); });
}

async function boot() {
  buildMenu();
  const first = openWindow(null);
  trace("window opened");
  try {
    mode = await startServer();
    trace(`game server up (${mode})`);
    ready = true;
    buildMenu();
    if (!first.isDestroyed()) first.loadURL(ORIGIN + "/client/");
  } catch (err) {
    console.error(err);
    trace(`couldn't start: ${err?.stack || err}`);
    dialog.showErrorBox("FestiVille couldn't start", explain(err));
    app.exit(1);
  }
}
