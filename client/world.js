// The festival grounds. Pure scenery: what's solid (stages, stalls, trees, the river…) is decided in
// shared/sim.js from the same layout, on the server, so this file only draws.
// Everything is simple shapes so it loads instantly; swap in real models later.
// What goes where comes from the layout (shared/layout.js), which the festival builder edits;
// buildFestival() is also what the builder's 3D preview uses.
import { WORLD_HALF_SIZE } from "../shared/sim.js";
import { FENCE, GATE, LAYOUT, VENDORS } from "../shared/venue.js";
import { rad, forestTrees, genreName, ART } from "../shared/layout.js";
import { WHEEL, gondolaAngle } from "../shared/rides.js";
import { buildTruck } from "./truck.js";

// Builds everything into one group (so the builder can throw it away and rebuild).
// Returns { group, stalls, stageSigns, wheel, update }:
//   stalls      tappable vendor groups, each with userData.vendorId
//   stageSigns  stage id -> { set(line1, line2) } for the sign over each stage (client/dj-ui.js writes "now playing")
//   wheel       the Ferris wheel ({ item, cabin(n) }) or null
//   update(t)   call every frame with the room's clock (seconds): turns the wheel, animates the art
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
  const stageSigns = new Map();
  const ticks = [];
  let wheel = null;
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
      case "stage": {
        obj = it.variant === "side" ? sideStage(THREE) : mainStage(THREE);
        const sign = stageSign(THREE, it);
        obj.add(sign);
        stageSigns.set(it.id, sign.userData);
        break;
      }
      case "path": obj = groundStrip(THREE, it.w, it.d, "#8a6a45", 0.026); break;
      case "water": obj = water(THREE, it); break;
      case "bridge": obj = bridge(THREE, it); break;
      case "forest": root.add(forest(THREE, it, layout.items)); continue;   // trees are placed in world coordinates
      case "wheel": obj = ferrisWheel(THREE, it); wheel = obj.userData; ticks.push(wheel.update); break;
      case "art": obj = art(THREE, it); if (obj.userData.tick) ticks.push(obj.userData.tick); break;
      case "stop": obj = shuttleStop(THREE, it); break;
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
  const update = (t) => { for (const f of ticks) f(t); };
  return { group: root, stalls, stageSigns, wheel, update };
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
  for (let t = -F + 24; t <= F - 24; t += 32) {
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

// ---------- The bigger grounds: paths, the river, bridges, forests ----------
// A flat strip of ground (a path), w long and d wide, just above the grass.
function groundStrip(THREE, w, d, color, y) {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ color }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = y;
  g.add(m);
  return g;
}

function water(THREE, it) {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.PlaneGeometry(it.w, it.d), new THREE.MeshStandardMaterial({ color: "#2f6f9f", emissive: "#0d2c45", roughness: 0.25, metalness: 0.1 }));
  m.rotation.x = -Math.PI / 2; m.position.y = 0.04;
  g.add(m);
  // Muddy banks along both long sides.
  for (const side of [-1, 1]) {
    const bank = new THREE.Mesh(new THREE.PlaneGeometry(it.w, 1.2), new THREE.MeshStandardMaterial({ color: "#5d4a32" }));
    bank.rotation.x = -Math.PI / 2; bank.position.set(0, 0.035, side * (it.d / 2 + 0.5));
    g.add(bank);
  }
  return g;
}

// A wooden footbridge: it.w long (across the water), it.d wide, with rails and glowing lanterns.
function bridge(THREE, it) {
  const g = new THREE.Group();
  const deck = box(THREE, it.w, 0.12, it.d, "#8a6440");
  deck.position.y = 0.07;
  g.add(deck);
  const rail = new THREE.MeshStandardMaterial({ color: "#5a3e26" });
  const n = Math.max(2, Math.round(it.w / 2.5));
  const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.14, 1, 0.14), rail, (n + 1) * 2);
  const m = new THREE.Matrix4();
  let k = 0;
  for (const side of [-1, 1]) {
    const z = side * (it.d / 2 - 0.07);
    const top = new THREE.Mesh(new THREE.BoxGeometry(it.w, 0.1, 0.12), rail);
    top.position.set(0, 1.0, z);
    g.add(top);
    for (let i = 0; i <= n; i++) posts.setMatrixAt(k++, m.makeTranslation(-it.w / 2 + (i * it.w) / n, 0.5, z));
  }
  g.add(posts);
  const glowMat = new THREE.MeshBasicMaterial({ color: "#ffd38a" });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.17, 8, 6), glowMat);
    lantern.position.set((sx * it.w) / 2, 1.28, sz * (it.d / 2 - 0.07));
    g.add(lantern);
  }
  return g;
}

