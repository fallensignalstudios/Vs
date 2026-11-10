/**
 * Nested ring assembly (Z10) — six suspended concentric rings of alternating section (broad bands and tall
 * blades), each tilted about its own precessing axis and turning at its own speed, with gold rails, panel
 * clasps, light seams and tiny light points. `align` brings every ring into one horizontal plane with their
 * light points lined up on common spokes; `energy` drives light pulses that travel from the outer ring inward,
 * the converging currents between the rings and the axis column.
 *
 * Draw calls: 2 sections × (body, gold, light) instanced + currents + axis = 8.
 */
import * as THREE from 'three';
import type { MaterialLibrary, NestedRingsOpts } from '@/core/api';
import { PALETTE } from '@/core/api/materials';
import { clamp, clamp01, TAU } from '@/core/mathx';
import { PropBase, TMP, outBack, spring, uC, uF, type Glow } from './base';
import { Parts, hoop, prep, sweep } from './geo';

type Params = { align: number; spin: number; energy: number };

interface Ring {
  /** 0 = band section, 1 = blade section; index inside that section's instanced meshes */
  kind: 0 | 1; slot: number;
  r: number; ys: number; tilt: number;
  /** tilt-axis azimuth and its precession rate, in-plane angle and its speed (rad/s at spin 1) */
  az: number; prec: number; phi: number; speed: number;
}

const SPOKES = 12;
const COMMON_SPEED = 0.05;
/** [radius fraction, section, axial scale, tilt°, start azimuth, precession, start phase, speed] */
const LAYOUT: ReadonlyArray<readonly [number, 0 | 1, number, number, number, number, number, number]> = [
  [1.0, 0, 1.0, 13, 0.4, 0.016, 0.0, 0.022],
  [0.82, 1, 1.0, 24, 2.3, -0.024, 1.1, -0.034],
  [0.645, 0, 1.25, 31, 4.1, 0.034, 2.2, 0.05],
  [0.47, 1, 0.85, 22, 5.6, -0.05, 0.6, -0.07],
  [0.31, 0, 1.5, 30, 1.2, 0.07, 3.0, 0.1],
  [0.17, 1, 0.7, 36, 3.4, -0.1, 4.4, -0.15],
];

/** unit-radius ring section: half radial width `a`, half axial height `b` */
function sectionGeometry(P: Parts, key: string, a: number, b: number): void {
  const c = Math.min(a, b) * 0.32;
  const body = prep(sweep([[1 + a, -b + c], [1 + a, b - c], [1 + a - c, b], [1 - a + c, b], [1 - a, b - c], [1 - a, -b + c], [1 - a + c, -b], [1 + a - c, -b]], { closed: true, seg: 192 }));
  // plated construction: each of the 24 panels gets its own slight tint
  const pos = body.attributes.position.array as Float32Array, col = body.attributes.color.array as Float32Array;
  for (let i = 0; i < pos.length; i += 18) {
    let cx = 0, cz = 0;
    for (let k = 0; k < 18; k += 3) { cx += pos[i + k]; cz += pos[i + k + 2]; }
    const panel = Math.floor(((Math.atan2(-cz, cx) + TAU) % TAU) / (TAU / 24));
    const t = 0.82 + 0.18 * (((panel * 7919) % 13) / 12);
    for (let k = 0; k < 18; k++) col[i + k] = t;
  }
  P.raw(`${key}.body`, body);
  // gold rails on the four long edges, a clasp over every panel joint
  const rail = Math.min(a, b) * 0.2;
  for (const sr of [-1, 1]) for (const sy of [-1, 1]) P.add(`${key}.gold`, hoop(1 + sr * (a - c * 0.5), sy * (b - c * 0.5), rail * 1.5, rail * 1.5, { seg: 192 }));
  for (let k = 0; k < 24; k++) {
    const ang = (k / 24) * TAU;
    P.bevel(`${key}.gold`, 2 * a + rail, 2 * b + rail, 0.007, rail * 0.3, { p: [Math.cos(ang), 0, -Math.sin(ang)], r: [0, ang, 0] });
  }
  // light: seams (dim), spoke studs (bright), small points between (medium) — hierarchy through vertex tint
  const seam = 0x595959, stud = 0xffffff, point = 0xb0b0b0;
  P.add(`${key}.glow`, hoop(1 - a - 0.0004, 0, 0.0008, b * 0.9, { seg: 192 }), undefined, seam);
  for (const sy of [-1, 1]) P.add(`${key}.glow`, hoop(1, sy * (b + 0.0003), Math.max(0.0022, a * 0.14), 0.0006, { seg: 192 }), undefined, seam);
  const size = Math.max(0.0035, Math.min(a, b) * 0.34);
  for (let k = 0; k < SPOKES * 4; k++) {
    const ang = (k / (SPOKES * 4)) * TAU, major = k % 4 === 0;
    const s = major ? size : size * 0.5;
    for (const sy of [-1, 1]) P.bevel(`${key}.glow`, s, s * 0.5, s, s * 0.2, { p: [Math.cos(ang) * (1 + a * 0.45), sy * (b + s * 0.2), -Math.sin(ang) * (1 + a * 0.45)], r: [0, ang, 0] }, major ? stud : point);
    if (major) P.bevel(`${key}.glow`, s * 0.6, 1.5 * b, s, s * 0.2, { p: [Math.cos(ang) * (1 + a + s * 0.2), 0, -Math.sin(ang) * (1 + a + s * 0.2)], r: [0, ang, 0] }, stud);
  }
}

