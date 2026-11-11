/**
 * Effect patches for LIT materials: emissive glow patterns ("light as information"), frozen-atmosphere ice,
 * architectural glass, back-lit translucency, frost sparkle. Each returns a {@link SurfacePatch} for the host.
 */
import * as THREE from 'three';
import type { AurUniform, SurfacePatch } from './patch';

export type GlowMode = 'channel' | 'panel' | 'louvre' | 'segment' | 'vein';

export interface GlowParams {
  /** 0 … 1 depth of the travelling pulse / breathing */
  pulse?: number;
  /** pulse travel speed, m/s */
  speed?: number;
  /** distance between pulse packets, m */
  wavelength?: number;
  /** strength of the fine pattern (data ticks, louvre lines, LED segments) */
  pattern?: number;
  /** pattern period, m */
  period?: number;
  /** slow random flicker amplitude 0 … 1 (keep small) */
  flicker?: number;
  /**
   * ADDED (polish 3): nominal width (m) of the strips drawn with this material, 0 = off. Once a strip is
   * narrower than a pixel its glow fades toward its true average brightness, so a thin channel far away is a
   * steady faint line instead of a shimmer of popping hot pixels (and their bloom).
   */
  lineWidth?: number;
}

const GLOW_INDEX: Record<GlowMode, number> = { channel: 0, panel: 1, louvre: 2, segment: 3, vein: 4 };

const GLOW_PARS = /* glsl */ `
uniform vec4 glowA; // x pulse depth · y speed m/s · z wavelength m · w pattern strength
uniform vec4 glowB; // x pattern period m · y flicker · z line width m (0 = no distance fade) · w unused
`;

const GLOW_SURFACE = /* glsl */ `
{
	// distance along the strip: skewed weights so no common strip direction is degenerate
	float gs = dot( mxPos, vec3( 1.0, 0.8, 0.618 ) );
	float gPh = ( gs - aurTime * glowA.y ) / glowA.z;
	float g = 1.0;
	#if AUR_GLOW == 0
		// gold channel: slow breathing, bright packets travelling the route, faint stepping data ticks
		float gPacket = pow( 0.5 + 0.5 * sin( gPh * 6.2831853 ), 10.0 );
		float gBreath = 0.5 + 0.5 * sin( aurTime * 0.55 + gs * 0.13 );
		float gT = gs / glowB.x - aurTime * glowA.y * 0.35 / glowB.x;
		float gC = floor( gT );
		float gTick = mix( aurHash22( vec2( gC, 7.0 ) ).x, aurHash22( vec2( gC + 1.0, 7.0 ) ).x, smoothstep( 0.4, 0.6, gT - gC ) );
		g = 1.0 - glowA.x * 0.55 + glowA.x * ( 0.3 * gBreath + 1.6 * gPacket ) + ( gTick - 0.5 ) * glowA.w;
	#elif AUR_GLOW == 1
		// light panel / white point: steady, with a barely perceptible slow drift
		g = 1.0 - glowA.x * ( 0.5 + 0.5 * sin( aurTime * 0.7 + gs * 0.4 ) );
	#elif AUR_GLOW == 2
		// Dominion amber: hot filament louvres with a slow heat waver
		float gBars = 0.5 + 0.5 * cos( mxPos.y / glowB.x * 6.2831853 );
		float gFoot = fwidth( mxPos.y ) / glowB.x;
		gBars = mix( gBars, 0.5, saturate( gFoot * 1.6 - 0.3 ) );
		float gHeat = sin( aurTime * 3.1 + gs * 2.0 ) * sin( aurTime * 1.3 + gs * 0.7 );
		g = ( 1.0 - glowA.w + glowA.w * 2.0 * gBars * gBars ) * ( 1.0 + glowB.y * gHeat ) * ( 1.0 - glowA.x * ( 0.5 + 0.5 * sin( aurTime * 0.9 ) ) );
	#elif AUR_GLOW == 3
		// Reformation blue-white: segmented diode bar, clinical and steady
		float gSeg = abs( fract( mxPos.y / glowB.x ) - 0.5 ) * 2.0;
		float gFoot = fwidth( mxPos.y ) / glowB.x;
		float gCell = mix( smoothstep( 0.95, 0.72, gSeg ), 0.8, saturate( gFoot * 1.6 - 0.3 ) );
		g = ( 1.0 - glowA.w + glowA.w * gCell ) * ( 1.0 - glowA.x * ( 0.5 + 0.5 * sin( aurTime * 1.1 + floor( mxPos.y / glowB.x ) * 0.6 ) ) );
	#else
		// Eclipse vein: a double heartbeat pushed along the vein
		float gBeatA = pow( 0.5 + 0.5 * sin( gPh * 6.2831853 ), 6.0 );
		float gBeatB = pow( 0.5 + 0.5 * sin( gPh * 6.2831853 - 1.3 ), 6.0 ) * 0.6;
		float gKnot = 0.5 + 0.5 * sin( gs * 9.0 + sin( gs * 3.7 ) * 2.0 );
		g = 1.0 - glowA.x + glowA.x * 1.7 * max( gBeatA, gBeatB ) + ( gKnot - 0.5 ) * glowA.w;
	#endif
	if ( glowB.z > 0.0 ) {
		// pixel footprint in metres: the larger axis of the surface's screen-space derivative
		vec3 gdx = dFdx( mxPos ), gdy = dFdy( mxPos );
		float gPx = max( length( gdx ), length( gdy ) );
		// coverage of the strip in its pixel; keep a floor so far channels still read as a faint line
		float gCov = clamp( glowB.z / max( gPx, 1e-5 ), 0.0, 1.0 );
		g *= mix( 0.28, 1.0, gCov );
	}
	totalEmissiveRadiance *= max( g, 0.0 );
}
`;