// A whole wood as two instanced meshes (trunks and tops), so hundreds of trees cost two draw calls.
// Where the trees stand comes from shared/layout.js (forestTrees), the same list the server makes solid.
const UP = { x: 0, y: 1, z: 0 };
function forest(THREE, it, items) {
  const trees = forestTrees(it, items);
  const g = new THREE.Group();
  if (!trees.length) return g;
  const trunks = new THREE.InstancedMesh(new THREE.BoxGeometry(0.6, 1, 0.6), new THREE.MeshStandardMaterial({ color: "#5b3a1e" }), trees.length);
  const tops = new THREE.InstancedMesh(new THREE.ConeGeometry(2.5, 5, 7), new THREE.MeshStandardMaterial({ color: "#ffffff" }), trees.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3(), tint = new THREE.Color();
  const axis = new THREE.Vector3(UP.x, UP.y, UP.z);
  trees.forEach((t, i) => {
    const h = 4 + t.seed * 3, k = 0.85 + t.seed * 0.4;
    q.setFromAxisAngle(axis, t.seed * Math.PI * 2);
    trunks.setMatrixAt(i, m.compose(p.set(t.x, h / 2, t.z), q, sc.set(1, h, 1)));
    tops.setMatrixAt(i, m.compose(p.set(t.x, h + 2 * k, t.z), q, sc.set(k, k, k)));
    tops.setColorAt(i, tint.setHSL(0.36 + (t.seed - 0.5) * 0.06, 0.42, 0.17 + t.seed * 0.08));
  });
  g.add(trunks, tops);
  return g;
}

// ---------- The Ferris wheel ----------
// The wheel turns on the room's clock (shared/rides.js → gondolaAngle), so every player sees each
// gondola in the same place, and riders (client/rides-ui.js) sit in the cabin their server ride says.
// Local frame: the wheel turns in the x/y plane; its axle runs along z; the boarding side is +z.
const CABIN_COLORS = ["#ff4fa3", "#4fc3ff", "#ffd36b", "#7ee081", "#b44fff", "#ff7a3d"];
export const CABIN_FLOOR = 1.8;   // how far below the rim point a cabin's floor is (riders stand there)
function ferrisWheel(THREE, it) {
  const g = new THREE.Group();
  const R = WHEEL.radius, H = WHEEL.hub;
  const steel = new THREE.MeshStandardMaterial({ color: "#d8d8e4", metalness: 0.5, roughness: 0.4 });
  // Two A-frames, one each side of the wheel, from the ground up to the axle.
  for (const z of [-1.7, 1.7]) for (const x of [-6, 6]) {
    const len = Math.hypot(x, H);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, len, 8), steel);
    leg.position.set(x / 2, H / 2, z);
    leg.rotation.z = Math.atan2(x, H);
    g.add(leg);
  }
  const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 4.2, 12), steel);
  axle.rotation.x = Math.PI / 2; axle.position.y = H;
  g.add(axle);

  // The turning part: two rims, spokes, and a ring of bulbs.
  const spin = new THREE.Group();
  spin.position.y = H;
  g.add(spin);
  for (const z of [-1, 1]) {
    const rim = new THREE.Mesh(new THREE.TorusGeometry(R, 0.16, 6, 64), steel);
    rim.position.z = z;
    spin.add(rim);
  }
  for (let n = 0; n < WHEEL.gondolas * 2; n++) {
    const a = (n / (WHEEL.gondolas * 2)) * Math.PI * 2;
    for (const z of [-1, 1]) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.1, R, 0.1), steel);
      spoke.position.set((Math.sin(a) * R) / 2, (-Math.cos(a) * R) / 2, z);
      spoke.rotation.z = a;
      spin.add(spoke);
    }
  }
  const BULBS = 72;
  const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.2, 6, 5), new THREE.MeshBasicMaterial({ color: "#ffffff", toneMapped: false }), BULBS);
  const mm = new THREE.Matrix4(), col = new THREE.Color();
  for (let i = 0; i < BULBS; i++) {
    const a = (i / BULBS) * Math.PI * 2;
    bulbs.setMatrixAt(i, mm.makeTranslation(Math.sin(a) * (R + 0.35), -Math.cos(a) * (R + 0.35), 1.15));
    bulbs.setColorAt(i, col.set(CABIN_COLORS[i % CABIN_COLORS.length]));
  }
  spin.add(bulbs);
  const hubGlow = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 0.3, 20), new THREE.MeshBasicMaterial({ color: "#ff4fa3", toneMapped: false }));
  hubGlow.rotation.x = Math.PI / 2; hubGlow.position.z = 1.25;
  spin.add(hubGlow);

  // Cabins hang from the rim and stay upright, so they're positioned (not rotated) every frame.
  const cabins = [];
  for (let n = 0; n < WHEEL.gondolas; n++) {
    const c = new THREE.Group();
    const color = CABIN_COLORS[n % CABIN_COLORS.length];
    const hanger = box(THREE, 0.08, 0.35, 0.08, "#999");
    hanger.position.y = -0.17;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1.3, 0.45, 4), new THREE.MeshStandardMaterial({ color }));
    roof.rotation.y = Math.PI / 4; roof.position.y = -0.55;
    const tub = box(THREE, 1.7, 0.6, 1.7, color);
    tub.position.y = -CABIN_FLOOR + 0.3;
    c.add(hanger, roof, tub);
    for (const [px, pz] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]]) {
      const post = box(THREE, 0.06, 1.0, 0.06, "#ddd");
      post.position.set(px, -1.2 + 0.0, pz);
      c.add(post);
    }
    g.add(c);
    cabins.push(c);
  }

  // Where you get on: a platform with steps on the boarding side, and the sign.
  const deck = box(THREE, 5, 1.2, 2.6, "#4a3b5c");
  deck.position.set(0, 0.6, 2.6);
  const steps = box(THREE, 2.4, 0.6, 1.2, "#3b2f4a");
  steps.position.set(0, 0.3, 4.4);
  g.add(deck, steps);
  const sign = signBoard(THREE, it.label || "Ferris Wheel", 6, 0.9, "#ffd36b");
  sign.position.set(0, 3.2, 3.9);
  g.add(sign);

  const place = (t) => {
    spin.rotation.z = ((t / WHEEL.period) % 1) * Math.PI * 2;
    for (let n = 0; n < cabins.length; n++) {
      const a = gondolaAngle(n, t);
      cabins[n].position.set(Math.sin(a) * R, H - Math.cos(a) * R, 0);
    }
  };
  place(0);
  g.userData = { item: it, cabin: (n) => cabins[n] ?? null, update: place };
  return g;
}

