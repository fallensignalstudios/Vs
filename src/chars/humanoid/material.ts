/**
 * The one shader every humanoid uses: MeshStandardMaterial extended through onBeforeCompile.
 * Per-vertex roughness / metalness / emissive / occlusion come from the MeshBuilder attributes; procedural
 * detail (tonal wear, hammered plate, weave, ribbed undersuit, leather grain — albedo AND derivative bump) is
 * evaluated in bind-pose space so it sticks to the surface under skinning.
 * State overlays: flash, frozen (crystal growth), corruption (seam veins on one flank), dissolve (area-linear,
 * also applied to the shadow), glow, telegraph, rim, exposed.
 */
import * as THREE from 'three';

export interface FigureUniforms {
  uTime: { value: number };
  uFlash: { value: THREE.Vector4 };
  uFrozen: { value: number };
  uCorruption: { value: number };
  uDissolve: { value: number };
  uDissolveColor: { value: THREE.Color };
  uGlow: { value: number };
  uTelegraph: { value: THREE.Vector4 };
  uRim: { value: THREE.Vector4 };
  /** x = zone id (−1 none), y = amount */
  uExposed: { value: THREE.Vector2 };
  /** self-illumination of the albedo (luminous figures) */
  uLuminous: { value: number };
  /** per-instance pattern offset (corruption flank, frost, dissolve) */
  uSeed: { value: THREE.Vector3 };
  /** per-instance albedo tint of armour / cloth (squad variation on shared geometry) */
  uTint: { value: THREE.Color };
}

export interface FigureMaterial {
  material: THREE.MeshStandardMaterial;
  /** depth material for shadow passes: skinned, dissolves with the figure */
  depth: THREE.MeshDepthMaterial;
  uniforms: FigureUniforms;
}

const VERT_HEAD = /* glsl */ `
attribute vec3 aEmissive;
attribute vec4 aMat;
varying vec3 vEmis;
varying vec3 vRest;
varying vec3 vRestN;
varying vec3 vMatv;
flat varying float vCode;
uniform float uFrozen;
`;

const VERT_BEGIN = /* glsl */ `
vEmis = aEmissive;
vRest = position;
vRestN = normal;
vMatv = aMat.xyw;
vCode = aMat.z;
vec3 transformed = vec3( position ) + normal * ( uFrozen * 0.004 );
`;

const NOISE = /* glsl */ `
float hHash( vec3 p ) {
  p = fract( p * 0.3183099 + vec3( 0.1, 0.17, 0.23 ) );
  p *= 17.0;
  return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) );
}
float hNoise( vec3 x ) {
  vec3 i = floor( x ); vec3 f = fract( x );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( mix( hHash( i ), hHash( i + vec3( 1, 0, 0 ) ), f.x ), mix( hHash( i + vec3( 0, 1, 0 ) ), hHash( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
              mix( mix( hHash( i + vec3( 0, 0, 1 ) ), hHash( i + vec3( 1, 0, 1 ) ), f.x ), mix( hHash( i + vec3( 0, 1, 1 ) ), hHash( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z );
}
float hFbm( vec3 p ) {
  return 0.55 * hNoise( p ) + 0.3 * hNoise( p * 2.07 + 7.1 ) + 0.15 * hNoise( p * 4.3 + 3.7 );
}
// dissolve field remapped through the noise's own distribution, so "amount" is the fraction of surface gone
float hDissolve( vec3 p ) {
  float dn = hFbm( p * 11.0 ) * 0.8 + hNoise( p * 41.0 ) * 0.2;
  return 1.0 / ( 1.0 + exp( -( dn - DISSOLVE_MID ) * DISSOLVE_GAIN ) );
}
`;

