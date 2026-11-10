/**
 * Containment cages (Z07) — the two targets seen through the gallery window at 20–40 m.
 *   dominion     a heavy bronze / oxblood resonator: four clawed pylons, three counter-turning resonator rings
 *                humming around contained dark matter in an amber field
 *   reformation  a modular recovery platform: three jointed emitter masts with exposed pipework and two
 *                emitter rings holding a suspended black-gold fragment in a cold-blue field
 * `charge` is the threat building (light, hum, ring speed). `destroyed` is an authored break-up played at a fixed
 * pace (2.8 s for 0 → 1): overload flash, the frame shears and topples, rings fall, debris flies, the field
 * collapses and the contained matter disperses. Pure function of the parameter — scrub, skip or restore freely.
 *
 * Draw calls: base, frame pieces + debris (instanced), rings (instanced), light, contained matter, field = 6.
 * Owns one point light.
 */
import * as THREE from 'three';
import type { MaterialLibrary } from '@/core/api';
import { PALETTE } from '@/core/api/materials';
import { clamp01, mulberry32 } from '@/core/mathx';
import { PropBase, TMP, ramp, rate, spring, uC, uF, type Glow } from './base';
import { evalPiece, type Motion, type Piece } from './breakup';
import { Parts, hoop, prism, rock } from './geo';

type Params = { charge: number; destroyed: number };

const TOTAL = 2.8;
const OX = 0xa0404a, DARK = 0x34302e;
const NAVY = 0x2a3c58, SLATE = 0x56626f, STEEL_DARK = 0x3c4046;
const Y_AXIS = new THREE.Vector3(0, 1, 0);

const FIELD_BODY = /* glsl */ `
	float bars = fxLine( fract( vUv.x * mix( 16.0, 48.0, uStyle ) ) - 0.5, mix( 0.1, 0.06, uStyle ) );
	float rings = fxLine( fract( vUv.y * mix( 5.0, 13.0, uStyle ) - uTime * mix( 0.5, 0.1, uStyle ) ) - 0.5, mix( 0.07, 0.04, uStyle ) );
	float hum = mix( 0.72 + 0.28 * sin( uTime * 11.0 ) * sin( uTime * 6.3 ), 1.0, uStyle );
	float ends = smoothstep( 0.0, 0.06, vUv.y ) * smoothstep( 1.0, 0.94, vUv.y );
	float torn = step( uCollapse * 1.25, fxNoise( vec2( vUv.x * 18.0, vUv.y * 7.0 - uTime * 4.0 ) ) + 0.25 * ( 1.0 - uCollapse ) );
	alpha = ( 0.05 + bars * 0.28 + rings * 0.5 + fxFresnel( 1.5 ) * 0.4 ) * hum * ends * torn * ( 1.0 - uCollapse );
	col = uColor * uGain;
`;

const MATTER_BODY = /* glsl */ `
	float cut = fxNoise( vUv * vec2( 14.0, 9.0 ) + vec2( uTime * 0.4, - uTime * 0.25 ) );
	if ( cut < uDissolve * 1.2 - 0.05 ) discard;
	float boil = fxNoise( vUv * vec2( 9.0, 6.0 ) + vec2( uTime * 0.3, uTime * 0.17 ) );
	float rim = fxFresnel( 2.4 );
	float edge = ( 1.0 - smoothstep( 0.0, 0.1, cut - uDissolve * 1.2 + 0.05 ) ) * step( 0.001, uDissolve );
	col = uColor * ( rim * ( 0.3 + 2.4 * uCharge ) * ( 0.55 + 0.9 * boil ) + edge * 3.5 );
`;

