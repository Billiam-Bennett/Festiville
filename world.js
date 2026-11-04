// The festival grounds. Pure scenery: no collisions (the fence limit is enforced in shared/sim.js).
// Everything is simple shapes so it loads instantly; swap in real models later.
// What goes where comes from the layout (shared/layout.js), which the festival builder edits;
// buildFestival() is also what the builder's 3D preview uses.
import { WORLD_HALF_SIZE } from "../shared/sim.js";
import { FENCE, GATE, LAYOUT, VENDORS } from "../shared/venue.js";
import { rad } from "../shared/layout.js";
import { buildTruck } from "./truck.js";

// Builds everything into one group (so the builder can throw it away and rebuild).
// Returns { group, stalls } — stalls are tappable vendor groups, each with userData.vendorId.
export function buildFestival(THREE, scene, layout = LAYOUT, vendors = VENDORS) {
  const S = WORLD_HALF_SIZE;
  const root = new THREE.Group();
  root.name = "festival";

  // Dusk sky + fog so the edges of the map fade out.
  scene.background = new THREE.Color("#2a1b3d");
  scene.fog = new THREE.Fog("#2a1b3d", 40, S * 1.4);

  root.add(new THREE.HemisphereLight("#ffd9b0", "#2a3a2a", 1.6));
  const sun = new THREE.DirectionalLight("#ffb07a", 1.8);
  sun.position.set(-40, 60, 30);
  root.add(sun);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(S * 2, S * 2), new THREE.MeshStandardMaterial({ color: "#3d6b35" }));
  ground.rotation.x = -Math.PI / 2;
  root.add(ground);
  addFence(THREE, root);

  const byVendor = new Map(vendors.map((v) => [v.id, v]));
  const stalls = [];
  // Ground areas first, bigger ones underneath smaller ones so overlaps look right.
  const areas = layout.items.filter((i) => i.type === "area").sort((a, b) => b.w * b.d - a.w * a.d);
  areas.forEach((a, k) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(a.w, a.d), new THREE.MeshStandardMaterial({ color: a.color }));
    m.rotation.set(-Math.PI / 2, 0, rad(a.rot));
    m.position.set(a.x, 0.01 + k * 0.002, a.z);
    root.add(m);
  });

  for (const it of layout.items) {
    let obj = null;
    switch (it.type) {
      case "pathring": obj = pathRing(THREE, it.r); break;
      case "stage": obj = it.variant === "side" ? sideStage(THREE) : mainStage(THREE); break;
      case "stall": {
        const v = byVendor.get(it.vendor);
        if (!v) break;
        obj = it.style === "tent" ? shakedownStall(THREE, v) : foodBooth(THREE, v);
        obj.userData.vendorId = v.id;
        stalls.push(obj);
        break;
      }
      case "arch": obj = arch(THREE, it); break;
      case "lights": obj = bulbString(THREE, it.w, it.d); break;
      case "lamp": obj = lamp(THREE, it.color); break;
      case "table": obj = picnicTable(THREE); break;
      case "tent": obj = tent(THREE, it.color); break;
      case "tree": obj = tree(THREE, it.x * 7.1 + it.z * 3.3); break;
    }
    if (!obj) continue;
    obj.position.set(it.x, 0, it.z);
    obj.rotation.y = rad(it.rot || 0);
    obj.userData.itemId = it.id;
    root.add(obj);
  }
  scene.add(root);
  return { group: root, stalls };
}

// Free the GPU memory of a festival built above (the builder rebuilds it on every change).
export function disposeFestival(group) {
  group.parent?.remove(group);
  group.traverse((o) => {
    o.geometry?.dispose();
    for (const m of [].concat(o.material ?? [])) { m.map?.dispose(); m.dispose(); }
  });
}

function box(THREE, w, h, d, color, emissive) {
  return new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color, emissive: emissive ?? "#000000" }),
  );
}

function mainStage(THREE) {
  const g = new THREE.Group();
  const deck = box(THREE, 30, 2, 12, "#222");
  deck.position.y = 1;
  g.add(deck);
  const back = box(THREE, 30, 14, 1, "#111");
  back.position.set(0, 8, -6);
  g.add(back);
  const screen = box(THREE, 18, 8, 0.2, "#000", "#ff4fa3");
  screen.position.set(0, 9, -5.4);
  g.add(screen);
  for (const sx of [-15, 15]) {
    const tower = box(THREE, 1, 16, 1, "#555");
    tower.position.set(sx, 8, 5);
    g.add(tower);
    const speaker = box(THREE, 3, 5, 3, "#1a1a1a");
    speaker.position.set(sx * 1.15, 4.5, 3);
    g.add(speaker);
  }
  const truss = box(THREE, 31, 1, 1, "#555");
  truss.position.set(0, 16, 5);
  g.add(truss);
  // Colored stage lights washing the crowd area.
  ["#ff4fa3", "#4fc3ff", "#b44fff"].forEach((c, i) => {
    const light = new THREE.PointLight(c, 60, 40);
    light.position.set(-10 + i * 10, 15, 6);
    g.add(light);
  });
  return g;
}