const FRAG_HEAD = /* glsl */ `
varying vec3 vEmis;
varying vec3 vRest;
varying vec3 vRestN;
varying vec3 vMatv;
flat varying float vCode;
uniform float uTime;
uniform vec4 uFlash;
uniform float uFrozen;
uniform float uCorruption;
uniform float uDissolve;
uniform vec3 uDissolveColor;
uniform float uGlow;
uniform vec4 uTelegraph;
uniform vec4 uRim;
uniform vec2 uExposed;
uniform float uLuminous;
uniform vec3 uSeed;
uniform vec3 uTint;
${NOISE}
vec3 hHash3( vec3 p ) {
  p = vec3( dot( p, vec3( 127.1, 311.7, 74.7 ) ), dot( p, vec3( 269.5, 183.3, 246.1 ) ), dot( p, vec3( 113.5, 271.9, 124.6 ) ) );
  return fract( sin( p ) * 43758.5453 );
}
// crystal cells: x = distance to the cell seed, y = distance to the nearest cell wall, z = cell id
vec3 hCells( vec3 x ) {
  vec3 n = floor( x ), f = fract( x );
  float d1 = 8.0, d2 = 8.0, id = 0.0;
  for ( int k = -1; k <= 1; k++ ) for ( int j = -1; j <= 1; j++ ) for ( int i = -1; i <= 1; i++ ) {
    vec3 g = vec3( float( i ), float( j ), float( k ) );
    vec3 o = hHash3( n + g );
    vec3 r = g + o - f;
    float d = dot( r, r );
    if ( d < d1 ) { d2 = d1; d1 = d; id = o.x + o.y * 0.37; } else if ( d < d2 ) { d2 = d; }
  }
  return vec3( sqrt( d1 ), sqrt( d2 ) - sqrt( d1 ), fract( id ) );
}
float fgPart;
float fgZone;
float fgWear;
float fgFrost;
float fgRidge;
float fgCell;
vec3 fgFacet;
float fgCorr;
float fgVein;
float fgEdge;
`;

/** after <color_fragment>: albedo detail, dissolve, frost + corruption tint */
const FRAG_COLOR = /* glsl */ `
fgZone = floor( vCode / 16.0 + 0.01 );
fgPart = vCode - fgZone * 16.0;
{
  float ao = vMatv.z;
  float big = hFbm( vRest * 6.0 );
  float fine = hNoise( vRest * vec3( 90.0, 26.0, 90.0 ) );
  fgWear = big;
  float isMetal = step( 0.5, vMatv.y );
  float isCloth = step( 0.5, fgPart ) * step( fgPart, 1.5 ) + step( 8.5, fgPart );
  float isHair = step( 2.5, fgPart ) * step( fgPart, 3.5 );
  float isSkin = step( 1.5, fgPart ) * step( fgPart, 2.5 );
  // per-instance tint on gear (not on skin, hair or anything that glows)
  float tintable = ( 1.0 - isSkin ) * ( 1.0 - isHair ) * step( fgPart, 5.5 ) + step( 8.5, fgPart );
  diffuseColor.rgb *= mix( vec3( 1.0 ), uTint, tintable );
  // large-scale tonal variation + fine grain
  float tone = mix( 0.82, 1.14, big ) * mix( 0.94, 1.06, fine );
  // cloth weave
  float weave = 0.5 + 0.5 * sin( vRest.x * 900.0 ) * sin( vRest.y * 900.0 + vRest.z * 500.0 );
  float weaveFade = 1.0 - smoothstep( 0.4, 1.6, fwidth( vRest.y ) * 900.0 );
  tone *= mix( 1.0, mix( 0.86, 1.08, weave ), isCloth * weaveFade );
  // hair strands run downward
  float strand = hNoise( vec3( vRest.x * 260.0, vRest.y * 14.0, vRest.z * 260.0 ) );
  tone *= mix( 1.0, mix( 0.6, 1.35, strand ), isHair );
  // grime gathers low and in occluded creases
  float grime = smoothstep( 0.55, 0.0, vRest.y ) * 0.25 + ( 1.0 - ao ) * 0.55;
  diffuseColor.rgb *= tone * ( 1.0 - grime * mix( 0.5, 0.8, isMetal ) );
  diffuseColor.rgb *= mix( 0.5, 1.0, ao );

  // dissolve
  fgEdge = 0.0;
  if ( uDissolve > 0.001 ) {
    float du = hDissolve( vRest + uSeed );
    float th = uDissolve * 1.04 - 0.02;
    if ( du < th ) discard;
    fgEdge = smoothstep( th + 0.045, th, du );
  }

  // frost: crystals seed in creases and on upward faces, then grow cell by cell
  fgFrost = 0.0; fgRidge = 0.0; fgCell = 0.0; fgFacet = vec3( 0.0 );
  if ( uFrozen > 0.001 ) {
    vec3 cell = hCells( ( vRest + uSeed * 0.37 ) * vec3( 36.0, 17.0, 36.0 ) );
    float grow = hFbm( vRest * 5.0 + uSeed );
    float up = clamp( vRestN.y * 0.5 + 0.5, 0.0, 1.0 );
    float seedv = cell.z * 0.42 + grow * 0.48 + up * 0.2 + ( 1.0 - ao ) * 0.35;
    float th = mix( 1.08, 0.36, uFrozen );
    fgFrost = smoothstep( th, th + 0.14, seedv );
    fgRidge = fgFrost * smoothstep( 0.1, 0.0, cell.y );
    fgCell = cell.z;
    fgFacet = ( hHash3( vec3( cell.z * 91.7, cell.z * 13.3, 4.1 ) ) - 0.5 ) * fgFrost;
    float l = dot( diffuseColor.rgb, vec3( 0.3, 0.55, 0.15 ) );
    // arrested: colour drains toward a cold grey, but the faction hue survives underneath
    diffuseColor.rgb = mix( diffuseColor.rgb, mix( vec3( l ), diffuseColor.rgb, 0.45 ) * vec3( 0.82, 0.93, 1.06 ), uFrozen * 0.8 );
    diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.4, 0.55, 0.68 ) + cell.z * 0.12, fgFrost * 0.7 );
  }

  // Eclipse corruption: it climbs from ONE flank (which one differs per body), darkens what it takes and runs
  // its light along seams and its own advancing edge; clean plate survives beside it
  fgCorr = 0.0; fgVein = 0.0;
  if ( uCorruption > 0.001 ) {
    vec3 cp = vRest + uSeed * 1.7;
    float m = hFbm( cp * 3.6 + 11.0 );
    float ca = uSeed.x * 6.2832;
    vec3 cdir = normalize( vec3( cos( ca ), 0.35, sin( ca ) ) );
    float dir = clamp( 0.5 + dot( vRest - vec3( 0.0, 1.0, 0.0 ), cdir ) * 1.5, 0.0, 1.0 );
    float reach = uCorruption * 0.78;
    fgCorr = smoothstep( 1.0 - reach, 1.14 - reach, m * 0.45 + dir * 0.55 );
    float seam = smoothstep( 0.95, 0.62, ao );
    float front = smoothstep( 0.0, 0.25, fgCorr ) * smoothstep( 0.8, 0.3, fgCorr );
    float v1 = abs( hNoise( cp * 17.0 + vec3( 0.0, uTime * 0.05, 0.0 ) ) - 0.5 );
    float v2 = abs( hNoise( cp * 37.0 + 5.0 ) - 0.5 );
    float lines = smoothstep( 0.022, 0.0, v1 ) + 0.4 * smoothstep( 0.014, 0.0, v2 );
    fgVein = fgCorr * ( lines * clamp( seam * 0.9 + front * 0.6, 0.0, 1.0 ) + seam * 0.22 * smoothstep( 0.05, 0.0, v2 ) );
    diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.03, 0.022, 0.042 ), fgCorr * 0.78 );
  }
}
`;

