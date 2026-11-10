/**
 * Spatial hologram displays, built directly in the prop's frame (front = −Z, so upright text is mirrored with
 * `dir` −1): the carrier trajectory over a schematic atrium, the five-reference diagnostic, the sensor
 * reconstruction diorama.
 */
import { clamp01, lerp, smoothstep } from '@/core/mathx';
import type { HoloCanvas, Range } from './canvas';
import { BLUE, CINDER, GOLD, PALE, type Content } from './flat';

const TAU = Math.PI * 2;

// ------------------------------------------------------------------------------------------------ trajectory

/**
 * The carrier's predicted path arcing down into a schematic atrium (rings, shaft, towers) with an impact
 * marker. Progress 0 → 0.8 flies the carrier marker toward the impact point; 0.8 → 1 lifts the predicted path
 * clear of the atrium, dissolves the impact marker and closes an "all clear" ring instead.
 */
export function trajectory(c: HoloCanvas): Content {
  const Y0 = 1.0;
  for (const [r, a] of [[0.9, 0.85], [0.55, 0.5], [0.2, 0.7]] as const) c.circle(0, Y0, 0, r, 0.012, BLUE, a, true, 48);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    c.line(Math.cos(a) * 0.9, Y0, Math.sin(a) * 0.9, Math.cos(a) * 1.0, Y0, Math.sin(a) * 1.0, 0.01, BLUE, 0.7, true);
    if (i % 2 === 0) c.line(Math.cos(a) * 0.2, Y0, Math.sin(a) * 0.2, Math.cos(a) * 0.55, Y0, Math.sin(a) * 0.55, 0.006, BLUE, 0.35, true);
  }
  c.line(0, Y0, 0, 0, Y0 + 0.4, 0, 0.012, BLUE, 0.8, true);
  // scenic towers around the rim; the tall one stands under the cleared path
  const towers: Array<[number, number]> = [[0.5, 0.22], [1.3, 0.34], [2.3, 0.18], [3.3, 0.28], [4.4, 0.2], [5.4, 0.3]];
  for (const [a, h] of towers) c.line(Math.cos(a) * 1.1, Y0, Math.sin(a) * 1.1, Math.cos(a) * 1.1, Y0 + h, Math.sin(a) * 1.1, 0.014, BLUE, 0.6, true);
  c.line(1.12, Y0, 0.3, 1.12, Y0 + 0.62, 0.3, 0.018, PALE, 0.8, true);
  c.diamond(1.12, Y0 + 0.66, 0.3, 0.025, PALE, 0.9);

  // predicted path: quadratic curves from the entry point to the impact point / over and out
  const A = [-1.75, 2.02, -0.45], B = [-0.35, 1.92, -0.1], C = [0.28, Y0, 0.08];
  const B2 = [0.25, 1.78, 0.0], C2 = [1.8, 1.66, 0.42];
  const pt = (s: number, lift: number, out: number[]): void => {
    for (let k = 0; k < 3; k++) {
      const b = lerp(B[k], B2[k], lift), e = lerp(C[k], C2[k], lift);
      out[k] = (1 - s) * (1 - s) * A[k] + 2 * s * (1 - s) * b + s * s * e;
    }
  };
  const SEG = 36;
  const p0 = [0, 0, 0], p1 = [0, 0, 0];
  const path: number[] = [];
  for (let i = 0; i < SEG; i++) path.push(c.line(0, 0, 0, 0.01, 0, 0, 0.012, PALE, 1, true));
  // carrier marker: two crossed long diamonds
  const cf = c.count;
  c.quad([-0.1, 0, 0, 0, -0.035, 0, 0.1, 0, 0, 0, 0.035, 0], PALE, 1);
  c.quad([-0.1, 0, 0, 0, 0, -0.035, 0.1, 0, 0, 0, 0, 0.035], PALE, 1);
  const carrier: Range = [cf, 2];
  // impact marker: three ripple rings, a diamond and a cross on the floor, a drop line
  const ripples = [0.09, 0.16, 0.23].map((r) => c.circle(C[0], Y0 + 0.004, C[2], r, 0.012, CINDER, 1, true, 24));
  const mf = c.count;
  c.diamond(C[0], Y0 + 0.006, C[2], 0.05, CINDER, 1, true);
  c.line(C[0] - 0.3, Y0 + 0.006, C[2], C[0] + 0.3, Y0 + 0.006, C[2], 0.008, CINDER, 0.8, true);
  c.line(C[0], Y0 + 0.006, C[2] - 0.3, C[0], Y0 + 0.006, C[2] + 0.3, 0.008, CINDER, 0.8, true);
  const impact: Range = [mf, c.count - mf];
  const clear = c.circle(C[0], Y0 + 0.004, C[2], 0.2, 0.014, PALE, 1, true, 28, 0.5, TAU - 0.5);
  const label = c.text('IMPACT 01:31', 0.95, 2.24, 0.016, PALE, 0.95, 0.3, -1, 16);
  c.rect(0.55, 2.19, 0.82, 0.004, PALE, 0.5, 0.3);
  return {
    update(p, time) {
      const lift = smoothstep(0.8, 1, p);
      const s = Math.min(p / 0.8, 1) * 0.62 + 0.38 * lift;
      for (let i = 0; i < SEG; i++) {
        pt(i / SEG, lift, p0);
        pt((i + 1) / SEG, lift, p1);
        c.setLine(path[i], p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], 0.012, true);
        // flown part solid, prediction dashed
        const a = (i + 0.5) / SEG <= s ? 1 : i % 2 === 0 ? 0.6 : 0.1;
        c.setAlpha(path[i], a);
        c.setAlpha(path[i] + 1, a);
      }
      pt(s, lift, p0);
      c.offset(carrier, p0[0], p0[1], p0[2]);
      const danger = 1 - lift;
      for (let k = 0; k < 3; k++) c.fade(ripples[k], danger * (0.25 + 0.75 * Math.pow(Math.max(0, Math.sin(time * 4 - k * 1.1)), 2)));
      c.fade(impact, danger * (0.7 + 0.3 * Math.sin(time * 8)));
      c.fade(clear, lift);
    },
    setText(text) {
      label.set(text.slice(0, 16));
    },
  };
}

