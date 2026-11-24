// Geometry helpers for parts-based characters (client/avatar.js): skin remapping, level-of-detail
// meshes, clothing layers and the one-mesh far version of a character. Pure functions on
// BufferGeometry; nothing here touches the scene.
//
// Everything works in "bind space": every part and the body are exported on the same skeleton with the
// same bone inverses and an identity bind matrix (checked when a part is prepared), so their raw
// vertex positions line up and can be compared or merged directly.

// ---------- Skin ----------

// A copy of `geometry` whose skinIndex points into the BODY's bone list instead of the part's own,
// so the part can share the avatar's one skeleton (one bone texture upload per avatar per frame
// instead of one per part). Other attributes are shared, not copied.
export function remapSkin(THREE, geometry, partToBody) {
  const out = shallowCopy(THREE, geometry);
  const src = geometry.attributes.skinIndex;
  const arr = new Uint16Array(src.count * 4);
  for (let i = 0; i < src.count; i++) for (let k = 0; k < 4; k++) arr[i * 4 + k] = partToBody[src.getComponent(i, k)] ?? 0;
  out.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(arr, 4));
  return out;
}

// New geometry sharing every attribute (and the index, unless replaced) with `geometry`.
export function shallowCopy(THREE, geometry, index = geometry.index) {
  const g = new THREE.BufferGeometry();
  for (const [k, v] of Object.entries(geometry.attributes)) g.setAttribute(k, v);
  if (index) g.setIndex(index);
  g.boundingBox = geometry.boundingBox; g.boundingSphere = geometry.boundingSphere;
  return g;
}

const triangles = (geometry) => geometry.index?.array ?? Uint32Array.from({ length: geometry.attributes.position.count }, (_, i) => i);

// ---------- Hiding triangles ----------

// Index without the triangles that have at least `minHidden` of their 3 vertices flagged in `hidden`.
// Returns null when nothing is hidden (use the geometry's own index).
export function trimIndex(THREE, geometry, hidden, minHidden = 3) {
  const idx = triangles(geometry);
  const keep = [];
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    if (hidden[a] + hidden[b] + hidden[c] >= minHidden) continue;
    keep.push(a, b, c);
  }
  if (keep.length === idx.length) return null;
  const big = geometry.attributes.position.count > 65535;
  return new THREE.BufferAttribute(big ? Uint32Array.from(keep) : Uint16Array.from(keep), 1);
}

// Per-vertex flags (Uint8Array) for body vertices covered by the worn clothes: bits = [top, bottom, shoes]
// hide bits, matched against the body's _hide_top/_hide_bottom/_hide_shoes masks.
export function bodyHiddenFlags(geometry, bits, slots) {
  const n = geometry.attributes.position.count;
  const out = new Uint8Array(n);
  slots.forEach((slot, s) => {
    const a = geometry.attributes["_hide_" + slot];
    if (!a || !bits[s]) return;
    for (let i = 0; i < n; i++) if ((Math.round(a.getX(i)) & bits[s]) !== 0) out[i] = 1;
  });
  return out;
}

// ---------- Nearest body vertex ----------

// Spatial hash over the body's vertices, for "which bit of skin is this garment vertex over?".
export function bodyGrid(positions, cell = 0.04) {
  const cells = new Map();
  const key = (x, y, z) => ((x + 1024) * 2048 + (y + 1024)) * 2048 + (z + 1024);   // numeric: much faster than strings
  const n = positions.count;
  const P = new Float32Array(n * 3);   // flat copy: much faster to scan than getX()
  for (let i = 0; i < n; i++) { P[i * 3] = positions.getX(i); P[i * 3 + 1] = positions.getY(i); P[i * 3 + 2] = positions.getZ(i); }
  for (let i = 0; i < n; i++) {
    const k = key(Math.floor(P[i * 3] / cell), Math.floor(P[i * 3 + 1] / cell), Math.floor(P[i * 3 + 2] / cell));
    let list = cells.get(k);
    if (!list) cells.set(k, (list = []));
    list.push(i);
  }
  // Nearest body vertex to (x, y, z) within `maxRings` cells, or -1. Returns [index, distance].
  function nearest(x, y, z, maxRings = 4) {
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
    let best = -1, bestD = Infinity;
    for (let r = 0; r <= maxRings; r++) {
      for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
        const side = dx === -r || dx === r || dy === -r || dy === r;
        for (let dz = -r; dz <= r; dz += side || r === 0 ? 1 : 2 * r) {   // shell only: inner columns just their two ends
          const list = cells.get(key(cx + dx, cy + dy, cz + dz));
          if (!list) continue;
          for (const i of list) {
            const ex = P[i * 3] - x, ey = P[i * 3 + 1] - y, ez = P[i * 3 + 2] - z;
            const d = ex * ex + ey * ey + ez * ez;
            if (d < bestD) { bestD = d; best = i; }
          }
        }
      }
      // Anything in a further shell is at least r * cell away.
      if (best >= 0 && Math.sqrt(bestD) <= r * cell) break;
    }
    return [best, Math.sqrt(bestD)];
  }
  return { nearest };
}

