/**
 * megaRibs — a nave of immense white-gold ribs: lancet arches spaced along −Z, tied by a ridge beam and purlins,
 * each rib carrying gold trim on its outer edge and a warm light seam on its inner face. Seen from interiors
 * that look out (crash site, frozen access, the Wound gallery). Two draw calls.
 *
 * Local frame: origin = floor level on the nave axis under the first rib; ribs recede toward −Z.
 */
import * as THREE from 'three';
import { mulberry32 } from '@/core/mathx';
import type { SharedUniforms } from '../shared';
import { KING } from './arch';
import { GeoBuilder, type P3 } from './geo';
import { LightCards } from './lights';
import { createScenicMaterial } from './material';

export interface MegaRibsOpts { count?: number; span?: number; height?: number; spacing?: number; seed?: number }

/** Point on a lancet arch leg: t = 0 at the springing (x = ±span/2, y = 0) → 1 at the apex. */
export function archPoint(t: number, span: number, height: number): [number, number] {
  const a = t * Math.PI * 0.5;
  return [(span / 2) * Math.pow(Math.cos(a), 0.72), height * Math.pow(Math.sin(a), 0.86)];
}

export function buildMegaRibs(shared: SharedUniforms, opts: MegaRibsOpts = {}): THREE.Object3D {
  const count = Math.max(1, Math.min(24, Math.round(opts.count ?? 7)));
  const span = Math.max(20, opts.span ?? 260);
  const height = Math.max(20, opts.height ?? 300);
  const spacing = Math.max(10, opts.spacing ?? 190);
  const rand = mulberry32((opts.seed ?? 7283) ^ 0x51b5);
  const b = new GeoBuilder();
  const cards = new LightCards();
  const SEG = 14;
  const depth0 = span * 0.085, depth1 = span * 0.03; // radial thickness at springing / apex
  const width = span * 0.05; // thickness along the nave

  for (let i = 0; i < count; i++) {
    const z = -i * spacing;
    const broken = count > 3 && i === count - 2 ? 0.62 + rand() * 0.12 : 1; // one fractured rib near the far end
    for (const s of [-1, 1]) {
      const body: Array<{ p: P3; side: P3; up: P3; w: number; d: number }> = [];
      const trim: typeof body = [];
      const stop = s > 0 ? broken : 1;
      const n = Math.max(2, Math.round(SEG * stop));
      for (let k = 0; k <= n; k++) {
        const t = (k / SEG);
        const [ax, ay] = archPoint(t, span, height);
        const [bx, by] = archPoint(Math.min(t + 0.01, 1), span, height);
        const [cx, cy] = archPoint(Math.max(t - 0.01, 0), span, height);
        let tx = bx - cx, ty = by - cy;
        const tl = Math.hypot(tx, ty) || 1;
        tx /= tl; ty /= tl;
        // outward normal of the arch curve (pointing away from the nave axis)
        const nx = ty, ny = -tx;
        const d = depth0 + (depth1 - depth0) * t;
        const up: P3 = [s * nx, ny, 0];
        body.push({ p: [s * ax, ay, z], side: [0, 0, 1], up, w: width * (1 - 0.35 * t), d });
        trim.push({ p: [s * (ax + nx * (d / 2 + d * 0.06)), ay + ny * (d / 2 + d * 0.06), z], side: [0, 0, 1], up, w: width * (1 - 0.35 * t) * 0.34, d: d * 0.12 });
        // inner-face light seam: a chain of points (reads as a strip, stays stable at any distance)
        if (k > 0 && k < n && k % 2 === 1) {
          cards.point(s * (ax - nx * (d / 2 + 0.6)), ay - ny * (d / 2 + 0.6), z, Math.max(width * 0.2, 1.6), KING.light, 3.2 + rand() * 1.6);
        }
      }
      b.paint(KING.whiteGold, 0, 0.6).sweep(body);
      b.paint(KING.gold, 0, 0.8).sweep(trim);
      // stepped springing block
      b.paint(KING.whiteGold, 0, 0.5).box(s * (span / 2 + depth0 * 0.1), depth0 * 0.3, z, depth0 * 1.9, depth0 * 0.6, width * 2.2, { top: [0.86, 0.9] });
      b.paint(KING.gold, 0, 0.7).box(s * (span / 2 + depth0 * 0.1), depth0 * 0.64, z, depth0 * 1.7, depth0 * 0.08, width * 2.05);
      cards.strip(s * (span / 2 - depth0 * 0.62), depth0 * 1.5, z, Math.max(width * 0.1, 0.8), depth0 * 1.6, KING.light, 2.8);
    }
    // keystone
    if (broken >= 1) b.paint(KING.gold, 0, 0.8).box(0, height + depth1 * 0.2, z, depth1 * 1.5, depth1 * 1.7, width * 0.9, { top: [0.5, 1] });
  }

  // ridge beam tying the apexes together down the length of the nave
  if (count > 1) {
    const len = (count - 1) * spacing;
    b.paint(KING.whiteGold, 0, 0.5).box(0, height - depth1 * 0.3, -len / 2, depth1 * 1.5, depth1 * 1.1, len);
    b.paint(KING.gold, 0, 0.75).box(0, height - depth1 * 0.9, -len / 2, depth1 * 0.5, depth1 * 0.16, len);
  }

  const group = new THREE.Group();
  group.name = 'scenic:megaRibs';
  const mesh = new THREE.Mesh(b.build(), createScenicMaterial(shared, { name: 'ScenicRibs', panel: [span * 0.09, span * 0.045], gloss: 0.4, haze: 0.8 }));
  mesh.name = 'scenic:megaRibs:structure';
  mesh.frustumCulled = false;
  const lights = cards.build(shared, { name: 'scenic:megaRibs:lights', haze: 0.8 });
  lights.frustumCulled = false;
  group.add(mesh, lights);
  group.userData.scenic = { kind: 'megaRibs', triangles: b.triangleCount, lights: cards.count };
  return group;
}
