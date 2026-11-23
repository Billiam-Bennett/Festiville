// Parts-based characters: builds a player from a recipe (shared/parts.js).
//
//   const parts = createPartsKit(THREE);
//   const avatar = await parts.create(recipe, profile);   // a ready avatar, or null if the body can't load
//   parts.update(camera);                                  // once per frame, before rendering (crowd LOD, below)
//
// How it's put together:
//   1. Load parts/<body>/body.glb (skinned body + the mixamorig* skeleton) and clone it per player.
//   2. Load each part glb (hair, eyebrows, top, bottom, shoes). Take only its skinned meshes and bind
//      them to the CLONED body's skeleton, so they follow the body's animation. The part's skin indices
//      are remapped to the body's bone order once per file, so every mesh of a player shares ONE
//      Skeleton (one bone-matrix update per player per frame, not one per part). A part on a different
//      rig falls back to its own skeleton, rebound to the body's bones by name.
//   3. Tint: skin on the body, the chosen swatch on each part (material color × swatch), except parts
//      marked tint: false, which keep their own printed colors.
//   4. Hide what's covered:
//      - skin under clothes: body.glb has a per-vertex mask per clothing slot (_hide_top, _hide_bottom,
//        _hide_shoes; bit N = that slot's Nth part in parts/manifest.json covers the vertex). The body's
//        material drops those fragments for the parts being worn (and fully covered triangles are left
//        out of the index, which looks the same and draws less).
//      - clothes under clothes: where two worn garments cover the same skin (a sweater over a skirt's
//        waistband, boots over trouser legs), the one sitting further from the skin there is the outer
//        layer, and the inner one's triangles under it are left out, so they can't poke through.
//   5. Animate with the body's one shared set in parts/<body>/anims.json, through rigAvatar() like classic characters.
//
// Crowds (update(camera), once per frame):
//   - Culling: each mesh gets a bounding sphere that holds the body in every frame of every animation
//     (sampled once per body), so normal frustum culling works for skinned meshes without popping.
//     Players further than LOD.cull aren't drawn at all.
//   - Level of detail by distance: full detail up close (unchanged look); from LOD.near, simplified
//     copies of each part (merged vertices smaller than a pixel there) without eyebrows/eyelashes; from
//     LOD.far, the whole player as ONE untextured mesh with baked colors (1 draw call instead of ~8).
//   - Animation: players out of view don't animate; far ones update every 2nd/4th frame.
//   Without update() calls, everything stays at full detail (frustum culling still works).
//
// Everything downloaded is cached and shared: each glb is fetched and parsed once, geometry and
// textures are shared by every player wearing it (identical textures in different files, e.g. the
// female and male copy of a part, are uploaded once), and tinted materials are shared by players with
// the same color. Missing files never break the game: a missing part is skipped (with a console
// warning), and a missing body makes create() return null so the caller can fall back to a classic character.
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";
import { rigAvatar, collectClips } from "./character.js";
import { parseRecipe, bodyModel, partModel, partsAnims, skinHex, partTintHex, PART_SLOTS } from "../shared/parts.js";
import {
  remapSkin, shallowCopy, trimIndex, bodyHiddenFlags, bodyGrid, mapToBody, clusterGeometry, clusterFlags,
  bakeColors, mergePieces,
} from "./avatar-geometry.js";

const boneKey = (n) => n.replace(/^mixamorig\d*:?/, "");
// Materials that keep their own color (eyes, teeth, …) — see the contract in shared/parts.js.
const NO_TINT = /eye|teeth|tooth|tongue|lash|fixed|notint/i;
const TARGET_HEIGHT = 1.7;
const HIDE_SLOTS = ["top", "bottom", "shoes"];   // must match CLOTHING_SLOTS in scripts/make-parts.py
const MANIFEST = "parts/manifest.json";

// Crowd tuning (meters, at a 60° field of view; scaled for other FOVs and zoom).
export const LOD = {
  near: 14,       // closer than this: full detail
  far: 34,        // further than this: one merged mesh per player
  cull: 95,       // further than this: not drawn
  tags: 45,       // name tags, contact shadows and accessories hidden beyond this
  cells: [0.006, 0.03],   // vertex-merge grid for the near/far simplified meshes (well under a pixel at that distance)
  builds: 3,      // merged far meshes built per update() at most (spreads the work over frames)
};
// Default stacking where two garments sit at the same height off the skin (see layerFor()): higher is outer.
const LAYER_RANK = { bottom: 1, top: 2, shoes: 3 };
const TUCKED = /tucked/i;      // tucked-in tops go under the bottoms

