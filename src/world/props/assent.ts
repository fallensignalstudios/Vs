/**
 * Assent interface (Z10) — one of two independent pedestals of the same ancient design: black stone, gold
 * bands, a hand-height slanted interface surface. `active` wakes the gold glyphs; `assent` plays the acceptance
 * light, which differs by PATTERN and MOTION as well as colour:
 *   Tarrik — warm: broad concentric bands that push outward from the palm and fill the surface with heat
 *   Selene — cool: a fine, perfectly still crystalline lattice that closes in from the edges to a crisp ring
 *
 * Draw calls: stone, gold, channel light, interface surface = 4.
 */
import * as THREE from 'three';
import type { MaterialLibrary } from '@/core/api';
import { PALETTE } from '@/core/api/materials';
import { clamp01 } from '@/core/mathx';
import { PropBase, spring, uC, uF, type Glow } from './base';
import { Parts, prism } from './geo';

type Params = { active: number; assent: number };

const TILT = -0.42;
const PAD_W = 0.56, PAD_H = 0.4;
const HEAD: readonly [number, number, number] = [0, 0.985, -0.03];

const PAD_BODY = /* glsl */ `
	vec2 p = ( 0.5 - vUv ) * vec2( ${PAD_W}, ${PAD_H} );   // metres: x to the user's right, y away from the user
	float r = length( p );
	// --- the shared ancient layer: frame, palm ring, five reference marks, data rows
	float frame = fxLine( max( abs( p.x ) - 0.262, abs( p.y ) - 0.182 ), 0.0035 );
	float palm = fxLine( r - 0.085, 0.0035 ) + fxLine( r - 0.07, 0.0012 );
	float marks = 0.0;
	for ( int i = 0; i < 5; i ++ ) {
		float a = radians( 50.0 + 20.0 * float( i ) );
		marks += 1.0 - smoothstep( 0.007, 0.0095, length( p - vec2( cos( a ), sin( a ) ) * 0.135 ) );
	}
	float rowId = floor( p.y / 0.026 );
	float rowLen = 0.05 + 0.08 * fxHash( vec2( rowId, sign( p.x ) + 2.0 ) );
	float rows = step( 0.125, abs( p.x ) ) * step( abs( p.x ), 0.125 + rowLen ) * fxLine( fract( p.y / 0.026 ) - 0.5, 0.16 ) * step( abs( p.y ), 0.16 );
	float base = frame * 0.8 + palm + marks + rows * 0.4;
	float wake = 0.05 + 0.95 * uActive;
	col = uGold * base * wake * ( 1.0 - 0.8 * uAssent ) * ( 1.5 + 0.2 * sin( uTime * 2.0 ) * uActive );
	// --- acceptance
	if ( uSide < 0.5 ) {
		// Tarrik: heat pushing outward in broad bands
		float front = uAssent * 0.4;
		float bands = smoothstep( 0.3, 0.5, fract( r / 0.055 - uTime * 0.55 ) ) * smoothstep( 1.0, 0.8, fract( r / 0.055 - uTime * 0.55 ) );
		float fill = ( 1.0 - smoothstep( front - 0.035, front, r ) ) * step( 0.001, uAssent );
		float rim = fxLine( r - front, 0.006 ) * step( 0.001, uAssent ) * ( 1.0 - uAssent );
		vec3 warm = mix( uDeep, uHot, exp( - r * 11.0 ) );
		col += warm * ( fill * ( 0.5 + 1.3 * bands ) + rim * 2.5 ) * 1.5 + uHot * exp( - r * 20.0 ) * uAssent * 4.6;
	} else {
		// Selene: a still lattice crystallising from the edges inward, resolving to an exact ring
		float edge = max( abs( p.x ) / 0.28, abs( p.y ) / 0.2 );
		float inside = smoothstep( 1.0 - uAssent - 0.04, 1.0 - uAssent + 0.03, edge ) * step( 0.001, uAssent );
		float lat = 0.0, nodes = 1.0;
		for ( int k = 0; k < 3; k ++ ) {
			float a = float( k ) * 1.0471976;
			float d = fract( dot( p, vec2( cos( a ), sin( a ) ) ) / 0.03 + 0.5 ) - 0.5;
			lat = max( lat, fxLine( d, 0.05 ) );
			nodes *= 1.0 - smoothstep( 0.04, 0.12, abs( d ) );
		}
		float hole = smoothstep( 0.078, 0.092, r );
		float ring = ( fxLine( r - 0.085, 0.0028 ) + fxLine( r - 0.1, 0.001 ) ) * smoothstep( 0.55, 1.0, uAssent );
		float star = 0.0;
		for ( int k = 0; k < 6; k ++ ) {
			float a = float( k ) * 1.0471976 + 0.5236;
			vec2 dir = vec2( cos( a ), sin( a ) );
			float along = dot( p, dir );
			star += fxLine( dot( p, vec2( - dir.y, dir.x ) ), 0.0012 ) * step( 0.1, along ) * step( along, 0.1 + 0.035 * uAssent );
		}
		col += uDeep * inside * hole * lat * 1.5 + uHot * ( inside * hole * nodes * 3.4 + ring * 5.2 + star * smoothstep( 0.7, 1.0, uAssent ) * 3.0 );
	}
	col += vec3( 0.004, 0.004, 0.005 );
`;

export class AssentInterface extends PropBase<Params> {
  private readonly chan: Glow;
  private readonly pad: THREE.ShaderMaterial;

