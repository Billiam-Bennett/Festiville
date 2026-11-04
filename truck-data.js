// Food-truck design options and validation. Pure data (no THREE, no browser), so the server can
// check a vendor's truck design and the browser can build it. The 3D model is client/truck.js.

export const TRUCK = {
  defaults: { body: "#e9e4da", awning: "#ff4fa3", stripe: "#ff4fa3", trim: "#c9c9c9", topper: "none" },
  toppers: [
    ["none", "None"], ["hotdog", "🌭 Hot dog"], ["burger", "🍔 Burger"], ["taco", "🌮 Taco"],
    ["icecream", "🍦 Ice cream"], ["pizza", "🍕 Pizza slice"], ["donut", "🍩 Donut"],
    ["coffee", "☕ Coffee cup"], ["star", "⭐ Star"],
  ],
  swatches: ["#e9e4da", "#ff4fa3", "#4fc3ff", "#ffd36b", "#8b4a2b", "#27ae60", "#9b51e0", "#f2994a", "#eb5757", "#1a1a1a"],
};

const HEX = /^#[0-9a-fA-F]{6}$/;

// Clean an untrusted truck design. Returns a tidy object, or null when it's just the defaults
// (so "no custom truck" isn't stored as noise).
export function sanitizeTruck(raw) {
  if (!raw || typeof raw !== "object") return null;
  const color = (v, d) => (typeof v === "string" && HEX.test(v) ? v.toLowerCase() : d);
  const d = TRUCK.defaults;
  const t = {
    body: color(raw.body, d.body),
    awning: color(raw.awning, d.awning),
    stripe: color(raw.stripe, d.stripe),
    trim: color(raw.trim, d.trim),
    topper: TRUCK.toppers.some(([id]) => id === raw.topper) ? raw.topper : "none",
  };
  if (t.body === d.body && t.awning === d.awning && t.stripe === d.stripe && t.trim === d.trim && t.topper === "none") return null;
  return t;
}
