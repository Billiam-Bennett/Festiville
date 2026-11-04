// What a vendor can edit about their own stall, and the rules for it.
// Shared so the server (which enforces it) and the vendor edit page (which previews it) agree.
// No dependencies: runs in Node and the browser.
//
// A listing: { name, tagline, link, items: [{ name, price }], next: [{ event, where, start, end }] }
// Stall position, zone and color are NOT editable; they come from shared/venue.js.

import { sanitizeTruck } from "./truck-data.js";

export const LIMITS = {
  name: 32, tagline: 140, link: 200,
  items: 30, itemName: 60, price: 9999,
  next: 12, event: 60, where: 60,
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// Clean up an untrusted listing. Returns { listing } or { error } (a message fit to show the vendor).
export function sanitizeListing(raw) {
  if (!raw || typeof raw !== "object") return { error: "Nothing to save." };
  const name = text(raw.name, LIMITS.name);
  if (!name) return { error: "Your stall needs a name." };

  let link = text(raw.link, LIMITS.link);
  if (link) {
    if (!/^https?:\/\//i.test(link)) link = "https://" + link;
    try {
      const u = new URL(link);
      if (!["http:", "https:"].includes(u.protocol) || !u.hostname.includes(".")) throw 0;
      link = u.href;
    } catch { return { error: "That website address doesn't look right." }; }
  }

  if (raw.items != null && !Array.isArray(raw.items)) return { error: "Menu must be a list." };
  const items = [];
  for (const it of raw.items ?? []) {
    const n = text(it?.name, LIMITS.itemName);
    if (!n) continue;                                     // blank rows are just dropped
    let price = null;
    if (it.price !== "" && it.price != null) {
      price = typeof it.price === "number" ? it.price : Number(String(it.price).replace(/[$,\s]/g, ""));
      if (!Number.isFinite(price) || price < 0 || price > LIMITS.price) return { error: `Check the price for "${n}".` };
      price = Math.round(price * 100) / 100;
    }
    items.push(price == null ? { name: n } : { name: n, price });
    if (items.length > LIMITS.items) return { error: `Up to ${LIMITS.items} menu items.` };
  }

  if (raw.next != null && !Array.isArray(raw.next)) return { error: "Upcoming stops must be a list." };
  const next = [];
  for (const s of raw.next ?? []) {
    const event = text(s?.event, LIMITS.event);
    const where = text(s?.where, LIMITS.where);
    const start = typeof s?.start === "string" && DATE.test(s.start) && validDate(s.start) ? s.start : "";
    let end = typeof s?.end === "string" && DATE.test(s.end) && validDate(s.end) ? s.end : "";
    if (!event && !where && !start) continue;
    if (!event) return { error: "Each upcoming stop needs an event name." };
    if (!start) return { error: `Pick a start date for ${event}.` };
    if (end && end < start) return { error: `The end date for ${event} is before it starts.` };
    if (end === start) end = "";
    next.push({ event, where, start, ...(end ? { end } : {}) });
    if (next.length > LIMITS.next) return { error: `Up to ${LIMITS.next} upcoming stops.` };
  }
  next.sort((a, b) => a.start.localeCompare(b.start));

  const truck = sanitizeTruck(raw.truck);
  return { listing: { name, tagline: text(raw.tagline, LIMITS.tagline), link, items, next, ...(truck ? { truck } : {}) } };
}

// Stops that haven't finished yet (today counts), soonest first.
export function upcoming(next, today = localDate()) {
  return (next ?? []).filter((s) => (s.end || s.start) >= today).sort((a, b) => a.start.localeCompare(b.start));
}

// "Oct 16–18", "Oct 30 – Nov 1", "Oct 16". Adds the year if it isn't this year.
export function formatDates(start, end, now = new Date()) {
  const d = (s) => { const [y, m, day] = s.split("-").map(Number); return { y, m, day }; };
  const M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const a = d(start), b = end ? d(end) : null;
  const yr = (x) => (x.y !== now.getFullYear() ? `, ${x.y}` : "");
  if (!b) return `${M[a.m - 1]} ${a.day}${yr(a)}`;
  if (a.y === b.y && a.m === b.m) return `${M[a.m - 1]} ${a.day}–${b.day}${yr(b)}`;
  if (a.y === b.y) return `${M[a.m - 1]} ${a.day} – ${M[b.m - 1]} ${b.day}${yr(b)}`;
  return `${M[a.m - 1]} ${a.day}, ${a.y} – ${M[b.m - 1]} ${b.day}, ${b.y}`;
}

// $9, $7.50, $12.25
export const formatPrice = (n) => "$" + (Number.isInteger(n) ? String(n) : n.toFixed(2));

export function localDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Trim, drop control characters, collapse runs of spaces, cap the length.
function text(v, max) {
  if (typeof v !== "string") return "";
  return v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function validDate(s) {
  const [y, m, d] = s.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d && y >= 2020 && y <= 2100;
}
