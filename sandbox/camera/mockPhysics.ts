/**
 * Sandbox-only stand-in for the physics subsystem, used when the real factory is still a stub (or with
 * ?physics=mock). Implements just what the camera sandbox touches: colliders (yawed boxes, vertical
 * cylinders), flat / ramp rect surfaces, groundAt, a sliding moveCharacter and sweepSphere.
 */
import type { ColliderDesc, ColliderHandle, GroundHit, MoveResult, PhysicsWorld, SurfaceDesc, SurfaceHandle, Vec3Like } from '@/core/api';
import { withStubs } from '../harness';

interface Col extends ColliderHandle {
  desc: ColliderDesc;
  cos: number;
  sin: number;
}

interface Surf extends SurfaceHandle {
  desc: SurfaceDesc;
  cos: number;
  sin: number;
}

const SKIN = 0.02;

export function createMockPhysics(): PhysicsWorld {
  const cols: Col[] = [];
  const surfs: Surf[] = [];
  let nextId = 1;

  /** world → collider-local (xz rotated by −yaw) */
  const toLocal = (c: { cos: number; sin: number; desc: { x: number; z: number } }, x: number, z: number, out: { x: number; z: number }) => {
    const dx = x - c.desc.x;
    const dz = z - c.desc.z;
    out.x = dx * c.cos - dz * c.sin;
    out.z = dx * c.sin + dz * c.cos;
    return out;
  };
  const la = { x: 0, z: 0 };
  const lb = { x: 0, z: 0 };

  /** entry parameter t in [0,1] of segment a→b into the collider inflated by r, or 1 if it misses */
  function sweepOne(c: Col, a: Vec3Like, b: Vec3Like, r: number): number {
    const s = c.desc.shape;
    const hy = s.hy + r;
    const y0 = a.y - c.desc.y;
    const y1 = b.y - c.desc.y;
    let t0 = 0;
    let t1 = 1;
    const slab = (p0: number, p1: number, h: number): boolean => {
      const d = p1 - p0;
      if (Math.abs(d) < 1e-9) return Math.abs(p0) <= h;
      let n = (-h - p0) / d;
      let f = (h - p0) / d;
      if (n > f) [n, f] = [f, n];
      t0 = Math.max(t0, n);
      t1 = Math.min(t1, f);
      return t0 <= t1;
    };
    if (!slab(y0, y1, hy)) return 1;
    toLocal(c, a.x, a.z, la);
    toLocal(c, b.x, b.z, lb);
    if (s.kind === 'box') {
      if (!slab(la.x, lb.x, s.hx + r) || !slab(la.z, lb.z, s.hz + r)) return 1;
      return t0;
    }
    // vertical cylinder: segment vs circle in xz, then intersect with the y slab interval
    const R = s.r + r;
    const dx = lb.x - la.x;
    const dz = lb.z - la.z;
    const A = dx * dx + dz * dz;
    const C = la.x * la.x + la.z * la.z - R * R;
    if (A < 1e-12) return C <= 0 ? t0 : 1;
    const B = la.x * dx + la.z * dz;
    const disc = B * B - A * C;
    if (disc < 0) return 1;
    const q = Math.sqrt(disc);
    const n = (-B - q) / A;
    const f = (-B + q) / A;
    t0 = Math.max(t0, n);
    t1 = Math.min(t1, f);
    return t0 <= t1 ? t0 : 1;
  }

  function sweepSphere(from: Vec3Like, to: Vec3Like, radius: number): number {
    let best = 1;
    for (const c of cols) {
      if (!c.enabled || c.desc.blocksSight === false) continue;
      const t = sweepOne(c, from, to, radius);
      if (t < best) best = t;
    }
    if (best >= 1) return 1;
    const len = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
    return Math.max(0, best - SKIN / Math.max(len, 1e-6));
  }

  function surfaceY(s: Surf, x: number, z: number): number | null {
    if (!s.enabled || s.desc.shape.kind !== 'rect') return null;
    toLocal(s, x, z, la);
    const { hx, hz } = s.desc.shape;
    if (Math.abs(la.x) > hx || Math.abs(la.z) > hz) return null;
    const y1 = s.desc.y1;
    return y1 === undefined ? s.desc.y : s.desc.y + (y1 - s.desc.y) * ((la.z + hz) / (2 * hz));
  }

  function groundAt(x: number, z: number, yRef: number, stepUp = 0.45): GroundHit | null {
    let best: GroundHit | null = null;
    for (const s of surfs) {
      const y = surfaceY(s, x, z);
      if (y === null || y > yRef + stepUp) continue;
      if (!best || y > best.y) best = { y, surface: s };
    }
    return best;
  }

  /** push a circle out of every solid it overlaps (two relaxation passes) */
  function resolve(p: { x: number; y: number; z: number }, radius: number): { x: number; z: number } | null {
    let normal: { x: number; z: number } | null = null;
    for (let pass = 0; pass < 2; pass++) {
      for (const c of cols) {
        if (!c.enabled || c.desc.blocksMove === false) continue;
        const s = c.desc.shape;
        if (p.y + 1.8 < c.desc.y - s.hy || p.y + 0.3 > c.desc.y + s.hy) continue;
        toLocal(c, p.x, p.z, la);
        let nx = 0;
        let nz = 0;
        let depth = 0;
        if (s.kind === 'box') {
          const cx = Math.max(-s.hx, Math.min(s.hx, la.x));
          const cz = Math.max(-s.hz, Math.min(s.hz, la.z));
          const dx = la.x - cx;
          const dz = la.z - cz;
          const d = Math.hypot(dx, dz);
          if (d >= radius) continue;
          if (d > 1e-6) {
            nx = dx / d;
            nz = dz / d;
            depth = radius - d;
          } else {
            // centre inside the box: leave through the nearest face
            const ex = s.hx - Math.abs(la.x);
            const ez = s.hz - Math.abs(la.z);
            if (ex < ez) {
              nx = Math.sign(la.x) || 1;
              depth = ex + radius;
            } else {
              nz = Math.sign(la.z) || 1;
              depth = ez + radius;
            }
          }
        } else {
          const d = Math.hypot(la.x, la.z);
          if (d >= s.r + radius) continue;
          nx = d > 1e-6 ? la.x / d : 1;
          nz = d > 1e-6 ? la.z / d : 0;
          depth = s.r + radius - d;
        }
        // local → world
        const wx = nx * c.cos + nz * c.sin;
        const wz = -nx * c.sin + nz * c.cos;
        p.x += wx * depth;
        p.z += wz * depth;
        normal = { x: wx, z: wz };
      }
    }
    return normal;
  }

  function moveCharacter(from: Vec3Like, radius: number, dx: number, dz: number): MoveResult {
    const p = { x: from.x, y: from.y, z: from.z };
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / (radius * 0.5)));
    let normal: { x: number; z: number } | null = null;
    let blocked = false;
    for (let i = 0; i < steps; i++) {
      const px = p.x;
      const pz = p.z;
      p.x += dx / steps;
      p.z += dz / steps;
      const n = resolve(p, radius);
      if (n) {
        normal = n;
        blocked = true;
      }
      const g = groundAt(p.x, p.z, p.y, 0.45);
      if (!g || p.y - g.y > 0.7) {
        // fall protection: refuse to leave the walkable set
        p.x = px;
        p.z = pz;
        blocked = true;
      } else {
        p.y = g.y;
      }
    }
    return { x: p.x, y: p.y, z: p.z, blocked, normal };
  }

  return withStubs<PhysicsWorld>('mockPhysics', {
    addCollider(desc: ColliderDesc): ColliderHandle {
      const yaw = desc.yaw ?? 0;
      const c: Col = {
        id: nextId++, desc, enabled: true, cos: Math.cos(yaw), sin: Math.sin(yaw),
        setPose(x, y, z, yaw2) {
          desc.x = x; desc.y = y; desc.z = z;
          if (yaw2 !== undefined) { desc.yaw = yaw2; c.cos = Math.cos(yaw2); c.sin = Math.sin(yaw2); }
        },
        remove() { const i = cols.indexOf(c); if (i >= 0) cols.splice(i, 1); },
      };
      cols.push(c);
      return c;
    },
    addSurface(desc: SurfaceDesc): SurfaceHandle {
      const yaw = desc.yaw ?? 0;
      const s: Surf = {
        id: nextId++, desc, enabled: true, cos: Math.cos(yaw), sin: Math.sin(yaw),
        remove() { const i = surfs.indexOf(s); if (i >= 0) surfs.splice(i, 1); },
      };
      surfs.push(s);
      return s;
    },
    groundAt,
    moveCharacter,
    sweepSphere,
    raycast: () => null,
    lineOfSight: (a: Vec3Like, b: Vec3Like) => sweepSphere(a, b, 0) >= 1,
    clear() { cols.length = 0; surfs.length = 0; },
    get counts() { return { colliders: cols.length, surfaces: surfs.length, triggers: 0 }; },
  } as Partial<PhysicsWorld>);
}