export class NestedRings extends PropBase<Params> {
  private readonly rings: Ring[] = [];
  private readonly meshes: Array<[THREE.InstancedMesh, THREE.InstancedMesh, THREE.InstancedMesh]> = [];
  private readonly body: THREE.MeshStandardMaterial;
  private readonly currents: THREE.ShaderMaterial;
  private readonly axis: THREE.ShaderMaterial;
  private readonly height: number;
  private readonly disc: THREE.Mesh;
  private common = 0;
  private readonly lightBase = new THREE.Color(PALETTE.goldLight);

  constructor(lib: MaterialLibrary | null, opts: NestedRingsOpts = {}) {
    super('nestedRings', lib, { align: 0, spin: 1, energy: 0.3 }, { align: spring(1.5, 0.74), spin: spring(2, 1, 0, 4), energy: spring(3, 0.9) });
    const num = (v: number | undefined, d: number, lo: number, hi: number): number => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : d);
    const R = num(opts.radius, 60, 4, 400);
    const H = (this.height = num(opts.height, Math.max(14, 0.3 * R), 0, 1000));
    const clearR = num(opts.clearRadius, 30, 0, 1000), clearH = num(opts.clearHeight, 6, 0, 1000);

    const P = new Parts();
    const SECTIONS: ReadonlyArray<readonly [number, number]> = [[0.04, 0.011], [0.012, 0.042]];
    SECTIONS.forEach(([a, b], k) => sectionGeometry(P, `s${k}`, a, b));
    this.body = this.mk.solid('whiteGold', { emissive: 0x6e5d40, emissiveIntensity: 0.2 });
    const gold = this.mk.solid('goldTrim');
    const glow: Glow = this.mk.glow(0xffffff, 1, true);
    const counts = [0, 0];
    for (const [f, kind, ys, tiltDeg, az, prec, phi, speed] of LAYOUT) {
      const r = f * R;
      const [a, b] = SECTIONS[kind];
      // rings over the walkable area never dip below the clearance height
      const reach = (H - clearH - b * ys * r - a * r) / r;
      const maxTilt = r - a * r < clearR ? Math.asin(clamp(reach, 0, 1)) : Math.PI / 2;
      this.rings.push({ kind, slot: counts[kind]++, r, ys, tilt: Math.min((tiltDeg * Math.PI) / 180, maxTilt), az, prec, phi, speed });
    }
    SECTIONS.forEach((_, k) => {
      const make = (slot: string, mat: THREE.Material): THREE.InstancedMesh => {
        const im = new THREE.InstancedMesh(P.geometry(`s${k}.${slot}`), mat, counts[k]);
        im.name = `rings.s${k}.${slot}`;
        im.frustumCulled = false;
        return im;
      };
      const set: [THREE.InstancedMesh, THREE.InstancedMesh, THREE.InstancedMesh] = [make('body', this.body), make('gold', gold), make('glow', glow.material)];
      set[2].instanceMatrix = set[1].instanceMatrix = set[0].instanceMatrix;
      for (let i = 0; i < counts[k]; i++) set[2].setColorAt(i, this.lightBase);
      this.meshes.push(set);
      this.object.add(...set);
    });

