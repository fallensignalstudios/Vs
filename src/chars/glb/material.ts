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
  /**
   * POLISH 4: the skull's centre in WORLD space (xyz) and w = 1 once known. On the head the rim light and the
   * crease test use the normal of this ball instead of the mesh's own (see FRAG_EMISSIVE / FRAG_AO).
   */
  uHeadW: { value: THREE.Vector4 };
  /** POLISH 4: CorruptionOpts.arms — how far down both arms the corruption has run (0..1), in any mode */
  uArmCorr: { value: number };
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
  /**
   * ADDED (integration) a Witness V figure's light (config WitnessLook): x = albedo self-light, y = edge light,
   * z = standing height in rest metres (for the head-to-hem colour); 0, 0 = off
   */
  uWitness: { value: THREE.Vector4 };
  /** ADDED (integration) CharacterCreateOpts.wounded: x = amount (0 = off), y = side of the broken shoulder (−1 = the figure's left, −X) */
  uWound: { value: THREE.Vector4 };
  /** the broken shoulder's centre in rest metres, w = its radius */
  uShoulder: { value: THREE.Vector4 };
  /**
   * POLISH 4 (config FaceLook): x = skin shading (wrap light, T-zone and lips, pores; 0 = off), y = grey at the
   * temples, z = grey in the beard, w = hair strands drawn over a sculpted hair mass
   */
  uSkin: { value: THREE.Vector4 };
  /** POLISH 4 (config FaceLook): x = a gauze dressing over the pale strip on the left cheek, y = brown irises */
  uFaceFx: { value: THREE.Vector4 };
  /** POLISH 4: the arms in rest metres, mirrored to +X: shoulder joint (w = 1 when known) … */
  uArmA: { value: THREE.Vector4 };
  /** … and the hand's grip (w = the arm's radius) — where CorruptionOpts.arms can reach */
  uArmB: { value: THREE.Vector4 };
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
uniform vec4 uWitness;
uniform vec4 uWound;
uniform vec4 uShoulder;
uniform vec4 uHeadW;
uniform float uArmCorr;
uniform vec4 uSkin;
uniform vec4 uFaceFx;
uniform vec4 uArmA;
uniform vec4 uArmB;
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
float ggChip;
float ggCrack;
float ggBlood;
// POLISH 4: the face — head ball, skin, T-zone, lips, eye, dressing, hair strands, fine relief (metres), pixel size
float ggHead;
float ggSkin;
float ggSkinTex;
float ggSkinCore;
float ggTZone;
float ggLip;
float ggSkinVar;
float ggEye;
float ggBand;
float ggStrand;
float ggBump;
float ggPx;
float ggTorn;
float ggNdvM;
float ggHairy;
`;

/**
 * POLISH 4 — after <lights_physical_pars_fragment>: skin lets light round the terminator, reddened (a cheap
 * stand-in for light scattered under the skin, which is what keeps a face from reading as wax).
 */
const LIGHT_PARS = /* glsl */ `
void RE_Direct_Aur( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
  RE_Direct_Physical( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
  if ( ggSkin > 0.001 ) {
    float nl = dot( geometryNormal, directLight.direction );
    float w = clamp( ( nl + 0.5 ) / 1.5, 0.0, 1.0 );
    float extra = max( w * w - max( nl, 0.0 ), 0.0 );
    reflectedLight.directDiffuse += directLight.color * extra * vec3( 1.1, 0.42, 0.28 ) * ggSkin * BRDF_Lambert( material.diffuseColor );
  }
}
#undef RE_Direct
#define RE_Direct RE_Direct_Aur
`;

/**
 * POLISH 4 — after <aomap_fragment>: the generated faces fold their mesh into the eye sockets, nostrils and the
 * lip line; seen from the front those folds have grazing normals and lit up as bright white-blue outlines
 * (specular at grazing incidence + the rim). On the head, a point whose own normal grazes the view while the
 * skull there faces the camera is such a fold: its specular is taken out. Skin also reflects less than plate.
 */
const FRAG_AO = /* glsl */ `
if ( ggHead > 0.001 ) {
  vec3 vdA = normalize( vViewPosition );
  float nvA = min( dot( normal, vdA ), dot( nonPerturbedNormal, vdA ) );
  float fold = smoothstep( 0.34, 0.04, nvA ) * smoothstep( 0.2, 0.55, ggNdvM ) * ggHead;
  // (dark hair: a sculpted mass whose sheen read as grey or white hair from above)
  reflectedLight.directSpecular *= ( 1.0 - 0.92 * fold ) * ( 1.0 - 0.45 * ggHairy );
  reflectedLight.indirectSpecular *= ( 1.0 - 0.92 * fold ) * ( 1.0 - 0.3 * ggSkin ) * ( 1.0 - 0.6 * ggHairy );
}
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
  // POLISH 4: THE FACE — skin, greying hair, a dressing, brown irises, hair strands, fine relief (all on the head
  // ball only; props and figures without a face have uFace.w = 0)
  ggHead = 0.0; ggSkin = 0.0; ggSkinTex = 0.0; ggSkinCore = 0.0; ggTZone = 0.0; ggLip = 0.0; ggSkinVar = 0.0; ggEye = 0.0; ggBand = 0.0; ggStrand = 0.0;
  ggBump = 0.0; ggTorn = 0.0; ggNdvM = 1.0; ggHairy = 0.0;
  ggPx = max( length( dFdx( vRest ) ), length( dFdy( vRest ) ) );
  if ( uFace.w > 0.0 ) {
    float s = max( uFace.w, 0.05 ) / 0.21;
    vec3 fd = vRest - uFace.xyz;
    ggHead = aurHeadBall( fd, s );
    float hue = gHue( dis, mx, mn );
    // skin: warm hue, some saturation, neither the darkest texels (hair, brows) nor the palest (eye whites, teeth)
    float dhs = abs( fract( hue - 0.055 + 0.5 ) - 0.5 );
    ggSkinTex = smoothstep( 0.085, 0.05, dhs ) * smoothstep( 0.1, 0.2, sat ) * smoothstep( 0.88, 0.72, sat ) * smoothstep( 0.13, 0.24, mx );
    // (the narrow core of skin hue, for marks that must not land on fair hair: measured on lyric.glb, skin 0.05–0.065,
    // blonde hair 0.07–0.084)
    ggSkinCore = ggSkinTex * smoothstep( 0.022, 0.013, dhs );
    if ( ggHead > 0.0 && uSkin.x > 0.0 ) {
      ggSkin = ggSkinTex * ggHead * uSkin.x;
      // the oily T-zone (the brow's centre, the bridge and tip of the nose) and the lips
      float brow = smoothstep( 0.035 * s, 0.015 * s, abs( fd.x ) ) * smoothstep( 0.005 * s, 0.025 * s, fd.y ) * smoothstep( 0.085 * s, 0.06 * s, fd.y );
      float nose = smoothstep( 0.02 * s, 0.007 * s, abs( fd.x ) ) * smoothstep( 0.0, -0.012 * s, fd.y ) * smoothstep( -0.07 * s, -0.05 * s, fd.y );
      ggTZone = max( brow, nose );
      ggLip = smoothstep( 0.03 * s, 0.017 * s, abs( fd.x ) ) * smoothstep( -0.1 * s, -0.086 * s, fd.y ) * smoothstep( -0.056 * s, -0.068 * s, fd.y ) * smoothstep( 0.0, -0.01 * s, fd.z );
      ggSkinVar = ( gNoise( vRest * 55.0 + 4.0 ) - 0.5 ) * 0.1;
      // a little life in the colour: mottling and a flush over the cheeks
      float cheek = smoothstep( 0.032 * s, 0.012 * s, length( vec2( abs( fd.x ) - 0.04 * s, fd.y + 0.035 * s ) ) );
      diffuseColor.rgb *= 1.0 + ( gNoise( vRest * 140.0 ) - 0.5 ) * 0.12 * ggSkin;
      diffuseColor.rgb *= mix( vec3( 1.0 ), vec3( 1.07, 0.95, 0.93 ), cheek * ggSkin );
      // pores and fine creases the 2k atlas cannot hold (as height, metres; gone once a pixel is wider than a pore)
      float pores = gNoise( vRest * 700.0 ) * 0.65 + gNoise( vRest * 1700.0 + 3.0 ) * 0.35 - 0.5;
      float creases = gFbm( vRest * 220.0 + 1.0 ) - 0.5;
      ggBump += ( pores * 0.00011 * smoothstep( 0.0012, 0.0005, ggPx ) + creases * 0.00022 * smoothstep( 0.003, 0.0012, ggPx ) ) * ggSkin;
    }
    float hairy = smoothstep( 0.3, 0.14, mx ) * smoothstep( 0.6, 0.3, sat ) * ggHead;
    ggHairy = hairy;
    if ( uSkin.y + uSkin.z > 0.0 && hairy > 0.0 ) {
      // greying: the temples (the sides of the head, behind the eyes) and salt-and-pepper through the beard
      float temple = smoothstep( 0.045 * s, 0.065 * s, abs( fd.x ) ) * smoothstep( -0.035 * s, -0.005 * s, fd.y ) * smoothstep( 0.075 * s, 0.045 * s, fd.y ) * smoothstep( 0.004 * s, 0.025 * s, fd.z ) * smoothstep( 0.12 * s, 0.08 * s, fd.z );
      float beard = smoothstep( -0.045 * s, -0.062 * s, fd.y ) * smoothstep( 0.045 * s, 0.0, fd.z );
      float strand = mix( gNoise( vRest * vec3( 1400.0, 450.0, 1400.0 ) ), 0.5, smoothstep( 0.0006, 0.002, ggPx ) );
      float grey = temple * uSkin.y * smoothstep( 0.64, 0.4, strand ) + beard * uSkin.z * smoothstep( 0.66, 0.46, strand );
      grey = clamp( grey, 0.0, 1.0 ) * hairy;
      diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.2, 0.196, 0.19 ) * ( 0.75 + 0.5 * gNoise( vRest * 300.0 ) ), grey );
      ggHair = max( ggHair, grey );
    }
    if ( uFaceFx.y > 0.0 ) {
      // eyes that meshed grey: brown irises (the pupil and the eye's own shading kept)
      vec3 ip = aurIrisPolar( fd, vRestN, s );
      float disc = smoothstep( 1.05, 0.85, ip.x ) * ip.z;
      float l2 = dot( diffuseColor.rgb, vec3( 0.3, 0.55, 0.15 ) );
      diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.2, 0.09, 0.035 ) * clamp( 0.3 + l2 * 4.0, 0.0, 1.4 ), disc * smoothstep( 0.32, 0.44, ip.x ) * uFaceFx.y );
      ggEye = max( ggEye, disc );
    }
    if ( uFaceFx.x > 0.0 ) {
      // a gauze dressing: the pale strip on the figure's left cheek and jaw (−X) gets a weave, a cream tone and a
      // dried stain instead of reading as a white stroke
      float pale = smoothstep( 0.5, 0.66, mx ) * smoothstep( 0.24, 0.1, sat );
      float side = smoothstep( -0.012 * s, -0.03 * s, fd.x );
      float span = smoothstep( -0.15 * s, -0.12 * s, fd.y ) * smoothstep( 0.03 * s, 0.0, fd.y );
      ggBand = pale * side * span * ggHead * uFaceFx.x;
      if ( ggBand > 0.0 ) {
        float fine = smoothstep( 0.0018, 0.0007, ggPx );
        vec2 g = vRest.yz * 3000.0 + gNoise( vRest * 260.0 ) * 1.6;
        float weave = 0.5 + 0.5 * sin( g.x ) * sin( g.y );
        float stain = smoothstep( 0.52, 0.7, gFbm( vRest * 40.0 + 1.3 ) );
        vec3 gauze = vec3( 0.46, 0.43, 0.36 ) * ( 0.86 + 0.18 * mix( 0.5, weave, fine ) );
        gauze = mix( gauze, vec3( 0.3, 0.15, 0.08 ), stain * 0.5 );
        diffuseColor.rgb = mix( diffuseColor.rgb, gauze, ggBand );
        ggBump += ( weave - 0.5 ) * 0.00012 * fine * ggBand;
      }
    }
    if ( uSkin.w > 0.0 ) {
      // hair strands over a sculpted hair mass: the grey hair (not the skin, not the dressing) down to the collar,
      // in fine strands and broader locks that fall from the crown
      float region = max( ggHead, smoothstep( 0.21 * s, 0.16 * s, length( vec3( fd.x, ( fd.y + 0.06 * s ) * 0.7, fd.z - 0.085 * s ) ) ) );
      float greyHair = smoothstep( 0.22, 0.36, mx ) * smoothstep( 0.22, 0.09, sat ) * ( 1.0 - ggBand ) * ( 1.0 - ggSkin / max( uSkin.x, 1e-3 ) );
      ggStrand = greyHair * region * uSkin.w;
      if ( ggStrand > 0.0 ) {
        float ang = atan( fd.x, fd.z - 0.075 * s );
        float flow = gNoise( vRest * vec3( 26.0, 7.0, 26.0 ) ) * 7.0 + gNoise( vRest * 80.0 ) * 1.4;
        float fineF = smoothstep( 0.0022, 0.0009, ggPx );
        float fineS = 0.5 + 0.5 * sin( ang * 95.0 + flow * 2.0 );
        float lock = 0.5 + 0.5 * sin( ang * 26.0 + flow );
        float k = mix( lock, fineS * 0.6 + lock * 0.4, fineF );
        // (the sculpted mass is pale and even: a little darker overall, deep between the locks)
        diffuseColor.rgb *= mix( 1.0, mix( 0.42, 1.0, k ) * ( 0.8 + 0.2 * smoothstep( 0.3, 0.6, mx ) ), ggStrand );
        ggBump += ( k - 0.5 ) * 0.0005 * ggStrand;
      }
    }
  }

  // WOUNDED (integration; polish 4: bolder, so it reads at 3–6 m): the plate broken open at one shoulder — whole
  // flakes gone down to the dark metal with bright torn edges, cracks running out across the plate, soot, and
  // dried blood run down from the break; blood under one eye, smeared round it; ash in the hair
  ggChip = 0.0; ggCrack = 0.0; ggBlood = 0.0;
  if ( uWound.x > 0.0 ) {
    vec3 sd = ( vRest - uShoulder.xyz ) / ( uShoulder.w * vec3( 1.15, 1.3, 1.1 ) );
    float sl = length( sd ) + ( gNoise( vRest * 7.0 + 3.1 ) - 0.5 ) * 0.55;
    float reg = smoothstep( 1.0, 0.35, sl );
    float halo = smoothstep( 2.0, 0.6, sl );
    if ( halo > 0.0 && uFace.w > 0.0 ) {
      // warped cells so the breaks run crooked, not as a tiling; only some cell walls are cracks
      vec3 wp = vRest * 9.0 + vec3( gNoise( vRest * 8.0 ), gNoise( vRest * 8.0 + 7.3 ), gNoise( vRest * 8.0 + 13.1 ) ) * 1.4;
      vec3 cell = gCells( wp + vec3( 1.7, 0.3, 4.2 ) );
      float pick = fract( cell.z * 7.31 );
      float rc = abs( gNoise( vRest * vec3( 15.0, 8.0, 15.0 ) + 2.3 ) - 0.5 );
      float runs = smoothstep( 0.026, 0.008, rc ) * smoothstep( 1.55, 0.75, sl );
      ggCrack = max( smoothstep( 0.1, 0.0, cell.y ) * step( 0.25, pick ) * smoothstep( 0.05, 0.3, reg ), runs ) * uWound.x;
      float gone = step( 0.3, cell.z ) * smoothstep( 0.15, 0.5, reg ) * uWound.x;
      ggTorn = gone * smoothstep( 0.075, 0.03, cell.y ) * smoothstep( 0.0, 0.015, cell.y );
      ggChip = gone * smoothstep( 0.03, 0.07, cell.y );
      float soot = clamp( halo * ( 0.2 + 0.8 * gFbm( vRest * 11.0 + 2.0 ) ) + reg * 0.35, 0.0, 1.0 ) * uWound.x;
      diffuseColor.rgb *= 1.0 - 0.85 * soot;
      diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.018, 0.015, 0.013 ), ggChip );
      diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.005, 0.004, 0.004 ), ggCrack );
      diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.6, 0.55, 0.47 ), ggTorn * 0.9 );
      // dried blood run down the front of the plate from the break (the figure faces −Z)
      float below = uShoulder.y - vRest.y;
      float lane = abs( fract( ( vRest.x - uShoulder.x ) * 16.0 + gNoise( vec3( vRest.x * 40.0, vRest.y * 7.0, 2.0 ) ) * 0.7 ) - 0.5 );
      float len = 0.06 + 0.22 * gNoise( vec3( floor( ( vRest.x - uShoulder.x ) * 16.0 ) * 3.7, 1.0, 5.0 ) );
      float plate = smoothstep( 0.0, -0.02, vRest.z - uShoulder.z ) * smoothstep( 0.13, 0.08, abs( vRest.x - uShoulder.x ) );
      float drip = smoothstep( 0.16, 0.07, lane ) * smoothstep( -0.02, 0.03, below ) * smoothstep( len + 0.03, len, below ) * plate * uWound.x;
      diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.1, 0.008, 0.005 ), drip * 0.9 );
      ggBlood = max( ggBlood, drip );
    }
    if ( uFace.w > 0.0 ) {
      float s = max( uFace.w, 0.05 ) / 0.21;
      vec3 fd = vRest - uFace.xyz;
      // blood: a run from under the figure's right eye (+X) down the cheek to the jaw, thinning as it goes, wandering
      // a little, and smeared round the eye (dark enough to read by value alone: Witness V is graded almost to sepia)
      float wob = ( gNoise( vec3( 3.0, vRest.y * 70.0, 1.0 ) ) - 0.5 ) * 0.008 * s;
      float wid = mix( 0.02, 0.007, smoothstep( -0.014 * s, -0.11 * s, fd.y ) ) * s;
      float run = smoothstep( wid, wid * 0.35, abs( fd.x - 0.03 * s + wob ) )
        * smoothstep( -0.006 * s, -0.016 * s, fd.y ) * smoothstep( -0.13 * s, -0.1 * s, fd.y );
      float smear = smoothstep( 0.03 * s, 0.011 * s, length( vec2( fd.x - 0.036 * s, ( fd.y + 0.012 * s ) * 1.5 ) ) ) * ( 0.55 + 0.45 * gNoise( vRest * 120.0 ) );
      float face = smoothstep( 0.1, 0.5, -vRestN.z );
      ggBlood = max( ggBlood, max( run, smear * 0.85 ) * face * uWound.x );
      diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.07, 0.004, 0.003 ), ggBlood * 0.96 );
      // ash: the darkest, least saturated texels of the hair (above the brow, or behind the ears) go dusty grey in patches
      float scalp = max( smoothstep( 0.05 * s, 0.075 * s, fd.y ), smoothstep( 0.035 * s, 0.08 * s, fd.z ) * smoothstep( -0.05 * s, -0.01 * s, fd.y ) );
      float hair = smoothstep( 0.32, 0.15, mx ) * smoothstep( 0.5, 0.25, sat ) * aurHead( fd, s );
      // (polish 4: dust in clumps, not a grey cap — the King's hair stays dark, as in his concept)
      float ash = scalp * hair * smoothstep( 0.53, 0.66, gFbm( vRest * 34.0 + 5.0 ) ) * uWound.x;
      diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.12, 0.115, 0.105 ) * ( 0.6 + 0.8 * gNoise( vRest * 130.0 ) ), ash * 0.7 );
      ggHair = max( ggHair, ash );
    }
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
      // FACE ONLY (regions.ts): violet irises, veins at the temples and the neck; nothing else is touched
      // (polish 4: the iris has depth — a black pupil, violet fibres brightening toward it, a dark limbal ring, the
      // light held inside it — and the veins are wide enough to read at 2 m, with a bruised shadow along them)
      if ( uFace.w > 0.0 ) {
        float a = uCorruption;
        vec3 ip = aurIrisPolar( fd, vRestN, fs );
        float disc = smoothstep( 1.06, 0.88, ip.x ) * ip.z * smoothstep( 0.0, 0.3, a );
        float fib = gNoise( vec3( ip.y * 6.0, ip.x * 2.5, uSeed.x * 17.0 ) );
        float pupil = smoothstep( 0.4, 0.3, ip.x );
        float limb = smoothstep( 0.66, 1.0, ip.x );
        vec3 iris = mix( vec3( 0.3, 0.085, 0.6 ), vec3( 0.05, 0.012, 0.11 ), smoothstep( 0.34, 0.95, ip.x ) ) * ( 0.6 + 0.8 * fib );
        iris = mix( iris, vec3( 0.015, 0.004, 0.025 ), max( pupil, limb * 0.85 ) );
        diffuseColor.rgb = mix( diffuseColor.rgb, iris, disc * 0.94 );
        ggIris = disc * smoothstep( 0.3, 0.4, ip.x ) * smoothstep( 0.72, 0.42, ip.x ) * ( 0.35 + 0.9 * fib );
        ggEye = max( ggEye, disc );
        // (on a face with skin shading the veins stay on the skin, not on a strand of hair over the temple)
        float region = aurFaceVeinRegion( fd, fs ) * mix( 1.0, ggSkinCore, step( 0.001, uSkin.x ) );
        float w1 = abs( gNoise( vRest * vec3( 42.0, 22.0, 42.0 ) + uSeed * 3.0 ) - 0.5 );
        float w2 = abs( gNoise( vRest * 95.0 + 7.0 ) - 0.5 );
        // the veins reach further from their roots as the amount rises
        float reach = smoothstep( 1.0 - a, 1.25 - a, region + gNoise( vRest * 19.0 ) * 0.25 );
        float thick = smoothstep( 0.075, 0.022, w1 ) + 0.55 * smoothstep( 0.04, 0.01, w2 );
        float bruise = smoothstep( 0.16, 0.05, w1 ) * reach * region;
        ggVein = clamp( thick * reach * region, 0.0, 1.0 );
        diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 0.6, 0.52, 0.72 ), bruise * 0.45 );
        diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.06, 0.018, 0.1 ), ggVein * 0.9 );
        // dark veins with a little light in them; the irises carry the light
        ggVein *= 0.08;
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
  // POLISH 4 (CorruptionOpts.arms): black patterns racing down both arms from the shoulders, light running in
  // them and at their front — with the face-only mode this is «Black patterns race down both arms»
  if ( uArmCorr > 0.001 && uArmB.w > 0.0 && uFace.w > 0.0 ) {
    vec3 ap = vec3( abs( vRest.x ), vRest.y, vRest.z );
    vec3 ab = uArmB.xyz - uArmA.xyz;
    float t = dot( ap - uArmA.xyz, ab ) / max( dot( ab, ab ), 1e-4 );
    float dArm = length( ap - ( uArmA.xyz + ab * clamp( t, 0.0, 1.08 ) ) );
    float arm = smoothstep( uArmB.w, uArmB.w * 0.7, dArm ) * smoothstep( -0.12, 0.0, t ) * smoothstep( 1.3, 1.12, t );
    if ( arm > 0.0 ) {
      float n = gFbm( vRest * 9.0 + uSeed * 3.0 );
      float reachA = uArmCorr * 1.3 - 0.1;
      float tt = t + ( n - 0.5 ) * 0.35;
      float taken = smoothstep( reachA + 0.07, reachA - 0.07, tt ) * arm;
      float l1 = abs( gNoise( vRest * vec3( 26.0, 13.0, 26.0 ) + uSeed * 5.0 ) - 0.5 );
      float l2 = abs( gNoise( vRest * 62.0 + 2.0 ) - 0.5 );
      float lines = clamp( smoothstep( 0.075, 0.018, l1 ) + 0.6 * smoothstep( 0.05, 0.012, l2 ), 0.0, 1.0 );
      float blot = smoothstep( 0.52, 0.72, n );
      diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.035, 0.022, 0.055 ), clamp( lines + blot * 0.85, 0.0, 1.0 ) * taken * 0.93 );
      float edgeA = smoothstep( reachA - 0.2, reachA - 0.02, tt ) * taken;
      ggVein = max( ggVein, lines * taken * ( 0.06 + 0.32 * edgeA ) );
      ggCorr = max( ggCorr, blot * taken * 0.6 );
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
// wounded: the chipped metal is rougher and duller, the cracks matt, the blood wet
roughnessFactor = mix( roughnessFactor, 0.62, ggChip );
metalnessFactor = mix( metalnessFactor, 0.55, ggChip );
roughnessFactor = mix( roughnessFactor, 0.9, ggCrack );
roughnessFactor = mix( roughnessFactor, 0.2, ggBlood );
metalnessFactor *= 1.0 - ggBlood;
// (polish 4) the torn edge of a missing flake is bright raw metal
roughnessFactor = mix( roughnessFactor, 0.3, ggTorn );
metalnessFactor = mix( metalnessFactor, 0.9, ggTorn );
// POLISH 4: skin — an oilier T-zone and wet lips over a drier face, never metal; the eye's wet glint; a dull dressing
roughnessFactor = mix( roughnessFactor, clamp( 0.6 - 0.13 * ggTZone - 0.2 * ggLip + ggSkinVar, 0.3, 0.75 ), ggSkin * 0.85 );
metalnessFactor *= 1.0 - ggSkin;
roughnessFactor = mix( roughnessFactor, 0.2, ggEye * 0.8 );
roughnessFactor = mix( roughnessFactor, max( roughnessFactor, 0.7 ), ggHairy );
roughnessFactor = mix( roughnessFactor, 0.88, ggBand );
metalnessFactor *= 1.0 - ggBand;
`;

/** after <normal_fragment_maps>: every ice crystal catches the light at its own angle */
const FRAG_NORMAL = /* glsl */ `
normal = normalize( normal + ggFacet * 0.85 );
// POLISH 4: fine relief on the face (pores, gauze weave, hair strands) from ggBump, a height in metres — the same
// screen-space bump three.js uses for bump maps
if ( uFace.w > 0.0 ) {
  float bx = dFdx( ggBump ), by = dFdy( ggBump );
  vec3 sX = dFdx( - vViewPosition ), sY = dFdy( - vViewPosition );
  vec3 r1 = cross( sY, normal ), r2 = cross( normal, sX );
  float det = dot( sX, r1 ) * faceDirection;
  vec3 grad = sign( det ) * ( bx * r1 + by * r2 );
  if ( abs( det ) > 0.0 ) normal = normalize( abs( det ) * normal - grad );
}
`;

/** after <emissivemap_fragment> */
const FRAG_EMISSIVE = /* glsl */ `
{
  vec3 vdir = normalize( vViewPosition );
  float ndv = clamp( dot( normal, vdir ), 0.0, 1.0 );
  float fres = pow( 1.0 - ndv, 3.0 );
  // POLISH 4: on the head the fresnel follows the skull, not the mesh — the generated faces fold their mesh into
  // the eyes, nostrils and lips, and a rim taken from those folds drew white-blue outlines round them
  if ( ggHead > 0.001 && uHeadW.w > 0.0 ) {
    vec3 hc = ( viewMatrix * vec4( uHeadW.xyz, 1.0 ) ).xyz;
    ggNdvM = clamp( dot( normalize( - vViewPosition - hc ), vdir ), 0.0, 1.0 );
    // (the smaller of the two: a fold where the skull faces the camera loses its rim, a real outline keeps it, and
    // below the skull — neck, braid — the mesh's own value stands)
    fres = mix( fres, min( fres, pow( 1.0 - ggNdvM, 3.0 ) ), ggHead );
  }
  float shimmer = 0.9 + 0.2 * gNoise( vec3( vRest.xz * 30.0, uTime * 1.7 ) );
  totalEmissiveRadiance += ggLamp * uGlow * shimmer;
  // rim: brightest on upper, grazing surfaces
  float up = 0.55 + 0.45 * clamp( normal.y * 0.8 + 0.4, 0.0, 1.0 );
  totalEmissiveRadiance += uRim.rgb * ( uRim.a * fres * up );
  // a Witness V figure: lit from within, a warm light gathering at its edges — white at the head, gold at the hem
  if ( uWitness.x + uWitness.y > 0.0 ) {
    float gy = clamp( vRest.y / max( uWitness.z, 0.5 ), 0.0, 1.0 );
    vec3 wc = mix( vec3( 1.0, 0.7, 0.34 ), vec3( 1.0, 0.94, 0.82 ), gy );
    totalEmissiveRadiance += diffuseColor.rgb * uWitness.x;
    // (polish 4: dark hair keeps most of its darkness — the edge light had turned the King's head white)
    totalEmissiveRadiance += wc * uWitness.y * ( 0.03 + 0.05 * gy + 0.5 * fres ) * ( 1.0 - 0.65 * ggHairy );
  }
  // frost: a cold shell that reads without lighting the scene
  totalEmissiveRadiance *= 1.0 - ggFz * 0.55;
  totalEmissiveRadiance += vec3( 0.5, 0.78, 1.0 ) * ( ggFrost * ( 0.035 + fres * 0.3 ) + ggRidge * 0.2 + ggFz * fres * 0.1 );
  // corruption: light lives in the veins and pulses slowly
  float pulse = 0.65 + 0.35 * sin( uTime * 3.1 + vRest.y * 9.0 );
  totalEmissiveRadiance += vec3( 0.48, 0.2, 1.0 ) * ( ggVein * pulse * 3.4 + ggCorr * fres * 0.35 );
  // a taken iris holds a low violet light of its own
  // (polish 4: a ring of light round the pupil, deepest where the eye faces the viewer — held inside the eye)
  totalEmissiveRadiance += vec3( 0.55, 0.22, 1.0 ) * ggIris * ( 0.42 + 0.16 * pulse ) * ( 0.35 + 0.65 * ndv * ndv );
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
    uHeadW: { value: new THREE.Vector4(0, 0, 0, 0) },
    uArmCorr: { value: 0 },
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
    uWitness: { value: new THREE.Vector4(0, 0, 1.8, 0) },
    uWound: { value: new THREE.Vector4(0, -1, 0, 0) },
    uShoulder: { value: new THREE.Vector4(0, -10, 0, 0.13) },
    uSkin: { value: new THREE.Vector4(0, 0, 0, 0) },
    uFaceFx: { value: new THREE.Vector4(0, 0, 0, 0) },
    uArmA: { value: new THREE.Vector4(0, 0, 0, 0) },
    uArmB: { value: new THREE.Vector4(0, 0, 0, 0) },
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
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + FRAG_EMISSIVE)
      .replace('#include <lights_physical_pars_fragment>', '#include <lights_physical_pars_fragment>\n' + LIGHT_PARS)
      .replace('#include <aomap_fragment>', '#include <aomap_fragment>\n' + FRAG_AO);
  };
  material.customProgramCacheKey = () => 'aurelion-glb-9';

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