// ------------------------------------------------------------------------------------------------ diagnostic

/**
 * Five reference nodes on a ring. Four are active and visibly off balance (uneven radius, brightness and a
 * tilted balance needle); the fifth is a dark outline. Progress settles the four, lights the fifth, closes the
 * pentagon and pentagram and levels the needle: 4/5 → 5/5.
 */
export function diagnostic(c: HoloCanvas): Content {
  const CY = 1.55, R = 0.58;
  c.circle(0, CY, 0, 0.84, 0.006, GOLD, 0.45, false, 64);
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * TAU, r1 = i % 5 === 0 ? 0.8 : 0.82;
    c.line(Math.cos(a) * r1, CY + Math.sin(a) * r1, 0, Math.cos(a) * 0.84, CY + Math.sin(a) * 0.84, 0, 0.005, GOLD, 0.5);
  }
  const ang = (i: number): number => Math.PI / 2 + (i / 5) * TAU;
  const OFF = [0, 0.15, -0.12, 0.09, -0.17], LEVEL = [0, 1, 0.4, 0.8, 0.3], RATE = [0, 1.9, 2.7, 1.3, 3.1];
  const nodes: Array<{ ring: Range; core: number; spoke: number }> = [];
  for (let i = 0; i < 5; i++) {
    const x = Math.cos(ang(i)) * R, y = CY + Math.sin(ang(i)) * R;
    const ring = c.circle(x, y, 0, 0.085, 0.009, GOLD, 1, false, 18);
    const core = c.diamond(x, y, 0, 0.045, PALE, 1);
    const spoke = c.line(0, CY, 0, x, y, 0, 0.007, GOLD, 0.8);
    nodes.push({ ring: [ring[0], ring[1] + 1], core, spoke });
  }
  const edges = [0, 1, 2, 3, 4].map(() => c.line(0, 0, 0, 0.01, 0, 0, 0.007, GOLD, 0.9));
  const stars = [0, 1, 2, 3, 4].map(() => c.line(0, 0, 0, 0.01, 0, 0, 0.004, GOLD, 0.6));
  // balance needle over a fixed reference bar
  c.circle(0, CY, 0, 0.1, 0.006, GOLD, 0.8, false, 24);
  c.rect(0, CY - 0.99, 0.5, 0.004, GOLD, 0.5);
  for (const sx of [-1, 1]) c.rect(sx * 0.25, CY - 0.99, 0.004, 0.04, GOLD, 0.6);
  const needle = c.line(-0.25, CY - 0.99, 0, 0.25, CY - 0.99, 0, 0.01, PALE, 1);
  const header = c.text('MERIDIAN CONTINUITY', 0.84, CY + 0.98, 0.012, GOLD, 0.85, 0, -1, 22);
  const tally = c.text('4/5', 0.165, CY - 1.17, 0.03, PALE, 1, 0, -1, 3);
  const nx = [0, 0, 0, 0, 0], ny = [0, 0, 0, 0, 0];
  let five = false;
  return {
    update(p, time) {
      const settle = smoothstep(0.1, 0.72, p), fifth = smoothstep(0.6, 0.86, p);
      for (let i = 0; i < 5; i++) {
        const wobble = 0.016 * Math.sin(time * RATE[i]) * (1 - settle);
        const r = R + OFF[i] * (1 - settle) + wobble;
        nx[i] = Math.cos(ang(i)) * r;
        ny[i] = CY + Math.sin(ang(i)) * r;
        const n = nodes[i];
        c.offset(n.ring, nx[i] - Math.cos(ang(i)) * R, ny[i] - CY - Math.sin(ang(i)) * R, 0);
        const level = i === 0 ? fifth : lerp(LEVEL[i], 1, settle) * (1 - 0.25 * (1 - settle) * Math.abs(Math.sin(time * RATE[i] * 1.7)));
        // the dark fifth node keeps a faint outline so its absence is visible
        for (let k = 0; k < n.ring[1] - 1; k++) c.setAlpha(n.ring[0] + k, i === 0 ? 0.16 + 0.84 * fifth : 0.35 + 0.65 * level);
        c.setAlpha(n.core, level);
        c.setLine(n.spoke, Math.cos(ang(i)) * 0.1, CY + Math.sin(ang(i)) * 0.1, 0, nx[i] - Math.cos(ang(i)) * 0.085, ny[i] - Math.sin(ang(i)) * 0.085, 0, 0.007);
        c.setAlpha(n.spoke, i === 0 ? 0.1 + 0.9 * fifth : 0.3 + 0.7 * level);
      }
      for (let i = 0; i < 5; i++) {
        const j = (i + 1) % 5, k = (i + 2) % 5;
        c.setLine(edges[i], nx[i], ny[i], 0, nx[j], ny[j], 0, 0.007);
        // edges that touch the fifth node only exist once it is lit
        c.setAlpha(edges[i], i === 0 || j === 0 ? fifth : 0.35 + 0.65 * settle);
        c.setLine(stars[i], nx[i], ny[i], 0, nx[k], ny[k], 0, 0.004);
        c.setAlpha(stars[i], fifth * smoothstep(0.8, 1, p));
      }
      const tilt = 0.32 * (1 - settle) * (1 + 0.25 * Math.sin(time * 1.4)) + 0.1 * (1 - fifth);
      c.setLine(needle, -0.25 * Math.cos(tilt), CY - 0.99 - 0.25 * Math.sin(tilt), 0, 0.25 * Math.cos(tilt), CY - 0.99 + 0.25 * Math.sin(tilt), 0, 0.01);
      const now = fifth > 0.5;
      if (now !== five) {
        five = now;
        tally.set(now ? '5/5' : '4/5');
      }
    },
    setText(text) {
      header.set(text.slice(0, 22));
    },
  };
}

