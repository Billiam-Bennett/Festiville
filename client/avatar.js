// Parts-based characters: builds a player from a recipe (shared/parts.js).
//
//   const parts = createPartsKit(THREE);
//   const avatar = await parts.create(recipe, profile);   // a ready avatar, or null if the body can't load
//
// How it's put together:
//   1. Load parts/<body>/body.glb (skinned body + the mixamorig* skeleton) and clone it per player.
//   2. Load each part glb (hair, eyebrows, top, bottom, shoes). Take only its skinned meshes, and
//      rebind them to the CLONED body's bones by name, so they follow the body's animation.
//      (The part's own bones are never added to the scene: one skeleton per player.)
//   3. Tint: skin on the body, the chosen swatch on each part (material color × swatch), except parts
//      marked tint: false, which keep their own printed colors.
//   4. Hide the skin under clothes: body.glb has a per-vertex mask per clothing slot (_hide_top,
//      _hide_bottom, _hide_shoes; bit N = that slot's Nth part in parts/manifest.json covers the
//      vertex). The body's material drops those fragments for the parts being worn.
//   5. Animate with the body's one shared set in parts/<body>/anims.json, through rigAvatar() like classic characters.
//
// Everything downloaded is cached and shared: each glb is fetched once, geometry and textures are
// shared by every player wearing it, and tinted materials are shared by players with the same color.
// Missing files never break the game: a missing part is skipped (with a console warning), and a
// missing body makes create() return null so the caller can fall back to a classic character.
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";
import { rigAvatar, collectClips } from "./character.js";
import { parseRecipe, bodyModel, partModel, partsAnims, skinHex, partTintHex, PART_SLOTS } from "../shared/parts.js";

const boneKey = (n) => n.replace(/^mixamorig\d*:?/, "");
// Materials that keep their own color (eyes, teeth, …) — see the contract in shared/parts.js.
const NO_TINT = /eye|teeth|tooth|tongue|lash|fixed|notint/i;
const TARGET_HEIGHT = 1.7;
const HIDE_SLOTS = ["top", "bottom", "shoes"];   // must match CLOTHING_SLOTS in scripts/make-parts.py
const MANIFEST = "parts/manifest.json";

export function createPartsKit(THREE, { base = "./assets/" } = {}) {
  const loader = new GLTFLoader();
  const files = new Map();        // url -> Promise<gltf | null>
  const bodies = new Map();       // body id -> Promise<{ gltf, clips, scale, lift, height } | null>
  const tinted = new Map();       // "materialUuid|#hex" -> tinted material (shared)
  const hiding = new Map();       // "materialUuid|t,b,s" -> body material that hides covered skin (shared)
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

  // Which hide bits the worn parts set, per clothing slot: [top, bottom, shoes].
  function hideBits(man, body, worn) {
    const files = man?.bodies?.[body]?.parts ?? {};
    const bits = HIDE_SLOTS.map(() => 0);
    for (const p of worn) {
      const entry = files[partModel(body, p.id).split("/").pop().replace(/\.glb$/, "")];
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
        return { gltf, clips, scale, lift: -box.min.y * scale, height: h * scale };
      }));
    }
    return bodies.get(body);
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
  function attachPart(gltf, model, bones, hex, label) {
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
    model.scale.setScalar(kit.scale);
    model.position.y = kit.lift;
    tintBody(model, skinHex(r.skin));
    const bits = hideBits(man, r.body, ids.filter((p, i) => partFiles[i]));
    model.traverse((n) => { if (n.isMesh && n.geometry.attributes._hide_top) n.material = hidingMaterial(n.material, bits); });
    model.updateMatrixWorld(true);
    const bones = new Map();
    model.traverse((n) => { if (n.isBone && !bones.has(boneKey(n.name))) bones.set(boneKey(n.name), n); });
    ids.forEach((p, i) => { if (partFiles[i]) attachPart(partFiles[i], model, bones, partTintHex(p.id, p.slot, p.color), p.id); });

    const root = rigAvatar(THREE, model, kit.clips, profile, kit.height);
    root.userData.recipe = recipe;
    return root;
  }

  return { create, hasBody, loadBody };
}