  constructor(lib: MaterialLibrary | null, side: 'tarrik' | 'selene') {
    super(`assentInterface.${side}`, lib, { active: 0, assent: 0 }, { active: spring(7, 0.8), assent: spring(2.6, 0.85) });
    const selene = side === 'selene';
    const P = new Parts();
    const c = Math.cos(TILT), s = Math.sin(TILT);
    /** a point in the tilted head's frame (x right, y along its normal, z along its slope) */
    const head = (x: number, y: number, z: number): [number, number, number] => [HEAD[0] + x, HEAD[1] + y * c - z * s, HEAD[2] + y * s + z * c];
    const tilt: readonly [number, number, number] = [TILT, 0, 0];

    // foot, tapering shaft with a waist, flared neck
    P.bevel('stone', 0.68, 0.09, 0.6, 0.02, { p: [0, 0.045, 0] });
    P.bevel('stone', 0.56, 0.07, 0.48, 0.02, { p: [0, 0.125, 0] });
    P.add('stone', prism([[-0.24, 0.16], [0.24, 0.16], [0.15, 0.56], [0.21, 0.9], [-0.21, 0.9], [-0.15, 0.56]], 0.34, 0.025));
    P.add('stone', prism([[-0.11, 0.16], [0.11, 0.16], [0.075, 0.56], [0.1, 0.9], [-0.1, 0.9], [-0.075, 0.56]], 0.42, 0.02));
    P.bevel('gold', 0.6, 0.022, 0.52, 0.006, { p: [0, 0.095, 0] });
    P.bevel('gold', 0.335, 0.03, 0.37, 0.008, { p: [0, 0.56, 0] });
    P.bevel('gold', 0.46, 0.028, 0.4, 0.008, { p: [0, 0.905, 0] });
    for (const sx of [-1, 1]) P.bevel('gold', 0.02, 0.3, 0.02, 0.005, { p: [sx * 0.19, 0.74, -0.165], r: [0, 0, sx * -0.17] });

    // slanted head: stone slab in a gold frame
    P.bevel('stone', 0.68, 0.07, 0.52, 0.016, { p: head(0, 0, 0), r: tilt });
    P.bevel('stone', 0.4, 0.07, 0.3, 0.02, { p: head(0, -0.06, 0.02), r: tilt });
    for (const sz of [-1, 1]) P.bevel('gold', 0.66, 0.022, 0.03, 0.006, { p: head(0, 0.036, sz * 0.232), r: tilt });
    for (const sx of [-1, 1]) {
      P.bevel('gold', 0.03, 0.022, 0.494, 0.006, { p: head(sx * 0.315, 0.036, 0), r: tilt });
      P.bevel('gold', 0.06, 0.03, 0.06, 0.01, { p: head(sx * 0.315, 0.038, -0.232), r: tilt });
      P.bevel('gold', 0.06, 0.03, 0.06, 0.01, { p: head(sx * 0.315, 0.038, 0.232), r: tilt });
    }

    // channel light: one line up the front of the shaft, short returns at the foot, a seam under the head
    P.box('chan', 0.03, 0.31, 0.008, { p: [0, 0.34, -0.212] });
    P.box('chan', 0.03, 0.27, 0.008, { p: [0, 0.74, -0.212] });
    P.box('chan', 0.2, 0.024, 0.008, { p: [0, 0.2, -0.212] });
    for (const sx of [-1, 1]) {
      P.box('chan', 0.008, 0.5, 0.03, { p: [sx * 0.172, 0.6, 0] }, 0x9a9a9a);
      P.box('chan', 0.008, 0.024, 0.36, { p: [sx * 0.343, 0.06, 0] }, 0x9a9a9a);
    }
    P.box('chan', 0.5, 0.01, 0.008, { p: head(0, -0.024, -0.262), r: tilt });

    this.chan = this.mk.glow(0xffc56b, 1, true);
    this.pad = this.mk.fx({
      blend: 'opaque',
      uniforms: {
        uActive: uF(0), uAssent: uF(0), uSide: uF(selene ? 1 : 0), uGold: uC(0xffc56b),
        uDeep: uC(selene ? PALETTE.frostDeep : PALETTE.cinder), uHot: uC(selene ? 0xe8f6ff : 0xffe0b0),
      },
      body: PAD_BODY,
    });
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(PAD_W, PAD_H), this.pad);
    pad.name = 'pad';
    pad.position.set(...head(0, 0.0365, 0));
    pad.rotation.x = -Math.PI / 2 + TILT;
    pad.userData.cannotReceiveAO = true;
    this.object.add(P.mesh('stone', this.mk.solid('blackStone')), P.mesh('gold', this.mk.solid('goldTrim')), P.mesh('chan', this.chan.material, false), pad);

    const hp = head(0, 0.06, 0);
    this.addSocket('hand', hp[0], hp[1], hp[2], Math.PI);
    this.addSocket('stand', 0, 0, -0.7, Math.PI);
    this.addCollider({ kind: 'box', hx: 0.34, hy: 0.55, hz: 0.3 }, 0, 0.55, 0);
  }

  protected apply(_dt: number, time: number): void {
    const act = clamp01(this.cur.active), ass = clamp01(this.cur.assent);
    this.pad.uniforms.uActive.value = act;
    this.pad.uniforms.uAssent.value = ass;
    this.chan.set(0.12 + 1.7 * act * (1 + 0.06 * Math.sin(time * 2)) + 1.0 * ass);
  }
}