/** after <metalnessmap_fragment> */
const FRAG_PBR = /* glsl */ `
{
  float isMetal = step( 0.5, vMatv.y );
  float scratch = hNoise( vRest * vec3( 220.0, 40.0, 220.0 ) );
  roughnessFactor = clamp( vMatv.x + ( fgWear - 0.5 ) * 0.22 + ( scratch - 0.5 ) * 0.1 * isMetal + ( 1.0 - vMatv.z ) * 0.25, 0.045, 1.0 );
  metalnessFactor = vMatv.y;
  roughnessFactor = mix( roughnessFactor, 0.14 + fgCell * 0.3, fgFrost * 0.85 );
  metalnessFactor = mix( metalnessFactor, 0.0, fgFrost * 0.8 );
  roughnessFactor = mix( roughnessFactor, 0.4, fgCorr * 0.6 );
  metalnessFactor = mix( metalnessFactor, 0.2, fgCorr * 0.7 );
}
`;

/** after <normal_fragment_maps>: derivative bump from a procedural height (metres) in bind-pose space */
const FRAG_NORMAL = /* glsl */ `
{
  float bh = 0.0;
  if ( fgPart < 0.5 || ( fgPart > 7.5 && fgPart < 8.5 ) ) {
    // plate / blade: hammered dents + drawn scratches
    bh = ( hNoise( vRest * 46.0 ) - 0.5 ) * 0.0011 + ( hNoise( vRest * vec3( 240.0, 60.0, 240.0 ) ) - 0.5 ) * 0.00022;
  } else if ( fgPart < 1.5 || fgPart > 8.5 ) {
    // cloth / robe: soft wrinkles + weave
    float wv = sin( vRest.x * 1300.0 + vRest.z * 700.0 ) * sin( vRest.y * 1300.0 );
    float wf = 1.0 - smoothstep( 0.35, 1.2, fwidth( vRest.y ) * 1300.0 );
    bh = ( hFbm( vRest * vec3( 26.0, 9.0, 26.0 ) ) - 0.5 ) * 0.0034 + wv * 0.00016 * wf;
  } else if ( fgPart > 3.5 && fgPart < 4.5 ) {
    // undersuit: ribbed knit
    float rib = abs( fract( vRest.y * 42.0 + hNoise( vRest * 9.0 ) * 0.6 ) - 0.5 );
    float rf = 1.0 - smoothstep( 0.25, 0.9, fwidth( vRest.y ) * 42.0 );
    bh = smoothstep( 0.1, 0.4, rib ) * 0.0011 * rf;
  } else if ( fgPart > 4.5 && fgPart < 5.5 ) {
    // leather: creases + grain
    bh = ( hNoise( vRest * 70.0 ) - 0.5 ) * 0.0009 + ( hNoise( vRest * 330.0 ) - 0.5 ) * 0.0002;
  } else if ( fgPart > 2.5 && fgPart < 3.5 ) {
    bh = ( hNoise( vec3( vRest.x * 260.0, vRest.y * 14.0, vRest.z * 260.0 ) ) - 0.5 ) * 0.0016;
  }
  vec3 dpx = -dFdx( vViewPosition ), dpy = -dFdy( vViewPosition );
  float dhx = dFdx( bh ), dhy = dFdy( bh );
  vec3 r1 = cross( dpy, normal ), r2 = cross( normal, dpx );
  float det = dot( dpx, r1 );
  normal = normalize( abs( det ) * normal - sign( det ) * ( dhx * r1 + dhy * r2 ) );
  // ice facets: every crystal catches the light at its own angle
  normal = normalize( normal + fgFacet * 0.85 );
}
`;

