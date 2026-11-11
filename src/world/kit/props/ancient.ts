/**
 * Ancient terminal furniture — white-gold ceramic, gold trim, light that reads as information. Human interaction
 * points stay small inside vast machinery; story beats happen at the last five (fire control, recovery panel,
 * control ring, manual shutter) so they carry more authored detail.
 */
import { PALETTE } from '@/core/api/materials';
import type { V3 } from '../geo';
import { bx, bz } from '../geo';
import type { Part } from '../core';
import type { PropTable } from './types';

/** Lectern-style console head: a slanted slab with a lit reading surface, front edge at −Z. */
function lectern(p: Part, w: number, x = 0, y = 0.95, z = 0, ry = 0): void {
  const wg = p.g(p.ctx.agedStone()).at(x, y, z, ry), trim = p.g('goldTrim').at(x, y, z, ry), lit = p.g(p.ctx.seam()).at(x, y, z, ry);
  wg.prismX([[-0.36, 0], [0.3, 0], [0.3, 0.3], [-0.36, 0.1]], w, 0);
  trim.prismX([[-0.375, 0.07], [-0.36, 0.1], [0.3, 0.3], [0.315, 0.3], [0.315, 0.27], [-0.375, 0.04]], w + 0.04, 0);
  const tilt = Math.atan2(0.2, 0.66);
  lit.push().move(0, 0.203, -0.03).rotX(-tilt).box(w - 0.22, 0.012, 0.42, 0, 0, 0).pop();
  wg.pop(); trim.pop(); lit.pop();
}

