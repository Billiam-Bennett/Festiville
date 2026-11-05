// The 3D shapes for cosmetic accessories (see shared/accessories.js for the list the server validates).
// Each is built in meters and attached near a character bone by client/character.js:
//   head/face → head bone, back → upper spine, hand → right hand.
// buildAccessory returns { slot, group, offset:[x,y,z], spin? } or null for an unknown id.
import { accessoryById } from "../shared/accessories.js";

const std = (THREE, c, opts = {}) => new THREE.MeshStandardMaterial({ color: c, ...opts });
const box = (THREE, w, h, d, c, o) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), std(THREE, c, o));

export function buildAccessory(THREE, id) {
  const a = accessoryById(id);
  if (!a) return null;
  const g = new THREE.Group();
  const add = (m, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => { m.position.set(x, y, z); m.rotation.set(rx, ry, rz); g.add(m); return m; };

  switch (id) {
    case "cap": {
      const dome = add(new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), std(THREE, "#e14b6a")));
      dome.scale.y = 0.8;
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.02, 20, 1, false, 0, Math.PI), std(THREE, "#c23f5a")), 0, 0.0, 0.08);  // brim
      return slot(a, g, [0, 0.12, 0.02]);
    }
    case "flowercrown": {
      add(new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.015, 8, 24), std(THREE, "#5a8f4f")), 0, 0, 0, Math.PI / 2);
      const cols = ["#ff6b9d", "#ffd36b", "#9b7bff", "#fff0b3", "#6bd5ff"];
      for (let i = 0; i < 8; i++) {
        const an = (i / 8) * Math.PI * 2;
        add(new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 8), std(THREE, cols[i % cols.length])), Math.cos(an) * 0.12, 0.01, Math.sin(an) * 0.12);
      }
      return slot(a, g, [0, 0.11, 0]);
    }
    case "tophat": {
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.12, 0.02, 20), std(THREE, "#1a1a22")), 0, 0, 0);          // brim
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.22, 20), std(THREE, "#1a1a22")), 0, 0.12, 0);     // crown
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.086, 0.086, 0.04, 20), std(THREE, "#b5402f")), 0, 0.05, 0);     // band
      return slot(a, g, [0, 0.14, 0]);
    }
    case "halo": {
      add(new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.018, 10, 24), std(THREE, "#ffe08a", { emissive: "#e0a93f", emissiveIntensity: 0.8 })), 0, 0, 0, Math.PI / 2);
      return slot(a, g, [0, 0.26, 0], true);   // floats + spins
    }
    case "sunnies": {
      const lens = (x) => add(box(THREE, 0.07, 0.05, 0.02, "#111317", { metalness: 0.3 }), x, 0, 0);
      lens(-0.045); lens(0.045);
      add(box(THREE, 0.03, 0.012, 0.02, "#111317"), 0, 0, 0);     // bridge
      return slot(a, g, [0, 0.03, 0.1]);
    }
    case "heartglasses": {
      const heart = (x) => {
        const h = new THREE.Group();
        h.add(box(THREE, 0.06, 0.06, 0.015, "#ff4fa3", { emissive: "#7a1f4f", emissiveIntensity: 0.4 }));
        h.position.set(x, 0, 0); h.rotation.z = Math.PI / 4; g.add(h); return h;
      };
      heart(-0.05); heart(0.05);
      add(box(THREE, 0.03, 0.012, 0.015, "#ff4fa3"), 0, 0, 0);
      return slot(a, g, [0, 0.03, 0.1]);
    }
    case "shutters": {
      // Shutter shades: two frames with horizontal slats, in hot pink.
      for (const x of [-0.045, 0.045]) {
        add(box(THREE, 0.075, 0.05, 0.012, "#ff4fa3", { emissive: "#7a1f4f", emissiveIntensity: 0.3 }), x, 0, 0);
        for (let i = 0; i < 4; i++) add(box(THREE, 0.07, 0.006, 0.016, "#1a1a22"), x, -0.018 + i * 0.012, 0.004);
      }
      add(box(THREE, 0.03, 0.012, 0.012, "#ff4fa3"), 0, 0, 0);
      return slot(a, g, [0, 0.03, 0.1]);
    }
    case "totem": {
      // A tall festival totem on a pole, held up so friends can find you in the crowd.
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.5, 8), std(THREE, "#d9d6d0")), 0, 0.75, 0);
      const sign = add(new THREE.Mesh(new THREE.CircleGeometry(0.16, 6), new THREE.MeshStandardMaterial({ color: "#5ad1ff", emissive: "#2a8fbf", emissiveIntensity: 0.8, side: THREE.DoubleSide })), 0, 1.55, 0);
      sign.userData.spin = true;
      add(new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.012, 8, 6), std(THREE, "#ffd36b", { emissive: "#e0a93f", emissiveIntensity: 0.6 })), 0, 1.55, 0);
      for (const [y, c] of [[1.32, "#ff4fa3"], [1.24, "#9b7bff"], [1.16, "#7ee081"]]) add(box(THREE, 0.02, 0.18, 0.004, c, { emissive: c, emissiveIntensity: 0.4 }), 0.03, y, 0);
      return slot(a, g, [0.02, -0.05, 0.04], true);   // spins slowly so it reads from every side
    }
    case "glowstick": {
      const s = add(new THREE.Mesh(new THREE.CapsuleGeometry(0.02, 0.22, 4, 8), std(THREE, "#8dff6b", { emissive: "#4aff2f", emissiveIntensity: 1.0 })), 0, 0, 0, 0.5, 0, 0);
      return slot(a, g, [0.02, 0.02, 0.04]);
    }
    case "wings": {
      const wing = (side) => {
        const w = new THREE.Mesh(new THREE.CircleGeometry(0.22, 16, 0, Math.PI), new THREE.MeshStandardMaterial({ color: "#bfe9ff", transparent: true, opacity: 0.55, side: THREE.DoubleSide, emissive: "#6bb8e0", emissiveIntensity: 0.3 }));
        w.scale.set(0.7 * side, 1.1, 1);
        w.position.set(side * 0.12, 0.1, 0);
        w.rotation.y = side * 0.5;
        g.add(w);
      };
      wing(1); wing(-1);
      return slot(a, g, [0, 0.12, -0.12]);
    }
  }
  return null;
}

function slot(a, group, offset, spin = false) { return { slot: a.slot, group, offset, spin }; }
