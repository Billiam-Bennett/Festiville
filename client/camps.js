// Player camps in the Campground: draws every camp (spot outline, owner stake, and the items set up in
// it) and keeps them in sync with the server. Also draws the "would my spot fit here?" preview
// while the Camp tab of the shop is open.
//
// Each item is built from simple shapes in meters (like client/accessories.js). Where items stand
// comes from shared/camps.js (campSlots), so a camp looks the same on every screen.
import { plotById, campItemById, cleanLedColor } from "../shared/economy.js";
import { campSlots, snap } from "../shared/camps.js";

const std = (THREE, color, o = {}) => new THREE.MeshStandardMaterial({ color, ...o });
const glow = (THREE, color, k = 1) => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: k });

// A color per owner, so tents and flags differ between camps.
function ownerColor(name) {
  let h = 0;
  for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return ["#f2994a", "#2d9cdb", "#eb5757", "#27ae60", "#9b51e0", "#f2c94c", "#ff4fa3", "#4fe3ff"][h % 8];
}

function textTexture(THREE, text, { w = 512, h = 128, color = "#fff", bg = "rgba(0,0,0,0)", font = "bold 72px system-ui, sans-serif" } = {}) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const x = c.getContext("2d");
  x.fillStyle = bg; x.fillRect(0, 0, w, h);
  x.font = font; x.textAlign = "center"; x.textBaseline = "middle";
  x.shadowColor = color; x.shadowBlur = 18;
  x.fillStyle = color; x.fillText(text, w / 2, h / 2, w - 20);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------- Items ----------
