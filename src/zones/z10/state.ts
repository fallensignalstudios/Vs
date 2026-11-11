/**
 * Z10 — per-load state, layout constants and the small animated pieces every module shares (the rising assent
 * interfaces, the five lights, terminal text on the status board). Reset by build() and ZoneDef.dispose().
 */
import * as THREE from 'three';
import type { ColliderHandle, HeroProp, HologramProp, Look, ZoneRuntime } from '@/core/api';
import { LOOKS } from '@/render/looks';
import type { WitnessSet } from './witness-set';

/**
 * The chamber's grade: `LOOKS.core` (silver-cold, gold highlights) opened up toward the crownmark-chamber painting —
 * a brighter, silver-white volume over the black mirror floor instead of crushed near-black. Every place that
 * returns the chamber to its own grade (setEnv, the end of the dark, the end of the Witness) uses this one.
 */
export const Z10_LOOK: Look = {
  ...LOOKS.core,
  exposure: 1.2,
  grade: { ...LOOKS.core.grade, contrast: 1.16, lift: -0.006 },
  ambient: { ...LOOKS.core.ambient, sky: 0x70757f, intensity: 0.46 },
  envIntensity: 1.5,
};

// =====================================================================================================================
// Layout (plan coordinates, origin at the south-west corner)
// =====================================================================================================================

/** chamber centre: the walkable floor is a Ø 54 m disc around it */
export const C = { x: 27, n: 27 } as const;
export const FLOOR_R = 27;
/** the Ø 10 m dais and its step ring */
export const DAIS_R = 5;
export const DAIS_H = 0.4;
export const STEP_R = 6.2;
export const STEP_H = 0.2;
/** the two assent interfaces: in front of Crownmark Five (which faces south, toward the entry), one each side */
export const PAD = { dx: 3.05, dn: -1.9, yawT: 205, yawS: 155 } as const;
/** the interfaces stand this far below the floor until the protocol raises them */
export const PAD_SUNK = 1.25;
/** the lift (north edge) */
export const LIFT = { x: C.x, n: C.n + FLOOR_R + 3.2 } as const;

// =====================================================================================================================
// State
// =====================================================================================================================

export interface PadState {
  prop: HeroProp<{ active: number; assent: number }> | null;
  collider: ColliderHandle | null;
  base: THREE.Vector3;
}

export interface Z10State {
  crownmark: HeroProp<{ glow: number; integrated: number }> | null;
  rings: HeroProp<{ align: number; spin: number; energy: number }> | null;
  padT: PadState;
  padS: PadState;
  diag: HologramProp | null;
  forecast: HologramProp | null;
  /** 0 sunk … 1 risen (the interfaces); eased in update, snapped on a skip */
  rise: number;
  riseTarget: number;
  /** the five Meridian lights over the dais */
  lights: THREE.Mesh[];
  lightsOn: number;
  lightK: number[];
  lightGeo: THREE.BufferGeometry | null;
  witness: WitnessSet | null;
  /** objects of the chamber hidden while the Witness plays (restored afterwards) */
  hidden: THREE.Object3D[];
  disposers: Array<() => void>;
}

export let S: Z10State = blank();

function pad(): PadState {
  return { prop: null, collider: null, base: new THREE.Vector3() };
}

export function blank(): Z10State {
  return {
    crownmark: null, rings: null, padT: pad(), padS: pad(), diag: null, forecast: null, rise: 0, riseTarget: 0,
    lights: [], lightsOn: 0, lightK: [0, 0, 0, 0, 0], lightGeo: null, witness: null, hidden: [], disposers: [],
  };
}

export function resetState(): void {
  for (const d of S.disposers) d();
  S = blank();
}

// =====================================================================================================================
// Animated pieces
// =====================================================================================================================

/** raise (1) or sink (0) both interfaces; `instant` for restores */
export function setRise(target: number, instant = false): void {
  S.riseTarget = target;
  if (instant) S.rise = target;
  applyRise();
}

