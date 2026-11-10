/**
 * megaRibs — a nave of immense white-gold ribs: lancet arches spaced along −Z, tied by a ridge beam and purlins,
 * each rib a profiled section with a recessed channel on its inner face that carries a continuous seam of warm
 * light, gold fillets either side of it, and a stepped springing block. Seen from interiors that look out
 * (crash site, frozen access, the Wound gallery). Two draw calls.
 *
 * Local frame: origin = floor level on the nave axis under the FIRST rib; the ribs recede toward −Z.
 * Lighting is baked: the outer faces take the sky's key / fill, the inner faces are lit by their own seams.
 */
import * as THREE from 'three';
import { mulberry32 } from '@/core/mathx';
import type { SharedUniforms } from '../shared';
import { KING } from './arch';
import { GeoBuilder, type Frame, type P2, type P3 } from './geo';
import { LightCards } from './lights';
import { createScenicMaterial } from './material';
import { bag, int, num, seedOf } from './opts';

export interface MegaRibsOpts { count?: number; span?: number; height?: number; spacing?: number; seed?: number }

/** Point on a lancet arch leg: t = 0 at the springing (x = ±span/2, y = 0) → 1 at the apex. */
export function archPoint(t: number, span: number, height: number): [number, number] {
  const a = t * Math.PI * 0.5;
  return [(span / 2) * Math.pow(Math.cos(a), 0.72), height * Math.pow(Math.sin(a), 0.86)];
}

/** section across (nave axis, radial): −up = the inner face with its light channel, +up = the outer back */
const RIB: readonly P2[] = [
  [-0.5, 0.5], [-0.5, -0.2], [-0.34, -0.5], [-0.12, -0.5], [-0.12, -0.36], [0.12, -0.36], [0.12, -0.5], [0.34, -0.5], [0.5, -0.2], [0.5, 0.5],
];
const RECT: readonly P2[] = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];

