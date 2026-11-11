/**
 * Faction equipment — temporary, modular clutter inside the ancient space.
 * Dominion: bronze / oxblood / black with amber louvres, heavy and ceremonial.
 * Reformation: navy / slate / sterile steel with blue-white diodes, modular with visible connections.
 */
import { PALETTE } from '@/core/api/materials';
import type { V3 } from '../geo';
import type { Part } from '../core';
import { COVER_LOW, coverStyle } from '../cover';
import type { PropTable } from './types';

function domCrateBox(p: Part, w: number, h: number, d: number, x = 0, y = 0, z = 0, ry = 0): void {
  const blk = p.g('domBlack').at(x, y, z, ry), brz = p.g('domBronze').at(x, y, z, ry), ox = p.g('domOxblood').at(x, y, z, ry), amb = p.g('domAmberGlow').at(x, y, z, ry);
  blk.cboxOn(w, h, d, 0.04);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) brz.boxOn(0.09, h + 0.02, 0.09, sx * (w / 2 - 0.03), 0, sz * (d / 2 - 0.03));
  brz.box(w + 0.03, 0.07, d + 0.03, 0, h * 0.22, 0).box(w + 0.03, 0.07, d + 0.03, 0, h * 0.8, 0);
  ox.tbox(w - 0.22, 0.05, d - 0.22, 0.02, 0, h - 0.01, 0);
  for (const s of [-1, 1]) {
    ox.box(w - 0.34, h * 0.4, 0.025, 0, h * 0.51, s * (d / 2 + 0.005));
    amb.box(w * 0.3, 0.07, 0.02, 0, h * 0.51, s * (d / 2 + 0.022));
  }
  brz.box(0.24, 0.05, 0.1, 0, h + 0.05, 0);
  blk.pop(); brz.pop(); ox.pop(); amb.pop();
}

function refCrateBox(p: Part, w: number, h: number, d: number, x = 0, y = 0, z = 0, ry = 0): void {
  const navy = p.g('refNavy').at(x, y, z, ry), slate = p.g('refSlate').at(x, y, z, ry), steel = p.g('refSteel').at(x, y, z, ry), blue = p.g('refBlueGlow').at(x, y, z, ry);
  navy.cboxOn(w, h, d, 0.05);
  slate.box(w - 0.2, h - 0.2, d + 0.02, 0, h / 2, 0).box(w + 0.02, h - 0.2, d - 0.2, 0, h / 2, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    steel.box(0.12, 0.12, 0.12, sx * (w / 2 - 0.04), 0.06, sz * (d / 2 - 0.04)).box(0.12, 0.12, 0.12, sx * (w / 2 - 0.04), h - 0.06, sz * (d / 2 - 0.04));
  }
  for (const s of [-1, 1]) {
    steel.box(w * 0.34, 0.04, 0.05, 0, h * 0.7, s * (d / 2 + 0.03));
    blue.box(0.05, h * 0.36, 0.02, w * 0.32, h * 0.5, s * (d / 2 + 0.014));
    slate.box(0.3, 0.16, 0.02, -w * 0.2, h * 0.36, s * (d / 2 + 0.016));
  }
  navy.pop(); slate.pop(); steel.pop(); blue.pop();
}

function stretcher(p: Part, rail: 'domBronze' | 'refSteel', cloth: 'domCloth' | 'refCloth', leg: 'domBlack' | 'refSlate'): void {
  for (const s of [-1, 1]) {
    p.g(rail).push().move(-1.15, 0.46, s * 0.33).rotZ(-Math.PI / 2).cyl(0.03, 0.03, 2.3, 6, 0, 0, 0, true, true).pop();
    for (const x of [-0.8, 0.8]) p.g(leg).boxOn(0.06, 0.44, 0.06, x, 0, s * 0.3).boxOn(0.2, 0.03, 0.12, x, 0, s * 0.3);
  }
  for (const x of [-0.8, 0.8]) p.g(rail).box(0.04, 0.04, 0.64, x, 0.3, 0);
  p.g(cloth).box(1.95, 0.035, 0.62, 0, 0.47, 0).tbox(0.5, 0.1, 0.44, 0.04, 0.68, 0.485, 0);
}

