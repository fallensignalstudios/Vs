/**
 * Sky dome shader: deep-space gradient, stable star field, nebula, the red remnant, the white remnant and
 * the Wound (a soft vortex: a striated charcoal void inside a fractured, violet-lit shell of rock plates, wrapped in
 * smoke, with a stream of debris torn off toward the red remnant; the background is lensed around it).
 *
 * The vertex stage ignores camera translation, so the dome sits at infinity for ANY camera (main view, planar
 * reflection camera, PMREM cube faces) without having to follow anything on the CPU. It is pinned to the far
 * plane and drawn after the opaque scene with a depth test and no depth write, so interiors that hide the sky
 * pay nothing for it.
 *
 * COST. The fragment program is compiled per quality tier (`#define SKY_DETAIL` 0 low · 1 medium · 2 high/ultra,
 * from QualityProfile), so the cheaper tiers do not merely branch around the expensive code — it is not in the
 * program at all (software rasterisers and some mobile compilers flatten uniform branches). Worst-case
 * value-noise evaluations per pixel, in the Wound's shell band (0.7–1.55 radii, the worst place; the red nebula
 * never reaches it): low ≈ 16, medium ≈ 30, high ≈ 38 — plus three cellular lookups (≈ 30 cheap hashes) for its
 * plates and veins. Inside the void, where the background is skipped, it costs 3; between 1.55 and 2.9 radii only
 * the smoke (7) and the rock lattices (hashes) run. Each body is skipped outside its own cone: red nebula 4.6
 * radii; Wound 2.8 radii, reaching out along its debris stream (≤ 5.2) only while the red remnant is up. `uLite`
 * (set per pass for small secondary targets: reflections, PMREM faces) drops the fine plates, glints and veins.
 */
import { GLSL_DITHER, GLSL_HAZE, GLSL_NOISE } from './glsl';

/**
 * The Wound's void and its boundary. The shader takes these as constants and {@link woundCoreColor} /
 * {@link woundVoidOpacity} / {@link woundEllipse} mirror its maths on the CPU (tests), so "the core is almost black
 * but not flat", "the edge is not a step" and "the opening is not a circle" are checked against the numbers the GPU
 * actually uses.
 */
export const WOUND_LOOK = {
  /**
   * colour of the void at its centre and where it meets the crust (linear, neutral: each preset white-balances it
   * against its own grade with `coreTint`, and lifts it with `woundCore`)
   */
  coreDeep: [0.0055, 0.0055, 0.0055],
  coreRim: [0.0066, 0.0066, 0.0066],
  /** how the lift is spread from the centre to the rim (higher = it stays nearer the rim) */
  coreLift: 2.6,
  /**
   * ± brightness of the faint funnel rings near the rim (concentric, slightly spiral streaks: the walls of the
   * tunnel seen end-on). They fade to nothing inside `ringsFrom` radii, so the middle of the void is calm black.
   */
  rings: 0.4,
  ringsFrom: 0.6,
  /** mean boundary radius, and the opening's half-axes (an ellipse, wider than tall) as factors of it */
  edgeR: 0.965,
  edgeA: 1.05,
  edgeB: 0.93,
  /** how far the boundary wanders with angle at low frequency (full range, Wound radii: ±0.15) */
  edgeWobble: 0.3,
  /** the void fades out over [boundary − edgeIn, boundary + edgeOut]: a soft edge, never a step */
  edgeIn: 0.13,
  edgeOut: 0.06,
} as const;

/** Inside this radius (Wound radii) the void is opaque at every angle: nothing behind it needs shading. */
export const WOUND_SOLID =
  WOUND_LOOK.edgeR * Math.min(WOUND_LOOK.edgeA, WOUND_LOOK.edgeB) - WOUND_LOOK.edgeWobble * 0.5 - WOUND_LOOK.edgeIn - 0.01;

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

/**
 * Linear colour of the void (before its preset's lift and white balance) `rn` boundary radii from its centre,
 * where the funnel-ring noise is `streak` (0..1).
 */
export function woundCoreColor(rn: number, streak: number): [number, number, number] {
  const L = WOUND_LOOK;
  const k = Math.pow(smooth(0, 1, rn), L.coreLift);
  const m = 1 + L.rings * smooth(L.ringsFrom, 0.97, rn) * (2 * streak - 1);
  return [0, 1, 2].map((i) => (L.coreDeep[i] + (L.coreRim[i] - L.coreDeep[i]) * k) * m) as [number, number, number];
}

/** The opening's radius factor toward chart direction (dx, dy) (x right, y up as seen): an ellipse, wider than tall. */
export function woundEllipse(dx: number, dy: number): number {
  const L = WOUND_LOOK;
  const l = Math.hypot(dx, dy) || 1;
  const x = dx / l, y = dy / l;
  return 1 / Math.sqrt((x * x) / (L.edgeA * L.edgeA) + (y * y) / (L.edgeB * L.edgeB));
}

/**
 * Opacity of the void `rn` Wound radii from its centre, where the boundary's low-frequency wander is `wob` (0..1)
 * and the ellipse factor toward this direction is `ell` ({@link woundEllipse}).
 */
export function woundVoidOpacity(rn: number, wob: number, ell = 1): number {
  const L = WOUND_LOOK;
  const rb = L.edgeR * ell + L.edgeWobble * (wob - 0.5);
  return 1 - smooth(rb - L.edgeIn, rb + L.edgeOut, rn);
}

/** The furthest the void's faintest fringe reaches toward chart direction (dx, dy), in Wound radii. */
export function woundVoidReach(dx: number, dy: number): number {
  const L = WOUND_LOOK;
  return L.edgeR * woundEllipse(dx, dy) + L.edgeWobble * 0.5 + L.edgeOut;
}

const glf = (n: number): string => {
  const r = Number(n.toFixed(5));
  return Number.isInteger(r) ? r.toFixed(1) : String(r);
};
const glv = (v: readonly number[]): string => `vec3(${v.map(glf).join(', ')})`;
const WOUND_GLSL_CONSTANTS = [
  `const vec3 CORE_DEEP = ${glv(WOUND_LOOK.coreDeep)};`,
  `const vec3 CORE_RIM = ${glv(WOUND_LOOK.coreRim)};`,
  `const float CORE_LIFT = ${glf(WOUND_LOOK.coreLift)};`,
  `const float CORE_RINGS = ${glf(WOUND_LOOK.rings)};`,
  `const float CORE_RINGS_FROM = ${glf(WOUND_LOOK.ringsFrom)};`,
  `const float EDGE_R = ${glf(WOUND_LOOK.edgeR)};`,
  `const float EDGE_A = ${glf(WOUND_LOOK.edgeA)};`,
  `const float EDGE_B = ${glf(WOUND_LOOK.edgeB)};`,
  `const float EDGE_WOBBLE = ${glf(WOUND_LOOK.edgeWobble)};`,
  `const float EDGE_IN = ${glf(WOUND_LOOK.edgeIn)};`,
  `const float EDGE_OUT = ${glf(WOUND_LOOK.edgeOut)};`,
  `const float WOUND_SOLID = ${glf(WOUND_SOLID)};`,
].join('\n');

export const DOME_VERTEX = /* glsl */ `
uniform float uFarZ;
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
  gl_Position = vec4(p.xy, p.w * uFarZ, p.w); // pinned to the far plane: only pixels nothing else covered are shaded
}
`;

