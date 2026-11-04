// Getting around the festival and browsing vendors:
//   • Vendor cards: tap any stall (or walk up and press T / tap "Browse") to see its menu or goods
//     and where they'll be next. "Take me there" drops a waypoint.
//   • Waypoint: a white light column in the world plus a marker (or rim arrow) on the minimap.
//   • Minimap: top-right, centered on you, north up. Tap it (or press M) for the full map.
//   • Full map: the whole festival with labels and a vendor directory. Drag to pan, scroll/pinch to zoom.
//   • Live listings: the server sends every stall's current listing when you join ("vendors") and
//     each edit as a vendor saves it ("vendor"), so menus, schedules and stall signs update in place.
import { VENDORS, ZONE_LABELS, FENCE, vendorById, vendorFront } from "../shared/venue.js";
import { upcoming, formatDates, formatPrice } from "../shared/listings.js";
import { dist } from "../shared/quests-data.js";
import { drawMap, fitCanvas } from "./map.js";

const BROWSE_RANGE = 5;       // meters from a stall's counter to get the "Browse" button
const ARRIVE_RANGE = 3.5;     // meters from a waypoint that count as arriving
const MINIMAP_RADIUS = 45;    // meters shown from the center to the rim of the minimap

export function setupVenue({ THREE, scene, camera, renderer, mp, stalls, rig, quests, myAvatar }) {
  const room = mp.room;
  const myId = room.sessionId;
  const $ = (id) => document.getElementById(id);
  const toast = (...a) => quests?.toast(...a);
  const typing = () => ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName);

  // ---------- Vendor card ----------
  let cardVendor = null;
  function openVendor(v) {
    cardVendor = v;
    for (const id of ["offer", "player-card"]) $(id).hidden = true;
    $("vd-where").textContent = `${ZONE_LABELS[v.zone] ?? ""} · ${v.kind === "food" ? "Food" : "Goods"}`;
    $("vd-name").textContent = v.name;
    $("vd-name").style.setProperty("--swatch", v.color);
    $("vd-tag").textContent = v.tagline ?? "";
    $("vd-menu-h").textContent = v.kind === "food" ? "Menu" : "What they sell";
    $("vd-items").innerHTML = v.items.map((it) =>
      `<li><span>${esc(it.name)}</span>${typeof it.price === "number" ? `<b>${formatPrice(it.price)}</b>` : ""}</li>`).join("");
    const next = upcoming(v.next);
    $("vd-next").innerHTML = next.length
      ? next.map((n) => `<li><b>${esc(formatDates(n.start, n.end))}</b><span>${esc(n.event)}<small>${esc(n.where ?? "")}</small></span></li>`).join("")
      : `<li class="none">${v.link ? "No dates posted here yet. Check their website." : "No dates posted yet."}</li>`;
    const link = /^https?:\/\//i.test(v.link ?? "") ? v.link : "";
    $("vd-link").hidden = !link;
    if (link) $("vd-link").href = link;
    syncGoButton();
    $("vendor").hidden = false;
  }
  const syncGoButton = () => {
    const here = waypoint?.id === cardVendor?.id;
    $("vd-go").textContent = here ? "Clear waypoint" : "Take me there";
    $("vd-go").classList.toggle("btn-ghost", here);
  };
  $("vd-close").onclick = () => ($("vendor").hidden = true);
  $("vd-go").onclick = () => {
    if (!cardVendor) return;
    if (waypoint?.id === cardVendor.id) clearWaypoint();
    else { setWaypoint(cardVendor); $("vendor").hidden = true; closeBigMap(); }
    syncGoButton();
  };

  // ---------- Live listings from the server ----------
  const stallById = new Map(stalls.map((g) => [g.userData.vendorId, g]));
  function applyListing(l) {
    const v = vendorById(l?.id);
    if (!v) return;
    const renamed = v.name !== l.name;
    const truckChanged = JSON.stringify(v.truck ?? null) !== JSON.stringify(l.truck ?? null);
    // Only the editable fields; position, zone and color stay as the layout says.
    Object.assign(v, { name: l.name, tagline: l.tagline, link: l.link, items: l.items ?? [], next: l.next ?? [], truck: l.truck });
    const g = stallById.get(v.id);
    if (g && truckChanged && g.userData.setTruck) { g.userData.setTruck({ name: v.name, color: v.color, truck: v.truck }); refreshFade(g); }   // rebuilds the truck
    else if (renamed) g?.userData.setName?.(v.name);
    if (waypoint?.id === v.id) waypoint.name = v.name;
  }
  room.onMessage("vendors", (list) => { for (const l of list ?? []) applyListing(l); buildDirectory(); });
  room.onMessage("vendor", (l) => {
    applyListing(l);
    buildDirectory();
    if (cardVendor?.id === l?.id && !$("vendor").hidden) { openVendor(cardVendor); toast(`${cardVendor.name} just updated their listing.`); }
  });
  room.send("vendors");   // ask for the current listings now that we're listening

  // ---------- Waypoint ----------
  let waypoint = null;
  const wpBeacon = makeBeacon(THREE);
  function setWaypoint(v) {
    const f = vendorFront(v);
    waypoint = { id: v.id, name: v.name, x: f.x, z: f.z };
    wpBeacon.position.set(f.x, 0, f.z);
    scene.add(wpBeacon);
    toast(`Waypoint set: ${v.name}. Follow the white light.`);
  }
  function clearWaypoint() { waypoint = null; scene.remove(wpBeacon); }

  // ---------- Tap a stall in the world ----------
  const hitBoxes = stalls.map((g) => g.children.find((c) => c.userData.isHitBox)).filter(Boolean);
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let down = null;
  renderer.domElement.addEventListener("pointerdown", (e) => (down = { x: e.clientX, y: e.clientY, t: performance.now() }));
  renderer.domElement.addEventListener("pointerup", (e) => {
    if (e.fvHandled || !down) return;   // quests-ui already handled it (a player or quest giver)
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 12 || performance.now() - down.t > 500) return;
    ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(hitBoxes, false)[0];
    const v = hit && vendorById(hit.object.parent.userData.vendorId);
    if (v) openVendor(v);
  });

  // ---------- "Browse" prompt when you walk up to a stall ----------
  let nearVendor = null;
  $("vprompt").onclick = () => nearVendor && openVendor(nearVendor);
  addEventListener("keydown", (e) => {
    if (typing()) return;
    if (e.code === "KeyT" && nearVendor && !$("vprompt").hidden) openVendor(nearVendor);
    if (e.code === "KeyM") toggleBigMap();
    if (e.code === "Escape") closeBigMap();
  });

  // ---------- Minimap + zoom buttons ----------
  $("minimap-wrap").hidden = false;
  $("minimap").onclick = () => openBigMap();
  $("zoom-in").onclick = () => rig.zoomBy(1 / 1.4);
  $("zoom-out").onclick = () => rig.zoomBy(1.4);
  $("map-btn").onclick = () => toggleBigMap();

  function mapData() {
    const me = myAvatar();
    const myCrew = room.state.players.get(myId)?.crewId;
    const crewSize = myCrew ? (room.state.crews.get(myCrew)?.members.split(",").filter(Boolean).length ?? 0) : 0;
    const players = [];
    room.state.players.forEach((p, id) => {
      if (id === myId) return;
      const obj = mp.avatarOf(id);
      const at = obj?.position ?? p;
      players.push({ x: at.x, z: at.z, crew: crewSize > 1 && p.crewId === myCrew });
    });
    return {
      me: me ? { x: me.position.x, z: me.position.z, rotY: me.rotation.y } : null,
      players, markers: quests?.markers() ?? [], waypoint,
    };
  }

  // ---------- Full map ----------
  const big = { open: false, cx: 0, cz: 0, scale: 3, fit: 3 };
  buildDirectory();
  $("bm-close").onclick = () => closeBigMap();
  $("bm-me").onclick = () => { const m = myAvatar(); if (m) { big.cx = m.position.x; big.cz = m.position.z; big.scale = Math.max(big.scale, 5); } };
  function openBigMap() {
    big.open = true;
    $("bigmap").hidden = false;
    const { w, h } = fitCanvas($("bm-canvas"));
    big.fit = Math.min(w, h) * 0.94 / (FENCE * 2);
    big.scale = big.fit;
    big.cx = 0; big.cz = -28 / big.scale;           // nudge down so the header doesn't cover the north fence
  }
  function closeBigMap() { big.open = false; $("bigmap").hidden = true; }
  function toggleBigMap() { big.open ? closeBigMap() : openBigMap(); }

  // Pan (drag), zoom (wheel / pinch), tap a stall to open it.
  const cv = $("bm-canvas");
  const pts = new Map();
  let gesture = null;
  const clampScale = (s) => Math.min(14, Math.max(big.fit * 0.8, s));
  const toWorld = (sx, sy) => {
    const r = cv.getBoundingClientRect();
    return { x: big.cx + (sx - r.left - r.width / 2) / big.scale, z: big.cz + (sy - r.top - r.height / 2) / big.scale };
  };
  const zoomAt = (sx, sy, s) => {
    const before = toWorld(sx, sy);
    big.scale = clampScale(s);
    const after = toWorld(sx, sy);
    big.cx += before.x - after.x; big.cz += before.z - after.z;
  };
  cv.addEventListener("wheel", (e) => { e.preventDefault(); zoomAt(e.clientX, e.clientY, big.scale * Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
  cv.addEventListener("pointerdown", (e) => {
    cv.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const [a, b] = [...pts.values()];
    gesture = pts.size === 2
      ? { pinch: true, d: Math.hypot(a.x - b.x, a.y - b.y), s: big.scale, moved: true }
      : { x: e.clientX, y: e.clientY, cx: big.cx, cz: big.cz, moved: false };
  });
  cv.addEventListener("pointermove", (e) => {
    if (!pts.has(e.pointerId) || !gesture) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (gesture.pinch && pts.size === 2) {
      const [a, b] = [...pts.values()];
      zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, gesture.s * Math.hypot(a.x - b.x, a.y - b.y) / Math.max(20, gesture.d));
    } else if (!gesture.pinch) {
      const dx = e.clientX - gesture.x, dy = e.clientY - gesture.y;
      if (Math.hypot(dx, dy) > 6) gesture.moved = true;
      big.cx = gesture.cx - dx / big.scale; big.cz = gesture.cz - dy / big.scale;
    }
  });
  const up = (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (gesture && !gesture.moved && pts.size === 0) {
      const w = toWorld(e.clientX, e.clientY);
      const v = VENDORS.map((v) => ({ v, d: dist(v, w) * big.scale })).sort((a, b) => a.d - b.d)[0];
      if (v && v.d < 22) openVendor(v.v);
    }
    if (pts.size === 0) gesture = null;
  };
  cv.addEventListener("pointerup", up);
  cv.addEventListener("pointercancel", up);

  function buildDirectory() {
    // One section per area that has stalls, in layout order; food-heavy areas get the noodle icon.
    const zones = [...new Set(VENDORS.map((v) => v.zone))];
    const groups = zones.map((z) => [z, VENDORS.filter((v) => v.zone === z && v.kind === "food").length * 2 >= VENDORS.filter((v) => v.zone === z).length ? "🍜" : "🛍️"]);
    $("bm-list").innerHTML = groups.map(([zone, icon]) => `
      <h3>${icon} ${esc(ZONE_LABELS[zone] ?? "")}</h3>
      <ul>${VENDORS.filter((v) => v.zone === zone).map((v) => `
        <li><button type="button" data-v="${v.id}"><i style="background:${v.color}"></i>
          <span><b>${esc(v.name)}</b><small>${esc(v.tagline ?? "")}</small></span></button></li>`).join("")}
      </ul>`).join("");
    $("bm-list").onclick = (e) => {
      const v = vendorById(e.target.closest("[data-v]")?.dataset.v);
      if (!v) return;
      big.scale = Math.max(big.scale, 6);
      big.cx = v.x; big.cz = v.z + 110 / big.scale;   // sit the stall above the vendor card
      openVendor(v);
    };
  }

  // ---------- Fade stalls that block the camera ----------
  // Any stall the camera→you sight line passes through turns see-through, so tight rows like
  // Shakedown Street never hide your character.
  const collectMats = (g) => {
    const mats = [];
    g.traverse((o) => { if (o.isMesh && o.material.visible !== false) mats.push(o.material); });
    mats.forEach((m) => (m.userData.baseOpacity = m.opacity));
    return mats;
  };
  const fades = stalls.map((g) => {
    g.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(g.children.find((c) => c.userData.isHitBox));
    return { g, mats: collectMats(g), box, alpha: 1 };
  });
  // When a stall's truck is rebuilt (a vendor changed their design), point its fade at the new parts.
  function refreshFade(g) { const f = fades.find((x) => x.g === g); if (f) f.mats = collectMats(g); }
  const inv = new THREE.Matrix4(), a3 = new THREE.Vector3(), b3 = new THREE.Vector3();
  function fadeBlockers(dt, me) {
    for (const f of fades) {
      f.g.updateMatrixWorld();
      inv.copy(f.g.matrixWorld).invert();
      // Hit box in the stall's own (unrotated) space: test the sight line there.
      const lb = f.lb ??= f.box.clone().applyMatrix4(inv).expandByScalar(0.8);    // a little slack around the line
      const near = f.near ??= lb.clone().expandByScalar(2.2);                     // or the camera is right beside it
      a3.copy(camera.position).applyMatrix4(inv);
      b3.set(me.position.x, me.position.y + 1.2, me.position.z).applyMatrix4(inv);
      const blocked = near.containsPoint(a3) || segmentHitsBox(a3, b3, lb);
      const want = blocked ? 0.22 : 1;
      if (Math.abs(f.alpha - want) < 0.01) continue;
      f.alpha += (want - f.alpha) * (1 - Math.exp(-10 * dt));
      if (Math.abs(f.alpha - want) < 0.01) f.alpha = want;
      for (const m of f.mats) {
        m.transparent = f.alpha < 1 || m.userData.baseOpacity < 1;
        m.opacity = m.userData.baseOpacity * f.alpha;
        m.depthWrite = f.alpha >= 1;
      }
    }
  }

  // ---------- Every frame ----------
  let mmFrame = 0;
  function update(dt) {
    const me = myAvatar();
    if (!me) return;
    const here = { x: me.position.x, z: me.position.z };
    fadeBlockers(dt, me);

    // Browse prompt (the quest giver's Talk prompt wins if both apply).
    nearVendor = VENDORS.map((v) => ({ v, d: dist(here, vendorFront(v)) })).filter((o) => o.d < BROWSE_RANGE).sort((a, b) => a.d - b.d)[0]?.v ?? null;
    const sheetOpen = !$("vendor").hidden || !$("offer").hidden;
    $("vprompt").hidden = !nearVendor || !$("prompt").hidden || sheetOpen || big.open;
    if (nearVendor) $("vprompt").textContent = `Browse ${nearVendor.name}`;

    // Arriving at a waypoint opens that vendor.
    if (waypoint && dist(here, waypoint) < ARRIVE_RANGE) {
      const v = vendorById(waypoint.id);
      clearWaypoint();
      toast(`You made it to ${v.name}!`);
      openVendor(v);
    }
    wpBeacon.rotation.y += 0.02;

    const data = mapData();
    // The minimap redraws every other frame; plenty smooth, half the cost.
    if (!big.open && (mmFrame++ & 1) === 0) {
      const { ctx, w, h } = fitCanvas($("minimap"));
      const wpText = waypoint ? `${waypoint.name} · ${Math.round(dist(here, waypoint))} m` : "";
      if ($("mm-wp").textContent !== wpText) { $("mm-wp").textContent = wpText; $("mm-wp").hidden = !wpText; }
      drawMap(ctx, { cx: here.x, cz: here.z, scale: (w / 2) / MINIMAP_RADIUS, w, h, circle: true }, data);
    }
    if (big.open) {
      const { ctx, w, h } = fitCanvas($("bm-canvas"));
      drawMap(ctx, { cx: big.cx, cz: big.cz, scale: big.scale, w, h, labels: true }, data);
    }
  }

  return { update, openVendor };
}

// Does the line segment a→b pass through the box? (slab method)
function segmentHitsBox(a, b, box) {
  let t0 = 0, t1 = 1;
  for (const k of ["x", "y", "z"]) {
    const d = b[k] - a[k];
    if (Math.abs(d) < 1e-9) { if (a[k] < box.min[k] || a[k] > box.max[k]) return false; continue; }
    let ta = (box.min[k] - a[k]) / d, tb = (box.max[k] - a[k]) / d;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  return true;
}

// A white light column marking your waypoint, with a slowly spinning ring at its base.
function makeBeacon(THREE) {
  const g = new THREE.Group();
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.4, 0.4, 50, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide }),
  );
  beam.position.y = 25;
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(1.1, 1.45, 6),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }),
  );
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05;
  g.add(beam, ring);
  return g;
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
