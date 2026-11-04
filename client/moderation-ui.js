// Reporting players, and staff tools on the player card.
//   Everyone: tap a player → Report → pick a reason → Send. Staff see it (with that player's recent chat).
//   Staff (accounts made staff with `npm run account -- make-mod <name>` or make-admin): mute, kick and ban buttons
//   on the player card. The server checks you're staff before doing anything; hiding buttons here is
//   only for tidiness.
export function setupModeration({ mp, quests, chat, account }) {
  const room = mp.room;
  const $ = (id) => document.getElementById(id);
  // Staff = "mod" (festival staff) or "admin" (organizer). The STAFF tag the server puts on our own
  // player is the live answer (it updates if someone runs make-mod while we're playing).
  const isStaff = () => room.state.players.get(room.sessionId)?.staff ?? (account?.role === "mod" || account?.role === "admin");
  let target = "", reason = "";

  // ---------- Report ----------
  $("pc-report").onclick = () => {
    target = $("player-card").dataset.player || "";
    const p = room.state.players.get(target);
    if (!p) return;
    $("rp-title").textContent = `Report ${p.name}`;
    reason = "";
    for (const b of $("rp-reasons").children) b.setAttribute("aria-pressed", "false");
    $("rp-note").value = "";
    $("rp-mute").checked = true;
    $("rp-send").disabled = true;
    $("player-card").hidden = true;
    $("report").hidden = false;
  };
  for (const b of $("rp-reasons").children) {
    b.onclick = () => {
      reason = b.dataset.reason;
      for (const o of $("rp-reasons").children) o.setAttribute("aria-pressed", String(o === b));
      $("rp-send").disabled = false;
    };
  }
  const closeReport = () => ($("report").hidden = true);
  $("rp-close").onclick = closeReport;
  $("rp-send").onclick = () => {
    if (!reason || !target) return;
    room.send("report", { target, reason, note: $("rp-note").value.trim() });
    if ($("rp-mute").checked) chat.mute(target);
    closeReport();
  };
  for (const id of ["rp-note", "pc-why"]) $(id).addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.target.blur(); closeReport(); $("player-card").hidden = true; }
    e.stopPropagation();   // typing shouldn't walk, dance or open the map
  });

  // ---------- Staff tools ----------
  let armed = null, armedAt = 0;
  for (const b of $("pc-staff").querySelectorAll("button[data-act]")) {
    const label = b.textContent;
    b.onclick = () => {
      const id = $("player-card").dataset.player;
      const bans = b.dataset.act.startsWith("ban") || b.dataset.act === "kick";
      // Bans and kicks need a second tap, so a slip of the thumb doesn't remove someone.
      if (bans && (armed !== b || Date.now() - armedAt > 3000)) {
        if (armed) armed.textContent = armed.dataset.label;
        armed = b; armedAt = Date.now();
        b.dataset.label = label;
        b.textContent = "Tap again";
        setTimeout(() => { if (armed === b) { b.textContent = label; armed = null; } }, 3000);
        return;
      }
      if (armed) { armed.textContent = armed.dataset.label; armed = null; }
      room.send("mod", { target: id, action: b.dataset.act, reason: $("pc-why").value.trim() });
      $("pc-why").value = "";
      $("player-card").hidden = true;
    };
  }

  // Report button and staff row depend on who the card is showing.
  function update() {
    if ($("player-card").hidden) return;
    const id = $("player-card").dataset.player;
    const p = room.state.players.get(id);
    const self = id === room.sessionId;
    $("pc-report").hidden = self || !!p?.staff;
    $("pc-staff").hidden = !isStaff() || self || !p || p.staff;
  }

  // Refresh as soon as the card opens or switches player, not just on the next frame.
  new MutationObserver(update).observe($("player-card"), { attributes: true, attributeFilter: ["hidden", "data-player"] });

  return { update, isStaff };
}
