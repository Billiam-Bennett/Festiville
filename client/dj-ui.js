// DJ music on the stages, in the browser: the music itself (played from the DJ's own SoundCloud /
// Mixcloud / YouTube link, never stored by FestiVille), loud at the stage and fading with distance;
// the 🔇 mute button (always there) and a volume slider; the "now playing" card with the DJ's name
// linking to their page; the signs over the stages; the 🎧 panel for DJs (sign up, link a mix, end
// your set) and for staff (stop a set, approve / remove DJs, put waiting mixes on, the record).
// The server decides everything (server/dj.js); this shows it and asks.
import { DJ_TERMS, GENRES, genreById, loudest, PROVIDERS } from "../shared/dj.js";
import { genreName } from "../shared/layout.js";
import { LAYOUT } from "../shared/venue.js";

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids.filter((k) => k != null && k !== "")); return e; };
const link = (href, text) => (/^https:\/\//.test(href) ? el("a", { href, target: "_blank", rel: "noopener noreferrer", textContent: text }) : el("span", { textContent: text }));
const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const store = { get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };

// ---------- The three players ----------
// Each provider's own embed and JavaScript API. volume is 0..1. SoundCloud and YouTube can fade;
// Mixcloud's widget has no volume control, so a Mixcloud set plays at full volume in earshot of the
// stage and pauses when you walk out of it (or mute).
const scripts = new Map();
function loadScript(src) {
  if (!scripts.has(src)) scripts.set(src, new Promise((ok, fail) => { const s = document.createElement("script"); s.src = src; s.async = true; s.onload = ok; s.onerror = fail; document.head.append(s); }));
  return scripts.get(src);
}
let ytReady = null;
const youTubeApi = () => (ytReady ??= new Promise((ok) => {
  if (window.YT?.Player) return ok();
  const prev = window.onYouTubeIframeAPIReady;
  window.onYouTubeIframeAPIReady = () => { prev?.(); ok(); };
  loadScript("https://www.youtube.com/iframe_api");
}));

function makePlayer(host, set, offsetSec) {
  host.replaceChildren();
  const p = { set, volume: 0, ready: false, dead: false, apply() {}, play() {}, stop() { p.dead = true; host.replaceChildren(); } };
  const frame = (src, h) => {
    const f = el("iframe", { src, title: `${set.title} by ${set.dj.name}`, allow: "autoplay; encrypted-media", loading: "eager" });
    f.style.height = `${h}px`;
    host.append(f);
    return f;
  };
  if (set.provider === "soundcloud") {
    const f = frame(`https://w.soundcloud.com/player/?url=${encodeURIComponent(set.url)}&auto_play=true&visual=false&show_comments=false&hide_related=true&show_teaser=false`, 116);
    loadScript("https://w.soundcloud.com/player/api.js").then(() => {
      if (p.dead) return;
      const w = window.SC.Widget(f);
      w.bind(window.SC.Widget.Events.READY, () => {
        if (p.dead) return;
        p.ready = true;
        p.apply = (v) => w.setVolume(Math.round(v * 100));
        p.play = () => w.play();
        p.apply(p.volume);
        if (offsetSec > 2) w.seekTo(offsetSec * 1000);
        w.play();
      });
    }).catch(() => {});
  } else if (set.provider === "youtube") {
    // YouTube's player stays visible (their rules for embedded players), in the card.
    const div = el("div");
    host.append(div);
    youTubeApi().then(() => {
      if (p.dead) return;
      const yt = new window.YT.Player(div, {
        width: 240, height: 200, videoId: set.mixId,
        playerVars: { autoplay: 1, start: Math.floor(offsetSec), playsinline: 1, rel: 0, modestbranding: 1 },
        events: { onReady: (e) => {
          if (p.dead) return;
          p.ready = true;
          p.apply = (v) => { e.target.setVolume(Math.round(v * 100)); if (v > 0 && e.target.isMuted()) e.target.unMute(); };
          p.play = () => e.target.playVideo();
          p.apply(p.volume);
          e.target.playVideo();
        } },
      });
      const old = p.stop;
      p.stop = () => { try { yt.destroy(); } catch {} old(); };
    });
  } else if (set.provider === "mixcloud") {
    const f = frame(`https://www.mixcloud.com/widget/iframe/?feed=${encodeURIComponent(set.mixId)}&hide_cover=1&mini=1&light=0&autoplay=1`, 60);
    loadScript("https://widget.mixcloud.com/media/js/widgetApi.js").then(() => {
      if (p.dead) return;
      const w = window.Mixcloud.PlayerWidget(f);
      w.ready.then(() => {
        if (p.dead) return;
        p.ready = true;
        let playing = null;
        p.apply = (v) => { const on = v > 0.04; if (on !== playing) { playing = on; on ? w.play() : w.pause(); } };
        p.play = () => { playing = true; w.play(); };
        if (offsetSec > 2) w.seek(offsetSec);
        p.apply(p.volume);
      });
    }).catch(() => {});
  }
  return p;
}

export function setupDj({ mp, me, toast, account, festival }) {
  const room = mp.room;
  let data = { now: Date.now(), rules: {}, stages: [], me: null, staff: null };
  let offset = 0;                                   // server clock minus ours, so everyone hears the same moment
  const serverNow = () => Date.now() + offset;
  const stageItem = (id) => LAYOUT.items.find((i) => i.type === "stage" && i.id === id);

  // ---------- Volume ----------
  let master = Math.min(1, Math.max(0, Number(store.get("fv-volume", "0.8")) || 0));
  let muted = store.get("fv-mute", "0") === "1";
  const muteBtn = $("mute-btn");
  muteBtn.hidden = false;
  const paintMute = () => {
    muteBtn.textContent = muted || master === 0 ? "🔇" : "🔊";
    muteBtn.setAttribute("aria-pressed", String(muted));
    muteBtn.title = muted ? "Music is muted. Tap to hear the stages." : "Mute the stage music";
    $("np-mute").textContent = muted ? "🔇 Unmute" : "🔊 Mute";
    $("np-vol").value = String(Math.round(master * 100));
  };
  muteBtn.onclick = () => { muted = !muted; store.set("fv-mute", muted ? "1" : "0"); paintMute(); tickAudio(true); };
  $("np-mute").onclick = muteBtn.onclick;
  $("np-vol").oninput = (e) => { master = Number(e.target.value) / 100; store.set("fv-volume", String(master)); if (master > 0 && muted) { muted = false; store.set("fv-mute", "0"); } paintMute(); tickAudio(true); };
  $("np-play").onclick = () => player?.play();
  paintMute();

  // ---------- What's playing where ----------
  room.onMessage("dj", (m) => {
    data = m;
    offset = (m.now ?? Date.now()) - Date.now();
    paintSigns();
    tickAudio(true);
    if (!$("dj").hidden) renderPanel();
    $("dj-btn").classList.toggle("alert", !!m.staff?.pending?.length);
  });
  room.send("dj");

  function paintSigns() {
    for (const st of data.stages) {
      const sign = festival.stageSigns?.get(st.id);
      if (!sign) continue;
      const title = `${st.label} · ${genreName(st.genre)}`;
      if (st.playing) sign.set(title, `Now: ${st.playing.dj.name} · ${st.playing.title}`);
      else if (st.next[0]) sign.set(title, `Next: ${st.next[0].dj.name} at ${clock(st.next[0].startsAt)}`);
      else sign.set(title, "No set on right now");
    }
  }

  // ---------- The music ----------
  // One stream at a time: the loudest stage you're in earshot of. It starts at the right point in
  // the set (so everyone hears the same moment), fades as you walk away, and is dropped a few seconds
  // after you're out of earshot.
  let player = null, quietFor = 0, since = 0;
  function tickAudio(force = false) {
    const p = me();
    if (!p) return;
    const sets = data.stages.filter((s) => s.playing && stageItem(s.id)).map((s) => {
      const it = stageItem(s.id);
      return { ...s.playing, stageId: s.id, stageLabel: s.label, stageGenre: s.genre, stage: { x: it.x, z: it.z, variant: it.variant } };
    });
    const best = loudest(p, sets);
    const ended = (set) => set.endsAt && serverNow() >= set.endsAt;
    if (best && !ended(best.set) && player?.set.id !== best.set.id) {
      player?.stop();
      player = makePlayer($("np-player"), best.set, Math.max(0, (serverNow() - best.set.startsAt) / 1000));
      showCard(best.set);
    }
    if (player && (!sets.some((s) => s.id === player.set.id) || ended(player.set))) { player.stop(); player = null; }
    if (!player) { $("now-playing").hidden = true; return; }
    const v = best && best.set.id === player.set.id ? best.volume : 0;
    quietFor = v > 0 ? 0 : quietFor + 0.25;
    if (quietFor > 6) { player.stop(); player = null; $("now-playing").hidden = true; return; }
    const want = muted ? 0 : v * master;
    if (force || Math.abs(want - player.volume) > 0.015) { player.volume = want; if (player.ready) player.apply(want); }
    $("now-playing").classList.toggle("far", v < 0.15);
  }

  function showCard(set) {
    $("np-stage").textContent = `🎧 ${set.stageLabel} · ${genreName(set.stageGenre)}`;
    $("np-who").replaceChildren(link(set.dj.link, set.dj.name), el("span", { textContent: ` · ${set.title}` }));
    $("np-src").replaceChildren(link(set.url, `on ${PROVIDERS[set.provider] ?? set.provider} ↗`));
    $("np-note").textContent = set.provider === "mixcloud" ? "Mixcloud sets can't fade, so this plays near the stage and stops when you walk away." : "";
    const stop = $("np-stop");
    stop.hidden = !data.staff;
    stop.onclick = () => {
      const reason = prompt(`Stop ${set.dj.name}'s set? Say why (for the record):`, "");
      if (reason !== null) room.send("djMod", { action: "stop", target: set.id, reason });
    };
    $("now-playing").hidden = false;
  }

  // ---------- The 🎧 panel ----------
  $("dj-btn").hidden = false;
  $("dj-btn").onclick = () => { if ($("dj").hidden) { room.send("dj"); $("dj").hidden = false; renderPanel(); } else $("dj").hidden = true; };
  $("dj-close").onclick = () => ($("dj").hidden = true);
  addEventListener("keydown", (e) => { if (e.code === "Escape") $("dj").hidden = true; });

  const field = (label, input) => el("label", { className: "field" }, el("span", { className: "field-label", textContent: label }), input);
  const h = (text) => el("h3", { className: "shop-h", textContent: text });
  const small = (text) => el("p", { className: "small", textContent: text });
  const ruleText = (r) => [
    r.signup === "open" ? "any member can DJ" : "approved DJs only",
    r.order === "schedule" ? "DJs pick a time" : r.order === "organizer" ? "staff put sets on" : "first come, first served",
    r.setMinutes ? `${r.setMinutes}-minute sets` : "sets run until ended",
  ].join(" · ");

  function renderPanel() {
    const body = $("dj-body");
    const out = [];
    // What's on now, on every stage.
    out.push(h("On the stages now"));
    for (const st of data.stages) {
      const now = st.playing;
      out.push(el("div", { className: "shop-row" },
        el("div", {}, el("b", { textContent: `${st.label} · ${genreName(st.genre)}` }),
          el("div", { className: "small" }, now ? link(now.dj.link, now.dj.name) : "No set on right now", now ? ` · ${now.title}` : "",
            st.next.length ? ` · next: ${st.next.map((n) => `${n.dj.name} ${clock(n.startsAt)}`).join(", ")}` : "")),
        now && data.staff ? el("button", { type: "button", className: "btn-sm btn-ghost", textContent: "Stop set", onclick: () => { const r = prompt("Why stop this set? (for the record)", ""); if (r !== null) room.send("djMod", { action: "stop", target: now.id, reason: r }); } }) : ""));
    }

    // Your DJ side.
    const mine = data.me;
    out.push(h("Play your music here"));
    if (!mine?.dj || editing) out.push(...signupForm(mine?.dj));
    else {
      const d = mine.dj;
      out.push(el("p", {}, el("b", { textContent: d.name }), " · ", link(d.link, "your page"), el("span", { className: "small", textContent: d.removed ? " · removed by staff" : d.approved || data.rules.signup === "open" ? " · ready to play" : " · waiting for staff to approve you" }),
        " ", el("button", { type: "button", className: "linkbtn", textContent: "Edit", onclick: () => { editing = true; renderPanel(); } })));
      for (const s of mine.sets) {
        const when = s.status === "pending" ? "waiting for staff" : s.startsAt <= serverNow() ? "playing now" : `on at ${clock(s.startsAt)}`;
        out.push(el("div", { className: "shop-row" }, el("div", {}, el("b", { textContent: s.title }), el("div", { className: "small", textContent: `${data.stages.find((x) => x.id === s.stage)?.label ?? s.stage} · ${when}` })),
          el("button", { type: "button", className: "btn-sm btn-ghost", textContent: s.startsAt <= serverNow() && s.status === "booked" ? "End my set" : "Cancel", onclick: () => room.send("djEnd", { set: s.id }) })));
      }
      if (mine.canLink && !mine.sets.length) out.push(...linkForm());
      else if (!mine.canLink) out.push(el("p", { className: "blocked", textContent: mine.why }));
    }
    out.push(small(`How sets work right now: ${ruleText(data.rules)}.`));

    if (data.staff) out.push(...staffSection(data.staff));
    body.replaceChildren(...out);
  }
  let editing = false;

  function signupForm(d) {
    const name = el("input", { type: "text", maxLength: 24, value: d?.name ?? account?.username ?? "", autocomplete: "off" });
    const page = el("input", { type: "url", maxLength: 200, value: d?.link ?? "", placeholder: "https://soundcloud.com/you" });
    const own = el("input", { type: "checkbox" });
    const go = el("button", { type: "button", textContent: d ? "Save" : "Sign up as a DJ" });
    go.onclick = () => { editing = false; room.send("djSignup", { name: name.value, link: page.value, own: own.checked }); };
    return [
      small("DJs play for free, for exposure: link a mix you already have on SoundCloud, Mixcloud or YouTube, and it plays on a stage for everyone nearby. Your name links to your page, so people who like your set can find you."),
      field("DJ name", name), field("Link to your own page (so listeners can find you)", page),
      el("label", { className: "field check" }, own, el("span", { className: "small", textContent: DJ_TERMS })),
      el("div", { className: "row" }, go, d ? el("button", { type: "button", className: "btn-ghost", textContent: "Cancel", onclick: () => { editing = false; renderPanel(); } }) : ""),
    ];
  }

  function linkForm() {
    const stage = el("select");
    for (const st of data.stages) stage.append(el("option", { value: st.id, textContent: `${st.label} · ${genreName(st.genre)}` }));
    const genre = el("select");
    for (const g of GENRES) genre.append(el("option", { value: g.id, textContent: g.name }));
    const syncGenre = () => { const g = data.stages.find((s) => s.id === stage.value)?.genre; if (genreById(g)) genre.value = g; };
    stage.onchange = syncGenre; syncGenre();
    const title = el("input", { type: "text", maxLength: 60, placeholder: "Sunset set, live from my bedroom" });
    const url = el("input", { type: "url", maxLength: 200, placeholder: "https://soundcloud.com/you/your-mix" });
    const when = el("input", { type: "datetime-local" });
    const go = el("button", { type: "button", textContent: data.rules.order === "organizer" ? "Send it to staff" : "Put it on" });
    go.onclick = () => room.send("djLink", { stage: stage.value, genre: genre.value, title: title.value, url: url.value, startsAt: when.value ? new Date(when.value).getTime() + offset : 0 });   // your clock → the server's
    return [
      h("Link a mix"),
      field("Stage", stage), field("Genre of your mix (it has to match the stage)", genre),
      field("Title", title), field("Link (SoundCloud, Mixcloud or YouTube)", url),
      data.rules.order === "schedule" ? field("Start time", when) : "",
      small("Only your own music or your own mixes. Staff can stop a set at any time, and every link is kept on record with your account."),
      go,
    ];
  }

  function staffSection(s) {
    const out = [h("Staff")];
    if (s.pending.length) {
      out.push(small("Mixes waiting to go on:"));
      for (const p of s.pending) out.push(el("div", { className: "shop-row" },
        el("div", {}, el("b", { textContent: `${p.dj.name} · ${p.title}` }), el("div", { className: "small" }, link(p.url, p.url), ` · ${data.stages.find((x) => x.id === p.stage)?.label ?? p.stage}`)),
        el("button", { type: "button", className: "btn-sm", textContent: "Put on", onclick: () => room.send("djMod", { action: "approveSet", target: p.id }) })));
    }
    if (s.djs.length) out.push(small("DJs:"));
    for (const d of s.djs) {
      const act = (action, label, ask) => el("button", { type: "button", className: "btn-sm btn-ghost", textContent: label, onclick: () => {
        const reason = ask ? prompt(`${label} ${d.name}? Say why (for the record):`, "") : "";
        if (reason !== null) room.send("djMod", { action, target: d.id, reason });
      } });
      out.push(el("div", { className: "shop-row" },
        el("div", {}, el("b", { textContent: d.name }), el("div", { className: "small" }, `${d.account} · `, link(d.link, "page"), d.removed ? " · removed" : d.approved ? " · approved" : " · not approved yet")),
        el("div", { className: "row" }, ...(d.removed ? [act("restore", "Restore")] : [d.approved ? "" : act("approve", "Approve"), act("remove", "Remove", true)]))));
    }
    if (s.log.length) {
      out.push(small("The record (newest first):"));
      out.push(el("ol", { className: "dj-log" }, ...s.log.slice(0, 12).map((l) => el("li", { className: "small", textContent: `${new Date(l.at).toLocaleString()} · ${l.by}: ${l.action}${l.dj ? ` ${l.dj.name}` : ""}${l.url ? ` · ${l.url}` : ""}${l.reason ? ` · "${l.reason}"` : ""}` }))));
    }
    return out;
  }

  // ---------- Every frame ----------
  function update(dt) {
    since += dt;
    if (since < 0.25) return;
    since = 0;
    tickAudio();
    paintSignsIfDue();
  }
  // The "now / next" on the signs changes on the clock too, not only when the server says so.
  let lastMinute = 0;
  function paintSignsIfDue() { const m = Math.floor(serverNow() / 30_000); if (m !== lastMinute) { lastMinute = m; paintSigns(); } }

  return { update };
}
