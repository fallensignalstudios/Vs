/**
 * Shader layer for generated meshes: the file's MeshStandardMaterial (base colour, normal, metal / roughness
 * maps) extended through onBeforeCompile with the CharacterVisual state effects and the painted-light mask.
 *
 * The files have no emissive maps — lamps, slits and seams are painted into base colour. A hue / saturation /
 * brightness test on the base-colour texel finds them and adds them to emissive (scaled by setGlow), while
 * pale plate outside the mask is softly capped so it cannot bloom white.
 *
 * One program serves every body and prop: per-material differences are uniforms. Effects are evaluated in the
 * mesh's bind-pose space (scaled to metres) so they stick to the surface under skinning.
 */
import * as THREE from 'three';
import type { GlowMask } from './config';
import { HIT_FLASH_GLSL } from '@/chars/flash';
import { BOOT_TOP, FACE_REGION_GLSL, FROST_REGION_GLSL } from '@/chars/regions';

/** State shared by every material of one character (body and props). */
export interface SharedUniforms {
  uTime: { value: number };
  uFlash: { value: THREE.Vector4 };
  uFrozen: { value: number };
  uCorruption: { value: number };
  uDissolve: { value: number };
  uDissolveColor: { value: THREE.Color };
  uGlow: { value: number };
  uTelegraph: { value: THREE.Vector4 };
  uRim: { value: THREE.Vector4 };
  uSeed: { value: THREE.Vector3 };
  /** where frost and corruption act (src/chars/regions.ts): frost region, corruption mode, half side, boot top */
  uLocal: { value: THREE.Vector4 };
  /** 0..1 energy-blade flare (Verity igniting) */
  uFlare: { value: number };
}

/** Per-material parameters. */
export interface OwnUniforms {
  /** raw vertex attribute → rest position in metres (Y up, origin at the feet / grip) */
  uRest: { value: THREE.Matrix4 };
  /** raw vertex units per metre (for offsets applied before skinning) */
  uRestUnit: { value: number };
  /** hue centre, half-width, minimum saturation, minimum brightness */
  uMask: { value: THREE.Vector4 };
  /** mask gain, albedo luminance cap, back-face albedo factor, exposed amount */
  uParams: { value: THREE.Vector4 };
  uTint: { value: THREE.Color };
  /** exposed band in rest metres along Y: from, to */
  uExposed: { value: THREE.Vector2 };
  /** energy-blade clip along rest Z: enabled, root, forward (−Z) length, rear (+Z) length — metres */
  uBlade: { value: THREE.Vector4 };
  /**
   * hair recolour (a grafted bare head, see head.ts): dark, unsaturated texels take this linear colour, keeping
   * their own shading; w = amount (0 = off)
   */
  uHair: { value: THREE.Vector4 };
  /** eye centre in rest metres and skull size (w = 0: this surface has no face — props) */
  uFace: { value: THREE.Vector4 };
}

export interface GlbMaterial {
  material: THREE.MeshStandardMaterial;
  depth: THREE.MeshDepthMaterial;
  own: OwnUniforms;
  dispose(): void;
}

const NOISE = /* glsl */ `
float gHash( vec3 p ) {
  p = fract( p * 0.3183099 + vec3( 0.1, 0.17, 0.23 ) );
  p *= 17.0;
  return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) );
}
float gNoise( vec3 x ) {
  vec3 i = floor( x ); vec3 f = fract( x );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( mix( gHash( i ), gHash( i + vec3( 1, 0, 0 ) ), f.x ), mix( gHash( i + vec3( 0, 1, 0 ) ), gHash( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
              mix( mix( gHash( i + vec3( 0, 0, 1 ) ), gHash( i + vec3( 1, 0, 1 ) ), f.x ), mix( gHash( i + vec3( 0, 1, 1 ) ), gHash( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z );
}
float gFbm( vec3 p ) {
  return 0.55 * gNoise( p ) + 0.3 * gNoise( p * 2.07 + 7.1 ) + 0.15 * gNoise( p * 4.3 + 3.7 );
}
// dissolve field remapped through the noise's own distribution, so "amount" is the fraction of surface gone
float gDissolve( vec3 p ) {
  float dn = gFbm( p * 11.0 ) * 0.8 + gNoise( p * 41.0 ) * 0.2;
  return 1.0 / ( 1.0 + exp( -( dn - 0.5 ) * 16.75 ) );
}
`;

