/**
 * Wreath — the trailing violet tendrils the generated elite skin wears over its back (the file itself has
 * none; the concept's organism is "wreathed in violet"). A small procedural rig: one anchor bone that rides
 * the skin's upper spine, and tendril chains hanging from it, solved by ./tendrils. One extra draw call,
 * driven by the wearer's uniform block so every state (flash, frost, dissolve …) reaches it too.
 */
import * as THREE from 'three';
import { sphere, T, type Pt3 } from '../core/geo';
import { P, tint } from '../core/palette';
import { getTemplate, Rig, RigBuilder, type RigTemplate } from '../core/rig';
import { createStateMaterial, type StateUniforms } from '../core/shader';
import { measureTendril, solveTendrils, type Tendril, type TendrilDrive } from './tendrils';

/** nominal bind position of the skin's upper-spine bone the anchor is authored around (skin model space, metres) */
const ANCHOR: Pt3 = [0, 2.84, 0.12];
const SEGMENTS = 4;
/** roots across the shoulders and down the back: [x, y, z, dirX, dirZ, length, radius] */
const ROOTS: readonly (readonly [number, number, number, number, number, number, number])[] = [
  [0.34, 3.08, 0.36, 0.25, 0.55, 1.9, 0.085], [-0.34, 3.08, 0.36, -0.25, 0.55, 2.1, 0.085],
  [0.62, 2.98, 0.26, 0.5, 0.4, 1.6, 0.075], [-0.62, 2.96, 0.26, -0.5, 0.4, 1.75, 0.075],
  [0.16, 2.74, 0.42, 0.1, 0.6, 1.5, 0.07], [-0.18, 2.72, 0.42, -0.12, 0.6, 1.4, 0.07],
  [0.78, 3.04, 0.06, 0.6, 0.2, 1.35, 0.06], [-0.78, 3.02, 0.06, -0.6, 0.2, 1.5, 0.06],
  [0.02, 3.12, 0.4, 0.04, 0.6, 2.2, 0.08], [0.44, 2.58, 0.38, 0.3, 0.5, 1.2, 0.06],
];
const WREATH_GROUPS = { nodes: 4 } as const;

function buildWreath(): RigTemplate {
  const b = new RigBuilder();
  b.bone('anchor', null, ANCHOR);
  ROOTS.forEach(([x, y, z, dx, dz, len, r], i) => {
    const d = new THREE.Vector3(dx, -0.8, dz).normalize(), seg = len / SEGMENTS;
    const pts: Pt3[] = [];
    for (let j = 0; j < SEGMENTS; j++) pts.push([x + d.x * seg * j, y + d.y * seg * j, z + d.z * seg * j]);
    const chain = b.chain(`w${i}_`, 'anchor', pts);
    const tip: Pt3 = [x + d.x * len, y + d.y * len, z + d.z * len];
    b.tubeOn(chain, tip, i % 2 ? tint(P.sinew, { c: 0x2a2030, r: 0.62 }) : tint(P.tissueWet, { c: 0x17111e, r: 0.56 }), (t) => r * (1 - t) ** 0.75 + 0.012, 7, {}, 1, 3);
    // the last run carries light, so the wreath reads violet as a whole and stays an accent up close
    const p2 = pts[2]!;
    const mid = (a: Pt3, c: Pt3, t: number): Pt3 => [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t, a[2] + (c[2] - a[2]) * t];
    b.tubeOn([chain[2]!, chain[3]!], tip, tint(P.violet, { e: 0.6, r: 0.5 }), (t) => r * 0.42 * (1 - t * 0.7) + 0.006, 5, { group: WREATH_GROUPS.nodes }, 1, 2);
    b.add(chain[1]!, P.violet, sphere(r * 0.45, 1), T(...mid(pts[1]!, p2, 0.5)), { group: WREATH_GROUPS.nodes, crease: 180 });
    b.add('anchor', tint(P.tissue, { c: 0x1b1522, r: 0.72 }), sphere(r * 1.5, 1), T(x, y, z), { crease: 180 });
  });
  return b.build();
}

export class Wreath {
  readonly rig: Rig;
  readonly material: THREE.MeshStandardMaterial;
  private readonly anchor: THREE.Bone;
  private readonly tendrils: Tendril[] = [];
  private readonly frames = [new THREE.Matrix4()];
  private readonly one = new THREE.Vector3(1, 1, 1);

  constructor(uniforms: StateUniforms) {
    this.material = createStateMaterial(true, uniforms).material;
    this.rig = new Rig(getTemplate('elite:wreath', buildWreath), this.material, 'elite:wreath');
    this.rig.mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.8, 0), 4.2);
    this.anchor = this.rig.b('anchor');
    const rest = (bone: THREE.Bone, out: THREE.Vector3): THREE.Vector3 => this.rig.restOf(this.rig.indexOf(bone), out);
    for (let i = 0; i < ROOTS.length; i++) {
      const bones: THREE.Bone[] = [];
      for (let j = 0; j < SEGMENTS; j++) bones.push(this.rig.b(`w${i}_${j}`));
      this.tendrils.push(measureTendril(bones, rest, 0));
    }
  }

  /**
   * @param pos   current model-space position of the skin's upper-spine bone
   * @param delta that bone's rotation away from its bind orientation (model space)
   */
  pose(pos: THREE.Vector3, delta: THREE.Quaternion, drive: TendrilDrive): void {
    this.rig.reset();
    this.anchor.position.copy(pos);
    this.anchor.quaternion.copy(delta);
    // the anchor's own frame: children hold rest offsets from the anchor's bind position
    this.frames[0]!.compose(pos, delta, this.one);
    solveTendrils(this.tendrils, this.frames, drive);
  }

  dispose(): void {
    this.rig.dispose();
    this.material.dispose();
  }
}