// ---------- Art installations and service tents ----------
function art(THREE, it) {
  const g = new THREE.Group();
  const glowMat = (c, k = 1.4) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: k });
  switch (it.variant) {
    case "ring": {
      // A big upright ring of light you can walk around (and meet at).
      const ring = new THREE.Mesh(new THREE.TorusGeometry(3.1, 0.25, 10, 48), glowMat("#ff4fa3", 1.6));
      ring.position.y = 3.6;
      for (const x of [-2.4, 2.4]) { const foot = box(THREE, 0.8, 0.5, 1.0, "#2a2a33"); foot.position.set(x, 0.25, 0); g.add(foot); }
      g.add(ring);
      g.userData.tick = (t) => ring.material.emissive.setHSL(((t * 0.05) + it.x * 0.01) % 1, 0.9, 0.55);
      break;
    }
    case "totem": {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 5, 8), new THREE.MeshStandardMaterial({ color: "#c9c9d4" }));
      pole.position.y = 2.5;
      g.add(pole);
      const gems = [];
      ["#7ee081", "#5ad1ff", "#ff4fa3", "#ffd36b"].forEach((c, i) => {
        const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.5 - i * 0.06), glowMat(c));
        gem.position.y = 1.6 + i * 1.1;
        g.add(gem); gems.push(gem);
      });
      g.userData.tick = (t) => gems.forEach((m, i) => { m.rotation.y = t * (0.6 + i * 0.2); m.material.emissiveIntensity = 1 + Math.max(0, Math.sin(t * 2 - i)) * 1.2; });
      break;
    }
    case "pyramid": {
      const shape = new THREE.ConeGeometry(3.3, 4.2, 4, 1);
      const inner = new THREE.Mesh(shape, new THREE.MeshStandardMaterial({ color: "#2a1b3d", emissive: "#b44fff", emissiveIntensity: 0.35, transparent: true, opacity: 0.55 }));
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(shape), new THREE.LineBasicMaterial({ color: "#d18bff" }));
      for (const o of [inner, edges]) { o.position.y = 2.1; o.rotation.y = Math.PI / 4; g.add(o); }
      g.userData.tick = (t) => (inner.material.emissiveIntensity = 0.3 + Math.sin(t * 1.4) * 0.15);
      break;
    }
    case "info":
    case "medic": {
      // A small service tent with a sign: INFO, or a red cross for first aid.
      const medic = it.variant === "medic";
      const body = box(THREE, 4.6, 2.2, 3.6, "#f4f1ea");
      body.position.y = 1.1;
      const roof = new THREE.Mesh(new THREE.ConeGeometry(3.6, 1.4, 4), new THREE.MeshStandardMaterial({ color: medic ? "#d33b3b" : "#2d9cdb" }));
      roof.rotation.y = Math.PI / 4; roof.scale.set(1, 1, 0.78); roof.position.y = 2.9;
      const sign = signBoard(THREE, it.label || ART[it.variant].name, 3.6, 0.8, medic ? "#ff6b6b" : "#4fc3ff");
      sign.position.set(0, 2.0, 1.85);
      g.add(body, roof, sign);
      if (medic) {
        const red = new THREE.MeshBasicMaterial({ color: "#e53935" });
        const a = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.3), red), b = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.9), red);
        a.position.set(0, 1.0, 1.81); b.position.set(0, 1.0, 1.81);
        g.add(a, b);
      }
      break;
    }
  }
  return g;
}

