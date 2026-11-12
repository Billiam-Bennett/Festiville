// Third-person camera that follows your character, with zoom.
//   Mouse wheel, +/- keys, pinch (two fingers on the scene) or the on-screen +/- buttons.
// Zooming out also tilts the camera toward straight-down, so at full zoom you see the whole festival.
const BASE = 8.75;                 // camera distance at zoom 1 (the classic over-the-shoulder view)
const MIN = 0.55, MAX = 11;
const LOW = (31 * Math.PI) / 180;  // camera pitch up close
const HIGH = (72 * Math.PI) / 180; // camera pitch fully zoomed out

export function createCameraRig(THREE, camera, canvas, scene) {
  let target = 1, zoom = 1;
  try { target = zoom = clamp(parseFloat(localStorage.getItem("fv-zoom")) || 1); } catch {}
  const fog0 = scene.fog ? { near: scene.fog.near, far: scene.fog.far } : null;
  const want = new THREE.Vector3();

  const set = (z) => { target = clamp(z); try { localStorage.setItem("fv-zoom", target.toFixed(2)); } catch {} };
  const zoomBy = (f) => set(target * f);

  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    zoomBy(Math.exp(e.deltaY * 0.0015));
  }, { passive: false });

  addEventListener("keydown", (e) => {
    if (["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;
    if (e.code === "Equal" || e.code === "NumpadAdd") zoomBy(1 / 1.3);
    if (e.code === "Minus" || e.code === "NumpadSubtract") zoomBy(1.3);
  });

  // Pinch: two fingers on the scene (the joystick is its own element, so it doesn't count).
  const touches = new Map();
  let pinch = null;
  const spread = () => { const [a, b] = [...touches.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  canvas.addEventListener("pointerdown", (e) => {
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size === 2) pinch = { d: spread(), z: target };
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!touches.has(e.pointerId)) return;
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && touches.size === 2) set(pinch.z * pinch.d / Math.max(20, spread()));
  });
  const lift = (e) => { touches.delete(e.pointerId); if (touches.size < 2) pinch = null; };
  canvas.addEventListener("pointerup", lift);
  canvas.addEventListener("pointercancel", lift);

  // A ride can take the camera over (client/rides-ui.js: the view from the top of the Ferris wheel).
  // view(dt, camera) is called instead of following; null hands the camera back.
  let override = null;
  return {
    zoomBy,
    get zoom() { return zoom; },
    setView(fn) {
      override = fn;
      if (!fn && fog0) { scene.fog.near = fog0.near; scene.fog.far = fog0.far; }
    },
    // Called every frame with the character to follow.
    update(dt, follow) {
      if (override) {
        override(dt, camera);
        if (fog0) { scene.fog.near = 120; scene.fog.far = 900; }   // from up there you can see the whole festival
        return;
      }
      zoom += (target - zoom) * (1 - Math.exp(-8 * dt));
      const t = Math.min(1, Math.max(0, (zoom - 1) / (MAX - 1)));
      const pitch = LOW + (HIGH - LOW) * (t * t * (3 - 2 * t));
      const dist = BASE * zoom;
      want.set(follow.x, follow.y + Math.sin(pitch) * dist, follow.z + Math.cos(pitch) * dist);
      camera.position.lerp(want, 1 - Math.exp(-6 * dt));
      camera.lookAt(follow.x, follow.y + 1.2, follow.z);
      // Push the fog back as you pull out, or the whole map would be fogged over.
      if (fog0) { scene.fog.near = fog0.near + dist * 0.8; scene.fog.far = fog0.far + dist * 1.3; }
    },
  };
}

const clamp = (z) => Math.min(MAX, Math.max(MIN, z));
