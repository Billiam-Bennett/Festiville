// Crowd benchmark for parts-based characters (client/avatar.js).
//
// Open client/bench.html in a browser, or run it headless with `npm run bench` (scripts/bench-crowd.mjs).
// URL options:
//   n=100          how many avatars (random recipes, premium parts included)
//   seed=1         recipe/placement seed, so runs are repeatable
//   view=crowd     camera inside the crowd, slowly turning (the normal game view) | view=all: high, everything in view
//   radius=45      the crowd is spread over a disc this big (meters)
//   world=1        build the real festival scenery around them (0 = just a ground plane)
//   seconds=6      how long to measure (after a 1.5 s warm-up)
//   update=1       call the kit's per-frame update(camera) (distance LOD, culling, animation pacing); 0 = full detail
//   lineup=r1|r2   instead of a crowd: these recipes side by side, frozen in one pose, for screenshots
//     pose=idle|walk|dance, at=0.4 (seconds into the clip), cam=front|side|back|three, focus=full|legs|torso|head
// Results go on screen and into window.__bench (the headless runner reads it).
import * as THREE from "three";
import { createPartsKit } from "./avatar.js";
import { buildFestival } from "./world.js";
import { randomRecipe, seededRandom, PARTS } from "../shared/parts.js";

const q = new URLSearchParams(location.search);
const num = (k, d) => (q.has(k) ? Number(q.get(k)) : d);
const N = num("n", 100);
const SEED = q.get("seed") ?? "1";
const VIEW = q.get("view") ?? "crowd";
const RADIUS = num("radius", 45);
const SECONDS = num("seconds", 6);
const LINEUP = q.get("lineup");
const hud = document.getElementById("hud");

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: !!LINEUP });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.info.autoReset = false;
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 400);

if (num("world", 1) && !LINEUP) buildFestival(THREE, scene);
else {
  scene.background = new THREE.Color("#2a1b3d");
  scene.add(new THREE.HemisphereLight("#ffd9b0", "#2a3a2a", 1.6));
  const sun = new THREE.DirectionalLight("#ffb07a", 1.8);
  sun.position.set(30, 50, 20);
  scene.add(sun);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: "#3b5a3a" }));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
}

const kit = createPartsKit(THREE);
const out = (window.__bench = { done: false, n: N, seed: SEED, view: VIEW });

// ---------- What's on the GPU ----------
function gpuMemory() {
  const textures = new Set(), geometries = new Set();
  scene.traverse((o) => {
    if (!o.isMesh && !o.isSprite) return;
    geometries.add(o.geometry);
    for (const m of [o.material].flat()) for (const v of Object.values(m ?? {})) if (v?.isTexture) textures.add(v);
  });
  let texBytes = 0, geoBytes = 0;
  for (const t of textures) {
    if (t.isCompressedTexture) { for (const mip of t.mipmaps ?? []) texBytes += mip.data?.byteLength ?? 0; continue; }
    const img = t.image;
    const w = img?.width ?? 0, h = img?.height ?? 0;
    texBytes += w * h * 4 * (t.generateMipmaps ? 4 / 3 : 1);
  }
  for (const g of geometries) {
    for (const a of Object.values(g.attributes)) geoBytes += a.array?.byteLength ?? 0;
    geoBytes += g.index?.array.byteLength ?? 0;
  }
  return { textures: textures.size, texMB: +(texBytes / 2 ** 20).toFixed(1), geometries: geometries.size, geoMB: +(geoBytes / 2 ** 20).toFixed(1) };
}

const glbStats = () => {
  const r = performance.getEntriesByType("resource").filter((e) => /\.glb$/.test(e.name));
  return { glbFetches: r.length, glbMB: +(r.reduce((s, e) => s + (e.encodedBodySize || e.transferSize || 0), 0) / 2 ** 20).toFixed(1) };
};

// ---------- Lineup (screenshots) ----------
async function lineup() {
  const recipes = LINEUP.split("|");
  const avatars = await Promise.all(recipes.map((r) => kit.create(r)));
  const gap = 0.9;
  avatars.forEach((a, i) => {
    if (!a) return;
    a.position.x = (i - (recipes.length - 1) / 2) * gap;
    scene.add(a);
    const pose = q.get("pose") ?? "idle";
    const at = num("at", 0.4);
    const speed = pose === "walk" ? 1.6 : 0;
    a.userData.animate(1, speed, pose === "dance" ? "dance" : "");   // finish the cross-fade into the pose
    a.userData.animate(at, speed, pose === "dance" ? "dance" : "");
  });
  if (q.get("hideMesh")) {   // debugging: hide meshes whose name matches (e.g. one garment, to see what's under it)
    const re = new RegExp(q.get("hideMesh"), "i");
    for (const a of avatars) a?.traverse((o) => { if (o.isMesh && re.test(o.name)) o.visible = false; });
  }
  const focus = { full: [0.9, 2.6], legs: [0.35, 1.3], torso: [1.15, 1.2], head: [1.55, 0.7], hem: [0.95, 0.35], hands: [0.85, 0.45], feet: [0.15, 0.6] }[q.get("focus") ?? "full"];
  const dist = focus[1] + recipes.length * 0.35;
  const dir = { front: [0, 1], back: [0, -1], side: [1, 0], three: [0.7, 0.7] }[q.get("cam") ?? "front"];
  camera.position.set(dir[0] * dist, focus[0] + 0.15, dir[1] * dist);
  camera.lookAt(0, focus[0], 0);
  renderer.render(scene, camera);
  out.done = true;
  hud.textContent = recipes.join("\n");
  out.layers = kit.layers?.();
}