// For each vertex of a garment: the nearest body vertex (or -1) and how far out from the skin it sits.
export function mapToBody(geometry, grid) {
  const p = geometry.attributes.position;
  const near = new Int32Array(p.count), dist = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) {
    const [b, d] = grid.nearest(p.getX(i), p.getY(i), p.getZ(i));
    near[i] = b; dist[i] = d;
  }
  return { near, dist };
}

// ---------- Level of detail: vertex clustering ----------

// Simplify by snapping vertices to a grid of `cell` meters and merging each cell's vertices into one.
// Cheap (linear time), never opens cracks, and keeps the skin weights, so the result animates with the
// same skeleton. Vertices are only merged when their normals point the same general way (so the
// two sides of thin cloth stay apart) and, with uvCell, when their texture coordinates are close (so
// textures don't smear across UV seams). Attributes named _hide_* keep the bits set on at least half
// of a cell's vertices. Returns { geometry, map } where map[oldVertex] = newVertex.
export function clusterGeometry(THREE, geometry, { cell, uvCell = 0 }) {
  const A = geometry.attributes;
  const pos = A.position, nor = A.normal, uv = A.uv;
  const n = pos.count;
  const map = new Uint32Array(n);
  const ids = new Map();
  let count = 0;
  for (let i = 0; i < n; i++) {
    let k = `${Math.floor(pos.getX(i) / cell)},${Math.floor(pos.getY(i) / cell)},${Math.floor(pos.getZ(i) / cell)}`;
    if (nor) {
      const x = nor.getX(i), y = nor.getY(i), z = nor.getZ(i), ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
      k += ax >= ay && ax >= az ? (x > 0 ? "a" : "b") : ay >= az ? (y > 0 ? "c" : "d") : z > 0 ? "e" : "f";
    }
    if (uvCell && uv) k += `|${Math.floor(uv.getX(i) / uvCell)},${Math.floor(uv.getY(i) / uvCell)}`;
    let c = ids.get(k);
    if (c === undefined) { c = count++; ids.set(k, c); }
    map[i] = c;
  }

  // Averaged: position, normal, uv. Bits by majority: _hide_*. Everything else (skin): from the vertex nearest the cell's centre.
  const members = new Uint32Array(count);
  for (let i = 0; i < n; i++) members[map[i]]++;
  const out = new THREE.BufferGeometry();
  const avg = {};
  for (const name of ["position", "normal", "uv"]) {
    const a = A[name];
    if (!a) continue;
    const s = a.itemSize, arr = new Float32Array(count * s);
    for (let i = 0; i < n; i++) for (let k = 0; k < s; k++) arr[map[i] * s + k] += a.getComponent(i, k);
    for (let c = 0; c < count; c++) for (let k = 0; k < s; k++) arr[c * s + k] /= members[c];
    if (name === "normal") for (let c = 0; c < count; c++) {
      const l = Math.hypot(arr[c * 3], arr[c * 3 + 1], arr[c * 3 + 2]) || 1;
      arr[c * 3] /= l; arr[c * 3 + 1] /= l; arr[c * 3 + 2] /= l;
    }
    avg[name] = arr;
    out.setAttribute(name, new THREE.BufferAttribute(arr, s));
  }
  const rep = new Int32Array(count).fill(-1), repD = new Float32Array(count).fill(Infinity);
  const P = avg.position;
  for (let i = 0; i < n; i++) {
    const c = map[i];
    const d = (pos.getX(i) - P[c * 3]) ** 2 + (pos.getY(i) - P[c * 3 + 1]) ** 2 + (pos.getZ(i) - P[c * 3 + 2]) ** 2;
    if (d < repD[c]) { repD[c] = d; rep[c] = i; }
  }
  for (const [name, a] of Object.entries(A)) {
    if (avg[name]) continue;
    const s = a.itemSize;
    if (name.startsWith("_hide_")) {
      const votes = new Map();   // cluster*32+bit -> count
      for (let i = 0; i < n; i++) {
        let v = Math.round(a.getX(i));
        for (let b = 0; v; b++, v >>>= 1) if (v & 1) { const key = map[i] * 32 + b; votes.set(key, (votes.get(key) ?? 0) + 1); }
      }
      const arr = new Float32Array(count);
      for (const [key, k] of votes) { const c = Math.floor(key / 32); if (k * 2 >= members[c]) arr[c] += 2 ** (key % 32); }
      out.setAttribute(name, new THREE.BufferAttribute(arr, 1));
      continue;
    }
    const arr = new a.array.constructor(count * s);
    for (let c = 0; c < count; c++) for (let k = 0; k < s; k++) arr[c * s + k] = a.getComponent(rep[c], k);
    out.setAttribute(name, new THREE.BufferAttribute(arr, s, a.normalized));
  }

  // Triangles: drop the ones that collapsed, and duplicates.
  const idx = triangles(geometry);
  const keep = [], seen = new Set();
  for (let t = 0; t < idx.length; t += 3) {
    const a = map[idx[t]], b = map[idx[t + 1]], c = map[idx[t + 2]];
    if (a === b || b === c || a === c) continue;
    const key = a < b ? (b < c ? `${a},${b},${c}` : a < c ? `${a},${c},${b}` : `${c},${a},${b}`) : (a < c ? `${b},${a},${c}` : b < c ? `${b},${c},${a}` : `${c},${b},${a}`);
    if (seen.has(key)) continue;
    seen.add(key);
    keep.push(a, b, c);
  }
  out.setIndex(new THREE.BufferAttribute(count > 65535 ? Uint32Array.from(keep) : Uint16Array.from(keep), 1));
  return { geometry: out, map };
}