/** after <emissivemap_fragment> (normal is available) */
const FRAG_EMISSIVE = /* glsl */ `
{
  vec3 vdir = normalize( vViewPosition );
  float ndv = clamp( dot( normal, vdir ), 0.0, 1.0 );
  float fres = pow( 1.0 - ndv, 3.0 );
  // authored emissive (weapon edges shimmer like embers / ice)
  float shimmer = 1.0;
  if ( fgPart > 7.5 && fgPart < 8.5 ) shimmer = 0.82 + 0.3 * hNoise( vec3( vRest.xz * 28.0, uTime * 2.2 ) );
  totalEmissiveRadiance = vEmis * uGlow * shimmer + diffuseColor.rgb * uLuminous;
  // rim: brightest on upper, grazing surfaces
  float up = 0.55 + 0.45 * clamp( normal.y * 0.8 + 0.4, 0.0, 1.0 );
  totalEmissiveRadiance += uRim.rgb * ( uRim.a * fres * up );
  // sheen on cloth so capes read against dark stone
  if ( fgPart > 0.5 && fgPart < 1.5 ) totalEmissiveRadiance += diffuseColor.rgb * pow( 1.0 - ndv, 2.0 ) * 0.35;
  // skin: cheap warm wrap
  if ( fgPart > 1.5 && fgPart < 2.5 ) totalEmissiveRadiance += vec3( 0.2, 0.05, 0.025 ) * diffuseColor.rgb * ( 0.1 + fres * 0.7 );
  // frost: a cold shell that reads without lighting the scene (stays under ~0.6)
  totalEmissiveRadiance *= 1.0 - uFrozen * 0.55;
  totalEmissiveRadiance += vec3( 0.5, 0.78, 1.0 ) * ( fgFrost * ( 0.035 + fres * 0.3 ) + fgRidge * 0.2 + uFrozen * fres * 0.1 );
  // corruption: light lives in the seams and pulses slowly
  float pulse = 0.65 + 0.35 * sin( uTime * 3.1 + vRest.y * 9.0 );
  totalEmissiveRadiance *= 1.0 - fgCorr * 0.35;
  totalEmissiveRadiance += vec3( 0.48, 0.2, 1.0 ) * fgVein * pulse * 2.4;
  // telegraph (about to act)
  float tp = 0.7 + 0.3 * sin( uTime * 18.0 );
  totalEmissiveRadiance += uTelegraph.rgb * uTelegraph.a * tp * ( 0.06 + fres * 1.3 );
  // exposed weak zone
  if ( uExposed.y > 0.001 && abs( fgZone - uExposed.x ) < 0.5 ) {
    totalEmissiveRadiance += vec3( 1.0, 0.72, 0.4 ) * uExposed.y * ( 0.6 + 0.4 * sin( uTime * 9.0 ) ) * ( 0.14 + fres * 1.2 );
  }
  // dissolve edge + hit flash
  totalEmissiveRadiance += uDissolveColor * fgEdge * 5.0;
  totalEmissiveRadiance += uFlash.rgb * uFlash.a * ( 0.45 + fres );
}
`;