// Each returns a Group standing on y=0 at its own origin (facing +z, the front of the camp).
// g.userData.tick(dt, t) animates it if present.
// Items that sit on another one (item.on) are built at that item's origin: the tent's for a tent
// flag or tapestry, the fire pit's for a grate or cooking pot. TENT_TOP is how tall each tent is.
const TENT_TOP = { tent_basic: 1.2, tent_bell: 2.0, tent_led: 1.5 };
function buildItem(THREE, id, camp, plot) {
  const tentTop = TENT_TOP[(camp.items ?? []).find((i) => campItemById(i)?.group === "tent")] ?? 1.2;
  const g = new THREE.Group();
  const add = (m, x = 0, y = 0, z = 0) => { m.position.set(x, y, z); g.add(m); return m; };
  const col = ownerColor(camp.owner);
  switch (id) {
    case "tent_basic": {
      const tent = add(new THREE.Mesh(new THREE.ConeGeometry(0.95, 1.2, 4, 1), std(THREE, col, { flatShading: true })), 0, 0.6, 0);
      tent.rotation.y = Math.PI / 4;
      add(new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.6), std(THREE, "#20142c")), 0, 0.3, 0.68).rotation.x = -0.5;
      break;
    }
    case "tent_bell": {
      add(new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.7, 16), std(THREE, "#f4efe2")), 0, 0.35, 0);
      add(new THREE.Mesh(new THREE.ConeGeometry(1.08, 1.0, 16), std(THREE, "#f4efe2")), 0, 1.2, 0);
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.4, 6), std(THREE, "#8a6a4f")), 0, 1.8, 0);
      add(new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.65), std(THREE, "#5a4636")), 0, 0.33, 1.01);
      break;
    }
    case "chairs": {
      for (const x of [-0.3, 0.3]) {
        add(new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.05, 0.4), std(THREE, col)), x, 0.42, 0);
        add(new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.45, 0.05), std(THREE, col)), x, 0.65, -0.2).rotation.x = -0.2;
        for (const [lx, lz] of [[-0.18, -0.17], [0.18, -0.17], [-0.18, 0.17], [0.18, 0.17]]) add(new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.42, 5), std(THREE, "#333")), x + lx, 0.21, lz);
      }
      break;
    }
    case "cooler": {
      add(new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.38, 0.38), std(THREE, "#2d9cdb")), 0, 0.19, 0);
      add(new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.06, 0.4), std(THREE, "#f4f1ea")), 0, 0.41, 0);
      break;
    }
    case "firepit": {
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        add(new THREE.Mesh(new THREE.DodecahedronGeometry(0.11), std(THREE, "#777", { flatShading: true })), Math.cos(a) * 0.4, 0.07, Math.sin(a) * 0.4);
      }
      const flame = add(new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.55, 8), glow(THREE, "#ff7a3d", 1.6)), 0, 0.3, 0);
      const inner = add(new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.35, 8), glow(THREE, "#ffd36b", 2)), 0, 0.22, 0);
      g.userData.tick = (dt, t) => { const k = 1 + Math.sin(t * 11) * 0.08 + Math.sin(t * 7.3) * 0.06; flame.scale.set(1, k, 1); inner.scale.set(1, 2 - k, 1); };
      break;
    }
    case "canopy": {
      for (const [x, z] of [[-0.65, -0.65], [0.65, -0.65], [-0.65, 0.65], [0.65, 0.65]]) add(new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 2, 6), std(THREE, "#ddd")), x, 1, z);
      add(new THREE.Mesh(new THREE.ConeGeometry(1.0, 0.35, 4), std(THREE, col, { side: THREE.DoubleSide })), 0, 2.15, 0).rotation.y = Math.PI / 4;
      break;
    }
    case "hammock": {
      for (const x of [-0.6, 0.6]) add(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.2, 6), std(THREE, "#8a6a4f")), x, 0.6, 0);
      const bed = add(new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.12, 6, 16, Math.PI), std(THREE, col)), 0, 0.95, 0);
      bed.rotation.z = Math.PI; bed.scale.set(1, 0.6, 1.4);
      g.userData.tick = (dt, t) => { bed.rotation.x = Math.sin(t * 1.2) * 0.12; };
      break;
    }
    case "pa": {
      // Two speaker stacks that thump to an imaginary beat.
      const cones = [];
      for (const x of [-0.42, 0.42]) {
        add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.1, 0.45), std(THREE, "#16161c")), x, 0.55, 0);
        for (const [y, r] of [[0.35, 0.17], [0.8, 0.1]]) {
          const c = add(new THREE.Mesh(new THREE.CircleGeometry(r, 18), std(THREE, "#3a3a46", { emissive: "#ff4fa3", emissiveIntensity: 0.15 })), x, y, 0.23);
          cones.push(c);
        }
      }
      add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.3), glow(THREE, "#5ad1ff", 0.8)), 0, 0.05, 0.3);   // mixer glow
      g.userData.tick = (dt, t) => { const k = 1 + Math.max(0, Math.sin(t * Math.PI * 4)) * 0.12; for (const c of cones) { c.scale.setScalar(k); c.material.emissiveIntensity = (k - 1) * 4; } };
      break;
    }
    case "lights": {
      // Bulbs strung around the spot's edge on four corner poles.
      const hw = plot.w / 2, hd = plot.d / 2;
      const corners = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
      for (const [x, z] of corners) add(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 2, 5), std(THREE, "#555")), x, 1, z);
      const bulbs = [];
      const cols = ["#ffd36b", "#ff4fa3", "#5ad1ff", "#7ee081"];
      for (let s = 0; s < 4; s++) {
        const [ax, az] = corners[s], [bx, bz] = corners[(s + 1) % 4];
        const n = Math.max(3, Math.round(Math.hypot(bx - ax, bz - az) / 0.5));
        for (let i = 1; i < n; i++) {
          const f = i / n, sag = Math.sin(f * Math.PI) * 0.25;
          bulbs.push(add(new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6), glow(THREE, cols[(s * 7 + i) % 4], 1.2)), ax + (bx - ax) * f, 1.95 - sag, az + (bz - az) * f));
        }
      }
      g.userData.tick = (dt, t) => bulbs.forEach((b, i) => (b.material.emissiveIntensity = 0.8 + Math.max(0, Math.sin(t * 2 + i)) * 0.8));
      break;
    }
    case "flag": {
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 3.2, 6), std(THREE, "#ccc")), -plot.w / 2 + 0.15, 1.6, -plot.d / 2 + 0.15);
      const flag = add(new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.5, 6, 1), std(THREE, col, { side: THREE.DoubleSide })), -plot.w / 2 + 0.55, 2.9, -plot.d / 2 + 0.15);
      const pos = flag.geometry.attributes.position, base = pos.array.slice();
      g.userData.tick = (dt, t) => {
        for (let i = 0; i < pos.count; i++) { const x = base[i * 3]; pos.array[i * 3 + 2] = Math.sin(t * 4 + x * 6) * 0.08 * (x + 0.4); }
        pos.needsUpdate = true;
      };
      break;
    }
    case "neon": {
      // The owner's name in neon over the front of the camp.
      const sign = add(new THREE.Mesh(new THREE.PlaneGeometry(Math.min(2.6, plot.w), 0.6), new THREE.MeshBasicMaterial({ map: textTexture(THREE, camp.owner, { color: "#ff6bd0" }), transparent: true, side: THREE.DoubleSide, toneMapped: false })), 0, 2.3, plot.d / 2 - 0.05);
      for (const x of [-0.9, 0.9]) add(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 2.0, 5), std(THREE, "#333")), Math.max(-plot.w / 2, Math.min(plot.w / 2, x)), 1.0, plot.d / 2 - 0.05);
      g.userData.tick = (dt, t) => { sign.material.opacity = Math.sin(t * 13) > -0.97 ? 1 : 0.4; };   // the odd flicker
      break;
    }
    case "lasers": {
      // Emitters on the front corners sweeping beams into the sky.
      const beams = [];
      for (const [x, c] of [[-plot.w / 2 + 0.2, "#7ee081"], [plot.w / 2 - 0.2, "#ff4fa3"]]) {
        add(new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.2, 0.25), std(THREE, "#222")), x, 0.1, plot.d / 2 - 0.2);
        const pivot = add(new THREE.Group(), x, 0.2, plot.d / 2 - 0.2);
        for (let i = 0; i < 3; i++) {
          const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 14, 4), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
          beam.position.y = 7;
          const arm = new THREE.Group();
          arm.rotation.z = (i - 1) * 0.25;
          arm.add(beam);
          pivot.add(arm);
        }
        beams.push(pivot);
      }
      g.userData.tick = (dt, t) => beams.forEach((p, i) => { p.rotation.z = Math.sin(t * 0.9 + i * 2) * 0.6; p.rotation.x = Math.cos(t * 0.7 + i) * 0.35; });
      break;
    }
    case "discoball": {
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.6, 3), std(THREE, "#888")), 0, 3.1, 0);
      const ball = add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.28, 1), std(THREE, "#e8e8f0", { metalness: 1, roughness: 0.15, flatShading: true, emissive: "#6b6b80", emissiveIntensity: 0.4 })), 0, 2.7, 0);
      const dots = [];
      for (let i = 0; i < 10; i++) dots.push(add(new THREE.Mesh(new THREE.CircleGeometry(0.06, 8), new THREE.MeshBasicMaterial({ color: ["#ff4fa3", "#5ad1ff", "#ffd36b"][i % 3], transparent: true, opacity: 0.8, toneMapped: false })), 0, 0.02, 0));
      dots.forEach((d) => (d.rotation.x = -Math.PI / 2));
      g.userData.tick = (dt, t) => {
        ball.rotation.y += dt * 0.8;
        dots.forEach((d, i) => { const a = t * 0.8 + (i / dots.length) * Math.PI * 2, r = 0.4 + (i % 3) * 0.35; d.position.set(Math.cos(a) * Math.min(r, plot.w / 2 - 0.1), 0.02, Math.sin(a) * Math.min(r, plot.d / 2 - 0.1)); });
      };
      break;
    }
    case "tent_led": {
      // The premium tent: a dome that glows in the colour its owner picked, with light bands that pulse.
      const c = cleanLedColor(camp.led);
      const shell = add(new THREE.Mesh(new THREE.SphereGeometry(1.1, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: "#f4f1ea", emissive: c, emissiveIntensity: 0.55, transparent: true, opacity: 0.92 })), 0, 0, 0);
      shell.scale.y = 1.35;
      const bands = [];
      for (let i = 0; i < 4; i++) {
        const band = add(new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.025, 6, 24, Math.PI), glow(THREE, c, 1.6)), 0, 0, 0);
        band.rotation.y = (i / 4) * Math.PI; band.scale.y = 1.35;
        bands.push(band);
      }
      add(new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.7), std(THREE, "#20142c")), 0, 0.35, 1.06).rotation.x = -0.25;
      g.userData.tick = (dt, t) => {
        shell.material.emissiveIntensity = 0.45 + Math.sin(t * 1.3) * 0.15;
        bands.forEach((b, i) => (b.material.emissiveIntensity = 1.2 + Math.sin(t * 2.2 + i * 1.5) * 0.8));
      };
      break;
    }
    case "tapestry": {
      // Hangs on the front of the tent with the owner's name on it.
      const cloth = add(new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.55), new THREE.MeshBasicMaterial({ map: textTexture(THREE, camp.owner, { w: 384, h: 232, bg: col, color: "#ffffff", font: "bold 64px system-ui, sans-serif" }), side: THREE.DoubleSide })), 0, Math.min(1.0, tentTop * 0.62), 1.14);
      cloth.rotation.x = -0.12;
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.0, 5), std(THREE, "#8a6a4f")), 0, cloth.position.y + 0.29, 1.12).rotation.z = Math.PI / 2;
      break;
    }
    case "tentflag": {
      // A pennant on a tall pole out of the tent's peak, so the camp can be spotted from far off.
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 2.2, 5), std(THREE, "#ddd")), 0, tentTop + 1.0, 0);
      const flag = add(new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.4, 6, 1), glow(THREE, col, 0.5)), 0.37, tentTop + 1.85, 0);
      flag.material.side = THREE.DoubleSide;
      const pos = flag.geometry.attributes.position, base = pos.array.slice();
      g.userData.tick = (dt, t) => {
        for (let i = 0; i < pos.count; i++) { const x = base[i * 3]; pos.array[i * 3 + 2] = Math.sin(t * 5 + x * 7) * 0.07 * (x + 0.35); }
        pos.needsUpdate = true;
      };
      break;
    }
    case "couch": {
      const vinyl = std(THREE, col, { roughness: 0.25 });
      add(new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.9, 4, 10), vinyl), 0, 0.24, 0.05).rotation.z = Math.PI / 2;
      add(new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.9, 4, 10), vinyl), 0, 0.55, -0.22).rotation.z = Math.PI / 2;
      for (const x of [-0.62, 0.62]) add(new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.3, 4, 8), vinyl), x, 0.42, 0).rotation.x = Math.PI / 2;
      break;
    }
    case "picnictable": {
      const wood = std(THREE, "#8a6a4f");
      add(new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.06, 0.6), wood), 0, 0.72, 0);
      for (const z of [-0.5, 0.5]) add(new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.05, 0.22), wood), 0, 0.42, z);
      for (const x of [-0.45, 0.45]) add(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.72, 1.1), wood), x, 0.36, 0);
      break;
    }
    case "rug": {
      // A patterned mat under the whole camp.
      const w = plot.w - 0.3, d = plot.d - 0.3;
      add(new THREE.Mesh(new THREE.PlaneGeometry(w, d), std(THREE, "#7a3b52")), 0, 0.03, 0).rotation.x = -Math.PI / 2;
      add(new THREE.Mesh(new THREE.RingGeometry(Math.min(w, d) * 0.28, Math.min(w, d) * 0.34, 24), std(THREE, "#f2c94c")), 0, 0.035, 0).rotation.x = -Math.PI / 2;
      add(new THREE.Mesh(new THREE.PlaneGeometry(w - 0.3, d - 0.3), new THREE.MeshStandardMaterial({ color: col, transparent: true, opacity: 0.35, depthWrite: false })), 0, 0.032, 0).rotation.x = -Math.PI / 2;
      break;
    }
    case "grate": {
      for (const [x, z] of [[-0.32, -0.32], [0.32, -0.32], [-0.32, 0.32], [0.32, 0.32]]) add(new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.5, 5), std(THREE, "#333")), x, 0.25, z);
      for (let i = -3; i <= 3; i++) add(new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.68), std(THREE, "#222")), i * 0.1, 0.5, 0);
      add(new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.02, 0.02), std(THREE, "#222")), 0, 0.5, 0.33);
      add(new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.02, 0.02), std(THREE, "#222")), 0, 0.5, -0.33);
      break;
    }
    case "cookpot": {
      // A pot hanging from a tripod over the fire.
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        const leg = add(new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1.45, 5), std(THREE, "#4a4a4a")), Math.cos(a) * 0.3, 0.68, Math.sin(a) * 0.3);
        leg.rotation.z = Math.cos(a) * 0.42; leg.rotation.x = -Math.sin(a) * 0.42;
      }
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.55, 3), std(THREE, "#222")), 0, 1.05, 0);
      add(new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8, 0, Math.PI * 2, Math.PI / 2.6, Math.PI), std(THREE, "#1c1c22", { metalness: 0.6, roughness: 0.5 })), 0, 0.78, 0);
      const steam = add(new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 6), new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.35, depthWrite: false })), 0, 0.95, 0);
      g.userData.tick = (dt, t) => { const k = (t * 0.6) % 1; steam.position.y = 0.9 + k * 0.6; steam.material.opacity = 0.35 * (1 - k); steam.scale.setScalar(1 + k); };
      break;
    }
    case "fireworks": {
      // A launcher at the back of the camp that sends up a burst every few seconds.
      add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.25, 0.35), std(THREE, "#2a2a33")), 0, 0.125, -plot.d / 2 + 0.3);
      for (const x of [-0.14, 0, 0.14]) add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.4, 8), std(THREE, "#b03a3a")), x, 0.4, -plot.d / 2 + 0.3);
      const N = 36, cols = ["#ff4fa3", "#ffd36b", "#5ad1ff", "#7ee081", "#b44fff"];
      const geo = new THREE.BufferGeometry();
      const dirs = Array.from({ length: N }, (_, i) => {
        const a = (i / N) * Math.PI * 2 * 3, e = Math.acos(1 - 2 * ((i + 0.5) / N));
        return [Math.sin(e) * Math.cos(a), Math.cos(e), Math.sin(e) * Math.sin(a)];
      });
      geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(N * 3), 3));
      const burst = new THREE.Points(geo, new THREE.PointsMaterial({ color: cols[0], size: 0.35, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
      burst.frustumCulled = false;
      add(burst, 0, 0, -plot.d / 2 + 0.3);
      const rocket = add(new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 6), glow(THREE, "#ffd36b", 2)), 0, 0.6, -plot.d / 2 + 0.3);
      const PERIOD = 7, RISE = 1.1, TOP = 13;
      g.userData.tick = (dt, t) => {
        const k = t % PERIOD, shot = Math.floor(t / PERIOD);
        rocket.visible = k < RISE;
        rocket.position.y = 0.6 + (k / RISE) * (TOP - 0.6);
        const age = k - RISE;
        if (age < 0 || age > 2.4) { burst.material.opacity = 0; return; }
        burst.material.color.set(cols[shot % cols.length]);
        burst.material.opacity = Math.max(0, 1 - age / 2.4);
        const r = 4.5 * (1 - Math.exp(-age * 2.2)), arr = geo.attributes.position.array;
        for (let i = 0; i < N; i++) { arr[i * 3] = dirs[i][0] * r; arr[i * 3 + 1] = TOP + dirs[i][1] * r - age * age * 0.6; arr[i * 3 + 2] = dirs[i][2] * r; }
        geo.attributes.position.needsUpdate = true;
      };
      break;
    }
    case "totempole": {
      // A tall lit pole at the back-right corner with a glowing topper in the owner's colour.
      const x = plot.w / 2 - 0.2, z = -plot.d / 2 + 0.2;
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 3.6, 8), std(THREE, "#c9c9d4")), x, 1.8, z);
      const rings = [];
      for (let i = 0; i < 6; i++) rings.push(add(new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.02, 6, 12), glow(THREE, ["#ff4fa3", "#5ad1ff", "#ffd36b"][i % 3], 1.2)), x, 0.6 + i * 0.5, z));
      rings.forEach((r) => (r.rotation.x = Math.PI / 2));
      const top = add(new THREE.Mesh(new THREE.OctahedronGeometry(0.28), glow(THREE, col, 1.8)), x, 3.9, z);
      g.userData.tick = (dt, t) => { top.rotation.y += dt * 1.5; rings.forEach((r, i) => (r.material.emissiveIntensity = 0.6 + Math.max(0, Math.sin(t * 3 - i * 0.8)) * 1.6)); };
      break;
    }
    case "lanterns": {
      // Lanterns on posts at the middle of each side.
      const lamps = [];
      for (const [x, z] of [[0, -plot.d / 2], [plot.w / 2, 0], [0, plot.d / 2], [-plot.w / 2, 0]]) {
        add(new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 1.3, 6), std(THREE, "#5a4636")), x, 0.65, z);
        lamps.push(add(new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.24, 0.18), glow(THREE, "#ffcf8a", 1.5)), x, 1.42, z));
        add(new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.1, 4), std(THREE, "#2a2a2a")), x, 1.59, z).rotation.y = Math.PI / 4;
      }
      g.userData.tick = (dt, t) => lamps.forEach((l, i) => (l.material.emissiveIntensity = 1.3 + Math.sin(t * 9 + i * 2.1) * 0.15 + Math.sin(t * 2.3 + i) * 0.2));
      break;
    }
    case "glowsticks": {
      // Glow sticks planted along the border.
      const hw = plot.w / 2, hd = plot.d / 2, cols = ["#7ee081", "#ff4fa3", "#5ad1ff", "#ffd36b", "#b44fff"];
      const sticks = [];
      const side = (ax, az, bx, bz) => {
        const n = Math.max(2, Math.round(Math.hypot(bx - ax, bz - az) / 0.6));
        for (let i = 0; i < n; i++) {
          const f = (i + 0.5) / n;
          const st = add(new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.32, 5), glow(THREE, cols[sticks.length % cols.length], 1.6)), ax + (bx - ax) * f, 0.16, az + (bz - az) * f);
          st.rotation.z = ((sticks.length % 3) - 1) * 0.15;
          sticks.push(st);
        }
      };
      side(-hw, -hd, hw, -hd); side(hw, -hd, hw, hd); side(hw, hd, -hw, hd); side(-hw, hd, -hw, -hd);
      g.userData.tick = (dt, t) => sticks.forEach((s2, i) => (s2.material.emissiveIntensity = 1.1 + Math.sin(t * 1.5 + i * 0.7) * 0.5));
      break;
    }
    case "grill": {
      add(new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), std(THREE, "#1c1c22")), -0.35, 0.8, 0);
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.02, 12), glow(THREE, "#ff7a3d", 0.6)), -0.35, 0.8, 0);
      for (const [x, z] of [[-0.55, -0.15], [-0.15, -0.15], [-0.35, 0.2]]) add(new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.6, 5), std(THREE, "#555")), x, 0.3, z);
      add(new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.05, 0.5), std(THREE, "#8a6a4f")), 0.4, 0.78, 0);
      for (const [x, z] of [[0.1, -0.2], [0.7, -0.2], [0.1, 0.2], [0.7, 0.2]]) add(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.76, 5), std(THREE, "#555")), x, 0.38, z);
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.07, 0.14, 10), std(THREE, "#c0c0c8", { metalness: 0.7, roughness: 0.3 })), 0.3, 0.88, 0);
      add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.04, 0.14), std(THREE, "#f4f1ea")), 0.58, 0.83, 0.05);
      break;
    }
    case "tacostand": {
      // A small version of Mama Rae's: counter, striped awning, sign.
      add(new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.85, 0.5), std(THREE, "#ffb347")), 0, 0.425, 0);
      add(new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.05, 0.6), std(THREE, "#f4f1ea")), 0, 0.875, 0);
      for (const x of [-0.62, 0.62]) add(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.9, 5), std(THREE, "#ddd")), x, 0.95, -0.22);
      for (let i = 0; i < 6; i++) add(new THREE.Mesh(new THREE.BoxGeometry(0.235, 0.03, 0.8), std(THREE, i % 2 ? "#f4f1ea" : "#e84a5f")), -0.585 + i * 0.235, 1.85 - 0.0, 0.1).rotation.x = 0.28;
      add(new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.28), new THREE.MeshBasicMaterial({ map: textTexture(THREE, "TACOS", { w: 384, h: 96, bg: "#2a1b3d", color: "#ffd36b", font: "bold 64px system-ui, sans-serif" }) })), 0, 0.5, 0.255);
      break;
    }
    case "drinkstation": {
      add(new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.8, 0.45), std(THREE, "#f2c94c")), 0, 0.4, 0);
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.4, 12), new THREE.MeshStandardMaterial({ color: "#fff3a0", transparent: true, opacity: 0.75 })), -0.22, 1.0, 0);
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.04, 12), std(THREE, "#f4f1ea")), -0.22, 1.22, 0);
      for (const x of [0.12, 0.26, 0.4]) add(new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.035, 0.12, 8), std(THREE, "#eb5757")), x, 0.86, 0.05);
      add(new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.26), new THREE.MeshBasicMaterial({ map: textTexture(THREE, "LEMONADE", { w: 384, h: 96, bg: "#ffffff", color: "#c98a00", font: "bold 56px system-ui, sans-serif" }) })), 0, 0.45, 0.23);
      break;
    }
    case "moviescreen": {
      for (const x of [-0.75, 0.75]) add(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.1, 6), std(THREE, "#333")), x, 1.05, -0.3);
      const screen = add(new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.9), new THREE.MeshStandardMaterial({ color: "#ffffff", emissive: "#5ad1ff", emissiveIntensity: 0.7 })), 0, 1.55, -0.29);
      add(new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.0, 0.03), std(THREE, "#16161c")), 0, 1.55, -0.32);
      add(new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.14, 0.3), std(THREE, "#2a2a33")), 0, 0.5, 0.5);
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.45, 5), std(THREE, "#555")), 0, 0.22, 0.5);
      const hues = ["#5ad1ff", "#ffd36b", "#ff4fa3", "#7ee081", "#f4f1ea"];
      g.userData.tick = (dt, t) => { screen.material.emissive.set(hues[Math.floor(t / 2.5) % hues.length]); screen.material.emissiveIntensity = 0.6 + Math.sin(t * 17) * 0.06; };
      break;
    }
    case "hottub": {
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.68, 0.68, 0.6, 20, 1, true), std(THREE, "#8a6a4f", { side: THREE.DoubleSide })), 0, 0.3, 0);
      add(new THREE.Mesh(new THREE.TorusGeometry(0.68, 0.05, 6, 20), std(THREE, "#5a4636")), 0, 0.6, 0).rotation.x = Math.PI / 2;
      const water = add(new THREE.Mesh(new THREE.CircleGeometry(0.66, 20), new THREE.MeshStandardMaterial({ color: "#4fc3ff", emissive: "#2d9cdb", emissiveIntensity: 0.6, transparent: true, opacity: 0.85 })), 0, 0.52, 0);
      water.rotation.x = -Math.PI / 2;
      const bubbles = [];
      for (let i = 0; i < 8; i++) bubbles.push(add(new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 6), new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.7 })), 0, 0.53, 0));
      g.userData.tick = (dt, t) => bubbles.forEach((b, i) => { const k = (t * 0.9 + i * 0.37) % 1, a = i * 2.4; b.position.set(Math.cos(a) * 0.4, 0.5 + k * 0.12, Math.sin(a) * 0.4); b.material.opacity = 0.7 * (1 - k); });
      break;
    }
    case "photoframe": {
      // A big picture frame to stand behind for photos.
      const frame = glow(THREE, "#ffd36b", 0.5);
      add(new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.12, 0.08), frame), 0, 2.0, 0);
      add(new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.12, 0.08), frame), 0, 0.75, 0);
      for (const x of [-0.69, 0.69]) add(new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.37, 0.08), frame), x, 1.375, 0);
      for (const x of [-0.69, 0.69]) add(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.7, 6), std(THREE, "#555")), x, 0.35, 0);
      add(new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.22), new THREE.MeshBasicMaterial({ map: textTexture(THREE, `${camp.owner}'s camp`, { w: 512, h: 88, color: "#ffffff", font: "bold 48px system-ui, sans-serif" }), transparent: true, side: THREE.DoubleSide })), 0, 2.2, 0);
      break;
    }
    case "signpost": {
      // Arrows at the front-right corner.
      const x = plot.w / 2 - 0.15, z = plot.d / 2 - 0.15;
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.2, 6), std(THREE, "#8a6a4f")), x, 1.1, z);
      [["MAIN STAGE", "#ff4fa3", 0.5], ["TACOS", "#ffb347", -0.9], ["MY TENT", col, 2.6]].forEach(([label, c, rot], i) => {
        const arrow = add(new THREE.Mesh(new THREE.PlaneGeometry(0.85, 0.2), new THREE.MeshBasicMaterial({ map: textTexture(THREE, label, { w: 340, h: 80, bg: c, color: "#ffffff", font: "bold 44px system-ui, sans-serif" }), side: THREE.DoubleSide })), x, 2.0 - i * 0.28, z);
        arrow.rotation.y = rot;
      });
      break;
    }
    case "flowers": {
      // Flowers just inside the border.
      const hw = plot.w / 2 - 0.22, hd = plot.d / 2 - 0.22, cols = ["#ff7ad9", "#ffd36b", "#ffffff", "#eb5757", "#b44fff"];
      let n = 0;
      const side = (ax, az, bx, bz) => {
        const count = Math.max(2, Math.round(Math.hypot(bx - ax, bz - az) / 0.45));
        for (let i = 0; i < count; i++) {
          const f = (i + 0.5) / count, x = ax + (bx - ax) * f, z = az + (bz - az) * f;
          add(new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.26, 4), std(THREE, "#27ae60")), x, 0.13, z);
          add(new THREE.Mesh(new THREE.DodecahedronGeometry(0.07), std(THREE, cols[n++ % cols.length], { flatShading: true })), x, 0.3, z);
        }
      };
      side(-hw, -hd, hw, -hd); side(hw, -hd, hw, hd); side(hw, hd, -hw, hd); side(-hw, hd, -hw, -hd);
      break;
    }
    case "dog": {
      // A dog that hangs out at the front of the camp: sits, wags, and wanders a little.
      const fur = std(THREE, "#b8793a"), dark = std(THREE, "#5a3a1c");
      const dog = add(new THREE.Group(), plot.w / 2 - 0.7, 0, plot.d / 2 - 0.5);
      const part = (m, x, y, z) => { m.position.set(x, y, z); dog.add(m); return m; };
      part(new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.2, 0.5), fur), 0, 0.3, 0);
      const head = part(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.18, 0.2), fur), 0, 0.46, 0.3);
      part(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.12), dark), 0, 0.42, 0.44);
      for (const x of [-0.09, 0.09]) part(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 0.08), dark), x, 0.58, 0.26);
      for (const [x, z] of [[-0.08, 0.18], [0.08, 0.18], [-0.08, -0.18], [0.08, -0.18]]) part(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.2, 0.06), fur), x, 0.1, z);
      const tail = part(new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.22), fur), 0, 0.42, -0.32);
      tail.rotation.x = -0.7;
      const home = dog.position.clone();
      g.userData.tick = (dt, t) => {
        tail.rotation.y = Math.sin(t * 12) * 0.6;
        head.rotation.z = Math.sin(t * 0.7) * 0.15;
        const a = t * 0.35;
        dog.position.set(home.x + Math.cos(a) * 0.35, 0, home.z + Math.sin(a) * 0.2);
        dog.rotation.y = -a + Math.PI;
      };
      break;
    }
    default: return null;
  }
  return g;
}

