/**
 * Z11 — per-load state and the small objects the scenes move: the field seal, the Cauldron recorder, the Record
 * 7283 wafer, and the text projections (Selene's command-strip projection over the table, the two comm messages,
 * the fleet alert in the room's own air). `updateZ11` (ZoneDef.update) carries them on the sim clock; while a scene
 * is skipped everything snaps to its target, so a skip ends in the same world as a watched scene.
 */
import * as THREE from 'three';
import { isHumanoidVisual, type Actor, type Companion, type HumanoidVisual, type ZoneBuilder, type ZoneRuntime } from '@/core/api';
import { AMBER, BLUE } from '../shared';
import { textPanel, type TextPanel } from './projection';
import type { Z11Space } from './layout';

/** where an item is: resting at a point, sliding toward one, or carried in a hand */
type Place =
  | { kind: 'rest'; at: THREE.Vector3 }
  | { kind: 'slide'; from: THREE.Vector3; at: THREE.Vector3; t: number; dur: number }
  | { kind: 'hand'; actor: Actor; socket: 'handL' | 'handR' }
  | { kind: 'hidden' };

export interface Item {
  readonly object: THREE.Object3D;
  place: Place;
}

/** a hand held on a moving point (an item) or a fixed one */
interface HandHold {
  actor: Actor;
  hand: 'L' | 'R';
  to: Item | THREE.Vector3 | (() => THREE.Vector3 | null);
}

export interface Z11 {
  sp: Z11Space | null;
  seal: Item | null;
  recorder: Item | null;
  wafer: Item | null;
  /** the command-strip projection over the table (the Admonition, the authority summary) */
  proj: TextPanel | null;
  /** the fleet alert, across the room near the glass */
  alert: TextPanel | null;
  /** forearm messages: Tarrik's comm (amber), Selene's viewmaker (cold) */
  commT: TextPanel | null;
  commS: TextPanel | null;
  holds: HandHold[];
  /** the player is seated (held pose + pinned) */
  seated: boolean;
}

/** which body each forearm message rides on */
const commOwner = new Map<TextPanel, Actor>();

export let S: Z11 = blank();
function blank(): Z11 {
  return { sp: null, seal: null, recorder: null, wafer: null, proj: null, alert: null, commT: null, commS: null, holds: [], seated: false };
}
export function resetZ11(): void {
  for (const p of [S.proj, S.alert, S.commT, S.commS]) p?.dispose();
  commOwner.clear();
  S = blank();
}

// =====================================================================================================================
// Build: the evidence, the seal, the projections
// =====================================================================================================================

/** build the small objects (called from build() after the space; they stay live, never merged) */
export function buildObjects(b: ZoneBuilder, sp: Z11Space): void {
  S.sp = sp;
  const mats = b.game.mats;
  // the field seal: a small Dominion medical patch case, amber-lit seam
  const seal = new THREE.Group();
  seal.name = 'z11-field-seal';
  seal.add(mesh(new THREE.BoxGeometry(0.075, 0.018, 0.05), mats.get('domBlack')));
  const sealSeam = mesh(new THREE.BoxGeometry(0.06, 0.003, 0.006), mats.emissive(AMBER, 2.2));
  sealSeam.position.y = 0.0105;
  seal.add(sealSeam);
  // the Cauldron recorder: “a black recorder”, a thin gold line along one face
  const rec = new THREE.Group();
  rec.name = 'z11-recorder';
  rec.add(mesh(new THREE.BoxGeometry(0.13, 0.026, 0.07), mats.get('domBlack')));
  const recLine = mesh(new THREE.BoxGeometry(0.11, 0.004, 0.005), mats.get('goldTrim'));
  recLine.position.set(0, 0.0145, 0.022);
  rec.add(recLine);
  const recLed = mesh(new THREE.BoxGeometry(0.008, 0.004, 0.008), mats.emissive(AMBER, 3));
  recLed.position.set(-0.05, 0.0145, -0.02);
  rec.add(recLed);
  // the wafer: “a thin archival wafer. Glass Citadel certification markings shimmer along one edge”
  const waf = new THREE.Group();
  waf.name = 'z11-wafer';
  waf.add(mesh(new THREE.BoxGeometry(0.11, 0.004, 0.075), mats.get('glass')));
  const wafEdge = mesh(new THREE.BoxGeometry(0.11, 0.005, 0.006), mats.emissive(BLUE, 3.2));
  wafEdge.position.set(0, 0.001, 0.035);
  waf.add(wafEdge);
  for (const g of [seal, rec, waf]) {
    g.visible = false;
    b.keep(b.add(g));
  }
  S.seal = { object: seal, place: { kind: 'hidden' } };
  S.recorder = { object: rec, place: { kind: 'hidden' } };
  S.wafer = { object: waf, place: { kind: 'hidden' } };

  // projections
  S.proj = textPanel({ lines: [' '], width: 0.95, color: 0xcfe6ff, intensity: 1.9, px: 52, maxRows: 3 });
  S.alert = textPanel({ lines: [' '], width: 2.6, color: 0xff7a4a, intensity: 2.1, px: 60, maxRows: 1 });
  S.commT = textPanel({ lines: [' '], width: 0.5, color: AMBER, intensity: 2.0, px: 70, maxRows: 2 });
  S.commS = textPanel({ lines: [' '], width: 0.5, color: 0xcfe6ff, intensity: 2.0, px: 70, maxRows: 2 });
  for (const p of [S.proj, S.alert, S.commT, S.commS]) b.keep(b.add(p.object));
}

