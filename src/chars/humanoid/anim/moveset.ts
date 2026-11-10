/**
 * Movesets: per-archetype clip tables + carry stances, with inheritance. Clips and stances are compiled lazily
 * and cached, so every figure of an archetype shares them.
 */
import { compileClip, compilePose, type Clip, type ClipSpec, type PoseSpec } from './clip';
import type { StanceSet } from './locomotion';

export type HeldKey = 'none' | 'melee' | 'ranged' | 'case';

export interface StanceSpec {
  idle: PoseSpec;
  /** defaults to idle */
  walk?: PoseSpec;
  /** defaults to walk */
  run?: PoseSpec;
  swing?: readonly [number, number];
  crouch?: number;
  width?: number;
}

export interface Moveset {
  name: string;
  parent?: Moveset;
  clips: Record<string, ClipSpec>;
  stances: Partial<Record<HeldKey, StanceSpec>>;
  /** action → action redirects (e.g. attackLight4 → attackLight2) */
  alias?: Record<string, string>;
}

const clipCache = new WeakMap<ClipSpec, Clip>();
const stanceCache = new WeakMap<StanceSpec, StanceSet>();
const warned = new Set<string>();

/** Used when nothing in the chain knows the action: a small acknowledging gesture, never a T-pose. */
const FALLBACK: ClipSpec = {
  duration: 0.9, upperOnly: true,
  keys: [
    { t: 0 },
    { t: 0.3, chest: [3, 4, 0], head: [6, -4, 0], armR: { sh: [26, 12, 10], el: 58, fist: 0.15 } },
    { t: 0.6, chest: [2, 2, 0], head: [2, 0, 0], armR: { sh: [22, 10, 10], el: 50, fist: 0.15 } },
    { t: 1 },
  ],
  events: [[0.35, 'hit']],
};

function findSpec(ms: Moveset, name: string, depth = 0): ClipSpec | null {
  let m: Moveset | undefined = ms;
  while (m) {
    const direct = m.clips[name];
    if (direct) return direct;
    const al = m.alias?.[name];
    if (al && depth < 4) { const r = findSpec(ms, al, depth + 1); if (r) return r; }
    m = m.parent;
  }
  return null;
}

/** true if the moveset chain has an authored clip for `name` */
export function hasClip(ms: Moveset, name: string): boolean { return !!findSpec(ms, name); }

export function resolveClip(ms: Moveset, name: string): Clip {
  let spec = findSpec(ms, name);
  if (!spec) {
    const key = ms.name + ':' + name;
    if (!warned.has(key)) { warned.add(key); console.warn(`[humanoid] unknown action "${name}" for ${ms.name} — using a generic gesture`); }
    spec = FALLBACK;
  }
  let c = clipCache.get(spec);
  if (!c) { c = compileClip(name, spec); clipCache.set(spec, c); }
  return c;
}

export function resolveStance(ms: Moveset, key: HeldKey): StanceSet {
  let spec: StanceSpec | undefined;
  let m: Moveset | undefined = ms;
  while (m && !spec) { spec = m.stances[key]; m = m.parent; }
  if (!spec) {
    m = ms;
    while (m && !spec) { spec = m.stances.none; m = m.parent; }
  }
  if (!spec) spec = DEFAULT_STANCE;
  let s = stanceCache.get(spec);
  if (!s) {
    const idle = compilePose([spec.idle]);
    const walk = spec.walk ? compilePose([spec.idle, spec.walk]) : idle;
    const run = spec.run ? compilePose(spec.walk ? [spec.idle, spec.walk, spec.run] : [spec.idle, spec.run]) : walk;
    s = { idle, walk, run, swing: spec.swing ?? [1, 1], crouch: spec.crouch, width: spec.width };
    stanceCache.set(spec, s);
  }
  return s;
}

const DEFAULT_STANCE: StanceSpec = { idle: {} };

/** All action names a moveset chain can play (for sandboxes / tests). */
export function listClips(ms: Moveset): string[] {
  const out = new Set<string>();
  let m: Moveset | undefined = ms;
  while (m) { for (const k of Object.keys(m.clips)) out.add(k); if (m.alias) for (const k of Object.keys(m.alias)) out.add(k); m = m.parent; }
  return [...out].sort();
}
