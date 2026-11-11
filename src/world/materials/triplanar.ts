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
 *  - ADDED (integration wave): an optional photographic PBR set (`public/textures/`, see surfaces.ts) layered
 *    over the procedural family. The photo supplies colour, normal, AO, roughness variation (and metalness for
 *    metal sets); the procedural family stays as a blend (its veins modulate the photo's brightness, its normals
 *    add in) and still provides the accent / wear mask. Tiling is broken up per slab (random offset, quarter
 *    turns for isotropic sets) or, without slabs, per projection axis plus a second rotated sample faded in by
 *    a macro field. The set's `info.x` uniform fades the photo in when it has loaded (no recompile).
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
  /** ADDED (polish 3): grime settled along the seams — darkening 0 … 1 (default 0) and its reach in metres (default 0.09) */
  grime?: number;
  grimeWidth?: number;
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

/** ADDED (integration wave): how a material wears a photographic PBR set. */
export interface PbrLayerParams {
  /** metres per repeat of the photo (default: the set's manifest `tileMeters`) */
  scale: number;
  /** sRGB tint multiplied onto the photo's albedo (default white) */
  tint?: number;
  /** brightness gain on top of the tint (default 1; > 1 lifts a dark photo) */
  gain?: number;
  /** saturation of the photo's albedo, 0 … 1+ (default 1) */
  saturation?: number;
  /** 0 … 1: how much of the procedural family stays blended in (its veins / speckle and normals; default 0.35) */
  blend?: number;
  /** normal strength of the photo (default 1) */
  normal?: number;
  /** amplitude of the photo's roughness variation around the material's `roughness` (default 1) */
  roughAmp?: number;
  /** metal sets: scale of the photo's metalness (default 1) */
  metal?: number;
  /** isotropic photos (marble, frost, tissue, bronze): quarter turns per slab and a rotated second sample */
  isotropic?: boolean;
  /** use the set's emissive map as the accent mask (eclipse_tissue's violet veins) */
  emissiveMask?: boolean;
  /** the photo replaces the material's `color` instead of being tinted by it (default false) */
  replaceColor?: boolean;
  /**
   * 0 … 1: how much of the albedo comes from the photo (default 1); the rest is the procedural family's albedo
   * under the same tint — softens a photo's own texture (the ashlar's pitting) toward the procedural marble
   */
  photo?: number;
  /** contrast of the photo's albedo around its mean luminance (default 1; < 1 softens veins and joints) */
  contrast?: number;
  /** the set's mean albedo luminance (linear; the pivot of `contrast` — filled in from surfaces.ts) */
  meanLuminance?: number;
}

