/**
 * Stabilizer control ring (Z05) — a waist-high ancient ring console around a standing position, open toward the
 * front, with two hand plates and three emitter pylons that project a coherent plane: a large thin disc of pale
 * structured light overhead. `plane` is its coherence and size together — a small, torn, flickering patch at
 * low values, a wide still lattice of rings and spokes at 1.
 *
 * Draw calls: ceramic, gold, light, plane, projection cone = 5. Owns one point light (under the plane).
 */
import * as THREE from 'three';
import type { MaterialLibrary } from '@/core/api';
import { clamp01 } from '@/core/mathx';
import { PropBase, spring, uC, uF, type Glow } from './base';
import { Parts, flatRing, hoop, sweep } from './geo';

type Params = { active: number; plane: number };

const PLANE_Y = 3.3;
const PLANE_R = 4.6;
/** the entry gap faces the front (−Z = angle +90°) */
const GAP = 0.72;
const A0 = Math.PI / 2 + GAP, A1 = Math.PI / 2 + Math.PI * 2 - GAP;
/** the operator faces +Z = angle −90° */
const FWD = -Math.PI / 2;

export class Stabilizer extends PropBase<Params> {
  private readonly glow: Glow;
  private readonly plane: THREE.ShaderMaterial;
  private readonly cone: THREE.ShaderMaterial;
  private readonly planeMesh: THREE.Mesh;
  private readonly coneMesh: THREE.Mesh;
  private readonly light: THREE.PointLight;