const VERT_HEAD = /* glsl */ `
varying vec3 vRest;
varying vec3 vRestN;
uniform float uFrozen;
uniform mat4 uRest;
uniform float uRestUnit;
uniform vec4 uLocal;
uniform vec4 uFace;
${FROST_REGION_GLSL}
`;

/** replaces <begin_vertex>: bind-pose position / normal for the effects, and the frost shell's slight swell */
const VERT_BEGIN = /* glsl */ `
vRest = ( uRest * vec4( position, 1.0 ) ).xyz;
vRestN = normalize( mat3( uRest ) * normal );
// the frost shell swells the surface a little (a boot locked in ice: three times as much, there only — not on props)
float frostSwell = uFrozen * ( uLocal.x > 0.5 ? 0.012 * aurFrostRegion( vRest, uLocal ) * step( 0.001, uFace.w ) : 0.004 );
vec3 transformed = vec3( position ) + normalize( normal ) * ( frostSwell * uRestUnit );
`;

const FRAG_HEAD = /* glsl */ `
varying vec3 vRest;
varying vec3 vRestN;
uniform float uTime;
uniform vec4 uFlash;
uniform float uFrozen;
uniform float uCorruption;
uniform float uDissolve;
uniform vec3 uDissolveColor;
uniform float uGlow;
uniform vec4 uTelegraph;
uniform vec4 uRim;
uniform vec3 uSeed;
uniform vec4 uMask;
uniform vec4 uParams;
uniform vec3 uTint;
uniform vec2 uExposed;
uniform vec4 uBlade;
uniform vec4 uHair;
uniform vec4 uLocal;
uniform vec4 uFace;
uniform float uFlare;
${NOISE}
${HIT_FLASH_GLSL}
${FROST_REGION_GLSL}
${FACE_REGION_GLSL}
vec3 gHash3( vec3 p ) {
  p = vec3( dot( p, vec3( 127.1, 311.7, 74.7 ) ), dot( p, vec3( 269.5, 183.3, 246.1 ) ), dot( p, vec3( 113.5, 271.9, 124.6 ) ) );
  return fract( sin( p ) * 43758.5453 );
}
// crystal cells: x = distance to the cell seed, y = distance to the nearest cell wall, z = cell id
vec3 gCells( vec3 x ) {
  vec3 n = floor( x ), f = fract( x );
  float d1 = 8.0, d2 = 8.0, id = 0.0;
  for ( int k = -1; k <= 1; k++ ) for ( int j = -1; j <= 1; j++ ) for ( int i = -1; i <= 1; i++ ) {
    vec3 g = vec3( float( i ), float( j ), float( k ) );
    vec3 o = gHash3( n + g );
    vec3 r = g + o - f;
    float d = dot( r, r );
    if ( d < d1 ) { d2 = d1; d1 = d; id = o.x + o.y * 0.37; } else if ( d < d2 ) { d2 = d; }
  }
  return vec3( sqrt( d1 ), sqrt( d2 ) - sqrt( d1 ), fract( id ) );
}
float gHue( vec3 c, float mx, float mn ) {
  float d = max( mx - mn, 1e-4 );
  float h = c.r >= mx ? ( c.g - c.b ) / d : ( c.g >= mx ? 2.0 + ( c.b - c.r ) / d : 4.0 + ( c.r - c.g ) / d );
  return fract( h / 6.0 );
}
vec3 ggLamp;
float ggFrost;
float ggRidge;
float ggCell;
vec3 ggFacet;
float ggCorr;
float ggVein;
float ggEdge;
float ggBlade;
float ggBladeBody;
float ggHair;
float ggFz;
float ggIris;
`;