function sideStage(THREE) {
  const g = new THREE.Group();
  const deck = box(THREE, 14, 1.5, 8, "#3b2a1a");
  deck.position.y = 0.75;
  g.add(deck);
  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(10, 5, 4),
    new THREE.MeshStandardMaterial({ color: "#f2f2f2" }),
  );
  roof.position.y = 9;
  roof.rotation.y = Math.PI / 4;
  g.add(roof);
  for (const [px, pz] of [[-6, -3.5], [6, -3.5], [-6, 3.5], [6, 3.5]]) {
    const pole = box(THREE, 0.4, 7, 0.4, "#ccc");
    pole.position.set(px, 4, pz);
    g.add(pole);
  }
  const light = new THREE.PointLight("#ffd36b", 30, 25);
  light.position.set(0, 6, 4);
  g.add(light);
  return g;
}

function tent(THREE, color) {
  const t = new THREE.Mesh(new THREE.ConeGeometry(2, 2.2, 4), new THREE.MeshStandardMaterial({ color }));
  t.position.y = 1.1;
  const g = new THREE.Group();
  g.add(t);
  return g;
}

// seed: any number, so each tree gets its own (but always the same) height.
function tree(THREE, seed) {
  const h = 4 + (Math.abs(Math.sin(seed)) * 3);
  const g = new THREE.Group();
  const trunk = box(THREE, 0.6, h, 0.6, "#5b3a1e");
  trunk.position.y = h / 2;
  const top = new THREE.Mesh(new THREE.ConeGeometry(2.5, 5, 7), new THREE.MeshStandardMaterial({ color: "#1f4d2b" }));
  top.position.y = h + 2;
  g.add(trunk, top);
  return g;
}

// A worn dirt loop with string lights hung over it.
function pathRing(THREE, r) {
  const g = new THREE.Group();
  const path = new THREE.Mesh(new THREE.RingGeometry(r - 3, r + 3, 64), new THREE.MeshStandardMaterial({ color: "#8a6a45" }));
  path.rotation.x = -Math.PI / 2;
  path.position.y = 0.03;
  g.add(path);
  const colors = ["#ffdd57", "#ff6b9d", "#6bd5ff", "#b8ff6b"];
  const bulbGeo = new THREE.SphereGeometry(0.18, 8, 8);
  const mats = colors.map((c) => new THREE.MeshBasicMaterial({ color: c }));
  const n = Math.round(120 * r / 31);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const sag = Math.abs(Math.sin(a * 10)) * 0.8;   // droop between poles
    const bulb = new THREE.Mesh(bulbGeo, mats[i % mats.length]);
    bulb.position.set(Math.cos(a) * r, 5 - sag, Math.sin(a) * r);
    g.add(bulb);
  }
  return g;
}

// Bulbs strung zig-zag across a w × d rectangle (along its width).
function bulbString(THREE, w, d) {
  const g = new THREE.Group();
  const colors = ["#ffdd57", "#ff6b9d", "#6bd5ff", "#b8ff6b"];
  const geo = new THREE.SphereGeometry(0.16, 6, 6);
  const mats = colors.map((c) => new THREE.MeshBasicMaterial({ color: c }));
  const n = Math.max(10, Math.round(w * 1.5));
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const phase = (t * (w / 5)) % 2;               // 0..2: one side to the other and back
    const across = phase < 1 ? phase : 2 - phase;
    const bulb = new THREE.Mesh(geo, mats[i % mats.length]);
    bulb.position.set(-w / 2 + t * w, 4.6 - Math.sin(across * Math.PI) * 0.7, -d / 2 + across * d);
    g.add(bulb);
  }
  return g;
}

// A warm light hanging over an area (a glowing bulb, plus real light on the ground).
function lamp(THREE, color) {
  const g = new THREE.Group();
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), new THREE.MeshBasicMaterial({ color }));
  bulb.position.y = 6;
  const l = new THREE.PointLight(color, 16, 22);
  l.position.y = 6;
  g.add(bulb, l);
  return g;
}

