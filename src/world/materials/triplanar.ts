/**
 * Triplanar PBR mapping patch: samples a family's albedo / normal / ORM maps along the three axes of the mapping
 * space (world, or object for moving meshes) so kit geometry needs no UVs.
 *
 *  - explicit-gradient sampling inside per-axis branches: an axis-aligned wall pays for ONE projection, not three
 *  - whiteout normal blending (correct tangent-space → mapping-space reorientation, no seams on bevels)
 *  - macro variation from a shared low-frequency texture at two incommensurate scales, plus a shared micro-detail
 *    layer → no visible repetition across a 60 m hall, real micro-roughness at 1 m
 *  - optional analytic slab / panel layer: crisp anti-aliased seams and bevels at any distance, a random texture
 *    offset and tint per slab (so stone veining never repeats slab to slab), and edge wear (gold leaf, bare metal)
 *  - optional accent driven by the family mask channel (gold flecks, chips, glowing veins and cracks)
 */
import * as THREE from 'three';
import type { TextureSet } from './bake';
import type { AurUniform, SurfacePatch } from './patch';

export interface PanelParams {
  /** slab size in metres along the two in-plane axes (u, v — v is up on walls) */
  w: number;
  h: number;
  /** half width of the seam groove, metres (default 0.004) */
  seam?: number;
  /** bevel width, metres (default 0.02) */
  bevel?: number;
  /** bevel slope / normal strength (default 0.6) */
  depth?: number;
  /** per-slab brightness variation (default 0.05) */
  tint?: number;
  /** 0 … 1 random texture offset per slab (default 1) */
  jitter?: number;
  /** 1 = brick bond (default 0) */
  stagger?: number;
  /** seam darkening 0 … 1 (default 0.6) */
  dark?: number;
  /** wear along slab edges: colour blended in near seams, broken up by the family mask */
  wear?: { color: number; width: number; strength: number; roughness: number; metalness: number };
}

export interface MaskParams {
  /** accent colour blended over the albedo where the family mask is set */
  color?: number;
  /** blend amount 0 … 1 (default 1) */
  amount?: number;
  roughness?: number;
  metalness?: number;
  /** emissive colour of the masked areas */
  glow?: number;
  /** emissive intensity (default 0 = off) */
  glowIntensity?: number;
  /** 0 … 1 depth of the slow pulse on the glow */
  pulse?: number;
}

export interface TriplanarParams {
  /** metres per texture repeat */
  scale: number;
  /** normal-map strength (default 1) */
  normal?: number;
  /** amplitude of the baked roughness variation around the material's `roughness` (default 0.3) */
  roughAmp?: number;
  /** baked AO strength (default 1) */
  ao?: number;
  /** large-scale variation: albedo ±, roughness ±, metres per repeat (default 23), warm↔cool hue drift */
  macro?: { albedo?: number; rough?: number; scale?: number; hue?: number };
  /** micro detail: metres per repeat (default 0.31), normal strength, roughness ±, albedo ± */
  detail?: { scale?: number; normal?: number; rough?: number; albedo?: number };
  panel?: PanelParams;
  mask?: MaskParams;
}

