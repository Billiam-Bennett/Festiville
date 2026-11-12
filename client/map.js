// Draws the festival as a flat 2D map on a canvas. Used by the minimap (small, centered on you)
// and the full-screen map (whole festival, labels, pan/zoom). North (-Z) is up, like the camera.
import { FENCE, GATE, LAYOUT, VENDORS } from "../shared/venue.js";
import { GIVERS } from "../shared/quests-data.js";
import { TYPES, rad, forestTrees, genreName } from "../shared/layout.js";

// Where a forest's trees are, worked out once per forest (the minimap draws every frame).
const treeCache = new Map();
function treesOf(f, items) {
  const key = `${f.x},${f.z},${f.w},${f.d},${f.rot}|${items.length}`;
  let hit = treeCache.get(f);
  if (!hit || hit.key !== key) { hit = { key, trees: forestTrees(f, items) }; treeCache.set(f, hit); if (treeCache.size > 200) treeCache.delete(treeCache.keys().next().value); }
  return hit.trees;
}

const C = {
  bg: "#1b1226", grass: "#355c2f", dirt: "#8a6a45", plaza: "#9b7b52", lane: "#a58556",
  camp: "rgba(255,255,255,.07)", stage: "#141018", fence: "rgba(235,235,245,.8)",
  label: "#fff", me: "#ff4fa3", player: "#ffffff", crew: "#4fe3ff", giver: "#ffd36b", waypoint: "#ffffff",
  water: "#2f6f9f", bridge: "#a07a4f", forest: "rgba(20,60,32,.55)", tree: "#1f4d2b", wheel: "#ffd36b", art: "#d18bff",
};