// ---------- Crowd ----------
async function crowd() {
  const rng = seededRandom(`bench-${SEED}`);
  const recipes = Array.from({ length: N }, () => randomRecipe(rng, { allow: () => true }));
  const t0 = performance.now();
  const avatars = (await Promise.all(recipes.map((r) => kit.create(r)))).filter(Boolean);
  const tBuilt = performance.now();
  const walkers = avatars.map((a, i) => {
    const r = RADIUS * Math.sqrt(rng()), th = rng() * Math.PI * 2;
    const kind = rng();   // 40% stand, 15% dance, 45% walk in small circles
    const w = {
      a, cx: Math.cos(th) * r, cz: Math.sin(th) * r, loop: 1.5 + rng() * 3, phase: rng() * Math.PI * 2,
      speed: kind < 0.4 ? 0 : kind < 0.55 ? 0 : 0.8 + rng() * 1.4, emote: kind >= 0.4 && kind < 0.55 ? "dance" : "",
    };
    a.position.set(w.cx, 0, w.cz);
    scene.add(a);
    return w;
  });
  renderer.compile(scene, camera);
  renderer.render(scene, camera);
  const tFirst = performance.now();
  out.loadMs = Math.round(tFirst - t0);
  out.buildMs = Math.round(tBuilt - t0);
  out.avatars = avatars.length;
  Object.assign(out, glbStats());

  let time = 0, frames = 0, measured = 0, updMs = 0, renderMs = 0, calls = 0, tris = 0, visible = 0;
  const levels = [0, 0, 0];
  const intervals = [];
  let last = performance.now(), start = 0;
  const measureFrom = 1.5;

  function placeCamera(t) {
    if (VIEW === "all") {
      camera.position.set(Math.sin(t * 0.1) * 10, RADIUS * 1.1, RADIUS * 1.25);
      camera.lookAt(0, 0, 0);
    } else {   // third-person-ish: a player near the middle, camera behind them, turning slowly
      const yaw = t * 0.35;
      camera.position.set(Math.sin(yaw) * 8, 4.5, Math.cos(yaw) * 8);
      camera.lookAt(-Math.sin(yaw) * 6, 1.2, -Math.cos(yaw) * 6);
    }
  }

  function frame() {
    const now = performance.now();
    const raw = now - last;
    const dt = Math.min(raw / 1000, 0.1);
    last = now;
    time += dt;
    const u0 = performance.now();
    placeCamera(time);
    for (const w of walkers) {
      let speed = 0;
      if (w.speed) {
        const ang = w.phase + (time * w.speed) / w.loop;
        const x = w.cx + Math.cos(ang) * w.loop, z = w.cz + Math.sin(ang) * w.loop;
        w.a.rotation.y = Math.atan2(-Math.sin(ang), Math.cos(ang));
        w.a.position.x = x; w.a.position.z = z;
        speed = w.speed;
      }
      w.a.userData.animate(dt, speed, w.emote);
    }
    if (num("update", 1)) kit.update?.(camera, scene);
    const u1 = performance.now();
    renderer.info.reset();
    renderer.render(scene, camera);
    const u2 = performance.now();
    frames++;
    if (time >= measureFrom) {
      if (!start) start = now;
      else intervals.push(raw);
      measured++;
      updMs += u1 - u0; renderMs += u2 - u1;
      calls += renderer.info.render.calls; tris += renderer.info.render.triangles;
      const st = kit.stats?.();
      visible += st ? st.avatars - st.hidden : avatars.length;
      if (st) for (let i = 0; i < 3; i++) levels[i] += st.levels[i];
    }
    if (start && now - start >= SECONDS * 1000) return finish(now);
    if (frames % 10 === 0) hud.textContent = `n=${avatars.length}  frame ${frames}  calls ${renderer.info.render.calls}  tris ${renderer.info.render.triangles}`;
    requestAnimationFrame(frame);
  }

  function finish(now) {
    intervals.sort((a, b) => a - b);
    const pct = (p) => +intervals[Math.min(intervals.length - 1, Math.floor(intervals.length * p))]?.toFixed(1);
    Object.assign(out, {
      fps: +((measured - 1) / ((now - start) / 1000)).toFixed(1),
      frameMsP50: pct(0.5), frameMsP95: pct(0.95),
      updateMs: +(updMs / measured).toFixed(2), renderMs: +(renderMs / measured).toFixed(2),
      drawCalls: Math.round(calls / measured), triangles: Math.round(tris / measured),
      visibleAvatars: Math.round(visible / measured),
      lod: kit.stats ? levels.map((v) => Math.round(v / measured)).join("/") : "-",
      ...gpuMemory(),
      programs: renderer.info.programs?.length ?? 0,
      heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 2 ** 20).toFixed(0) : null,
      done: true,
    });
    hud.textContent = Object.entries(out).map(([k, v]) => `${k.padEnd(14)} ${v}`).join("\n");
  }
  requestAnimationFrame(frame);
}

addEventListener("error", (e) => { out.error = String(e.message); });
(LINEUP ? lineup() : crowd()).catch((err) => { out.error = String(err?.stack ?? err); out.done = true; hud.textContent = out.error; });
window.__parts = PARTS;
