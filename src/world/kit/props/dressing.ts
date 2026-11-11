/**
 * Dressing props — damage, casualties, furniture, frost and Eclipse growths.
 */
import { PALETTE } from '@/core/api/materials';
import type { V3 } from '../geo';
import type { PropTable } from './types';

export const DRESSING_PROPS: PropTable = {
  /** fallback for unknown kinds */
  neutralCrate: {
    build(p) {
      p.g('goldDark').cboxOn(1, 0.8, 0.8, 0.04);
      p.g('whiteGold').box(1.02, 0.1, 0.82, 0, 0.2, 0).box(1.02, 0.1, 0.82, 0, 0.62, 0);
    },
    colliders: () => [{ box: [1, 0.8, 0.8], cover: 'low' }],
  },
  rubblePile: {
    variants: 3,
    build(p, r) {
      for (let i = 0; i < 14; i++) {
        const a = r() * Math.PI * 2, d = Math.pow(r(), 0.7) * 1.25, s = 0.25 + r() * 0.55 * (1 - d / 1.6);
        p.g(i % 4 === 0 ? 'whiteGold' : 'rubble').push().move(Math.cos(a) * d, s * 0.32 + (1 - d / 1.3) * 0.25, Math.sin(a) * d).rotY(r() * 3).rotX((r() - 0.5) * 0.8).chunk(s * 1.5, s * 0.9, s * 1.1, 0.45, r).pop();
      }
      p.g('goldTrim').push().move(0.3, 0.5, 0.1).rotZ(0.5).rotY(0.4).box(0.9, 0.05, 0.05).pop();
    },
    colliders: () => [{ cyl: [0.95, 0.75], sight: false }],
  },
  fallenPlate: {
    variants: 2,
    build(p, r) {
      p.g('whiteGoldPanel').push().move(0, 0.34, 0).rotX(0.16).rotZ(0.05).cbox(3, 0.24, 2.2, 0.04).pop();
      p.g('goldTrim').push().move(0, 0.34, 0).rotX(0.16).rotZ(0.05).box(2.8, 0.03, 0.06, 0, 0.125, -0.8).box(2.8, 0.03, 0.06, 0, 0.125, 0.8).pop();
      p.g('scorched').push().move(0, 0.34, 0).rotX(0.16).rotZ(0.05).box(0.04, 0.012, 1.7, 0.4, 0.124, 0).box(0.9, 0.012, 0.04, 0.85, 0.124, 0.3).pop();
      for (let i = 0; i < 6; i++) {
        const s = 0.2 + r() * 0.35;
        p.g('rubble').push().move((r() - 0.5) * 3, s * 0.3, (r() < 0.5 ? -1 : 1) * (1 + r() * 0.3)).rotY(r() * 3).chunk(s * 1.4, s * 0.8, s, 0.45, r).pop();
      }
    },
    colliders: () => [{ box: [3, 0.75, 2.2], sight: false }],
  },
  debrisSmall: {
    variants: 3, noReflect: true,
    build(p, r) {
      for (let i = 0; i < 9; i++) {
        const a = r() * Math.PI * 2, d = r() * 0.95, s = 0.08 + r() * 0.16;
        p.g(i % 3 === 0 ? 'whiteGold' : 'rubble').push().move(Math.cos(a) * d, s * 0.35, Math.sin(a) * d).rotY(r() * 3).rotX((r() - 0.5)).chunk(s * 1.6, s * 0.8, s, 0.5, r).pop();
      }
    },
  },
  cableBundle: {
    variants: 2, noReflect: true,
    build(p, r) {
      for (let c = 0; c < 3; c++) {
        const pts: V3[] = [];
        const ph = r() * 6, amp = 0.1 + r() * 0.12;
        for (let i = 0; i <= 10; i++) pts.push([(c - 1) * 0.07 + Math.sin(i * 0.9 + ph) * amp, 0.03 + c * 0.004, -1.6 + i * 0.32]);
        p.g('rubber').tube(pts, 0.022 + c * 0.004, 5, true);
      }
      p.g('refSteel').cboxOn(0.26, 0.09, 0.18, 0.02, 0, 0, 0.2);
    },
  },
  casualtyTarp: {
    variants: 3,
    build(p, _r, v) {
      const cloth = v === 0 ? 'domCloth' : v === 1 ? 'refCloth' : 'agedLeather';
      const g = p.g(cloth);
      // a covered human shape: head, chest, hips, legs, feet
      g.ball(0.17, 10, -0.86, 0.16, 0, 0.15).ball(0.34, 10, -0.42, 0.14, 0, 0.2).ball(0.3, 10, 0.05, 0.12, 0, 0.16);
      g.ball(0.26, 10, 0.5, 0.1, 0, 0.12).ball(0.17, 8, 0.92, 0.12, 0, 0.14);
      g.tbox(2.2, 0.03, 0.86, 0.01);
      for (const x of [-0.5, 0.35]) p.g(v === 1 ? 'refSteel' : 'domBlack').box(0.05, 0.02, 0.7, x, 0.3 - Math.abs(x) * 0.12, 0);
    },
    colliders: () => [{ box: [2.2, 0.6, 0.86], sight: false }],
  },
  medKit: {
    variants: 2, noReflect: true,
    build(p, _r, v) {
      p.g('refSteel').cboxOn(0.5, 0.26, 0.34, 0.03);
      p.g(v === 0 ? 'refNavy' : 'domOxblood').box(0.52, 0.07, 0.36, 0, 0.14, 0);
      p.g('refSteel').box(0.2, 0.03, 0.04, 0, 0.28, 0).box(0.06, 0.08, 0.02, 0, 0.14, -0.18);
      p.g(v === 0 ? 'refBlueGlow' : 'domAmberGlow').box(0.04, 0.04, 0.012, 0.16, 0.2, -0.172);
    },
  },
  chair: {
    colliderOptIn: true,
    build(p) {
      const wood = p.g('darkWood'), lea = p.g('agedLeather');
      for (const sx of [-1, 1]) {
        wood.taperOn(0.06, 0.06, 0.05, 0.05, 0.46, sx * 0.25, 0, -0.22, true);
        wood.taperOn(0.06, 0.07, 0.045, 0.05, 1.05, sx * 0.25, 0, 0.24, false, 0, 0.07);
        wood.box(0.05, 0.05, 0.42, sx * 0.25, 0.3, 0);
        // arm rest
        wood.box(0.06, 0.04, 0.46, sx * 0.29, 0.68, 0.02).boxOn(0.045, 0.22, 0.045, sx * 0.29, 0.46, -0.18);
      }
      wood.box(0.56, 0.05, 0.52, 0, 0.44, 0);
      lea.tbox(0.5, 0.07, 0.46, 0.025, 0, 0.465, 0);
      lea.push().move(0, 0.78, 0.275).rotX(0.07).cbox(0.5, 0.5, 0.07, 0.025).pop();
      wood.push().move(0, 1.06, 0.3).rotX(0.07).box(0.56, 0.06, 0.06).pop();
      for (const sx of [-1, 1]) p.g('goldTrim').ball(0.016, 6, sx * 0.21, 0.98, 0.25);
    },
    colliders: () => [{ box: [0.6, 0.95, 0.6], sight: false }],
  },
  table: {
    build(p) {
      const wood = p.g('darkWood');
      wood.cbox(3.2, 0.09, 1.4, 0.025, 0, 0.745, 0);
      p.g(p.ctx.inlay('goldTrim')).ribbon([[-1.45, 0.792, -0.55], [1.45, 0.792, -0.55], [1.45, 0.792, 0.55], [-1.45, 0.792, 0.55]], 0.04, [0, 1, 0], true);
      for (const s of [-1, 1]) {
        wood.prismX([[-0.55, 0], [0.55, 0], [0.4, 0.1], [0.12, 0.16], [0.16, 0.62], [0.5, 0.7], [-0.5, 0.7], [-0.16, 0.62], [-0.12, 0.16], [-0.4, 0.1]], 0.12, s * 1.15);
      }
      wood.box(2.2, 0.12, 0.08, 0, 0.36, 0);
    },
    colliders: () => [{ box: [3.2, 0.8, 1.4], sight: false }],
  },
  iceFormation: {
    variants: 3,
    build(p, r) {
      const ice = p.g('frostIce');
      // polish 3: a crystal cluster — faceted prisms fanning out of a common root, big ones in the middle
      for (let i = 0; i < 7; i++) {
        const a = r() * Math.PI * 2, d = r() * 0.6, h = 0.7 + r() * 1.6 * (1 - d * 0.8), rad = 0.12 + r() * 0.16;
        ice.push().move(Math.cos(a) * d, 0, Math.sin(a) * d).rotZ((r() - 0.5) * 0.5).rotX((r() - 0.5) * 0.5)
          .crystal(rad, h * 0.68, h * 0.32, 6, r).pop();
      }
      for (let i = 0; i < 8; i++) {
        const a = r() * Math.PI * 2, d = 0.35 + r() * 0.45, h = 0.25 + r() * 0.5;
        ice.push().move(Math.cos(a) * d, 0, Math.sin(a) * d).rotY(-a).rotZ(0.35 + r() * 0.6)
          .crystal(0.05 + r() * 0.07, h * 0.6, h * 0.4, 5, r).pop();
      }
      for (let i = 0; i < 5; i++) {
        const a = r() * Math.PI * 2, d = 0.3 + r() * 0.7, s = 0.3 + r() * 0.3;
        p.g('frostRime').push().move(Math.cos(a) * d, 0.08, Math.sin(a) * d).rotY(r() * 3).chunk(s * 1.6, 0.24, s, 0.5, r).pop();
      }
    },
    colliders: () => [{ cyl: [0.75, 1.5], sight: false }],
  },
  eclipseGrowth: {
    variants: 3,
    build(p, r) {
      const tis = p.g('eclipseTissue'), vein = p.g('eclipseVein'), pod = p.g(p.ctx.emissive(PALETTE.eclipseViolet, 4));
      tis.ball(0.75, 12, 0, 0.1, 0, 0.42).ball(0.45, 10, 0.3, 0.38, -0.1, 0.4).ball(0.35, 10, -0.35, 0.3, 0.2, 0.3);
      for (let i = 0; i < 5; i++) {
        const a = r() * Math.PI * 2, lean = 0.2 + r() * 0.5, h = 0.7 + r() * 0.9;
        const base: V3 = [Math.cos(a) * 0.3, 0.25, Math.sin(a) * 0.3];
        const mid: V3 = [base[0] + Math.cos(a) * lean * 0.5, base[1] + h * 0.55, base[2] + Math.sin(a) * lean * 0.5];
        const tip: V3 = [base[0] + Math.cos(a) * lean * 1.3, base[1] + h, base[2] + Math.sin(a) * lean * 1.3];
        tis.tube([base, mid, tip], 0.07, 6, true);
        vein.tube([[base[0], base[1], base[2] + 0.05], [mid[0], mid[1], mid[2] + 0.06], tip], 0.022, 4);
        if (i % 2 === 0) pod.ball(0.07, 8, tip[0], tip[1], tip[2]);
      }
      for (let i = 0; i < 3; i++) {
        const a = r() * Math.PI * 2;
        p.g('eclipsePlate').push().move(Math.cos(a) * 0.55, 0.3, Math.sin(a) * 0.55).rotY(-a).rotZ(0.6).chunk(0.5, 0.08, 0.36, 0.4, r).pop();
      }
    },
    colliders: () => [{ cyl: [0.7, 1.2], sight: false }],
    light: () => ({ color: PALETTE.eclipseViolet, intensity: 5, distance: 5, at: [0, 1, 0] }),
  },
  wallSeam: {
    build(p) {
      // a vertical service seam set against a wall (back at +Z, facing −Z)
      const dk = p.g('goldDark');
      for (const s of [-1, 1]) dk.boxOn(0.07, 3.2, 0.1, s * 0.17, 0.2, 0.0);
      dk.box(0.41, 0.08, 0.1, 0, 3.44, 0).box(0.41, 0.08, 0.1, 0, 0.16, 0);
      p.g('blackStone').boxOn(0.27, 3.2, 0.03, 0, 0.2, 0.03);
      p.g('goldChannel').boxOn(0.05, 3.0, 0.02, 0, 0.3, 0.012);
      p.g('goldTrim').box(0.16, 0.04, 0.06, 0, 1.8, -0.02);
    },
  },
};