function picnicTable(THREE) {
  const t = new THREE.Group();
  const top = box(THREE, 1.2, 0.08, 3, "#7a5230");
  top.position.y = 0.75;
  t.add(top);
  for (const bx of [-0.85, 0.85]) {
    const bench = box(THREE, 0.35, 0.06, 3, "#6a4526");
    bench.position.set(bx, 0.45, 0);
    t.add(bench);
  }
  for (const lz of [-1.2, 1.2]) {
    const leg = box(THREE, 2, 0.7, 0.1, "#5a3a1e");
    leg.position.set(0, 0.35, lz);
    t.add(leg);
  }
  return t;
}

// An entrance arch: two posts and a sign between them, readable from the front (+z at rot 0).
function arch(THREE, it) {
  const g = new THREE.Group();
  for (const sx of [-it.w / 2, it.w / 2]) {
    const post = box(THREE, 0.45, 6, 0.45, "#4a3320");
    post.position.set(sx, 3, 0);
    g.add(post);
  }
  const sign = signBoard(THREE, it.text, it.w + 1, 1.7, it.color);
  sign.position.set(0, 5.7, 0);
  g.add(sign);
  return g;
}

// ---------- Perimeter fence + main gate ----------
// Posts every 4 m with a see-through mesh panel and a top rail, plus colorful festival scrim
// banners here and there. Posts are one InstancedMesh so the whole fence is a handful of draw calls.
function addFence(THREE, scene) {   // scene: any group to add to
  const F = FENCE, H = 2.4, gap = GATE.width / 2;
  const postGeo = new THREE.CylinderGeometry(0.07, 0.07, H, 6);
  const spots = [];
  for (let t = -F; t <= F; t += 4) {
    spots.push([t, -F], [-F, t], [F, t]);
    if (Math.abs(t) > gap) spots.push([t, F]);           // leave the gate open
  }
  spots.push([-gap, F], [gap, F]);
  const posts = new THREE.InstancedMesh(postGeo, new THREE.MeshStandardMaterial({ color: "#9aa0a6" }), spots.length);
  const m = new THREE.Matrix4();
  spots.forEach(([x, z], i) => posts.setMatrixAt(i, m.makeTranslation(x, H / 2, z)));
  scene.add(posts);

  const mesh = new THREE.MeshStandardMaterial({ color: "#c9ced6", transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false });
  const rail = new THREE.MeshStandardMaterial({ color: "#9aa0a6" });
  const run = (x0, z0, x1, z1) => {
    const len = Math.hypot(x1 - x0, z1 - z0), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, ang = Math.atan2(z1 - z0, x1 - x0);
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(len, H - 0.2), mesh);
    panel.position.set(cx, H / 2, cz); panel.rotation.y = -ang;
    const top = new THREE.Mesh(new THREE.BoxGeometry(len, 0.08, 0.08), rail);
    top.position.set(cx, H, cz); top.rotation.y = -ang;
    scene.add(panel, top);
  };
  run(-F, -F, F, -F); run(-F, -F, -F, F); run(F, -F, F, F);
  run(-F, F, -gap, F); run(gap, F, F, F);

  // Scrim banners on the fence, alternating festival colors.
  const colors = ["#ff4fa3", "#4fc3ff", "#b44fff", "#ffd36b"];
  const banner = (x, z, rotY, i) => {
    const b = new THREE.Mesh(new THREE.PlaneGeometry(10, 1.1), new THREE.MeshStandardMaterial({ color: colors[i % colors.length], side: THREE.DoubleSide }));
    b.position.set(x, 1.5, z); b.rotation.y = rotY;
    scene.add(b);
  };
  let i = 0;
  for (let t = -80; t <= 80; t += 32) {
    banner(t, -F + 0.05, 0, i++); banner(-F + 0.05, t, Math.PI / 2, i++); banner(F - 0.05, t, Math.PI / 2, i++);
    if (Math.abs(t) > 20) banner(t, F - 0.05, 0, i++);
  }

  // Main gate: an arch over the south opening.
  const g = new THREE.Group();
  for (const sx of [-gap, gap]) {
    const tower = box(THREE, 1.2, 8, 1.2, "#3b2a4d");
    tower.position.set(sx, 4, 0);
    g.add(tower);
  }
  const sign = signBoard(THREE, "Welcome to FestiVille", GATE.width + 2, 2.2, "#ff4fa3");
  sign.position.set(0, 8.2, 0);
  g.add(sign);
  const glow = new THREE.PointLight("#ff8fcf", 20, 22);
  glow.position.set(0, 6, -3);
  g.add(glow);
  g.position.set(GATE.x, 0, GATE.z);
  scene.add(g);
}