const PARS = /* glsl */ `
uniform sampler2D tpAlbedo;
uniform sampler2D tpNormal;
uniform sampler2D tpOrm;
uniform sampler2D aurMacroTex;
uniform sampler2D aurDetailTex;
uniform vec4 tpA;      // x repeats/m · y normal strength · z roughness amplitude · w AO strength
uniform vec4 tpMacro;  // x albedo variation · y roughness variation · z repeats/m · w hue drift
uniform vec4 tpDetail; // x repeats/m · y normal strength · z roughness amplitude · w albedo amplitude
#ifdef AUR_PANEL
	uniform vec4 tpPanel;   // xy slab size (m) · z seam half width (m) · w bevel width (m)
	uniform vec4 tpPanel2;  // x tint variation · y uv jitter · z brick stagger · w bevel slope
	uniform vec4 tpWearCol; // rgb wear colour · a strength
	uniform vec4 tpWear;    // x wear width (m) · y wear roughness · z wear metalness · w seam darkening
#endif
#ifdef AUR_MASK
	uniform vec4 tpMaskCol;  // rgb accent colour · a amount
	uniform vec4 tpMaskPbr;  // x roughness · y metalness · z glow intensity · w pulse depth
	uniform vec3 tpMaskGlow;
#endif

struct AurTp { vec3 alb; vec3 tn; vec4 pbr; vec3 aux; }; // pbr = ao, rough delta, metal, mask · aux = seam, wear, phase

AurTp aurTpAxis( vec2 uvm, vec2 gx, vec2 gy ) {
	AurTp s;
	vec2 uv = uvm * tpA.x;
	float tint = 1.0;
	vec2 bevelN = vec2( 0.0 );
	s.aux = vec3( 0.0 );
	#ifdef AUR_PANEL
		vec2 q = uvm / tpPanel.xy;
		q.x += tpPanel2.z * 0.5 * mod( floor( q.y ), 2.0 );
		vec2 pid = floor( q );
		vec2 pf = q - pid;
		vec2 de = min( pf, 1.0 - pf ) * tpPanel.xy;
		float e = min( de.x, de.y );
		vec2 pdir = de.x < de.y ? vec2( pf.x < 0.5 ? 1.0 : - 1.0, 0.0 ) : vec2( 0.0, pf.y < 0.5 ? 1.0 : - 1.0 );
		vec2 ph = aurHash22( pid + 17.0 );
		uv += ph * 5.0 * tpPanel2.y;
		tint += ( ph.x - 0.5 ) * tpPanel2.x;
		float px = max( length( gx ), length( gy ) ) + 1e-6; // pixel footprint, metres
		float sw = tpPanel.z;
		s.aux.x = ( 1.0 - smoothstep( sw - px * 0.5, sw + px * 0.5, e ) ) * min( 1.0, 3.0 * sw / px );
		float bt = clamp( ( e - sw ) / tpPanel.w, 0.0, 1.0 );
		bevelN = - pdir * ( 1.0 - bt ) * ( 1.0 - bt ) * step( sw, e ) * tpPanel2.w * clamp( tpPanel.w / px, 0.0, 1.0 );
		s.aux.y = 1.0 - smoothstep( 0.0, tpWear.x, e - sw );
	#endif
	vec2 dx = gx * tpA.x, dy = gy * tpA.x;
	vec4 a = textureGrad( tpAlbedo, uv, dx, dy );
	vec4 n = textureGrad( tpNormal, uv, dx, dy );
	vec4 o = textureGrad( tpOrm, uv, dx, dy );
	float ms = tpMacro.z;
	vec4 m1 = textureGrad( aurMacroTex, uvm * ms, gx * ms, gy * ms );
	vec4 m2 = textureGrad( aurMacroTex, uvm.yx * ms * 0.283 + 0.37, gx.yx * ms * 0.283, gy.yx * ms * 0.283 );
	float ds = tpDetail.x;
	vec4 d = textureGrad( aurDetailTex, uvm * ds, gx * ds, gy * ds );
	s.alb = a.rgb * tint * ( 1.0 + ( m1.r + m2.g - 1.0 ) * tpMacro.x + ( d.a - 0.5 ) * tpDetail.w );
	s.alb *= mix( vec3( 1.0 ), vec3( 1.04, 1.0, 0.93 ), ( m2.b - 0.5 ) * 2.0 * tpMacro.w );
	s.tn = n.xyz * 2.0 - 1.0;
	s.tn.xy = s.tn.xy * tpA.y + ( d.xy * 2.0 - 1.0 ) * tpDetail.y + bevelN;
	s.pbr = vec4( o.r, ( o.g - 0.5 ) * tpA.z + ( m1.g + m2.r - 1.0 ) * tpMacro.y + ( d.b - 0.5 ) * tpDetail.z, o.b, o.a );
	s.aux.z = m1.a;
	return s;
}
`;

const SURFACE = /* glsl */ `
{
	vec3 tpW = aurTriWeights( aurGeoN );
	vec3 tpGx = dFdx( aurPos ), tpGy = dFdy( aurPos );
	vec3 tAlb = vec3( 0.0 ), tN = vec3( 0.0 ), tAux = vec3( 0.0 );
	vec4 tPbr = vec4( 0.0 );
	if ( tpW.x > 0.0 ) {
		AurTp s = aurTpAxis( aurPos.zy, tpGx.zy, tpGy.zy );
		tAlb += s.alb * tpW.x; tPbr += s.pbr * tpW.x; tAux += s.aux * tpW.x;
		tN += vec3( abs( s.tn.z ) * aurGeoN.x, s.tn.y + aurGeoN.y, s.tn.x + aurGeoN.z ) * tpW.x;
	}
	if ( tpW.y > 0.0 ) {
		AurTp s = aurTpAxis( aurPos.xz, tpGx.xz, tpGy.xz );
		tAlb += s.alb * tpW.y; tPbr += s.pbr * tpW.y; tAux += s.aux * tpW.y;
		tN += vec3( s.tn.x + aurGeoN.x, abs( s.tn.z ) * aurGeoN.y, s.tn.y + aurGeoN.z ) * tpW.y;
	}
	if ( tpW.z > 0.0 ) {
		AurTp s = aurTpAxis( aurPos.xy, tpGx.xy, tpGy.xy );
		tAlb += s.alb * tpW.z; tPbr += s.pbr * tpW.z; tAux += s.aux * tpW.z;
		tN += vec3( s.tn.x + aurGeoN.x, s.tn.y + aurGeoN.y, abs( s.tn.z ) * aurGeoN.z ) * tpW.z;
	}
	aurN = normalize( tN );
	aurMask = tPbr.a;
	float tRough = roughnessFactor + tPbr.g;
	float tMetal = metalnessFactor * tPbr.b;
	float tAo = mix( 1.0, tPbr.r, tpA.w );
	#ifdef AUR_PANEL
		float tWear = tAux.y * smoothstep( 0.25, 0.7, tPbr.a + tAux.y * 0.35 ) * tpWearCol.a;
		tAlb = mix( tAlb, tpWearCol.rgb / max( diffuseColor.rgb, vec3( 0.05 ) ), tWear );
		tRough = mix( tRough, tpWear.y, tWear );
		tMetal = mix( tMetal, tpWear.z, tWear );
		tAlb *= 1.0 - tAux.x * tpWear.w;
		tAo *= 1.0 - tAux.x * 0.75;
		tRough += tAux.x * 0.3;
	#endif
	diffuseColor.rgb *= tAlb;
	#ifdef AUR_MASK
		float tMk = tPbr.a * tpMaskCol.a;
		diffuseColor.rgb = mix( diffuseColor.rgb, tpMaskCol.rgb, tMk );
		tRough = mix( tRough, tpMaskPbr.x, tMk );
		tMetal = mix( tMetal, tpMaskPbr.y, tMk );
		float tPulse = 1.0 - tpMaskPbr.w * ( 0.5 + 0.5 * sin( aurTime * 1.7 - tAux.z * 18.0 ) );
		totalEmissiveRadiance += tpMaskGlow * ( tPbr.a * tPbr.a * tpMaskPbr.z * tPulse );
	#endif
	roughnessFactor = clamp( tRough, 0.03, 1.0 );
	metalnessFactor = saturate( tMetal );
	aurAO *= tAo;
}
`;