export function createPartsKit(THREE, { base = "./assets/" } = {}) {
  const loader = new GLTFLoader();
  const files = new Map();        // url -> Promise<gltf | null>
  const bodies = new Map();       // body id -> Promise<body kit | null>
  const prepared = new Map();     // body|url -> Promise<prepared part | null>
  const tinted = new Map();       // "materialUuid|#hex" -> tinted material (shared)
  const hiding = new Map();       // "materialUuid|t,b,s" -> body material that hides covered skin (shared)
  const trimmed = new Map();      // geometry uuid|key -> geometry with covered triangles left out (shared)
  const layered = new Map();      // "fileA|fileB" -> which is outer
  const textures = new Map();     // content hash -> texture (one upload per distinct image)
  const warned = new Set();
  const anims = new Map();        // body id -> Promise<array of clip JSON>
  const live = new Set();         // avatars update() looks after
  let manifest = null;            // Promise<manifest json | null>
  let farMaterial = null;
  let frame = 0;

  const warnOnce = (key, ...msg) => { if (!warned.has(key)) { warned.add(key); console.warn(...msg); } };

  function loadFile(path) {
    const url = base + path;
    if (!files.has(url)) {
      files.set(url, loader.loadAsync(url).then(async (gltf) => {
        await shareTextures(gltf);
        gltf.scene.updateMatrixWorld(true);
        return gltf;
      }).catch((err) => { warnOnce(url, `Character part ${url} is missing or broken; skipping it.`, err?.message ?? err); return null; }));
    }
    return files.get(url);
  }

  // Identical images in different files (every part is exported once per body) become one texture.
  async function shareTextures(gltf) {
    const parser = gltf.parser, json = parser?.json;
    if (!json?.images) return;
    const swap = new Map();
    await Promise.all([...parser.associations].map(async ([tex, ref]) => {
      if (!tex?.isTexture || ref?.textures === undefined) return;
      const def = json.textures[ref.textures];
      const img = json.images[def.extensions?.EXT_texture_webp?.source ?? def.source];
      if (img?.bufferView === undefined) return;
      const bytes = new Uint8Array(await parser.getDependency("bufferView", img.bufferView));
      let h = 2166136261;
      for (let i = 0; i < bytes.length; i += 1) h = Math.imul(h ^ bytes[i], 16777619);
      const key = `${h >>> 0}|${bytes.length}|${tex.colorSpace}|${tex.flipY}|${tex.wrapS},${tex.wrapT}|${tex.minFilter},${tex.magFilter}`;
      const have = textures.get(key);
      if (!have) textures.set(key, tex);
      else if (have !== tex) swap.set(tex, have);
    }));
    if (!swap.size) return;
    gltf.scene.traverse((n) => {
      for (const m of n.isMesh ? [n.material].flat() : []) for (const [k, v] of Object.entries(m)) if (swap.has(v)) m[k] = swap.get(v);
    });
    for (const t of swap.keys()) { t.image?.close?.(); t.dispose(); }
  }

  function loadAnims(body) {
    if (!anims.has(body)) anims.set(body, fetch(base + partsAnims(body)).then((r) => (r.ok ? r.json() : [])).catch(() => []));
    return anims.get(body);
  }

  function loadManifest() {
    manifest ??= fetch(base + MANIFEST).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    return manifest;
  }

  const manifestEntry = (man, body, partId) => man?.bodies?.[body]?.parts?.[partModel(body, partId).split("/").pop().replace(/\.glb$/, "")];

  // Which hide bits the worn parts set, per clothing slot: [top, bottom, shoes].
  function hideBits(man, body, worn) {
    const bits = HIDE_SLOTS.map(() => 0);
    for (const p of worn) {
      const entry = manifestEntry(man, body, p.id);
      const s = HIDE_SLOTS.indexOf(entry?.slot);
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
        shader.uniforms.fvHide = { value: new THREE.Vector3(...bits) };
        shader.vertexShader = shader.vertexShader
          .replace("#include <common>", `#include <common>
attribute float _hide_top;
attribute float _hide_bottom;
attribute float _hide_shoes;
uniform vec3 fvHide;
varying float vFvHide;`)
          .replace("#include <begin_vertex>", `#include <begin_vertex>
ivec3 fvMask = ivec3(int(_hide_top + 0.5), int(_hide_bottom + 0.5), int(_hide_shoes + 0.5));
ivec3 fvWorn = ivec3(fvHide + 0.5);
vFvHide = ((fvMask.x & fvWorn.x) | (fvMask.y & fvWorn.y) | (fvMask.z & fvWorn.z)) != 0 ? 1.0 : 0.0;`);
        shader.fragmentShader = shader.fragmentShader
          .replace("#include <common>", "#include <common>\nvarying float vFvHide;")
          .replace("#include <clipping_planes_fragment>", "#include <clipping_planes_fragment>\nif (vFvHide > 0.5) discard;");
      };
      m.customProgramCacheKey = () => "fv-hide";   // one shader for every mask; the bits are a uniform
      hiding.set(key, m);
    }
    return hiding.get(key);
  }

  // A shared copy of `geometry` without the triangles flagged by `flags()` (computed on first use).
  function trimmedGeometry(geometry, key, flags, minHidden) {
    const k = `${geometry.uuid}|${key}`;
    if (!trimmed.has(k)) {
      const index = trimIndex(THREE, geometry, flags(), minHidden);
      trimmed.set(k, index ? shallowCopy(THREE, geometry, index) : geometry);
    }
    return trimmed.get(k);
  }

  // ---------- Bodies ----------

  // The base body for "female" / "male", measured once.
  function loadBody(body) {
    if (!bodies.has(body)) {
      bodies.set(body, Promise.all([loadFile(bodyModel(body)), loadAnims(body)]).then(([gltf, extra]) => {
        if (!gltf) return null;
        gltf.scene.traverse((n) => { if (n.isMesh) n.frustumCulled = false; });   // the template itself is never drawn
        const clips = collectClips(THREE, gltf.animations, extra);
        if (!clips.Idle) warnOnce("anims", `No Idle animation in ${base}${partsAnims(body)} (or in the body); built characters will stand still.`);
        const box = new THREE.Box3().setFromObject(gltf.scene);
        const h = Math.max(box.max.y - box.min.y, 0.01);
        // MakeHuman exports in meters, and the two bodies keep their real heights. If a file comes in
        // centimeters (or otherwise way off), scale it to a normal height instead.
        const scale = h > 1.2 && h < 2.4 ? 1 : TARGET_HEIGHT / h;
        return { gltf, clips, scale, lift: -box.min.y * scale, height: h * scale, ...measureBody(gltf, clips, h) };
      }));
    }
    return bodies.get(body);
  }

  // Everything per body that crowds need: the skin mesh, its bone order, the culling sphere, the skin
  // lookup for clothing layers, and simplified copies for distance.
  function measureBody(gltf, clips, height) {
    let skin = null;
    gltf.scene.traverse((n) => { if (n.isSkinnedMesh && n.geometry.attributes._hide_top && !skin) skin = n; });
    if (!skin) gltf.scene.traverse((n) => { if (n.isSkinnedMesh && !skin) skin = n; });
    if (!skin) return {};
    const bones = skin.skeleton.bones.map((b) => boneKey(b.name));
    const boneIndex = new Map(bones.map((k, i) => [k, i]));

    // Bounds: the body in every pose of every animation (sampled), plus room for hair, skirts and platforms.
    const sphere = animatedBounds(gltf, clips, height);
    const meshSpheres = new Map();
    gltf.scene.traverse((n) => {
      if (!n.isMesh) return;
      const inv = n.matrixWorld.clone().invert();   // the template's root is at the origin
      meshSpheres.set(n.name, sphere.clone().applyMatrix4(inv));
    });

    // Skin coverage per clothing slot, and a lookup to find the skin under a garment.
    const masks = HIDE_SLOTS.map((s) => {
      const a = skin.geometry.attributes["_hide_" + s];
      return a ? Int32Array.from({ length: a.count }, (_, i) => Math.round(a.getX(i))) : null;
    });
    const grid = bodyGrid(skin.geometry.attributes.position);
    // The bare head: its top, and its half width a little below the top (hats sit there).
    const pos = skin.geometry.attributes.position;
    let top = -Infinity, cx = 0;
    for (let i = 0; i < pos.count; i++) if (pos.getY(i) > top) { top = pos.getY(i); cx = pos.getX(i); }
    let hw = 0.08;
    for (let i = 0; i < pos.count; i++) if (pos.getY(i) > top - 0.08) hw = Math.max(hw, Math.abs(pos.getX(i) - cx));
    const headTop = { x: cx, y: top, halfWidth: hw };

    // Simplified skin for distance: [near-ish, far].
    const lods = LOD.cells.map((cell, i) => {
      const { geometry, map } = clusterGeometry(THREE, skin.geometry, { cell, uvCell: i === 0 ? 1 / 32 : 0 });
      return { geometry, map };
    });
    const count = lods[1].geometry.attributes.position.count;
    lods[1].color = bakeColors(THREE, skin.geometry, lods[1].map, count, [skin.material].flat()[0]).color;
    return { skinName: skin.name, skin, bones, boneIndex, sphere, meshSpheres, masks, grid, lods, headTop };
  }

  function animatedBounds(gltf, clips, height) {
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const clone = SkeletonUtils.clone(gltf.scene);
    let skin = null;
    clone.traverse((n) => { if (n.isSkinnedMesh && (!skin || n.geometry.attributes.position.count > skin.geometry.attributes.position.count)) skin = n; });
    if (skin) {
      const mixer = new THREE.AnimationMixer(clone);
      const v = new THREE.Vector3();
      const n = skin.geometry.attributes.position.count, step = Math.max(1, Math.floor(n / 1500));
      for (const clip of Object.values(clips)) {
        mixer.stopAllAction();
        const action = mixer.clipAction(clip);
        action.play();
        for (let s = 0; s <= 12; s++) {
          mixer.setTime((clip.duration * s) / 12);
          clone.updateMatrixWorld(true);
          skin.skeleton.update();
          for (let i = 0; i < n; i += step) box.expandByPoint(skin.getVertexPosition(i, v).applyMatrix4(skin.matrixWorld));
        }
        mixer.uncacheClip(clip);
      }
    }
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    sphere.radius = Math.max(sphere.radius + 0.3 * (height / TARGET_HEIGHT), 0.65 * height);
    return sphere;
  }

  // Is this body's base file available? (The picker uses it to explain a fallback.)
  const hasBody = async (body) => !!(await loadBody(body));

  // ---------- Parts ----------

  // A part file made ready for a body: its skinned meshes with skin indices in the body's bone order,
  // the skin under each vertex (clothing layers), and simplified copies for distance.
  function preparePart(kit, body, path, slot) {
    const key = `${body}|${path}`;
    if (!prepared.has(key)) {
      prepared.set(key, loadFile(path).then((gltf) => {
        if (!gltf) return null;
        const meshes = [];
        gltf.scene.traverse((src) => { if (src.isSkinnedMesh) meshes.push(prepareMesh(kit, src, slot)); });
        return { file: path, slot, gltf, meshes };
      }));
    }
    return prepared.get(key);
  }

  function prepareMesh(kit, src, slot) {
    const out = { src, shared: false };
    if (!kit.bones) return out;
    // Map the part's bones onto the body's; only share the body's skeleton if the rest pose matches.
    const toBody = src.skeleton.bones.map((b) => {
      for (let n = b; n; n = n.parent) { const i = kit.boneIndex.get(boneKey(n.name)); if (i !== undefined) return i; }
      return -1;
    });
    const bodyInv = kit.skin.skeleton.boneInverses;
    const same = (a, b) => a.elements.every((v, k) => Math.abs(v - b.elements[k]) < 1e-4);
    out.shared = toBody.every((i, j) => i >= 0 && same(src.skeleton.boneInverses[j], bodyInv[i])) && same(src.bindMatrix, kit.skin.bindMatrix);
    if (!out.shared) return out;
    out.geometry = remapSkin(THREE, src.geometry, toBody);
    if (HIDE_SLOTS.includes(slot)) out.onBody = mapToBody(out.geometry, kit.grid);
    // Simplified copies. The near one is only used if it actually saves something.
    out.lods = LOD.cells.map((cell, i) => clusterGeometry(THREE, out.geometry, { cell, uvCell: i === 0 ? 1 / 32 : 0 }));
    const before = out.geometry.index ? out.geometry.index.count : out.geometry.attributes.position.count;
    if (out.lods[0].geometry.index.count > before * 0.85) out.lods[0] = null;
    const far = out.lods[1], count = far.geometry.attributes.position.count;
    Object.assign(far, bakeColors(THREE, out.geometry, far.map, count, [src.material].flat()[0]));
    return out;
  }

  // ---------- Clothing layers ----------

  // Which of two garments is outside where they overlap: the one sitting further from the skin over
  // the skin both cover. Too close to call: the usual order (tops over bottoms over…, shoes outermost;
  // tucked tops under bottoms).
  function outerOf(kit, a, b) {
    const key = `${a.file}|${b.file}`;
    if (layered.has(key)) return layered.get(key);
    const ca = coverage(kit, a), cb = coverage(kit, b);
    const mean = (g, mesh) => {
      let s = 0, n = 0;
      const { near, dist } = mesh.onBody;
      for (let i = 0; i < near.length; i++) if (near[i] >= 0 && ca(near[i]) && cb(near[i])) { s += dist[i]; n++; }
      return n ? s / n : null;
    };
    const ma = avg(a.meshes.filter((m) => m.onBody).map((m) => mean(a, m)));
    const mb = avg(b.meshes.filter((m) => m.onBody).map((m) => mean(b, m)));
    const rank = (g) => (g.slot === "top" && TUCKED.test(g.file) ? 0.5 : LAYER_RANK[g.slot] ?? 0);
    const outer = ma != null && mb != null && Math.abs(ma - mb) > 0.005 ? (ma > mb ? a : b) : rank(a) >= rank(b) ? a : b;
    layered.set(key, outer);
    layered.set(`${b.file}|${a.file}`, outer);
    return outer;
  }
  const avg = (xs) => { const v = xs.filter((x) => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };

  // Does garment g cover body vertex i? (From the body's hide masks.)
  function coverage(kit, g) {
    const s = HIDE_SLOTS.indexOf(g.slot), mask = kit.masks?.[s], bit = g.hideBit;
    if (!mask || !Number.isInteger(bit)) return () => false;
    return (i) => ((mask[i] >> bit) & 1) === 1;
  }

  // For each worn garment: the garments it's under (by file), or none.
  function layersFor(kit, worn) {
    const garments = worn.filter((g) => HIDE_SLOTS.includes(g.slot) && Number.isInteger(g.hideBit) && g.meshes.some((m) => m.onBody));
    const under = new Map();
    for (const a of garments) for (const b of garments) {
      if (a === b || a.slot === b.slot) continue;
      if (outerOf(kit, a, b) === b) { if (!under.has(a)) under.set(a, []); under.get(a).push(b); }
    }
    return under;
  }

  // Per-vertex flags for a garment's mesh: 1 = under one of `outers` (so hidden). Cached per outer set.
  function underFlags(kit, mesh, outers, key) {
    mesh.under ??= new Map();
    if (!mesh.under.has(key)) mesh.under.set(key, computeUnder(kit, mesh, outers));
    return mesh.under.get(key);
  }
  function computeUnder(kit, mesh, outers) {
    const covers = outers.map((o) => coverage(kit, o));
    const { near } = mesh.onBody;
    const out = new Uint8Array(near.length);
    for (let i = 0; i < near.length; i++) if (near[i] >= 0 && covers.some((c) => c(near[i]))) out[i] = 1;
    return out;
  }

  // ---------- Materials ----------

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

  // Clothes sit right on the skin: nudge them toward the camera so the body doesn't flicker through.
  // Hair a bit more, so it wins over collars it rests on.
  function nudge(material, slot) {
    for (const m of [material].flat()) if (m) {
      m.polygonOffset = true;
      m.polygonOffsetFactor = slot === "hair" ? -2 : -1;
      m.polygonOffsetUnits = slot === "hair" ? -4 : -1;
    }
  }

  // ---------- Building a player ----------

  // Fallback for a part on a different rig: its own skeleton, rebound to the body's bones by name.
  function attachLegacy(src, model, bones, material, label) {
    const rootBone = bones.get("Hips") ?? [...bones.values()][0];
    const mapped = src.skeleton.bones.map((b) => {
      // Same name on the body, else the closest ancestor that exists (extra bones, e.g. a hair rig).
      for (let n = b; n; n = n.parent) { const hit = bones.get(boneKey(n.name)); if (hit) return hit; }
      warnOnce(`${label}:${b.name}`, `Part "${label}" uses bone "${b.name}", which the body doesn't have.`);
      return rootBone;
    });
    const mesh = src.clone();   // shares geometry; gets its own skeleton below
    // The part's boneInverses describe the same rest pose as the body (same rig), so its vertices
    // land on the body. bindMode "attached" means the mesh's own placement doesn't matter.
    mesh.bind(new THREE.Skeleton(mapped, src.skeleton.boneInverses.map((m) => m.clone())), src.bindMatrix.clone());
    mesh.position.set(0, 0, 0); mesh.quaternion.identity(); mesh.scale.set(1, 1, 1);
    mesh.material = material;
    mesh.frustumCulled = false;
    model.add(mesh);
    return mesh;
  }

  // Build an avatar for a recipe. Resolves to the avatar, or null if the body file isn't there.
  async function create(recipe, profile = {}) {
    const r = parseRecipe(recipe);
    if (!r) return null;
    const ids = PART_SLOTS.map((s) => r.parts[s.id] && { slot: s.id, ...r.parts[s.id] }).filter(Boolean);
    const kit = await loadBody(r.body);   // first, so a missing body doesn't also fetch (and 404) every part
    if (!kit) return null;
    const [preps, man] = await Promise.all([
      Promise.all(ids.map((p) => preparePart(kit, r.body, partModel(r.body, p.id), p.slot))),
      loadManifest(),
    ]);
    ids.forEach((p, i) => { if (preps[i]) preps[i].hideBit ??= manifestEntry(man, r.body, p.id)?.hideBit; });

    const model = SkeletonUtils.clone(kit.gltf.scene);
    model.scale.setScalar(kit.scale);
    model.position.y = kit.lift;
    tintBody(model, skinHex(r.skin));
    const bits = hideBits(man, r.body, ids.filter((p, i) => preps[i]));
    const st = { kit, model, bits, meshes: [], level: 0, far: null, parts: [] };

    // The body: one skeleton for every mesh; covered skin hidden (shader) and fully covered triangles dropped.
    let skeleton = null;
    model.traverse((n) => { if (n.isSkinnedMesh && n.name === kit.skinName) skeleton = n.skeleton; });
    const bodyMeshes = [];
    model.traverse((n) => { if (n.isMesh) bodyMeshes.push(n); });
    for (const n of bodyMeshes) {
      n.boundingSphere = kit.meshSpheres?.get(n.name)?.clone() ?? null;
      n.frustumCulled = !!n.boundingSphere;
      if (n.isSkinnedMesh && skeleton && n.skeleton !== skeleton && n.skeleton.bones.length === skeleton.bones.length) n.bind(skeleton, n.bindMatrix);
      const isSkin = n.name === kit.skinName;
      if (n.geometry.attributes._hide_top) {
        n.material = hidingMaterial(n.material, bits);
        n.geometry = trimmedGeometry(n.geometry, `body|${bits}`, () => bodyHiddenFlags(n.geometry, bits, HIDE_SLOTS), 3);
      }
      const lash = /lash/i.test([n.material].flat()[0]?.name ?? n.name);
      st.meshes.push([n, lash || isSkin ? 0b001 : 0b011]);
      if (isSkin && kit.lods) {
        // Simplified skin for the middle distance: same material, same hiding.
        const lod = kit.lods[0];
        const g = trimmedGeometry(lod.geometry, `body|${bits}`, () => bodyHiddenFlags(lod.geometry, bits, HIDE_SLOTS), 3);
        const m = new THREE.SkinnedMesh(g, n.material);
        m.name = n.name + "_lod1";
        m.bind(skeleton, n.bindMatrix);
        m.boundingSphere = n.boundingSphere; m.frustumCulled = n.frustumCulled;
        m.position.copy(n.position); m.quaternion.copy(n.quaternion); m.scale.copy(n.scale);
        n.parent.add(m);
        st.meshes.push([m, 0b010]);
      }
    }
    model.updateMatrixWorld(true);
    const bones = new Map();
    model.traverse((n) => { if (n.isBone && !bones.has(boneKey(n.name))) bones.set(boneKey(n.name), n); });

    // The parts.
    const worn = preps.filter(Boolean);
    const under = layersFor(kit, worn);
    ids.forEach((p, i) => {
      const prep = preps[i];
      if (!prep) return;
      const hex = partTintHex(p.id, p.slot, p.color);
      const outers = under.get(prep) ?? [];
      const outerKey = outers.map((o) => o.file).sort().join(",");
      let added = 0;
      for (const pm of prep.meshes) {
        const material = tint(pm.src.material, hex);
        nudge(material, p.slot);
        if (!pm.shared) {   // different rig: full detail at every distance
          const mesh = attachLegacy(pm.src, model, bones, material, p.id);
          st.meshes.push([mesh, 0b111]);
          added++;
          continue;
        }
        const flags = outers.length ? underFlags(kit, pm, outers, outerKey) : null;
        const piece = { slot: p.slot, pm, material, flags };
        st.parts.push(piece);
        const make = (geometry, levels) => {
          const mesh = new THREE.SkinnedMesh(geometry, material);
          mesh.name = pm.src.name;
          mesh.bind(skeleton, pm.src.bindMatrix);
          mesh.boundingSphere = kit.sphere;
          mesh.frustumCulled = true;
          model.add(mesh);
          st.meshes.push([mesh, levels]);
        };
        const g0 = flags ? trimmedGeometry(pm.geometry, `under|${outerKey}`, () => flags, 2) : pm.geometry;
        const lod = pm.lods[0];
        const nearOnly = p.slot === "eyebrows";
        if (!lod || nearOnly) make(g0, nearOnly ? 0b001 : 0b011);
        else {
          make(g0, 0b001);
          const n = lod.geometry.attributes.position.count;
          make(flags ? trimmedGeometry(lod.geometry, `under|${outerKey}`, () => clusterFlags(lod.map, flags, n), 2) : lod.geometry, 0b010);
        }
        added++;
      }
      if (!added) warnOnce(`${p.id}:empty`, `Part "${p.id}" has no skinned mesh; skipping it.`);
    });

    const root = rigAvatar(THREE, model, kit.clips, profile, kit.height);
    root.userData.recipe = recipe;
    fitHats(root, worn, kit);
    track(root, st, !!skeleton && !!kit.lods);
    return root;
  }

  // Hats sit on the hair: raise them by how far the worn hair rises above the bare head, and widen
  // them to fit around it (big hair like an afro or a bun otherwise pokes through the hat).
  function fitHats(root, worn, kit) {
    const hair = worn.find((g) => g.slot === "hair");
    if (!hair || !kit.headTop) return;
    const box = new THREE.Box3();
    for (const m of hair.meshes) { m.src.geometry.computeBoundingBox(); box.union(m.src.geometry.boundingBox); }
    if (box.isEmpty()) return;
    const lift = Math.max(0, box.max.y - kit.headTop.y - 0.02);
    const halfWidth = Math.max(box.max.x - kit.headTop.x, kit.headTop.x - box.min.x);
    const widen = Math.min(1.6, Math.max(1, halfWidth / kit.headTop.halfWidth - 0.1));
    if (lift < 0.005 && widen === 1) return;
    root.traverse((g) => {
      const a = g.userData.accessory;   // set by rigAvatar (client/character.js)
      if (a?.slot !== "head" || !Array.isArray(a.offset) || g.userData.fvFitted) return;
      g.userData.fvFitted = true;
      a.offset[1] += lift;
      if (!a.spin) g.scale.multiplyScalar(widen);   // floating halos just float higher
    });
  }

  // ---------- Crowds ----------

  function track(root, st, lodable) {
    st.root = root;
    st.lodable = lodable;
    st.phase = live.size;
    st.acc = 0;
    st.stride = 1;
    st.args = [];
    st.extras = root.children.filter((c) => c !== st.model);   // name tag, contact shadow, accessories
    const animate = root.userData.animate;
    if (animate) root.userData.animate = (dt, ...rest) => {
      st.acc += dt;
      st.args = rest;
      if (st.stride === 0) { st.acc = Math.min(st.acc, 1); return; }   // out of view: catch up later
      if ((frame + st.phase) % st.stride !== 0) return;
      const step = Math.min(st.acc, 1);
      st.acc = 0;
      animate(step, ...rest);
    };
    st.animate = animate;
    const dispose = root.userData.dispose;
    root.userData.dispose = () => {
      live.delete(st);
      st.far?.geometry.dispose();
      dispose?.();
    };
    setLevel(st, 0);
    live.add(st);
  }

  function setLevel(st, level) {
    if (level === 2 && !st.far) level = 1;
    st.level = level;
    const bit = 1 << level;
    for (const [m, levels] of st.meshes) m.visible = (levels & bit) !== 0;
    if (st.far) st.far.visible = level === 2;
  }

  // One mesh for the whole player: simplified skin and clothes, colors baked in, no textures.
  function buildFar(st) {
    const { kit } = st;
    farMaterial ??= new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
    const skinLod = kit.lods[1];
    const skinMat = [kit.skin.material].flat()[0];
    const body = st.meshes.find(([m]) => m.name === kit.skinName)?.[0];
    const bodyHidden = clusterFlags(skinLod.map, bodyHiddenFlags(kit.skin.geometry, st.bits, HIDE_SLOTS), skinLod.geometry.attributes.position.count);
    const pieces = [{ geometry: skinLod.geometry, color: skinLod.color, tint: [body?.material].flat()[0]?.color ?? skinMat.color, keep: bodyHidden.map((h) => 1 - h) }];
    for (const { slot, pm, material, flags } of st.parts) {
      if (slot === "eyebrows") continue;
      const lod = pm.lods[1], n = lod.geometry.attributes.position.count;
      const under = flags ? clusterFlags(lod.map, flags, n) : null;
      const cutoff = Math.max(0.3, ([material].flat()[0]?.alphaTest ?? 0) * 0.8);
      const keep = new Uint8Array(n).map((_, i) => (lod.alpha[i] >= cutoff && !(under && under[i]) ? 1 : 0));
      pieces.push({ geometry: lod.geometry, color: lod.color, tint: [material].flat()[0]?.color ?? new THREE.Color(1, 1, 1), keep });
    }
    const mesh = new THREE.SkinnedMesh(mergePieces(THREE, pieces), farMaterial);
    const skeleton = body?.skeleton;
    mesh.bind(skeleton, body?.bindMatrix ?? new THREE.Matrix4());
    mesh.boundingSphere = kit.sphere;
    mesh.frustumCulled = true;
    mesh.name = "far";
    st.model.add(mesh);
    st.far = mesh;
  }

  const frustum = new THREE.Frustum(), viewProj = new THREE.Matrix4(), sphere = new THREE.Sphere(), camPos = new THREE.Vector3();
  const tan30 = Math.tan(Math.PI / 6);

  function inScene(o) { while (o.parent) o = o.parent; return o.isScene === true; }

  // Once per frame, before rendering: pick each player's detail level, cull far ones, pace animation.
  function update(camera) {
    frame++;
    camera.updateMatrixWorld();
    viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(viewProj);
    camera.getWorldPosition(camPos);
    const scale = camera.isPerspectiveCamera ? Math.tan((camera.fov * Math.PI) / 360) / tan30 / (camera.zoom || 1) : 1;
    let builds = LOD.builds;
    for (const st of live) {
      if (!inScene(st.root)) continue;
      if (st.kit.sphere) sphere.copy(st.kit.sphere).applyMatrix4(st.model.matrixWorld);
      else sphere.set(st.model.getWorldPosition(sphere.center), 2);
      const d = camPos.distanceTo(sphere.center) * scale;
      const shown = d < LOD.cull;
      st.root.visible = shown;
      for (const e of st.extras) e.visible = d < LOD.tags;
      const inView = shown && frustum.intersectsSphere(sphere);
      // Detail level, with a little hysteresis so players at the boundary don't flicker between levels.
      let level = 0;
      if (st.lodable) {
        const pad = st.level === 0 ? 1 : -1, pad2 = st.level === 2 ? -2 : 2;
        level = d < LOD.near + pad ? 0 : d < LOD.far + pad2 ? 1 : 2;
        if (level === 2 && !st.far && inView && builds > 0) { buildFar(st); builds--; }
      }
      if (level !== st.level || (level === 2 && st.far && !st.far.visible)) setLevel(st, level);
      const wasHidden = st.stride === 0;
      st.stride = !inView ? 0 : st.level === 0 ? 1 : st.level === 1 ? 2 : 4;
      if (wasHidden && st.stride && st.acc > 0 && st.animate) { const step = Math.min(st.acc, 1); st.acc = 0; st.animate(step, ...st.args); }
    }
  }

  // Counts for the benchmark / debugging.
  function stats() {
    const out = { avatars: 0, levels: [0, 0, 0], hidden: 0, animating: 0 };
    for (const st of live) {
      out.avatars++;
      if (!st.root.visible) out.hidden++;
      else out.levels[st.level]++;
      if (st.stride) out.animating++;
    }
    return out;
  }

  return { create, hasBody, loadBody, update, stats };
}
