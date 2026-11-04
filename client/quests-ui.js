// Everything players see for crews and side quests:
// quest givers with "!" markers, the Talk button, quest offers, the quest tracker,
// glowing pickups and beacons, crewmate rings, invites, badges on name tags, and toasts.
// The server decides everything; this file only shows it and sends requests.
import { GIVERS, QUESTS, TALK_RANGE, AMBIENT, giverById, dist } from "../shared/quests-data.js";

const CREW_COLOR = 0x4fe3ff;

export function setupQuests({ THREE, scene, camera, renderer, mp, makeAvatar }) {
  const room = mp.room;
  const myId = room.sessionId;
  const $ = (id) => document.getElementById(id);
  const players = () => room.state.players;
  const me = () => players().get(myId);
  const crewOf = (p) => (p?.crewId ? room.state.crews.get(p.crewId) : null);
  const membersOf = (crew) => (crew?.members ? crew.members.split(",").filter(Boolean) : []);
  const nameOf = (id) => players().get(id)?.name ?? "Someone";

  // ---------- Quest givers ----------
  const givers = GIVERS.map((g) => {
    const obj = makeAvatar({ name: g.name, look: g.look, recipe: g.recipe });
    obj.position.set(g.x, 0, g.z);
    obj.rotation.y = g.rotY ?? Math.atan2(-g.x, -g.z);   // as turned in the builder, else face the middle
    obj.userData.setTag?.(g.name, g.role);
    const mark = textSprite(THREE, "!", "#ffd36b");
    mark.position.y = 2.75;
    obj.add(mark);
    scene.add(obj);
    return { ...g, obj, mark };
  });

  // ---------- Ambient NPCs ----------
  // Silent characters scattered around to make the world feel lived-in. They just idle in place;
  // the DJ dances.
  const ambient = AMBIENT.filter((a) => !a.hidden).map((a) => {
    const obj = makeAvatar({ name: a.name, look: a.look, recipe: a.recipe });
    obj.position.set(a.x, 0, a.z);
    obj.rotation.y = a.rotY ?? Math.atan2(-a.x, -a.z);
    obj.userData.setTag?.(a.name, a.role);
    scene.add(obj);
    return { ...a, obj };
  });

  // ---------- Server messages ----------
  room.onMessage("toast", (m) => toast(m.text, m.error ? "error" : ""));
  room.onMessage("questStart", (m) => toast(m.by === me()?.name ? `Quest started: ${m.name}` : `${m.by} started ${m.name} for the crew!`));
  room.onMessage("questDone", (m) => {
    if (m.success) toast(`Quest complete: ${m.name}! You earned the ${m.badge} badge.`, "big", 6000);
    else toast(m.text || `${m.name} ended.`, "error", 6000);
  });
  room.onMessage("offer", showOffer);
  room.onMessage("invite", (m) => {
    $("iv-text").textContent = `${m.fromName} invited you to their crew`;
    show("invite");
    clearTimeout(showInviteTimer);
    showInviteTimer = setTimeout(() => ($("invite").hidden = true), 30000);
  });
  let showInviteTimer = 0;

  // ---------- Buttons ----------
  let offerGiver = "";
  $("of-start").onclick = () => { room.send("startQuest", offerGiver); $("offer").hidden = true; };
  $("of-close").onclick = () => ($("offer").hidden = true);
  $("iv-yes").onclick = () => { room.send("inviteReply", true); $("invite").hidden = true; };
  $("iv-no").onclick = () => { room.send("inviteReply", false); $("invite").hidden = true; };
  $("crew-leave").onclick = () => room.send("leaveCrew");
  let cardPlayer = "";
  $("pc-invite").onclick = () => { room.send("invite", cardPlayer); $("player-card").hidden = true; };
  $("pc-close").onclick = () => ($("player-card").hidden = true);
  let quitArmed = 0;
  $("tr-quit").onclick = () => {
    if (Date.now() - quitArmed < 3000) { room.send("abandonQuest"); $("tr-quit").textContent = "Quit quest"; quitArmed = 0; return; }
    quitArmed = Date.now();
    $("tr-quit").textContent = "Tap again to quit";
    setTimeout(() => ($("tr-quit").textContent = "Quit quest"), 3000);
  };
  let promptGiver = null;
  $("prompt").onclick = () => promptGiver && room.send("talk", promptGiver.id);
  addEventListener("keydown", (e) => {
    if (e.code === "KeyT" && promptGiver && document.activeElement?.tagName !== "INPUT") room.send("talk", promptGiver.id);
    if (e.code === "Escape") for (const id of ["offer", "player-card", "vendor", "report"]) $(id).hidden = true;
  });

  function show(id) {
    for (const s of ["offer", "player-card", "vendor", "report"]) if (s !== id) $(s).hidden = true;
    $(id).hidden = false;
  }

  function showOffer(m) {
    offerGiver = m.giverId;
    $("of-who").textContent = `${m.giverName} · ${giverById(m.giverId)?.role ?? ""}`;
    $("of-name").textContent = m.name;
    $("of-pitch").textContent = `"${m.pitch}"`;
    $("of-how").textContent = m.howTo;
    $("of-badge").textContent = m.done ? `You already have the ${m.badge} badge. Play it again anytime.` : `Reward: the ${m.badge} badge on your name tag.`;
    $("of-blocked").textContent = m.blocked;
    $("of-blocked").hidden = !m.blocked;
    $("of-start").disabled = !!m.blocked;
    $("of-start").textContent = m.crewSize > 1 ? `Start with crew (${m.crewSize})` : "Start solo";
    show("offer");
  }

  // ---------- Tap a player (or a quest giver) ----------
  let down = null;
  renderer.domElement.addEventListener("pointerdown", (e) => (down = { x: e.clientX, y: e.clientY, t: performance.now() }));
  renderer.domElement.addEventListener("pointerup", (e) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 12 || performance.now() - down.t > 500) return;
    const hit = pick(e.clientX, e.clientY);
    if (!hit) return;
    e.fvHandled = true;   // so the stall tap handler (venue-ui.js) doesn't also fire
    if (hit.giver) {
      const p = me();
      if (p && dist(p, hit.giver) <= TALK_RANGE) room.send("talk", hit.giver.id);
      else toast(`Walk over to ${hit.giver.name} to talk.`);
      return;
    }
    const p = players().get(hit.id);
    if (!p) return;
    cardPlayer = hit.id;
    $("player-card").dataset.player = hit.id;   // chat-ui.js reads this for the Mute button
    $("pc-name").textContent = p.name;
    $("pc-badges").textContent = p.badges ? `Badges: ${p.badges.split(",").join(", ")}` : "No badges yet.";
    const sameCrew = p.crewId && p.crewId === me()?.crewId;
    $("pc-invite").disabled = sameCrew;
    $("pc-invite").textContent = sameCrew ? "Already in your crew" : "Invite to crew";
    show("player-card");
  });

  const v = new THREE.Vector3();
  function pick(sx, sy) {
    let best = null, bestD = 70;
    const consider = (obj, info) => {
      if (!obj) return;
      v.copy(obj.position); v.y += 1.1; v.project(camera);
      if (v.z > 1) return;
      const d = Math.hypot((v.x + 1) / 2 * innerWidth - sx, (1 - v.y) / 2 * innerHeight - sy);
      if (d < bestD) { bestD = d; best = info; }
    };
    players().forEach((p, id) => id !== myId && consider(mp.avatarOf(id), { id }));
    for (const g of givers) consider(g.obj, { giver: g });
    return best;
  }

  // ---------- Quest visuals in the world ----------
  const questGroup = new THREE.Group();
  scene.add(questGroup);
  let questJson = null, quest = null, spinners = [], soundRings = null;
  const carried = new Map();   // player id -> taco box mesh

  function rebuildQuestVisuals(json) {
    questGroup.clear();
    spinners = []; soundRings = null;
    quest = json ? JSON.parse(json) : null;
    if (!quest) return;
    if (quest.id === "lostfound") {
      if (quest.stage === "return") questGroup.add(beacon(THREE, giverById("juniper"), 0xffd36b));
      for (const it of quest.items) {
        if (it.found) continue;
        const piece = new THREE.Mesh(new THREE.OctahedronGeometry(0.45), new THREE.MeshStandardMaterial({ color: 0xff4fa3, emissive: 0xff4fa3, emissiveIntensity: 0.8 }));
        piece.position.set(it.x, 1.1, it.z);
        questGroup.add(piece, beacon(THREE, it, 0xff4fa3));
        spinners.push(piece);
      }
    }
    if (quest.id === "soundcheck") {
      const { markers, markerRadius } = QUESTS.soundcheck;
      soundRings = {};
      for (const key of ["main", "side"]) {
        const m = markers[key];
        const ring = new THREE.Mesh(new THREE.RingGeometry(markerRadius - 0.35, markerRadius, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
        ring.rotation.x = -Math.PI / 2; ring.position.set(m.x, 0.05, m.z);
        const b = beacon(THREE, m, 0x4fc3ff);
        questGroup.add(ring, b);
        soundRings[key] = ring;
      }
    }
    if (quest.id === "vendorrush") {
      const mine = quest.orders.find((o) => o.state === "carried" && o.carrier === myId);
      if (mine) questGroup.add(beacon(THREE, mine, 0x7dff6b));
      else if (quest.orders.some((o) => o.state === "waiting")) questGroup.add(beacon(THREE, giverById("rae"), 0xffd36b));
      for (const o of quest.orders) if (o.state === "carried" && o !== mine) questGroup.add(beacon(THREE, o, 0x7dff6b, 0.35));
    }
  }

  function syncCarried() {
    const carriers = new Set((quest?.orders ?? []).filter((o) => o.state === "carried").map((o) => o.carrier));
    for (const [id, box] of carried) if (!carriers.has(id)) { box.parent?.remove(box); carried.delete(id); }
    for (const id of carriers) {
      if (carried.has(id)) continue;
      const obj = mp.avatarOf(id);
      if (!obj) continue;
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.18, 0.28), new THREE.MeshStandardMaterial({ color: 0xff9f1c }));
      box.position.set(0, 1.05, 0.32);
      obj.add(box);
      carried.set(id, box);
    }
  }

  // ---------- Crew rings + badges on name tags ----------
  const rings = new Map();   // player id -> ring mesh
  const tagCache = new Map();
  function syncPeople() {
    const myCrew = me()?.crewId;
    const crew = crewOf(me());
    const inRealCrew = membersOf(crew).length > 1;
    players().forEach((p, id) => {
      const obj = mp.avatarOf(id);
      if (!obj) return;
      const want = inRealCrew && p.crewId === myCrew;
      let ring = rings.get(id);
      if (want && (!ring || ring.parent !== obj)) {
        ring = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.58, 32), new THREE.MeshBasicMaterial({ color: CREW_COLOR, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
        ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03;
        obj.add(ring); rings.set(id, ring);
      } else if (!want && ring) { ring.parent?.remove(ring); rings.delete(id); }
      // Include the avatar object itself in the key: when someone changes their look, their avatar is
      // rebuilt into a new object with a blank tag, so we must re-apply the name/badges to it.
      const prev = tagCache.get(id);
      const tagKey = `${p.name}|${p.badges}|${p.staff}`;
      if (!prev || prev.obj !== obj || prev.key !== tagKey) {
        tagCache.set(id, { obj, key: tagKey });
        const badges = p.badges ? "★ " + p.badges.split(",").join(" · ") : "";
        obj.userData.setTag?.(p.name, p.staff ? ["STAFF", badges].filter(Boolean).join(" · ") : badges);
      }
    });
    for (const id of [...rings.keys()]) if (!players().has(id)) rings.delete(id);
  }

  // ---------- HUD panels ----------
  function updatePanels() {
    const p = me();
    const crew = crewOf(p);
    const members = membersOf(crew);
    $("crew").hidden = members.length < 2;
    if (members.length >= 2) {
      const html = members.map((id) => `<li>${esc(nameOf(id))}${id === myId ? " (you)" : ""}${id === crew.leader ? " ★" : ""}</li>`).join("");
      if ($("crew-list").innerHTML !== html) $("crew-list").innerHTML = html;
    }
    const n = p?.badges ? p.badges.split(",").length : 0;
    $("hud-badges").hidden = !n;
    $("hud-badges").textContent = `★ ${n} badge${n === 1 ? "" : "s"}`;

    $("tracker").hidden = !quest;
    if (!quest || !p) return;
    const q = QUESTS[quest.id];
    $("tr-name").textContent = q.name;
    const left = quest.endsAt ? Math.max(0, quest.endsAt - room.state.time) : 0;
    $("tr-timer").textContent = quest.endsAt ? `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, "0")} left` : "";
    const m = (pt) => `${Math.round(dist(p, pt))} m`;
    let obj = "", frac = 0;
    if (quest.id === "lostfound") {
      const found = quest.items.filter((i) => i.found).length;
      frac = found / quest.items.length;
      if (quest.stage === "return") obj = `All pieces found! Bring them back to Juniper · ${m(giverById("juniper"))}`;
      else {
        const next = quest.items.filter((i) => !i.found).sort((a, b) => dist(p, a) - dist(p, b))[0];
        obj = `Find Juniper's totem pieces (${found}/${quest.items.length}). Follow the pink lights. Nearest: ${m(next)}`;
      }
    }
    if (quest.id === "soundcheck") {
      const who = (ids) => (ids.length ? ids.map(nameOf).join(", ") : "nobody yet");
      frac = quest.hold / q.holdSeconds;
      obj = `Stand on the blue rings at the same time.<br>Main stage: ${esc(who(quest.onMain))} · ${m(q.markers.main)}<br>Side stage: ${esc(who(quest.onSide))} · ${m(q.markers.side)}`;
    }
    if (quest.id === "vendorrush") {
      const done = quest.orders.filter((o) => o.state === "delivered").length;
      frac = done / quest.orders.length;
      const mine = quest.orders.find((o) => o.state === "carried" && o.carrier === myId);
      if (mine) obj = `Run your order to the green light in the campground · ${m(mine)}`;
      else if (quest.orders.some((o) => o.state === "waiting")) obj = `Grab an order at Mama Rae's (yellow light) · ${m(giverById("rae"))}`;
      else obj = "Your crew is delivering the last orders!";
      obj += `<br>Delivered: ${done}/${quest.orders.length}`;
    }
    if ($("tr-obj").innerHTML !== obj) $("tr-obj").innerHTML = obj;
    $("tr-bar").style.width = `${Math.round(Math.min(1, frac) * 100)}%`;
  }

  // ---------- Every frame ----------
  let t = 0;
  function update(dt) {
    t += dt;
    const p = me();
    if (!p) return;
    for (const g of givers) {
      g.obj.userData.animate?.(dt, 0, "");
      g.mark.position.y = 2.75 + Math.sin(t * 3) * 0.08;
      const badge = QUESTS[g.quest].badge;
      g.mark.visible = !(p.badges || "").split(",").includes(badge);
    }
    for (const a of ambient) a.obj.userData.animate?.(dt, 0, a.id === "dj" ? "dance" : "");
    const json = crewOf(p)?.quest || "";
    if (json !== questJson) { questJson = json; rebuildQuestVisuals(json); }
    for (const s of spinners) { s.rotation.y += dt * 2; s.position.y = 1.1 + Math.sin(t * 2) * 0.15; }
    if (soundRings && quest) {
      soundRings.main.material.color.set(quest.onMain.length ? 0x7dff6b : 0xffffff);
      soundRings.side.material.color.set(quest.onSide.length ? 0x7dff6b : 0xffffff);
    }
    syncCarried();
    syncPeople();

    // Talk prompt for the nearest quest giver in range.
    promptGiver = givers.filter((g) => dist(p, g) <= TALK_RANGE - 0.5).sort((a, b) => dist(p, a) - dist(p, b))[0] ?? null;
    $("prompt").hidden = !promptGiver || !$("offer").hidden;
    if (promptGiver) $("prompt").textContent = `Talk to ${promptGiver.name}`;
    updatePanels();
  }

  // ---------- Toasts ----------
  function toast(text, kind = "", ms = 4000) {
    const el = document.createElement("div");
    el.className = `toast card ${kind}`;
    el.textContent = text;
    $("toasts").appendChild(el);
    while ($("toasts").children.length > 3) $("toasts").firstChild.remove();
    setTimeout(() => { el.style.opacity = "0"; setTimeout(() => el.remove(), 400); }, ms);
  }

  // Where the current quest wants you to go, for the minimap and full map.
  const markers = () => questGroup.children.filter((c) => c.userData.beaconColor).map((c) => ({ x: c.position.x, z: c.position.z, color: c.userData.beaconColor }));

  return { update, toast, markers };
}

// A tall see-through light column so objectives are easy to spot from across the grounds.
function beacon(THREE, at, color, opacity = 0.28) {
  const g = new THREE.Group();
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.35, 0.35, 40, 12, 1, true),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide }),
  );
  beam.position.y = 20;
  const base = new THREE.Mesh(
    new THREE.RingGeometry(0.9, 1.2, 32),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: Math.min(1, opacity * 3), side: THREE.DoubleSide, depthWrite: false }),
  );
  base.rotation.x = -Math.PI / 2; base.position.y = 0.04;
  g.add(beam, base);
  g.position.set(at.x, 0, at.z);
  if (opacity >= 0.28) g.userData.beaconColor = "#" + new THREE.Color(color).getHexString();   // faint ones (crewmates' orders) stay off the map
  return g;
}

function textSprite(THREE, text, color) {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const x = c.getContext("2d");
  x.fillStyle = color;
  x.beginPath(); x.arc(64, 64, 56, 0, Math.PI * 2); x.fill();
  x.fillStyle = "#2a1a05";
  x.font = "bold 88px system-ui, sans-serif";
  x.textAlign = "center"; x.textBaseline = "middle";
  x.fillText(text, 64, 70);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  s.scale.set(0.45, 0.45, 1);
  return s;
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