  constructor(lib: MaterialLibrary | null) {
    super('stabilizer', lib, { active: 0, plane: 0 }, { active: spring(6, 0.8), plane: spring(3.4, 0.7) });
    const P = new Parts();
    const arc = { a0: A0, a1: A1, seg: 96 };
    const at = (r: number, a: number): [number, number] => [r * Math.cos(a), -r * Math.sin(a)];

    // console body: outer wall, top sloping toward the operator, inner wall; a skirt around the foot
    P.add('body', sweep([[1.2, 0], [1.2, 0.86], [1.14, 1.0], [0.84, 0.93], [0.78, 0.86], [0.78, 0]], { ...arc, closed: true, caps: true }));
    P.add('body', sweep([[1.36, 0], [1.36, 0.05], [1.31, 0.1], [1.2, 0.1], [1.2, 0]], { ...arc, closed: true, caps: true }), undefined, 0xd8d8d8);
    P.add('body', sweep([[0.78, 0], [0.78, 0.06], [0.7, 0.06], [0.66, 0.02], [0.66, 0]], { ...arc, closed: true, caps: true }), undefined, 0xd8d8d8);
    P.add('gold', hoop(1.172, 0.94, 0.02, 0.022, arc), { r: [0, 0, 0] });
    P.add('gold', hoop(1.14, 1.004, 0.03, 0.014, arc));
    P.add('gold', hoop(0.84, 0.934, 0.024, 0.014, arc));
    P.add('gold', hoop(1.203, 0.3, 0.012, 0.03, arc));
    P.add('gold', hoop(1.203, 0.62, 0.012, 0.016, arc));
    // gate posts at the two ends of the arc, fins between the five console segments
    for (const a of [A0, A1]) {
      const [x, z] = at(0.99, a);
      P.bevel('gold', 0.5, 1.06, 0.07, 0.015, { p: [x, 0.53, z], r: [0, a, 0] });
      P.bevel('body', 0.3, 0.14, 0.11, 0.02, { p: [x, 1.1, z], r: [0, a, 0] });
    }
    for (let k = 1; k < 5; k++) {
      const a = A0 + ((A1 - A0) * k) / 5;
      const [x, z] = at(0.99, a);
      P.bevel('gold', 0.45, 0.9, 0.018, 0.005, { p: [x, 0.49, z], r: [0, a, 0] });
    }
    // recessed panels on the outer wall
    for (let k = 0; k < 5; k++) {
      const a0 = A0 + ((A1 - A0) * (k + 0.1)) / 5, a1 = A0 + ((A1 - A0) * (k + 0.9)) / 5;
      P.add('body', sweep([[1.208, 0.36], [1.208, 0.58]], { a0, a1, seg: 96 }), undefined, 0xb9b4a8);
    }

    // emitter pylons on the console top
    const emit = [FWD, FWD + (Math.PI * 2) / 3, FWD - (Math.PI * 2) / 3];
    for (const a of emit) {
      const [x, z] = at(0.99, a);
      P.cyl('body', 0.05, 0.085, 0.36, 8, { p: [x, 1.14, z] }, 0xffffff, true);
      P.cyl('gold', 0.066, 0.066, 0.03, 8, { p: [x, 1.325, z] }, 0xffffff, true);
      P.cyl('glow', 0.04, 0.05, 0.035, 8, { p: [x, 1.355, z] }, 0xffffff);
    }

    // light: skirt channel, inner lip, two hand plates, data ticks along the top
    const seam = 0x707070, tick = 0x9c9c9c;
    P.add('glow', flatRing(1.25, 1.285, 0.103, A0, A1, 96), undefined, seam);
    P.add('glow', hoop(0.782, 0.8, 0.008, 0.03, arc), undefined, seam);
    const slope = Math.atan2(1.0 - 0.93, 1.14 - 0.84);
    for (const off of [-0.39, 0.39]) {
      const a = FWD + off;
      const [x, z] = at(0.975, a);
      P.bevel('gold', 0.2, 0.014, 0.25, 0.004, { p: [x, 0.963, z], r: [0, a, slope] });
      P.bevel('glow', 0.16, 0.012, 0.2, 0.004, { p: [x, 0.971, z], r: [0, a, slope] }, 0xffffff);
    }
    for (let k = -12; k <= 12; k++) {
      if (Math.abs(k) >= 3 && Math.abs(k) <= 6) continue;
      const a = FWD + k * 0.085, long = k % 3 === 0;
      const [x, z] = at(long ? 1.0 : 1.03, a);
      P.box('glow', long ? 0.16 : 0.07, 0.006, 0.018, { p: [x, long ? 0.969 : 0.976, z], r: [0, a, slope] }, tick);
    }

    this.glow = this.mk.glow(0xffe2a8, 1, true);
    this.object.add(P.mesh('body', this.mk.solid('whiteGold')), P.mesh('gold', this.mk.solid('goldTrim')), P.mesh('glow', this.glow.material, false));

    // the coherent plane
    this.plane = this.mk.fx({
      uniforms: { uColor: uC(0xfff1d6), uGain: uF(0), uCoh: uF(0) },
      body: /* glsl */ `
	vec2 p = vUv * 2.0 - 1.0;
	float r = length( p );
	float ang = atan( p.y, p.x ) / 6.2831853;
	// incoherent: sectors slip radially, drop out and flicker
	float sect = floor( ang * 24.0 + 0.5 );
	float n = fxHash( vec2( sect, floor( uTime * 9.0 ) ) );
	float slow = fxNoise( vec2( sect * 0.7, uTime * 0.8 ) );
	float rr = r + ( 1.0 - uCoh ) * ( n - 0.5 ) * 0.2;
	float rings = fxLine( fract( rr * 5.0 ) - 0.5, 0.035 ) * step( 0.19, rr );
	float fine = fxLine( fract( rr * 20.0 ) - 0.5, 0.09 ) * 0.22;
	float spokes = fxLine( fract( ang * 24.0 ) - 0.5, 0.012 / max( r, 0.12 ) ) * smoothstep( 0.38, 0.42, r );
	float minor = fxLine( fract( ang * 96.0 ) - 0.5, 0.05 / max( r, 0.12 ) ) * smoothstep( 0.78, 0.8, r ) * 0.5;
	float rim = fxLine( rr - 0.975, 0.012 ) * 1.8 + fxLine( rr - 0.2, 0.008 ) * 1.2;
	float drop = mix( step( 0.5, slow + ( n - 0.5 ) * 0.5 ), 1.0, smoothstep( 0.35, 0.95, uCoh ) );
	float veil = 0.045 + 0.06 * uCoh * ( 0.7 + 0.3 * fxNoise( p * 6.0 + uTime * 0.2 ) );
	alpha = ( rings * 0.75 + fine + spokes * 0.4 + minor + rim + veil ) * drop * ( 1.0 - smoothstep( 0.985, 1.0, r ) );
	col = uColor * uGain;
`,
    });
    this.planeMesh = new THREE.Mesh(new THREE.CircleGeometry(1, 96), this.plane);
    this.planeMesh.name = 'plane';
    this.planeMesh.rotation.x = -Math.PI / 2;
    this.planeMesh.position.y = PLANE_Y;
    this.planeMesh.renderOrder = 4;

    // projection: a faint cone from the emitters up to the plane
    this.cone = this.mk.fx({
      uniforms: { uColor: uC(0xfff1d6), uGain: uF(0) },
      body: /* glsl */ `
	// three beams, one above each emitter pylon (the cylinder's u = 0 faces the operator's forward)
	float beams = pow( max( 0.0, cos( vUv.x * 18.849556 ) ), 40.0 );
	float rise = fract( vUv.y * 3.0 - uTime * 0.35 );
	alpha = ( 0.035 + 0.3 * beams ) * ( 0.75 + 0.25 * rise ) * smoothstep( 0.0, 0.12, vUv.y ) * smoothstep( 1.0, 0.8, vUv.y ) * ( 0.4 + 0.6 * fxFresnel( 1.0 ) );
	col = uColor * uGain;
`,
    });
    this.coneMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.93, 0.215, PLANE_Y - 1.36, 48, 1, true), this.cone);
    this.coneMesh.name = 'cone';
    this.coneMesh.position.y = (PLANE_Y + 1.36) / 2;
    this.coneMesh.renderOrder = 3;
    this.object.add(this.planeMesh, this.coneMesh);

    this.light = new THREE.PointLight(0xfff1d6, 0, 20, 2);
    this.light.name = 'prop.stabilizer.light';
    this.light.position.set(0, PLANE_Y - 0.4, 0);
    this.object.add(this.light);

    const stand = this.addSocket('stand', 0, 0, 0, Math.PI);
    this.addSocket('handR', 0.37, 0.99, -0.9, 0, stand);
    this.addSocket('handL', -0.37, 0.99, -0.9, 0, stand);
    this.addSocket('planeCenter', 0, PLANE_Y, 0);
    this.addSocket('entry', 0, 0, -1.7, Math.PI);
    for (let k = 0; k < 6; k++) {
      const a = A0 + ((A1 - A0) * (k + 0.5)) / 6;
      this.addCollider({ kind: 'box', hx: 0.5, hy: 0.52, hz: 0.24 }, Math.cos(a), 0.52, -Math.sin(a), a + Math.PI / 2);
    }
  }

  protected apply(_dt: number, time: number): void {
    const act = clamp01(this.cur.active), pl = Math.max(0, this.cur.plane), coh = clamp01(pl);
    this.glow.set(0.15 + 2.3 * act * (1 + 0.05 * Math.sin(time * 2.4)));
    const on = act * (coh > 0.004 ? 1 : 0);
    const radius = PLANE_R * (0.16 + 0.84 * pl);
    this.planeMesh.visible = this.coneMesh.visible = on > 0.003;
    this.planeMesh.scale.set(radius, radius, 1);
    this.coneMesh.scale.set(radius, 1, radius);
    // an unstable plane flickers; a coherent one is brighter and still
    const flick = 1 - (1 - coh) * 0.35 * (0.5 + 0.5 * Math.sin(time * 23) * Math.sin(time * 7.1));
    this.plane.uniforms.uCoh.value = coh;
    this.plane.uniforms.uGain.value = on * (0.9 + 1.5 * coh) * flick;
    this.cone.uniforms.uGain.value = on * (0.5 + 0.7 * coh) * flick;
    this.light.intensity = on * (8 + 46 * coh) * flick;
  }
}
