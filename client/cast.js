// Loads characters on demand and hands out avatars.
// make(player) returns an avatar right away (a simple placeholder while the chosen character's
// model downloads), then swaps in the real character. Anything attached to the avatar meanwhile
// (crew ring, carried items) stays put, because it's attached to the outer wrapper.
//
// A player has either a parts-based recipe (shared/parts.js, built by client/avatar.js) or a classic
// whole character (`look`, shared/characters.js). If the recipe can't be built (the part files aren't
// installed yet), the classic look is shown instead, then the placeholder as a last resort.
import { CHARACTERS, DEFAULT_LOOK, lookById, animsFor } from "../shared/characters.js";
import { normalizeRecipe, parseRecipe, skinHex, partTintHex } from "../shared/parts.js";
import { loadCharacterKit } from "./character.js";
import { createPartsKit } from "./avatar.js";

export function createCast(THREE, { placeholder }) {
  const kits = new Map();
  const parts = createPartsKit(THREE);

  function load(id) {
    const c = lookById(id) ?? lookById(DEFAULT_LOOK);
    if (!kits.has(c.id)) {
      kits.set(c.id, loadCharacterKit(THREE, { modelUrl: `./assets/${c.model}`, animsUrl: `./assets/${animsFor(c)}` })
        .catch((err) => { console.warn(`Character "${c.id}" failed to load; using a placeholder.`, err); return null; }));
    }
    return kits.get(c.id);
  }

  // The placeholder takes its colors from the recipe, so a built character looks roughly right meanwhile.
  function placeholderColors(p, recipe) {
    const r = parseRecipe(recipe);
    if (!r) return p;
    const top = r.parts.top;
    return { name: p.name, skinTone: skinHex(r.skin), shirtColor: (top && partTintHex(top.id, "top", top.color)) || p.shirtColor };
  }

  function make(p) {
    const root = new THREE.Group();
    const recipe = normalizeRecipe(p.recipe);
    let inner = placeholder(placeholderColors(p, recipe));
    let tag = [p.name, ""];
    let emoteArgs = null;
    root.add(inner);
    root.userData.look = lookById(p.look)?.id ?? DEFAULT_LOOK;
    root.userData.recipe = recipe;
    root.userData.setTag = (name, sub) => { tag = [name, sub]; inner.userData.setTag?.(name, sub); };
    root.userData.animate = (...args) => { emoteArgs = args; inner.userData.animate?.(...args); };
    root.userData.dispose = () => { root.userData.disposed = true; inner.userData.dispose?.(); };
    const swap = (next) => {
      if (!next || root.userData.disposed) return;
      root.remove(inner);
      inner.userData.dispose?.();
      inner = next;
      inner.userData.setTag?.(...tag);
      if (emoteArgs) inner.userData.animate?.(0, emoteArgs[1], emoteArgs[2]);
      root.add(inner);
    };
    const classic = () => load(root.userData.look).then((kit) => kit && !root.userData.disposed && swap(kit.create({ ...p, name: tag[0] })));
    const profile = { name: tag[0], accessories: p.accessories };
    if (recipe) {
      parts.create(recipe, profile)
        .catch((err) => { console.warn("Couldn't build that character from parts; using the classic one.", err); return null; })
        .then((obj) => (obj ? swap(obj) : classic()));
    } else classic();
    return root;
  }

  // Are the part files for this body installed? (The look builder says so when they aren't.)
  const partsReady = (body) => parts.hasBody(body);

  return { make, load, partsReady, characters: CHARACTERS };
}
