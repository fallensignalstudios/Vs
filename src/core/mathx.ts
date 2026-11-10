/** Small shared math helpers. Pure functions, no three.js dependency. */
export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const invLerp = (a: number, b: number, v: number): number => (a === b ? 0 : (v - a) / (b - a));
export const remap = (v: number, a: number, b: number, c: number, d: number): number => lerp(c, d, clamp01(invLerp(a, b, v)));
export const smoothstep = (a: number, b: number, v: number): number => {
  const t = clamp01(invLerp(a, b, v));
  return t * t * (3 - 2 * t);
};
/** Frame-rate independent exponential approach. lambda ≈ speed (higher = snappier). */
export const damp = (a: number, b: number, lambda: number, dt: number): number => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const approach = (a: number, b: number, maxDelta: number): number => (Math.abs(b - a) <= maxDelta ? b : a + Math.sign(b - a) * maxDelta);

/** wrap to (-PI, PI] */
export const wrapAngle = (a: number): number => {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
};
export const angleDelta = (from: number, to: number): number => wrapAngle(to - from);
export const dampAngle = (a: number, b: number, lambda: number, dt: number): number => a + angleDelta(a, b) * (1 - Math.exp(-lambda * dt));
export const turnToward = (a: number, b: number, maxDelta: number): number => {
  const d = angleDelta(a, b);
  return Math.abs(d) <= maxDelta ? b : a + Math.sign(d) * maxDelta;
};

/**
 * Engine yaw convention: yaw 0 faces -Z (north); forward = (-sin(yaw), 0, -cos(yaw)).
 * Returns the yaw that faces from (fx,fz) toward (tx,tz).
 */
export const yawTo = (fx: number, fz: number, tx: number, tz: number): number => Math.atan2(-(tx - fx), -(tz - fz));
export const forwardX = (yaw: number): number => -Math.sin(yaw);
export const forwardZ = (yaw: number): number => -Math.cos(yaw);
export const rightX = (yaw: number): number => Math.cos(yaw);
export const rightZ = (yaw: number): number => -Math.sin(yaw);

export const dist2D = (ax: number, az: number, bx: number, bz: number): number => Math.hypot(bx - ax, bz - az);

export type EaseFn = (t: number) => number;
export const EASE: Record<string, EaseFn> = {
  linear: (t) => t,
  in: (t) => t * t,
  out: (t) => 1 - (1 - t) * (1 - t),
  inOut: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  outExpo: (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  outBack: (t) => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2),
};

/** Deterministic PRNG (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable string → uint32 hash (for seeding by name). */
export function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