// Carry per-vertex flags over to a clustered geometry: a merged vertex is flagged when at least half of
// the vertices it replaced were.
export function clusterFlags(map, flags, count) {
  const yes = new Uint32Array(count), all = new Uint32Array(count);
  for (let i = 0; i < map.length; i++) { all[map[i]]++; yes[map[i]] += flags[i]; }
  const out = new Uint8Array(count);
  for (let c = 0; c < count; c++) out[c] = yes[c] * 2 >= all[c] && yes[c] > 0 ? 1 : 0;
  return out;
}

// ---------- Far version: one mesh, vertex colors, no textures ----------

const pixelCache = new WeakMap();
const SAMPLE = 64;

// The texture shrunk to 64x64 RGBA bytes (enough for averaged colors), or null if it can't be read.
function pixels(texture) {
  if (pixelCache.has(texture)) return pixelCache.get(texture);
  let px = null;
  try {
    const img = texture.image;
    if (img && img.width && typeof document !== "undefined") {
      const c = document.createElement("canvas");
      c.width = c.height = SAMPLE;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, SAMPLE, SAMPLE);
      px = ctx.getImageData(0, 0, SAMPLE, SAMPLE).data;
    }
  } catch { px = null; }
  pixelCache.set(texture, px);
  return px;
}

