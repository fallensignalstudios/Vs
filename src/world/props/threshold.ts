/**
 * Recognition threshold (Z09) — a black-stone floor threshold between two low curbs with five real depressions
 * on an arc facing the approaching party, and narrow angular gold channels beyond them. `recognized` fills the
 * depressions with light one after another (left to right), then opens the channel pattern forward to a
 * convergence node and three lines that leave the far edge (continue them with `b.channel(...)`).
 *
 * Draw calls: stone, gold, depression light (instanced), channels, node = 5.
 */
import * as THREE from 'three';
import type { MaterialLibrary } from '@/core/api';
import { PALETTE } from '@/core/api/materials';
import { clamp01 } from '@/core/mathx';
import { PropBase, TMP, rate, revealBody, uC, uF, type Glow } from './base';
import { Parts, hoop, prep, strip, sweep, withT } from './geo';

type Params = { recognized: number };

const W = 7, D = 3.2, TOP = 0.045;
const DISH_R = 0.2;
/** depression centres: an arc that bulges toward the approach side (−Z) */
const DISHES: ReadonlyArray<readonly [number, number]> = [-2, -1, 0, 1, 2].map((k) => {
  const a = (k * 23 * Math.PI) / 180;
  return [2.45 * Math.sin(a), 1.5 - 2.45 * Math.cos(a)] as const;
});
const Z0 = -0.6, Z1 = D / 2;
const tOf = (z: number): number => clamp01((z - Z0) / (Z1 - Z0));

export class RecognitionThreshold extends PropBase<Params> {
  private readonly dishes: THREE.InstancedMesh;
  private readonly channels: THREE.ShaderMaterial;
  private readonly node: Glow;

  constructor(lib: MaterialLibrary | null) {
    super('recognitionThreshold', lib, { recognized: 0 }, { recognized: rate(4.8) });
    const P = new Parts();

    // slab with five real depressions (extruded outline with holes), on a thin base plate
    const shape = new THREE.Shape([new THREE.Vector2(-W / 2, -D / 2), new THREE.Vector2(W / 2, -D / 2), new THREE.Vector2(W / 2, D / 2), new THREE.Vector2(-W / 2, D / 2)]);
    for (const [x, z] of DISHES) {
      const hole = new THREE.Path();
      hole.absarc(x, -z, DISH_R, 0, Math.PI * 2, true);
      shape.holes.push(hole);
    }
    const slab = new THREE.ExtrudeGeometry(shape, { depth: TOP - 0.004, bevelEnabled: false, curveSegments: 20 });
    P.add('stone', slab, { r: [-Math.PI / 2, 0, 0], p: [0, 0.004, 0] });
    P.box('stone', W + 0.12, 0.008, D + 0.12, { p: [0, 0.004, 0] });
    for (const sx of [-1, 1]) {
      // low flanking curbs
      P.bevel('stone', 0.42, 0.36, D + 0.3, 0.03, { p: [sx * (W / 2 + 0.2), 0.18, 0] });
      P.bevel('stone', 0.3, 0.1, D - 0.5, 0.02, { p: [sx * (W / 2 + 0.2), 0.41, 0] });
      P.bevel('gold', 0.44, 0.02, D + 0.32, 0.005, { p: [sx * (W / 2 + 0.2), 0.3, 0] });
      P.box('gold', 0.02, 0.006, D - 0.7, { p: [sx * (W / 2 + 0.2), 0.462, 0] });
    }
    // gold border lines, a rim and eight ticks around each depression, the dish itself
    for (const sz of [-1, 1]) P.bevel('gold', W - 0.2, 0.008, 0.05, 0.002, { p: [0, TOP + 0.002, sz * (D / 2 - 0.1)] });
    // border lines that always carry a little light (aT 2 = never reached by the reveal), also along the curbs
    for (const sz of [-1, 1]) P.add('chan', withT(prep(new THREE.BoxGeometry(W - 0.24, 0.004, 0.022), { p: [0, TOP + 0.007, sz * (D / 2 - 0.1)] }), 2));
    for (const sx of [-1, 1]) P.add('chan', withT(prep(new THREE.BoxGeometry(0.022, 0.004, D - 0.7), { p: [sx * (W / 2 + 0.2), 0.466, 0] }), 2));
    DISHES.forEach(([x, z]) => {
      P.add('gold', hoop(DISH_R + 0.012, TOP + 0.002, 0.026, 0.01, { seg: 40 }), { p: [x, 0, z] });
      P.add('gold', sweep([[DISH_R, TOP], [DISH_R * 0.8, 0.023], [DISH_R * 0.45, 0.014], [0, 0.012]], { seg: 40 }), { p: [x, 0, z] }, 0x8f8f8f);
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
        P.box('gold', 0.07, 0.006, 0.012, { p: [x + Math.cos(a) * (DISH_R + 0.085), TOP + 0.002, z - Math.sin(a) * (DISH_R + 0.085)], r: [0, a, 0] });
      }
    });

