// The "Build your own" character editor, used on the join screen and in the 👕 panel.
// Pick a body, skin tone, build, face and height, and for each slot (hair, eyebrows, top, bottom, shoes,
// accessory) a part and its color.
// It only edits a recipe string (shared/parts.js); the server re-checks premium parts when you join/apply.
//
//   const builder = createLookBuilder({ host, isUnlocked, onChange, explain });
//   builder.set(recipe); builder.get();
import {
  BODIES, PART_SLOTS, SKIN_TONES, SHAPE_KINDS, partsFor, partById, parseRecipe, formatRecipe,
  randomRecipe, defaultPart,
} from "../shared/parts.js";

const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };

export function createLookBuilder({ host, isUnlocked = (p) => p.tier !== "premium", onChange = () => {}, explain = () => "" }) {
  let r = parseRecipe(randomRecipe());
  const note = el("p", { className: "small lb-note" });

  function chip(label, pressed, onclick, { locked = false, premium = false } = {}) {
    const b = el("button", { type: "button", className: locked ? "locked" : "", textContent: label, onclick });
    b.setAttribute("aria-pressed", String(pressed));
    if (premium) b.append(el("span", { className: "lk", textContent: locked ? "🔒" : "★" }));
    return b;
  }
  function swatches(colors, selected, onpick, label) {
    const row = el("div", { className: "swatches" });
    colors.forEach((hex, i) => {
      const b = el("button", { type: "button", className: "sw", onclick: () => onpick(i) });
      b.style.background = hex;
      b.setAttribute("aria-label", `${label} color ${i + 1}`);
      b.setAttribute("aria-pressed", String(i === selected));
      row.append(b);
    });
    return row;
  }
  const changed = () => { r = parseRecipe(formatRecipe(r)); render(); onChange(formatRecipe(r)); };

  function render() {
    const rows = [];
    rows.push(el("div", { className: "lb-row" }, el("span", { className: "lb-label", textContent: "Body" }),
      el("div", { className: "chips" }, ...BODIES.map((b) => chip(b.name, r.body === b.id, () => { r.body = b.id; changed(); })))));
    rows.push(el("div", { className: "lb-row" }, el("span", { className: "lb-label", textContent: "Skin" }),
      swatches(SKIN_TONES, r.skin, (i) => { r.skin = i; changed(); }, "Skin")));
    for (const kind of SHAPE_KINDS) {
      rows.push(el("div", { className: "lb-row" }, el("span", { className: "lb-label", textContent: kind.name }),
        el("div", { className: "chips" }, ...kind.options.map((o) => chip(o.name, r.shape[kind.id] === o.id, () => { r.shape[kind.id] = o.id; changed(); })))));
    }
    const locked = [];
    for (const slot of PART_SLOTS) {
      const cur = r.parts[slot.id];
      const options = partsFor(r.body, slot.id);
      if (!options.length) continue;
      const chips = el("div", { className: "chips" });
      if (!slot.required) chips.append(chip("None", !cur, () => { delete r.parts[slot.id]; changed(); }));
      for (const p of options) {
        const lk = !isUnlocked(p);
        chips.append(chip(p.name, cur?.id === p.id, () => { r.parts[slot.id] = { id: p.id, color: cur?.color ?? 0 }; changed(); }, { locked: lk, premium: p.tier === "premium" }));
      }
      const row = el("div", { className: "lb-row" }, el("span", { className: "lb-label", textContent: slot.name }), chips);
      if (cur && partById(cur.id)?.tint !== false) row.append(swatches(slot.colors, cur.color, (i) => { cur.color = i; changed(); }, slot.name));
      rows.push(row);
      if (cur && !isUnlocked(partById(cur.id))) locked.push({ part: partById(cur.id), instead: defaultPart(r.body, slot.id) });
    }
    rows.push(el("div", { className: "lb-actions" },
      el("button", { type: "button", className: "btn-ghost btn-sm", textContent: "🎲 Randomize", onclick: () => {
        r = parseRecipe(randomRecipe(Math.random, { body: r.body, allow: isUnlocked }));
        changed();
      } })));
    // Premium lock notes (preview is allowed; the server swaps locked parts when you join/apply).
    const msgs = locked.map(({ part, instead }) => `${part.name} is premium and locked, so you'll get ${instead && instead.id !== part.id ? instead.name : "none"} instead.`);
    const extra = explain(formatRecipe(r));
    note.textContent = [...msgs, extra].filter(Boolean).join(" ");
    note.hidden = !note.textContent;
    host.replaceChildren(...rows, note);
  }

  render();
  return {
    // Load a recipe into the editor (an invalid one keeps the current recipe).
    set(recipe) { const next = parseRecipe(recipe); if (next) r = next; render(); },
    get: () => formatRecipe(r),
    body: () => r.body,
    refresh: render,
  };
}

// A small 3D preview in its own canvas (the 👕 panel), so you can see a look before applying it.
// Shares downloaded models with the game; only renders while it's shown.
export function createPreview(THREE, canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x443355, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(2, 4, 3);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  let avatar = null, raf = 0, last = 0, t = 0;
  function frame(now) {
    const dt = Math.min(0.1, (now - (last || now)) / 1000);
    last = now; t += dt;
    const w = canvas.clientWidth || 160, h = canvas.clientHeight || 220;
    if (canvas.width !== Math.round(w * renderer.getPixelRatio())) { renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
    camera.position.set(Math.sin(t * 0.4) * 4.6, 1.3, Math.cos(t * 0.4) * 4.6);
    camera.lookAt(0, 0.95, 0);
    avatar?.userData.animate?.(dt, 0, "");
    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  }
  return {
    show(next) {
      if (avatar) { avatar.userData.dispose?.(); scene.remove(avatar); }
      avatar = next;
      if (avatar) scene.add(avatar);
    },
    start() { if (!raf) { last = 0; raf = requestAnimationFrame(frame); } },
    stop() { cancelAnimationFrame(raf); raf = 0; },
  };
}

