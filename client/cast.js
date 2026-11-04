// Loads characters on demand and hands out avatars.
// make(player) returns an avatar right away (a simple placeholder while the chosen character's
// model downloads), then swaps in the real character. Anything attached to the avatar meanwhile
// (crew ring, carried items) stays put, because it's attached to the outer wrapper.
import { CHARACTERS, DEFAULT_LOOK, lookById, animsFor } from "../shared/characters.js";
import { loadCharacterKit } from "./character.js";

export function createCast(THREE, { placeholder }) {
  const kits = new Map();

  function load(id) {
    const c = lookById(id) ?? lookById(DEFAULT_LOOK);
    if (!kits.has(c.id)) {
      kits.set(c.id, loadCharacterKit(THREE, { modelUrl: `./assets/${c.model}`, animsUrl: `./assets/${animsFor(c)}` })
        .catch((err) => { console.warn(`Character "${c.id}" failed to load; using a placeholder.`, err); return null; }));
    }
    return kits.get(c.id);
  }

  function make(p) {
    const root = new THREE.Group();
    let inner = placeholder(p);
    let tag = [p.name, ""];
    let emoteArgs = null;
    root.add(inner);
    root.userData.look = lookById(p.look)?.id ?? DEFAULT_LOOK;
    root.userData.setTag = (name, sub) => { tag = [name, sub]; inner.userData.setTag?.(name, sub); };
    root.userData.animate = (...args) => { emoteArgs = args; inner.userData.animate?.(...args); };
    root.userData.dispose = () => { root.userData.disposed = true; inner.userData.dispose?.(); };
    load(root.userData.look).then((kit) => {
      if (!kit || root.userData.disposed) return;
      root.remove(inner);
      inner.userData.dispose?.();
      inner = kit.create({ ...p, name: tag[0] });
      inner.userData.setTag?.(...tag);
      if (emoteArgs) inner.userData.animate?.(0, emoteArgs[1], emoteArgs[2]);
      root.add(inner);
    });
    return root;
  }

  return { make, load, characters: CHARACTERS };
}
