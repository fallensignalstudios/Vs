/**
 * Crownmark Five (Z10) — a human-sized black-gold star with a white core, seated in its mechanism: a stepped
 * plinth, a yoke carrying a vertical hoop, ten cradle claws that fold shut between the star's points and fine
 * light filaments that knit star, hoop and plinth together as it integrates. Never loot.
 *
 * Draw calls: stone, gold, channel light, core, claws (instanced), filaments = 6. Owns one point light.
 */
import * as THREE from 'three';
import type { CrownmarkFiveOpts, MaterialLibrary } from '@/core/api';
import { PALETTE } from '@/core/api/materials';
import { clamp01 } from '@/core/mathx';
import { PropBase, TMP, ramp, revealBody, spring, uC, uF, type Glow } from './base';
import { Parts, Soup, flatRing, hoop, prism, starAngle, starGeometry, strip, sweep, tube } from './geo';

const YC = 1.5;
const HOOP_R = 1.2;
const TIPS = [1.3, 1.0, 1.08, 1.08, 1.0] as const;
const R_IN = 0.33;
const DEPTH = 0.13;
const CLAW_OPEN = 1.25;
const UP: readonly [number, number, number] = [Math.PI / 2, 0, 0];

type Params = { glow: number; integrated: number; steady: number };

/** ADDED (polish 4): options of `crownmarkFive` (see the contract's CrownmarkFiveOpts) */
export type CrownmarkOpts = CrownmarkFiveOpts;

export class CrownmarkFive extends PropBase<Params> {
  private readonly chan: Glow;
  private readonly core: Glow;
  private readonly claws: THREE.InstancedMesh;
  private readonly filaments: THREE.ShaderMaterial;
  private readonly light: THREE.PointLight;
  private lastI = -1;
  private lightScale = 1;

  constructor(lib: MaterialLibrary | null, opts: CrownmarkOpts = {}) {
    super('crownmarkFive', lib, { glow: 0.25, integrated: 0, steady: 0 }, { glow: spring(5, 0.8), integrated: spring(3.2, 0.78), steady: spring(3, 0.9) });
    const P = new Parts();
    const v = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

    // ---- stepped plinth -----------------------------------------------------------------------------
    P.add('stone', sweep([[1.75, 0], [1.75, 0.105], [1.735, 0.12], [1.42, 0.12], [1.42, 0.225], [1.405, 0.24], [1.07, 0.24], [1.07, 0.345], [1.055, 0.36], [0, 0.36]], { seg: 72 }));
    for (const [r, y] of [[1.75, 0.055], [1.42, 0.175], [1.07, 0.295]] as const) P.add('gold', hoop(r + 0.003, y, 0.012, 0.024, { seg: 72 }));
    P.add('gold', hoop(0.66, 0.362, 0.1, 0.012, { seg: 48 }));
    P.add('chan', flatRing(0.645, 0.675, 0.371, 0, Math.PI * 2, 48));
    const pol = (r: number, a: number): [number, number] => [r * Math.cos(a), -r * Math.sin(a)];
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + Math.PI / 2, j = 0.11;
      // angular five-fold channels stepping down the plinth, plus short secondary ticks between them
      P.add('chan', strip([pol(1.715, a), pol(1.6, a), pol(1.53, a + j), pol(1.44, a + j)], 0.03, 0.123));
      P.add('chan', strip([pol(1.385, a + j), pol(1.3, a + j), pol(1.22, a), pol(1.09, a)], 0.03, 0.243));
      P.add('chan', strip([pol(1.035, a), pol(0.86, a), pol(0.8, a - j * 1.6), pol(0.69, a - j * 1.6)], 0.028, 0.363));
      const b = a + Math.PI / 5;
      P.add('chan', strip([pol(1.715, b), pol(1.62, b)], 0.022, 0.123));
      P.add('chan', strip([pol(1.385, b), pol(1.31, b)], 0.022, 0.243));
      P.box('gold', 0.09, 0.02, 0.09, { p: [pol(1.57, a + j * 0.5)[0], 0.125, pol(1.57, a + j * 0.5)[1]], r: [0, a, 0] });
    }