function applyRise(): void {
  const e = S.rise * S.rise * (3 - 2 * S.rise);
  for (const p of [S.padT, S.padS]) {
    if (!p.prop) continue;
    p.prop.object.position.set(p.base.x, p.base.y - PAD_SUNK * (1 - e), p.base.z);
    p.prop.object.visible = S.rise > 0.01;
    if (p.collider) p.collider.enabled = S.rise > 0.5;
  }
}

/** light the first `n` of the five Meridian lights (Ianis, Caerion II, Neon Veil, Cauldron, Aurelion) */
export function setLights(n: number): void {
  S.lightsOn = Math.max(0, Math.min(5, n));
}

/** after a skipped scene: every hero prop jumps to its targets (watched or skipped end identically) */
export function snapProps(z: ZoneRuntime): void {
  if (!z.skipping) return;
  for (const p of [S.crownmark, S.rings, S.padT.prop, S.padS.prop, S.diag, S.forecast]) p?.snap();
}

/** ZoneDef.update for the shared pieces */
export function updateShared(z: ZoneRuntime, dt: number): void {
  if (S.rise !== S.riseTarget) {
    S.rise = z.skipping ? S.riseTarget : S.rise + Math.sign(S.riseTarget - S.rise) * Math.min(Math.abs(S.riseTarget - S.rise), dt / 2.4);
    applyRise();
  }
  for (let i = 0; i < S.lights.length; i++) {
    const want = i < S.lightsOn ? 1 : 0;
    const k = z.skipping ? want : S.lightK[i] + (want - S.lightK[i]) * Math.min(1, dt * 3.5);
    S.lightK[i] = k;
    const m = S.lights[i];
    m.visible = k > 0.01;
    m.scale.setScalar(0.2 + 0.8 * k);
  }
}

// =====================================================================================================================
// The terminal — text only, on the status board (never a voice)
// =====================================================================================================================

/**
 * One terminal string as a board row, exact: everything up to and including the first colon is the label, the
 * state after it is the value (`BOUNDARY STATE:` · `CLOSED`); a string without a colon is all label.
 */
export function row(text: string, tone: 'ok' | 'warn' | 'neutral' = 'neutral'): { label: string; value: string; tone: 'ok' | 'warn' | 'neutral' } {
  const i = text.indexOf(': ');
  return i < 0 ? { label: text, value: '', tone } : { label: text.slice(0, i + 1), value: text.slice(i + 2), tone };
}

/**
 * Where the board sits: 'centre' over establishing shots (the empty middle of a wide frame), 'lowerThird' — a
 * compact strip above the subtitles — when the text stays up UNDER the close-ups and lines that answer it, 'side'
 * for a long list that must stay readable beside a two-shot.
 */
export type BoardPlace = 'centre' | 'lowerThird' | 'side';
type TermLine = string | readonly [string, 'ok' | 'warn' | 'neutral'];

/** show these terminal strings (a fresh board when `fresh`, otherwise rows are appended / updated in place) */
export function terminal(z: ZoneRuntime, lines: ReadonlyArray<TermLine>, fresh = false, placement: BoardPlace = 'centre'): void {
  const ui = z.game.ui;
  if (fresh) ui.statusBoard(null);
  ui.statusBoard(lines.map((l) => (typeof l === 'string' ? row(l) : row(l[0], l[1]))), { placement });
}

/**
 * Show terminal strings for `seconds`, then clear the board (a scene routine: the hold collapses on a skip) —
 * for text read over an establishing shot with nothing said under it.
 */
export function* show(z: ZoneRuntime, lines: ReadonlyArray<TermLine>, seconds: number, placement: BoardPlace = 'centre'): Generator<number, void, unknown> {
  terminal(z, lines, true, placement);
  yield seconds;
  z.game.ui.statusBoard(null);
}

/**
 * Put terminal strings up as a lower third and give them `lead` seconds to land; the board then STAYS under the
 * lines that answer it (the caller clears it with `z.game.ui.statusBoard(null)` after them). This is how terminal
 * text sits “under the dialogue” without a dead hold before every close-up.
 */
export function* under(z: ZoneRuntime, lines: ReadonlyArray<TermLine>, lead: number, placement: BoardPlace = 'lowerThird'): Generator<number, void, unknown> {
  terminal(z, lines, true, placement);
  yield lead;
}
