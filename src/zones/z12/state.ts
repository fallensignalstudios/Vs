/**
 * Z12 — per-load state: the two craft and their departure (one authored flight each, on the sim clock), the
 * recorder in Selene's hand, the two comm ciphers, the hangar alert projection. `updateZ12` (ZoneDef.update)
 * advances them; while a scene is skipped everything snaps to its end, so a skip leaves the same world.
 */
import * as THREE from 'three';
import type { Actor, HumanoidVisual, ZoneBuilder, ZoneRuntime } from '@/core/api';
import { isHumanoidVisual } from '@/core/api';
import { AMBER, BLUE } from '../shared';
import { textPanel, type TextPanel } from '../z11/projection';
import type { Z12Space } from './layout';

interface Flight {
  ship: THREE.Object3D;
  /** quadratic path in world space: lift point, the turn out of the hangar, far away */
  p0: THREE.Vector3; p1: THREE.Vector3; p2: THREE.Vector3;
  start: THREE.Vector3;
  startYaw: number;
}

export interface Z12 {
  sp: Z12Space | null;
  recorder: THREE.Object3D | null;
  cipherT: THREE.Object3D | null;
  cipherS: THREE.Object3D | null;
  alert: TextPanel | null;
  flights: Flight[];
  /** seconds into the departure (−1 = parked) */
  t: number;
  /** who carries what, by socket */
  carried: Array<{ obj: THREE.Object3D; actor: Actor; socket: 'handL' | 'handR' }>;
}

export let S: Z12 = blank();
function blank(): Z12 {
  return { sp: null, recorder: null, cipherT: null, cipherS: null, alert: null, flights: [], t: -1, carried: [] };
}
export function resetZ12(): void {
  S.alert?.dispose();
  S = blank();
}

/** departure timeline (seconds): rise, turn to face the open edge, then out along opposite vectors */
export const RISE = 3.2;
export const TURN = 2.6;
export const OUT = 11;
export const FLIGHT_END = RISE + TURN + OUT;

export function buildObjects(b: ZoneBuilder, sp: Z12Space): void {
  S.sp = sp;
  const mats = b.game.mats;
  const box = (w: number, h: number, d: number, m: THREE.Material): THREE.Mesh => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  const rec = new THREE.Group();
  rec.add(box(0.13, 0.026, 0.07, mats.get('domBlack')));
  const line = box(0.11, 0.004, 0.005, mats.get('goldTrim'));
  line.position.set(0, 0.0145, 0.022);
  rec.add(line);
  const cipher = (c: number): THREE.Group => {
    const g = new THREE.Group();
    g.add(box(0.11, 0.012, 0.022, mats.get(c === AMBER ? 'domBronze' : 'refSteel')));
    const lit = box(0.07, 0.004, 0.006, mats.emissive(c, 2.6));
    lit.position.y = 0.007;
    g.add(lit);
    return g;
  };
  S.recorder = rec;
  S.cipherT = cipher(AMBER);
  S.cipherS = cipher(BLUE);
  for (const o of [S.recorder, S.cipherT, S.cipherS]) {
    o.visible = false;
    b.keep(b.add(o));
  }
  // (polish 4: with a legible screen-space twin — `ui.worldText` — so the alert reads at 720p)
  S.alert = textPanel({ lines: ['CEASEFIRE VIOLATION RISK: ELEVATED'], width: 3.4, color: 0xff7a4a, intensity: 2.1, px: 60, maxRows: 1, label: { id: 'z12-alert', tone: 'amber', size: 0.1 } });
  S.alert.object.position.copy(b.P(21, 17.5, 5.2));
  b.keep(b.add(S.alert.object));
}

/** carry an object in a hand (null actor hides it) */
export function carry(obj: THREE.Object3D | null, actor: Actor | null, socket: 'handL' | 'handR' = 'handL'): void {
  if (!obj) return;
  S.carried = S.carried.filter((c) => c.obj !== obj);
  if (!actor) {
    obj.visible = false;
    return;
  }
  S.carried.push({ obj, actor, socket });
}