export const DOME_FRAGMENT = /* glsl */ `
precision highp float;
varying vec3 vDir;

uniform float uTime;
uniform float uLite;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform float uWoundR;
uniform float uWoundVis;
uniform float uWoundLens;
uniform float uWoundDebris;
uniform float uWoundHalo;
uniform float uActivity;
uniform float uClosed;
uniform float uRedR;
uniform float uRedVis;
uniform float uWhiteR;
uniform float uWhiteVis;
uniform float uStars;
uniform float uNebula;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform float uHazeAmt;
uniform float uHazeFall;
uniform float uGround;
uniform float uGain;
uniform float uSat;
uniform vec3 uNebTint;
uniform float uStarDens;
uniform float uRedGain;
uniform float uEnclose;
uniform vec3 uEncCol;
uniform float uVeil;
uniform float uWoundScale;
uniform float uSwirl;
uniform float uWoundCore;
uniform vec3 uCoreTint;
uniform vec3 uTint;
${GLSL_NOISE}
${GLSL_HAZE}
${GLSL_DITHER}

float fbm2(vec3 p) { return (0.5 * vnoise(p) + 0.25 * vnoise(FBM_ROT * p * 2.03 + 17.1)) / 0.75; }
float fbm4(vec3 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = FBM_ROT * p * 2.03 + 17.1; a *= 0.5; }
  return s / 0.9375;
}
// octave budget of the two fbm sizes used throughout, per quality tier
#if SKY_DETAIL >= 2
  #define FBM_BIG(p) fbm5(p)
  #define FBM_SMALL(p) fbm3(p)
#elif SKY_DETAIL == 1
  #define FBM_BIG(p) fbm4(p)
  #define FBM_SMALL(p) fbm2(p)
#else
  #define FBM_BIG(p) fbm3(p)
  #define FBM_SMALL(p) fbm2(p)
#endif

// ---------------------------------------------------------------------------------------------------------
// Stars: one jittered star per 3D lattice cell that the unit sphere passes through. Radius is clamped to the
// pixel footprint (energy conserving) so stars never shimmer when the camera turns; nothing depends on time.
// Density is NOT uniform: a tilted band of crowded faint stars, cut by dust lanes, with sparse dark gulfs
// either side — so the field has structure instead of reading as even snow.
// ---------------------------------------------------------------------------------------------------------
const vec3 STAR_POLE = vec3(0.3642, 0.7940, -0.4865);

vec2 starDensity(vec3 d) {
  float lat = dot(d, STAR_POLE);
  float band = exp(-lat * lat * 13.0);
  float clump = vnoise(d * 3.3 + 40.0);
  #if SKY_DETAIL >= 1
  float lane = smoothstep(0.30, 0.62, vnoise(d * vec3(6.0, 10.0, 6.0) + 11.0));
  #else
  float lane = 1.0;
  #endif
  return vec2(clamp(0.10 + 0.85 * clump * clump * clump * 2.0 + 1.25 * band * lane, 0.0, 1.5), band * lane);
}

vec3 starLayer(vec3 d, float n, float px, float seed, float occupancy, float r0, float gamma) {
  vec3 c = floor(d * n);
  vec3 h = hash33(c + seed);
  if (h.x > occupancy) return vec3(0.0);
  vec3 q = c + 0.5 + (hash33(c + seed + 19.7) - 0.5) * 0.7;
  vec3 sd = normalize(q);
  vec3 sp = sd * n - c - 0.5;
  float edge = 0.5 - max(abs(sp.x), max(abs(sp.y), abs(sp.z)));
  float r = max(r0, px * 0.8);
  float w = clamp((edge - 2.3 * r * n) * 12.0, 0.0, 1.0);
  if (w <= 0.0) return vec3(0.0);
  vec3 dv = d - sd;
  float i = exp(-dot(dv, dv) / (r * r)) * (r0 * r0) / (r * r);
  float mag = pow(h.y, gamma);
  vec3 warm = vec3(1.0, 0.74, 0.50), cool = vec3(0.60, 0.76, 1.0);
  vec3 tint = mix(mix(warm, vec3(1.0), smoothstep(0.0, 0.45, h.z)), cool, smoothstep(0.55, 1.0, h.z));
  return tint * (i * mag * w);
}

vec3 starField(vec3 d, float px) {
  vec2 dens = starDensity(d);
  vec3 s = vec3(0.0);
  s += starLayer(d, 86.0, px, 3.0, 0.50 * dens.x * uStarDens, 0.00050, 7.5) * 6.5;
  s += starLayer(d, 47.0, px, 11.0, 0.40 * dens.x * uStarDens, 0.00062, 6.5) * 8.0;
  s += starLayer(d, 23.0, px, 23.0, 0.24 * dens.x * min(uStarDens * 1.5, 1.0), 0.00085, 6.0) * 9.0;
  // unresolved stars of the band itself: a faint milky glow that the lanes cut through
  s += vec3(0.020, 0.021, 0.027) * dens.y * dens.y * uStarDens;
  // a few bright stars with a soft glare (much rarer than before; none of them rivals the white remnant)
  vec3 c = floor(d * 7.0);
  vec3 h = hash33(c + 71.0);
  if (h.x < 0.07 * min(uStarDens * 1.3, 1.0)) {
    vec3 sd = normalize(c + 0.5 + (hash33(c + 90.7) - 0.5) * 0.5);
    vec3 sp = sd * 7.0 - c - 0.5;
    float edge = 0.5 - max(abs(sp.x), max(abs(sp.y), abs(sp.z)));
    float w = clamp((edge - 0.16) * 10.0, 0.0, 1.0);
    vec3 dv = d - sd;
    float a2 = dot(dv, dv);
    float r = max(0.0009, px * 0.9);
    float core = exp(-a2 / (r * r)) * (0.0009 * 0.0009) / (r * r) * 11.0;
    float glare = 0.0000009 / (a2 + 0.00002) * exp(-a2 / 0.00022);
    vec3 tint = mix(vec3(1.0, 0.80, 0.60), vec3(0.68, 0.82, 1.0), h.z);
    s += tint * (core + glare) * (0.12 + 0.88 * h.y * h.y) * w;
  }
  return s;
}

vec3 nebula(vec3 d) {
  vec3 p = d * 1.9;
  #if SKY_DETAIL >= 1
  vec3 w = vec3(vnoise(p * 1.3 + 3.1), vnoise(p * 1.3 + 41.7), vnoise(p * 1.3 + 77.3)) - 0.5;
  float n = FBM_BIG(p + w * 1.5);
  float n2 = FBM_SMALL(p * 2.9 - w * 1.2 + 9.0);
  #else
  float n = fbm3(p);
  float n2 = vnoise(p * 2.9 + 9.0);
  #endif
  float m = smoothstep(0.40, 0.82, n);
  vec3 c = mix(vec3(0.030, 0.036, 0.062), vec3(0.070, 0.056, 0.086), n2);
  c *= m * m * (0.3 + 0.7 * smoothstep(0.28, 0.72, n2));
  return c;
}

// ---------------------------------------------------------------------------------------------------------
// Red remnant: a dying shell being drawn into the Wound — a sphere lit like a crescent (hot limb on the Wound
// side, dark terminator on the far side), sunk into a billowing nebula mass that partly veils its own disc.
// ---------------------------------------------------------------------------------------------------------
// rgb = emitted light, a = how much of the star field behind it is hidden
vec4 redRemnant(vec3 d, float px) {
  float cr = dot(d, uRedDir);
  float ang = acos(clamp(cr, -1.0, 1.0));
  float r = ang / uRedR;
  if (r > 4.6) return vec4(0.0);
  // which way is the Wound from here: the mass and the bright limb lean toward it
  vec3 er = d - uRedDir * cr;
  vec3 en = er / max(length(er), 1e-5);
  vec3 tw = uWoundDir - uRedDir * dot(uWoundDir, uRedDir);
  vec3 twn = tw / max(length(tw), 1e-4);
  float side = dot(en, twn);

  float f = 1.1 / uRedR;
  vec3 q = d * f + vec3(0.0, uTime * 0.003, 0.0);
  #if SKY_DETAIL >= 1
  vec3 w = vec3(vnoise(q * 0.55 + 11.0), vnoise(q * 0.55 + 37.0), vnoise(q * 0.55 + 71.0)) - 0.5;
  #else
  vec3 w = vec3(vnoise(q * 0.55 + 11.0) - 0.5);
  #endif
  float n1 = FBM_BIG(q + w * 2.4);
  float billow = 1.0 - abs(2.0 * FBM_SMALL(q * 1.9 - w * 1.7 + 5.0) - 1.0);
  // the mass thins with distance and is dragged out into a tongue toward the Wound
  float reach = 0.42 - 0.17 * max(side, 0.0);
  float fall = exp(-max(r - 0.85, 0.0) * reach) * (1.0 - smoothstep(2.9, 4.6, r));
  float dens = smoothstep(0.47 - 0.22 * fall, 0.80 - 0.18 * fall, n1 * 0.75 + billow * 0.25) * fall;
  float heat = dens * (0.3 + 0.7 * billow) * fall;
  vec3 col = mix(vec3(0.10, 0.004, 0.004), vec3(0.50, 0.024, 0.012), smoothstep(0.05, 0.5, heat));
  col = mix(col, vec3(1.5, 0.10, 0.045), smoothstep(0.5, 1.0, heat) * 0.85);
  col *= dens * (0.3 + 0.7 * billow) * 0.85;
  // dark dust lanes cut through the mass
  #if SKY_DETAIL >= 2
  float lanes = fbm3(q * 0.9 + w + 31.0);
  #else
  float lanes = vnoise(q * 0.9 + w + 31.0);
  #endif
  col *= 0.30 + 0.70 * smoothstep(0.30, 0.56, lanes);
  // inner corona, brighter on the side that faces the Wound
  col += vec3(1.2, 0.085, 0.03) * exp(-max(r - 1.0, 0.0) * 2.6) * (0.10 + 0.20 * smoothstep(-0.6, 0.8, side)) * (0.5 + n1);

  float aa = max(px / uRedR, 0.004);
  float disc = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, r);
  float cover = min(dens * 1.1, 0.8);
  if (disc > 0.0) {
    // a sphere: lit from the Wound's side and slightly from the viewer, so it reads as a crescent
    float z = sqrt(max(1.0 - r * r, 0.0));
    float lambert = clamp(side * r * 0.90 + z * 0.36 + 0.12, 0.0, 1.0);
    vec3 sq = d * (f * 2.6) + w * 2.6 + vec3(uTime * 0.005, 0.0, 0.0);
    float pl = FBM_BIG(sq);
    float veins = pow(1.0 - abs(2.0 * FBM_SMALL(sq * 2.1 + pl * 2.0) - 1.0), 4.0);
    float limb = pow(1.0 - z, 3.0);
    vec3 surf = mix(vec3(0.030, 0.0012, 0.0012), vec3(0.42, 0.020, 0.008), smoothstep(0.25, 0.8, pl));
    surf += vec3(1.25, 0.085, 0.022) * veins * smoothstep(0.35, 0.8, pl);
    surf *= 0.06 + 1.25 * lambert * lambert;
    surf += vec3(2.6, 0.19, 0.06) * limb * smoothstep(-0.25, 0.85, side);
    // its own nebula drifts in front of the far (dark) side, so the edge there is lost in the mass
    float veil = clamp(dens * 1.5 * smoothstep(0.5, -0.7, side), 0.0, 0.85);
    col = mix(col, surf * (1.0 - veil) + col * (0.25 + 0.75 * veil), disc);
    cover = max(cover, disc);
  }
  return vec4(col, cover);
}

// ---------------------------------------------------------------------------------------------------------
// White remnant: small, hard, very bright — a resolved disc (never a point), with a clean glare and a hairline
// streak that stays level on screen. No noise anywhere near it.
// ---------------------------------------------------------------------------------------------------------
vec3 whiteRemnant(vec3 d, float px) {
  vec3 dv = d - uWhiteDir;
  float ang = length(dv);
  float r0 = max(uWhiteR, px * 1.5);
  float comp = (uWhiteR * uWhiteR) / (r0 * r0);
  float core = (1.0 - smoothstep(r0 * 0.88, r0 * 1.06, ang)) * 24.0 * max(comp, 0.3);
  float g = uWhiteR / (ang + uWhiteR);
  float glare = 0.50 * pow(g, 2.3) + 0.032 * pow(g, 1.15);
  float u = dot(dv, uCamRight), v = dot(dv, uCamUp);
  float lw = max(uWhiteR * 0.14, px * 0.9);
  float streak = exp(-abs(v) / lw) * exp(-abs(u) / (uWhiteR * 15.0)) * 0.55;
  streak += exp(-abs(u) / lw) * exp(-abs(v) / (uWhiteR * 7.0)) * 0.16;
  return vec3(0.80, 0.90, 1.0) * (core + glare + streak);
}

// ---------------------------------------------------------------------------------------------------------
// The Wound — a soft vortex, after the overlook painting:
//   CORE    an almost uniform, neutral near-black void, darkest at the centre. Its only structure is faint funnel
//           rings near the rim (the tunnel's walls seen end-on), which fade to nothing inside 0.6 radii;
//   EDGE    an irregular ellipse (its outline wanders ±0.15 radii at low frequency), overrun by the crust: streaks
//           of matter are dragged in over it along the spiral, so the outline is never a circle;
//   CRUST   one continuous, ragged mass of smoky rock: black ink-splatter masses fused with lit grey-lavender
//           matter (a domain-warped, thresholded fbm with eroded edges, never cells). It is heavy on the upper left
//           and breaks into streaked tendrils on the right flank. Thin branching violet veins run through it, and a
//           few hot violet knots glow inside it;
//   SMOKE   a broad, lit, marbled field of warm-grey smoke around it all (to ≈ 1.8 radii, further down the funnel
//           and toward the red remnant, whose crimson bleeds into its left side);
//   DEBRIS  a dense river of splattered rocks leaving its lower left and arcing under the red remnant to the far
//           left, big chunks thrown toward the remnant's upper-right limb, a thin trail toward the white remnant,
//           loose chunks breaking off the crust: large near the Wound, grading to dust, each rimmed by the light it
//           is nearest (the Wound's lavender, or the remnant's crimson).
// Everything is drawn in a chart around the Wound (azimuthal-equidistant, x right / y up as seen, in Wound radii)
// and sampled through continuous directions, never an angle, so nothing has a seam; the crust, smoke and debris
// turn rigidly at slow rates, so nothing winds up over time.
// ---------------------------------------------------------------------------------------------------------
${WOUND_GLSL_CONSTANTS}
const vec2 UL = vec2(-0.6963, 0.7177);
const vec3 VIOLET = vec3(0.62, 0.30, 0.95);
// the Wound's own light on its crust: a desaturated grey-lavender (saturated violet is kept for what glows)
const vec3 LAVGREY = vec3(0.60, 0.565, 0.66);
// warm-neutral grey smoke, and the crimson that bleeds into it on the red remnant's side
const vec3 SMOKE = vec3(1.0, 1.0, 0.88);
const vec3 RED_SMOKE = vec3(1.0, 0.34, 0.33);
// opacity of the void at this pixel: woundComposite writes it, the horizon haze and the white remnant read it
float gWoundVoid;

#if SKY_DETAIL >= 2
  #define FBM_CRUST(p) fbm4(p)
#else
  #define FBM_CRUST(p) fbm3(p)
#endif

vec2 rot2(vec2 v, float a) { float c = cos(a), s = sin(a); return vec2(c * v.x - s * v.y, s * v.x + c * v.y); }

// The opening's radius factor toward chart direction dir (mirrored by woundEllipse()).
float woundEll(vec2 dir) { return inversesqrt(dir.x * dir.x / (EDGE_A * EDGE_A) + dir.y * dir.y / (EDGE_B * EDGE_B)); }
// Void colour rn boundary radii from the centre; streak 0..1 = the funnel-ring noise there (mirrored by woundCoreColor()).
vec3 woundCore(float rn, float streak) {
  float k = pow(smoothstep(0.0, 1.0, rn), CORE_LIFT);
  return mix(CORE_DEEP, CORE_RIM, k) * (1.0 + CORE_RINGS * smoothstep(CORE_RINGS_FROM, 0.97, rn) * (2.0 * streak - 1.0));
}
// Opacity of the void; wob 0..1 = the boundary's wander at this angle, ell = woundEll (mirrored by woundVoidOpacity()).
float woundVoid(float rn, float wob, float ell) {
  float rb = EDGE_R * ell + EDGE_WOBBLE * (wob - 0.5);
  return 1.0 - smoothstep(rb - EDGE_IN, rb + EDGE_OUT, rn);
}

// One splattered rock per lattice cell, or none: a lumpy, bitten silhouette (ink splatter, never a polygon or a round
// dot), always wholly inside its cell. q = cell coordinates; fill = the chance that a cell holds one (it also grades
// the size: many small, few large); big = the largest size (cell units, ≤ 0.32); toL = where its light comes from
// (cell space); aa = one pixel in cell units. Returns (coverage, rim: the edge facing the light, catching it).
vec2 splatRock(vec2 q, float fill, float big, float seed, float aa, vec2 toL) {
  vec2 c = floor(q);
  vec3 h = hash33(vec3(c, seed));
  if (h.z >= fill) return vec2(0.0);
  float u = 1.0 - h.z / fill;
  float size = big * (0.28 + 0.72 * u);
  vec2 r = q - c - 0.5 - (h.xy - 0.5) * max(1.0 - 3.1 * size, 0.0);
  vec2 rr = rot2(r, h.x * 6.2832);
  rr.y *= 1.0 + 0.8 * h.y; // some are long shards
  float dd = length(rr);
  vec2 nd = rr / max(dd, 1e-5);
  // bulges and bites at two angular scales
  float lump = 0.62 * vnoise(vec3(nd * 1.1 + h.yz * 17.0, h.x * 11.0)) + 0.38 * vnoise(vec3(nd * 2.7 + h.zx * 23.0, 5.0 + h.y * 7.0));
  float rad = size * (0.35 + 1.15 * lump);
  float m = 1.0 - smoothstep(rad - aa, rad + aa, dd);
  float lit = max(dot(r / max(length(r), 1e-5), toL), 0.0);
  float rim = smoothstep(rad - 0.3 * size - 1.5 * aa, rad - 0.5 * aa, dd) * lit * lit;
  return vec2(m, m * rim);
}

// Coordinates along a debris arc from A to B (chart), bowed off its chord by bow × its length toward sv (the chord's
// left-hand normal). Returns (t: 0 at A .. 1 at B, unclamped; signed offset from the arc (R); distance along it (R)).
vec3 arcCoords(vec2 p, vec2 A, vec2 B, float bow, out vec2 su, out vec2 sv) {
  vec2 ch = B - A;
  float L = max(length(ch), 1e-3);
  su = ch / L;
  sv = vec2(-su.y, su.x);
  vec2 rp = p - A;
  float t = dot(rp, su) / L;
  float tc = clamp(t, 0.0, 1.0);
  return vec3(t, dot(rp, sv) - 4.0 * bow * L * tc * (1.0 - tc), t * L);
}

// How crowded a debris arc is at (t along it, offset off it): prof = (width at A, width at B, crowding, size grade).
float arcProfile(float tt, float off, vec4 prof) {
  float w = mix(prof.x, prof.y, clamp(tt, 0.0, 1.0));
  return exp(-off * off / (w * w)) * smoothstep(-0.04, 0.05, tt) * (1.0 - smoothstep(0.78, 1.08, tt)) * prof.z;
}
// One layer of an arc's rocks in cells of size cs (R), each cell deciding from its own centre whether it holds one.
vec2 arcLayer(vec2 sq, float cs, vec2 o, float L, float flow, vec4 prof, float fill, float bigW, float seed, float pxn, vec2 Ls) {
  vec2 q = sq / cs + o;
  vec2 cc = (floor(q) + 0.5 - o) * cs;
  float tt = (cc.x - flow) / L;
  float dn = arcProfile(tt, cc.y, prof);
  float g = prof.w * (1.0 - clamp(tt, 0.0, 1.0));
  return splatRock(q, dn * fill * mix(1.0, g, bigW), 0.31, seed, pxn / cs, Ls);
}
// The rocks of one debris arc, drifting along it toward the Wound: a big, a middle, a fine and a grit layer, the big
// ones only where the arc is graded large (near the Wound). Lc = light direction (chart). Composites over occ, rim.
void arcRocks(vec3 ac, float L, vec2 su, vec2 sv, vec4 prof, float flow, float seed, float pxn, vec2 Lc, bool fine, inout float occ, inout float rim) {
  vec2 sq = vec2(ac.z + flow, ac.y);
  vec2 Ls = vec2(dot(Lc, su), dot(Lc, sv));
  vec2 r = arcLayer(sq, 0.6, vec2(0.0, 0.5), L, flow, prof, 0.95, 1.0, seed, pxn, Ls);
  rim = rim * (1.0 - r.x) + r.y; occ += r.x * (1.0 - occ);
  r = arcLayer(sq, 0.24, vec2(0.37, 0.5), L, flow, prof, 0.9, 0.5, seed + 3.0, pxn, Ls);
  rim = rim * (1.0 - r.x) + r.y; occ += r.x * (1.0 - occ);
  #if SKY_DETAIL >= 1
  if (fine) {
    r = arcLayer(sq, 0.085, vec2(0.71, 0.13), L, flow, prof, 0.8, 0.0, seed + 7.0, pxn, Ls);
    rim = rim * (1.0 - r.x) + r.y; occ += r.x * (1.0 - occ);
    #if SKY_DETAIL >= 2
    r = arcLayer(sq, 0.034, vec2(0.29, 0.83), L, flow, prof, 0.6, 0.0, seed + 9.0, pxn, Ls);
    occ += r.x * (1.0 - occ);
    #endif
  }
  #endif
}

// A hot violet knot in the crust at chart position k: a tight core that blooms, a soft halo, and on the hottest a
// faint four-point sparkle. Adds its light to glow and its weight as a vein cluster to cl.
void woundKnot(vec2 p, vec2 k, float heat, float pxn, float t, float ph, inout float glow, inout float cl) {
  vec2 dv = p - k;
  float d2 = dot(dv, dv);
  float dd = sqrt(d2);
  float pulse = 0.78 + 0.22 * sin(t * (0.55 + 0.1 * ph) + ph * 2.3);
  float rc = max(0.016, pxn * 1.1);
  float core = exp(-d2 / (rc * rc)) * (0.016 * 0.016) / (rc * rc);
  float halo = exp(-dd / 0.05) * 0.45 + exp(-dd / 0.16) * 0.10 + exp(-dd / 0.4) * 0.025;
  float spark = 0.0;
  if (heat > 1.0) {
    float lw = max(0.003, pxn * 0.6);
    spark = (exp(-abs(dv.y) / lw) * exp(-abs(dv.x) / 0.15) + exp(-abs(dv.x) / lw) * exp(-abs(dv.y) / 0.10)) * 0.45;
  }
  glow += heat * pulse * (core * 6.0 + halo + spark);
  cl += heat * exp(-dd / 0.32);
}
// a knot sitting off radii outside the mean boundary, at angle a (radians, chart)
vec2 knotAt(float a, float off) { vec2 u = vec2(cos(a), sin(a)); return u * (EDGE_R * woundEll(u) + off); }

vec3 woundComposite(vec3 col, vec3 d, float rn, vec3 e, float px, float R) {
  vec3 W = uWoundDir;
  // the debris river reaches past the red remnant, so the Wound's cone grows with that distance (when there is one)
  float cRed = dot(uRedDir, W);
  float redDist = acos(clamp(cRed, -1.0, 1.0)) / R;
  float reach = uRedVis > 0.01 ? clamp(redDist * 1.3, 2.6, 5.4) : 2.6;
  if (rn > reach) return col;
  float pxn = px / R;
  vec3 base = col;
  float t = uTime;
  float settle = 1.0 - 0.88 * uClosed;
  float act = uActivity * settle;
  bool lite = uLite > 0.5;

  // the chart: x right, y up as seen (world up projected onto the sky at the Wound)
  vec3 Yc = vec3(0.0, 1.0, 0.0) - W * W.y;
  float yl = length(Yc);
  Yc = yl > 1e-3 ? Yc / yl : vec3(0.0, 0.0, -1.0);
  vec3 Xc = cross(W, Yc);
  vec2 dir = vec2(dot(e, Xc), dot(e, Yc));
  vec2 p = dir * rn;
  vec3 tr = uRedDir - W * cRed;
  vec2 toRed = vec2(dot(tr, Xc), dot(tr, Yc));
  toRed = length(toRed) > 1e-5 ? normalize(toRed) : vec2(-1.0, 0.0);
  vec2 redP = toRed * redDist;
  float sr = max(dot(dir, toRed), 0.0) * uRedVis;
  // where the Wound's own light falls on its matter: brightest upper left, some on the right flank
  float ulw = smoothstep(-0.35, 0.85, dot(dir, UL));
  float rgt = smoothstep(-0.1, 0.75, dir.x) * (1.0 - 0.6 * smoothstep(0.3, 0.9, dir.y));
  float down = max(-dir.y, 0.0);
  float gate = 0.3 + 0.7 * ulw + 0.25 * rgt;

  // --- the boundary: an irregular ellipse whose outline wanders slowly by ±0.15 R (smooth once closed)
  float ell = woundEll(dir);
  float n1 = vnoise(FBM_ROT * vec3(dir * 0.85, 1.7 + t * 0.006));
  float n2 = vnoise(FBM_ROT * vec3(dir * 1.9, 9.1 - t * 0.008));
  float wlo = clamp((n1 - 0.5) * 2.4 + 0.5, 0.0, 1.0);
  float wob = mix(clamp((0.64 * n1 + 0.36 * n2 - 0.5) * 2.4 + 0.5, 0.0, 1.0), wlo, uClosed);
  float rb = EDGE_R * ell + EDGE_WOBBLE * (wob - 0.5);
  float rho = rn / rb;
  float lr = log(max(rho, 0.05));
  float x = rn - rb; // signed distance past the boundary (R)

  // the crust, its smoke and its debris turn slowly with the vortex (rigidly, so nothing winds up)
  float spin = -t * 0.0035;
  vec2 pc = rot2(p, spin);

  // funnel streaks: tight spiral flow lines (≈ 10° pitch): the tunnel's walls seen end-on, crust dragged inward
  float fsk = 0.5;
  if (rho > 0.55 && rho < 1.45) {
    vec2 fd = rot2(dir, 5.5 * lr + spin * 1.5);
    float f1 = vnoise(vec3(fd * 4.5, rho * 3.0 + 1.0));
    #if SKY_DETAIL >= 1
    float f2 = lite ? f1 : vnoise(vec3(fd * 11.0 + 3.0, rho * 7.0 + 5.0));
    #else
    float f2 = f1;
    #endif
    fsk = smoothstep(0.15, 0.85, 0.6 * f1 + 0.4 * f2);
  }
  // drag streaks: a looser spiral (≈ 25° pitch), so matter pulled in over the edge crosses it instead of following it
  float fdr = 0.5;
  if (x > -0.34 && x < 0.75) {
    vec2 fe = rot2(dir, 2.1 * lr + spin * 1.5);
    float g1 = vnoise(vec3(fe * 3.2, rho * 2.4 + 21.0));
    #if SKY_DETAIL >= 1
    float g2 = lite ? g1 : vnoise(vec3(fe * 8.0 + 5.0, rho * 5.5 + 13.0));
    #else
    float g2 = g1;
    #endif
    fdr = smoothstep(0.18, 0.82, 0.62 * g1 + 0.38 * g2);
  }

  // --- 1. smoke: a broad, lit, marbled field of warm-grey smoke: fine turbulence with only a mild shear (no arms).
  //        It reaches further up-left, down the funnel toward the horizon and toward the red remnant, whose crimson
  //        bleeds into it. It is matter, not glow: it hides the sky behind it.
  float hReach = 1.5 + 0.4 * ulw + 0.4 * down + 0.5 * sr;
  if (rho > 0.82 && rn < hReach + 0.4) {
    vec2 ps = rot2(pc, 0.22 * log(max(rn, 0.3)));
    #if SKY_DETAIL >= 1
    vec3 q = vec3(ps * 1.9, t * 0.004);
    vec2 wv = vec2(vnoise(q + 3.0), vnoise(q + 19.0)) - 0.5;
    float s = FBM_BIG(vec3(ps * 3.3 + wv * 2.6, t * 0.005 + 7.0));
    float fine = lite ? s : FBM_SMALL(vec3(ps * 10.0 + wv * 5.0, 2.0 + t * 0.007));
    #else
    float s = fbm3(vec3(ps * 3.3, 7.0));
    float fine = s;
    #endif
    // thin pale folds where the turbulence shears: the marbling
    float marble = pow(1.0 - abs(2.0 * fine - 1.0), 6.0);
    float prof = smoothstep(0.86, 1.04, rho) * pow(1.0 - smoothstep(0.95, hReach + 0.4, rn), 1.4);
    float smA = min(prof * (1.0 + 0.8 * down * smoothstep(1.0, 1.5, rn)), 1.0) * (0.55 + 0.45 * smoothstep(0.28, 0.7, s)) * uWoundHalo;
    float v = (0.05 + 0.10 * smoothstep(0.3, 0.8, s) + 0.07 * marble * smoothstep(0.4, 0.7, s)) * (0.75 + 0.4 * ulw);
    vec3 smC = SMOKE * v + LAVGREY * 0.10 * ulw * exp(-max(x, 0.0) / 0.3) * smoothstep(0.4, 0.8, s);
    float bleed = sr * smoothstep(0.95, 1.8, rn);
    smC = mix(smC, RED_SMOKE * v * 1.5, min(bleed * 1.3, 0.9));
    col = mix(col, smC * uSwirl, smA);
  }

  // --- 2. the void, and the crust's streaks dragged in over its edge along the spiral
  float voidA = woundVoid(rn, wob, ell);
  if (voidA > 0.0) col = mix(col, woundCore(rho, fsk) * uWoundCore * uCoreTint, voidA);
  // the black of its rock: charcoal, never darker than the void itself (or the void reads as a lighter disc)
  vec3 ink = CORE_RIM * 1.15 * uWoundCore * uCoreTint;
  float open = 1.0 - 0.3 * uClosed;
  if (rho > 0.72 && rho < 1.12) {
    float drag = smoothstep(0.74, 0.96, rho) * (1.0 - smoothstep(1.0, 1.12, rho));
    float sA = drag * smoothstep(0.6, 0.9, fsk) * (0.3 + 0.4 * max(ulw, rgt)) * uWoundDebris * open;
    vec3 sC = mix(ink * 1.25, LAVGREY * 0.022 * gate, smoothstep(0.82, 0.97, fsk));
    col = mix(col, sC, sA);
  }

  // the hot violet knots inside the crust (light added after it; their glow tints the matter around them)
  float vio = (0.25 + 0.75 * act) * (1.0 - 0.9 * uClosed);
  float glow = 0.0, cl = 0.0;
  if (!lite && rho > 0.75 && rn < 2.2) {
    woundKnot(p, knotAt(2.62, 0.14), 1.0, pxn, t, 0.0, glow, cl);
    woundKnot(p, knotAt(2.13, 0.04), 0.55, pxn, t, 1.0, glow, cl);
    woundKnot(p, knotAt(-0.42, 0.13), 1.4, pxn, t, 2.0, glow, cl);
    woundKnot(p, knotAt(0.12, 0.2), 0.6, pxn, t, 3.0, glow, cl);
    woundKnot(p, knotAt(-1.08, -0.03), 0.7, pxn, t, 4.0, glow, cl);
  }

  // --- 3. the crust: one ragged, mottled mass of smoky rock crowding the boundary. Lit grey-lavender matter with
  //        black ink-splatter masses fused into it; thick upper left (≈ 0.55 R past the void), half that and
  //        streaked into tendrils on the right flank, reaching in over the void's edge.
  float matter = 0.0, inkA = 0.0;
  vec2 wb = vec2(0.0);
  float outR = mix(0.28, 0.58, ulw) * (0.8 + 0.35 * act) + 0.1 * down;
  if (x > -0.32 && x < outR + 0.15) {
    float inR = mix(0.04, 0.24, smoothstep(0.3, 0.7, vnoise(FBM_ROT * vec3(dir * 1.4, 5.0 + t * 0.005)))) * (0.55 + 0.45 * max(ulw, rgt));
    float band = smoothstep(-inR - 0.06, -inR + 0.06, x) * (1.0 - smoothstep(outR * 0.25, outR, x));
    #if SKY_DETAIL >= 1
    vec3 qb = vec3(pc * 2.2, 4.0);
    wb = vec2(vnoise(qb + 1.0), vnoise(qb + 13.0)) - 0.5;
    float blob = FBM_CRUST(vec3(pc * 2.8 + wb * 1.4, 4.0 + t * 0.002));
    // the ink's own splatter field: finer than the matter's, so its masses run from a third of a radius to specks
    float sp = fbm3(vec3(pc * 6.5 + wb * 2.2, 11.0));
    float ero = lite ? 0.5 : 0.65 * vnoise(vec3(pc * 15.0 + wb, 21.0)) + 0.35 * vnoise(vec3(pc * 34.0, 27.0));
    #else
    float blob = fbm3(vec3(pc * 2.8, 4.0));
    float sp = vnoise(vec3(pc * 6.5, 11.0));
    float ero = 0.5;
    #endif
    // on the right flank the same matter is sheared along the spiral into streaks, and where it reaches in over the
    // void it is dragged into the funnel's spiral (streaks, never lumps)
    float n = mix(blob, 0.35 * blob + 0.65 * fdr, rgt * 0.85);
    n = mix(n, 0.3 * blob + 0.7 * fdr, smoothstep(0.06, -0.1, x));
    matter = smoothstep(0.36, 0.52, n + 0.7 * (band - 0.5));
    // ink: black rock where the mass is densest, its edges bitten by finer noise (eroded, not cut); out past the
    // matter only its largest masses survive, as splatter breaking away
    float inkF = sp + 0.22 * (ero - 0.5) + 0.2 * (band - 0.5) + 0.25 * (blob - 0.5) - 0.06 * rgt - 0.12 * smoothstep(0.0, -0.12, x);
    float aaI = max(fwidth(inkF) * 0.8, 0.004);
    inkA = smoothstep(0.64 - aaI, 0.64 + aaI, inkF);
    // the edge of an ink mass that faces the light catches it: the Wound's lavender, or the red remnant's crimson
    vec2 gi = vec2(dFdx(inkF), dFdy(inkF));
    float gl = length(gi);
    float redness = smoothstep(0.45, 0.95, sr);
    vec2 Lr = normalize(mix(normalize(UL - dir * 0.6), toRed, redness));
    float facing = gl > 1e-6 ? max(dot(-gi / gl, Lr), 0.0) : 0.0;
    float rimBand = 1.0 - smoothstep(0.62 + aaI, 0.64 + aaI + clamp(1.6 * gl, 0.002, 0.06), inkF);
    float inkRim = inkA * rimBand * facing * facing;
    // the matter's light: mottled, strongest upper left, dimmer and greyer in the right flank's streaks
    float mott = clamp(0.62 + 0.35 * (ero - 0.5) + 1.6 * (blob - 0.5) + 1.0 * rgt * (fdr - 0.5), 0.12, 1.9);
    // the matter darkens into the funnel, but unevenly: lit streaks run on down into it
    float deep = 0.1 + 0.9 * smoothstep(-0.12, 0.16, x + 0.16 * (fdr - 0.5));
    vec3 matC = LAVGREY * (0.05 + 0.34 * gate) * mott * deep;
    matC = mix(matC, RED_SMOKE * (0.04 + 0.16 * gate) * mott * deep, redness * 0.45);
    // violet light from a knot nearby washes the matter around it
    matC = mix(matC, VIOLET * 0.30 * mott * deep, min(cl * 0.3, 0.4) * vio);
    col = mix(col, matC, matter * 0.94 * uWoundDebris * open);
    vec3 rimC = mix(LAVGREY * 0.26 * gate, vec3(0.26, 0.05, 0.025), redness) * deep;
    // the rock is charcoal with a faint grain and sheen, never a flat cut-out
    vec3 inkC = ink * (0.75 + 0.7 * ero) + LAVGREY * 0.012 * gate * deep * smoothstep(0.4, 0.7, ero);
    col = mix(col, inkC + rimC * inkRim, inkA * uWoundDebris * open);
  }

  // --- 4. the violet: a few hot knots glowing inside the crust, and thin branching veins clustered around them and
  //        along the lower-right inner edge, only where there is crust (never in empty smoke). They flare with the
  //        activity and go still once the boundary is closed.
  if (!lite && rho > 0.75 && x < outR + 0.35 && vio > 0.01) {
    #if SKY_DETAIL >= 1
    vec2 pv = pc * 4.2 + wb * 1.2;
    float v1 = vnoise(vec3(pv, 31.0 + t * 0.01));
    float v2 = vnoise(vec3(pv * 2.7 + 7.0, 37.0 - t * 0.012));
    float w1 = max(fwidth(v1) * 0.7, 0.004);
    float w2 = max(fwidth(v2) * 0.6, 0.004);
    // filaments along the noise's mid contours, each cut short by the other: a branching network, not a lattice
    float vein = (1.0 - smoothstep(0.0, w1, abs(v1 - 0.5))) * smoothstep(0.42, 0.62, v2)
               + 0.7 * (1.0 - smoothstep(0.0, w2, abs(v2 - 0.5))) * smoothstep(0.5, 0.66, v1);
    float edgeLR = smoothstep(0.2, 0.9, dot(dir, vec2(0.6, -0.8))) * exp(-abs(x + 0.04) / 0.08);
    float vmask = matter * (1.0 - inkA) * smoothstep(0.86, 1.0, rho);
    glow += vein * vmask * (0.7 * cl + 0.45 * edgeLR);
    #endif
  }
  col += VIOLET * glow * vio * uWoundDebris;

  // --- 5. flying debris (front-most): a dense river of splattered rocks leaving the lower left and arcing under the
  //        red remnant to the far left; big chunks thrown toward the remnant's upper-right limb; a thin trail toward
  //        the white remnant; loose chunks breaking off the crust. Each is rimmed by the light it is nearest.
  float occ = 0.0, rim = 0.0;
  float flow = t * 0.010;
  float redness = uRedVis * smoothstep(0.4, 0.75, rn / max(rn + length(redP - p), 1e-3));
  vec2 Lc = normalize(mix(-dir, normalize(redP - p + 1e-4), redness));
  vec2 su, sv;
  float sgn = toRed.x < 0.0 ? 1.0 : -1.0;
  float dust = 0.0;
  if (uRedVis > 0.01) {
    // the river: from the lower left of the boundary, arcing down across the red nebula to the far left
    vec2 A = rot2(toRed, 0.62 * sgn);
    vec2 B = redP * 1.12 + rot2(toRed, 1.5708 * sgn) * (0.55 * redDist);
    vec3 ac = arcCoords(p, A, B, -0.1, su, sv);
    float L = length(B - A);
    vec4 prof = vec4(0.12, 0.38, uRedVis, 1.0);
    if (arcProfile(ac.x, ac.y, vec4(prof.xy * 1.6, 1.0, 1.0)) > 0.01)
      arcRocks(ac, L, su, sv, prof, flow, 5.0, pxn, Lc, !lite, occ, rim);
    // the dust and smoke it drags (much wider than its rocks)
    float tc = clamp(ac.x, 0.0, 1.0);
    float wh = 0.3 + 0.45 * tc;
    dust = exp(-ac.y * ac.y / (wh * wh)) * smoothstep(-0.05, 0.04, ac.x) * (1.0 - smoothstep(0.8, 1.1, ac.x)) * uRedVis * (1.0 - 0.5 * tc);
    // big chunks thrown off the upper left toward the remnant's upper-right limb
    vec2 A2 = rot2(toRed, -0.3 * sgn) * 1.2;
    vec2 B2 = redP + rot2(-toRed, 0.75 * sgn) * (uRedR / R) * 1.2;
    vec3 ac2 = arcCoords(p, A2, B2, -0.1, su, sv);
    vec4 prof2 = vec4(0.2, 0.2, 0.6 * uRedVis, 1.0);
    if (arcProfile(ac2.x, ac2.y, vec4(0.32, 0.32, 1.0, 1.0)) > 0.01)
      arcRocks(ac2, length(B2 - A2), su, sv, prof2, flow * 0.7, 11.0, pxn, Lc, false, occ, rim);
  }
  if (uWhiteVis > 0.01) {
    // a thin trail toward the white remnant
    float cW = dot(uWhiteDir, W);
    vec3 tw = uWhiteDir - W * cW;
    vec2 toW = vec2(dot(tw, Xc), dot(tw, Yc));
    toW = length(toW) > 1e-5 ? normalize(toW) : vec2(1.0, 0.0);
    float wd = acos(clamp(cW, -1.0, 1.0)) / R;
    vec2 A3 = rot2(toW, -0.2 * sgn) * 1.3;
    vec2 B3 = toW * min(wd * 0.82, reach - 0.1);
    vec3 ac3 = arcCoords(p, A3, B3, 0.05, su, sv);
    vec4 prof3 = vec4(0.06, 0.16, 0.45 * uWhiteVis, 0.35);
    if (arcProfile(ac3.x, ac3.y, vec4(0.1, 0.26, 1.0, 1.0)) > 0.01)
      arcRocks(ac3, length(B3 - A3), su, sv, prof3, flow, 17.0, pxn, Lc, !lite, occ, rim);
  }
  // loose chunks breaking off the crust's outer edge
  if (x > 0.05 && x < 1.1) {
    float fl = 0.42 * smoothstep(outR * 0.4, outR * 0.9, x) * exp(-max(x - outR, 0.0) / 0.35) * (0.3 + 0.7 * max(ulw, rgt)) * open;
    vec2 cq = rot2(pc, 0.3);
    vec2 r = splatRock(cq / 0.2, fl * 0.6, 0.3, 23.0, pxn / 0.2, rot2(Lc, spin + 0.3));
    rim = rim * (1.0 - r.x) + r.y; occ += r.x * (1.0 - occ);
    #if SKY_DETAIL >= 1
    if (!lite) {
      r = splatRock(cq / 0.075 + vec2(0.41, 0.77), fl, 0.3, 29.0, pxn / 0.075, rot2(Lc, spin + 0.3));
      rim = rim * (1.0 - r.x) + r.y; occ += r.x * (1.0 - occ);
    }
    #endif
  }
  if (dust > 0.01) {
    float dn = vnoise(vec3(pc * 5.0 + vec2(flow, 0.0), 4.0)) * 0.6 + vnoise(vec3(pc * 13.0, 9.0)) * 0.4;
    float dA = dust * smoothstep(0.3, 0.75, dn) * 0.55 * uWoundHalo;
    vec3 dC = mix(SMOKE * 0.05, RED_SMOKE * 0.10, redness) * uSwirl;
    col = mix(col, dC, dA);
  }
  occ *= uWoundDebris;
  vec3 rimCol = mix(LAVGREY * 0.22 * gate, vec3(0.75, 0.10, 0.04), redness);
  col = mix(col, ink, occ) + rimCol * rim * uWoundDebris;

  // --- closed: the boundary has settled to its slow shape and a calm, thin gold seam seals it; the crust stays
  if (uClosed > 0.001) {
    float gw = max(0.006, pxn * 0.9);
    float gx = (rn - rb) / gw;
    float even = 0.6 + 0.4 * vnoise(vec3(dir * 2.2, 4.0 + t * 0.02));
    vec3 gold = vec3(1.0, 0.64, 0.24);
    col += gold * (exp(-gx * gx) * 1.3 * min(1.0, 0.012 / gw) + exp(-abs(x) / 0.05) * 0.03) * even * uClosed;
  }

  gWoundVoid = voidA * uWoundVis;
  return mix(base, col, uWoundVis);
}

// ---------------------------------------------------------------------------------------------------------
// Interiors: the upper space of the megastructure itself — far ribs and tiers converging overhead, dissolving
// into bright haze, with a few warm light seams. Replaces open space above an enclosed preset's horizon.
// Returns rgb, a = how much of the open sky it replaces.
// ---------------------------------------------------------------------------------------------------------
vec4 enclosure(vec3 d) {
  float up = clamp(d.y, -1.0, 1.0);
  float a = uEnclose * smoothstep(-0.05, 0.42, up);
  if (a <= 0.0) return vec4(0.0);
  float az = atan(d.x, -d.z) / 6.2832 + 0.5;
  float el = asin(up) / 1.5708;
  // depth cue: the zenith is nearest (structure darkest and sharpest), the horizon furthest (lost in haze)
  float near = smoothstep(0.05, 0.85, up);
  float fogN = vnoise(d * 3.1 + 7.0) * 0.6 + vnoise(d * 7.3 + 2.0) * 0.4;
  vec3 haze = uEncCol * (0.80 + 0.30 * (1.0 - near) + 0.16 * (fogN - 0.5));
  // ribs: great arches running across the zenith (bands of azimuth), and tiers of transverse members
  float fa = az * 14.0;
  float fwa = clamp(fwidth(fa), 1e-4, 0.2);
  float rib = 1.0 - smoothstep(0.10 - fwa, 0.10 + fwa, abs(fract(fa) - 0.5));
  float fa2 = az * 42.0 + 0.5;
  float fwa2 = clamp(fwidth(fa2), 1e-4, 0.2);
  float rib2 = (1.0 - smoothstep(0.06 - fwa2, 0.06 + fwa2, abs(fract(fa2) - 0.5))) * 0.55;
  float fe = el * 9.0;
  float fwe = max(fwidth(fe), 1e-4);
  float tier = 1.0 - smoothstep(0.07 - fwe, 0.07 + fwe, abs(fract(fe) - 0.5));
  float structure = max(rib, max(rib2, tier * 0.8)) * smoothstep(0.12, 0.6, up);
  // structure is a silhouette darker than the haze in front of it; the further, the more it dissolves
  vec3 dark = uEncCol * mix(0.62, 0.30, near);
  vec3 c = mix(haze, dark, structure * mix(0.35, 0.85, near));
  // warm seams along a few ribs (light as information)
  float seamPick = step(0.72, hash11(floor(fa) + 3.0));
  float seam = (1.0 - smoothstep(0.012 - fwa, 0.012 + fwa, abs(fract(fa) - 0.5))) * seamPick * smoothstep(0.2, 0.7, up);
  c += vec3(1.0, 0.82, 0.58) * seam * 0.9 * dot(uEncCol, vec3(0.33));
  return vec4(c, a);
}

void main() {
  vec3 d = normalize(vDir);
  float px = max(length(dFdx(d)), length(dFdy(d)));
  // the Wound breathes with its activity: it contracts when the pressure is drawn back (uWoundScale, CPU-side)
  float R = uWoundR * uWoundScale;

  // --- lensing around the Wound: background directions are pulled toward the disc (tangential arcs at the rim)
  float cw = dot(d, uWoundDir);
  float th = acos(clamp(cw, -1.0, 1.0));
  vec3 er = d - uWoundDir * cw;
  vec3 e = er / max(length(er), 1e-5);
  float rn = th / R;
  float defl = uWoundLens * uWoundVis * R / max(rn, 0.4) * (1.0 - smoothstep(1.4, 5.0, rn));
  float beta = th - defl;
  vec3 dl = uWoundDir * cos(beta) + e * sin(beta);
  float pxl = max(max(length(dFdx(dl)), length(dFdy(dl))), px);
  gWoundVoid = 0.0;

  // --- deep space
  float up = clamp(d.y, 0.0, 1.0);
  vec3 col = mix(uHorizon, uZenith, pow(up, 0.55));
  // nothing behind the Wound's disc or under an opaque ground needs shading
  bool buried = uGround > 0.999 && d.y < -0.04;
  bool hidden = buried || (uWoundVis > 0.999 && rn < WOUND_SOLID);
  vec4 red = vec4(0.0);
  if (!hidden) {
    if (uNebula > 0.01) col += nebula(dl) * uNebula * uNebTint;
    red = uRedVis > 0.002 ? redRemnant(dl, pxl) * uRedVis : vec4(0.0);
    if (uStars > 0.01) col += starField(dl, pxl) * uStars * (1.0 - red.a);
  }
  // the palette is held back (charcoal, grey-violet): only the red remnant keeps its colour
  col = mix(vec3(dot(col, vec3(0.30, 0.55, 0.15))), col, uSat);
  col += red.rgb * uRedGain;
  if (uWoundVis > 0.002 && !buried) col = woundComposite(col, d, rn, e, px, R);

  // --- interiors: the megastructure's own upper space instead of open sky
  if (uEnclose > 0.002) {
    vec4 enc = enclosure(d);
    col = mix(col, enc.rgb, enc.a);
  }

  col *= uTint;

  // --- horizon haze, then whatever lies below the horizon
  vec3 hz = skyHaze(d);
  float band = exp(-max(d.y, 0.0) * uHazeFall) * uHazeAmt;
  // the atmosphere barely veils the Wound's void (it is an absence, not an object behind the haze); it follows the
  // void's own soft edge, so the haze never draws a circle across it
  float absence = gWoundVoid * smoothstep(0.0, 0.09, d.y);
  col = mix(col, hz, band * (1.0 - 0.85 * absence));
  float below = smoothstep(0.0, -0.035, d.y) * uGround;
  col = mix(col, hz * mix(1.0, 0.35, smoothstep(0.0, -0.6, d.y)), below);

  // (its glare never reaches into the Wound's void)
  if (uWhiteVis > 0.002) col += whiteRemnant(d, px) * uWhiteVis * (1.0 - 0.6 * band) * (1.0 - below) * (1.0 - gWoundVoid);

  // --- a shut view boundary (Z10): a dark membrane between the chamber and space — everything beyond is dimmed
  //     and greyed, the Wound reads only as a deeper absence behind it; faint folds catch the chamber's light
  if (uVeil > 0.002) {
    float fold = vnoise(d * 5.0 + vec3(0.0, uTime * 0.004, 0.0)) * 0.65 + vnoise(d * 13.0 + 4.0) * 0.35;
    vec3 g = vec3(dot(col, vec3(0.30, 0.55, 0.15)));
    col = mix(col, g, 0.5 * uVeil) * (1.0 - 0.55 * uVeil);
    col += vec3(0.010, 0.010, 0.013) * smoothstep(0.45, 0.85, fold) * uVeil;
  }

  col = skyDither(col * uGain, gl_FragCoord.xy);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
