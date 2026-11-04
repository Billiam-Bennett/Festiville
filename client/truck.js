// A vendor's food truck, built from simple shapes so vendors can design their own in the browser.
// Used by the 3D world (client/world.js) and by the live preview in the vendor editor (client/vendor.js).
// The design (colors + a roof topper) is saved on the vendor's listing, so it shows up in the game
// the moment they save, exactly like their menu.

import { TRUCK, sanitizeTruck } from "../shared/truck-data.js";
export { TRUCK, sanitizeTruck };

const box = (THREE, w, h, d, color, emissive) =>
  new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, emissive: emissive ?? "#000000" }));
const cyl = (THREE, rt, rb, h, color, seg = 16) =>
  new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), new THREE.MeshStandardMaterial({ color }));

// Builds the food truck as a THREE.Group. opts: { name, color (fallback), truck }.
// The visible parts live in an inner group so the whole thing can be rebuilt in place when the
// vendor changes their design, without disturbing the tap/fade hit box:
//   g.userData.setName(text)      repaints the sign (vendors can rename live)
//   g.userData.setTruck(opts)     rebuilds the visible parts for a new design
//   g.userData.visuals            the inner group holding the visible meshes
export function buildTruck(THREE, opts = {}) {
  const g = new THREE.Group();
  const visuals = new THREE.Group();
  g.add(visuals);
  g.userData.visuals = visuals;

  const fill = (o = {}) => { populateTruck(THREE, visuals, o); g.userData.setName = visuals.userData.setName; };
  fill(opts);
  g.userData.setTruck = fill;

  // invisible box so taps anywhere on the truck register (client/venue-ui.js) — stays put on rebuilds
  const hit = new THREE.Mesh(new THREE.BoxGeometry(7.4, 5, 4.4), new THREE.MeshBasicMaterial({ visible: false }));
  hit.position.y = 2.5;
  hit.userData.isHitBox = true;
  g.add(hit);
  return g;
}

// A little emblem that sits on the roof.
// Fill (or refill) the visible parts of a truck into group `g`.
function populateTruck(THREE, g, { name = "", color = "#ff4fa3", truck } = {}) {
  // free the old parts first (setTruck rebuilds in place)
  for (const o of [...g.children]) { o.geometry?.dispose?.(); for (const m of [].concat(o.material ?? [])) { m.map?.dispose?.(); m.dispose?.(); } g.remove(o); }
  const t = { ...TRUCK.defaults, awning: color, stripe: color, ...(truck || {}) };

  const body = box(THREE, 7, 3, 3.2, t.body);           // truck body behind the counter
  body.position.set(0, 1.9, -1.2);
  g.add(body);
  const stripe = box(THREE, 7.02, 0.5, 3.22, t.stripe);
  stripe.position.set(0, 1.1, -1.2);
  g.add(stripe);
  const window_ = box(THREE, 4, 1.1, 0.05, "#1a1a1a", "#553311");
  window_.position.set(0, 2.2, 0.42);
  g.add(window_);
  const counter = box(THREE, 4.4, 0.12, 0.7, t.trim);
  counter.position.set(0, 1.6, 0.75);
  g.add(counter);
  const awning = box(THREE, 7.4, 0.12, 1.8, t.awning);
  awning.position.set(0, 3.5, 1.1);
  awning.rotation.x = -0.25;
  g.add(awning);
  for (let i = -3; i <= 3; i++) {                        // scalloped awning edge
    const tab = box(THREE, 0.9, 0.5, 0.06, t.awning);
    tab.position.set(i * 1.0, 3.2, 1.98);
    tab.rotation.x = -0.25;
    g.add(tab);
  }
  for (const wx of [-2.4, 2.4]) {
    const wheel = cyl(THREE, 0.45, 0.45, 0.3, "#1a1a1a", 14);
    wheel.rotation.x = Math.PI / 2;
    wheel.position.set(wx, 0.45, 0.3);
    g.add(wheel);
    const hub = cyl(THREE, 0.16, 0.16, 0.32, t.trim, 10);
    hub.rotation.x = Math.PI / 2;
    hub.position.set(wx, 0.45, 0.3);
    g.add(hub);
  }

  const topper = buildTopper(THREE, t.topper);
  if (topper) { topper.position.set(0, 3.5, -1.2); g.add(topper); }

  const sign = signBoard(THREE, name, 6.4, 1.1, t.awning);
  sign.position.set(0, 4.3, 0.2);
  g.add(sign);
  g.userData.setName = sign.userData.setText;

  const lamp = new THREE.PointLight(t.awning, 6, 9);
  lamp.position.set(0, 3, 2.2);
  g.add(lamp);
}