    // ---- yoke uprights and the vertical hoop ---------------------------------------------------------
    const upright = (): THREE.BufferGeometry => prism([[-1.6, 0.12], [-1.27, 0.12], [-1.245, 0.95], [-1.235, 1.5], [-1.25, 1.84], [-1.33, 1.9], [-1.42, 1.3]], 0.22, 0.02);
    P.add('stone', upright());
    P.add('stone', upright(), { s: [-1, 1, 1] });
    for (const sx of [-1, 1]) {
      P.bevel('gold', 0.17, 0.3, 0.26, 0.02, { p: [sx * (HOOP_R + 0.02), YC, 0] });
      P.bevel('gold', 0.25, 0.035, 0.27, 0.01, { p: [sx * 1.51, 0.14, 0] });
      P.bevel('gold', 0.11, 0.045, 0.24, 0.012, { p: [sx * 1.29, 1.885, 0], r: [0, 0, sx * 0.6] });
      // thin vertical light seam up each upright (front and back)
      for (const sz of [-1, 1]) P.box('chan', 0.024, 1.15, 0.008, { p: [sx * 1.358, 1.0, sz * 0.111], r: [0, 0, sx * 0.083] });
    }
    P.add('stone', hoop(HOOP_R, 0, 0.075, 0.13, { seg: 96 }), { r: UP, p: [0, YC, 0] });
    for (const z of [-0.056, 0.056]) P.add('gold', hoop(HOOP_R + 0.037, z, 0.014, 0.022, { seg: 96 }), { r: UP, p: [0, YC, 0] });
    P.add('chan', hoop(HOOP_R - 0.039, 0, 0.006, 0.036, { seg: 96 }), { r: UP, p: [0, YC, 0] });
    for (let k = 0; k < 60; k++) {
      // graduation ticks on both faces of the hoop
      const a = (k / 60) * Math.PI * 2, long = k % 5 === 0;
      const r = HOOP_R + (long ? 0 : 0.008);
      for (const sz of [-1, 1]) P.box('gold', long ? 0.05 : 0.026, 0.008, 0.006, { p: [Math.cos(a) * r, YC + Math.sin(a) * r, sz * 0.066], r: [0, 0, a] });
    }

    // ---- the star --------------------------------------------------------------------------------------
    // the star itself is black-gold: dark polished metal that takes a sheen from the core's light
    P.add('gold', starGeometry(TIPS, R_IN, DEPTH), { p: [0, YC, 0] }, 0x3c3840, true);
    const ridge = new Soup(), inlay = new Soup();
    for (let i = 0; i < 5; i++) {
      const at = starAngle(i), R = TIPS[i];
      const dir = v(Math.cos(at), Math.sin(at), 0), side = v(-Math.sin(at), Math.cos(at), 0);
      const tip = dir.clone().multiplyScalar(R).add(v(0, YC, 0));
      // gold edging along the ten silhouette edges, a cap on each point
      for (const s of [-1, 1]) {
        const av = at + (s * Math.PI) / 5;
        const valley = v(Math.cos(av) * R_IN, YC + Math.sin(av) * R_IN, 0);
        const mid = tip.clone().add(valley).multiplyScalar(0.5);
        P.box('gold', tip.distanceTo(valley), 0.022, 0.036, { p: [mid.x, mid.y, 0], r: [0, 0, Math.atan2(tip.y - valley.y, tip.x - valley.x)] });
      }
      P.cyl('gold', 0.004, 0.034, 0.15, 4, { p: [tip.x - dir.x * 0.055, tip.y - dir.y * 0.055, 0], r: [0, 0, at - Math.PI / 2] });
      for (const sz of [-1, 1]) {
        const n = v(0, 0, sz);
        // a point on the star's surface: `u` along the arm, `w` sideways from the ridge, lifted off the facet
        const beta = (1 - (R_IN * Math.cos(Math.PI / 5)) / R) / (R_IN * Math.sin(Math.PI / 5));
        const on = (u: number, w: number, lift: number): THREE.Vector3 =>
          v(0, YC, 0).addScaledVector(dir, u * R).addScaledVector(side, w).add(v(0, 0, sz * (DEPTH * Math.max(0, 1 - u - Math.abs(w) * beta) + lift)));
        // emissive ridge channel from the bezel toward the point, with three cross ticks that follow the facets
        ridge.quad(on(0.19, -0.013, 0.006), on(0.19, 0.013, 0.006), on(0.9, 0.006, 0.006), on(0.9, -0.006, 0.006), n);
        for (const u of [0.46, 0.62]) {
          const w = 0.06 * (1 - u);
          for (const s of [-1, 1]) ridge.quad(on(u - 0.006, 0, 0.004), on(u + 0.006, 0, 0.004), on(u + 0.03, s * w, 0.004), on(u + 0.018, s * w, 0.004), n);
        }
        // fine gold inlay lines on each facet, parallel to the silhouette
        for (const s of [-1, 1]) {
          const av = at + (s * Math.PI) / 5;
          const vd = v(Math.cos(av), Math.sin(av), 0);
          const a0 = v(0, YC, 0).addScaledVector(vd, R_IN * 0.62).add(v(0, 0, sz * (DEPTH * 0.4 + 0.002)));
          const a1 = v(0, YC, 0).addScaledVector(dir, R * 0.8).addScaledVector(side, s * 0.012).add(v(0, 0, sz * (DEPTH * 0.2 + 0.002)));
          const w = v(a1.x - a0.x, a1.y - a0.y, 0).normalize();
          const wn = v(-w.y, w.x, 0).multiplyScalar(0.006);
          inlay.quad(a0.clone().add(wn), a0.clone().sub(wn), a1.clone().sub(wn), a1.clone().add(wn), n);
        }
      }
    }
    P.add('chan', ridge.geometry());
    P.add('gold', inlay.geometry());
    for (const sz of [-1, 1]) {
      P.add('gold', new THREE.TorusGeometry(0.178, 0.02, 8, 40), { p: [0, YC, sz * 0.082] });
      P.add('gold', new THREE.TorusGeometry(0.225, 0.006, 6, 40), { p: [0, YC, sz * 0.06] });
    }
    // saddles that seat the two lower points on the plinth
    for (const i of [2, 3]) {
      const at = starAngle(i), tx = Math.cos(at) * TIPS[i], ty = YC + Math.sin(at) * TIPS[i];
      P.add('stone', prism([[tx - 0.17, 0.36], [tx + 0.17, 0.36], [tx + 0.07, ty - 0.02], [tx - 0.07, ty - 0.02]], 0.2, 0.015));
      P.cyl('gold', 0.04, 0.095, 0.17, 6, { p: [tx - Math.cos(at) * 0.05, ty - Math.sin(at) * 0.05, 0], r: [0, 0, at - Math.PI / 2] }, 0xffffff, true);
    }