    // converging currents: a disc in the common plane, drawn as twelve dashed spokes flowing inward
    this.currents = this.mk.fx({
      uniforms: { uColor: uC(PALETTE.goldLight), uGain: uF(0), uR: uF(R) },
      body: /* glsl */ `
	float r = length( vPos.xy );
	float ang = atan( vPos.y, vPos.x );
	float sector = 6.2831853 / ${SPOKES}.0;
	float da = abs( mod( ang + sector * 0.5, sector ) - sector * 0.5 );
	float w = 0.0016 * uR + 0.05;
	float line = fxLine( r * sin( da ), w );
	float dash = smoothstep( 0.55, 0.75, fract( r / ( uR * 0.11 ) + uTime * 0.45 + floor( ang / sector + 0.5 ) * 0.37 ) );
	float fade = smoothstep( 0.02, 0.1, r / uR ) * smoothstep( 1.0, 0.86, r / uR );
	alpha = line * ( 0.25 + 0.75 * dash ) * fade;
	col = uColor * uGain;
`,
    });
    const disc = (this.disc = new THREE.Mesh(new THREE.RingGeometry(R * 0.015, R, 96, 1), this.currents));
    disc.name = 'rings.currents';
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = H;
    disc.frustumCulled = false;
    disc.renderOrder = 2;

    // axis column through the common centre, down to the floor
    this.axis = this.mk.fx({
      uniforms: { uColor: uC(0xfff2dc), uGain: uF(0) },
      body: /* glsl */ `
	float core = pow( abs( dot( normalize( vN ), normalize( vV ) ) ), 2.5 );
	float flow = 0.8 + 0.2 * fxNoise( vec2( vPos.y * 0.35 - uTime * 2.2, 3.0 ) );
	float ends = smoothstep( 0.0, 0.03, vUv.y ) * smoothstep( 1.0, 0.7, vUv.y );
	alpha = core * flow * ends;
	col = uColor * uGain;
`,
    });
    const top = H + R * 0.8, w = clamp(R * 0.006, 0.16, 0.5);
    const column = new THREE.Mesh(new THREE.CylinderGeometry(w, w, top, 20, 1, true), this.axis);
    column.name = 'rings.axis';
    column.position.y = top / 2;
    column.frustumCulled = false;
    column.renderOrder = 3;
    this.object.add(disc, column);

    this.addSocket('center', 0, H, 0);
    this.addSocket('axisTop', 0, top, 0);
  }

  protected apply(dt: number, time: number): void {
    const a = clamp(this.cur.align, 0, 1.08), spin = Math.max(0, this.cur.spin), e = clamp01(this.cur.energy);
    const { m, q, q2, v, s, c } = TMP;
    const step = TAU / SPOKES;
    this.common += COMMON_SPEED * spin * dt;
    const n = this.rings.length;
    for (let i = 0; i < n; i++) {
      const ring = this.rings[i];
      // outer rings settle first; a slight overshoot swings each plane through level before it rests
      const ai = outBack(clamp01(a * (1 + 0.1 * n) - i * 0.1), 0.9);
      const lock = clamp01(ai);
      ring.phi += (ring.speed + (COMMON_SPEED - ring.speed) * lock) * spin * dt;
      ring.az += ring.prec * spin * dt * (1 - lock);
      let d = (this.common - ring.phi) % step;
      if (d > step / 2) d -= step; else if (d < -step / 2) d += step;
      q.setFromAxisAngle(v.set(Math.cos(ring.az), 0, Math.sin(ring.az)), ring.tilt * (1 - ai));
      q2.setFromAxisAngle(v.set(0, 1, 0), ring.phi + d * lock);
      q.multiply(q2);
      m.compose(v.set(0, this.height, 0), q, s.set(ring.r, ring.r * ring.ys, ring.r));
      const set = this.meshes[ring.kind];
      set[0].setMatrixAt(ring.slot, m);
      // light pulses run from the outer ring to the inner one; alignment evens them out
      const wave = Math.pow(Math.max(0, Math.sin(time * 1.5 - i * 0.85)), 4);
      const level = (0.55 + 1.5 * e) * (1 + 0.9 * e * wave * (1 - 0.6 * lock)) + 0.6 * lock * e;
      set[2].setColorAt(ring.slot, c.copy(this.lightBase).multiplyScalar(level));
    }
    for (const set of this.meshes) {
      set[0].instanceMatrix.needsUpdate = true;
      if (set[2].instanceColor) set[2].instanceColor.needsUpdate = true;
    }
    const al = clamp01(a);
    this.disc.rotation.z = this.common;
    this.body.emissiveIntensity = 0.16 + 0.3 * e;
    this.currents.uniforms.uGain.value = e * (0.25 + 1.6 * al);
    this.axis.uniforms.uGain.value = 0.25 + e * (1.4 + 2.2 * al);
  }
}