// A shuttle stop: a post with a sign and a bench.
function shuttleStop(THREE, it) {
  const g = new THREE.Group();
  const post = box(THREE, 0.12, 3, 0.12, "#c9c9d4");
  post.position.set(-1.1, 1.5, 0);
  const sign = signBoard(THREE, `🚌 ${it.label}`, 3.4, 0.6, "#ffd36b");
  sign.position.set(0.4, 2.7, 0);
  const bench = box(THREE, 2, 0.1, 0.5, "#8a6a4f");
  bench.position.set(0.3, 0.45, -0.4);
  g.add(post, sign, bench);
  for (const x of [-0.6, 1.2]) { const leg = box(THREE, 0.08, 0.45, 0.4, "#555"); leg.position.set(x, 0.22, -0.4); g.add(leg); }
  return g;
}

// ---------- Stage signs ----------
// Over every stage: its name and genre, and what's playing (client/dj-ui.js calls set()).
function stageSign(THREE, it) {
  const main = it.variant !== "side";
  const w = main ? 18 : 10, h = main ? 2.8 : 1.6;
  const c = document.createElement("canvas");
  c.width = Math.min(2048, Math.round(w * 80)); c.height = Math.round(h * 80);
  const x = c.getContext("2d");
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const fit = (text, size, weight) => {
    x.font = `${weight} ${size}px system-ui, sans-serif`;
    while (x.measureText(text).width > c.width * 0.92 && size > 10) { size -= 2; x.font = `${weight} ${size}px system-ui, sans-serif`; }
  };
  const draw = (line1, line2) => {
    x.fillStyle = "#140c1e"; x.fillRect(0, 0, c.width, c.height);
    x.strokeStyle = "#ff4fa3"; x.lineWidth = Math.max(5, c.height * 0.05);
    x.strokeRect(x.lineWidth / 2, x.lineWidth / 2, c.width - x.lineWidth, c.height - x.lineWidth);
    x.textAlign = "center"; x.textBaseline = "middle";
    x.fillStyle = "#ffffff"; fit(line1, Math.round(c.height * 0.4), 800);
    x.fillText(line1, c.width / 2, c.height * 0.34);
    x.fillStyle = "#ffd36b"; fit(line2, Math.round(c.height * 0.27), 600);
    x.fillText(line2, c.width / 2, c.height * 0.72);
    tex.needsUpdate = true;
  };
  const g = new THREE.Group();
  const geo = new THREE.PlaneGeometry(w, h), mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
  const front = new THREE.Mesh(geo, mat), back = new THREE.Mesh(geo, mat);
  back.rotation.y = Math.PI;
  g.add(front, back);
  g.position.set(0, main ? 17.2 : 5.6, main ? -5.8 : 4.3);
  const title = `${it.label} · ${genreName(it.genre)}`;
  let last = "";
  g.userData.set = (line1 = title, line2 = "No set on right now") => {
    const key = line1 + "\n" + line2;
    if (key !== last) { last = key; draw(line1, line2); }
  };
  g.userData.title = title;
  g.userData.set();
  return g;
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