export const FACTION_PROPS: PropTable = {
  // ----------------------------------------------------------------------------------------- Dominion
  domCrate: {
    variants: 3,
    build(p, _r, v) {
      if (v === 2) { domCrateBox(p, 1.9, 0.8, 0.9); return; }
      domCrateBox(p, 1.2, 0.9, 0.9);
      if (v === 1) domCrateBox(p, 0.95, 0.7, 0.8, 0.06, 0.9, -0.02, 0.3);
    },
    colliders: (v) => [{ box: v === 2 ? [1.9, 0.8, 0.9] : [1.2, v === 1 ? 1.6 : 0.9, 0.9], cover: 'low' }],
  },
  domBarricade: {
    build(p) { coverStyle('dominion')(p, 2.4, 1, COVER_LOW); },
    colliders: () => [{ box: [2.4, COVER_LOW, 1], cover: 'low' }],
  },
  domBanner: {
    build(p) {
      const brz = p.g('domBronze'), cl = p.g('domCloth');
      p.g('domBlack').tbox(0.7, 0.14, 0.7, 0.05).tbox(0.4, 0.14, 0.4, 0.04, 0, 0.14, 0);
      brz.cyl(0.035, 0.03, 3.1, 8, 0, 0.26, 0).taperOn(0.1, 0.1, 0, 0, 0.2, 0, 3.36, 0);
      brz.push().move(-0.55, 3.1, 0).rotZ(-Math.PI / 2).cyl(0.025, 0.025, 1.1, 6, 0, 0, 0, true, true).pop();
      // plain oxblood cloth with a bronze hem — no heraldry inside the ancient space
      cl.prismZ([[-0.48, 3.06], [0.48, 3.06], [0.48, 1.25], [0, 0.95], [-0.48, 1.25]], 0.02, 0.03);
      brz.prismZ([[-0.48, 1.33], [0, 1.03], [0.48, 1.33], [0.48, 1.25], [0, 0.95], [-0.48, 1.25]], 0.026, 0.03);
      brz.box(0.98, 0.05, 0.03, 0, 2.6, 0.03);
    },
    colliders: () => [{ cyl: [0.3, 3.2], sight: false }],
  },
  domLamp: {
    build(p) {
      const brz = p.g('domBronze');
      p.g('domBlack').tbox(0.5, 0.16, 0.5, 0.05).cyl(0.05, 0.04, 1.1, 8, 0, 0.16, 0);
      brz.cyl(0.09, 0.09, 0.06, 8, 0, 0.6, 0).tbox(0.3, 0.06, 0.3, 0.02, 0, 1.24, 0).taperOn(0.34, 0.34, 0.1, 0.1, 0.12, 0, 1.64, 0);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) brz.boxOn(0.025, 0.36, 0.025, sx * 0.13, 1.29, sz * 0.13);
      p.g('domAmberGlow').boxOn(0.2, 0.32, 0.2, 0, 1.31, 0);
    },
    colliders: () => [{ cyl: [0.25, 1.7], sight: false }],
    light: () => ({ color: PALETTE.domAmber, intensity: 13, distance: 10, at: [0, 1.5, 0] }),
  },
  domAmmoCase: {
    noReflect: true,
    build(p) {
      p.g('domBlack').cboxOn(0.7, 0.3, 0.38, 0.03);
      p.g('domBronze').box(0.72, 0.04, 0.4, 0, 0.2, 0).box(0.07, 0.1, 0.03, -0.2, 0.2, -0.2).box(0.07, 0.1, 0.03, 0.2, 0.2, -0.2).box(0.3, 0.03, 0.05, 0, 0.33, 0);
      p.g('domAmberGlow').box(0.08, 0.03, 0.012, 0, 0.11, -0.196);
    },
  },
  domFieldCache: {
    build(p) {
      const blk = p.g('domBlack'), brz = p.g('domBronze');
      blk.cboxOn(2, 1.25, 1.1, 0.05);
      for (let i = 0; i < 7; i++) blk.boxOn(0.1, 1.0, 1.16, -0.84 + i * 0.28, 0.12, 0);
      brz.box(2.06, 0.1, 1.16, 0, 0.06, 0).box(2.06, 0.1, 1.16, 0, 1.2, 0);
      for (const s of [-1, 1]) brz.boxOn(0.1, 1.25, 1.17, s * 0.98, 0, 0);
      for (const s of [-1, 1]) {
        p.g('domOxblood').box(0.7, 0.8, 0.03, s * 0.42, 0.64, -0.575);
        brz.box(0.05, 0.3, 0.05, s * 0.1, 0.64, -0.6);
      }
      p.g('domAmberGlow').box(0.6, 0.06, 0.02, 0, 1.12, -0.572);
    },
    colliders: () => [{ box: [2, 1.25, 1.1], cover: 'low' }],
  },
  domStretcher: {
    build(p) { stretcher(p, 'domBronze', 'domCloth', 'domBlack'); },
    colliders: () => [{ box: [2.2, 0.62, 0.72], sight: false }],
  },
  domResonator: {
    build(p) {
      const blk = p.g('domBlack'), brz = p.g('domBronze'), ox = p.g('domOxblood'), amb = p.g('domAmberGlow');
      // stepped octagonal base with amber louvres
      blk.band(1.75, 0, 1.6, 0.3, 8, 0, 0, false).cap(0, 1.6, 0.3, 8).band(1.25, 0.3, 1.15, 0.55, 8, 0, 0, false).cap(0, 1.15, 0.55, 8);
      brz.band(1.63, 0.26, 1.63, 0.34, 8, 0, 0, false).band(1.18, 0.52, 1.18, 0.6, 8, 0, 0, false);
      for (let i = 0; i < 8; i++) {
        const a = (i + 0.5) * (Math.PI / 4);
        amb.push().rotY(-a).box(0.5, 0.07, 0.03, 0, 0.16, -1.62).pop();
      }
      // four inward-leaning pylons carrying two rings
      for (let i = 0; i < 4; i++) {
        const a = i * (Math.PI / 2) + Math.PI / 4;
        brz.push().rotY(-a).taperOn(0.34, 0.5, 0.2, 0.26, 3.5, 0, 0.3, -1.38, false, 0, 0.42).pop();
        ox.push().rotY(-a).taperOn(0.2, 0.06, 0.12, 0.06, 2.6, 0, 0.7, -1.67, true, 0, 0.33).pop();
        blk.push().rotY(-a).tbox(0.6, 0.3, 0.7, 0.06, 0, 0.3, -1.38).pop();
      }
      brz.arcBand(1.0, 1.14, 0, Math.PI * 2, 1.5, 1.64, 24, { bottom: true }).arcBand(0.84, 0.98, 0, Math.PI * 2, 3.2, 3.36, 24, { bottom: true });
      // cage bars and the resonator core
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        blk.cyl(0.025, 0.025, 2.7, 5, Math.sin(a) * 0.92, 0.55, -Math.cos(a) * 0.92);
      }
      ox.lathe([[0.42, 0.55], [0.5, 0.75], [0.3, 1.0], [0.3, 1.2]], 12);
      brz.lathe([[0.36, 1.2], [0.36, 1.32], [0.22, 1.4], [0.22, 2.5], [0.36, 2.58], [0.36, 2.7], [0.16, 3.0], [0.16, 3.3]], 12);
      for (const y of [1.55, 1.95, 2.35]) brz.arcBand(0.3, 0.44, 0, Math.PI * 2, y, y + 0.07, 14, { bottom: true });
      amb.cyl(0.235, 0.235, 1.05, 12, 0, 1.42, 0);
      p.g(p.ctx.emissive(PALETTE.domAmber, 6)).ball(0.2, 10, 0, 3.45, 0);
      // feed cables
      for (const s of [-1, 1]) p.g('rubber').tube([[s * 1.5, 0.12, 0.6], [s * 2.0, 0.05, 1.0], [s * 2.2, 0.05, 1.9]], 0.05, 6, true);
    },
    colliders: () => [{ cyl: [1.75, 3.6] }],
    light: () => ({ color: PALETTE.domAmber, intensity: 26, distance: 14, at: [0, 2.0, 0] }),
  },

  // -------------------------------------------------------------------------------------- Reformation
  refCrate: {
    variants: 3,
    build(p, _r, v) {
      refCrateBox(p, 1.1, 0.8, 0.8);
      if (v === 1) refCrateBox(p, 1.1, 0.8, 0.8, 0, 0.8, 0);
      if (v === 2) refCrateBox(p, 0.8, 0.6, 0.6, 1.02, 0, 0.06);
    },
    colliders: (v) => [{ box: v === 2 ? [1.95, 0.8, 0.8] : [1.1, v === 1 ? 1.6 : 0.8, 0.8], at: v === 2 ? [0.42, 0] : [0, 0], cover: 'low' }],
  },
  refBarricade: {
    build(p) { coverStyle('reformation')(p, 2.4, 1, COVER_LOW); },
    colliders: () => [{ box: [2.4, COVER_LOW, 1], cover: 'low' }],
  },
  refSensorMast: {
    build(p) {
      const steel = p.g('refSteel'), navy = p.g('refNavy');
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        steel.tube([[Math.sin(a) * 0.55, 0.02, -Math.cos(a) * 0.55], [0, 1.0, 0]], 0.022, 5);
        p.g('refSlate').boxOn(0.12, 0.03, 0.12, Math.sin(a) * 0.55, 0, -Math.cos(a) * 0.55);
      }
      steel.cyl(0.035, 0.028, 1.5, 8, 0, 0.95, 0).cyl(0.06, 0.06, 0.08, 8, 0, 0.95, 0);
      navy.cbox(0.34, 0.26, 0.4, 0.03, 0, 2.55, 0).box(0.1, 0.1, 0.3, 0.2, 2.6, 0.02);
      steel.push().move(0, 2.55, -0.2).rotX(-Math.PI / 2).cyl(0.1, 0.085, 0.12, 12, 0, 0, 0).pop();
      p.g(p.ctx.emissive(PALETTE.refBlue, 5)).push().move(0, 2.55, -0.325).rotX(-Math.PI / 2).cap(0, 0.07, 0, 12).pop();
      steel.cyl(0.008, 0.008, 0.6, 4, -0.1, 2.68, 0.1);
      p.g('refBlueGlow').box(0.03, 0.12, 0.012, 0.171, 2.55, -0.05);
      navy.cboxOn(0.4, 0.26, 0.3, 0.03, 0.5, 0, 0.3);
      p.g('rubber').tube([[0.4, 0.12, 0.3], [0.2, 0.04, 0.2], [0.02, 0.5, 0.03], [0, 1.0, 0.04]], 0.015, 5);
    },
    colliders: () => [{ cyl: [0.35, 2.6], sight: false }],
    light: () => ({ color: PALETTE.refBlue, intensity: 5, distance: 6, at: [0, 2.5, -0.5] }),
  },
  refLamp: {
    build(p) {
      const steel = p.g('refSteel');
      p.g('refSlate').cboxOn(0.5, 0.34, 0.4, 0.03);
      p.g('refNavy').box(0.3, 0.2, 0.02, 0, 0.18, -0.205);
      p.g('refBlueGlow').box(0.03, 0.14, 0.012, 0.19, 0.18, -0.208);
      steel.cyl(0.035, 0.03, 1.0, 8, 0, 0.34, 0).cyl(0.024, 0.02, 0.75, 8, 0, 1.3, 0).cyl(0.045, 0.045, 0.05, 8, 0, 1.3, 0);
      p.g('refNavy').cbox(0.62, 0.3, 0.1, 0.02, 0, 2.15, 0.02);
      p.g(p.ctx.emissive(0xdcefff, 5)).box(0.54, 0.22, 0.02, 0, 2.15, -0.036);
      steel.box(0.66, 0.03, 0.12, 0, 2.31, 0.02);
    },
    colliders: () => [{ cyl: [0.3, 2.3], sight: false }],
    light: () => ({ color: 0xcfe6ff, intensity: 15, distance: 11, at: [0, 2.15, -0.4] }),
  },
  refAmmoCase: {
    noReflect: true,
    build(p) {
      p.g('refNavy').cboxOn(0.7, 0.28, 0.38, 0.03);
      p.g('refSteel').box(0.06, 0.1, 0.03, -0.22, 0.2, -0.195).box(0.06, 0.1, 0.03, 0.22, 0.2, -0.195).box(0.26, 0.03, 0.04, 0, 0.3, 0);
      p.g('refSlate').box(0.3, 0.12, 0.012, 0, 0.14, -0.193);
      p.g('refBlueGlow').box(0.03, 0.08, 0.012, 0.3, 0.14, -0.194);
    },
  },
  refConsole: {
    build(p) {
      const slate = p.g('refSlate'), steel = p.g('refSteel'), navy = p.g('refNavy');
      slate.cboxOn(1.2, 0.86, 0.56, 0.04);
      navy.box(1.0, 0.5, 0.02, 0, 0.45, -0.285);
      steel.prismX([[-0.34, 0.86], [0.3, 0.86], [0.3, 1.0], [-0.34, 0.9]], 1.24, 0);
      // slanted keyboard deck + upright display
      p.g('refBlueGlow').push().move(0, 0.955, -0.02).rotX(-0.155).box(0.5, 0.012, 0.2, -0.16, 0, 0).pop();
      p.g('refNavy').push().move(0, 0.953, -0.02).rotX(-0.155).box(0.94, 0.012, 0.4, 0, 0, 0).pop();
      steel.boxOn(0.05, 0.62, 0.05, 0, 1.0, 0.24);
      navy.cbox(1.0, 0.56, 0.05, 0.02, 0, 1.72, 0.24);
      // the display: a deep blue field with brighter readout rows — below the bloom threshold, so it stays a
      // blue screen in a dark room instead of blooming to a flat white card
      p.g(p.ctx.emissive(0x173a66, 0.85)).box(0.9, 0.46, 0.012, 0, 1.72, 0.208);
      const rows = p.g(p.ctx.emissive(0x7cbcf2, 0.95));
      rows.box(0.8, 0.03, 0.004, 0, 1.9, 0.2);
      for (let i = 0; i < 5; i++) {
        const w = 0.2 + ((i * 3) % 5) * 0.09;
        rows.box(w, 0.016, 0.004, -0.38 + w / 2, 1.83 - i * 0.055, 0.2);
      }
      p.g(p.ctx.emissive(PALETTE.refBlue, 1.2)).box(0.16, 0.12, 0.004, 0.3, 1.64, 0.2);
      for (const s of [-1, 1]) steel.tube([[s * 0.62, 0.3, -0.2], [s * 0.68, 0.5, -0.2], [s * 0.68, 0.7, -0.2], [s * 0.62, 0.84, -0.2]], 0.018, 5);
      p.g('rubber').tube([[0.4, 0.1, 0.28], [0.6, 0.03, 0.6], [0.5, 0.03, 1.2]], 0.02, 5);
    },
    colliders: () => [{ box: [1.3, 1.3, 0.7] }],
    light: () => ({ color: PALETTE.refBlue, intensity: 5, distance: 5, at: [0, 1.5, -0.4] }),
  },
  refStretcher: {
    build(p) {
      stretcher(p, 'refSteel', 'refCloth', 'refSlate');
      p.g('refSteel').cyl(0.015, 0.015, 1.5, 5, -0.95, 0.46, 0.33).box(0.2, 0.02, 0.02, -0.95, 1.94, 0.33);
      p.g('refNavy').cbox(0.2, 0.15, 0.06, 0.015, -0.95, 1.5, 0.3);
      p.g('refBlueGlow').box(0.14, 0.09, 0.012, -0.95, 1.5, 0.266);
    },
    colliders: () => [{ box: [2.2, 0.62, 0.72], sight: false }],
  },
  refRecoveryPlatform: {
    build(p, r) {
      const slate = p.g('refSlate'), steel = p.g('refSteel'), navy = p.g('refNavy'), blue = p.g('refBlueGlow');
      slate.tbox(3.6, 0.36, 3.0, 0.06);
      steel.box(3.66, 0.06, 3.06, 0, 0.2, 0);
      navy.tbox(2.4, 0.08, 1.8, 0.03, 0, 0.36, 0);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        blue.box(0.5, 0.05, 0.02, sx * 1.2, 0.26, sz * 1.512);
        // clamp arms reaching in toward the fragment
        const base: V3 = [sx * 1.45, 0.36, sz * 1.15], elbow: V3 = [sx * 1.25, 1.75, sz * 0.95], tip: V3 = [sx * 0.42, 1.55, sz * 0.3];
        steel.tube([base, elbow, tip], 0.06, 6, true);
        navy.ball(0.13, 8, elbow[0], elbow[1], elbow[2]).cboxOn(0.34, 0.3, 0.34, 0.04, base[0], 0.36, base[2]);
        steel.ball(0.09, 6, tip[0], tip[1], tip[2]);
        blue.box(0.03, 0.2, 0.012, base[0], 0.56, base[2] - sz * 0.176);
      }
      // gantry + sensor heads
      for (const s of [-1, 1]) steel.boxOn(0.1, 2.5, 0.1, s * 1.7, 0.36, 0);
      steel.box(3.5, 0.1, 0.14, 0, 2.86, 0);
      for (const x of [-0.7, 0.7]) {
        navy.cbox(0.26, 0.22, 0.26, 0.03, x, 2.7, 0);
        p.g(p.ctx.emissive(PALETTE.refBlue, 5)).cap(0, 0.07, 2.585, 10, -1, x, 0);
      }
      // the recovered fragment: a shard of the ancient structure held in the field
      p.g('whiteGold').push().move(0, 1.45, 0).rotZ(0.5).rotY(0.6).chunk(0.5, 0.95, 0.4, 0.5, r).pop();
      p.g('goldTrim').push().move(0.02, 1.45, 0).rotZ(0.5).rotY(0.6).box(0.06, 0.8, 0.42, 0.12, 0, 0).pop();
      p.g(p.ctx.emissive(PALETTE.goldLight, 4)).push().move(0, 1.45, 0).rotZ(0.5).rotY(0.6).box(0.03, 0.5, 0.43, -0.1, 0.05, 0).pop();
      p.g(p.ctx.variant('hologram', { opacity: 0.16 })).band(0.72, 0.5, 0.72, 2.4, 20, 0, 0);
      for (const s of [-1, 1]) p.g('rubber').tube([[s * 1.6, 0.15, 1.3], [s * 1.9, 0.04, 1.9], [s * 1.5, 0.04, 2.6]], 0.04, 5, true);
    },
    colliders: () => [{ box: [3.6, 2.9, 3.0] }],
    light: () => ({ color: PALETTE.refBlue, intensity: 20, distance: 12, at: [0, 1.6, 0] }),
  },
  refSealedCase: {
    build(p) {
      const steel = p.g('refSteel'), navy = p.g('refNavy'), blue = p.g('refBlueGlow');
      // low cradle
      p.g('refSlate').tbox(1.0, 0.08, 0.66, 0.02);
      for (const s of [-1, 1]) p.g('refSlate').prismZ([[s * 0.44, 0.08], [s * 0.3, 0.08], [s * 0.34, 0.26], [s * 0.44, 0.3]], 0.6, 0);
      // the case: brushed steel shell, navy band, a narrow window with a cold glow inside
      steel.cbox(0.9, 0.46, 0.56, 0.05, 0, 0.5, 0);
      navy.box(0.92, 0.12, 0.58, 0, 0.5, 0);
      p.g('glass').box(0.44, 0.07, 0.012, 0, 0.62, -0.283);
      p.g(p.ctx.emissive(PALETTE.frost, 2.2)).box(0.42, 0.05, 0.012, 0, 0.62, -0.272);
      for (const x of [-0.3, 0, 0.3]) {
        steel.cbox(0.1, 0.2, 0.05, 0.015, x, 0.5, -0.295);
        blue.box(0.04, 0.05, 0.012, x, 0.5, -0.324);
      }
      steel.tube([[-0.2, 0.73, 0], [-0.2, 0.82, 0], [0.2, 0.82, 0], [0.2, 0.73, 0]], 0.018, 6);
      for (const s of [-1, 1]) navy.box(0.05, 0.5, 0.6, s * 0.36, 0.5, 0);
    },
    colliders: () => [{ box: [1.0, 0.8, 0.66], sight: false }],
    light: () => ({ color: PALETTE.frost, intensity: 2.5, distance: 3.5, at: [0, 0.7, -0.5] }),
  },
};