/** after <color_fragment>: painted-light mask, albedo cap, dissolve, frost and corruption tint */
const FRAG_COLOR = /* glsl */ `
{
  // painted lights → emissive; everything else is tinted and softly capped
  vec3 tex = diffuseColor.rgb;
  vec3 dis = sqrt( max( tex, vec3( 0.0 ) ) );
  float mx = max( dis.r, max( dis.g, dis.b ) ), mn = min( dis.r, min( dis.g, dis.b ) );
  float sat = ( mx - mn ) / max( mx, 1e-4 );
  float dh = abs( fract( gHue( dis, mx, mn ) - uMask.x + 0.5 ) - 0.5 );
  float lamp = smoothstep( uMask.y, uMask.y * 0.55, dh ) * smoothstep( uMask.z, uMask.z + 0.14, sat ) * smoothstep( uMask.w, uMask.w + 0.14, mx );
  ggLamp = tex * lamp * uParams.x;
  float lum = dot( tex, vec3( 0.2126, 0.7152, 0.0722 ) );
  float cap = uParams.y;
  float capped = lum > cap ? ( cap + ( lum - cap ) * 0.22 ) / lum : 1.0;
  diffuseColor.rgb *= mix( uTint * capped, vec3( 1.0 ), lamp );
  ggHair = 0.0;
  if ( uHair.w > 0.0 ) {
    // hair, brows and beard: the darkest texels of a face texture take another colour (and lose their wet gloss)
    ggHair = smoothstep( 0.34, 0.17, mx ) * uHair.w;
    diffuseColor.rgb = mix( diffuseColor.rgb, uHair.rgb * ( 0.45 + lum * 14.0 ), ggHair );
  }
  #ifdef DOUBLE_SIDED
  // the inside of skirts, tassets and hems: a shell has no lining, so it reads dark
  if ( ! gl_FrontFacing ) diffuseColor.rgb *= uParams.z;
  #endif

  // energy blades end where they are told to
  ggBlade = 0.0; ggBladeBody = 0.0;
  if ( uBlade.x > 0.5 ) {
    float lim = uBlade.y + ( vRest.z < 0.0 ? uBlade.z : uBlade.w );
    float over = abs( vRest.z ) - lim;
    if ( over > 0.0 ) discard;
    ggBlade = smoothstep( -0.035, 0.0, over ) * step( uBlade.y + 0.01, abs( vRest.z ) );
    // beyond the emitters the blade is Frost: pale, cold, lit from within
    ggBladeBody = smoothstep( uBlade.y - 0.01, uBlade.y + 0.05, abs( vRest.z ) );
    diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.42, 0.66, 0.86 ), ggBladeBody * 0.6 );
  }

  ggEdge = 0.0;
  if ( uDissolve > 0.001 ) {
    float du = gDissolve( vRest + uSeed );
    float th = uDissolve * 1.04 - 0.02;
    if ( du < th ) discard;
    ggEdge = smoothstep( th + 0.045, th, du );
  }

  // frost: crystals seed on upward faces and in a slow pattern, then grow cell by cell
  ggFrost = 0.0; ggRidge = 0.0; ggCell = 0.0; ggFacet = vec3( 0.0 ); ggFz = 0.0;
  if ( uFrozen > 0.001 ) {
    // whole figure, or one boot (regions.ts): ggFz is how frozen THIS point is
    float local = step( 0.5, uLocal.x );
    // (a prop has no boot: carried items only freeze with the whole figure)
    float fm = aurFrostRegion( vRest + vec3( 0.0, ( gNoise( vRest * 31.0 + uSeed ) - 0.5 ) * 0.05 * local, 0.0 ), uLocal ) * ( local > 0.5 && uFace.w <= 0.0 ? 0.0 : 1.0 );
    ggFz = uFrozen * fm;
    vec3 cell = gCells( ( vRest + uSeed * 0.37 ) * mix( vec3( 36.0, 17.0, 36.0 ), vec3( 48.0, 30.0, 48.0 ), local ) );
    float grow = gFbm( vRest * 5.0 + uSeed );
    float up = clamp( vRestN.y * 0.5 + 0.5, 0.0, 1.0 );
    float seedv = cell.z * 0.34 + grow * 0.5 + up * 0.28 + gNoise( vRest * 23.0 ) * 0.2;
    // a locked boot is encased: the ice is solid where the region is, crystalline only at its ragged top
    float th = mix( 0.98, 0.38, ggFz ) - local * 0.55 * ggFz;
    ggFrost = smoothstep( th, th + 0.14, seedv ) * mix( 1.0, smoothstep( 0.05, 0.4, fm ), local );
    ggRidge = ggFrost * smoothstep( 0.1, 0.0, cell.y );
    ggCell = cell.z;
    ggFacet = ( gHash3( vec3( cell.z * 91.7, cell.z * 13.3, 4.1 ) ) - 0.5 ) * ggFrost;
    float l = dot( diffuseColor.rgb, vec3( 0.3, 0.55, 0.15 ) );
    // arrested: colour drains toward a cold grey, but the faction hue survives underneath
    diffuseColor.rgb = mix( diffuseColor.rgb, mix( vec3( l ), diffuseColor.rgb, 0.45 ) * vec3( 0.82, 0.93, 1.06 ), ggFz * 0.8 );
    diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.27, 0.41, 0.56 ) + cell.z * 0.14, ggFrost * mix( 0.72, 0.86, local ) );
  }

  // Eclipse corruption: climbs from one flank, darkens what it takes, light in veins and along its edge
  ggCorr = 0.0; ggVein = 0.0; ggIris = 0.0;
  if ( uCorruption > 0.001 ) {
    vec3 cp = vRest + uSeed * 1.7;
    float v1 = abs( gNoise( cp * 17.0 + vec3( 0.0, uTime * 0.05, 0.0 ) ) - 0.5 );
    float v2 = abs( gNoise( cp * 37.0 + 5.0 ) - 0.5 );
    vec3 fd = vRest - uFace.xyz;
    float fs = max( uFace.w, 0.05 ) / 0.21;
    if ( uLocal.y > 0.5 && uLocal.y < 1.5 ) {
      // FACE ONLY (regions.ts): violet irises, thin veins at the temples and the neck; nothing else is touched
      if ( uFace.w > 0.0 ) {
        float a = uCorruption;
        ggIris = aurIris( fd, vRestN, fs ) * smoothstep( 0.0, 0.3, a );
        float region = aurFaceVeinRegion( fd, fs );
        float w1 = abs( gNoise( vRest * vec3( 70.0, 34.0, 70.0 ) + uSeed * 3.0 ) - 0.5 );
        float w2 = abs( gNoise( vRest * 140.0 + 7.0 ) - 0.5 );
        // the veins reach further from their roots as the amount rises
        float reach = smoothstep( 1.0 - a, 1.25 - a, region + gNoise( vRest * 19.0 ) * 0.25 );
        float thin = smoothstep( 0.013, 0.002, w1 ) + 0.4 * smoothstep( 0.008, 0.0, w2 );
        ggVein = clamp( thin * reach * region, 0.0, 1.0 );
        diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.075, 0.025, 0.12 ), ggVein * 0.85 );
        diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.32, 0.1, 0.62 ), ggIris * 0.9 );
        // dark veins with only a breath of light in them; the irises carry the light
        ggVein *= 0.1;
      }
    } else {
      float m = gFbm( cp * 3.6 + 11.0 );
      float ca = uSeed.x * 6.2832;
      vec3 cdir = normalize( vec3( cos( ca ), 0.35, sin( ca ) ) );
      float dir = clamp( 0.5 + dot( vRest - vec3( 0.0, 1.0, 0.0 ), cdir ) * 1.5, 0.0, 1.0 );
      float reach = uCorruption * 0.78;
      ggCorr = smoothstep( 1.0 - reach, 1.14 - reach, m * 0.45 + dir * 0.55 );
      if ( uLocal.y > 1.5 ) {
        // HALF FACE: on the head one half is taken (split by a ragged line), the other stays human; the rest of
        // the figure keeps its own look (and props are untouched)
        float head = uFace.w > 0.0 ? aurHead( fd, fs ) : 0.0;
        float edge = fd.x * uLocal.z + ( gNoise( vRest * 55.0 + uSeed ) - 0.5 ) * 0.014 * fs + ( gNoise( vRest * 13.0 ) - 0.5 ) * 0.024 * fs;
        float halfMask = smoothstep( -0.003, 0.005, edge ) * smoothstep( 0.0, 0.35, uCorruption );
        ggCorr = halfMask * head;
      }
      float front = smoothstep( 0.0, 0.25, ggCorr ) * smoothstep( 0.8, 0.3, ggCorr );
      float lines = smoothstep( 0.03, 0.0, v1 ) + 0.45 * smoothstep( 0.018, 0.0, v2 );
      ggVein = ggCorr * lines * clamp( 0.45 + front * 0.8, 0.0, 1.0 );
      diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.045, 0.03, 0.07 ), ggCorr * 0.74 );
      ggLamp *= 1.0 - ggCorr * 0.6;
    }
  }
}
`;

