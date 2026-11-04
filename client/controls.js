// Keyboard (WASD / arrows + Shift to run) and an on-screen joystick for phones.
// getInput() returns { x, z, run } in world space; up on screen = -Z.

export function createControls(joystickEl) {
  const keys = new Set();
  const stick = { x: 0, z: 0, active: false };

  const isTyping = () => ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName);
  addEventListener("keydown", (e) => { if (!isTyping()) keys.add(e.code); });
  addEventListener("keyup", (e) => keys.delete(e.code));
  addEventListener("blur", () => keys.clear());

  // Touch joystick: drag anywhere inside the pad. Pushing near the edge = run.
  const knob = joystickEl.querySelector(".knob");
  let pointerId = null;
  const moveStick = (e) => {
    const r = joystickEl.getBoundingClientRect();
    const radius = r.width / 2;
    let dx = (e.clientX - (r.left + radius)) / radius;
    let dy = (e.clientY - (r.top + radius)) / radius;
    const len = Math.hypot(dx, dy);
    if (len > 1) { dx /= len; dy /= len; }
    stick.x = dx; stick.z = dy;
    knob.style.transform = `translate(${dx * radius * 0.6}px, ${dy * radius * 0.6}px)`;
  };
  joystickEl.addEventListener("pointerdown", (e) => {
    pointerId = e.pointerId;
    joystickEl.setPointerCapture(pointerId);
    stick.active = true;
    moveStick(e);
  });
  joystickEl.addEventListener("pointermove", (e) => { if (e.pointerId === pointerId) moveStick(e); });
  const release = (e) => {
    if (e.pointerId !== pointerId) return;
    pointerId = null;
    stick.active = false; stick.x = 0; stick.z = 0;
    knob.style.transform = "";
  };
  joystickEl.addEventListener("pointerup", release);
  joystickEl.addEventListener("pointercancel", release);

  return {
    getInput() {
      if (stick.active) {
        return { x: stick.x, z: stick.z, run: Math.hypot(stick.x, stick.z) > 0.85 };
      }
      const k = (...codes) => codes.some((c) => keys.has(c));
      const x = (k("KeyD", "ArrowRight") ? 1 : 0) - (k("KeyA", "ArrowLeft") ? 1 : 0);
      const z = (k("KeyS", "ArrowDown") ? 1 : 0) - (k("KeyW", "ArrowUp") ? 1 : 0);
      return { x, z, run: k("ShiftLeft", "ShiftRight") };
    },
  };
}