export function humanoid(a: Actor | null | undefined): HumanoidVisual | null {
  const v = a?.visual;
  return v && isHumanoidVisual(v) ? v : null;
}

/** set the two flights up from where the ships are parked (called once, when the departure starts) */
export function prepareFlights(z: ZoneRuntime): void {
  const sp = S.sp;
  if (!sp || S.flights.length) return;
  const mk = (ship: THREE.Object3D | undefined, side: -1 | 1): void => {
    if (!ship) return;
    const start = ship.position.clone();
    const p0 = start.clone().setY(start.y + 3.6);
    const p1 = new THREE.Vector3(start.x + side * 4, start.y + 9, start.z - 46);
    const p2 = new THREE.Vector3(start.x + side * 330, start.y + 70, start.z - 420);
    S.flights.push({ ship, p0, p1, p2, start, startYaw: ship.rotation.y });
  };
  mk(sp.dom?.object, -1);
  mk(sp.ref?.object, 1);
  void z;
}

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();

/** ZoneDef.update */
export function updateZ12(z: ZoneRuntime, dt: number): void {
  for (const c of S.carried) {
    const v = c.actor.visual;
    c.obj.visible = !!v && c.actor.alive && v.root.visible;
    if (v) v.socket(c.socket).getWorldPosition(c.obj.position);
  }
  S.alert?.update(dt, z.skipping);
  const cam = z.game.camera.camera;
  if (S.alert?.object.visible && cam) S.alert.object.quaternion.copy(cam.quaternion);
  S.alert?.syncLabel(z.game.ui);
  if (S.t < 0) return;
  S.t = z.skipping ? FLIGHT_END : Math.min(FLIGHT_END, S.t + dt);
  for (const f of S.flights) fly(f, S.t);
  // “Amber ships surround Tarrik, while blue-white vessels close around Selene.” — once each craft has turned out
  // of the hangar its own escort closes in (about 7 s); a skip lands them in formation
  if (S.t >= RISE + TURN) {
    for (const ship of [S.sp?.dom, S.sp?.ref]) {
      if (!ship) continue;
      ship.params.escort = 1;
      if (z.skipping) ship.snap();
    }
  }
}

function fly(f: Flight, t: number): void {
  const o = f.ship;
  if (t <= RISE) {
    const k = smooth(t / RISE);
    o.position.lerpVectors(f.start, f.p0, k);
    o.rotation.set(0, f.startYaw, 0);
    o.visible = true;
    return;
  }
  // nose toward the open edge (north): yaw for local +X to point along −Z is +π/2
  const north = Math.PI / 2;
  if (t <= RISE + TURN) {
    const k = smooth((t - RISE) / TURN);
    o.position.copy(f.p0);
    o.rotation.set(0, lerpAngle(f.startYaw, north, k), 0);
    o.visible = true;
    return;
  }
  const k = Math.min(1, (t - RISE - TURN) / OUT);
  const u = k * k; // accelerating out
  bezier(f, u, o.position);
  bezier(f, Math.min(1, u + 0.01), tmpA);
  tmpB.subVectors(tmpA, o.position);
  if (tmpB.lengthSq() > 1e-8) o.rotation.set(0, Math.atan2(-tmpB.z, tmpB.x), Math.atan2(tmpB.y, Math.hypot(tmpB.x, tmpB.z)) * 0.6, 'YZX');
  o.visible = k < 1;
}

function bezier(f: Flight, u: number, out: THREE.Vector3): void {
  const a = (1 - u) * (1 - u);
  const b = 2 * (1 - u) * u;
  const c = u * u;
  out.set(a * f.p0.x + b * f.p1.x + c * f.p2.x, a * f.p0.y + b * f.p1.y + c * f.p2.y, a * f.p0.z + b * f.p1.z + c * f.p2.z);
}

const smooth = (k: number): number => {
  const x = Math.min(1, Math.max(0, k));
  return x * x * (3 - 2 * x);
};
function lerpAngle(a: number, b: number, k: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}