// Per-vertex colors for `lod` (a clustered copy of `geometry`, linked by `map`), from the material's
// texture sampled at each original triangle's centre and averaged onto the merged vertices. Colors are
// linear and NOT multiplied by material.color (that's the tint, applied per avatar). Also returns a
// per-vertex coverage (alpha) so see-through bits (hair card gaps) can be dropped.
export function bakeColors(THREE, geometry, map, count, material) {
  const color = new Float32Array(count * 3), alpha = new Float32Array(count), weight = new Float32Array(count);
  const tex = material?.map;
  const px = tex ? pixels(tex) : null;
  const uv = geometry.attributes.uv;
  const idx = triangles(geometry);
  const srgb = (c) => (c < 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4));
  const lin = (v) => (tex?.colorSpace === THREE.SRGBColorSpace ? srgb(v / 255) : v / 255);
  const lut = new Float32Array(256).map((_, i) => lin(i));
  const wrap = (v) => v - Math.floor(v);
  for (let t = 0; t < idx.length; t += 3) {
    let r = 1, g = 1, b = 1, a = 1;
    if (px && uv) {
      let u = 0, v = 0;
      for (let k = 0; k < 3; k++) { u += uv.getX(idx[t + k]); v += uv.getY(idx[t + k]); }
      u = wrap(u / 3); v = wrap(v / 3);
      if (tex.flipY) v = 1 - v;
      const o = (Math.min(SAMPLE - 1, Math.floor(v * SAMPLE)) * SAMPLE + Math.min(SAMPLE - 1, Math.floor(u * SAMPLE))) * 4;
      r = lut[px[o]]; g = lut[px[o + 1]]; b = lut[px[o + 2]]; a = px[o + 3] / 255;
    }
    for (let k = 0; k < 3; k++) {
      const c = map[idx[t + k]];
      color[c * 3] += r * a; color[c * 3 + 1] += g * a; color[c * 3 + 2] += b * a;
      alpha[c] += a; weight[c] += 1;
    }
  }
  for (let c = 0; c < count; c++) {
    const w = alpha[c] || 1;
    color[c * 3] /= w; color[c * 3 + 1] /= w; color[c * 3 + 2] /= w;
    alpha[c] = weight[c] ? alpha[c] / weight[c] : 1;
  }
  return { color, alpha };
}

// Merge pieces into one skinned geometry with vertex colors. Each piece:
//   { geometry, color: Float32Array rgb per vertex, tint: THREE.Color, keep: optional per-vertex 0/1 mask
//     (a triangle is dropped if any vertex is 0) }
// All pieces must already be skinned to the same skeleton (see remapSkin).
export function mergePieces(THREE, pieces) {
  let verts = 0;
  for (const p of pieces) verts += p.geometry.attributes.position.count;
  const pos = new Float32Array(verts * 3), nor = new Float32Array(verts * 3), col = new Float32Array(verts * 3);
  const si = new Uint16Array(verts * 4), sw = new Float32Array(verts * 4);
  const index = [];
  let base = 0;
  for (const p of pieces) {
    const A = p.geometry.attributes, n = A.position.count;
    for (let i = 0; i < n; i++) {
      const o = base + i;
      pos[o * 3] = A.position.getX(i); pos[o * 3 + 1] = A.position.getY(i); pos[o * 3 + 2] = A.position.getZ(i);
      if (A.normal) { nor[o * 3] = A.normal.getX(i); nor[o * 3 + 1] = A.normal.getY(i); nor[o * 3 + 2] = A.normal.getZ(i); }
      col[o * 3] = p.color[i * 3] * p.tint.r; col[o * 3 + 1] = p.color[i * 3 + 1] * p.tint.g; col[o * 3 + 2] = p.color[i * 3 + 2] * p.tint.b;
      for (let k = 0; k < 4; k++) { si[o * 4 + k] = A.skinIndex.getComponent(i, k); sw[o * 4 + k] = A.skinWeight.getComponent(i, k); }
    }
    const idx = triangles(p.geometry);
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t], b = idx[t + 1], c = idx[t + 2];
      if (p.keep && !(p.keep[a] && p.keep[b] && p.keep[c])) continue;
      index.push(base + a, base + b, base + c);
    }
    base += n;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute("skinWeight", new THREE.BufferAttribute(sw, 4));
  g.setIndex(new THREE.BufferAttribute(verts > 65535 ? Uint32Array.from(index) : Uint16Array.from(index), 1));
  return g;
}

