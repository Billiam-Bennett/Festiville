// Parts-based characters: builds a player from a recipe (shared/parts.js).
//
//   const parts = createPartsKit(THREE);
//   const avatar = await parts.create(recipe, profile);   // a ready avatar, or null if the body can't load
//
// How it's put together:
//   1. Load parts/<body>/body.glb (skinned body + the mixamorig* skeleton) and clone it per player.
//   2. Load each part glb (hair, eyebrows, top, bottom, shoes, accessory). Take only its skinned meshes, and
//      rebind them to the CLONED body's bones by name, so they follow the body's animation.
//      (The part's own bones are never added to the scene: one skeleton per player.)
//   3. Tint: skin on the body, the chosen swatch on each part (material color × swatch), except parts
//      marked tint: false, which keep their own printed colors.
//   4. Hide the skin under clothes: body.glb has a per-vertex mask per clothing slot (_hide_top,
//      _hide_bottom, _hide_shoes, _hide_accessory; bit N = that slot's Nth part in parts/manifest.json
//      covers the vertex). The body's material drops those fragments for the parts being worn.
//   4b. Body shapes (build, face): body.glb holds them as morph targets. The chosen ones are baked into
//      plain geometry once (no morphs on the GPU), and each part is refit to the shaped body by moving
//      its vertices with the body surface nearest to them. Height just scales the avatar.
//   4c. Hats: hair would poke through the crown, so while a hat is worn the hair is tucked under it
//      (each hair vertex above the brim is pulled inside the hat's inner surface; cached per hair+hat).
//   5. Animate with the body's one shared set in parts/<body>/anims.json, through rigAvatar() like classic characters.
//
// Everything downloaded is cached and shared: each glb is fetched once, geometry and textures are
// shared by every player wearing it, and tinted materials are shared by players with the same color.
// Missing files never break the game: a missing part is skipped (with a console warning), and a
// missing body makes create() return null so the caller can fall back to a classic character.
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";
import { rigAvatar, collectClips } from "./character.js";
import { parseRecipe, bodyModel, partModel, partsAnims, skinHex, partTintHex, PART_SLOTS, shapeMorphs, heightScale } from "../shared/parts.js";

const boneKey = (n) => n.replace(/^mixamorig\d*:?/, "");
// Materials that keep their own color (eyes, teeth, …) — see the contract in shared/parts.js.
const NO_TINT = /eye|teeth|tooth|tongue|lash|fixed|notint/i;
const TARGET_HEIGHT = 1.7;
const HIDE_SLOTS = ["top", "bottom", "shoes", "accessory"];   // must match CLOTHING_SLOTS in scripts/make-parts.py
const MANIFEST = "parts/manifest.json";