// ---------- Food court ----------
function foodBooth(THREE, v) {
  // The whole truck (body, awning, stripe, wheels, roof topper, sign) comes from the vendor's design.
  const g = buildTruck(THREE, { name: v.name, color: v.color, truck: v.truck });
  return g;
}

// ---------- Shakedown Street ----------
function shakedownStall(THREE, v) {
  const g = new THREE.Group();
  // Pop-up canopy: four legs and a peaked roof.
  for (const [px, pz] of [[-3, -2], [3, -2], [-3, 2], [3, 2]]) {
    const leg = box(THREE, 0.1, 2.6, 0.1, "#dcdcdc");
    leg.position.set(px, 1.3, pz);
    g.add(leg);
  }
  const roof = new THREE.Mesh(new THREE.ConeGeometry(4.6, 1.3, 4, 1), new THREE.MeshStandardMaterial({ color: v.color }));
  roof.rotation.y = Math.PI / 4;
  roof.scale.set(1, 1, 0.66);
  roof.position.y = 3.25;
  g.add(roof);
  // Folding table with a spread of goods.
  const table = box(THREE, 5, 0.08, 1.1, "#f4f1ea");
  table.position.set(0, 0.8, 1.3);
  g.add(table);
  const cloth = box(THREE, 5.02, 0.7, 1.12, v.color);
  cloth.position.set(0, 0.42, 1.3);
  g.add(cloth);
  const goodsColors = ["#ffffff", v.color, "#ffd36b", "#4fc3ff", "#ff6b9d"];
  for (let i = 0; i < 7; i++) {
    const item = box(THREE, 0.45, 0.2 + (i % 3) * 0.12, 0.35, goodsColors[i % goodsColors.length]);
    item.position.set(-2.1 + i * 0.7, 0.94 + item.geometry.parameters.height / 2, 1.3);
    g.add(item);
  }
  // Hanging display rack at the back.
  const rack = box(THREE, 5, 1.6, 0.06, "#3a2a1a");
  rack.position.set(0, 1.6, -1.8);
  g.add(rack);
  for (let i = 0; i < 5; i++) {
    const hang = box(THREE, 0.6, 0.8, 0.04, goodsColors[(i + 1) % goodsColors.length]);
    hang.position.set(-2 + i, 1.7, -1.74);
    g.add(hang);
  }
  const sign = signBoard(THREE, v.name, 5.2, 0.9, v.color);
  sign.position.set(0, 2.45, 2.05);
  g.add(sign);
  g.userData.setName = sign.userData.setText;
  addHitBox(THREE, g, 6.4, 4, 4.6);
  return g;
}

// ---------- Helpers ----------
// An invisible box around a stall so taps anywhere on it register (see client/venue-ui.js).
function addHitBox(THREE, g, w, h, d) {
  const hit = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ visible: false }));
  hit.position.y = h / 2;
  hit.userData.isHitBox = true;
  g.add(hit);
}

// A sign that reads correctly from both sides (two back-to-back faces).
// g.userData.setText(newText) repaints it (vendors can rename their stall while the game is running).
function signBoard(THREE, text, w, h, color) {
  const c = document.createElement("canvas");
  const px = 96;                                 // canvas pixels per meter
  c.width = Math.min(2048, Math.round(w * px)); c.height = Math.round(h * px);
  const x = c.getContext("2d");
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const draw = (text) => {
    x.fillStyle = "#1c1228";
    x.fillRect(0, 0, c.width, c.height);
    x.strokeStyle = color; x.lineWidth = Math.max(6, c.height * 0.08);
    x.strokeRect(x.lineWidth / 2, x.lineWidth / 2, c.width - x.lineWidth, c.height - x.lineWidth);
    x.fillStyle = "#ffffff";
    let size = Math.round(c.height * 0.56);
    x.font = `800 ${size}px system-ui, sans-serif`;
    while (x.measureText(text).width > c.width * 0.9 && size > 10) { size -= 2; x.font = `800 ${size}px system-ui, sans-serif`; }
    x.textAlign = "center"; x.textBaseline = "middle";
    x.fillText(text, c.width / 2, c.height / 2 + size * 0.04);
    tex.needsUpdate = true;
  };
  draw(text);
  const g = new THREE.Group();
  g.userData.setText = draw;
  const geo = new THREE.PlaneGeometry(w, h), mat = new THREE.MeshBasicMaterial({ map: tex });
  const front = new THREE.Mesh(geo, mat), back = new THREE.Mesh(geo, mat);
  back.rotation.y = Math.PI;
  g.add(front, back);
  return g;
}