export const ANCIENT_PROPS: PropTable = {
  ancientConsole: {
    build(p) {
      const wg = p.g(p.ctx.agedStone()), trim = p.g('goldTrim'), dk = p.g('goldDark');
      dk.tbox(0.99, 0.05, 0.76, 0.02);
      wg.tbox(0.95, 0.18, 0.72, 0.04, 0, 0.03, 0).taperOn(0.62, 0.46, 0.42, 0.32, 0.74, 0, 0.21, 0.02, true);
      trim.box(0.66, 0.035, 0.5, 0, 0.22, 0.02).box(0.46, 0.035, 0.36, 0, 0.92, 0.02);
      // a dark recessed panel on the front of the stem, framed in gold
      dk.push().move(0, 0.56, -0.184).rotX(0.094).box(0.36, 0.42, 0.02, 0, 0, 0).pop();
      trim.push().move(0, 0.56, -0.19).rotX(0.094).box(0.4, 0.022, 0.02, 0, 0.22, 0).box(0.4, 0.022, 0.02, 0, -0.22, 0).pop();
      for (const s of [-1, 1]) p.g(p.ctx.channel()).ribbon([[s * 0.292, 0.3, 0.02], [s * 0.222, 0.86, 0.02]], 0.05, [s, 0.12, 0]);
      lectern(p, 0.92);
    },
    colliders: () => [{ box: [0.95, 1.25, 0.72], sight: false }],
    // a reading light over the lectern, aimed at its face (a point light at head height flattened the reader)
    light: () => ({ color: PALETTE.goldLight, intensity: 6, distance: 5, at: [0, 1.95, -0.55], target: [0, 0.95, 0], angleDeg: 40 }),
  },
  ancientPedestal: {
    build(p) {
      p.g(p.ctx.agedStone()).lathe([[0.72, 0], [0.72, 0.14], [0.6, 0.2], [0.5, 0.28], [0.44, 0.86], [0.56, 0.94], [0.56, 1.04], [0, 1.04]], 16);
      p.g('goldTrim').band(0.515, 0.26, 0.5, 0.32, 16).band(0.575, 0.93, 0.575, 0.97, 16);
      p.g(p.ctx.channel()).cap(0.36, 0.42, 1.046, 20);
      p.g(p.ctx.inlay('goldDark')).cap(0, 0.3, 1.045, 16);
    },
    colliders: () => [{ cyl: [0.6, 1.04], sight: false }],
  },
  ancientPylon: {
    build(p) {
      const wg = p.g(p.ctx.agedStone());
      wg.tbox(0.7, 0.24, 0.7, 0.05).taperOn(0.48, 0.48, 0.34, 0.34, 1.75, 0, 0.24, 0, true);
      p.g('goldTrim').boxOn(0.52, 0.04, 0.52, 0, 0.24, 0).boxOn(0.4, 0.05, 0.4, 0, 1.99, 0).taperOn(0.4, 0.4, 0.12, 0.12, 0.16, 0, 2.38, 0);
      p.g('whiteLight').boxOn(0.3, 0.34, 0.3, 0, 2.04, 0);
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2;
        p.g('goldTrim').boxOn(0.03, 0.34, 0.03, Math.sin(a + Math.PI / 4) * 0.215, 2.04, -Math.cos(a + Math.PI / 4) * 0.215);
        p.g(p.ctx.channel()).ribbon([[bx(a) * 0.235, 0.5, bz(a) * 0.235], [bx(a) * 0.178, 1.9, bz(a) * 0.178]], 0.045, [bx(a), 0.04, bz(a)]);
      }
    },
    colliders: () => [{ box: [0.6, 2.5, 0.6], sight: false }],
    light: () => ({ color: PALETTE.goldLight, intensity: 9, distance: 8, at: [0, 2.2, 0] }),
  },
  ancientBench: {
    build(p) {
      const wg = p.g(p.ctx.agedStone());
      for (const s of [-1, 1]) wg.prismZ([[s * 1.0, 0], [s * 0.62, 0], [s * 0.7, 0.36], [s * 1.0, 0.36]], 0.56, 0);
      wg.tbox(2.3, 0.12, 0.64, 0.035, 0, 0.36, 0);
      p.g('goldTrim').box(2.2, 0.03, 0.66, 0, 0.36, 0);
      p.g('goldDark').box(1.2, 0.2, 0.04, 0, 0.2, 0);
    },
    colliders: () => [{ box: [2.3, 0.55, 0.64], sight: false }],
  },
  conduitJunction: {
    build(p) {
      const dk = p.g('goldDark'), trim = p.g('goldTrim');
      p.g(p.ctx.agedStone()).tbox(1.05, 0.14, 1.05, 0.04);
      dk.cboxOn(0.8, 0.52, 0.8, 0.06, 0, 0.14, 0);
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2;
        trim.push().rotY(-a).move(0, 0.38, -0.4).rotX(-Math.PI / 2).cyl(0.09, 0.09, 0.26, 8, 0, 0, 0).cyl(0.12, 0.12, 0.05, 8, 0, 0.2, 0).pop();
      }
      const ch = p.g(p.ctx.channel());
      ch.ribbon([[-0.3, 0.666, 0], [0.3, 0.666, 0]], 0.05).ribbon([[0, 0.666, -0.3], [0, 0.666, 0.3]], 0.05);
      trim.boxOn(0.84, 0.035, 0.84, 0, 0.14, 0);
    },
    colliders: () => [{ box: [1.0, 0.68, 1.0], sight: false }],
  },

  // ---- story pieces -----------------------------------------------------------------------------------
  fireControlStation: {
    build(p) {
      const trim = p.g('goldTrim'), dk = p.g('goldDark'), ch = p.g(p.ctx.channel());
      // polish 3: the station is lower-terminal work — polished black stone and gold, with only the lectern heads in
      // pale aged stone — so it models under its spot instead of reading as a stack of white blocks in a dark room
      const stone = p.g('blackStone');
      // dais: a dark bronze toe, the black slab with a gold edge and an inlaid border
      dk.tbox(3.26, 0.05, 2.26, 0.015);
      stone.tbox(3.2, 0.16, 2.2, 0.04);
      trim.box(3.21, 0.02, 2.21, 0, 0.115, 0);
      ch.ribbon([[-1.4, 0.167, -0.9], [1.4, 0.167, -0.9], [1.4, 0.167, 0.9], [-1.4, 0.167, 0.9]], 0.05, [0, 1, 0], true);
      // three-part console: centre desk and two wings turned toward the operator (who stands at +Z, facing −Z)
      for (const [x, ry, w] of [[0, 0, 1.2], [-1.05, 0.45, 0.95], [1.05, -0.45, 0.95]] as const) {
        const z = x === 0 ? -0.5 : -0.3;
        stone.push().move(x, 0.16, z).rotY(ry).taperOn(w * 0.8, 0.5, w * 0.7, 0.36, 0.8, 0, 0, 0, true).pop();
        trim.push().move(x, 0.16, z).rotY(ry).box(w * 0.72, 0.035, 0.38, 0, 0.78, 0).box(w * 0.82, 0.03, 0.52, 0, 0.03, 0)
          // a gold frame on the operator's face of the desk
          .box(w * 0.6, 0.02, 0.02, 0, 0.62, 0.2).box(w * 0.6, 0.02, 0.02, 0, 0.2, 0.236).pop();
        lectern(p, w, x, 0.96, z, ry + Math.PI);
      }
      // flanking pylons with channel lights: dark stone obelisks on a stepped foot, gold collars and dark inlays
      for (const s of [-1, 1]) {
        dk.tbox(0.52, 0.12, 0.52, 0.03, s * 1.42, 0.16, -0.85);
        stone.taperOn(0.4, 0.4, 0.28, 0.28, 2.1, s * 1.42, 0.16, -0.85, true);
        trim.taperOn(0.32, 0.32, 0.1, 0.1, 0.2, s * 1.42, 2.26, -0.85);
        for (const [y, k] of [[0.95, 0.375], [1.75, 0.322]] as const) trim.box(k + 0.035, 0.05, k + 0.035, s * 1.42, y, -0.85);
        for (const f of [-1, 1]) {
          // side faces: a narrow dark inlay down the middle of each
          dk.push().move(s * 1.42 + f * 0.17, 1.15, -0.85).rotZ(f * 0.03).box(0.012, 1.5, 0.08, 0, 0, 0).pop();
        }
        ch.ribbon([[s * 1.42, 0.5, -0.648], [s * 1.42, 2.1, -0.708]], 0.05, [0, 0.04, 1]);
      }
      // the sighting ring the shot is laid through
      dk.boxOn(0.12, 1.1, 0.12, 0, 0.16, -0.95);
      trim.push().move(0, 1.86, -0.95).rotX(Math.PI / 2).arcBand(0.5, 0.6, 0, Math.PI * 2, -0.04, 0.04, 28, { bottom: true }).pop();
      p.g('whiteLight').push().move(0, 1.86, -0.95).rotX(Math.PI / 2).arcBand(0.47, 0.5, 0, Math.PI * 2, -0.02, 0.02, 28, { bottom: true }).pop();
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2 + Math.PI / 4;
        trim.box(0.03, 0.2, 0.03, Math.sin(a) * 0.38, 1.86 + Math.cos(a) * 0.38, -0.95);
      }
      // the firing key: a physical block the hand closes on
      dk.cboxOn(0.3, 0.16, 0.2, 0.03, 0, 1.22, -0.2);
      p.g(p.ctx.emissive(0xffb060, 4)).box(0.2, 0.03, 0.1, 0, 1.39, -0.2);
    },
    colliders: () => [{ box: [3.0, 1.35, 1.0], at: [0, -0.45] }, { cyl: [0.25, 2.4], at: [-1.42, -0.85], sight: false }, { cyl: [0.25, 2.4], at: [1.42, -0.85], sight: false }],
    // from above and behind the operator, down onto the three consoles: the desks get a pool of light with real
    // falloff instead of a point light sitting a few decimetres off their white faces
    light: () => ({ color: PALETTE.goldLight, intensity: 11, distance: 8, at: [0, 2.7, 0.9], target: [0, 0.9, -0.5], angleDeg: 42 }),
  },
  recoveryPanel: {
    build(p) {
      const wg = p.g(p.ctx.agedStone()), trim = p.g('goldTrim'), dk = p.g('goldDark');
      wg.tbox(2.3, 0.2, 0.7, 0.04).cboxOn(2.1, 2.0, 0.4, 0.05, 0, 0.2, 0.05);
      trim.box(2.14, 0.04, 0.44, 0, 0.3, 0.05).box(2.14, 0.04, 0.44, 0, 2.1, 0.05);
      p.g(p.ctx.channel()).ribbon([[0, 0.5, -0.153], [0, 2.0, -0.153]], 0.05, [0, 0, -1]);
      // two bays, one per choice. Shape carries the meaning: horizontal bars (stretchers, the +X bay — west when the
      // panel faces south) | upright bars (walkers, the −X bay)
      for (const s of [-1, 1]) {
        const cx = s * 0.55;
        dk.box(0.86, 1.3, 0.04, cx, 1.2, -0.155);
        for (let i = 0; i < 3; i++) {
          if (s > 0) trim.box(0.5, 0.05, 0.03, cx, 1.58 + i * 0.13, -0.185);
          else trim.box(0.05, 0.36, 0.03, cx - 0.16 + i * 0.16, 1.7, -0.185);
        }
        p.g('whiteLight').box(0.7, 0.05, 0.02, cx, 1.98, -0.16);
        // the lever: a hinge block, an arm and a grip that a whole hand takes
        dk.cbox(0.3, 0.2, 0.16, 0.03, cx, 0.9, -0.2);
        trim.tube([[cx, 0.9, -0.26], [cx, 1.22, -0.5]], 0.035, 8, true);
        trim.push().move(cx - 0.17, 1.22, -0.5).rotZ(-Math.PI / 2).cyl(0.045, 0.045, 0.34, 8, 0, 0, 0, true, true).pop();
        p.g(p.ctx.emissive(PALETTE.goldLight, 3)).box(0.12, 0.03, 0.02, cx, 0.72, -0.18);
      }
    },
    colliders: () => [{ box: [2.3, 2.2, 0.7] }],
    // a narrow wash from above the panel down its face: it lights the bays and the hands on the levers, and the
    // operator's head (≈ 1.7 m, 0.9 m in front) stays outside the cone instead of taking the full light
    light: () => ({ color: PALETTE.goldLight, intensity: 9, distance: 5, at: [0, 2.55, -0.55], target: [0, 1.25, -0.12], angleDeg: 32 }),
  },
  controlRing: {
    build(p) {
      const wg = p.g(p.ctx.agedStone()), trim = p.g('goldTrim'), ch = p.g(p.ctx.channel());
      const A0 = (30 * Math.PI) / 180, A1 = (330 * Math.PI) / 180; // open toward the south (+Z) so one can step in
      const south = Math.PI;
      const a0 = south + A0, a1 = south + A1;
      p.g(p.ctx.inlay('goldDark')).cap(0, 1.75, 0.006, 40);
      ch.cap(1.72, 1.78, 0.008, 48);
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        ch.ribbon([[bx(a) * 0.5, 0.008, bz(a) * 0.5], [bx(a) * 1.05, 0.008, bz(a) * 1.05]], 0.045);
      }
      wg.arcBand(1.16, 1.46, a0, a1, 0.94, 1.06, 30, { bottom: true });
      trim.arcBand(1.14, 1.48, a0, a1, 1.06, 1.09, 30).arcBand(1.44, 1.48, a0, a1, 0.9, 0.94, 30, { bottom: true });
      p.g('whiteLight').arcBand(1.2, 1.3, a0 + 0.05, a1 - 0.05, 1.09, 1.096, 30);
      for (let i = 0; i <= 5; i++) {
        const a = a0 + ((a1 - a0) * i) / 5, x = bx(a) * 1.31, z = bz(a) * 1.31;
        wg.push().move(x, 0, z).rotY(-a).taperOn(0.3, 0.34, 0.2, 0.26, 0.94, 0, 0, 0, true).tbox(0.42, 0.12, 0.46, 0.03, 0, 0, 0).pop();
        trim.push().move(bx(a) * 1.31, 1.09, bz(a) * 1.31).rotY(-a).tbox(0.12, 0.07, 0.2, 0.02, 0, 0, 0).pop();
      }
    },
    colliders: () => {
      const out = [];
      for (let i = 0; i < 5; i++) {
        const a = Math.PI + ((30 + 60 * (i + 0.5)) * Math.PI) / 180;
        out.push({ box: [1.38, 1.1, 0.34] as [number, number, number], at: [bx(a) * 1.31, bz(a) * 1.31] as [number, number], ry: -a, sight: false });
      }
      return out;
    },
    light: () => ({ color: PALETTE.goldLight, intensity: 8, distance: 7, at: [0, 1.6, 0] }),
  },
  manualShutter: {
    build(p) {
      const wg = p.g(p.ctx.agedStone()), trim = p.g('goldTrim'), dk = p.g('goldDark');
      for (const s of [-1, 1]) wg.cboxOn(0.44, 3.3, 0.6, 0.05, s * 1.72, 0, 0);
      wg.cbox(3.9, 0.5, 0.66, 0.05, 0, 3.25, 0);
      trim.box(3.5, 0.04, 0.68, 0, 3.02, 0);
      // slatted shutter, shut
      for (let i = 0; i < 10; i++) {
        dk.box(3.0, 0.27, 0.07, 0, 0.16 + i * 0.3, 0.02 * (i % 2));
        trim.box(3.0, 0.02, 0.085, 0, 0.3 + i * 0.3, 0);
      }
      for (const s of [-1, 1]) dk.box(0.1, 3.0, 0.2, s * 1.47, 1.5, 0);
      // hand wheel, chain and counterweight on the right jamb (facing −Z)
      const wheel: V3 = [1.72, 1.25, -0.42];
      dk.push().move(wheel[0], wheel[1], -0.3).rotX(-Math.PI / 2).cyl(0.07, 0.07, 0.16, 8, 0, 0, 0).pop();
      trim.push().move(wheel[0], wheel[1], wheel[2]).rotX(Math.PI / 2).arcBand(0.3, 0.37, 0, Math.PI * 2, -0.03, 0.03, 20, { bottom: true }).pop();
      for (let i = 0; i < 3; i++) trim.push().move(wheel[0], wheel[1], wheel[2]).rotZ((i * Math.PI) / 3).box(0.62, 0.04, 0.04).pop();
      trim.push().move(wheel[0] + 0.33, wheel[1], wheel[2] - 0.1).rotX(-Math.PI / 2).cyl(0.03, 0.03, 0.14, 6, 0, 0, 0).pop();
      dk.cyl(0.012, 0.012, 1.5, 4, 1.92, 1.55, -0.34).cboxOn(0.16, 0.3, 0.16, 0.02, 1.92, 1.25, -0.34);
      p.g('whiteLight').box(1.2, 0.05, 0.02, 0, 3.25, -0.34);
      wg.tbox(3.9, 0.08, 0.8, 0.02);
    },
    colliders: () => [{ box: [3.9, 3.4, 0.6] }],
  },
};
