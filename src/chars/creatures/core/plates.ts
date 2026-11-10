/**
 * Appropriated-plating vocabulary shared by the Eclipse bodies: irregular broken slabs, kite shields, blade
 * plates, and helpers that seat curved plates on limbs / body masses with a slide vector, so the shader can
 * make them shift, lift and re-knit.
 */
import * as THREE from 'three';
import { plate, rand, type Pt2, type Pt3 } from './geo';
import type { Paint, PartOpts, RigBuilder } from './rig';

/** Irregular broken slab: a rectangle with some corners sheared off and every vertex nudged. */
export function slab(w: number, h: number, seed: number, cuts = 2): Pt2[] {
  const r = rand(seed);
  const hw = w / 2, hh = h / 2;
  const corners: Pt2[] = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
  const pick = new Set<number>();
  while (pick.size < Math.min(cuts, 4)) pick.add(Math.floor(r() * 4));
  const out: Pt2[] = [];
  const m = Math.min(w, h);
  for (let i = 0; i < 4; i++) {
    const c = corners[i]!;
    const jx = (r() - 0.5) * w * 0.07, jy = (r() - 0.5) * h * 0.07;
    if (pick.has(i)) {
      const cx = m * (0.18 + r() * 0.3), cy = m * (0.18 + r() * 0.3);
      const sx = Math.sign(c[0]), sy = Math.sign(c[1]);
      // keep CCW order: which cut point comes first depends on the corner
      const a: Pt2 = [c[0] - sx * cx + jx, c[1] + jy], b: Pt2 = [c[0] + jx, c[1] - sy * cy + jy];
      if (i === 0 || i === 2) out.push(b, a);
      else out.push(a, b);
    } else out.push([c[0] + jx, c[1] + jy]);
  }
  return out;
}

/** Shield / kite: flat-ish top, shoulders, pointed lower tip (−Y). */
export function kite(w: number, h: number, shoulder = 0.3, seed = 0): Pt2[] {
  const r = rand(seed + 3);
  const hw = w / 2, hh = h / 2;
  const j = (): number => (seed ? (r() - 0.5) * 0.08 : 0);
  return [
    [w * j(), -hh], [hw * (0.75 + j()), -hh + h * (0.38 + j())], [hw, hh - h * shoulder], [hw * (0.62 + j()), hh],
    [-hw * (0.55 + j()), hh * (1 + j())], [-hw, hh - h * (shoulder + 0.08 + j())], [-hw * (0.8 + j()), -hh + h * 0.42],
  ];
}

/** Long tapering blade plate pointing +Y (shards used as fins, spurs and stretched plating). */
export function bladeOutline(w: number, h: number, seed = 0, hook = 0): Pt2[] {
  const r = rand(seed + 11);
  const hw = w / 2;
  const j = (): number => (seed ? (r() - 0.5) * 0.12 : 0);
  return [
    [-hw * (0.7 + j()), 0], [hw * (0.75 + j()), 0], [hw * (1 + j()), h * (0.28 + j())], [hw * 0.55 + hook * w, h * (0.72 + j())],
    [hook * w * 1.6, h], [-hw * (0.45 + j()) + hook * w * 0.6, h * (0.66 + j())], [-hw * (1 + j()), h * (0.3 + j())],
  ];
}

const _z = new THREE.Vector3(), _y = new THREE.Vector3(), _x = new THREE.Vector3();

/** Matrix seating a plate at `pos`: plate +Z → `normal`, plate +Y → `up` projected onto the surface, then rolled. */
export function facing(pos: Pt3, normal: Pt3, up: Pt3 = [0, 1, 0], roll = 0): THREE.Matrix4 {
  _z.set(normal[0], normal[1], normal[2]).normalize();
  _y.set(up[0], up[1], up[2]);
  _y.addScaledVector(_z, -_y.dot(_z));
  if (_y.lengthSq() < 1e-6) { _y.set(0, 0, -1).addScaledVector(_z, _z.z); }
  _y.normalize();
  _x.crossVectors(_y, _z);
  const m = new THREE.Matrix4().makeBasis(_x, _y, _z);
  if (roll) m.multiply(new THREE.Matrix4().makeRotationZ(roll));
  m.setPosition(pos[0], pos[1], pos[2]);
  return m;
}