// ------------------------------------------------------------------------------------------------ sensor reconstruction

/**
 * A tabletop reconstruction: floor grid, two scan emitters sweeping fans of light, four ghost figures walking
 * their recorded routes with breadcrumb trails. A figure caught in a fan flashes and gets a detection ring.
 */
export function sensorReconstruction(c: HoloCanvas): Content {
  const Y0 = 0.95, GX = 1.2, GZ = 0.8;
  for (let i = 0; i <= 6; i++) {
    const x = -GX + (i * 2 * GX) / 6, edge = i === 0 || i === 6;
    c.line(x, Y0, -GZ, x, Y0, GZ, edge ? 0.01 : 0.005, BLUE, edge ? 0.8 : 0.3, true);
  }
  for (let i = 0; i <= 4; i++) {
    const z = -GZ + (i * 2 * GZ) / 4, edge = i === 0 || i === 4;
    c.line(-GX, Y0, z, GX, Y0, z, edge ? 0.01 : 0.005, BLUE, edge ? 0.8 : 0.3, true);
  }
  const header = c.text('SENSOR RECONSTRUCTION', 1.2, Y0 + 0.98, 0.012, BLUE, 0.85, GZ, -1, 22);
  c.rect(0.7, Y0 + 0.93, 1.0, 0.004, BLUE, 0.5, GZ);
  // emitters: a post, a head, a fan of seven rays
  const RAYS = 7, REACH = 1.05, SPREAD = 0.5;
  const emitters = [{ x: -0.95, z: 0.55, aim: -0.55, phase: 0 }, { x: 0.8, z: -0.55, aim: 2.5, phase: 1.9 }].map((e) => {
    c.line(e.x, Y0, e.z, e.x, Y0 + 0.34, e.z, 0.014, BLUE, 0.9, true);
    c.diamond(e.x, Y0 + 0.36, e.z, 0.03, PALE, 1);
    const rays: number[] = [];
    for (let k = 0; k < RAYS; k++) rays.push(c.line(e.x, Y0 + 0.3, e.z, e.x + 0.1, Y0, e.z, 0.006, BLUE, k === 0 || k === RAYS - 1 ? 0.9 : 0.4, true));
    return { ...e, rays, dir: 0 };
  });
  // ghost figures (1 : 6): crossed body diamonds, a head, a detection ring at the feet, eight breadcrumbs
  const ROUTES: number[][][] = [
    [[-1.1, -0.6], [-0.3, -0.5], [0.2, 0.1], [1.0, 0.3]],
    [[-1.0, -0.2], [-0.2, 0.0], [0.5, 0.5], [1.1, 0.6]],
    [[1.1, -0.1], [0.4, -0.3], [-0.3, 0.3], [-0.7, 0.7]],
    [[-0.2, -0.75], [0.1, -0.2], [0.0, 0.4], [0.6, 0.7]],
  ];
  const along = (route: number[][], s: number, out: number[]): void => {
    const f = clamp01(s) * (route.length - 1), i = Math.min(route.length - 2, Math.floor(f)), t = f - i;
    out[0] = lerp(route[i][0], route[i + 1][0], t);
    out[1] = lerp(route[i][1], route[i + 1][1], t);
  };
  const q = [0, 0];
  const figures = ROUTES.map((route, n) => {
    const crumbs: number[] = [];
    for (let k = 1; k <= 8; k++) {
      along(route, k / 9, q);
      crumbs.push(c.diamond(q[0], Y0 + 0.004, q[1], 0.014, BLUE, 0.8, true));
    }
    const first = c.count;
    const h = 0.26, w = 0.05;
    c.quad([-w, Y0 + h * 0.5, 0, 0, Y0, 0, w, Y0 + h * 0.5, 0, 0, Y0 + h, 0], BLUE, 0.9);
    c.quad([0, Y0 + h * 0.5, -w, 0, Y0, 0, 0, Y0 + h * 0.5, w, 0, Y0 + h, 0], BLUE, 0.9);
    c.diamond(0, Y0 + h + 0.035, 0, 0.028, PALE, 0.9);
    const body: Range = [first, 3];
    const ring = c.circle(0, Y0 + 0.005, 0, 0.09, 0.01, PALE, 1, true, 16);
    return { route, crumbs, body, ring, delay: n * 0.07, hit: 0 };
  });
  return {
    update(p, time) {
      for (const e of emitters) {
        e.dir = e.aim + 0.55 * Math.sin(time * 0.8 + e.phase);
        for (let k = 0; k < RAYS; k++) {
          const a = e.dir + ((k / (RAYS - 1)) * 2 - 1) * SPREAD;
          c.setLine(e.rays[k], e.x, Y0 + 0.3, e.z, e.x + Math.cos(a) * REACH, Y0 + 0.01, e.z + Math.sin(a) * REACH, 0.006, true);
        }
      }
      for (const f of figures) {
        const s = clamp01((p * 1.2 - f.delay) / 0.9);
        along(f.route, s, q);
        c.offset(f.body, q[0], 0, q[1]);
        c.offset(f.ring, q[0], 0, q[1]);
        // caught when inside an emitter's fan
        let caught = 0;
        for (const e of emitters) {
          const dx = q[0] - e.x, dz = q[1] - e.z, d = Math.hypot(dx, dz);
          let da = Math.atan2(dz, dx) - e.dir;
          da = Math.atan2(Math.sin(da), Math.cos(da));
          if (d < REACH && Math.abs(da) < SPREAD) caught = 1;
        }
        f.hit += (caught - f.hit) * 0.25;
        c.fade(f.ring, f.hit);
        c.fade(f.body, 0.55 + 0.45 * f.hit + 0.1 * Math.sin(time * 5 + f.delay * 40));
        for (let k = 0; k < 8; k++) c.setAlpha(f.crumbs[k], (k + 1) / 9 <= s ? 1 : 0.12);
      }
    },
    setText(text) {
      header.set(text.slice(0, 22));
    },
  };
}