export function createPartsKit(THREE, { base = "./assets/" } = {}) {
  const loader = new GLTFLoader();
  const files = new Map();        // url -> Promise<gltf | null>
  const bodies = new Map();       // body id -> Promise<{ gltf, clips, scale, lift, height } | null>
  const tinted = new Map();       // "materialUuid|#hex" -> tinted material (shared)
  const hiding = new Map();       // "materialUuid|t,b,s,a" -> body material that hides covered skin (shared)
  const shaped = new Map();       // "geometryUuid|morphs" -> body or part geometry baked to a shape (shared)
  const fitters = new Map();      // "body|morphs" -> refits part geometry to that body shape
  const crowns = new Map();       // "hat mesh uuids|morphs" -> the hat's inner surface, for tucking hair under it
  const warned = new Set();
  const anims = new Map();        // body id -> Promise<array of clip JSON>
  let manifest = null;            // Promise<manifest json | null>

  const warnOnce = (key, ...msg) => { if (!warned.has(key)) { warned.add(key); console.warn(...msg); } };

  function loadFile(path) {
    const url = base + path;
    if (!files.has(url)) {
      files.set(url, loader.loadAsync(url).then((gltf) => {
        gltf.scene.traverse((n) => { if (n.isMesh) n.frustumCulled = false; });   // skinned meshes move outside their bounds
        gltf.scene.updateMatrixWorld(true);
        return gltf;
      }).catch((err) => { warnOnce(url, `Character part ${url} is missing or broken; skipping it.`, err?.message ?? err); return null; }));
    }
    return files.get(url);
  }

  function loadAnims(body) {
    if (!anims.has(body)) anims.set(body, fetch(base + partsAnims(body)).then((r) => (r.ok ? r.json() : [])).catch(() => []));
    return anims.get(body);
  }

  function loadManifest() {
    manifest ??= fetch(base + MANIFEST).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    return manifest;
  }

  // Which hide bits the worn parts set, per clothing slot: [top, bottom, shoes, accessory].
  function hideBits(man, body, worn) {
    const files = man?.bodies?.[body]?.parts ?? {};
    const bits = HIDE_SLOTS.map(() => 0);
    for (const p of worn) {
      const entry = files[partModel(body, p.id).split("/").pop().replace(/\.glb$/, "")];
      const s = HIDE_SLOTS.indexOf(entry?.hideIn ?? entry?.slot);   // hats hide skin through the accessory mask
      if (s >= 0 && Number.isInteger(entry.hideBit)) bits[s] |= 1 << entry.hideBit;
    }
    return bits;
  }

  // A copy of the body material that discards skin covered by the worn clothes.
  function hidingMaterial(material, bits) {
    if (Array.isArray(material)) return material.map((m) => hidingMaterial(m, bits));
    if (!material || !bits.some(Boolean)) return material;
    const key = `${material.uuid}|${bits}`;
    if (!hiding.has(key)) {
      const m = material.clone();
      m.onBeforeCompile = (shader) => {
        shader.uniforms.fvHide = { value: new THREE.Vector4(...bits) };
        shader.vertexShader = shader.vertexShader
          .replace("#include <common>", `#include <common>
attribute float _hide_top;
attribute float _hide_bottom;
attribute float _hide_shoes;
attribute float _hide_accessory;
uniform vec4 fvHide;
varying float vFvHide;`)
          .replace("#include <begin_vertex>", `#include <begin_vertex>
ivec4 fvMask = ivec4(int(_hide_top + 0.5), int(_hide_bottom + 0.5), int(_hide_shoes + 0.5), int(_hide_accessory + 0.5));
ivec4 fvWorn = ivec4(fvHide + 0.5);
vFvHide = ((fvMask.x & fvWorn.x) | (fvMask.y & fvWorn.y) | (fvMask.z & fvWorn.z) | (fvMask.w & fvWorn.w)) != 0 ? 1.0 : 0.0;`);
        shader.fragmentShader = shader.fragmentShader
          .replace("#include <common>", "#include <common>\nvarying float vFvHide;")
          .replace("#include <clipping_planes_fragment>", "#include <clipping_planes_fragment>\nif (vFvHide > 0.5) discard;");
      };
      m.customProgramCacheKey = () => "fv-hide";   // one shader for every mask; the bits are a uniform
      hiding.set(key, m);
    }
    return hiding.get(key);
  }

  // The base body for "female" / "male", measured once.
  function loadBody(body) {
    if (!bodies.has(body)) {
      bodies.set(body, Promise.all([loadFile(bodyModel(body)), loadAnims(body)]).then(([gltf, extra]) => {
        if (!gltf) return null;
        const clips = collectClips(THREE, gltf.animations, extra);
        if (!clips.Idle) warnOnce("anims", `No Idle animation in ${base}${partsAnims(body)} (or in the body); built characters will stand still.`);
        const box = new THREE.Box3().setFromObject(gltf.scene);
        const h = Math.max(box.max.y - box.min.y, 0.01);
        // MakeHuman exports in meters, and the two bodies keep their real heights. If a file comes in
        // centimeters (or otherwise way off), scale it to a normal height instead.
        const scale = h > 1.2 && h < 2.4 ? 1 : TARGET_HEIGHT / h;
        const shapes = takeShapes(gltf);
        // The body's skin mesh (the one with hide masks, else the biggest): the surface parts are refit against.
        let skin = null;
        const rank = (n) => (n.geometry.attributes._hide_top ? 1e9 : 0) + n.geometry.attributes.position.count;
        gltf.scene.traverse((n) => { if (n.isSkinnedMesh && (!skin || rank(n) > rank(skin))) skin = n; });
        return { body, gltf, clips, scale, lift: -box.min.y * scale, height: h * scale, shapes, skin };
      }));
    }
    return bodies.get(body);
  }

  // ---------- Body shapes ----------
  // Pull the morph targets out of body.glb (as plain arrays) and strip them from the meshes, so the default
  // body renders without morphing. Returns Map(geometry -> { names, pos: [Float32Array], nrm: [Float32Array] }).
  function takeShapes(gltf) {
    const out = new Map();
    const flat = (a) => {
      const f = new Float32Array(a.count * 3);
      for (let i = 0; i < a.count; i++) { f[i * 3] = a.getX(i); f[i * 3 + 1] = a.getY(i); f[i * 3 + 2] = a.getZ(i); }
      return f;
    };
    gltf.scene.traverse((n) => {
      const g = n.geometry;
      if (!n.isMesh || !g.morphAttributes?.position?.length) return;
      const dict = n.morphTargetDictionary ?? {};
      const names = g.morphAttributes.position.map((_, i) => Object.keys(dict).find((k) => dict[k] === i) ?? `#${i}`);
      out.set(g, { names, pos: g.morphAttributes.position.map(flat), nrm: (g.morphAttributes.normal ?? []).map(flat) });
      g.morphAttributes = {};
      n.morphTargetInfluences = undefined;
      n.morphTargetDictionary = undefined;
    });
    return out;
  }

  // The summed deltas of the chosen morphs for one body geometry (pos or nrm), or null if none apply.
  function shapeDelta(info, morphs, which) {
    let sum = null;
    for (const m of morphs) {
      const d = info?.[which][info.names.indexOf(m)];
      if (!d) continue;
      sum ??= new Float32Array(d.length);
      for (let i = 0; i < d.length; i++) sum[i] += d[i];
    }
    return sum;
  }

  // A copy of geometry g with new positions (and normals); every other attribute is shared.
  function withPositions(g, dpos, dnrm) {
    const out = new THREE.BufferGeometry();
    out.setIndex(g.index);
    for (const [k, a] of Object.entries(g.attributes)) out.setAttribute(k, a);
    for (const grp of g.groups) out.addGroup(grp.start, grp.count, grp.materialIndex);
    const pos = g.attributes.position.clone();
    for (let i = 0; i < pos.count; i++) pos.setXYZ(i, pos.getX(i) + dpos[i * 3], pos.getY(i) + dpos[i * 3 + 1], pos.getZ(i) + dpos[i * 3 + 2]);
    out.setAttribute("position", pos);
    if (dnrm && g.attributes.normal) {
      const nrm = g.attributes.normal.clone(), v = new THREE.Vector3();
      for (let i = 0; i < nrm.count; i++) {
        v.set(nrm.getX(i) + dnrm[i * 3], nrm.getY(i) + dnrm[i * 3 + 1], nrm.getZ(i) + dnrm[i * 3 + 2]).normalize();
        nrm.setXYZ(i, v.x, v.y, v.z);
      }
      out.setAttribute("normal", nrm);
    }
    out.computeBoundingSphere();
    return out;
  }

  // The body's own geometry baked to a shape (shared by everyone with that shape).
  function shapedBody(kit, g, morphs) {
    const info = kit.shapes.get(g);
    if (!info || !morphs.length) return g;
    const key = `${g.uuid}|${morphs}`;
    if (!shaped.has(key)) {
      const dpos = shapeDelta(info, morphs, "pos");
      shaped.set(key, dpos ? withPositions(g, dpos, shapeDelta(info, morphs, "nrm")) : g);
    }
    return shaped.get(key);
  }

  // Refits part geometry to a body shape: each part vertex moves like the body surface nearest to it
  // (inverse-distance blend of the 4 closest body vertices), all in bind space. Parts are made on the
  // default body, so this is what lets one part file fit every build and face.
  function fitterFor(kit, morphs) {
    const key = `${kit.body}|${morphs}`;
    if (fitters.has(key)) return fitters.get(key);
    const skin = kit.skin, info = skin && kit.shapes.get(skin.geometry);
    const delta = info && shapeDelta(info, morphs, "pos");
    if (!delta) { fitters.set(key, null); return null; }
    const CELL = 0.04;
    const bind = skin.bindMatrix, bind3 = new THREE.Matrix3().setFromMatrix4(bind);
    const pos = skin.geometry.attributes.position, n = pos.count;
    const bp = new Float32Array(n * 3), bd = new Float32Array(n * 3), v = new THREE.Vector3();
    const grid = new Map();
    const cellKey = (x, y, z) => ((x + 512) * 1024 + (y + 512)) * 1024 + (z + 512);
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(bind);
      bp[i * 3] = v.x; bp[i * 3 + 1] = v.y; bp[i * 3 + 2] = v.z;
      v.set(delta[i * 3], delta[i * 3 + 1], delta[i * 3 + 2]).applyMatrix3(bind3);
      bd[i * 3] = v.x; bd[i * 3 + 1] = v.y; bd[i * 3 + 2] = v.z;
      const k = cellKey(Math.floor(bp[i * 3] / CELL), Math.floor(bp[i * 3 + 1] / CELL), Math.floor(bp[i * 3 + 2] / CELL));
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(i);
    }
    const near = [], dist = [];
    // Blended body delta at world point p -> out.
    function deltaAt(p, out) {
      near.length = 0; dist.length = 0;
      const cx = Math.floor(p.x / CELL), cy = Math.floor(p.y / CELL), cz = Math.floor(p.z / CELL);
      for (let r = 1, found = -1; r <= 12 && (found < 0 || r <= found + 1); r++) {
        near.length = 0; dist.length = 0;
        for (let x = cx - r; x <= cx + r; x++) for (let y = cy - r; y <= cy + r; y++) for (let z = cz - r; z <= cz + r; z++) {
          const list = grid.get(cellKey(x, y, z));
          if (!list) continue;
          for (const i of list) {
            const dx = bp[i * 3] - p.x, dy = bp[i * 3 + 1] - p.y, dz = bp[i * 3 + 2] - p.z;
            const d = dx * dx + dy * dy + dz * dz;
            if (near.length < 4) { near.push(i); dist.push(d); continue; }
            let worst = 0;
            for (let j = 1; j < 4; j++) if (dist[j] > dist[worst]) worst = j;
            if (d < dist[worst]) { near[worst] = i; dist[worst] = d; }
          }
        }
        if (near.length && found < 0) found = r;
      }
      out.set(0, 0, 0);
      let wsum = 0;
      for (let j = 0; j < near.length; j++) {
        const w = 1 / (dist[j] + 1e-6), i = near[j];
        out.x += bd[i * 3] * w; out.y += bd[i * 3 + 1] * w; out.z += bd[i * 3 + 2] * w; wsum += w;
      }
      if (wsum) out.multiplyScalar(1 / wsum);
      return out;
    }
    const fit = (src) => {   // src: the part's SkinnedMesh (in the cached part file)
      const k = `${src.uuid}|${morphs}`;
      if (!shaped.has(k)) {
        const g = src.geometry, p = g.attributes.position;
        const toLocal = new THREE.Matrix3().setFromMatrix4(src.bindMatrixInverse);
        const d = new Float32Array(p.count * 3), w = new THREE.Vector3(), out = new THREE.Vector3();
        for (let i = 0; i < p.count; i++) {
          w.fromBufferAttribute(p, i).applyMatrix4(src.bindMatrix);
          deltaAt(w, out).applyMatrix3(toLocal);
          d[i * 3] = out.x; d[i * 3 + 1] = out.y; d[i * 3 + 2] = out.z;
        }
        shaped.set(k, withPositions(g, d, null));
      }
      return shaped.get(k);
    };
    fitters.set(key, fit);
    return fit;
  }

  // ---------- Hair under hats ----------
  // The hat's inner surface as seen from a point at its brim level: the distance to the hat along a grid
  // of directions (azimuth × elevation, upper half only), all in bind space. geomOf(src) = the hat mesh's
  // geometry as worn (refit to the body shape).
  const AZ = 48, EL = 16, MARGIN = 0.006, BAND = 0.03;
  function crownOf(gltf, geomOf, key) {
    if (crowns.has(key)) return crowns.get(key);
    const tris = [], v = new THREE.Vector3();
    let head = null;   // the head bone's rest position (bind space): the rays start right above it, inside the head
    gltf.scene.traverse((src) => {
      if (!src.isSkinnedMesh) return;
      const hb = src.skeleton.bones.findIndex((bone) => boneKey(bone.name) === "Head");
      if (hb >= 0 && !head) head = new THREE.Vector3().setFromMatrixPosition(src.skeleton.boneInverses[hb].clone().invert());
      const g = geomOf(src), p = g.attributes.position;
      const w = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i).applyMatrix4(src.bindMatrix);
        w[i * 3] = v.x; w[i * 3 + 1] = v.y; w[i * 3 + 2] = v.z;
      }
      const idx = g.index ? g.index.array : Array.from({ length: p.count }, (_, i) => i);
      for (let i = 0; i + 2 < idx.length; i += 3) tris.push([idx[i], idx[i + 1], idx[i + 2]].map((k) => w.subarray(k * 3, k * 3 + 3)));
    });
    if (!tris.length) { crowns.set(key, null); return null; }
    if (!head) { crowns.set(key, null); return null; }
    // Rays start above the head bone, at the hat's brim level: the median, over directions around the head, of
    // the hat's lowest point in that direction (so a dangling pompom or a drooping brim doesn't drag it down).
    const cx = head.x, cz = head.z, low = new Array(24).fill(Infinity);
    for (const t of tris) for (const q of t) {
      const k = Math.floor(((Math.atan2(q[2] - cz, q[0] - cx) / (Math.PI * 2) + 1) % 1) * low.length);
      low[k] = Math.min(low[k], q[1]);
    }
    const lows = low.filter(Number.isFinite).sort((a, b) => a - b);
    const c = new THREE.Vector3(cx, lows[Math.floor(lows.length / 2)], cz);
    const dist = new Float32Array(AZ * EL).fill(Infinity);
    const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), pv = new THREE.Vector3(), tv = new THREE.Vector3(), qv = new THREE.Vector3(), d = new THREE.Vector3();
    for (let a = 0; a < AZ; a++) for (let e = 0; e < EL; e++) {
      const az = (a / AZ) * Math.PI * 2, el = (e / (EL - 1)) * Math.PI / 2;
      d.set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az));
      let best = Infinity;
      for (const [p0, p1, p2] of tris) {   // Möller–Trumbore, both faces
        e1.set(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
        e2.set(p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]);
        pv.crossVectors(d, e2);
        const det = e1.dot(pv);
        if (Math.abs(det) < 1e-12) continue;
        tv.set(c.x - p0[0], c.y - p0[1], c.z - p0[2]);
        const u = tv.dot(pv) / det;
        if (u < 0 || u > 1) continue;
        qv.crossVectors(tv, e1);
        const w = d.dot(qv) / det;
        if (w < 0 || u + w > 1) continue;
        const t = e2.dot(qv) / det;
        if (t > 1e-4 && t < best) best = t;
      }
      dist[a * EL + e] = best;
    }
    const crown = { key, c, dist };
    crowns.set(key, crown);
    return crown;
  }

  // Distance to the hat's inner surface in direction (x, y, z) from the crown point (Infinity = open there).
  function crownDistance(crown, x, y, z) {
    const az = (Math.atan2(z, x) / (Math.PI * 2) + 1) % 1 * AZ;
    const el = Math.max(0, Math.asin(Math.max(-1, Math.min(1, y / Math.hypot(x, y, z))))) / (Math.PI / 2) * (EL - 1);
    const a0 = Math.floor(az), e0 = Math.min(EL - 2, Math.floor(el)), fa = az - a0, fe = el - e0;
    let sum = 0, wsum = 0, nearest = Infinity;
    for (const [da, de, w] of [[0, 0, (1 - fa) * (1 - fe)], [1, 0, fa * (1 - fe)], [0, 1, (1 - fa) * fe], [1, 1, fa * fe]]) {
      const t = crown.dist[((a0 + da) % AZ) * EL + e0 + de];
      if (!Number.isFinite(t)) continue;
      sum += t * w; wsum += w; nearest = Math.min(nearest, t);
    }
    return wsum > 0.5 ? sum / wsum : nearest;   // mostly open around here: be conservative
  }

  // Hair geometry with every vertex above the brim pulled inside the hat (tapering off just below it).
  function underHat(src, g, crown) {
    const key = `${g.uuid}|${src.uuid}|${crown.key}`;
    if (shaped.has(key)) return shaped.get(key);
    const p = g.attributes.position, c = crown.c, w = new THREE.Vector3();
    const d = new Float32Array(p.count * 3);
    let moved = 0;
    for (let i = 0; i < p.count; i++) {
      w.fromBufferAttribute(p, i).applyMatrix4(src.bindMatrix);
      const k = w.y >= c.y ? 1 : THREE.MathUtils.smoothstep(w.y, c.y - BAND, c.y);
      if (!k) continue;
      const dx = w.x - c.x, dy = Math.max(0, w.y - c.y), dz = w.z - c.z, r = Math.hypot(dx, dy, dz);
      if (r < 1e-6) continue;
      const lim = crownDistance(crown, dx, dy, dz) - MARGIN;
      if (!(r > lim)) continue;   // inside the hat already (or open in this direction)
      const s = (lim / r - 1) * k;
      d[i * 3] = dx * s; d[i * 3 + 1] = dy * s; d[i * 3 + 2] = dz * s;
      moved++;
    }
    if (!moved) { shaped.set(key, g); return g; }
    // The offsets are in bind space; turn them into the mesh's own space.
    const toLocal = new THREE.Matrix3().setFromMatrix4(src.bindMatrixInverse), v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.set(d[i * 3], d[i * 3 + 1], d[i * 3 + 2]).applyMatrix3(toLocal);
      d[i * 3] = v.x; d[i * 3 + 1] = v.y; d[i * 3 + 2] = v.z;
    }
    const out = withPositions(g, d, null);
    shaped.set(key, out);
    return out;
  }

  // Is this body's base file available? (The picker uses it to explain a fallback.)
  const hasBody = async (body) => !!(await loadBody(body));

  function tint(material, hex) {
    if (Array.isArray(material)) return material.map((m) => tint(m, hex));
    if (!hex || !material || NO_TINT.test(material.name || "") || !material.color) return material;
    const key = `${material.uuid}|${hex}`;
    if (!tinted.has(key)) {
      const m = material.clone();
      m.color.set(hex);   // base color texture × swatch: textures for tintable parts are authored light grey
      tinted.set(key, m);
    }
    return tinted.get(key);
  }

  function tintBody(model, hex) {
    model.traverse((n) => { if (n.isMesh) n.material = tint(n.material, hex); });
  }

  // Copy a part's skinned meshes onto `model`, bound to its bones. Returns how many meshes were added.
  function attachPart(gltf, model, bones, hex, label, geomOf) {
    const rootBone = bones.get("Hips") ?? [...bones.values()][0];
    let added = 0;
    gltf.scene.traverse((src) => {
      if (!src.isSkinnedMesh) return;
      const mapped = src.skeleton.bones.map((b) => {
        // Same name on the body, else the closest ancestor that exists (extra bones, e.g. a hair rig).
        for (let n = b; n; n = n.parent) { const hit = bones.get(boneKey(n.name)); if (hit) return hit; }
        warnOnce(`${label}:${b.name}`, `Part "${label}" uses bone "${b.name}", which the body doesn't have.`);
        return rootBone;
      });
      const mesh = src.clone();   // shares geometry; gets its own skeleton below
      if (geomOf) mesh.geometry = geomOf(src);   // refit to the body's build / face, tucked under a hat (cached)
      // The part's boneInverses describe the same rest pose as the body (same rig), so its vertices
      // land on the body. bindMode "attached" means the mesh's own placement doesn't matter.
      mesh.bind(new THREE.Skeleton(mapped, src.skeleton.boneInverses.map((m) => m.clone())), src.bindMatrix.clone());
      mesh.position.set(0, 0, 0); mesh.quaternion.identity(); mesh.scale.set(1, 1, 1);
      mesh.material = tint(mesh.material, hex);
      // Clothes sit right on the skin: nudge them toward the camera so the body doesn't flicker through.
      for (const m of [mesh.material].flat()) if (m) { m.polygonOffset = true; m.polygonOffsetFactor = -1; m.polygonOffsetUnits = -1; }
      mesh.frustumCulled = false;
      model.add(mesh);
      added++;
    });
    if (!added) warnOnce(`${label}:empty`, `Part "${label}" has no skinned mesh; skipping it.`);
    return added;
  }

  // Build an avatar for a recipe. Resolves to the avatar, or null if the body file isn't there.
  async function create(recipe, profile = {}) {
    const r = parseRecipe(recipe);
    if (!r) return null;
    const ids = PART_SLOTS.map((s) => r.parts[s.id] && { slot: s.id, ...r.parts[s.id] }).filter(Boolean);
    const kit = await loadBody(r.body);   // first, so a missing body doesn't also fetch (and 404) every part
    if (!kit) return null;
    const [partFiles, man] = await Promise.all([Promise.all(ids.map((p) => loadFile(partModel(r.body, p.id)))), loadManifest()]);

    const model = SkeletonUtils.clone(kit.gltf.scene);
    const morphs = shapeMorphs(r.shape), tall = heightScale(r.shape);
    if (morphs.length) model.traverse((n) => { if (n.isMesh) n.geometry = shapedBody(kit, n.geometry, morphs); });
    model.scale.setScalar(kit.scale * tall);
    model.position.y = kit.lift * tall;
    tintBody(model, skinHex(r.skin));
    const bits = hideBits(man, r.body, ids.filter((p, i) => partFiles[i]));
    model.traverse((n) => { if (n.isMesh && n.geometry.attributes._hide_top) n.material = hidingMaterial(n.material, bits); });
    model.updateMatrixWorld(true);
    const bones = new Map();
    model.traverse((n) => { if (n.isBone && !bones.has(boneKey(n.name))) bones.set(boneKey(n.name), n); });
    const fit = morphs.length ? fitterFor(kit, morphs) : null;
    const geomOf = (src) => (fit ? fit(src) : src.geometry);
    const hatAt = ids.findIndex((p, i) => p.slot === "hat" && partFiles[i]);
    let crown = null;
    if (hatAt >= 0) {
      const hat = partFiles[hatAt], uuids = [];
      hat.scene.traverse((n) => { if (n.isSkinnedMesh) uuids.push(n.uuid); });
      crown = crownOf(hat, geomOf, `${uuids}|${morphs}`);
    }
    ids.forEach((p, i) => {
      if (!partFiles[i]) return;
      const shape = crown && p.slot === "hair" ? (src) => underHat(src, geomOf(src), crown) : fit && geomOf;
      attachPart(partFiles[i], model, bones, partTintHex(p.id, p.slot, p.color), p.id, shape);
    });

    const root = rigAvatar(THREE, model, kit.clips, profile, kit.height * tall);
    root.userData.recipe = recipe;
    return root;
  }

  return { create, hasBody, loadBody };
}
