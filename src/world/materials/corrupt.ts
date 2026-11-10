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
	vec3 cW = aurTriWeights( aurGeoN );
	vec3 cQ = aurPos * corA.y;
	vec3 cGx = dFdx( cQ ), cGy = dFdy( cQ );
	vec4 c = vec4( 0.0 );
	if ( cW.x > 0.0 ) c += textureGrad( aurVeinTex, cQ.zy, cGx.zy, cGy.zy ) * cW.x;
	if ( cW.y > 0.0 ) c += textureGrad( aurVeinTex, cQ.xz, cGx.xz, cGy.xz ) * cW.y;
	if ( cW.z > 0.0 ) c += textureGrad( aurVeinTex, cQ.xy, cGx.xy, cGy.xy ) * cW.z;
	float cTh = corA.x * 1.3 - 0.14;
	float cGrown = smoothstep( c.g - 0.1, c.g + 0.05, cTh );
	float cFront = cGrown * ( 1.0 - smoothstep( c.g + 0.02, c.g + 0.26, cTh ) );
	// tendrils run ahead of the tissue along the vein network
	float cLead = smoothstep( 0.5, 0.95, c.r ) * smoothstep( c.g - 0.3, c.g - 0.06, cTh );
	float cVein = max( smoothstep( 0.22, 0.8, c.r ) * cGrown, cLead );
	float cTissue = cGrown * ( 0.5 + 0.5 * c.b );
	float cCover = saturate( cTissue * 0.94 + cVein * 0.7 );
	diffuseColor.rgb = mix( diffuseColor.rgb, corDark * ( 0.5 + 0.9 * c.b ), cCover );
	roughnessFactor = mix( roughnessFactor, 0.2 + 0.32 * c.b, cTissue );
	metalnessFactor *= 1.0 - cTissue * 0.85;
	aurAO *= 1.0 - cTissue * 0.3;
	totalEmissiveRadiance *= 1.0 - cCover * 0.85;
	float cBeat = 0.5 + 0.5 * sin( aurTime * corA.w - c.a * 25.0 );
	cBeat *= cBeat;
	totalEmissiveRadiance += corGlow * ( corA.z * ( cVein * ( 0.3 + 0.95 * cBeat ) + cFront * 0.45 ) );
	// raise the veins and tissue: bump from the screen-space gradient of the overlay height
	float cH = ( cVein * 0.012 + cTissue * c.b * 0.006 );
	vec3 cSx = dFdx( aurPos ), cSy = dFdy( aurPos );
	vec3 cR1 = cross( cSy, aurN ), cR2 = cross( aurN, cSx );
	float cDet = dot( cSx, cR1 );
	vec3 cGrad = sign( cDet ) * ( dFdx( cH ) * cR1 + dFdy( cH ) * cR2 );
	aurN = normalize( abs( cDet ) * aurN - cGrad );
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
