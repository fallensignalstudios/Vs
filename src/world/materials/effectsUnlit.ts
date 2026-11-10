/**
 * Effect patches for UNLIT (MeshBasic-hosted) materials: hologram, shield energy field, quarantine barrier.
 * They write `diffuseColor` (HDR rgb + alpha) directly; fog, tone mapping and colour-space conversion still come
 * from three's own chunks.
 */
import * as THREE from 'three';
import type { AurUniform, SurfacePatch } from './patch';

export interface HologramParams {
  /** scanlines per metre */
  lines?: number;
  /** scanline scroll speed, m/s */
  scroll?: number;
  /** 0 … 1 brightness flicker (kept small; never a strobe) */
  flicker?: number;
  /** fresnel edge boost */
  edge?: number;
  /** HDR gain (values > 1 bloom) */
  gain?: number;
}

/** Additive scanlined data display. */
export function hologramPatch(p: HologramParams = {}): SurfacePatch {
  return {
    key: 'holo',
    order: 20,
    uniforms: {
      holoA: { value: new THREE.Vector4(p.lines ?? 110, p.scroll ?? 0.05, p.flicker ?? 0.05, p.edge ?? 0.6) },
      holoB: { value: new THREE.Vector4(p.gain ?? 0.85, 1, 0, 0) },
    },
    fragmentPars: /* glsl */ `
uniform vec4 holoA; // x lines/m · y scroll m/s · z flicker · w edge boost
uniform vec4 holoB; // x gain · y reveal 0…1
`,
    surface: /* glsl */ `
{
	float hY = mxPos.y;
	float hScan = 0.5 + 0.5 * sin( ( hY - aurTime * holoA.y ) * holoA.x * 6.2831853 );
	hScan = mix( hScan, 0.5, saturate( fwidth( hY ) * holoA.x * 1.6 - 0.3 ) );
	// a soft brighter band sweeping slowly upward
	float hBand = fract( hY * 0.3 - aurTime * 0.11 );
	hBand = smoothstep( 0.0, 0.1, hBand ) * smoothstep( 0.32, 0.1, hBand );
	float hFlick = 1.0 - holoA.z * ( 0.5 + 0.5 * sin( aurTime * 13.0 ) * sin( aurTime * 7.3 + 1.0 ) );
	float hGrain = aurHash22( floor( mxPos.xy * 160.0 ) + floor( aurTime * 10.0 ) ).x;
	float hFres = pow( 1.0 - mxNdotV, 2.0 );
	float hA = ( 0.2 + 0.42 * hScan ) * ( 0.7 + 0.6 * hBand ) * hFlick * ( 0.93 + 0.07 * hGrain ) + hFres * holoA.w * 0.6;
	diffuseColor.rgb *= holoB.x * ( 0.6 + 0.4 * hA );
	diffuseColor.a *= saturate( hA ) * holoB.y;
}
`,
    params: {
      reveal: { uniform: 'holoB', comp: 'y' },
      gain: { uniform: 'holoB', comp: 'x' },
      flicker: { uniform: 'holoA', comp: 'z' },
    },
  };
}

export interface ShieldParams {
  /** hex cell size, m */
  cell?: number;
  /** HDR gain */
  gain?: number;
  /** base fill opacity of the field between cell edges */
  fill?: number;
  /** fresnel power of the rim */
  rim?: number;
}

/**
 * Hex-cell energy field with a fresnel rim. `shieldHit` = (hit point in the material's mapping space, start time):
 * a ring expands from the point and lights the cells it crosses.
 */
