/**
 * Observation set (Z11) — one dark physical table and six age-polished chairs, three a side. No throne, no
 * banners, nothing that lights up: wood, leather, a little worn dark gold at the feet and one inlay line.
 * Seats 0–2 are on the front (−Z) side ordered by x, seats 3–5 on the far side; each seat socket faces the table.
 *
 * Draw calls: wood, leather, metal = 3.
 */
import type { MaterialLibrary } from '@/core/api';
import { mulberry32 } from '@/core/mathx';
import { PropBase } from './base';
import { Parts, prism, type Xf } from './geo';

const TABLE_W = 3.4, TABLE_D = 1.25, TABLE_H = 0.76;
const SEAT_H = 0.46;
const CHAIR_Z = TABLE_D / 2 + 0.4;

export class ObservationSet extends PropBase<Record<string, number>> {
  constructor(lib: MaterialLibrary | null) {
    super('observationSet', lib, {});
    const rnd = mulberry32(1108);
    const P = new Parts();

    // ---- table: thick chamfered top, apron, two trestles and a stretcher ------------------------------------------
    P.bevel('wood', TABLE_W, 0.07, TABLE_D, 0.016, { p: [0, TABLE_H - 0.035, 0] });
    P.bevel('wood', TABLE_W - 0.3, 0.09, TABLE_D - 0.26, 0.012, { p: [0, TABLE_H - 0.115, 0] }, 0xb4b4b4);
    for (const sx of [-1, 1]) {
      const x = sx * 1.16;
      P.bevel('wood', 0.14, 0.09, TABLE_D - 0.16, 0.02, { p: [x, 0.045, 0] });
      P.add('wood', prism([[-0.3, 0.09], [0.3, 0.09], [0.16, 0.36], [0.2, 0.6], [-0.2, 0.6], [-0.16, 0.36]], 0.11, 0.015), { p: [x, 0, 0], r: [0, Math.PI / 2, 0] });
      P.bevel('wood', 0.16, 0.06, TABLE_D - 0.36, 0.014, { p: [x, 0.625, 0] }, 0xb4b4b4);
      for (const sz of [-1, 1]) P.bevel('metal', 0.156, 0.05, 0.07, 0.008, { p: [x, 0.03, sz * (TABLE_D / 2 - 0.115)] });
    }
    P.bevel('wood', 2.3, 0.07, 0.1, 0.014, { p: [0, 0.22, 0] }, 0xc8c8c8);
    // one inlay line around the top
    for (const sz of [-1, 1]) P.box('metal', TABLE_W - 0.2, 0.004, 0.008, { p: [0, TABLE_H + 0.0005, sz * (TABLE_D / 2 - 0.1)] });
    for (const sx of [-1, 1]) P.box('metal', 0.008, 0.004, TABLE_D - 0.2, { p: [sx * (TABLE_W / 2 - 0.1), TABLE_H + 0.0005, 0] });

    // ---- six chairs ------------------------------------------------------------------------------------------------
    let seat = 0;
    for (const side of [-1, 1]) {
      for (const cx of [-1.1, 0, 1.1]) {
        const x = cx + (rnd() - 0.5) * 0.06, z = side * (CHAIR_Z + rnd() * 0.07);
        // a chair's own front is local −Z; chairs on the front side are turned to face the table
        const yaw = (side < 0 ? Math.PI : 0) + (rnd() - 0.5) * 0.14;
        const c = Math.cos(yaw), s = Math.sin(yaw);
        const at = (lx: number, ly: number, lz: number, rx = 0, rz = 0): Xf => ({ p: [x + lx * c + lz * s, ly, z - lx * s + lz * c], r: [rx, yaw, rz] });
        const lean = 0.14;
        for (const sx of [-1, 1]) {
          P.bevel('wood', 0.05, SEAT_H - 0.03, 0.05, 0.008, at(sx * 0.225, (SEAT_H - 0.03) / 2, -0.2));
          // rear leg continues up as the back post, leaning back
          P.bevel('wood', 0.05, 1.04, 0.05, 0.008, at(sx * 0.225, 0.52, 0.215 + 0.03, lean * 0.45));
          P.bevel('wood', 0.055, 0.035, 0.42, 0.008, at(sx * 0.255, 0.68, 0.02));
          P.bevel('wood', 0.045, 0.22, 0.045, 0.008, at(sx * 0.255, 0.565, -0.17));
          P.bevel('leather', 0.06, 0.02, 0.26, 0.008, at(sx * 0.255, 0.704, 0.02), 0xdadada);
          for (const lz of [-0.2, 0.2]) P.bevel('metal', 0.056, 0.03, 0.056, 0.006, at(sx * 0.225, 0.015, lz + (lz > 0 ? 0.0 : 0)));
        }
        P.bevel('wood', 0.5, 0.05, 0.47, 0.012, at(0, SEAT_H - 0.045, 0));
        P.bevel('leather', 0.44, 0.06, 0.42, 0.024, at(0, SEAT_H, -0.005));
        P.bevel('leather', 0.4, 0.44, 0.045, 0.02, at(0, 0.79, 0.262, lean), 0xeeeeee);
        P.bevel('wood', 0.5, 0.065, 0.05, 0.012, at(0, 1.055, 0.3, lean));
        P.bevel('wood', 0.45, 0.04, 0.035, 0.008, at(0, 0.53, 0.235, lean));
        // brass studs along the back pad
        for (const sx of [-1, 1]) for (const yy of [0.62, 0.79, 0.96]) P.box('metal', 0.012, 0.012, 0.008, at(sx * 0.185, yy, 0.262 - 0.026 + (yy - 0.79) * lean, lean));
        // the sitter faces the table: world yaw π on the front side, 0 on the far side
        this.addSocket(`seat${seat++}`, x, SEAT_H + 0.04, z, side < 0 ? Math.PI : 0);
        this.addCollider({ kind: 'box', hx: 0.28, hy: 0.52, hz: 0.28 }, x, 0.52, z, yaw);
      }
    }

    this.object.add(P.mesh('wood', this.mk.solid('darkWood')), P.mesh('leather', this.mk.solid('agedLeather')), P.mesh('metal', this.mk.solid('goldDark')));
    this.addSocket('tableTop', 0, TABLE_H, 0, Math.PI);
    this.addSocket('itemA', -0.28, TABLE_H + 0.002, -0.2, Math.PI);
    this.addSocket('itemB', 0.28, TABLE_H + 0.002, 0.2, 0);
    this.addCollider({ kind: 'box', hx: TABLE_W / 2, hy: TABLE_H / 2, hz: TABLE_D / 2 }, 0, TABLE_H / 2, 0);
  }

  protected apply(): void {
    // nothing moves
  }
}
