/** Small helpers shared by every AI module: defensive reads, difficulty scales, socket positions, captions. */
import * as THREE from 'three';
import type { Actor, CaptionKind, Difficulty, Game, PhysicsWorld, Vec3Like } from '@/core/api';
import { isStub } from '@/core/stub';

/** finite number or fallback (stubs coerce to 0 / NaN — never trust them) */
export const fin = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/** a real object: not null and not a null-object stub */
export function live<T>(o: T | null | undefined): o is T {
  return o != null && !isStub(o);
}

const warned = new Set<string>();
/** console.warn once per key */
export function warnOnce(key: string, msg: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[ai] ${msg}`);
}

/** run `fn`, reporting (once per key) instead of throwing */
export function guarded(key: string, fn: () => void): void {
  try {
    fn();
  } catch (err) {
    warnOnce(key, `${key} threw: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  }
}

export function difficultyOf(game: Game): Difficulty {
  const d = game.settings?.get?.('difficulty');
  return d === 'story' || d === 'hard' ? d : 'standard';
}

/** multiplier on enemy telegraph times: ×1.3 story, ×0.8 hard */
export function telegraphScale(game: Game): number {
  const d = difficultyOf(game);
  return d === 'story' ? 1.3 : d === 'hard' ? 0.8 : 1;
}

/** multiplier on gaps between enemy attacks: hard overlaps more, story less */
export function cooldownScale(game: Game): number {
  const d = difficultyOf(game);
  return d === 'story' ? 1.35 : d === 'hard' ? 0.78 : 1;
}

/** the physics world, or null while it is a stub */
export function physicsOf(game: Game): PhysicsWorld | null {
  const p = game.physics;
  return live(p) ? p : null;
}

/** sim clock */
export function nowOf(game: Game): number {
  return fin(game.time?.now, 0);
}

/** the living protagonist actor, or null */
export function playerActor(game: Game): Actor | null {
  const p = game.player;
  if (!live(p)) return null;
  const a = p.actor;
  return live(a) && a.alive ? a : null;
}

/** world position of a visual socket (falls back to the aim point when there is no visual) */
export function socketPos(actor: Actor, name: string, out: THREE.Vector3): THREE.Vector3 {
  const v = actor.visual;
  if (v) {
    const s = v.socket(name);
    if (s && typeof s.getWorldPosition === 'function') {
      s.getWorldPosition(out);
      // a socket of a visual that has not been posed yet sits at the origin: prefer the aim point then
      if (Number.isFinite(out.x + out.y + out.z) && (s !== v.root || name === 'root')) return out;
    }
  }
  return actor.aimPoint(out);
}

/** the socket object itself when the visual has one distinct from its root, else null */
export function socketObject(actor: Actor, name: string): THREE.Object3D | null {
  const v = actor.visual;
  if (!v) return null;
  const s = v.socket(name);
  return s && s !== v.root && typeof s.getWorldPosition === 'function' ? s : null;
}

export function caption(game: Game, text: string, kind: CaptionKind, pos?: Vec3Like): void {
  game.events.emit('caption', pos ? { text, kind, pos: { x: pos.x, y: pos.y, z: pos.z } } : { text, kind });
}

/** copy a Vec3Like, repairing non-finite members */
export function vec(p: Vec3Like | null | undefined, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(fin(p?.x), fin(p?.y), fin(p?.z));
}

/** squared planar distance */
export function d2(ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  return dx * dx + dz * dz;
}

/** shortest distance between segment p1→q1 and segment p2→q2 (Ericson, Real-Time Collision Detection 5.1.9) */
export function segSegDistance(p1: Vec3Like, q1: Vec3Like, p2: Vec3Like, q2: Vec3Like): number {
  const d1x = q1.x - p1.x, d1y = q1.y - p1.y, d1z = q1.z - p1.z;
  const d2x = q2.x - p2.x, d2y = q2.y - p2.y, d2z = q2.z - p2.z;
  const rx = p1.x - p2.x, ry = p1.y - p2.y, rz = p1.z - p2.z;
  const a = d1x * d1x + d1y * d1y + d1z * d1z;
  const e = d2x * d2x + d2y * d2y + d2z * d2z;
  const f = d2x * rx + d2y * ry + d2z * rz;
  let s = 0;
  let t = 0;
  const EPS = 1e-9;
  if (a <= EPS && e <= EPS) return Math.hypot(rx, ry, rz);
  if (a <= EPS) {
    t = Math.min(1, Math.max(0, f / e));
  } else {
    const c = d1x * rx + d1y * ry + d1z * rz;
    if (e <= EPS) {
      s = Math.min(1, Math.max(0, -c / a));
    } else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z;
      const denom = a * e - b * b;
      s = denom > EPS ? Math.min(1, Math.max(0, (b * f - c * e) / denom)) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = Math.min(1, Math.max(0, -c / a));
      } else if (t > 1) {
        t = 1;
        s = Math.min(1, Math.max(0, (b - c) / a));
      }
    }
  }
  const cx = p1.x + d1x * s - (p2.x + d2x * t);
  const cy = p1.y + d1y * s - (p2.y + d2y * t);
  const cz = p1.z + d1z * s - (p2.z + d2z * t);
  return Math.hypot(cx, cy, cz);
}

/** add displacement velocity the feet do not walk (lunges, pounces, charges); falls back to desiredVel on hand-built actors */
export function carry(a: Actor, vx: number, vz: number): void {
  const c = a.carryVel ?? a.desiredVel;
  c.x += vx;
  c.z += vz;
}
