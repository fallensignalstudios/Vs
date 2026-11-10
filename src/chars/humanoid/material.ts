/**
 * The one shader every humanoid uses: MeshStandardMaterial extended through onBeforeCompile.
 * Per-vertex roughness / metalness / emissive / occlusion come from the MeshBuilder attributes; procedural
 * detail (brushed metal, weave, wear) is evaluated in bind-pose space so it sticks to the surface under skinning.
 * State overlays: flash, frozen, corruption, dissolve, glow, telegraph, rim, exposed.
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
}

export interface FigureMaterial {
  material: THREE.MeshStandardMaterial;
  uniforms: FigureUniforms;
}

const VERT_HEAD = /* glsl */ `
attribute vec3 aEmissive;
attribute vec4 aMat;
varying vec3 vEmis;
varying vec3 vRest;
varying vec3 vMatv;
flat varying float vCode;
uniform float uFrozen;
`;

const VERT_BEGIN = /* glsl */ `
vEmis = aEmissive;
vRest = position;
vMatv = aMat.xyw;
vCode = aMat.z;
vec3 transformed = vec3( position ) + normal * ( uFrozen * 0.004 );
`;

const FRAG_HEAD = /* glsl */ `
varying vec3 vEmis;
varying vec3 vRest;
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
float fgPart;
float fgZone;
float fgWear;
float fgFrost;
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
    float dn = hFbm( vRest * 11.0 ) * 0.8 + hNoise( vRest * 41.0 ) * 0.2;
    float th = uDissolve * 1.12 - 0.06;
    if ( dn < th ) discard;
    fgEdge = smoothstep( th + 0.04, th, dn );
  }

  // frost shell
  fgFrost = 0.0;
  if ( uFrozen > 0.001 ) {
    float cr = hFbm( vRest * 17.0 + 3.0 );
    float cr2 = hNoise( vRest * 70.0 );
    fgFrost = uFrozen * smoothstep( 0.72 - uFrozen * 0.6, 0.95 - uFrozen * 0.35, cr + cr2 * 0.25 );
    float l = dot( diffuseColor.rgb, vec3( 0.3, 0.55, 0.15 ) );
    diffuseColor.rgb = mix( diffuseColor.rgb, vec3( l ) * vec3( 0.8, 0.92, 1.05 ), uFrozen * 0.7 );
    diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.72, 0.86, 0.96 ), fgFrost * 0.85 );
  }

  // Eclipse corruption: it has a direction — it climbs from one flank, and clean plate survives beside it
  fgCorr = 0.0; fgVein = 0.0;
  if ( uCorruption > 0.001 ) {
    float m = hFbm( vRest * 3.6 + 11.0 );
    float dir = clamp( 0.5 - vRest.x * 1.5 + ( vRest.y - 1.0 ) * 0.35 + vRest.z * 0.9, 0.0, 1.0 );
    float reach = uCorruption * 1.35;
    fgCorr = smoothstep( 1.0 - reach, 1.16 - reach, m * 0.55 + dir * 0.45 );
    float v1 = abs( hNoise( vRest * 17.0 + vec3( 0.0, uTime * 0.05, 0.0 ) ) - 0.5 );
    float v2 = abs( hNoise( vRest * 37.0 + 5.0 ) - 0.5 );
    // veins live inside the tissue and feather out a little past its edge
    fgVein = ( smoothstep( 0.02, 0.0, v1 ) + 0.45 * smoothstep( 0.014, 0.0, v2 ) ) * smoothstep( 0.02, 0.45, fgCorr );
    diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.035, 0.012, 0.07 ), fgCorr * 0.82 );
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
  roughnessFactor = mix( roughnessFactor, 0.12, fgFrost * 0.8 );
  metalnessFactor = mix( metalnessFactor, 0.0, fgFrost * 0.7 );
  roughnessFactor = mix( roughnessFactor, 0.35, fgCorr * 0.6 );
  metalnessFactor = mix( metalnessFactor, 0.2, fgCorr * 0.7 );
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
  // frost
  totalEmissiveRadiance += vec3( 0.55, 0.8, 1.0 ) * ( fgFrost * ( 0.12 + fres * 0.9 ) + uFrozen * fres * 0.35 );
  // corruption veins pulse
  float pulse = 0.65 + 0.35 * sin( uTime * 3.1 + vRest.y * 9.0 );
  totalEmissiveRadiance += vec3( 0.48, 0.2, 1.0 ) * fgVein * pulse * 3.2;
  totalEmissiveRadiance *= 1.0 - fgCorr * 0.35;
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
  diffuseColor.a *= mix( 1.0, 0.72, ndvA );
}
#endif
`;

export interface FigureMaterialOpts {
  /** semi-translucent luminous figure (Witness) */
  ghost?: boolean;
  luminous?: number;
}

/** Create a per-figure material instance (programs are shared through the cache key). */
export function createFigureMaterial(opts: FigureMaterialOpts = {}): FigureMaterial {
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
  };
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 1, metalness: 1, vertexColors: true,
    transparent: !!opts.ghost, opacity: opts.ghost ? 0.9 : 1,
  });
  if (opts.ghost) material.defines = { ...(material.defines ?? {}), FIGURE_GHOST: '' };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_HEAD)
      .replace('#include <begin_vertex>', VERT_BEGIN);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_HEAD)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + FRAG_COLOR)
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n' + FRAG_PBR)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + FRAG_EMISSIVE + FRAG_ALPHA);
  };
  material.customProgramCacheKey = () => 'aurelion-humanoid-2' + (opts.ghost ? '-ghost' : '');
  return { material, uniforms };
}