export function buildMegaRibs(shared: SharedUniforms, opts?: MegaRibsOpts | null): THREE.Object3D {
  const o = bag(opts);
  const count = int(o.count, 7, 1, 24);
  const span = num(o.span, 260, 20, 2000);
  const height = num(o.height, 300, 20, 2400);
  const spacing = num(o.spacing, 190, 10, 2000);
  const rand = mulberry32(seedOf(o.seed) ^ 0x51b5);
  const b = new GeoBuilder();
  const cards = new LightCards();
  const SEG = 28;
  const depth0 = span * 0.085, depth1 = span * 0.03; // radial thickness at springing / apex
  const width = span * 0.05; // thickness along the nave

  for (let i = 0; i < count; i++) {
    const z = -i * spacing;
    const broken = count > 3 && i === count - 2 ? 0.62 + rand() * 0.12 : 1; // one fractured rib near the far end
    for (const s of [-1, 1]) {
      const stop = s > 0 ? broken : 1;
      const n = Math.max(2, Math.round(SEG * stop));
      const frames = (scaleW: number, scaleD: number, lift: number, side = 0): Frame[] => {
        const out: Frame[] = [];
        for (let k = 0; k <= n; k++) {
          const t = k / SEG;
          const [ax, ay] = archPoint(t, span, height);
          const [bx, by] = archPoint(Math.min(t + 0.004, 1), span, height);
          const [cx, cy] = archPoint(Math.max(t - 0.004, 0), span, height);
          let tx = bx - cx, ty = by - cy;
          const tl = Math.hypot(tx, ty) || 1;
          tx /= tl; ty /= tl;
          // outward normal of the arch curve (pointing away from the nave axis)
          const nx = ty, ny = -tx;
          const d = depth0 + (depth1 - depth0) * t, w = width * (1 - 0.35 * t);
          out.push({ p: [s * (ax + nx * d * lift), ay + ny * d * lift, z + side * w], side: [0, 0, 1], up: [s * nx, ny, 0], w: w * scaleW, d: d * scaleD });
        }
        return out;
      };
      b.dress(0, 1).light(0.85, 0.3).paint(KING.whiteGold, 0, 0.6).sweepProfile(frames(1, 1, 0), RIB);
      // the seam of light in the inner channel, gold fillets beside it, a gold strap on the outer back
      b.dress(0, 0).light(1, 0).paint(KING.light, 1.5).sweepProfile(frames(0.2, 0.03, -0.375), RECT, { caps: false });
      for (const e of [-1, 1]) b.paint(KING.gold, 0, 0.8).sweepProfile(frames(0.06, 0.025, -0.508, e * 0.23), RECT, { caps: false });
      b.paint(KING.gold, 0, 0.8).sweepProfile(frames(0.34, 0.06, 0.53), RECT, { caps: false });
      // glow nodes along the seam keep it alive when the rib is kilometres away
      for (let k = 2; k < n; k += 4) {
        const [ax, ay] = archPoint(k / SEG, span, height);
        cards.point(s * ax * 0.985, ay * 0.985, z, Math.max(width * 0.2, 1.6), KING.light, 2.2 + rand() * 1.2);
      }
      // stepped springing block with a gold course and a lit niche
      const bx = s * (span / 2 + depth0 * 0.1);
      b.dress(0, 1).light(0.85, 0.3).paint(KING.whiteGold, 0, 0.5).bevelBox(bx, depth0 * 0.3, z, depth0 * 2.0, depth0 * 0.6, width * 2.3, depth0 * 0.05);
      b.paint(KING.whiteGold, 0, 0.56).bevelBox(bx, depth0 * 0.78, z, depth0 * 1.7, depth0 * 0.36, width * 1.9, depth0 * 0.04);
      b.paint(KING.gold, 0, 0.7).bevelBox(bx, depth0 * 0.62, z, depth0 * 1.78, depth0 * 0.07, width * 2.0, depth0 * 0.015);
      cards.strip(s * (span / 2 - depth0 * 0.62), depth0 * 1.6, z, Math.max(width * 0.1, 0.8), depth0 * 1.6, KING.light, 2.8);
      if (stop < 1) {
        // the fracture: torn stubs of reinforcement at the broken end
        const [ax, ay] = archPoint(n / SEG, span, height);
        for (let j = 0; j < 7; j++) {
          const p0: P3 = [s * ax + (rand() - 0.5) * depth0 * 0.5, ay + (rand() - 0.5) * depth0 * 0.4, z + (rand() - 0.5) * width * 0.8];
          b.light(1, 0).paint(KING.blackDeep, 0, 1.4).tube([p0, [p0[0] - s * depth0 * (0.2 + rand() * 0.5), p0[1] + depth0 * (0.1 + rand() * 0.5), p0[2] + (rand() - 0.5) * width], [p0[0] - s * depth0 * (0.5 + rand()), p0[1] - depth0 * rand() * 0.6, p0[2] + (rand() - 0.5) * width * 2]], width * 0.025, 5);
        }
      }
    }
    // keystone
    if (broken >= 1) {
      b.dress(0, 1).light(1, 0.2).paint(KING.gold, 0, 0.8).bevelBox(0, height + depth1 * 0.1, z, depth1 * 1.5, depth1 * 1.9, width * 0.95, depth1 * 0.1);
      b.paint(KING.whiteGold, 0, 0.6).prism(0, height + depth1 * 1.05, z, height + depth1 * 3.2, depth1 * 0.4, 0, 4);
    }
  }

  // ridge beam and two purlins tying the ribs together down the length of the nave
  if (count > 1) {
    const len = (count - 1) * spacing;
    b.dress(0, 1).light(1, 0.1).paint(KING.whiteGold, 0, 0.5).box(0, height - depth1 * 0.3, -len / 2, depth1 * 1.5, depth1 * 1.1, len);
    b.paint(KING.gold, 0, 0.75).box(0, height - depth1 * 0.9, -len / 2, depth1 * 0.5, depth1 * 0.16, len);
    const [px, py] = archPoint(0.62, span, height);
    for (const s of [-1, 1]) b.paint(KING.whiteGold, 0, 0.46).box(s * px, py, -len / 2, depth1 * 0.8, depth1 * 0.8, len);
  }

  const group = new THREE.Group();
  group.name = 'scenic:megaRibs';
  const mesh = new THREE.Mesh(b.build(), createScenicMaterial(shared, {
    name: 'ScenicRibs', panel: [span * 0.09, span * 0.045], panelTone: 0.14, panelSeam: 0.3, gloss: 0.4, haze: 0.8, lamp: [0.9, 0.62, 0.34], shade: 0.6,
  }));
  mesh.name = 'scenic:megaRibs:structure';
  mesh.frustumCulled = false;
  const lights = cards.build(shared, { name: 'scenic:megaRibs:lights', haze: 0.8 });
  lights.frustumCulled = false;
  group.add(mesh, lights);
  group.userData.scenic = { kind: 'megaRibs', triangles: b.triangleCount, lights: cards.count };
  return group;
}