/** Animated emissive pattern multiplying the material's own `emissive × emissiveIntensity`. */
export function glowPatch(mode: GlowMode, p: GlowParams = {}): SurfacePatch {
  return {
    key: `glow${GLOW_INDEX[mode]}`,
    order: 40,
    defines: { AUR_GLOW: GLOW_INDEX[mode] },
    uniforms: {
      glowA: { value: new THREE.Vector4(p.pulse ?? 0.3, p.speed ?? 1.5, p.wavelength ?? 6, p.pattern ?? 0.1) },
      glowB: { value: new THREE.Vector4(p.period ?? 0.2, p.flicker ?? 0, p.lineWidth ?? 0, 0) },
    },
    fragmentPars: GLOW_PARS,
    surface: GLOW_SURFACE,
    params: {
      pulse: { uniform: 'glowA', comp: 'x' },
      pulseSpeed: { uniform: 'glowA', comp: 'y' },
      pulseWavelength: { uniform: 'glowA', comp: 'z' },
      pattern: { uniform: 'glowA', comp: 'w' },
      flicker: { uniform: 'glowB', comp: 'y' },
      lineWidth: { uniform: 'glowB', comp: 'z' },
    },
  };
}

export interface IceParams {
  /** opacity of clear ice */
  opacity?: number;
  /** extra opacity where cloud is trapped */
  cloud?: number;
  /** fresnel rim strength */
  rim?: number;
  /** apparent depth of the internal cloud layers, m */
  depth?: number;
  /** sparkle intensity and glints per metre */
  sparkle?: number;
  sparkleDensity?: number;
  /** faint self-illumination of the trapped cloud (reads as light held inside the ice) */
  inner?: number;
  rimColor?: number;
  /** colour multiplier of clear (cloud-free) ice */
  deepColor?: number;
}

const ICE_PARS = /* glsl */ `
uniform vec4 iceA; // x clear opacity · y cloud opacity · z rim strength · w internal depth m
uniform vec4 iceB; // x sparkle intensity · y sparkle density 1/m · z inner glow · w unused
uniform vec3 iceRim;
uniform vec3 iceDeep;
float aurIceCloud( vec3 p, vec3 w ) {
	// single dominant-axis tap of the family cloud-density mask (ORM alpha), slightly blurred
	vec2 uv = w.x > w.y ? ( w.x > w.z ? p.zy : p.xy ) : ( w.y > w.z ? p.xz : p.xy );
	return textureLod( tpOrm, uv * tpA.x, 1.5 ).a;
}
`;

const ICE_POST = /* glsl */ `
{
	float iNdv = max( dot( mxGeoN, mxViewM ), 0.3 );
	vec3 iW = abs( mxGeoN );
	// two parallax layers marched into the slab along the view ray: trapped cloud at depth
	float iC1 = aurIceCloud( mxPos - mxViewM * ( iceA.w / iNdv ), iW );
	float iC2 = aurIceCloud( ( mxPos - mxViewM * ( iceA.w * 2.7 / iNdv ) ) * 0.63 + 1.7, iW );
	float iCloud = saturate( mxMask * 0.5 + iC1 * 0.38 + iC2 * 0.3 );
	float iFres = pow( 1.0 - mxNdotV, 3.0 );
	diffuseColor.rgb *= mix( iceDeep, vec3( 1.0 ), iCloud );
	diffuseColor.a = saturate( diffuseColor.a * ( iceA.x + iCloud * iceA.y ) + iFres * iceA.z );
	totalEmissiveRadiance += iceRim * ( iFres * iceA.z * 0.5 + iCloud * iCloud * iceB.z );
	// sparkle: sparse view-dependent glints on a 3-D lattice, faded before they alias
	vec3 iP = mxPos * iceB.y;
	float iH = aurHash31( floor( iP ) );
	float iTw = fract( iH * 61.7 + dot( mxViewM, vec3( 2.3, 3.7, 5.1 ) ) * 2.1 );
	float iDot = smoothstep( 0.5, 0.12, length( fract( iP ) - 0.5 ) );
	float iFoot = length( fwidth( mxPos ) ) * iceB.y;
	totalEmissiveRadiance += iceRim * ( step( 0.82, iH ) * smoothstep( 0.86, 1.0, iTw ) * iDot * saturate( 1.3 - iFoot ) * iceB.x );
}
`;