    // ---- white core ------------------------------------------------------------------------------------
    this.core = this.mk.glow(0xfff6e6, 1);
    const coreMesh = new THREE.Mesh(new THREE.SphereGeometry(0.152, 28, 18), this.core.material);
    coreMesh.name = 'core';
    coreMesh.scale.set(1, 1, 1.22);
    coreMesh.position.set(0, YC, 0);
    coreMesh.userData.cannotReceiveAO = true;

    // ---- cradle claws (instanced): closed pose, pivot at the origin, pointing along −X ---------------------
    const C = new Parts();
    const dark = 0x34323a;
    C.add('claw', prism([[0, 0.1], [-0.26, 0.085], [-0.56, 0.05], [-0.77, 0.014], [-0.77, -0.014], [-0.56, -0.05], [-0.26, -0.085], [0, -0.1]], 0.062, 0.012), undefined, dark);
    C.bevel('claw', 0.56, 0.02, 0.012, 0.004, { p: [-0.36, 0, -0.034] }, 0xffffff);
    C.bevel('claw', 0.05, 0.036, 0.074, 0.008, { p: [-0.785, 0, 0] }, 0xffffff);
    C.cyl('claw', 0.044, 0.044, 0.22, 10, { p: [0, 0, 0] }, 0xd8d8d8);
    for (const sy of [-1, 1]) C.bevel('claw', 0.2, 0.012, 0.012, 0.003, { p: [-0.13, sy * 0.062, -0.034], r: [0, 0, sy * -0.06] }, 0xffffff);
    this.claws = new THREE.InstancedMesh(C.geometry('claw'), this.mk.solid('goldDark'), 10);
    this.claws.name = 'claws';
    this.claws.castShadow = true;
    this.claws.frustumCulled = false;

    // ---- filaments that knit as it integrates ------------------------------------------------------------
    const centre = v(0, YC, 0);
    for (let i = 0; i < 5; i++) {
      const at = starAngle(i), t0 = i * 0.09;
      const tip = v(Math.cos(at) * TIPS[i], YC + Math.sin(at) * TIPS[i], 0);
      for (const off of [-0.11, 0, 0.11]) {
        const a = at + off;
        const from = v(Math.cos(a) * (HOOP_R - 0.04), YC + Math.sin(a) * (HOOP_R - 0.04), 0);
        const mid = from.clone().lerp(tip, 0.5).lerp(centre, off === 0 ? 0 : 0.035);
        P.add('fil', tube([from, mid, tip], 0.0055, t0, t0 + 0.4, 3));
      }
      // arcs along both hoop faces linking neighbouring claws
      const a0 = at + Math.PI / 5 - 0.5, a1 = at + Math.PI / 5 + 0.5;
      for (const sz of [-1, 1]) {
        const pts: THREE.Vector3[] = [];
        for (let k = 0; k <= 6; k++) {
          const a = a0 + ((a1 - a0) * k) / 6;
          pts.push(v(Math.cos(a) * (HOOP_R - 0.012), YC + Math.sin(a) * (HOOP_R - 0.012), sz * 0.069));
        }
        P.add('fil', tube(pts, 0.005, 0.45 + t0 * 0.5, 0.8 + t0 * 0.5, 3));
      }
      // threads rising from the plinth's inner ring to the hoop foot
      const b = (i / 5) * Math.PI * 2 + 0.3;
      const foot = v(Math.cos(b) * 0.66, 0.372, -Math.sin(b) * 0.66);
      const hx = Math.cos(b) * 0.42;
      const land = v(hx, YC - Math.sqrt(HOOP_R * HOOP_R - hx * hx) + 0.05, 0);
      P.add('fil', tube([foot, foot.clone().lerp(land, 0.5).add(v(0, 0.06, 0)), land], 0.005, 0.25 + t0, 0.7 + t0, 3));
    }
    this.filaments = this.mk.fx({
      blend: 'opaque', reveal: true, body: revealBody(),
      uniforms: { uColor: uC(PALETTE.goldLight), uGain: uF(2.4), uReveal: uF(0), uHead: uF(1.6), uDim: uF(0) },
    });