export function shieldPatch(p: ShieldParams = {}): SurfacePatch {
  const hit: AurUniform = { value: new THREE.Vector4(0, 0, 0, -100) };
  return {
    key: 'shield',
    order: 20,
    uniforms: {
      shieldA: { value: new THREE.Vector4(p.cell ?? 0.11, p.gain ?? 1.5, p.fill ?? 0.035, p.rim ?? 2.4) },
      shieldB: { value: new THREE.Vector4(1, 1, 0, 0) },
      shieldHit: hit,
    },
    fragmentPars: /* glsl */ `
uniform vec4 shieldA;   // x cell size m · y gain · z fill · w rim power
uniform vec4 shieldB;   // x hit strength · y integrity 0…1 (flickers out as it drops)
uniform vec4 shieldHit; // xyz hit point (mapping space) · w start time
vec3 aurHex( vec2 p ) {
	const vec2 s = vec2( 1.0, 1.7320508 );
	vec4 hc = floor( vec4( p, p - vec2( 0.5, 1.0 ) ) / s.xyxy ) + 0.5;
	vec4 h = vec4( p - hc.xy * s, p - ( hc.zw + 0.5 ) * s );
	vec4 r = dot( h.xy, h.xy ) < dot( h.zw, h.zw ) ? vec4( h.xy, hc.xy ) : vec4( h.zw, hc.zw + 0.5 );
	vec2 a = abs( r.xy );
	return vec3( 0.5 - max( dot( a, s * 0.5 ), a.x ), r.zw ); // x: 0 on a cell edge → 0.5 at its centre
}
`,
    surface: /* glsl */ `
{
	vec3 sW = abs( mxGeoN );
	vec2 sUv = sW.x > sW.y ? ( sW.x > sW.z ? mxPos.zy : mxPos.xy ) : ( sW.y > sW.z ? mxPos.xz : mxPos.xy );
	vec3 sHex = aurHex( sUv / shieldA.x );
	float sFoot = fwidth( sUv.x ) / shieldA.x;
	float sEdge = mix( smoothstep( 0.09, 0.0, sHex.x ), 0.25, saturate( sFoot * 2.0 - 0.4 ) );
	float sCell = aurHash22( sHex.yz * 2.0 ).x; // cell centres sit on half-integers
	float sFlow = 0.5 + 0.5 * sin( aurTime * ( 1.2 + sCell * 2.0 ) + sCell * 40.0 );
	float sFres = pow( 1.0 - mxNdotV, shieldA.w );
	float sAge = aurTime - shieldHit.w;
	float sDist = distance( mxPos, shieldHit.xyz );
	float sRing = exp( - pow( ( sDist - sAge * 2.6 ) * 5.0, 2.0 ) ) * exp( - sAge * 3.0 ) * step( 0.0, sAge ) * shieldB.x;
	float sFlash = exp( - sDist * 5.0 ) * exp( - sAge * 9.0 ) * step( 0.0, sAge ) * shieldB.x;
	float sGate = smoothstep( 0.0, 0.35, shieldB.y - ( 1.0 - shieldB.y ) * sCell );
	float sA = ( shieldA.z * ( 0.5 + 1.5 * sFlow * sCell ) + sEdge * ( 0.1 + 0.55 * sFres ) + sFres * 0.4 + sRing * ( 0.6 + sEdge ) + sFlash ) * sGate;
	diffuseColor.rgb *= shieldA.y * ( 0.5 + sEdge * 0.5 + sRing * 1.8 + sFlash * 2.2 );
	diffuseColor.a *= saturate( sA );
}
`,
    params: {
      integrity: { uniform: 'shieldB', comp: 'y' },
      gain: { uniform: 'shieldA', comp: 'y' },
    },
  };
}

export interface BarrierParams {
  /** spacing of the vertical light seams, m */
  column?: number;
  /** speed of the rising shimmer, m/s */
  rise?: number;
  /** body opacity */
  opacity?: number;
  /** HDR gain */
  gain?: number;
}

/**
 * Quarantine barrier: a soft wall of white-gold light divided by regular bright vertical seams (reads as a
 * closed gate by SHAPE, not colour alone), with a slow upward shimmer. `amount` 0…1 raises/lowers it.
 */
export function barrierPatch(macro: AurUniform, p: BarrierParams = {}): SurfacePatch {
  return {
    key: 'barrier',
    order: 20,
    uniforms: {
      barA: { value: new THREE.Vector4(p.column ?? 0.75, p.rise ?? 0.5, p.opacity ?? 0.3, p.gain ?? 0.95) },
      barB: { value: new THREE.Vector4(1, 0, 0, 0) },
      aurMacroTex: macro,
    },
    fragmentPars: /* glsl */ `
uniform vec4 barA; // x column spacing m · y rise speed m/s · z body opacity · w gain
uniform vec4 barB; // x amount 0…1
uniform sampler2D aurMacroTex;
`,
    surface: /* glsl */ `
{
	float bU = abs( mxGeoN.x ) > abs( mxGeoN.z ) ? mxPos.z : mxPos.x;
	float bY = mxPos.y;
	float bCol = abs( fract( bU / barA.x ) - 0.5 ) * 2.0;            // 0 mid-column → 1 on a seam
	float bFoot = fwidth( bU ) / barA.x;
	float bSeam = mix( pow( bCol, 10.0 ), 0.12, saturate( bFoot * 3.0 - 0.5 ) );
	float bBody = 0.62 + 0.38 * cos( bCol * 3.14159265 );
	float bN = texture2D( aurMacroTex, vec2( bU * 0.19, bY * 0.11 - aurTime * barA.y * 0.11 ) ).r;
	float bN2 = texture2D( aurMacroTex, vec2( bU * 0.07 + 0.4, bY * 0.31 - aurTime * barA.y * 0.2 ) ).g;
	float bRise = 0.55 + 0.9 * bN * bN2 * 2.0;
	// thin horizontal bars every half metre: the "do not cross" rhythm, drifting slowly upward
	float bH = abs( fract( bY * 2.0 - aurTime * barA.y * 0.25 ) - 0.5 ) * 2.0;
	float bBars = smoothstep( 0.9, 1.0, bH ) * 0.5;
	float bFres = pow( 1.0 - mxNdotV, 1.5 );
	float bA = ( barA.z * bBody * bRise + bSeam * 0.6 + bBars * 0.22 + bFres * 0.25 ) * barB.x;
	diffuseColor.rgb *= barA.w * ( 0.7 + bSeam * 2.2 + bBars * 0.8 + bRise * 0.2 );
	diffuseColor.a *= saturate( bA );
}
`,
    params: {
      amount: { uniform: 'barB', comp: 'x' },
      gain: { uniform: 'barA', comp: 'w' },
    },
  };
}