/** after <metalnessmap_fragment> */
const FRAG_PBR = /* glsl */ `
roughnessFactor = mix( roughnessFactor, max( roughnessFactor, 0.62 ), ggHair );
metalnessFactor *= 1.0 - ggHair;
roughnessFactor = mix( roughnessFactor, 0.14 + ggCell * 0.3, ggFrost * 0.85 );
metalnessFactor = mix( metalnessFactor, 0.0, ggFrost * 0.8 );
roughnessFactor = mix( roughnessFactor, 0.4, ggCorr * 0.6 );
metalnessFactor = mix( metalnessFactor, 0.2, ggCorr * 0.7 );
`;

/** after <normal_fragment_maps>: every ice crystal catches the light at its own angle */
const FRAG_NORMAL = /* glsl */ `
normal = normalize( normal + ggFacet * 0.85 );
`;

/** after <emissivemap_fragment> */
const FRAG_EMISSIVE = /* glsl */ `
{
  vec3 vdir = normalize( vViewPosition );
  float ndv = clamp( dot( normal, vdir ), 0.0, 1.0 );
  float fres = pow( 1.0 - ndv, 3.0 );
  float shimmer = 0.9 + 0.2 * gNoise( vec3( vRest.xz * 30.0, uTime * 1.7 ) );
  totalEmissiveRadiance += ggLamp * uGlow * shimmer;
  // rim: brightest on upper, grazing surfaces
  float up = 0.55 + 0.45 * clamp( normal.y * 0.8 + 0.4, 0.0, 1.0 );
  totalEmissiveRadiance += uRim.rgb * ( uRim.a * fres * up );
  // frost: a cold shell that reads without lighting the scene
  totalEmissiveRadiance *= 1.0 - ggFz * 0.55;
  totalEmissiveRadiance += vec3( 0.5, 0.78, 1.0 ) * ( ggFrost * ( 0.035 + fres * 0.3 ) + ggRidge * 0.2 + ggFz * fres * 0.1 );
  // corruption: light lives in the veins and pulses slowly
  float pulse = 0.65 + 0.35 * sin( uTime * 3.1 + vRest.y * 9.0 );
  totalEmissiveRadiance += vec3( 0.48, 0.2, 1.0 ) * ( ggVein * pulse * 3.4 + ggCorr * fres * 0.35 );
  // a taken iris holds a low violet light of its own
  totalEmissiveRadiance += vec3( 0.5, 0.2, 1.0 ) * ggIris * ( 0.9 + 0.3 * pulse );
  // telegraph (about to act)
  float tp = 0.7 + 0.3 * sin( uTime * 18.0 );
  totalEmissiveRadiance += uTelegraph.rgb * uTelegraph.a * tp * ( 0.06 + fres * 1.3 );
  // exposed weak band
  if ( uParams.w > 0.001 ) {
    float band = smoothstep( uExposed.x - 0.06, uExposed.x + 0.04, vRest.y ) * smoothstep( uExposed.y + 0.06, uExposed.y - 0.04, vRest.y );
    totalEmissiveRadiance += vec3( 1.0, 0.72, 0.4 ) * uParams.w * band * ( 0.6 + 0.4 * sin( uTime * 9.0 ) ) * ( 0.14 + fres * 1.2 );
  }
  // energy blades: a cold inner light that gathers at the edges and the cut end
  // (igniting: the whole blade flares white-cold, then settles)
  float flare = 1.0 + uFlare * 4.0;
  totalEmissiveRadiance += mix( vec3( 0.55, 0.82, 1.0 ), vec3( 0.85, 0.95, 1.0 ), uFlare ) * ggBladeBody * ( 0.3 + fres * 1.9 ) * uGlow * shimmer * flare;
  totalEmissiveRadiance += vec3( 0.62, 0.86, 1.0 ) * ggBlade * 4.0 * uGlow * flare;
  totalEmissiveRadiance += uDissolveColor * ggEdge * 5.0;
  // hit flash: edge tint + albedo lift (src/chars/flash.ts), never a flat fill over the author's design
  totalEmissiveRadiance += aurHitFlash( uFlash, diffuseColor.rgb, fres );
}
`;