// view: { cx, cz, scale (px per meter), w, h (CSS px), labels, circle }
// data: { me, players: [{ x, z, crew }], markers: [{ x, z, color }], waypoint: { x, z } | null }
// layout / vendors: what to draw (the builder passes its draft; the game uses the current layout).
export function drawMap(ctx, view, data, layout = LAYOUT, vendors = VENDORS) {
  const { w, h, scale } = view;
  const X = (x) => w / 2 + (x - view.cx) * scale;
  const Z = (z) => h / 2 + (z - view.cz) * scale;
  const rect = (x, z, rw, rd, fill) => { ctx.fillStyle = fill; ctx.fillRect(X(x - rw / 2), Z(z - rd / 2), rw * scale, rd * scale); };

  ctx.save();
  ctx.clearRect(0, 0, w, h);
  if (view.circle) { ctx.beginPath(); ctx.arc(w / 2, h / 2, w / 2 - 1, 0, Math.PI * 2); ctx.clip(); }
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, w, h);

  // Grounds inside the fence.
  rect(0, 0, FENCE * 2, FENCE * 2, C.grass);
  // Ground areas (big ones first), path loops, stages, stalls, and small scenery.
  const items = layout.items;
  const rotRect = (it, [rw, rd], fill, stroke) => {
    ctx.save();
    ctx.translate(X(it.x), Z(it.z)); ctx.rotate(rad(it.rot || 0));
    if (fill) { ctx.fillStyle = fill; ctx.fillRect(-rw * scale / 2, -rd * scale / 2, rw * scale, rd * scale); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = Math.max(1, 0.4 * scale); ctx.strokeRect(-rw * scale / 2, -rd * scale / 2, rw * scale, rd * scale); }
    ctx.restore();
  };
  for (const a of items.filter((i) => i.type === "area").sort((p, q) => q.w * q.d - p.w * p.d)) rotRect(a, [a.w, a.d], a.color);
  for (const f of items.filter((i) => i.type === "forest")) {
    rotRect(f, [f.w, f.d], C.forest);
    if (view.trees !== false && scale >= 1.2) for (const t of treesOf(f, items)) dot(ctx, X(t.x), Z(t.z), Math.max(1, 1.8 * scale), C.tree);
  }
  for (const w of items.filter((i) => i.type === "water")) rotRect(w, [w.w, w.d], C.water);
  for (const p of items.filter((i) => i.type === "path")) rotRect(p, [p.w, p.d], C.dirt);
  for (const b of items.filter((i) => i.type === "bridge")) rotRect(b, [b.w, b.d], C.bridge, "#5a3e26");
  for (const r of items.filter((i) => i.type === "pathring")) {
    ctx.strokeStyle = C.dirt; ctx.lineWidth = 6 * scale;
    ctx.beginPath(); ctx.arc(X(r.x), Z(r.z), r.r * scale, 0, Math.PI * 2); ctx.stroke();
  }
  for (const st of items.filter((i) => i.type === "stage")) rotRect(st, TYPES.stage.size(st), C.stage, "#ff4fa3");
  const byVendor = new Map(vendors.map((v) => [v.id, v]));
  for (const it of items) {
    if (it.type === "stall") rotRect(it, TYPES.stall.size(it), byVendor.get(it.vendor)?.color ?? it.color ?? "#888");
    else if (it.type === "table") rotRect(it, [2.1, 3], "#6a4526");
    else if (it.type === "tent") dot(ctx, X(it.x), Z(it.z), Math.max(1.5, 1.4 * scale), it.color);
    else if (it.type === "tree" && view.trees !== false) dot(ctx, X(it.x), Z(it.z), Math.max(1.5, 2.2 * scale), "#1f4d2b");
    else if (it.type === "arch") rotRect(it, [it.w, 0.8], it.color);
    else if (it.type === "stop") dot(ctx, X(it.x), Z(it.z), Math.max(3.5, scale * 1.1), "#ffd36b", "#2a1a05");
    else if (it.type === "art") rotRect(it, TYPES.art.size(it), it.variant === "medic" ? "#e53935" : it.variant === "info" ? "#2d9cdb" : C.art);
    else if (it.type === "wheel") {
      // The Ferris wheel, seen from above: its footprint and a ring for the wheel itself.
      rotRect(it, TYPES.wheel.size(it), "#4a3b5c");
      ctx.strokeStyle = C.wheel; ctx.lineWidth = Math.max(1.5, 0.6 * scale);
      ctx.beginPath(); ctx.arc(X(it.x), Z(it.z), Math.max(5, 4 * scale), 0, Math.PI * 2); ctx.stroke();
    }
  }

  // Fence with a gap for the gate.
  ctx.strokeStyle = C.fence; ctx.lineWidth = Math.max(1.5, 0.5 * scale);
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(X(-GATE.width / 2), Z(FENCE)); ctx.lineTo(X(-FENCE), Z(FENCE)); ctx.lineTo(X(-FENCE), Z(-FENCE));
  ctx.lineTo(X(FENCE), Z(-FENCE)); ctx.lineTo(X(FENCE), Z(FENCE)); ctx.lineTo(X(GATE.width / 2), Z(FENCE));
  ctx.stroke();
  ctx.setLineDash([]);

  // Quest givers.
  for (const g of GIVERS) dot(ctx, X(g.x), Z(g.z), Math.max(3.5, scale * 0.9), C.giver, "#2a1a05");

  // Quest objectives (pieces, delivery tents, stage markers).
  for (const m of data.markers ?? []) {
    ctx.fillStyle = m.color; ctx.globalAlpha = 0.9;
    ctx.beginPath(); ctx.arc(X(m.x), Z(m.z), Math.max(4, scale * 1.2), 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5; ctx.stroke();
  }

  // Other players, then you on top.
  for (const p of data.players ?? []) dot(ctx, X(p.x), Z(p.z), p.crew ? 3.5 : 2.5, p.crew ? C.crew : C.player);

  // Labels (full map only).
  if (view.labels) {
    const label = (text, x, z, size = 13, color = C.label, align = "center") => {
      ctx.font = `700 ${size}px system-ui, sans-serif`;
      ctx.textAlign = align; ctx.textBaseline = "middle";
      ctx.lineWidth = 3; ctx.strokeStyle = "rgba(20,12,32,.85)"; ctx.strokeText(text, X(x), Z(z));
      ctx.fillStyle = color; ctx.fillText(text, X(x), Z(z));
    };
    const big = Math.min(16, Math.max(11, scale * 3.2));
    // Stages with their genre, so players can find the music they like.
    for (const st of items.filter((i) => i.type === "stage")) { label(st.label, st.x, st.z - (big * 0.6) / scale, big); label(`♪ ${genreName(st.genre)}`, st.x, st.z + (big * 0.6) / scale, big * 0.8, "#ffd36b"); }
    for (const w of items.filter((i) => i.type === "wheel")) label(`🎡 ${w.label || "Ferris Wheel"}`, w.x, w.z + Math.max(6, 18 / scale), big * 0.85, C.wheel);
    for (const w of items.filter((i) => i.type === "water" && i.label)) label(w.label, w.x + Math.min(w.w * 0.3, 60), w.z, big * 0.75, "#bfe3ff");
    for (const st of items.filter((i) => i.type === "stop")) label(`🚌 ${st.label}`, st.x, st.z - 3.2, 11, "#ffd36b");
    for (const a of items.filter((i) => i.type === "art" && i.label)) label(a.label, a.x, a.z - 3.6, 11, "#fff");
    for (const a of items.filter((i) => i.type === "area" && i.label)) label(a.label, a.x, a.z - Math.min(a.d, a.w) / 2 + 3, big, "#ffe7c2");
    label(GATE.label, GATE.x, GATE.z - 4, big * 0.85);
    // Stall names once there's room for them, on the side away from the counter.
    if (scale >= 5) for (const v of vendors) label(v.name, v.x - v.facing.x * 4.6, v.z - v.facing.z * 4.4, 11, C.label, v.facing.x > 0.5 ? "right" : v.facing.x < -0.5 ? "left" : "center");
    if (scale >= 3.2) for (const g of GIVERS) label(g.name, g.x, g.z - 2.6, 11, C.giver);
  }

  // Waypoint: a ringed marker, or an arrow on the rim of the minimap when it's out of view.
  if (data.waypoint) {
    let wx = X(data.waypoint.x), wz = Z(data.waypoint.z);
    const r = w / 2 - 8, dx = wx - w / 2, dz = wz - h / 2, d = Math.hypot(dx, dz);
    if (view.circle && d > r) {
      const a = Math.atan2(dz, dx);
      wx = w / 2 + Math.cos(a) * r; wz = h / 2 + Math.sin(a) * r;
      ctx.save(); ctx.translate(wx, wz); ctx.rotate(a);
      ctx.fillStyle = C.waypoint; ctx.strokeStyle = C.me; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(7, 0); ctx.lineTo(-5, -6); ctx.lineTo(-5, 6); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
    } else {
      ctx.strokeStyle = C.waypoint; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(wx, wz, 7, 0, Math.PI * 2); ctx.stroke();
      dot(ctx, wx, wz, 3, C.me);
    }
  }

  // You: an arrow pointing the way you face.
  if (data.me) {
    ctx.save();
    ctx.translate(X(data.me.x), Z(data.me.z));
    ctx.rotate(Math.PI - data.me.rotY);        // rotY 0 faces +Z (down on the map)
    ctx.fillStyle = C.me; ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(6, 6); ctx.lineTo(0, 3); ctx.lineTo(-6, 6); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }
  ctx.restore();

  if (view.circle) {
    ctx.strokeStyle = "rgba(255,255,255,.35)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(w / 2, h / 2, w / 2 - 1, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,.7)"; ctx.font = "700 10px system-ui, sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.fillText("N", w / 2, 4);
  }
}

function dot(ctx, x, y, r, fill, stroke) {
  ctx.fillStyle = fill;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
}

// Size a canvas's backing store for sharp drawing on high-density screens; returns the 2D context.
export function fitCanvas(canvas) {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const { width, height } = canvas.getBoundingClientRect();
  const W = Math.round(width * dpr), H = Math.round(height * dpr);
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w: width, h: height };
}
