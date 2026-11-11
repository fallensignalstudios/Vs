/**
 * Escort flight: a few craft that close in around a ship and hold formation with it ("Amber ships surround
 * Tarrik, while blue-white vessels close around Selene."). The group is a CHILD of the escorted ship, so it
 * follows whatever path the zone flies; `set(k)` places the escorts along their approach: 0 = hidden (they wait
 * far out, ahead and to the sides), 1 = in formation around the ship. The approach is eased, the escorts bank into
 * their turn and bob a little once they hold position. Offsets are in the escorted ship's frame (nose +X), in
 * multiples of its length.
 *
 * Each escort is a GeneratedShip (its own LOD and engine glow). When the generated model cannot be had, `fallback`
 * (a clone of the escorted ship's procedural hull) stands in, so the escort still happens.
 */
import * as THREE from 'three';
import type { ShipModelId } from './catalog';
import { GeneratedShip } from './model';

/** formation slots (×length): wingmen left / right, high astern, low outside, then an outer pair */
const SLOTS: ReadonlyArray<readonly [number, number, number]> = [
  [-0.85, 0.12, -1.15], [-0.85, 0.12, 1.15], [-1.7, 0.75, 0], [-1.45, -0.5, -1.9], [-2.4, 0.2, 2.3], [-2.6, -0.2, -3.0],
];

export interface EscortOpts {
  /** number of escorts 1…6 (default 4) */
  count?: number;
  /** formation spread multiplier 0.5…3 (default 1) */
  spread?: number;
  /** escort length in metres (default: the escorted ship's) */
  length?: number;
}

interface Slot {
  obj: THREE.Object3D;
  ship: GeneratedShip | null;
  near: THREE.Vector3;
  far: THREE.Vector3;
  phase: number;
  /** hold bob amplitude (m) */
  amp: number;
}

const smoother = (x: number): number => {
  const k = Math.min(1, Math.max(0, x));
  return k * k * k * (k * (k * 6 - 15) + 10);
};

export class EscortFlight {
  readonly object = new THREE.Group();
  private readonly slots: Slot[] = [];
  private k = -1;

  /**
   * @param model   which generated ship the escorts are
   * @param length  escorted ship length (m): the unit of the formation
   * @param fallback builds a stand-in hull (shares geometry) for an escort whose model cannot be had
   */
  constructor(model: ShipModelId, length: number, opts: EscortOpts = {}, fallback?: () => THREE.Object3D) {
    this.object.name = 'ship:escort';
    const count = Math.round(clampN(opts.count, 4, 1, 6));
    const spread = clampN(opts.spread, 1, 0.5, 3);
    const L = clampN(length, 14, 1, 2000);
    const shipLen = clampN(opts.length, L, 1, 2000);
    for (let i = 0; i < count; i++) {
      const s = SLOTS[i];
      const near = new THREE.Vector3(s[0] * L * spread, s[1] * L * spread, s[2] * L * spread);
      const side = s[2] === 0 ? (i % 2 ? 1 : -1) : Math.sign(s[2]);
      // they wait out ahead and wide, a little high, and swing in
      const far = new THREE.Vector3(near.x + (26 + 4 * i) * L, near.y + (2.5 + i * 0.6) * L, near.z + side * (14 + 3 * i) * L);
      const holder = new THREE.Group();
      holder.name = `ship:escort${i}`;
      const ship = new GeneratedShip(model, { length: shipLen, frame: 'plusX', origin: 'centre', engines: 1.1, lights: 1 });
      holder.add(ship.object);
      if (fallback) {
        const stand = fallback();
        stand.name = 'ship:escortFallback';
        holder.add(stand);
        void ship.ready.then((ok) => { if (ok) stand.visible = false; });
      }
      holder.visible = false;
      this.object.add(holder);
      this.slots.push({ obj: holder, ship, near, far, phase: i * 1.7 + 0.4, amp: 0.02 * L });
    }
  }

  get count(): number { return this.slots.length; }

  /** the escort craft (for cameras / audio) */
  get craft(): THREE.Object3D[] { return this.slots.map((s) => s.obj); }

  /** 0 = waiting out of sight, 1 = in formation; `time` drives the hold bob */
  set(k: number, time: number): void {
    const kk = Number.isFinite(k) ? Math.min(1, Math.max(0, k)) : 0;
    const t = Number.isFinite(time) ? time : 0;
    this.k = kk;
    const on = kk > 0.001;
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      s.obj.visible = on;
      if (!on) continue;
      // later escorts arrive a little later; each finishes by k = 1
      const lag = i * 0.07;
      const u = smoother((kk - lag) / (1 - lag));
      const u2 = smoother((kk + 0.01 - lag) / (1 - lag));
      s.obj.position.lerpVectors(s.far, s.near, u);
      s.obj.position.y += Math.sin(t * 0.8 + s.phase) * s.amp * u;
      // bank into the turn: roll against the sideways motion, settle level in formation
      const dz = (s.near.z - s.far.z) * (u2 - u) / 0.01;
      const roll = THREE.MathUtils.clamp(-dz / Math.max(1, s.near.length() * 40), -0.6, 0.6);
      s.obj.rotation.set(roll + Math.sin(t * 0.6 + s.phase) * 0.02 * u, 0, 0);
    }
  }

  /** current approach value (−1 before the first set) */
  get value(): number { return this.k; }

  dispose(): void {
    for (const s of this.slots) s.ship?.dispose();
    this.slots.length = 0;
    this.object.removeFromParent();
    this.object.clear();
  }
}

function clampN(v: number | undefined, d: number, lo: number, hi: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
}