function fractHash(n: number): number { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }

export function createSharedUniforms(seed: number): SharedUniforms {
  return {
    uTime: { value: 0 },
    uFlash: { value: new THREE.Vector4(1, 1, 1, 0) },
    uFrozen: { value: 0 },
    uCorruption: { value: 0 },
    uDissolve: { value: 0 },
    uDissolveColor: { value: new THREE.Color(0x7a3cff) },
    uGlow: { value: 1 },
    uTelegraph: { value: new THREE.Vector4(1, 0.3, 0.1, 0) },
    uRim: { value: new THREE.Vector4(0.6, 0.72, 1, 0) },
    uSeed: { value: new THREE.Vector3(fractHash(seed + 0.37), fractHash(seed * 1.7 + 4.1), fractHash(seed * 2.3 + 9.2)) },
    uLocal: { value: new THREE.Vector4(0, 0, 1, BOOT_TOP) },
    uFlare: { value: 0 },
  };
}

export interface GlbMaterialOpts {
  mask: GlowMask;
  /** raw vertex attribute → rest position in metres; default identity (geometry already in metres) */
  rest?: THREE.Matrix4;
  albedoCap?: number;
  envIntensity?: number;
  doubleSided?: boolean;
  /** albedo factor of back faces (default 0.3) */
  interior?: number;
}