    // channels: each depression sends a line forward; angular jogs gather them into a collector, a node, and
    // three lines that open toward the far edge
    const lines: Array<Array<[number, number]>> = [];
    DISHES.forEach(([x, z], k) => {
      const start = z + DISH_R + 0.03, sx = Math.sign(x), ring = Math.abs(k - 2);
      if (ring === 0) lines.push([[0, start], [0, 0.97]]);
      else if (ring === 1) lines.push([[x, start], [x, 0], [sx * 0.5, Math.abs(x) - 0.5], [sx * 0.5, 0.75], [sx * 0.16, 1.09]]);
      else lines.push([[x, start], [x, 0.3], [sx * 1.3, 0.3 + Math.abs(x) - 1.3], [sx * 1.3, 1.2], [sx * (1.3 + Z1 - 1.2), Z1]]);
    });
    lines.push([[0, 1.43], [0, Z1]], [[-0.23, 1.2], [-1.3, 1.2]], [[0.23, 1.2], [1.3, 1.2]]);
    for (const pts of lines) {
      P.add('gold', strip(pts, 0.05, TOP + 0.001), undefined, 0x6a6a6a);
      P.add('chan', strip(pts, 0.032, TOP + 0.004, tOf(pts[0][1]), tOf(pts[pts.length - 1][1])));
    }

    this.channels = this.mk.fx({
      blend: 'opaque', reveal: true, body: revealBody(),
      uniforms: { uColor: uC(0xffc56b), uGain: uF(2.4), uReveal: uF(0), uHead: uF(1.4), uDim: uF(0.16) },
    });
    const chan = new THREE.Mesh(P.geometry('chan'), this.channels);
    chan.name = 'channels';

    // light pooled in the depressions (instance colour r = fill level)
    const dishMat = this.mk.fx({
      uniforms: { uColor: uC(PALETTE.goldLight), uGain: uF(2.1) },
      body: /* glsl */ `
	float r = length( vUv * 2.0 - 1.0 );
	float f = vICol.r;
	float pool = ( 1.0 - smoothstep( f * 0.5, f * 1.02 + 0.001, r ) ) * f;
	float ring = fxLine( r - 0.93, 0.035 ) * ( 0.14 + 0.86 * f );
	float shimmer = 0.9 + 0.1 * sin( uTime * 3.0 + r * 9.0 );
	alpha = clamp( pool * shimmer + ring * 0.6, 0.0, 1.0 ) * ( 1.0 - smoothstep( 0.96, 1.0, r ) );
	col = uColor * uGain;
`,
    });
    const disc = new THREE.CircleGeometry(DISH_R * 0.97, 40);
    disc.rotateX(-Math.PI / 2);
    this.dishes = new THREE.InstancedMesh(disc, dishMat, 5);
    this.dishes.name = 'dishes';
    this.dishes.renderOrder = 2;
    DISHES.forEach(([x, z], k) => {
      this.dishes.setMatrixAt(k, TMP.m.makeTranslation(x, TOP + 0.0015, z));
      this.dishes.setColorAt(k, TMP.c.setRGB(0, 0, 0));
      this.addSocket(`depression${k}`, x, TOP, z, Math.PI);
    });

    // convergence node: the brightest element once the pattern is open
    this.node = this.mk.glow(0xfff0d0, 0);
    const nodeGeo = new THREE.CylinderGeometry(0.17, 0.17, 0.012, 4);
    nodeGeo.translate(0, TOP + 0.008, 1.2);
    const node = new THREE.Mesh(nodeGeo, this.node.material);
    node.name = 'node';
    P.add('gold', new THREE.CylinderGeometry(0.235, 0.235, 0.008, 4), { p: [0, TOP + 0.003, 1.2] });

    this.object.add(P.mesh('stone', this.mk.solid('blackStone')), P.mesh('gold', this.mk.solid('goldTrim')), this.dishes, chan, node);
    this.addSocket('approach', 0, 0, -D / 2 - 0.9, Math.PI);
    this.addSocket('center', 0, TOP, 0, Math.PI);
    this.addSocket('beyond', 0, 0, D / 2 + 0.9, Math.PI);
    for (const sx of [-1, 1]) this.addCollider({ kind: 'box', hx: 0.21, hy: 0.23, hz: D / 2 + 0.15 }, sx * (W / 2 + 0.2), 0.23, 0);
    this.ready();
  }

  protected apply(_dt: number, _time: number): void {
    const r = clamp01(this.cur.recognized);
    for (let k = 0; k < 5; k++) {
      // each depression fills over a short window, the next one starting before the last has finished
      const f = clamp01((r - k * 0.1) / 0.16);
      this.dishes.setColorAt(k, TMP.c.setRGB(f * f * (3 - 2 * f), 0, 0));
    }
    if (this.dishes.instanceColor) this.dishes.instanceColor.needsUpdate = true;
    const open = clamp01((r - 0.56) / 0.4);
    this.channels.uniforms.uReveal.value = open * 1.001;
    this.node.set(5.2 * clamp01((open - tOf(1.05)) / 0.12));
  }
}
