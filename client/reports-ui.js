// The staff Reports screen: the 🛡️ button (with how many reports are open) and the review panel.
//
// Reports are grouped by the reported player. For each one staff see who reported them and why,
// the player's recent chat (captured by the server, so it can't be faked), anything staff already
// did about them, and buttons to mute, kick, ban, or dismiss. It works on players who are offline
// or in another copy of the festival too (except Kick, which needs them online).
//
// The server re-checks that you're staff for every request; this file only draws things.
import { REASON_LABELS, ACTION_BUTTONS } from "./reports-data.js";

export function setupReports({ mp, quests, isStaff }) {
  const room = mp.room;
  const $ = (id) => document.getElementById(id);
  const btn = $("reports-btn"), panel = $("reports"), list = $("rv-list"), countEl = $("rv-count");
  let count = 0, groups = [], loading = false;

  // ---------- Button + count ----------
  function showButton() {
    btn.hidden = !isStaff();
    btn.querySelector("b").textContent = count > 99 ? "99+" : String(count);
    btn.querySelector("b").hidden = count === 0;
    btn.title = count ? `${count} open report${count === 1 ? "" : "s"}` : "Reports";
    if (!isStaff()) panel.hidden = true;
  }
  room.onMessage("modCount", (m) => {
    const before = count;
    count = Math.max(0, m?.count | 0);
    showButton();
    if (!panel.hidden && count !== before) request();   // new report while looking: refresh the list
  });
  room.onMessage("modQueue", (m) => {
    loading = false;
    groups = Array.isArray(m?.groups) ? m.groups : [];
    count = m?.count | 0;
    showButton();
    render();
  });
  const request = () => { loading = true; room.send("modQueue"); };

  btn.onclick = () => (panel.hidden ? open() : close());
  $("rv-close").onclick = close;
  $("rv-refresh").onclick = request;
  function open() {
    panel.hidden = false;
    list.replaceChildren(el("p", "small", "Loading…"));
    request();
  }
  function close() { panel.hidden = true; }

  // Staff can change while you're playing (`npm run account -- make-mod you`), so check now and then.
  let wasStaff = null;
  setInterval(() => {
    const now = isStaff();
    if (now !== wasStaff) { wasStaff = now; showButton(); if (now) room.send("modCount"); }
  }, 1000);
  showButton();
  if (isStaff()) { wasStaff = true; room.send("modCount"); }

  panel.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.target.blur?.(); close(); }
    e.stopPropagation();   // typing a reason shouldn't walk, dance or open the map
  });

  // ---------- Drawing ----------
  function render() {
    countEl.textContent = count ? `${count} open` : "";
    if (!groups.length) {
      list.replaceChildren(el("div", "rv-empty", [el("b", "", "All clear"), el("p", "small", "No open reports. New ones show up here (and as a toast) the moment they're sent.")]));
      return;
    }
    list.replaceChildren(...groups.map(card));
  }

  function card(g) {
    const art = el("article", "rv-card");
    art.dataset.target = g.target.id;

    // Who, and their status right now.
    const status = [];
    status.push(el("span", g.online ? "pill on" : "pill", g.online ? "Online" : "Offline"));
    if (g.bannedUntil) status.push(el("span", "pill bad", "Banned"));
    else if (g.mutedUntil) status.push(el("span", "pill warn", "Muted"));
    if (g.staff) status.push(el("span", "pill", "Staff"));
    art.append(el("header", "", [
      el("h3", "", g.target.name),
      el("div", "pills", status),
    ]));
    const n = g.reports.length;
    const history = [`${n} open report${n === 1 ? "" : "s"}`];
    if (g.earlierReports) history.push(`${g.earlierReports} earlier`);
    if (g.pastActions?.length) history.push(`staff acted ${g.pastActions.length === 5 ? "5+" : g.pastActions.length} time${g.pastActions.length === 1 ? "" : "s"} before`);
    art.append(el("p", "small", history.join(" · ")));

    // Each report.
    art.append(el("ul", "rv-reports", g.reports.map((r) => el("li", "", [
      el("div", "", [el("b", "", REASON_LABELS[r.reason] ?? r.reason), el("span", "small", ` · by ${r.reporter} · ${ago(r.at)}`)]),
      r.note ? el("q", "", r.note) : null,
    ]))));

    // Their chat (evidence), newest at the bottom.
    const chat = el("details", "rv-chat");
    chat.append(el("summary", "", g.chat?.length ? `Their recent chat (${g.chat.length})` : "Their recent chat (none)"));
    if (g.chat?.length) chat.append(el("ol", "", g.chat.map((l) => el("li", l.channel === "crew" ? "crew" : "", [
      el("span", "small", `${clock(l.at)}${l.channel === "crew" ? " · crew" : ""}`), " ", l.text,
    ]))));
    else chat.append(el("p", "small", "They didn't say anything in chat before being reported."));
    if (g.chat?.length && n <= 3) chat.open = true;
    art.append(chat);

    // What staff already did about them.
    if (g.pastActions?.length) {
      const past = el("details", "rv-past");
      past.append(el("summary", "", "Earlier staff actions"));
      past.append(el("ul", "", g.pastActions.slice().reverse().map((a) => el("li", "small",
        `${ago(a.at)}: ${a.by} ${actionWords(a)}${a.reason ? ` (“${a.reason}”)` : ""}`))));
      art.append(past);
    }

    // Decide.
    if (g.staff) {
      art.append(el("p", "small", "This player is staff now. Staff can't act on staff in the game; use the command line, or dismiss."));
    }
    const why = el("input");
    why.maxLength = 200;
    why.placeholder = "Reason (a banned player sees it)";
    why.autocomplete = "off";
    const row = el("div", "row rv-actions");
    for (const a of ACTION_BUTTONS) {
      if (g.staff && a.id !== "dismiss") continue;
      const b = el("button", `btn-ghost btn-sm${a.danger ? " danger" : ""}${a.id === "dismiss" ? " dismiss" : ""}`, a.label);
      b.type = "button";
      b.dataset.act = a.id;
      if (a.id === "kick" && !g.online) { b.disabled = true; b.title = "They're not online"; }
      if (a.id.startsWith("ban") && g.bannedUntil) { b.disabled = true; b.title = "Already banned"; }
      b.onclick = () => decide(g, a, b, why);
      row.append(b);
    }
    art.append(row, why);
    return art;
  }

  // Bans and kicks need a second tap, so a slip of the thumb doesn't remove someone.
  let armed = null, armedAt = 0;
  function decide(g, a, b, why) {
    if (a.confirm && (armed !== b || Date.now() - armedAt > 3000)) {
      if (armed) armed.textContent = armed.dataset.label;
      armed = b; armedAt = Date.now();
      b.dataset.label = a.label;
      b.textContent = "Tap again";
      setTimeout(() => { if (armed === b) { b.textContent = a.label; armed = null; } }, 3000);
      return;
    }
    if (armed) { armed.textContent = armed.dataset.label; armed = null; }
    for (const x of b.parentElement.children) x.disabled = true;   // until the refreshed list arrives
    room.send("modDecide", { target: g.target.id, action: a.id, reason: why.value.trim() });
  }

  return { open, close, get count() { return count; } };
}

// ---------- Little helpers ----------
function el(tag, cls = "", kids = []) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const k of [].concat(kids)) if (k != null) e.append(k);   // strings become text, never HTML
  return e;
}

function ago(iso) {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (!isFinite(s)) return "";
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

function clock(iso) {
  const d = new Date(iso);
  return isNaN(d) ? "" : d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function actionWords(a) {
  const span = !a.minutes ? "" : a.minutes < 60 ? ` ${a.minutes} min` : a.minutes < 1440 ? ` ${Math.round(a.minutes / 60)} h` : ` ${Math.round(a.minutes / 1440)} d`;
  if (a.action === "mute") return `muted them${span}`;
  if (a.action === "ban") return a.minutes ? `banned them${span}` : "banned them forever";
  if (a.action === "kick") return "kicked them";
  return a.action;
}
