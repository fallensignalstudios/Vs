/**
 * Where on a figure the state overlays act (polish 3). Shared by the procedural humanoid shader and the
 * generated-body (GLB) shader; both evaluate it in bind-pose ("rest") space — metres, Y up, feet at 0, the
 * figure facing −Z (its left is −X) — so a region sticks to the surface under skinning.
 *
 *  - Frost: the whole figure (setFrozen's classic arrest), or ONE BOOT — ice locked round the lead foot
 *    (Z05: "she locks ice round his lead boot") — or both. A localized frost grows a thick, solid shell up to the
 *    top of the boot and nothing else: no colour drain, no slowing of the animation.
 *  - Corruption: the whole figure (one flank creeping over it), the FACE only (Lyric: violet in the irises,
 *    thin veins at the neck and the temples, the rest of her untouched), or HALF THE FACE (the linkbound whose
 *    face is half human: the body is taken, and on the head one half, split by a ragged line).
 *
 * Uniforms (both shaders):
 *   uLocal  x frost region (0 body · 1 left foot · 2 right foot · 3 both feet), y corruption mode (0 body ·
 *           1 face · 2 half face), z half-face side (+1: the figure's right half is taken), w boot top (m)
 *   uFace   eye centre (between the eyes) in rest space, w = skull size (head joint → crown); w = 0 = the
 *           surface has no face (props): face-only corruption leaves it clean
 */
import type * as THREE from 'three';

export type FrostRegion = 'body' | 'footL' | 'footR' | 'feet' | 'lead';
export type CorruptionMode = 'body' | 'face' | 'halfFace';

/** `lead` = the left boot: the forward foot of a right-handed guard stance. */
export function frostCode(region: FrostRegion | undefined): number {
  switch (region) {
    case 'footL':
    case 'lead':
      return 1;
    case 'footR':
      return 2;
    case 'feet':
      return 3;
    default:
      return 0;
  }
}

export function corruptionCode(mode: CorruptionMode | undefined): number {
  return mode === 'face' ? 1 : mode === 'halfFace' ? 2 : 0;
}

/** default top of the boot above the sole, metres */
export const BOOT_TOP = 0.34;

/** Fresh uniform values: whole-body frost and corruption, right half for a half face. */
export function localDefaults(v: THREE.Vector4): THREE.Vector4 {
  return v.set(0, 0, 1, BOOT_TOP);
}

/** GLSL (both stages): the frost mask of a rest-space point; 1 everywhere for whole-body frost. */
export const FROST_REGION_GLSL = /* glsl */ `
float aurFrostRegion( vec3 r, vec4 loc ) {
  if ( loc.x < 0.5 ) return 1.0;
  float top = loc.w > 0.05 ? loc.w : ${BOOT_TOP.toFixed(2)};
  // up to the boot's top (lower at the heel, higher over the shin), the facing −Z figure's left is −X
  float h = smoothstep( top + 0.05, top - 0.04, r.y + r.z * 0.25 );
  float side = loc.x < 1.5 ? smoothstep( 0.035, -0.02, r.x ) : ( loc.x < 2.5 ? smoothstep( -0.035, 0.02, r.x ) : 1.0 );
  return h * side;
}
`;

/**
 * GLSL (fragment): masks for the face-only and half-face corruption. `d` = rest point − eye centre, `n` = rest
 * normal, `s` = skull size / 0.21 m (proportions measured on the generated heads).
 */
export const FACE_REGION_GLSL = /* glsl */ `
// irises: two small discs either side of the eye centre, on surfaces that face forward
float aurIris( vec3 d, vec3 n, float s ) {
  float front = smoothstep( 0.15, 0.55, -n.z ) * step( abs( d.z ), 0.06 * s );
  float r = length( vec2( abs( d.x ) - 0.031 * s, d.y ) );
  return smoothstep( 0.0068 * s, 0.0042 * s, r ) * front;
}
// where the veins show: the temples (beside and behind the eyes) and the neck (jaw line to collar, not the nape)
float aurFaceVeinRegion( vec3 d, float s ) {
  vec3 t = vec3( abs( d.x ) - 0.062 * s, d.y - 0.022 * s, d.z - 0.025 * s );
  // (polish 4: a little wider at the temples (not onto hair over them) and down the neck, so they read at 2 m)
  float temple = smoothstep( 0.04 * s, 0.014 * s, length( t ) );
  float y = d.y + 0.09 * s;
  float band = smoothstep( 0.0, -0.02 * s, y ) * smoothstep( -0.15 * s, -0.095 * s, y );
  float ring = smoothstep( 0.1, 0.06, length( vec2( d.x, d.z - 0.075 * s ) ) / s );
  float notNape = smoothstep( 0.13 * s, 0.07 * s, d.z );
  return max( temple, band * ring * notNape );
}
// the head above the jaw line (for the half face)
float aurHead( vec3 d, float s ) {
  return smoothstep( -0.17 * s, -0.115 * s, d.y );
}
// POLISH 4: the skull as a ball round its centre (about 7.5 cm behind the eyes, a little below them) — face, scalp,
// ears, jaw and the top of the neck; 0 on the shoulders and the collar
float aurHeadBall( vec3 d, float s ) {
  return smoothstep( 0.165 * s, 0.13 * s, length( vec3( d.x, ( d.y + 0.02 * s ) * 0.85, d.z - 0.075 * s ) ) );
}
// POLISH 4: an iris in polar form — x = distance from its centre in iris radii (6.2 mm at s = 1), y = angle;
// z = 1 on forward-facing surfaces of the eye, 0 elsewhere
vec3 aurIrisPolar( vec3 d, vec3 n, float s ) {
  float front = smoothstep( 0.15, 0.55, -n.z ) * step( abs( d.z ), 0.06 * s );
  vec2 q = vec2( abs( d.x ) - 0.031 * s, d.y );
  return vec3( length( q ) / ( 0.0062 * s ), atan( q.y, q.x ), front );
}
`;