/** Frozen-atmosphere shading. Requires the triplanar patch (uses the family cloud mask and `tpOrm`). */
export function icePatch(p: IceParams = {}): SurfacePatch {
  return {
    key: 'ice',
    order: 60,
    uniforms: {
      iceA: { value: new THREE.Vector4(p.opacity ?? 0.26, p.cloud ?? 0.66, p.rim ?? 0.85, p.depth ?? 0.14) },
      iceB: { value: new THREE.Vector4(p.sparkle ?? 3, p.sparkleDensity ?? 110, p.inner ?? 0.07, 0) },
      iceRim: { value: new THREE.Color(p.rimColor ?? 0xcfeeff) },
      iceDeep: { value: new THREE.Color(p.deepColor ?? 0x6fb4dc) },
    },
    fragmentPars: ICE_PARS,
    post: ICE_POST,
    params: {
      iceOpacity: { uniform: 'iceA', comp: 'x' },
      iceCloud: { uniform: 'iceA', comp: 'y' },
      rim: { uniform: 'iceA', comp: 'z' },
      sparkle: { uniform: 'iceB', comp: 'x' },
    },
  };
}

/** Sparse view-dependent sparkle for opaque frosted surfaces (rime). */
export function sparklePatch(intensity: number, density: number, color: number): SurfacePatch {
  return {
    key: 'sparkle',
    order: 62,
    uniforms: {
      spkA: { value: new THREE.Vector4(intensity, density, 0, 0) },
      spkCol: { value: new THREE.Color(color) },
    },
    fragmentPars: /* glsl */ `
uniform vec4 spkA; // x intensity · y density 1/m
uniform vec3 spkCol;
`,
    post: /* glsl */ `
{
	vec3 sP = mxPos * spkA.y;
	float sH = aurHash31( floor( sP ) );
	float sTw = fract( sH * 61.7 + dot( mxViewM, vec3( 2.3, 3.7, 5.1 ) ) * 2.1 );
	float sDot = smoothstep( 0.5, 0.12, length( fract( sP ) - 0.5 ) );
	float sFoot = length( fwidth( mxPos ) ) * spkA.y;
	totalEmissiveRadiance += spkCol * ( step( 0.8, sH ) * smoothstep( 0.86, 1.0, sTw ) * sDot * saturate( 1.3 - sFoot ) * spkA.x * ( 0.3 + mxMask ) );
}
`,
    params: { sparkle: { uniform: 'spkA', comp: 'x' } },
  };
}

/** Architectural glass: nearly clear face-on, reflective and more opaque toward grazing angles. */
export function glassPatch(rim = 0.75): SurfacePatch {
  return {
    key: 'glass',
    order: 60,
    uniforms: { glassA: { value: new THREE.Vector4(rim, 4, 0, 0) } },
    fragmentPars: /* glsl */ `
uniform vec4 glassA; // x rim opacity · y fresnel power
`,
    post: /* glsl */ `
{
	float gFres = pow( 1.0 - mxNdotV, glassA.y );
	diffuseColor.a = saturate( diffuseColor.a + gFres * glassA.x );
}
`,
    params: { rim: { uniform: 'glassA', comp: 'x' } },
  };
}

/**
 * Back-lit translucency: every direct light also contributes when it is BEHIND the surface (wrapped back
 * lighting plus a forward-scatter lobe toward the viewer). This is what makes conduits glow through frost.
 */
export function translucencyPatch(color: number, strength: number): SurfacePatch {
  const c = new THREE.Color(color);
  const u: AurUniform = { value: new THREE.Vector4(c.r, c.g, c.b, strength) };
  return {
    key: 'trans',
    order: 5,
    uniforms: { aurTrans: u },
    lightPars: /* glsl */ `
uniform vec4 aurTrans; // rgb tint · a strength
void RE_Direct_AurTrans( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	RE_Direct_Physical( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	vec3 tH = normalize( directLight.direction + geometryNormal * 0.4 );
	float tThrough = pow( saturate( dot( geometryViewDir, - tH ) ), 3.0 ) * 1.5;
	float tWrap = saturate( dot( - geometryNormal, directLight.direction ) * 0.8 + 0.2 ) * 0.4;
	reflectedLight.directDiffuse += directLight.color * aurTrans.rgb * ( aurTrans.a * ( tThrough + tWrap ) * RECIPROCAL_PI );
}
#undef RE_Direct
#define RE_Direct RE_Direct_AurTrans
`,
    params: { translucency: { uniform: 'aurTrans', comp: 'w' } },
  };
}