    this.chan = this.mk.glow(0xffc56b, 1);
    const filMesh = new THREE.Mesh(P.geometry('fil'), this.filaments);
    filMesh.name = 'filaments';
    this.object.add(
      P.mesh('stone', this.mk.solid('blackStone')), P.mesh('gold', this.mk.solid('goldTrim')),
      P.mesh('chan', this.chan.material, false), coreMesh, this.claws, filMesh,
    );

    this.light = new THREE.PointLight(0xfff0d8, 2, 16, 2);
    this.light.name = 'prop.crownmark.light';
    // in front of the star, where the core faces the people standing at the interfaces
    this.light.position.set(0, YC, -0.55);
    this.object.add(this.light);

    this.addSocket('core', 0, YC, 0);
    this.addSocket('top', 0, YC + TIPS[0], 0);
    // polish 4: a monumental Crownmark (`scale`): the object, its light reach and its collider grow together
    const k = typeof opts.scale === 'number' && Number.isFinite(opts.scale) ? Math.min(4, Math.max(0.5, opts.scale)) : 1;
    if (k !== 1) {
      this.object.scale.setScalar(k);
      this.light.distance *= k;
    }
    this.lightScale = k * k;
    this.addCollider({ kind: 'cyl', r: 1.78 * k, hy: 1.5 * k }, 0, 1.5 * k, 0);
    this.ready();
  }

  protected apply(_dt: number, time: number): void {
    const g = clamp01(this.cur.glow), I = clamp01(this.cur.integrated), st = clamp01(this.cur.steady);
    // polish 4: `steady` is light only — a calm, unwavering core and channel light (and the filaments lit) with
    // the claws untouched (`integrated` folds them; the script forbids that before the consequence beat)
    const breathe = 1 + 0.05 * (1 - st) * Math.sin(time * 1.3);
    this.chan.set((0.1 + 2.2 * g + 0.45 * I + 1.2 * st) * breathe);
    this.core.set(0.4 + 4.9 * g + 3.5 * st);
    this.light.intensity = (5 + 40 * g + 30 * st) * this.lightScale;
    this.filaments.uniforms.uReveal.value = Math.max(ramp(I, 0.3, 1), 0.85 * st) * 1.001;
    this.filaments.uniforms.uGain.value = 1.6 + 1.2 * g + 0.8 * st;
    if (I === this.lastI) return;
    this.lastI = I;
    const { m, m2, q, v, s, e } = TMP;
    for (let i = 0; i < 5; i++) {
      // claws fold shut one after another, latch with a small rebound
      const u = clamp01((I - i * 0.07) / 0.6);
      const c = 1 - Math.pow(1 - u, 3);
      const k = clamp01((u - 0.82) / 0.18);
      const phi = CLAW_OPEN * (1 - c) + 0.07 * Math.sin(Math.PI * k) * (1 - k);
      const av = starAngle(i) + Math.PI / 5;
      for (let side = 0; side < 2; side++) {
        const sz = side === 0 ? -1 : 1;
        m.makeRotationZ(av);
        m.setPosition(0, YC, 0);
        v.set(HOOP_R - 0.05, 0, sz * 0.04);
        e.set(side === 0 ? 0 : Math.PI, sz * phi, 0, 'YXZ');
        q.setFromEuler(e);
        m2.compose(v, q, s.set(1, 1, 1));
        m.multiply(m2);
        this.claws.setMatrixAt(i * 2 + side, m);
      }
    }
    this.claws.instanceMatrix.needsUpdate = true;
  }
}