function buildTopper(THREE, kind) {
  const g = new THREE.Group();
  const mat = (c) => new THREE.MeshStandardMaterial({ color: c });
  const add = (mesh, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => { mesh.position.set(x, y, z); mesh.rotation.set(rx, ry, rz); g.add(mesh); return mesh; };
  switch (kind) {
    case "hotdog": {
      add(new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 1.4, 6, 12), mat("#e6a15a")), 0, 0.9, 0, 0, 0, Math.PI / 2);        // bun
      add(new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 1.5, 6, 12), mat("#b5402f")), 0, 1.05, 0, 0, 0, Math.PI / 2);      // sausage
      add(new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.04, 0.12), mat("#f6d743")), 0, 1.28, 0, 0, 0, 0.15);                  // mustard
      break;
    }
    case "burger": {
      add(cyl(THREE, 0.7, 0.7, 0.3, "#e6a15a"), 0, 0.7);        // bottom bun
      add(cyl(THREE, 0.72, 0.72, 0.18, "#5a3a1e"), 0, 0.95);    // patty
      add(cyl(THREE, 0.75, 0.75, 0.1, "#3fae52"), 0, 1.08);     // lettuce
      add(new THREE.Mesh(new THREE.SphereGeometry(0.72, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat("#e6a15a")), 0, 1.15); // top bun
      break;
    }
    case "taco": {
      const shell = add(new THREE.Mesh(new THREE.SphereGeometry(0.8, 16, 12, 0, Math.PI, 0, Math.PI), mat("#f3c969")), 0, 0.9, 0, Math.PI / 2, 0, 0);
      shell.scale.set(1, 0.6, 1);
      add(new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.2, 0.5), mat("#3fae52")), 0, 1.0);
      add(new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.2, 0.4), mat("#b5402f")), 0, 1.12);
      break;
    }
    case "icecream": {
      add(new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.1, 14), mat("#d9a441")), 0, 0.75, 0, Math.PI, 0, 0);   // cone
      add(new THREE.Mesh(new THREE.SphereGeometry(0.42, 14, 12), mat("#f7b2d9")), 0, 1.35);
      add(new THREE.Mesh(new THREE.SphereGeometry(0.34, 14, 12), mat("#fff0b3")), 0, 1.75);
      add(new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 8), mat("#b5402f")), 0, 2.05);                       // cherry
      break;
    }
    case "pizza": {
      const sl = add(new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.12, 24, 1, false, 0, Math.PI / 2.2), mat("#f2c94c")), 0, 1.0);
      const topMat = mat("#e07a3f");
      for (const [x, z] of [[0.3, 0.1], [0.45, -0.1], [0.2, -0.25]]) add(new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.14, 8), topMat), x, 1.07, z);
      break;
    }
    case "donut": {
      add(new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.26, 12, 20), mat("#f29ad0")), 0, 1.1, 0, Math.PI / 2, 0, 0);
      break;
    }
    case "coffee": {
      add(cyl(THREE, 0.5, 0.42, 1.0, "#f3efe6"), 0, 1.0);
      add(new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.08, 8, 16), mat("#f3efe6")), 0.55, 1.0, 0, 0, 0, Math.PI / 2);  // handle
      add(cyl(THREE, 0.52, 0.52, 0.12, "#b5402f"), 0, 1.5);   // lid rim
      break;
    }
    case "star": {
      const s = add(new THREE.Mesh(new THREE.OctahedronGeometry(0.7), new THREE.MeshStandardMaterial({ color: "#ffd36b", emissive: "#a9780f" })), 0, 1.1);
      s.scale.set(1, 1.3, 0.5);
      break;
    }
    default: return null;
  }
  return g;
}

// A double-sided sign that can be repainted live (same look as the world's signs).
function signBoard(THREE, text, w, h, color) {
  const c = document.createElement("canvas");
  const px = 96;
  c.width = Math.min(2048, Math.round(w * px)); c.height = Math.round(h * px);
  const x = c.getContext("2d");
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const draw = (text) => {
    x.fillStyle = "#1c1228"; x.fillRect(0, 0, c.width, c.height);
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