/** The uniforms of a set, shared by every material wearing it (surfaces.ts owns their values). */
export interface PbrLayerUniforms {
  albedo: AurUniform;
  normal: AurUniform;
  orm: AurUniform;
  emissive: AurUniform;
  info: AurUniform;
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
	uniform vec4 tpPanel3;  // x grime darkening · y grime reach (m)
#endif
#ifdef AUR_MASK
	uniform vec4 tpMaskCol;  // rgb accent colour · a amount
	uniform vec4 tpMaskPbr;  // x roughness · y metalness · z glow intensity · w pulse depth
	uniform vec3 tpMaskGlow;
#endif
#ifdef AUR_PBR
	uniform sampler2D tpXAlbedo;
	uniform sampler2D tpXNormal;
	uniform sampler2D tpXOrm;
	uniform vec4 tpXSet;   // x loaded 0 … 1 · y map mean roughness · z 1 = metal set · w 1 = emissive mask present
	uniform vec4 tpX;      // x repeats/m · y procedural blend · z saturation · w normal strength
	uniform vec4 tpX2;     // x roughness amplitude · y metalness scale · z 1 = the photo replaces the material colour · w photo albedo amount
	uniform vec3 tpXTint;  // linear tint × gain
	uniform vec4 tpX3;     // x photo mean luminance · y photo contrast
	uniform vec4 tpFam;    // x mean luminance of the procedural family's albedo
	#ifdef AUR_PBR_EMIT
		uniform sampler2D tpXEmit;
	#endif
	mat2 aurRot2( float a ) { float c = cos( a ), s = sin( a ); return mat2( c, s, - s, c ); }
#endif

// pbr = ao, rough delta, metal multiplier, mask · aux = seam, wear, phase · xm = photo metalness (metal sets)
struct AurTp { vec3 alb; vec3 tn; vec4 pbr; vec3 aux; float xm; };

AurTp aurTpAxis( vec2 uvm, vec2 gx, vec2 gy, float axisSeed ) {
	AurTp s;
	vec2 uv = uvm * tpA.x;
	float tint = 1.0;
	float grime = 0.0;
	vec2 bevelN = vec2( 0.0 );
	// a random number per slab (or per projection axis without slabs): offsets / turns the photographic layer
	vec2 cellH = fract( vec2( 0.618, 0.414 ) * axisSeed + 0.13 );
	s.aux = vec3( 0.0 );
	s.xm = 0.0;
	#ifdef AUR_PANEL
		vec2 q = uvm / tpPanel.xy;
		q.x += tpPanel2.z * 0.5 * mod( floor( q.y ), 2.0 );
		vec2 pid = floor( q );
		vec2 pf = q - pid;
		vec2 de = min( pf, 1.0 - pf ) * tpPanel.xy;
		float e = min( de.x, de.y );
		vec2 pdir = de.x < de.y ? vec2( pf.x < 0.5 ? 1.0 : - 1.0, 0.0 ) : vec2( 0.0, pf.y < 0.5 ? 1.0 : - 1.0 );
		vec2 ph = aurHash22( pid + 17.0 );
		cellH = fract( ph * 1.73 + axisSeed * 0.31 );
		uv += ph * 5.0 * tpPanel2.y;
		tint += ( ph.x - 0.5 ) * tpPanel2.x;
		float px = max( length( gx ), length( gy ) ) + 1e-6; // pixel footprint, metres
		float sw = tpPanel.z;
		s.aux.x = ( 1.0 - smoothstep( sw - px * 0.5, sw + px * 0.5, e ) ) * min( 1.0, 3.0 * sw / px );
		float bt = clamp( ( e - sw ) / tpPanel.w, 0.0, 1.0 );
		bevelN = - pdir * ( 1.0 - bt ) * ( 1.0 - bt ) * step( sw, e ) * tpPanel2.w * clamp( tpPanel.w / px, 0.0, 1.0 );
		s.aux.y = 1.0 - smoothstep( 0.0, tpWear.x, e - sw );
		// grime settles along the seam, fading out over the grime reach (crisp or soft, whatever the distance)
		grime = tpPanel3.x * ( 1.0 - smoothstep( sw, sw + max( tpPanel3.y, px ), e ) );
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
	vec3 bAlb = a.rgb;
	vec3 bN = n.xyz * 2.0 - 1.0;
	bN.xy *= tpA.y;
	float bAo = o.r;
	float bRough = ( o.g - 0.5 ) * tpA.z;
	float bMask = o.a;
	#ifdef AUR_PBR
	{
		float k = tpXSet.x;
		float xs = tpX.x;
		#ifdef AUR_PBR_ISO
			mat2 R = aurRot2( floor( cellH.x * 4.0 ) * 1.5707963 );
		#else
			mat2 R = mat2( 1.0 );
		#endif
		vec2 xuv = R * uvm * xs + cellH * 7.31;
		vec2 xdx = R * gx * xs, xdy = R * gy * xs;
		vec4 xa = textureGrad( tpXAlbedo, xuv, xdx, xdy );
		vec3 xn = textureGrad( tpXNormal, xuv, xdx, xdy ).xyz * 2.0 - 1.0;
		vec4 xo = textureGrad( tpXOrm, xuv, xdx, xdy );
		xn.xy = xn.xy * R; // back from the turned photo frame into the projection frame
		#if defined( AUR_PBR_ISO ) && ! defined( AUR_PANEL ) && ! defined( AUR_PBR_EMIT )
			// no slabs to hide the repeat: fade in a second, turned and rescaled sample along a macro field
			mat2 R2 = aurRot2( 2.17 + axisSeed * 1.31 );
			float s2 = xs * 0.731;
			vec2 yuv = R2 * uvm * s2 + vec2( 0.37, 0.61 );
			vec2 ydx = R2 * gx * s2, ydy = R2 * gy * s2;
			float wt = smoothstep( 0.4, 0.6, m2.a * 0.6 + m1.b * 0.4 );
			vec3 yn = textureGrad( tpXNormal, yuv, ydx, ydy ).xyz * 2.0 - 1.0;
			yn.xy = yn.xy * R2;
			xa.rgb = mix( xa.rgb, textureGrad( tpXAlbedo, yuv, ydx, ydy ).rgb, wt );
			xn = mix( xn, yn, wt );
		#endif
		// the procedural family's veins and speckle modulate the photo's brightness
		float pl = dot( a.rgb, vec3( 0.2126, 0.7152, 0.0722 ) ) / max( tpFam.x, 0.02 );
		xa.rgb = max( tpX3.x + ( xa.rgb - tpX3.x ) * tpX3.y, vec3( 0.0 ) );
		vec3 xr = mix( a.rgb, xa.rgb * mix( 1.0, clamp( pl, 0.25, 2.0 ), tpX.y ), tpX2.w );
		vec3 xc = mix( vec3( dot( xr, vec3( 0.2126, 0.7152, 0.0722 ) ) ), xr, tpX.z ) * tpXTint;
		xc = mix( xc, xc / max( diffuse, vec3( 0.02 ) ), tpX2.z );
		bAlb = mix( bAlb, xc, k );
		xn.xy = xn.xy * tpX.w + bN.xy * tpX.y;
		bN = mix( bN, xn, k );
		bAo = mix( bAo, xo.r, k );
		bRough = mix( bRough, ( xo.g - tpXSet.y ) * tpX2.x + bRough * tpX.y, k );
		s.xm = xo.b * tpX2.y;
		#ifdef AUR_PBR_EMIT
			vec3 xe = textureGrad( tpXEmit, xuv, xdx, xdy ).rgb;
			// the photo's fine veins over the family's bold ones (corruption must still read at a glance)
			bMask = mix( bMask, max( bMask * 0.8, clamp( max( xe.r, xe.b ) * 3.2, 0.0, 1.0 ) ), k * tpXSet.w );
		#endif
	}
	#endif
	s.alb = bAlb * tint * ( 1.0 + ( m1.r + m2.g - 1.0 ) * tpMacro.x + ( d.a - 0.5 ) * tpDetail.w );
	s.alb *= 1.0 - grime * clamp( 0.45 + 1.1 * d.a * m1.b, 0.0, 1.0 );
	s.alb *= mix( vec3( 1.0 ), vec3( 1.04, 1.0, 0.93 ), ( m2.b - 0.5 ) * 2.0 * tpMacro.w );
	s.tn = bN;
	s.tn.xy = s.tn.xy + ( d.xy * 2.0 - 1.0 ) * tpDetail.y + bevelN;
	s.pbr = vec4( bAo * ( 1.0 - grime * 0.5 ), bRough + ( m1.g + m2.r - 1.0 ) * tpMacro.y + ( d.b - 0.5 ) * tpDetail.z + grime * 0.35, o.b, bMask );
	s.aux.z = m1.a;
	return s;
}
`;

const SURFACE = /* glsl */ `
{
	vec3 tpW = aurTriWeights( mxGeoN );
	vec3 tpGx = dFdx( mxPos ), tpGy = dFdy( mxPos );
	vec3 tAlb = vec3( 0.0 ), tN = vec3( 0.0 ), tAux = vec3( 0.0 );
	vec4 tPbr = vec4( 0.0 );
	float tXm = 0.0;
	if ( tpW.x > 0.0 ) {
		AurTp s = aurTpAxis( mxPos.zy, tpGx.zy, tpGy.zy, 1.0 );
		tAlb += s.alb * tpW.x; tPbr += s.pbr * tpW.x; tAux += s.aux * tpW.x; tXm += s.xm * tpW.x;
		tN += vec3( abs( s.tn.z ) * mxGeoN.x, s.tn.y + mxGeoN.y, s.tn.x + mxGeoN.z ) * tpW.x;
	}
	if ( tpW.y > 0.0 ) {
		AurTp s = aurTpAxis( mxPos.xz, tpGx.xz, tpGy.xz, 2.0 );
		tAlb += s.alb * tpW.y; tPbr += s.pbr * tpW.y; tAux += s.aux * tpW.y; tXm += s.xm * tpW.y;
		tN += vec3( s.tn.x + mxGeoN.x, abs( s.tn.z ) * mxGeoN.y, s.tn.y + mxGeoN.z ) * tpW.y;
	}
	if ( tpW.z > 0.0 ) {
		AurTp s = aurTpAxis( mxPos.xy, tpGx.xy, tpGy.xy, 3.0 );
		tAlb += s.alb * tpW.z; tPbr += s.pbr * tpW.z; tAux += s.aux * tpW.z; tXm += s.xm * tpW.z;
		tN += vec3( s.tn.x + mxGeoN.x, s.tn.y + mxGeoN.y, abs( s.tn.z ) * mxGeoN.z ) * tpW.z;
	}
	mxN = normalize( tN );
	mxMask = tPbr.a;
	float tRough = roughnessFactor + tPbr.g;
	float tMetal = metalnessFactor * tPbr.b;
	#ifdef AUR_PBR
		// a metal set's own metalness map wins over the material's (bronze plate, navy hull, black-gold inlay)
		tMetal = mix( tMetal, tXm, tpXSet.x * tpXSet.z );
	#endif
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
	mxAO *= tAo;
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
  /** ADDED (integration wave): x = mean luminance of the baked albedo (1 for the placeholder) */
  stats: AurUniform;
}

export function familyUniforms(set: TextureSet): FamilyUniforms {
  return {
    albedo: { value: set.albedo, shared: true },
    normal: { value: set.normal, shared: true },
    orm: { value: set.orm, shared: true },
    stats: { value: new THREE.Vector4(1, 0, 0, 0), shared: true },
  };
}

/** Mean linear luminance of a packed sRGB albedo (sampled sparsely; for the photo blend). */
export function meanLuminance(albedo: Uint8Array): number {
  const toLin = (v: number): number => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  let sum = 0, n = 0;
  const step = Math.max(4, Math.floor(albedo.length / 4 / 4096) * 4);
  for (let i = 0; i + 2 < albedo.length; i += step) {
    sum += 0.2126 * toLin(albedo[i]) + 0.7152 * toLin(albedo[i + 1]) + 0.0722 * toLin(albedo[i + 2]);
    n++;
  }
  return n ? sum / n : 1;
}

const lin = (hex: number): THREE.Color => new THREE.Color(hex);

/**
 * Build the triplanar patch for one material. `pbr` (integration wave) layers a photographic set over the
 * family; `pbr.uniforms` are the set's shared holders, `pbr.params` this material's way of wearing it.
 */
export function triplanarPatch(
  familyKey: string, fam: FamilyUniforms, shared: TriplanarShared, p: TriplanarParams,
  pbr?: { uniforms: PbrLayerUniforms; params: PbrLayerParams },
): SurfacePatch {
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
    uniforms.tpPanel3 = { value: new THREE.Vector4(pn.grime ?? 0, pn.grimeWidth ?? 0.09, 0, 0) };
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
  // metres per repeat of the photo relative to the family's (a `scale` override keeps the ratio)
  let pbrRatio = 1;
  if (pbr) {
    const x = pbr.params;
    defines.AUR_PBR = 1;
    key += `:x${x.isotropic ? 'i' : ''}${x.emissiveMask ? 'e' : ''}`;
    if (x.isotropic) defines.AUR_PBR_ISO = 1;
    uniforms.tpXAlbedo = pbr.uniforms.albedo;
    uniforms.tpXNormal = pbr.uniforms.normal;
    uniforms.tpXOrm = pbr.uniforms.orm;
    uniforms.tpXSet = pbr.uniforms.info;
    uniforms.tpFam = fam.stats;
    if (x.emissiveMask) {
      defines.AUR_PBR_EMIT = 1;
      uniforms.tpXEmit = pbr.uniforms.emissive;
    }
    pbrRatio = Math.max(0.01, x.scale) / Math.max(0.01, p.scale);
    uniforms.tpX = { value: new THREE.Vector4(1 / Math.max(0.01, x.scale), x.blend ?? 0.35, x.saturation ?? 1, x.normal ?? 1) };
    uniforms.tpX2 = { value: new THREE.Vector4(x.roughAmp ?? 1, x.metal ?? 1, x.replaceColor ? 1 : 0, x.photo ?? 1) };
    uniforms.tpX3 = { value: new THREE.Vector4(x.meanLuminance ?? 0.18, x.contrast ?? 1, 0, 0) };
    const t = lin(x.tint ?? 0xffffff).multiplyScalar(Math.max(0, x.gain ?? 1));
    uniforms.tpXTint = { value: new THREE.Vector3(t.r, t.g, t.b) };
  }
  return {
    key, order: 10, defines, uniforms, fragmentPars: PARS, surface: SURFACE,
    params: {
      scale: {
        uniform: 'tpA', comp: 'x', map: (v) => 1 / Math.max(0.001, v),
        also: pbr ? [{ uniform: 'tpX', comp: 'x', map: (v) => 1 / Math.max(0.001, v * pbrRatio) }] : undefined,
      },
      normalStrength: { uniform: 'tpA', comp: 'y' },
      maskGlow: { uniform: 'tpMaskPbr', comp: 'z' },
      maskPulse: { uniform: 'tpMaskPbr', comp: 'w' },
    },
  };
}
