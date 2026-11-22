// How good the picture looks, and what that costs.
//
// Two quality levels, picked by device (phones get "low") and overridable with ?quality=high|low in
// the address, or the "Graphics" setting (saved in this browser as fv-quality):
//   low   ground textures and glowing lights' colors; no real-time shadows, no glow pass
//   high  + soft real-time shadows from the low dusk sun, in an area that follows you around
//         + a glow pass, so string lights, lamps, the Ferris wheel and camp neon shine
//
// Characters keep their cheap round contact shadow at every level; only the world (stages, stalls,
// tents, trees, the wheel, camps) casts real shadows, so a crowd doesn't multiply the cost.
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

// Lights, bulbs and neon are marked with this where they're built, so the glow pass knows what shines.
export const glowing = (m) => { m.userData.glow = true; return m; };

export function pickQuality() {
  try {
    const q = new URLSearchParams(location.search).get("quality") || localStorage.getItem("fv-quality");
    if (q === "high" || q === "low") return q;
  } catch {}
  const phone = matchMedia("(pointer: coarse)").matches || Math.min(screen.width, screen.height) < 600;
  return phone ? "low" : "high";
}
export function saveQuality(q) { try { localStorage.setItem("fv-quality", q); } catch {} }

const GLOW_BOOST = 3;          // how much brighter than "white" a glowing light is, so only lights pass the glow threshold
const SHADOW_SPAN = 45;        // meters of real shadow each way around you
const SHADOW_MAP = 2048;

export function setupGraphics(THREE, { renderer, scene, camera, festival, quality = pickQuality() }) {
  const high = quality === "high";
  const sun = festival.sun;
  const sunDir = sun ? sun.position.clone().normalize() : new THREE.Vector3(-0.5, 0.75, 0.4).normalize();

  if (high && sun) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    sun.castShadow = true;
    sun.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
    const c = sun.shadow.camera;
    c.left = c.bottom = -SHADOW_SPAN; c.right = c.top = SHADOW_SPAN; c.near = 1; c.far = 260;
    c.updateProjectionMatrix();
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.05;
    scene.add(sun.target);
  }

  // The glow pass: only things brighter than white bloom, and only marked lights are that bright.
  let composer = null, bloom = null;
  if (high) {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.75, 0.45, 1.05);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
  }

  // Things get added all the time (camps, carts, players); every so often, set up anything new:
  // shadows for the world (not players), and the extra brightness for glowing lights.
  const done = new WeakSet();
  function prepare(obj) {
    if (done.has(obj)) return;
    done.add(obj);
    if (obj.userData.animate) return;           // a player: keeps its contact shadow only
    if (obj.isMesh || obj.isInstancedMesh) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) {
        if (!m || !m.userData.glow || m.userData.boosted) continue;
        m.userData.boosted = true;
        if (!high) continue;
        if (m.isMeshBasicMaterial) m.color.multiplyScalar(GLOW_BOOST);
        else if ("emissiveIntensity" in m) m.emissiveIntensity *= GLOW_BOOST;
      }
      if (high) {
        const flat = ["PlaneGeometry", "CircleGeometry", "RingGeometry"].includes(obj.geometry?.type);
        const unlit = mats.every((m) => m?.isMeshBasicMaterial || m?.transparent);
        obj.receiveShadow = !unlit;
        obj.castShadow = !flat && !unlit;
      }
    }
    for (const child of obj.children) prepare(child);
  }
  let since = 1e9;

  const snap = SHADOW_SPAN * 2 / SHADOW_MAP;   // move the shadow area in whole shadow-pixels, so edges don't shimmer
  return {
    quality,
    update(dt, follow) {
      since += dt;
      if (since > 1) {
        since = 0;
        // Players can be re-built (new look), so walk the scene, not a list; `done` keeps it cheap.
        for (const child of scene.children) prepare(child);
      }
      if (high && sun && follow) {
        const x = Math.round(follow.x / snap) * snap, z = Math.round(follow.z / snap) * snap;
        sun.target.position.set(x, 0, z);
        sun.position.set(x + sunDir.x * 120, sunDir.y * 120, z + sunDir.z * 120);
      }
    },
    render() { composer ? composer.render() : renderer.render(scene, camera); },
    resize(w, h) { composer?.setSize(w, h); bloom?.setSize(w, h); },
  };
}

// ---------- Ground textures ----------
// Made in code (no image files): a light, grainy pattern that the ground's own color tints, so grass
// reads as grass and dirt as dirt up close. One small image per kind, shared; each piece of ground
// repeats it to its own size so the grain is the same size everywhere.
const cache = new Map();
export function groundTexture(THREE, kind, w, d, tile = kind === "grass" ? 5 : 3.5) {
  if (!cache.has(kind)) cache.set(kind, makeTexture(THREE, kind));
  const t = cache.get(kind).clone();
  t.repeat.set(Math.max(1, w / tile), Math.max(1, d / tile));
  t.needsUpdate = true;
  return t;
}

function makeTexture(THREE, kind) {
  const N = 256;
  const c = document.createElement("canvas");
  c.width = c.height = N;
  const x = c.getContext("2d");
  let seed = kind === "grass" ? 11 : 23;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // Wrap-around drawing so the tiles join without seams.
  const wrap = (fn) => { for (const ox of [-N, 0, N]) for (const oy of [-N, 0, N]) fn(ox, oy); };
  x.fillStyle = "#f2f2f2";
  x.fillRect(0, 0, N, N);
  // Soft blotches of lighter and darker ground.
  for (let i = 0; i < 40; i++) {
    const px = r() * N, py = r() * N, rad = 12 + r() * 36, v = 200 + Math.floor(r() * 55);
    wrap((ox, oy) => {
      const g = x.createRadialGradient(px + ox, py + oy, 0, px + ox, py + oy, rad);
      g.addColorStop(0, `rgba(${v},${v},${v},0.55)`); g.addColorStop(1, `rgba(${v},${v},${v},0)`);
      x.fillStyle = g; x.fillRect(px + ox - rad, py + oy - rad, rad * 2, rad * 2);
    });
  }
  if (kind === "grass") {
    // Short blades.
    for (let i = 0; i < 2600; i++) {
      const px = r() * N, py = r() * N, len = 2 + r() * 4, lean = (r() - 0.5) * 2, v = 175 + Math.floor(r() * 80);
      x.strokeStyle = `rgb(${v},${v},${v})`; x.lineWidth = 1;
      wrap((ox, oy) => { x.beginPath(); x.moveTo(px + ox, py + oy); x.lineTo(px + ox + lean, py + oy - len); x.stroke(); });
    }
  } else {
    // Packed dirt: grit and pebbles.
    for (let i = 0; i < 1800; i++) {
      const px = r() * N, py = r() * N, s = r() < 0.92 ? 1 : 2 + r() * 2, v = 160 + Math.floor(r() * 95);
      x.fillStyle = `rgb(${v},${v},${v})`;
      wrap((ox, oy) => x.fillRect(px + ox, py + oy, s, s));
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