const FRAG_ALPHA = /* glsl */ `
#ifdef FIGURE_GHOST
{
  float ndvA = clamp( dot( normal, normalize( vViewPosition ) ), 0.0, 1.0 );
  diffuseColor.a *= mix( 1.0, 0.82, ndvA );
}
#endif
`;

/** measured centre / spread of the dissolve noise (see hDissolve): makes visible area ≈ 1 − amount */
const DISSOLVE_DEFINES = { DISSOLVE_MID: '0.5', DISSOLVE_GAIN: '16.75' };

export interface FigureMaterialOpts {
  /** semi-translucent luminous figure (Witness) */
  ghost?: boolean;
  luminous?: number;
  /** per-instance pattern seed */
  seed?: number;
}

function fractHash(n: number): number { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }

/** Create a per-figure material instance (programs are shared through the cache key). */
export function createFigureMaterial(opts: FigureMaterialOpts = {}): FigureMaterial {
  const seed = opts.seed ?? 0;
  const uniforms: FigureUniforms = {
    uTime: { value: 0 },
    uFlash: { value: new THREE.Vector4(1, 1, 1, 0) },
    uFrozen: { value: 0 },
    uCorruption: { value: 0 },
    uDissolve: { value: 0 },
    uDissolveColor: { value: new THREE.Color(0x7a3cff) },
    uGlow: { value: 1 },
    uTelegraph: { value: new THREE.Vector4(1, 0.3, 0.1, 0) },
    uRim: { value: new THREE.Vector4(0.6, 0.72, 1, 0) },
    uExposed: { value: new THREE.Vector2(-1, 0) },
    uLuminous: { value: opts.luminous ?? 0 },
    uSeed: { value: new THREE.Vector3(fractHash(seed + 0.37), fractHash(seed * 1.7 + 4.1), fractHash(seed * 2.3 + 9.2)) },
    uTint: { value: new THREE.Color(1, 1, 1) },
  };
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 1, metalness: 1, vertexColors: true,
    transparent: !!opts.ghost, opacity: opts.ghost ? 0.94 : 1,
  });
  material.defines = { ...(material.defines ?? {}), ...DISSOLVE_DEFINES };
  if (opts.ghost) material.defines.FIGURE_GHOST = '';
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_HEAD)
      .replace('#include <begin_vertex>', VERT_BEGIN);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_HEAD)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + FRAG_COLOR)
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n' + FRAG_PBR)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + FRAG_NORMAL)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + FRAG_EMISSIVE + FRAG_ALPHA);
  };
  material.customProgramCacheKey = () => 'aurelion-humanoid-3' + (opts.ghost ? '-ghost' : '');

  // shadow pass: same skinning, same dissolve
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depth.defines = { ...(depth.defines ?? {}), ...DISSOLVE_DEFINES };
  depth.onBeforeCompile = (shader) => {
    shader.uniforms.uDissolve = uniforms.uDissolve;
    shader.uniforms.uSeed = uniforms.uSeed;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRest;')
      .replace('#include <begin_vertex>', 'vRest = position;\n#include <begin_vertex>');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRest;\nuniform float uDissolve;\nuniform vec3 uSeed;\n' + NOISE)
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif ( uDissolve > 0.001 && hDissolve( vRest + uSeed ) < uDissolve * 1.04 - 0.02 ) discard;');
  };
  depth.customProgramCacheKey = () => 'aurelion-humanoid-depth-3';
  return { material, depth, uniforms };
}
