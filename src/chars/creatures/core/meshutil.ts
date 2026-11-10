/**
 * Mesh utilities split out of geo.ts: crease-aware normal generation and the deterministic noise / PRNG the
 * modelling primitives use. Pure functions, no three.js dependency.
 */
/**
 * Area-weighted vertex normals with a crease angle. Faces meeting at a position are averaged only when their
 * normals are within `creaseDeg`; weighting by area keeps large faces flat while narrow bevel strips blend
 * between them (the "face-weighted normals" hard-surface look). creaseDeg ≥ 180 = fully smooth, 0 = faceted.
 */
export function computeNormals(p: ArrayLike<number>, creaseDeg: number): Float32Array {
  const nv = p.length / 3, nt = nv / 3;
  const fn = new Float32Array(nt * 3), fa = new Float32Array(nt);
  for (let t = 0; t < nt; t++) {
    const i = t * 9;
    const ux = p[i + 3]! - p[i]!, uy = p[i + 4]! - p[i + 1]!, uz = p[i + 5]! - p[i + 2]!;
    const vx = p[i + 6]! - p[i]!, vy = p[i + 7]! - p[i + 1]!, vz = p[i + 8]! - p[i + 2]!;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    fa[t] = l * 0.5;
    const il = l > 1e-12 ? 1 / l : 0;
    fn[t * 3] = nx * il; fn[t * 3 + 1] = ny * il; fn[t * 3 + 2] = nz * il;
  }
  const out = new Float32Array(nv * 3);
  if (creaseDeg <= 0.5) {
    for (let v = 0; v < nv; v++) {
      const t = (v / 3) | 0;
      out[v * 3] = fn[t * 3]!; out[v * 3 + 1] = fn[t * 3 + 1]!; out[v * 3 + 2] = fn[t * 3 + 2]!;
    }
    return out;
  }
  const cosC = Math.cos((Math.min(creaseDeg, 180) * Math.PI) / 180);
  const map = new Map<string, number[]>();
  const Q = 2000; // 0.5 mm weld
  for (let v = 0; v < nv; v++) {
    const key = Math.round(p[v * 3]! * Q) + ',' + Math.round(p[v * 3 + 1]! * Q) + ',' + Math.round(p[v * 3 + 2]! * Q);
    const list = map.get(key);
    if (list) list.push(v);
    else map.set(key, [v]);
  }
  for (const list of map.values()) {
    for (const v of list) {
      const t = (v / 3) | 0;
      const ax = fn[t * 3]!, ay = fn[t * 3 + 1]!, az = fn[t * 3 + 2]!;
      let nx = 0, ny = 0, nz = 0;
      for (const w of list) {
        const t2 = (w / 3) | 0;
        const bx = fn[t2 * 3]!, by = fn[t2 * 3 + 1]!, bz = fn[t2 * 3 + 2]!;
        if (ax * bx + ay * by + az * bz >= cosC - 1e-4) {
          const wgt = fa[t2]!;
          nx += bx * wgt; ny += by * wgt; nz += bz * wgt;
        }
      }
      const l = Math.hypot(nx, ny, nz);
      if (l > 1e-12) { out[v * 3] = nx / l; out[v * 3 + 1] = ny / l; out[v * 3 + 2] = nz / l; }
      else { out[v * 3] = ax; out[v * 3 + 1] = ay; out[v * 3 + 2] = az; }
    }
  }
  return out;
}

/** small deterministic PRNG for modelling variation */
export function rand(seed: number): () => number {
  let a = (seed * 2654435761) >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash3(x: number, y: number, z: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(z | 0, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** trilinear value noise in [0,1] */
export function vnoise(x: number, y: number, z: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const l = (a: number, b: number, t: number): number => a + (b - a) * t;
  return l(
    l(l(hash3(xi, yi, zi), hash3(xi + 1, yi, zi), u), l(hash3(xi, yi + 1, zi), hash3(xi + 1, yi + 1, zi), u), v),
    l(l(hash3(xi, yi, zi + 1), hash3(xi + 1, yi, zi + 1), u), l(hash3(xi, yi + 1, zi + 1), hash3(xi + 1, yi + 1, zi + 1), u), v),
    w,
  );
}