// ---------- A whole camp ----------
function buildCamp(THREE, camp) {
  const plot = plotById(camp.plot);
  const root = new THREE.Group();
  root.position.set(camp.x, 0, camp.z);
  if (!plot) return root;
  const col = ownerColor(camp.owner);
  // Ground: a slightly darker patch with a rope outline.
  const pad = new THREE.Mesh(new THREE.PlaneGeometry(plot.w, plot.d), new THREE.MeshStandardMaterial({ color: "#3a6332", transparent: true, opacity: 0.7, depthWrite: false }));
  pad.rotation.x = -Math.PI / 2; pad.position.y = 0.02;
  root.add(pad);
  const edge = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, z]) => new THREE.Vector3((x * plot.w) / 2, 0.04, (z * plot.d) / 2))), new THREE.LineBasicMaterial({ color: col }));
  root.add(edge);
  // Owner stake at the front left.
  const stake = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.6, 0.05), std(THREE, "#8a6a4f"));
  stake.position.set(-plot.w / 2 + 0.1, 0.3, plot.d / 2 - 0.1);
  root.add(stake);
  const label = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.25), new THREE.MeshBasicMaterial({ map: textTexture(THREE, camp.owner, { w: 256, h: 72, font: "bold 40px system-ui, sans-serif", bg: "#f4efe2", color: "#2a1b3d" }), side: THREE.DoubleSide }));
  label.position.set(-plot.w / 2 + 0.1 + 0.45, 0.6, plot.d / 2 - 0.1);
  root.add(label);

  const slots = campSlots(camp.plot);
  let next = 1;
  const ticks = [];
  // Where each ground item stands, so things that sit on one (item.on) can be put in the same place.
  const placed = new Map();   // item id or group -> slot
  for (const id of camp.items ?? []) {
    const item = campItemById(id);
    if (item?.place !== "ground") continue;
    const s = item.group === "tent" ? slots[0] : slots[next++];
    if (s) { placed.set(id, s); if (item.group) placed.set(item.group, s); }
  }
  for (const id of camp.items ?? []) {
    const item = campItemById(id);
    if (!item) continue;
    const s = item.place === "ground" ? placed.get(id) : item.on ? placed.get(item.on) : null;
    if ((item.place === "ground" || item.on) && !s) continue;
    const obj = buildItem(THREE, id, camp, plot);
    if (!obj) continue;
    if (s) obj.position.set(s.x, 0, s.z);
    root.add(obj);
    if (obj.userData.tick) ticks.push(obj.userData.tick);
  }
  root.userData.tick = (dt, t) => ticks.forEach((f) => f(dt, t));
  return root;
}