export interface TriplanarShared {
  macro: AurUniform;
  detail: AurUniform;
}

/** Uniform holders for one family's maps; shared by every material of the family so `init()` can swap them once. */
export interface FamilyUniforms {
  albedo: AurUniform;
  normal: AurUniform;
  orm: AurUniform;
}

export function familyUniforms(set: TextureSet): FamilyUniforms {
  return {
    albedo: { value: set.albedo, shared: true },
    normal: { value: set.normal, shared: true },
    orm: { value: set.orm, shared: true },
  };
}

const lin = (hex: number): THREE.Color => new THREE.Color(hex);

/** Build the triplanar patch for one material. */
export function triplanarPatch(familyKey: string, fam: FamilyUniforms, shared: TriplanarShared, p: TriplanarParams): SurfacePatch {
  const macro = p.macro ?? {};
  const detail = p.detail ?? {};
  const uniforms: Record<string, AurUniform> = {
    tpAlbedo: fam.albedo,
    tpNormal: fam.normal,
    tpOrm: fam.orm,
    aurMacroTex: shared.macro,
    aurDetailTex: shared.detail,
    tpA: { value: new THREE.Vector4(1 / p.scale, p.normal ?? 1, p.roughAmp ?? 0.3, p.ao ?? 1) },
    tpMacro: { value: new THREE.Vector4(macro.albedo ?? 0.1, macro.rough ?? 0.08, 1 / (macro.scale ?? 23), macro.hue ?? 0.3) },
    tpDetail: { value: new THREE.Vector4(1 / (detail.scale ?? 0.31), detail.normal ?? 0.12, detail.rough ?? 0.08, detail.albedo ?? 0.03) },
  };
  const defines: Record<string, string | number> = {};
  let key = `tp:${familyKey}`;
  if (p.panel) {
    const pn = p.panel;
    defines.AUR_PANEL = 1;
    key += ':p';
    uniforms.tpPanel = { value: new THREE.Vector4(pn.w, pn.h, pn.seam ?? 0.004, pn.bevel ?? 0.02) };
    uniforms.tpPanel2 = { value: new THREE.Vector4(pn.tint ?? 0.05, pn.jitter ?? 1, pn.stagger ?? 0, pn.depth ?? 0.6) };
    const w = pn.wear;
    const wc = lin(w?.color ?? 0xffffff);
    uniforms.tpWearCol = { value: new THREE.Vector4(wc.r, wc.g, wc.b, w?.strength ?? 0) };
    uniforms.tpWear = { value: new THREE.Vector4(w?.width ?? 0.05, w?.roughness ?? 0.4, w?.metalness ?? 1, pn.dark ?? 0.6) };
  }
  if (p.mask) {
    const m = p.mask;
    defines.AUR_MASK = 1;
    key += ':m';
    const mc = lin(m.color ?? 0xffffff);
    uniforms.tpMaskCol = { value: new THREE.Vector4(mc.r, mc.g, mc.b, m.color === undefined ? 0 : (m.amount ?? 1)) };
    uniforms.tpMaskPbr = { value: new THREE.Vector4(m.roughness ?? 0.5, m.metalness ?? 0, m.glowIntensity ?? 0, m.pulse ?? 0) };
    uniforms.tpMaskGlow = { value: lin(m.glow ?? 0x000000) };
  }
  return {
    key, order: 10, defines, uniforms, fragmentPars: PARS, surface: SURFACE,
    params: {
      scale: { uniform: 'tpA', comp: 'x', map: (v) => 1 / Math.max(0.001, v) },
      normalStrength: { uniform: 'tpA', comp: 'y' },
      maskGlow: { uniform: 'tpMaskPbr', comp: 'z' },
      maskPulse: { uniform: 'tpMaskPbr', comp: 'w' },
    },
  };
}
