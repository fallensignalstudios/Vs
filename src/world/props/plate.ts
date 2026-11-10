/**
 * Fallen plate (Z06) — a broad ancient ceiling plate (5 × 3.5 m) that came down across rubble and pins a marine
 * in the cavity under its raised front edge. `lift` raises that edge about the hinge line along the rear edge
 * (heavy spring: it overshoots a little and settles). The grips ride on the plate.
 *
 * Draw calls: plate ceramic, plate gold, rubble, broken panel fragments = 4.
 */
import * as THREE from 'three';
import type { MaterialLibrary } from '@/core/api';
import { mulberry32 } from '@/core/mathx';
import { PropBase, spring } from './base';
import { Parts, prism, rock } from './geo';

type Params = { lift: number };

const LEN = 5, DEPTH = 3.5, THICK = 0.3;
const REST = 0.14, RAISE = 0.5;
const HINGE_Y = 0.17;

export class FallenPlate extends PropBase<Params> {
  private readonly pivot = new THREE.Group();

  constructor(lib: MaterialLibrary | null) {
    super('fallenPlate', lib, { lift: 0 }, { lift: spring(4.2, 0.58) });
    const rnd = mulberry32(606);
    const P = new Parts();
    const FLAT: readonly [number, number, number] = [-Math.PI / 2, 0, 0];

    // ---- the plate, built around its hinge line (local z from 0 at the hinge to −3.5 at the grip edge) ---------
    // outline seen from above, with a broken corner and a bite out of the right edge
    const outline: Array<[number, number]> = [
      [-LEN / 2, 0], [LEN / 2, 0], [LEN / 2, 1.2], [LEN / 2 - 0.22, 1.42], [LEN / 2 - 0.05, 1.7], [LEN / 2, 1.95], [LEN / 2, DEPTH],
      [-LEN / 2 + 0.95, DEPTH], [-LEN / 2 + 0.7, DEPTH - 0.28], [-LEN / 2 + 0.3, DEPTH - 0.4], [-LEN / 2, DEPTH - 0.9],
    ];
    // prism: outline in XY, thickness along Z → laid flat with +Y(outline) toward −Z (the grip edge)
    P.add('plate', prism(outline, THICK, 0.035), { r: FLAT, p: [0, 0, 0] });
    // raised border frame and inner field on the top face
    const top = THICK / 2;
    for (const [w, d, x, z] of [[LEN - 0.5, 0.14, 0, -0.3], [LEN - 1.6, 0.14, 0.4, -DEPTH + 0.3], [0.14, DEPTH - 0.8, -LEN / 2 + 0.3, -1.55], [0.14, DEPTH - 0.6, LEN / 2 - 0.42, -1.75]] as const) {
      P.bevel('plate', w, 0.03, d, 0.008, { p: [x, top + 0.012, z] }, 0xdcdcdc);
    }
    P.bevel('plate', LEN - 1.5, 0.012, DEPTH - 1.3, 0.004, { p: [0.1, top + 0.006, -1.75] }, 0xc4c0b6);
    // dead gold channels: two long lines with angular returns and a centre mark
    for (const z of [-0.95, -2.55]) P.bevel('gold', LEN - 1.9, 0.012, 0.04, 0.003, { p: [0.1, top + 0.014, z] });
    for (const x of [-1.2, 1.4]) P.bevel('gold', 0.04, 0.012, 1.6, 0.003, { p: [x, top + 0.014, -1.75] });
    P.cyl('gold', 0.26, 0.26, 0.012, 5, { p: [0.1, top + 0.014, -1.75] }, 0xffffff, true);
    P.cyl('plate', 0.17, 0.17, 0.02, 5, { p: [0.1, top + 0.016, -1.75] }, 0xc4c0b6, true);
    // underside ribs, a cross rib, two torn conduit stubs
    for (const x of [-1.6, 0, 1.6]) P.bevel('plate', 0.2, 0.15, DEPTH - 0.5, 0.02, { p: [x, -top - 0.07, -1.75] }, 0xb8b4aa);
    P.bevel('plate', LEN - 0.6, 0.11, 0.2, 0.02, { p: [0, -top - 0.05, -2.9] }, 0xb8b4aa);
    for (const x of [-0.8, 0.9]) P.cyl('gold', 0.06, 0.06, 0.5, 8, { p: [x, -top - 0.12, -0.8], r: [Math.PI / 2 - 0.2, 0, 0.3] }, 0x8a8a8a);
    // grip slots in the front edge
    for (const x of [-0.9, 0.9]) {
      P.bevel('gold', 0.42, 0.16, 0.05, 0.012, { p: [x, 0, -DEPTH - 0.012] });
      P.box('plate', 0.3, 0.08, 0.04, { p: [x, 0, -DEPTH - 0.025] }, 0x2a2a2a);
    }
    const plate = P.mesh('plate', this.mk.solid('whiteGoldPanel'));
    const trim = P.mesh('gold', this.mk.solid('goldTrim'));
    this.pivot.name = 'plate';
    this.pivot.position.set(0, HINGE_Y, DEPTH / 2);
    this.pivot.add(plate, trim);

    // ---- rubble: a ridge under the hinge, shoulders on both sides, scatter in front; the cavity stays clear -----
    const pile = (x: number, y: number, z: number, s: number, flat = 0.8): void => {
      P.add('rubble', rock(Math.floor(rnd() * 1e6), flat), { p: [x, y, z], r: [rnd() * 0.6, rnd() * 6, rnd() * 0.6], s: [s * (0.8 + rnd() * 0.5), s * (0.6 + rnd() * 0.4), s * (0.8 + rnd() * 0.5)] });
    };
    for (let k = 0; k < 15; k++) pile(-3.0 + k * 0.43 + rnd() * 0.2, 0.1 + rnd() * 0.1, DEPTH / 2 + 0.1 + rnd() * 0.6, 0.3 + rnd() * 0.28);
    for (let k = 0; k < 9; k++) pile(-2.6 + k * 0.62 + rnd() * 0.3, 0.06, DEPTH / 2 + 0.9 + rnd() * 0.7, 0.14 + rnd() * 0.16);
    for (const sx of [-1, 1]) {
      for (let k = 0; k < 9; k++) {
        const z = DEPTH / 2 - 0.3 - k * 0.36;
        const h = 0.14 + (DEPTH / 2 - z) * Math.sin(REST) * 0.8;
        pile(sx * (2.35 + rnd() * 0.45), h * 0.45, z + rnd() * 0.2, 0.2 + h * 0.55 + rnd() * 0.12);
        pile(sx * (2.95 + rnd() * 0.6), 0.12, z + rnd() * 0.4, 0.22 + rnd() * 0.24);
        if (k % 3 === 0) pile(sx * (3.6 + rnd() * 0.5), 0.05, z + rnd() * 0.5, 0.1 + rnd() * 0.12, 0.6);
      }
    }
    for (let k = 0; k < 14; k++) pile((rnd() - 0.5) * 6.6, 0.04, -DEPTH / 2 - 0.3 - rnd() * 1.2, 0.07 + rnd() * 0.12, 0.6);
    for (let k = 0; k < 5; k++) pile(-1.4 + rnd() * 2.6, 0.05, DEPTH / 2 - 0.5 - rnd() * 0.7, 0.12 + rnd() * 0.12);
    // broken ceiling panels lying about
    const shard = (pts: Array<[number, number]>, x: number, y: number, z: number, rx: number, ry: number, rz: number): void => {
      P.add('frag', prism(pts, 0.16, 0.02), { r: FLAT });
      const g = new THREE.Group();
      g.position.set(x, y, z);
      g.rotation.set(rx, ry, rz);
      g.updateMatrix();
      P.xform('frag', g.matrix);
    };
    shard([[-0.7, -0.5], [0.6, -0.55], [0.8, 0.1], [0.2, 0.6], [-0.6, 0.4]], 3.25, 0.34, -0.9, 0.5, 0.5, -0.5);
    shard([[-0.5, -0.4], [0.5, -0.3], [0.35, 0.45], [-0.3, 0.5]], -3.2, 0.17, -1.9, 0.12, 1.1, 0.1);
    shard([[-0.9, -0.3], [0.8, -0.4], [0.9, 0.3], [-0.2, 0.5], [-0.8, 0.2]], -1.2, 0.1, DEPTH / 2 + 1.05, -0.1, 0.3, 0.06);
    shard([[-0.35, -0.3], [0.4, -0.25], [0.3, 0.3], [-0.3, 0.2]], 2.0, 0.09, -DEPTH / 2 - 1.1, 0.08, 2.2, 0.05);
    this.object.add(this.pivot, P.mesh('rubble', this.mk.solid('rubble')), P.mesh('frag', this.mk.solid('whiteGoldPanel')));

    // the lifter stands at the front edge facing the plate; right hand toward −X
    this.addSocket('gripR', -0.9, -0.04, -DEPTH, Math.PI, this.pivot);
    this.addSocket('gripL', 0.9, -0.04, -DEPTH, Math.PI, this.pivot);
    this.addSocket('stand', 0, 0, -DEPTH / 2 - 0.55, Math.PI);
    this.addSocket('marine', 0.3, 0.04, -0.75, 0);
    this.addCollider({ kind: 'box', hx: 2.8, hy: 0.55, hz: 2.05 }, 0, 0.55, 0.1);
    this.ready();
  }

  /** current tilt of the plate in radians (0.14 at rest … 0.64 fully lifted) */
  get tilt(): number {
    return this.pivot.rotation.x;
  }

  protected apply(_dt: number, _time: number): void {
    this.pivot.rotation.x = REST + RAISE * Math.max(-0.05, this.cur.lift);
  }
}
