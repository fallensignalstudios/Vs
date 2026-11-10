/**
 * Tendril chains — the elite's violet wreath — shared by its two bodies (the procedural rig carries them on
 * its own skeleton; the generated skin wears a small procedural wreath over its back).
 *
 * Chains are solved in model space: each segment takes a direction (hang + writhe + flare + drag behind the
 * body's motion), its end point is kept on or above the floor, and only then is the direction turned into a
 * bone rotation — so a collapsed body's tendrils lie along the ground instead of passing through it.
 */
import * as THREE from 'three';
import { clamp } from '@/core/mathx';

export interface Tendril {
  bones: THREE.Bone[];
  /** bind direction (model space) and length of each segment */
  dir: THREE.Vector3[];
  len: number[];
  /** which parent frame the root hangs from */
  frame: number;
}

export interface TendrilDrive {
  t: number;
  /** 1 writhing … 0 limp */
  life: number;
  /** 0..1+ flare of the wreath (roar, pulse) */
  flare: number;
  beat: number;
  /** body velocity (model units / s), three progressively smoothed copies: root, mid, tip */
  vel: readonly THREE.Vector3[];
  /** floor clearance of the first segment's end (model units) */
  floor: number;
}

const _p = new THREE.Vector3(), _d = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _qp = new THREE.Quaternion();

/** bind directions and lengths of a chain from its bones' rest positions (the last segment repeats the one before) */
export function measureTendril(bones: THREE.Bone[], restOf: (b: THREE.Bone, out: THREE.Vector3) => THREE.Vector3, frame: number): Tendril {
  const dir: THREE.Vector3[] = [], len: number[] = [];
  const a = new THREE.Vector3(), c = new THREE.Vector3();
  for (let j = 0; j < bones.length; j++) {
    const k = Math.min(j, bones.length - 2);
    restOf(bones[k]!, a);
    restOf(bones[k + 1]!, c).sub(a);
    len.push(c.length());
    dir.push(c.clone().normalize());
  }
  return { bones, dir, len, frame };
}

/**
 * Pose every chain. `frames[k]` is the model-space matrix of parent frame k (rotation + translation only);
 * the root bones must hold their rest position relative to that parent.
 */
export function solveTendrils(list: readonly Tendril[], frames: readonly THREE.Matrix4[], d: TendrilDrive): void {
  const t = d.t;
  for (let i = 0; i < list.length; i++) {
    const td = list[i]!;
    const m = frames[td.frame]!;
    _p.copy(td.bones[0]!.position).applyMatrix4(m); // root, model space
    _qp.setFromRotationMatrix(m);                  // parent orientation, model space
    const rx = _p.x, rz = _p.z - 0.3;
    const rl = Math.hypot(rx, rz) || 1;
    for (let j = 0; j < td.bones.length; j++) {
      const rest = td.dir[j]!, v = d.vel[Math.min(d.vel.length - 1, j)]!;
      const amp = (0.1 + j * 0.07) * d.life;
      const out = d.flare * (j === 0 ? 0.9 : 0.45);
      _d.set(
        rest.x * 0.5 + Math.sin(t * 0.9 + i * 1.7 - j * 0.85) * amp - v.x * 0.05 * (j + 1) + (rx / rl) * out,
        -1 + d.flare * (0.75 - j * 0.14) + clamp(-v.y * 0.04 * (j + 1), -0.4, 0.7) + d.beat * 0.04 * j * d.life,
        rest.z * 0.5 + 0.2 + Math.cos(t * 0.7 + i * 2.3 - j * 0.9) * amp - v.z * 0.05 * (j + 1) + (rz / rl) * out,
      ).normalize();
      const len = td.len[j]!, floor = Math.max(0.02, d.floor - j * 0.012);
      if (_p.y + _d.y * len < floor) {
        // the segment would end under the floor: lay it down, keeping its heading
        const dy = clamp((floor - _p.y) / len, -1, 1);
        const h = Math.hypot(_d.x, _d.z), flat = Math.sqrt(1 - dy * dy);
        if (h > 1e-4) _d.set((_d.x / h) * flat, dy, (_d.z / h) * flat);
        else _d.set((rx / rl) * flat, dy, (rz / rl) * flat);
      }
      _q.setFromUnitVectors(rest, _d);
      td.bones[j]!.quaternion.copy(_q2.copy(_qp).invert().multiply(_q));
      _qp.copy(_q);
      _p.addScaledVector(_d, len);
    }
  }
}
