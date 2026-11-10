/**
 * Authored break-up of rigid pieces (hero props). A piece is one instance of an InstancedMesh with a rest pose
 * and a motion that is a pure function of the destruction amount `d` (0 = intact … 1 = wreck at rest), so the
 * animation can be scrubbed, skipped and restored from a checkpoint without simulation state.
 */
import * as THREE from 'three';
import { clamp01 } from '@/core/mathx';

export type Motion =
  | { kind: 'static' }
  /** falls over about a hinge line (axis through `hinge`), accelerating, with one small bounce */
  | { kind: 'topple'; t0: number; hinge: THREE.Vector3; axis: THREE.Vector3; angle: number; seconds: number }
  /**
   * thrown: ballistic until it lands on `floor`, tumbling, then a short slide. `hidden` pieces (debris) have no
   * size until they start; `vanish` > 0 makes the piece shrink away over that many seconds (dispersal).
   */
  | { kind: 'fly'; t0: number; vel: THREE.Vector3; spinAxis: THREE.Vector3; spin: number; floor: number; hidden?: boolean; vanish?: number };

export interface Piece {
  /** which instanced set the piece belongs to, and its instance index there */
  set: number;
  slot: number;
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  scale: THREE.Vector3;
  motion: Motion;
}

const G = 9.8;
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _r = new THREE.Quaternion();
const _s = new THREE.Vector3();

/** 0 → 1 fall curve: accelerates like a falling body, overshoots nothing, bounces back 6 % once */
export function toppleCurve(t: number): number {
  if (t <= 0) return 0;
  if (t < 1) return t * t;
  const k = Math.min(1, (t - 1) / 0.55);
  return 1 - 0.06 * Math.sin(Math.PI * k) * (1 - k);
}

/**
 * Pose of a piece at destruction amount `d`; `total` = seconds the whole break-up lasts at d: 0 → 1.
 * Writes `out` (a matrix) and returns it.
 */
export function evalPiece(piece: Piece, d: number, total: number, out: THREE.Matrix4): THREE.Matrix4 {
  const m = piece.motion;
  _p.copy(piece.pos);
  _q.copy(piece.quat);
  _s.copy(piece.scale);
  if (m.kind === 'topple') {
    const tau = Math.max(0, clamp01(d) - m.t0) * total;
    if (tau > 0) {
      _r.setFromAxisAngle(m.axis, m.angle * toppleCurve(tau / m.seconds));
      _p.sub(m.hinge).applyQuaternion(_r).add(m.hinge);
      _q.premultiply(_r);
    }
  } else if (m.kind === 'fly') {
    const tau = Math.max(0, clamp01(d) - m.t0) * total;
    if (tau <= 0) {
      if (m.hidden) _s.setScalar(0);
    } else {
      const drop = Math.max(0, piece.pos.y - m.floor);
      const land = (m.vel.y + Math.sqrt(m.vel.y * m.vel.y + 2 * G * drop)) / G;
      const air = Math.min(tau, land);
      _p.x += m.vel.x * air;
      _p.z += m.vel.z * air;
      _p.y += m.vel.y * air - 0.5 * G * air * air;
      if (tau >= land) {
        // landed: rest on the floor, a short decaying slide
        const slide = 0.22 * (1 - Math.exp(-(tau - land) * 4));
        _p.x += m.vel.x * slide;
        _p.z += m.vel.z * slide;
        _p.y = m.floor;
      }
      _r.setFromAxisAngle(m.spinAxis, m.spin * air);
      _q.premultiply(_r);
      if (m.vanish) _s.multiplyScalar(1 - clamp01(tau / m.vanish));
    }
  }
  return out.compose(_p, _q, _s);
}