/**
 * A per-instance material for one mesh: a clone of the file's material (textures shared) with the effect
 * layer; the matching depth material makes dissolve and blade clipping show in shadows.
 */
export function createGlbMaterial(source: THREE.MeshStandardMaterial, shared: SharedUniforms, opts: GlbMaterialOpts): GlbMaterial {
  const m = opts.mask;
  const own: OwnUniforms = {
    uRest: { value: opts.rest ? opts.rest.clone() : new THREE.Matrix4() },
    uRestUnit: { value: 1 },
    uMask: { value: new THREE.Vector4(m.hue, m.width, m.sat, m.val) },
    uParams: { value: new THREE.Vector4(m.gain, opts.albedoCap ?? 0.62, opts.interior ?? 0.3, 0) },
    uTint: { value: new THREE.Color(1, 1, 1) },
    uExposed: { value: new THREE.Vector2(0, 0) },
    uBlade: { value: new THREE.Vector4(0, 0, 0, 0) },
    uHair: { value: new THREE.Vector4(0, 0, 0, 0) },
    uFace: { value: new THREE.Vector4(0, 0, 0, 0) },
  };
  const unit = Math.cbrt(Math.abs(own.uRest.value.determinant()));
  own.uRestUnit.value = unit > 1e-9 ? 1 / unit : 1;
  const material = source.clone();
  material.envMapIntensity = opts.envIntensity ?? 0.85;
  if (opts.doubleSided) { material.side = THREE.DoubleSide; material.shadowSide = THREE.DoubleSide; }
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared, own);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_HEAD)
      .replace('#include <begin_vertex>', VERT_BEGIN);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_HEAD)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + FRAG_COLOR)
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n' + FRAG_PBR)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + FRAG_NORMAL)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + FRAG_EMISSIVE);
  };
  material.customProgramCacheKey = () => 'aurelion-glb-7';

  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depth.onBeforeCompile = (shader) => {
    shader.uniforms.uDissolve = shared.uDissolve;
    shader.uniforms.uSeed = shared.uSeed;
    shader.uniforms.uRest = own.uRest;
    shader.uniforms.uBlade = own.uBlade;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRest;\nuniform mat4 uRest;')
      .replace('#include <begin_vertex>', 'vRest = ( uRest * vec4( position, 1.0 ) ).xyz;\n#include <begin_vertex>');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRest;\nuniform float uDissolve;\nuniform vec3 uSeed;\nuniform vec4 uBlade;\n' + NOISE)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
if ( uDissolve > 0.001 && gDissolve( vRest + uSeed ) < uDissolve * 1.04 - 0.02 ) discard;
if ( uBlade.x > 0.5 && abs( vRest.z ) > uBlade.y + ( vRest.z < 0.0 ? uBlade.z : uBlade.w ) ) discard;`);
  };
  depth.customProgramCacheKey = () => 'aurelion-glb-depth-2';
  return { material, depth, own, dispose() { material.dispose(); depth.dispose(); } };
}