export class ContainmentCage extends PropBase<Params> {
  private readonly dominion: boolean;
  private readonly sets: THREE.InstancedMesh[] = [];
  private readonly pieces: Piece[] = [];
  private readonly ringPieces: Piece[] = [];
  private readonly shardRest: Array<{ piece: Piece; off: THREE.Vector3; quat: THREE.Quaternion }> = [];
  private readonly glow: Glow;
  private readonly field: THREE.ShaderMaterial;
  private readonly fieldMesh: THREE.Mesh;
  private readonly matter: THREE.ShaderMaterial | null = null;
  private readonly matterMesh: THREE.Mesh | null = null;
  private readonly light: THREE.PointLight;
  private readonly coreY: number;
  private turn = 0;

  constructor(lib: MaterialLibrary | null, kind: 'dominion' | 'reformation') {
    super(`containmentCage.${kind}`, lib, { charge: 0.2, destroyed: 0 }, { charge: spring(4, 0.85), destroyed: rate(TOTAL) });
    const dom = (this.dominion = kind === 'dominion');
    const rnd = mulberry32(dom ? 7701 : 4242);
    const P = new Parts();
    const counts = [0, 0, 0];
    const add = (set: number, pos: THREE.Vector3, quat: THREE.Quaternion, scale: number, motion: Motion): Piece => {
      const p: Piece = { set, slot: counts[set]++, pos, quat, scale: new THREE.Vector3(scale, scale, scale), motion };
      this.pieces.push(p);
      return p;
    };
    const radial = (az: number): THREE.Vector3 => new THREE.Vector3(Math.cos(az), 0, -Math.sin(az));
    const tipOut = (az: number): THREE.Vector3 => new THREE.Vector3(-Math.sin(az), 0, -Math.cos(az));
    const pose = (az: number, lean: number): THREE.Quaternion => new THREE.Quaternion().setFromEuler(new THREE.Euler(0, az, lean, 'YXZ'));
    const fly = (t0: number, dir: THREE.Vector3, out: number, side: number, up: number, floor: number, extra: Partial<Extract<Motion, { kind: 'fly' }>> = {}): Motion => ({
      kind: 'fly', t0, floor,
      vel: dir.clone().multiplyScalar(out).add(new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(side)).setY(up),
      spinAxis: new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize(), spin: 2 + rnd() * 4, ...extra,
    });

    let masts: number, lean: number[], sc: number[], segLen: number, r0: number, y0: number, az0: number;
    if (dom) {
      // ---- Dominion: octagonal two-tier base with oxblood panels and four buttresses ------------------------
      P.cyl('base', 3.35, 3.6, 0.5, 8, { p: [0, 0.25, 0], r: [0, Math.PI / 8, 0] }, 0xffffff, true);
      P.cyl('base', 2.65, 2.95, 0.46, 8, { p: [0, 0.73, 0], r: [0, Math.PI / 8, 0] }, 0xc8c8c8, true);
      P.cyl('base', 1.25, 1.6, 0.34, 16, { p: [0, 1.12, 0] }, DARK);
      P.cyl('base', 0.95, 0.95, 0.06, 16, { p: [0, 1.32, 0] }, 0xffffff);
      for (let k = 0; k < 8; k++) {
        const a = (k * Math.PI) / 4;
        P.bevel('base', 0.1, 0.3, 2.1, 0.02, { p: [Math.cos(a) * 3.23, 0.27, -Math.sin(a) * 3.23], r: [0, a, 0] }, OX);
        if (k % 2 === 1) P.bevel('base', 1.5, 0.8, 1.2, 0.07, { p: [Math.cos(a) * 2.85, 0.9, -Math.sin(a) * 2.85], r: [0, a, 0] });
        else P.bevel('base', 0.5, 0.2, 1.5, 0.04, { p: [Math.cos(a) * 2.5, 1.0, -Math.sin(a) * 2.5], r: [0, a, 0] }, OX);
      }
      // pylon segment: origin at its foot, +Y along it, +X outward
      P.add('seg', prism([[-0.42, 0], [0.48, 0], [0.4, 2.2], [-0.3, 2.2]], 0.72, 0.04));
      P.bevel('seg', 0.11, 1.7, 0.88, 0.03, { p: [0.47, 1.1, 0], r: [0, 0, 0.036] }, OX);
      P.bevel('seg', 1.08, 0.24, 0.88, 0.04, { p: [0.03, 0.09, 0] }, DARK);
      for (const y of [0.72, 1.3, 1.88]) P.bevel('seg', 0.98 - y * 0.08, 0.07, 0.8, 0.015, { p: [0.03, y, 0] });
      for (const y of [0.46, 1.01, 1.59]) P.box('segGlow', 0.03, 0.09, 0.52, { p: [-0.425 + y * 0.0545, y, 0], r: [0, 0, 0.054] });
      P.box('segGlow', 0.03, 1.25, 0.07, { p: [0.535, 1.1, 0], r: [0, 0, 0.036] }, 0x8c8c8c);
      // resonator ring (unit radius): a hoop carrying eight heavy blocks
      P.add('ring', hoop(1, 0, 0.1, 0.075, { seg: 64 }));
      for (let k = 0; k < 8; k++) {
        const a = (k * Math.PI) / 4;
        P.bevel('ring', 0.17, 0.15, 0.22, 0.02, { p: [Math.cos(a), 0, -Math.sin(a)], r: [0, a, 0] }, k % 2 ? OX : DARK);
      }
      masts = 4; lean = [0.14, 0.42, 0.8]; sc = [1, 0.84, 0.68]; segLen = 2.2; r0 = 3.0; y0 = 1.05; az0 = Math.PI / 4;
      this.coreY = 3.7;
    } else {
      // ---- Reformation: hexagonal deck with equipment pods, cable runs and ring stanchions ------------------
      P.cyl('base', 3.4, 3.5, 0.3, 6, { p: [0, 0.15, 0] }, NAVY, true);
      P.cyl('base', 2.75, 2.85, 0.22, 6, { p: [0, 0.41, 0] }, 0xffffff, true);
      P.cyl('base', 1.2, 1.4, 0.2, 24, { p: [0, 0.62, 0] }, SLATE);
      for (let k = 0; k < 6; k++) {
        const a = (k * Math.PI) / 3;
        const [cx, cz] = [Math.cos(a), -Math.sin(a)];
        P.bevel('base', 0.8, 0.85, 1.25, 0.05, { p: [cx * 2.95, 0.72, cz * 2.95], r: [0, a, 0] }, k % 2 ? NAVY : SLATE);
        P.bevel('base', 0.84, 0.05, 1.29, 0.015, { p: [cx * 2.95, 1.16, cz * 2.95], r: [0, a, 0] });
        P.box('base', 1.5, 0.07, 0.09, { p: [cx * 1.85, 0.55, cz * 1.85 + 0.2], r: [0, a, 0] }, STEEL_DARK);
        P.box('base', 1.5, 0.05, 0.05, { p: [cx * 1.85, 0.55, cz * 1.85 - 0.18], r: [0, a, 0] }, STEEL_DARK);
      }
      for (let k = 0; k < 3; k++) {
        const a = Math.PI / 6 + (k * Math.PI * 2) / 3;
        P.cyl('base', 0.05, 0.07, 1.5, 6, { p: [Math.cos(a) * 1.3, 1.25, -Math.sin(a) * 1.3] });
      }
      // mast segment: slim modular column with collars and exposed pipework
      P.bevel('seg', 0.34, 2.3, 0.34, 0.03, { p: [0, 1.15, 0] }, NAVY);
      P.bevel('seg', 0.46, 0.14, 0.46, 0.02, { p: [0, 0.07, 0] });
      P.bevel('seg', 0.44, 0.1, 0.44, 0.02, { p: [0, 2.25, 0] });
      P.cyl('seg', 0.045, 0.045, 2.0, 6, { p: [0.24, 1.15, 0.1] });
      P.cyl('seg', 0.03, 0.03, 2.0, 6, { p: [0.24, 1.15, -0.1] }, SLATE);
      P.bevel('seg', 0.1, 0.32, 0.32, 0.02, { p: [0.2, 0.62, 0] });
      P.bevel('seg', 0.1, 0.2, 0.26, 0.02, { p: [0.2, 1.7, 0] }, SLATE);
      P.box('segGlow', 0.02, 1.5, 0.05, { p: [-0.181, 1.2, 0] }, 0x9a9a9a);
      for (const y of [0.3, 2.05]) P.box('segGlow', 0.02, 0.09, 0.2, { p: [-0.181, y, 0] });
      P.box('segGlow', 0.14, 0.035, 0.14, { p: [0, 2.32, 0] });
      // emitter ring (unit radius) with twelve small emitter heads
      P.add('ring', hoop(1, 0, 0.045, 0.07, { seg: 64 }));
      for (let k = 0; k < 12; k++) {
        const a = (k * Math.PI) / 6;
        P.bevel('ring', 0.1, 0.11, 0.09, 0.012, { p: [Math.cos(a) * 0.97, 0, -Math.sin(a) * 0.97], r: [0, a, 0] }, k % 3 ? SLATE : 0xffffff);
      }
      masts = 3; lean = [0, 0.5, 1.25]; sc = [1, 0.8, 0.5]; segLen = 2.3; r0 = 2.55; y0 = 0.52; az0 = -Math.PI / 2;
      this.coreY = 3.25;
    }

    // ---- frame pieces: every mast is a chain of three segments curling inward ----------------------------------
    for (let j = 0; j < masts; j++) {
      const az = az0 + (j * Math.PI * 2) / masts;
      const rad = radial(az);
      let r = r0, y = y0;
      for (let i = 0; i < 3; i++) {
        const pos = new THREE.Vector3(rad.x * r, y, rad.z * r);
        let motion: Motion;
        // odd masts: the middle segment is thrown clear and the stump leans; even masts: it folds outward and
        // hangs from a standing stump. Every top segment shears off.
        const thrown = j % 2 === 1;
        if (i === 2) motion = fly(0.03 + j * 0.025, rad, 4 + rnd() * 3, (rnd() - 0.5) * 4, 3.5 + rnd() * 3, 0.3);
        else if (i === 1) {
          motion = thrown
            ? fly(0.07 + j * 0.03, rad, 2.5 + rnd() * 2, (rnd() - 0.5) * 3, 1.5 + rnd() * 2, 0.32)
            : { kind: 'topple', t0: 0.08 + j * 0.03, hinge: pos.clone().addScaledVector(rad, 0.4 * sc[1]), axis: tipOut(az), angle: 2.3 + rnd() * 0.4 + lean[1], seconds: 1.1 + rnd() * 0.3 };
        } else {
          motion = thrown
            ? { kind: 'topple', t0: 0.12, hinge: pos.clone().addScaledVector(rad, 0.45), axis: tipOut(az), angle: 0.14 + rnd() * 0.12, seconds: 0.9 }
            : { kind: 'static' };
        }
        add(0, pos, pose(az, lean[i]), sc[i], motion);
        r -= Math.sin(lean[i]) * segLen * sc[i];
        y += Math.cos(lean[i]) * segLen * sc[i];
      }
    }
    // debris: small copies of a segment, invisible until thrown
    for (let k = 0; k < (dom ? 16 : 12); k++) {
      const az = rnd() * Math.PI * 2, rad = radial(az);
      const pos = new THREE.Vector3(rad.x * (1.2 + rnd() * 1.6), 2 + rnd() * 3.6, rad.z * (1.2 + rnd() * 1.6));
      add(0, pos, new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd() * 6, rnd() * 6, rnd() * 6)), 0.09 + rnd() * 0.16,
        fly(0.03 + rnd() * 0.16, rad, 2.5 + rnd() * 6.5, (rnd() - 0.5) * 5, 1.5 + rnd() * 6, 0.07, { hidden: true }));
    }
    // rings
    const ringDefs: Array<[number, number, Motion]> = dom
      ? [
        [2.45, 2.05, fly(0.14, radial(2.2), 0.6, 0.3, 1.0, 1.42, { spin: 0.9 })],
        [3.7, 1.85, fly(0.09, radial(5.1), 0.35, 0.2, 0.6, 1.5, { spin: 1.3 })],
        [4.9, 1.42, fly(0.04, radial(0.6), 3.2, 1.0, 5.0, 0.2, { spin: 3.4 })],
      ]
      : [
        [1.95, 1.3, { kind: 'topple', t0: 0.16, hinge: new THREE.Vector3(1.3, 1.95, 0), axis: new THREE.Vector3(0, 0, 1), angle: 0.2, seconds: 0.8 }],
        [4.5, 1.3, fly(0.06, radial(4.0), 1.2, 0.5, 1.6, 0.82, { spin: 1.6 })],
      ];
    for (const [y, r, motion] of ringDefs) {
      const p = add(1, new THREE.Vector3(0, y, 0), new THREE.Quaternion(), r, motion);
      this.ringPieces.push(p);
    }

    const frameMat = this.mk.solid(dom ? 'domBronze' : 'refSteel');
    const frame = new THREE.InstancedMesh(P.geometry('seg'), frameMat, counts[0]);
    const rings = new THREE.InstancedMesh(P.geometry('ring'), frameMat, counts[1]);
    this.glow = this.mk.glow(dom ? PALETTE.domAmber : PALETTE.refBlue, 1, true);
    const glow = new THREE.InstancedMesh(P.geometry('segGlow'), this.glow.material, counts[0]);
    glow.instanceMatrix = frame.instanceMatrix;
    frame.name = 'frame'; rings.name = 'rings'; glow.name = 'frameGlow';
    this.sets.push(frame, rings);
    const base = P.mesh('base', frameMat);
    this.object.add(base, frame, rings, glow);

    // ---- what is contained ------------------------------------------------------------------------------------
    const tint = dom ? PALETTE.domAmber : PALETTE.refBlue;
    if (dom) {
      this.matter = this.mk.fx({ blend: 'opaque', uniforms: { uColor: uC(0xff8a2a), uCharge: uF(0), uDissolve: uF(0) }, body: MATTER_BODY });
      this.matterMesh = new THREE.Mesh(new THREE.SphereGeometry(1.05, 40, 24), this.matter);
      this.matterMesh.name = 'matter';
      this.matterMesh.position.y = this.coreY;
      this.object.add(this.matterMesh);
    } else {
      // the fragment: seven black-gold shards that hold together until the platform dies
      const shardGeo = rock(31, 1, 9);
      const g = shardGeo.attributes.position.count;
      const col = new Float32Array(g * 3);
      for (let f = 0; f < g; f += 3) {
        const bright = rnd() < 0.28 ? 1 : 0.05 + rnd() * 0.05;
        for (let k = 0; k < 9; k++) col[f * 3 + k] = bright;
      }
      shardGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const shards = new THREE.InstancedMesh(shardGeo, this.mk.solid('goldDark'), 7);
      shards.name = 'fragment';
      for (let k = 0; k < 7; k++) {
        const off = k === 0 ? new THREE.Vector3() : new THREE.Vector3((rnd() - 0.5) * 0.6, (rnd() - 0.5) * 1.5, (rnd() - 0.5) * 0.55);
        const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd() * 6, rnd() * 6, rnd() * 6));
        const dir = off.lengthSq() > 0.001 ? off.clone().setY(0).normalize() : radial(rnd() * 6);
        const piece = add(2, new THREE.Vector3(), new THREE.Quaternion(), k === 0 ? 0.55 : 0.24 + rnd() * 0.2,
          fly(0.1 + rnd() * 0.05, dir, 2 + rnd() * 4, (rnd() - 0.5) * 3, off.y * 3 + 1.5, 0.75, { vanish: 0.9 + rnd() * 0.5 }));
        piece.scale.y *= 1.5;
        this.shardRest.push({ piece, off, quat });
      }
      this.sets.push(shards);
      this.object.add(shards);
    }

    this.field = this.mk.fx({ uniforms: { uColor: uC(tint), uGain: uF(1), uCollapse: uF(0), uStyle: uF(dom ? 0 : 1) }, body: FIELD_BODY });
    const fr = dom ? 1.62 : 1.26, fy0 = dom ? 1.4 : 1.95, fy1 = dom ? 5.9 : 4.5;
    this.fieldMesh = new THREE.Mesh(new THREE.CylinderGeometry(fr, fr, fy1 - fy0, 48, 1, true), this.field);
    this.fieldMesh.name = 'field';
    this.fieldMesh.position.y = (fy0 + fy1) / 2;
    this.fieldMesh.renderOrder = 3;
    this.object.add(this.fieldMesh);

    this.light = new THREE.PointLight(tint, 0, 26, 2);
    this.light.name = 'prop.cage.light';
    this.light.position.set(0, this.coreY, 0);
    this.object.add(this.light);

    this.addSocket('core', 0, this.coreY, 0);
    this.addSocket('top', 0, dom ? 6.2 : 4.9, 0);
    this.addCollider({ kind: 'cyl', r: 3.6, hy: 3 }, 0, 3, 0);
  }

  protected apply(dt: number, time: number): void {
    const ch = clamp01(this.cur.charge), d = clamp01(this.cur.destroyed);
    const alive = 1 - ramp(d, 0.02, 0.4);
    const spike = d > 0 && d < 0.14 ? Math.sin(Math.PI * (d / 0.14)) : 0;
    const hum = this.dominion ? 1 + 0.12 * ch * Math.sin(time * 13) * Math.sin(time * 5.1) : 1;
    const embers = this.dominion ? 0.3 * ramp(d, 0.3, 0.5) * (1 - ramp(d, 0.82, 1)) * (0.6 + 0.4 * Math.sin(time * 9)) : 0;
    this.glow.set(((this.dominion ? 1.0 : 0.9) + 2.3 * ch) * hum * alive + 3.5 * spike + embers);
    this.light.intensity = (6 + 44 * ch) * alive * hum + 150 * spike;

    const collapse = ramp(d, 0.03, 0.3);
    this.fieldMesh.visible = collapse < 0.999;
    this.field.uniforms.uCollapse.value = collapse;
    this.field.uniforms.uGain.value = 0.55 + 1.3 * ch + 2 * spike;
    if (this.matter && this.matterMesh) {
      const gone = ramp(d, 0.08, 0.52);
      this.matterMesh.visible = gone < 0.999;
      this.matter.uniforms.uCharge.value = ch + spike;
      this.matter.uniforms.uDissolve.value = gone;
      const s = (1 + 0.035 * ch * Math.sin(time * 7)) * (1 + 0.9 * gone);
      this.matterMesh.scale.setScalar(s);
      this.matterMesh.rotation.y = time * 0.2;
    }

    // rings turn against each other (Dominion); the fragment drifts as one body until it breaks (Reformation)
    this.turn += dt * alive * (this.dominion ? 0.35 + 2.2 * ch : 0.22);
    const { m, m2, q, v } = TMP;
    for (const { piece, off, quat } of this.shardRest) {
      q.setFromAxisAngle(Y_AXIS, this.turn);
      piece.pos.copy(off).applyQuaternion(q).add(v.set(0, this.coreY + 0.07 * Math.sin(time * 0.9) * alive, 0));
      piece.quat.copy(q).multiply(quat);
    }
    for (const p of this.pieces) {
      evalPiece(p, d, TOTAL, m);
      if (this.dominion && p.set === 1) m.multiply(m2.makeRotationY(this.turn * (p.slot % 2 ? -1 : 1) * (1 + p.slot * 0.3)));
      this.sets[p.set].setMatrixAt(p.slot, m);
    }
    for (const s of this.sets) s.instanceMatrix.needsUpdate = true;
  }
}