export function setupCamps({ THREE, scene, mp }) {
  const room = mp.room;
  const group = new THREE.Group();
  scene.add(group);
  const camps = new Map();   // public id -> { data, obj }
  const listeners = new Set();
  let t = 0;

  function put(id, camp) {
    const old = camps.get(id);
    if (old) { group.remove(old.obj); dispose(old.obj); camps.delete(id); }
    if (camp) {
      const obj = buildCamp(THREE, camp);
      group.add(obj);
      camps.set(id, { data: camp, obj });
    }
    for (const fn of listeners) fn();
  }
  room.onMessage("camps", (list) => { for (const id of [...camps.keys()]) put(id, null); for (const c of list) put(c.id, c); });
  room.onMessage("camp", ({ id, camp }) => put(id, camp));
  room.send("camps");

  // The "your spot would go here" outline: green if it fits, red if not (the reason shows in the shop).
  let preview = null;
  function showPreview(plotId, x, z, ok) {
    const plot = plotById(plotId);
    if (!plot) return hidePreview();
    if (!preview || preview.userData.plot !== plotId) {
      hidePreview();
      preview = new THREE.Mesh(new THREE.PlaneGeometry(plot.w, plot.d), new THREE.MeshBasicMaterial({ color: "#7ee081", transparent: true, opacity: 0.35, depthWrite: false }));
      preview.rotation.x = -Math.PI / 2;
      preview.userData.plot = plotId;
      scene.add(preview);
    }
    preview.position.set(snap(x), 0.05, snap(z));
    preview.material.color.set(ok ? "#7ee081" : "#ff6b6b");
  }
  function hidePreview() { if (preview) { scene.remove(preview); preview.geometry.dispose(); preview = null; } }

  function update(dt) {
    t += dt;
    for (const { obj } of camps.values()) obj.userData.tick?.(dt, t);
  }

  return { update, showPreview, hidePreview, all: () => [...camps.values()].map((c) => c.data), onChange: (fn) => listeners.add(fn) };
}

function dispose(obj) {
  obj.traverse((n) => {
    n.geometry?.dispose?.();
    for (const m of [n.material].flat()) { m?.map?.dispose?.(); m?.dispose?.(); }
  });
}