function mesh(g: THREE.BufferGeometry, m: THREE.Material): THREE.Mesh {
  const x = new THREE.Mesh(g, m);
  x.castShadow = true;
  return x;
}

// =====================================================================================================================
// Script helpers (all skip-safe: they set targets; updateZ11 snaps them while skipping)
// =====================================================================================================================

export function rest(item: Item | null, at: THREE.Vector3): void {
  if (!item) return;
  item.place = { kind: 'rest', at: at.clone() };
}
export function slide(item: Item | null, to: THREE.Vector3, seconds: number): void {
  if (!item) return;
  item.place = { kind: 'slide', from: item.object.position.clone(), at: to.clone(), t: 0, dur: Math.max(0.05, seconds) };
}
export function carry(item: Item | null, actor: Actor | null, socket: 'handL' | 'handR' = 'handR'): void {
  if (!item || !actor) return;
  item.place = { kind: 'hand', actor, socket };
}
export function hide(item: Item | null): void {
  if (item) item.place = { kind: 'hidden' };
}

/** pin a hand on an item (it follows the item) or a point; null releases that hand */
export function hold(who: Actor | Companion | null, hand: 'L' | 'R', to: Item | THREE.Vector3 | (() => THREE.Vector3 | null) | null): void {
  const actor = who ? ((who as Companion).actor ?? (who as Actor)) : null;
  if (!actor) return;
  S.holds = S.holds.filter((h) => !(h.actor === actor && h.hand === hand));
  const v = humanoid(actor);
  if (!to) {
    v?.setHandTarget(hand, null);
    return;
  }
  S.holds.push({ actor, hand, to });
}
export function releaseHands(): void {
  for (const h of S.holds) humanoid(h.actor)?.setHandTarget(h.hand, null);
  S.holds = [];
}

export function humanoid(a: Actor | null | undefined): HumanoidVisual | null {
  const v = a?.visual;
  return v && isHumanoidVisual(v) ? v : null;
}

/** place a forearm message above a body's left forearm, facing the camera */
export function comm(panel: TextPanel | null, who: Actor | null, lines: string[] | null): void {
  if (!panel) return;
  if (!lines || !who) {
    panel.show(0, 0.6);
    return;
  }
  panel.setLines(lines);
  panel.show(1, 0.25);
  commOwner.set(panel, who);
}

// =====================================================================================================================
// Per-frame (ZoneDef.update)
// =====================================================================================================================

const tmp = new THREE.Vector3();

export function updateZ11(z: ZoneRuntime, dt: number): void {
  const snap = z.skipping;
  for (const item of [S.seal, S.recorder, S.wafer]) if (item) place(item, dt, snap);
  for (const h of S.holds) {
    const p = h.to instanceof THREE.Vector3 ? h.to : typeof h.to === 'function' ? h.to() : h.to.object.position;
    humanoid(h.actor)?.setHandTarget(h.hand, p, p ? 1 : 0);
  }
  const cam = z.game.camera.camera;
  for (const p of [S.proj, S.alert, S.commT, S.commS]) {
    if (!p) continue;
    p.update(dt, snap);
    if (p.object.visible && cam) p.object.quaternion.copy(cam.quaternion);
  }
  for (const [panel, actor] of commOwner) {
    if (!panel.object.visible) continue;
    const v = actor.visual;
    if (v) v.socket('handL').getWorldPosition(tmp);
    else tmp.copy(actor.pos).setY(actor.pos.y + 1.1);
    panel.object.position.set(tmp.x, tmp.y + 0.28, tmp.z);
  }
}

function place(item: Item, dt: number, snap: boolean): void {
  const o = item.object;
  const pl = item.place;
  switch (pl.kind) {
    case 'hidden':
      o.visible = false;
      return;
    case 'rest':
      o.visible = true;
      o.position.copy(pl.at);
      return;
    case 'slide': {
      o.visible = true;
      pl.t = snap ? pl.dur : Math.min(pl.dur, pl.t + dt);
      const k = pl.t / pl.dur;
      const e = k * k * (3 - 2 * k);
      o.position.lerpVectors(pl.from, pl.at, e);
      if (pl.t >= pl.dur) item.place = { kind: 'rest', at: pl.at.clone() };
      return;
    }
    case 'hand': {
      o.visible = true;
      const v = pl.actor.visual;
      if (v) v.socket(pl.socket).getWorldPosition(o.position);
      else o.position.copy(pl.actor.pos).setY(pl.actor.pos.y + 1);
      return;
    }
  }
}

/** the panel positions that do not follow a body */
export function placePanels(z: ZoneRuntime): void {
  // between the two of them, a little above their heads: in the profile two-shot it hangs in front of the Wound
  S.proj?.object.position.copy(z.m('seat0').lerp(z.m('seat3'), 0.5)).setY(1.72);
  S.alert?.object.position.copy(z.P(12, 29.6, 3.1));
}