export interface PlateOpts extends PartOpts {
  thick?: number;
  bevel?: number;
  /** bend radii (0 = flat) */
  rx?: number;
  ry?: number;
  /** contrasting underlay showing as a rim along one side (gold trim on King-era fragments) */
  trim?: Paint;
  /** how far the plate lifts along its normal at knit = 1 (default 0.1) */
  lift?: number;
  /** how far it slides along its own +Y at knit = 1 (default 0.05) */
  shift?: number;
}

/** Add one curved armour plate seated by matrix `m` (see `facing`), with a knit slide vector derived from it. */
export function addPlate(b: RigBuilder, bone: string, paint: Paint, outline: readonly Pt2[], m: THREE.Matrix4, o: PlateOpts = {}): void {
  const thick = o.thick ?? 0.05, bevel = o.bevel ?? Math.min(0.02, thick * 0.4);
  const e = m.elements;
  const lift = o.lift ?? 0.1, shift = o.shift ?? 0.05;
  const slide: Pt3 = o.slide ?? [e[8]! * lift + e[4]! * shift, e[9]! * lift + e[5]! * shift, e[10]! * lift + e[6]! * shift];
  const opts: PartOpts = { group: o.group, rand: o.rand, crease: o.crease, slide };
  b.add(bone, paint, plate(outline, thick, bevel, o.rx ?? 0, o.ry ?? 0, bevel * 0.5), m, opts);
  if (o.trim) {
    const under = outline.map((p) => [p[0] * 1.07 + 0.012, p[1] * 1.05 - 0.016] as Pt2);
    const mt = m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, -thick * 0.62));
    b.add(bone, o.trim, plate(under, thick * 0.5, bevel * 0.5, o.rx ? o.rx - thick * 0.6 : 0, o.ry ? o.ry - thick * 0.6 : 0, 0), mt, opts);
  }
}

export interface LimbPlate {
  /** 0..1 along the segment */
  t: number;
  /** angle around the limb axis (radians; 0 = `front` direction) */
  a: number;
  paint: Paint;
  outline: readonly Pt2[];
  /** extra stand-off from the limb surface */
  off?: number;
  /** tilt of the plate's long axis away from the limb axis */
  roll?: number;
  /** flare: swing the plate's distal edge away from the limb like a skirt (radians) */
  flare?: number;
  opts?: PlateOpts;
}

/**
 * Seat plates around a limb segment a→c of radius r. Each plate's long axis (+Y) runs back toward `a`
 * (so points/tips hang toward the extremity when outlines point −Y). `front` fixes angle 0.
 */
export function limbPlates(b: RigBuilder, bone: string, a: Pt3, c: Pt3, r: number | ((t: number) => number), front: Pt3, plates: readonly LimbPlate[]): void {
  const axis = new THREE.Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
  const len = axis.length();
  axis.normalize();
  const f = new THREE.Vector3(front[0], front[1], front[2]);
  f.addScaledVector(axis, -f.dot(axis)).normalize();
  const side = new THREE.Vector3().crossVectors(axis, f);
  const n = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3();
  for (const pl of plates) {
    const rr = typeof r === 'number' ? r : r(pl.t);
    n.copy(f).multiplyScalar(Math.cos(pl.a)).addScaledVector(side, Math.sin(pl.a));
    p.set(a[0], a[1], a[2]).addScaledVector(axis, len * pl.t).addScaledVector(n, rr + (pl.off ?? 0));
    up.copy(axis).multiplyScalar(-1);
    if (pl.flare) n.addScaledVector(up, Math.tan(pl.flare)).normalize();
    const m = facing([p.x, p.y, p.z], [n.x, n.y, n.z], [up.x, up.y, up.z], pl.roll ?? 0);
    addPlate(b, bone, pl.paint, pl.outline, m, pl.opts);
  }
}
