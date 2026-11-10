/**
 * Eclipse corruption overlay — a patch that can be added to ANY standard/physical material instance.
 *
 * A shared tiling texture carries a branching vein network (R), a growth-order field (G), tissue mottling (B)
 * and a pulse phase (A). `amount` moves a threshold through the growth order: thin tendrils lead, dark wet
 * tissue fills in behind them, veins pulse violet under the surface, and the newest band of growth glows.
 * Sampled triplanar in the material's mapping space, so it creeps across UV-less geometry and sticks to moving
 * meshes when the material is object-mapped.
 */
import * as THREE from 'three';
import type { AurUniform, SurfacePatch } from './patch';

export interface CorruptParams {
  amount: number;
  /** metres per repeat of the vein network */
  scale: number;
  glow: number;
  dark: number;
  /** emissive intensity of the veins */
  intensity: number;
}

const PARS = /* glsl */ `
uniform sampler2D aurVeinTex;
uniform vec4 corA; // x amount · y repeats/m · z glow intensity · w pulse rate
uniform vec3 corGlow;
uniform vec3 corDark;
`;

const SURFACE = /* glsl */ `
if ( corA.x > 0.001 ) {
	vec3 cW = aurTriWeights( mxGeoN );
	vec3 cQ = mxPos * corA.y;
	vec3 cGx = dFdx( cQ ), cGy = dFdy( cQ );
	// c = the vein network at its own scale; cb = the same texture at a larger, incommensurate scale, used only
	// to modulate WHERE growth happens so the patch shape never repeats with the tile
	vec4 c = vec4( 0.0 ), cb = vec4( 0.0 );
	const float CB = 0.193;
	if ( cW.x > 0.0 ) {
		c += textureGrad( aurVeinTex, cQ.zy, cGx.zy, cGy.zy ) * cW.x;
		cb += textureGrad( aurVeinTex, cQ.zy * CB + 0.37, cGx.zy * CB, cGy.zy * CB ) * cW.x;
	}
	if ( cW.y > 0.0 ) {
		c += textureGrad( aurVeinTex, cQ.xz, cGx.xz, cGy.xz ) * cW.y;
		cb += textureGrad( aurVeinTex, cQ.xz * CB + 0.37, cGx.xz * CB, cGy.xz * CB ) * cW.y;
	}
	if ( cW.z > 0.0 ) {
		c += textureGrad( aurVeinTex, cQ.xy, cGx.xy, cGy.xy ) * cW.z;
		cb += textureGrad( aurVeinTex, cQ.xy * CB + 0.37, cGx.xy * CB, cGy.xy * CB ) * cW.z;
	}
	float cOrder = c.g * 0.5 + cb.g * 0.6 - 0.05;
	float cTh = corA.x * 1.35 - 0.12;
	vec3 cSx = dFdx( mxPos ), cSy = dFdy( mxPos );
	// metric distance behind the growth front (order units ÷ order gradient per metre): keeps the rim a thin
	// line of constant width instead of a blob wherever the order field happens to be flat
	float cSlope = length( vec2( dFdx( cOrder ), dFdy( cOrder ) ) ) / max( 0.5 * ( length( cSx ) + length( cSy ) ), 1e-6 );
	float cDist = ( cTh - cOrder ) / max( cSlope, 0.35 );
	float cGrown = smoothstep( - 0.012, 0.012, cDist );                                     // wet tissue coverage
	float cRim = smoothstep( - 0.012, 0.004, cDist ) * ( 1.0 - smoothstep( 0.006, 0.04, cDist ) ); // thin creeping edge
	float cLead = smoothstep( 0.45, 0.9, c.r ) * smoothstep( - 0.5, - 0.08, cDist );      // tendrils run ahead
	float cVein = max( smoothstep( 0.35, 0.9, c.r ) * cGrown, cLead );
	diffuseColor.rgb = mix( diffuseColor.rgb, corDark * ( 0.4 + 1.2 * c.b ), saturate( cGrown * 0.97 + cLead * 0.85 ) );
	roughnessFactor = mix( roughnessFactor, 0.26 + 0.32 * c.b, cGrown );
	metalnessFactor *= 1.0 - cGrown * 0.9;
	mxAO *= 1.0 - cGrown * 0.4 * ( 1.0 - c.b );
	totalEmissiveRadiance *= 1.0 - cGrown * 0.9;
	float cBeat = 0.5 + 0.5 * sin( aurTime * corA.w - c.a * 25.0 - cb.a * 9.0 );
	cBeat *= cBeat;
	totalEmissiveRadiance += corGlow * ( corA.z * ( cVein * ( 0.22 + 0.9 * cBeat ) + cRim * 0.4 ) );
	// relief: the tissue swells off the surface and the veins stand proud of it (bump from the screen-space
	// gradient of the overlay height, scaled by the true pixel footprint)
	float cH = cGrown * ( 0.006 + c.b * 0.012 ) + cVein * 0.007;
	vec3 cR1 = cross( cSy, mxN ), cR2 = cross( mxN, cSx );
	float cDet = dot( cSx, cR1 );
	vec3 cGrad = sign( cDet ) * ( dFdx( cH ) * cR1 + dFdy( cH ) * cR2 );
	mxN = normalize( abs( cDet ) * mxN - cGrad );
}
`;

/** Build a corruption patch. The returned patch's `corA.x` uniform is the animatable amount. */
export function corruptPatch(veins: AurUniform, p: CorruptParams): SurfacePatch {
  return {
    key: 'corrupt',
    order: 50,
    uniforms: {
      aurVeinTex: veins,
      corA: { value: new THREE.Vector4(p.amount, 1 / p.scale, p.intensity, 2.1) },
      corGlow: { value: new THREE.Color(p.glow) },
      corDark: { value: new THREE.Color(p.dark) },
    },
    fragmentPars: PARS,
    surface: SURFACE,
    params: {
      corruption: { uniform: 'corA', comp: 'x' },
      corruptionGlow: { uniform: 'corA', comp: 'z' },
    },
  };
}