// ---------- Coverage from geometry ----------

// Which body vertices a garment covers, worked out from the meshes themselves: a vertex is covered when
// the ray from just under the skin out along the skin's normal hits one of the garment's triangles within
// `reach` meters. Used for parts whose hide mask in body.glb is empty (see client/avatar.js). Bind space.
// Returns a Uint8Array (1 = covered) over the body's vertices.
export function rayCoverage(skinGeometry, garments, { reach = 0.06, back = 0.01, cell = 0.03 } = {}) {
  // Garment triangles into a grid by bounding box.
  const tris = [];
  for (const g of garments) {
    const p = g.attributes.position;
    const idx = triangles(g);
    for (let t = 0; t < idx.length; t += 3) {
      const v = [];
      for (let k = 0; k < 3; k++) v.push(p.getX(idx[t + k]), p.getY(idx[t + k]), p.getZ(idx[t + k]));
      tris.push(v);
    }
  }
  const grid = new Map();
  const key = (x, y, z) => `${x},${y},${z}`;
  tris.forEach((v, id) => {
    const lo = [0, 1, 2].map((a) => Math.floor(Math.min(v[a], v[a + 3], v[a + 6]) / cell));
    const hi = [0, 1, 2].map((a) => Math.floor(Math.max(v[a], v[a + 3], v[a + 6]) / cell));
    for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) {
      const k = key(x, y, z);
      let list = grid.get(k);
      if (!list) grid.set(k, (list = []));
      list.push(id);
    }
  });
  const pos = skinGeometry.attributes.position, nor = skinGeometry.attributes.normal;
  const out = new Uint8Array(pos.count);
  if (!nor || !tris.length) return out;
  const stamp = new Int32Array(tris.length).fill(-1);
  const len = reach + back, steps = Math.ceil(len / (cell * 0.5));
  for (let i = 0; i < pos.count; i++) {
    let nx = nor.getX(i), ny = nor.getY(i), nz = nor.getZ(i);
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const ox = pos.getX(i) - nx * back, oy = pos.getY(i) - ny * back, oz = pos.getZ(i) - nz * back;
    hit: for (let s = 0; s <= steps; s++) {
      const d = (len * s) / steps;
      const list = grid.get(key(Math.floor((ox + nx * d) / cell), Math.floor((oy + ny * d) / cell), Math.floor((oz + nz * d) / cell)));
      if (!list) continue;
      for (const id of list) {
        if (stamp[id] === i) continue;
        stamp[id] = i;
        const t = rayTriangle(ox, oy, oz, nx, ny, nz, tris[id]);
        if (t >= 0 && t <= len) { out[i] = 1; break hit; }
      }
    }
  }
  return out;
}

// Möller–Trumbore: distance along the ray to triangle v (9 numbers), or -1. Both sides count.
function rayTriangle(ox, oy, oz, dx, dy, dz, v) {
  const e1x = v[3] - v[0], e1y = v[4] - v[1], e1z = v[5] - v[2];
  const e2x = v[6] - v[0], e2y = v[7] - v[1], e2z = v[8] - v[2];
  const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-12) return -1;
  const inv = 1 / det;
  const tx = ox - v[0], ty = oy - v[1], tz = oz - v[2];
  const u = (tx * px + ty * py + tz * pz) * inv;
  if (u < 0 || u > 1) return -1;
  const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
  const w = (dx * qx + dy * qy + dz * qz) * inv;
  if (w < 0 || u + w > 1) return -1;
  return (e2x * qx + e2y * qy + e2z * qz) * inv;
}

// Shrink a per-vertex 0/1 mask over `geometry` by `steps` edges: a vertex stays set only if every
// neighbour is set. Returns a new Uint8Array.
export function erode(geometry, flags, steps) {
  const idx = triangles(geometry);
  let cur = flags;
  for (let s = 0; s < steps; s++) {
    const next = Uint8Array.from(cur);
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t], b = idx[t + 1], c = idx[t + 2];
      if (!(cur[a] && cur[b] && cur[c])) { next[a] = 0; next[b] = 0; next[c] = 0; }
    }
    cur = next;
  }
  return cur;
}
