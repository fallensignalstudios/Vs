/**
 * Sky dome shader: deep-space gradient, stable star field, nebula, the red remnant, the white remnant and
 * the Wound (a soft vortex: an almost black void inside a ragged, streaked crust of smoky rock with a few hot violet
 * knots, wrapped in lit smoke, with a river of debris torn off toward the red remnant; the background is lensed
 * around it).
 *
 * The vertex stage ignores camera translation, so the dome sits at infinity for ANY camera (main view, planar
 * reflection camera, PMREM cube faces) without having to follow anything on the CPU. It is pinned to the far
 * plane and drawn after the opaque scene with a depth test and no depth write, so interiors that hide the sky
 * pay nothing for it.
 *
 * COST. The fragment program is compiled per quality tier (`#define SKY_DETAIL` 0 low · 1 medium · 2 high/ultra,
 * from QualityProfile), so the cheaper tiers do not merely branch around the expensive code — it is not in the
 * program at all (software rasterisers and some mobile compilers flatten uniform branches). Worst-case
 * value-noise evaluations per pixel, in the Wound's upper-left crust (its worst place: smoke, swirl, crust, violet
 * cluster; the red nebula never reaches it): low ≈ 24, medium ≈ 44, high ≈ 54, plus a few hashed rock cells (2 noises
 * each). Inside the void, where the background is skipped, it costs ≈ 6; in the throat ≈ 4; out in the smoke (to
 * ≈ 2.8 radii) ≈ 16; along the debris lanes only their rock cells. Each body is skipped outside its own cone: red
 * nebula 4.6 radii; Wound 3 radii, reaching out along its debris lanes (≤ 6) only while the red remnant is up. No
 * extra pass, no texture. `uLite` (set per pass for small secondary targets: reflections, PMREM faces) drops the
 * fine streaks, grit, veins, glints, filaments and fine rocks.
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
   * ± brightness of the faint spiral grain near the rim (the walls of the tunnel seen end-on; the shader keeps it
   * clearest on the lower right). It fades to nothing inside `ringsFrom` radii, so the middle of the void is calm black.
   */
  rings: 0.55,
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
  /**
   * the throat: below the opening a dark curtain falls from its lower arc to the horizon, as wide as the opening at
   * its widest (× edgeR · edgeA) where it leaves it, narrowing to `throatBottom` of that at the horizon
   */
  throatTop: 0.95,
  throatBottom: 0.8,
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

/**
 * Half-width (Wound radii) of the throat — the dark curtain falling from the opening's lower arc to the horizon —
 * at `depth` 0 (level with the opening's centre) … 1 (the horizon), before its edges' ±10 % wander.
 */
export function woundThroatHalfWidth(depth: number): number {
  const L = WOUND_LOOK;
  const k = Math.min(Math.max(depth, 0), 1);
  return L.edgeR * L.edgeA * (L.throatTop + (L.throatBottom - L.throatTop) * k);
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
  `const float THROAT_TOP = ${glf(WOUND_LOOK.throatTop)};`,
  `const float THROAT_BOTTOM = ${glf(WOUND_LOOK.throatBottom)};`,
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
uniform float uWoundThroat;
uniform vec3 uCoreTint;
uniform vec3 uMatterTint;
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
//   CORE    an almost uniform, neutral near-black void, darkest at the centre, with a faint spiral grain near the rim
//           (strongest on the lower right): the tunnel's walls seen end-on. Nothing inside 0.6 radii;
//   EDGE    an irregular ellipse (its outline wanders ±0.15 radii at low frequency). The crust's lining darkens INTO
//           the opening (no lit lip, no concentric grooves), and matter dragged in over it breaks the outline;
//   THROAT  the funnel does not end under the opening: a dark curtain of falling ash, streaked vertically and drifting
//           slowly down, pours from its lower arc to the horizon behind the city, so the Wound sinks into the city
//           instead of floating above it (it is matter, not void: the city may stand in front of it);
//   CRUST   ragged matter: black ink-blot masses and specks fused with lit, marbled grey matter. One mass at the
//           opening, it breaks into splatter outward and reaches ≈ 2.4 radii on the upper left and the right flank,
//           where it hangs in vertical curtains; short below and on the upper right;
//   VIOLET  light ON matter, never lamps: an irregular cluster on the upper left (a fainter one on the right flank)
//           where the chunks' faces turn lavender-violet with glints and a few veins, and a forked crackle filament
//           along the lower-right lip. They flare with the activity and go still once the boundary is closed;
//   SMOKE   a broad, cool grey smoke field, asymmetric: dark and quiet on the upper right, a lit plume toward the lower
//           left and the red remnant (whose crimson bleeds into it), vertical curtains on the right flank;
//   DEBRIS  a lane of medium and large rocks from the Wound's upper left to the red remnant's right limb, then a band
//           dropping left under the remnant; a thin trail toward the white remnant; loose chunks off the crust. Every
//           rock is shaded (a face lit crimson toward the remnant, grey-lavender toward the Wound, a dark face between)
//           and drags a short soft smear.
// Everything is drawn in a chart around the Wound (azimuthal-equidistant, x right / y up as seen, in Wound radii)
// and sampled through continuous directions, never an angle, so nothing has a seam; the crust, its light and its
// debris turn rigidly at slow rates, so nothing winds up over time.
// ---------------------------------------------------------------------------------------------------------
${WOUND_GLSL_CONSTANTS}
const vec2 UL = vec2(-0.6963, 0.7177);
// the hot light (crackle filaments, glints)
const vec3 VIOLET = vec3(0.62, 0.30, 0.95);
// that light falling on matter: the lit faces inside a violet cluster
const vec3 LAVVIO = vec3(0.72, 0.48, 1.0);
// the Wound's own dim light on its crust: a cool grey-lavender
const vec3 LAVGREY = vec3(1.0, 0.92, 1.1);
// its unlit matter: a neutral, cool charcoal
const vec3 CHAR = vec3(1.04, 0.98, 1.0);
// cool silver-grey smoke (each preset white-balances matter against its grade with matterTint)
const vec3 SMOKE = vec3(0.95, 0.97, 0.98);
const vec3 RED_SMOKE = vec3(1.0, 0.30, 0.42);
// the red remnant's light on the side of a rock that faces it
const vec3 CRIMSON = vec3(1.0, 0.14, 0.07);
// opacity of the void at this pixel (the white remnant's glare reads it), and of the void or its throat (the horizon
// haze reads it): woundComposite writes both
float gWoundVoid;
float gWoundDark;

#if SKY_DETAIL >= 2
  #define FBM_CRUST(p) fbm4(p)
#else
  #define FBM_CRUST(p) fbm3(p)
#endif

vec2 rot2(vec2 v, float a) { float c = cos(a), s = sin(a); return vec2(c * v.x - s * v.y, s * v.x + c * v.y); }

// The opening's radius factor toward chart direction dir (mirrored by woundEllipse()).
float woundEll(vec2 dir) { return inversesqrt(dir.x * dir.x / (EDGE_A * EDGE_A) + dir.y * dir.y / (EDGE_B * EDGE_B)); }
// Void colour rn boundary radii from the centre; streak 0..1 = the spiral grain there (mirrored by woundCoreColor()).
vec3 woundCore(float rn, float streak) {
  float k = pow(smoothstep(0.0, 1.0, rn), CORE_LIFT);
  return mix(CORE_DEEP, CORE_RIM, k) * (1.0 + CORE_RINGS * smoothstep(CORE_RINGS_FROM, 0.97, rn) * (2.0 * streak - 1.0));
}
// Opacity of the void; wob 0..1 = the boundary's wander at this angle, ell = woundEll (mirrored by woundVoidOpacity()).
float woundVoid(float rn, float wob, float ell) {
  float rb = EDGE_R * ell + EDGE_WOBBLE * (wob - 0.5);
  return 1.0 - smoothstep(rb - EDGE_IN, rb + EDGE_OUT, rn);
}
// Half-width of the throat at depth 0 (the opening's widest) .. 1 (the horizon), Wound radii (mirrored by woundThroatHalfWidth()).
float throatHalf(float depth) { return EDGE_R * EDGE_A * mix(THROAT_TOP, THROAT_BOTTOM, depth); }

// One splattered rock per lattice cell, or none: a lumpy, bitten silhouette (ink splatter, never a polygon or a round
// dot) with a short soft smear behind it, both always wholly inside the cell. q = cell coordinates; fill = the chance
// that a cell holds one (it also grades the size: many small, few large); big = the largest size (cell units, ≤ 0.2);
// aa = one pixel in cell units; drift = the way it moves (cell space, unit; its smear trails the other way).
// Returns (coverage, n.x, n.y, smear): n = where in the rock this pixel is (≈ −1..1 from its centre, cell space),
// which shades it as a lump.
vec4 splatRock(vec2 q, float fill, float big, float seed, float aa, vec2 drift) {
  vec2 c = floor(q);
  vec3 h = hash33(vec3(c, seed));
  if (h.z >= fill) return vec4(0.0);
  float u = 1.0 - h.z / fill;
  float size = big * (0.4 + 0.6 * u);
  // (room for the rock, ≤ 1.5 sizes, and its smear, ≤ 2.3 sizes behind it)
  vec2 r = q - c - 0.5 - (h.xy - 0.5) * max(1.0 - 4.7 * size, 0.0);
  vec2 rr = rot2(r, h.x * 6.2832);
  rr.y *= 1.0 + 0.7 * h.y; // some are long shards
  float k = fract(h.x * 91.7);
  float poly = max(max(max(dot(rr, vec2(1.0, 0.0)) / (0.7 + 0.3 * k), dot(rr, vec2(0.309, 0.951)) / (0.7 + 0.3 * fract(k * 7.3))),
                       max(dot(rr, vec2(-0.809, 0.588)) / (0.7 + 0.3 * fract(k * 13.1)), dot(rr, vec2(-0.809, -0.588)) / (0.7 + 0.3 * fract(k * 23.9)))),
                   dot(rr, vec2(0.309, -0.951)) / (0.7 + 0.3 * fract(k * 31.7)));
  float dd = mix(length(rr), poly * 1.12, 0.55);
  vec2 nd = rr / max(length(rr), 1e-5);
  // bulges and bites at two angular scales
  float lump = 0.62 * vnoise(vec3(nd * 1.1 + h.yz * 17.0, h.x * 11.0)) + 0.38 * vnoise(vec3(nd * 2.7 + h.zx * 23.0, 5.0 + h.y * 7.0));
  float rad = size * (0.35 + 1.15 * lump);
  float m = 1.0 - smoothstep(rad - aa, rad + aa, dd);
  // the smear: a soft streak of dust trailing it, twice its length, fading away from it
  float behind = -dot(r, drift);
  float across = dot(r, vec2(-drift.y, drift.x));
  float sm = exp(-across * across / (size * size * 0.45)) * smoothstep(-0.4 * size, 0.5 * size, behind) * (1.0 - smoothstep(0.6 * size, 2.3 * size, behind));
  return vec4(m, r / max(rad, 1e-4), sm * (1.0 - m));
}

// A rock's colour: dark, with a face lit crimson toward the red remnant (Lr) and one lit grey-lavender toward the Wound
// (Lw), the dark face between (n = splatRock's, lights in the same space). warm/cool = how much of each light reaches it.
vec3 rockShade(vec2 n, vec2 Lw, vec2 Lr, float warm, float cool, vec3 ink) {
  float nz = sqrt(max(1.0 - dot(n, n), 0.0));
  vec3 N = normalize(vec3(n * 0.9, nz + 0.2));
  float lw = max(dot(N, normalize(vec3(Lw, 0.35))), 0.0);
  float lr = max(dot(N, normalize(vec3(Lr, 0.35))), 0.0);
  return ink * (0.8 + 0.4 * nz) + LAVGREY * (0.10 * cool * lw * lw * lw) + CRIMSON * (0.20 * warm * lr * lr * lr);
}

// Coordinates along a debris lane from A to B (chart), bowed off its chord by bow × its length toward sv (the chord's
// left-hand normal). Returns (t: 0 at A .. 1 at B, unclamped; signed offset from the lane (R); distance along it (R)).
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

// How crowded a debris lane is at (t along it, offset off it): a lane with defined edges whose width wanders slowly.
// prof = (half-width at A, at B, crowding, size grade).
float arcProfile(float tt, float off, vec4 prof, float seed) {
  float w = mix(prof.x, prof.y, clamp(tt, 0.0, 1.0)) * (0.85 + 0.15 * sin(tt * 9.0 + seed) + 0.1 * sin(tt * 23.0 + seed * 2.0));
  return (1.0 - smoothstep(0.6 * w, w, abs(off))) * smoothstep(-0.04, 0.05, tt) * (1.0 - smoothstep(0.75, 1.05, tt)) * prof.z;
}
// One layer of a lane's rocks in cells of size cs (R), each cell deciding from its own centre whether it holds one;
// composited (smear, then rock) over col.
void arcLayer(vec2 sq, float cs, vec2 o, float L, float flow, vec4 prof, float fill, float bigW, float big, float seed,
              float pxn, vec2 Lw, vec2 Lr, float warm, float cool, vec3 ink, inout vec3 col, inout float occ) {
  vec2 q = sq / cs + o;
  vec2 cc = (floor(q) + 0.5 - o) * cs;
  float tt = (cc.x - flow) / L;
  float dn = arcProfile(tt, cc.y, prof, seed);
  float g = prof.w * (1.0 - 0.35 * clamp(tt, 0.0, 1.0));
  vec4 r = splatRock(q, dn * fill * mix(1.0, g, bigW), big, seed, pxn / cs, vec2(-1.0, 0.0));
  if (r.x + r.w <= 0.0) return;
  col = mix(col, ink * 2.2 + (CRIMSON * 0.03 * warm + LAVGREY * 0.012 * cool), r.w * 0.4);
  col = mix(col, rockShade(r.yz, Lw, Lr, warm, cool, ink), r.x);
  occ += r.x * (1.0 - occ);
}
// The rocks of one lane, drifting along it toward A: medium and large chunks (up to ≈ 0.14 R, only where the lane is
// graded large) on two lattices, small ones, and (fine) a sparse grit. Lw, Lr = light directions (chart).
void arcRocks(vec3 ac, float L, vec2 su, vec2 sv, vec4 prof, float flow, float seed, float pxn, vec2 Lw, vec2 Lr,
              float warm, float cool, vec3 ink, bool fine, inout vec3 col, inout float occ) {
  vec2 sq = vec2(ac.z + flow, ac.y);
  vec2 Ws = vec2(dot(Lw, su), dot(Lw, sv)), Rs = vec2(dot(Lr, su), dot(Lr, sv));
  arcLayer(sq, 0.46, vec2(0.0, 0.5), L, flow, prof, 1.0, 1.0, 0.2, seed, pxn, Ws, Rs, warm, cool, ink, col, occ);
  arcLayer(sq, 0.46, vec2(0.5, 0.27), L, flow, prof, 0.9, 1.0, 0.2, seed + 1.0, pxn, Ws, Rs, warm, cool, ink, col, occ);
  arcLayer(sq, 0.23, vec2(0.37, 0.5), L, flow, prof, 0.85, 0.4, 0.2, seed + 3.0, pxn, Ws, Rs, warm, cool, ink, col, occ);
  #if SKY_DETAIL >= 1
  if (fine) arcLayer(sq, 0.1, vec2(0.71, 0.13), L, flow, prof, 0.35, 0.0, 0.18, seed + 7.0, pxn, Ws, Rs, warm, cool, ink, col, occ);
  #endif
}

// A forked crackle filament: a jagged thread of hot light from a to b (chart), its jag zero at both ends. Returns its
// light (core + a soft halo); w = core half-width (R).
float crackle(vec2 p, vec2 a, vec2 b, float seed, float w, float t) {
  vec2 ab = b - a;
  float L = max(length(ab), 1e-4);
  vec2 u = ab / L;
  vec2 rp = p - a;
  float s = dot(rp, u) / L;
  if (s < -0.15 || s > 1.15) return 0.0;
  float sc = clamp(s, 0.0, 1.0);
  float j = ((vnoise(vec3(sc * 7.0, seed, t * 0.07)) - 0.5) * 0.14 + (vnoise(vec3(sc * 29.0, seed + 3.7, t * 0.11)) - 0.5) * 0.07) * L;
  float off = dot(rp, vec2(-u.y, u.x)) - j * sin(3.1416 * sc);
  float dd = length(vec2(off, (s - sc) * L));
  float taper = 0.35 + 0.65 * sin(3.1416 * sc);
  return (exp(-dd * dd / (w * w)) * 1.4 + exp(-dd / (w * 6.0)) * 0.22) * taper;
}

vec3 woundComposite(vec3 col, vec3 d, float rn, vec3 e, float px, float R) {
  vec3 W = uWoundDir;
  // the debris lanes reach past the red remnant, so the Wound's cone grows with that distance (when there is one)
  float cRed = dot(uRedDir, W);
  float redDist = acos(clamp(cRed, -1.0, 1.0)) / R;
  float reach = uRedVis > 0.01 ? clamp(redDist * 1.55, 3.0, 6.0) : 3.0;
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
  float sgn = toRed.x < 0.0 ? 1.0 : -1.0;
  vec2 redP = toRed * redDist;
  float rr = uRedR / R;
  float sr = max(dot(dir, toRed), 0.0) * uRedVis;
  // where the Wound's own light falls on its matter: brightest upper left, some on the right flank, little on the
  // upper right; the smoke's lit plume leans toward the lower left and the red remnant
  float ulw = smoothstep(-0.35, 0.85, dot(dir, UL));
  float rgt = smoothstep(-0.1, 0.75, dir.x) * (1.0 - 0.6 * smoothstep(0.3, 0.9, dir.y));
  float ur = smoothstep(0.2, 0.9, dot(dir, vec2(0.5, 0.866)));
  float down = max(-dir.y, 0.0);
  float plume = smoothstep(0.15, 0.9, dot(dir, normalize(vec2(toRed.x, 0.25 * toRed.y - 0.8))));
  float gate = 0.3 + 0.7 * ulw + 0.25 * rgt;
  // matter's white balance against the zone's grade
  vec3 mt = uMatterTint;

  // --- the boundary: an irregular ellipse whose outline wanders slowly by ±0.15 R (it keeps its wander once closed,
  //     only calmer)
  float ell = woundEll(dir);
  float n1 = vnoise(FBM_ROT * vec3(dir * 0.85, 1.7 + t * 0.006));
  float n2 = vnoise(FBM_ROT * vec3(dir * 1.9, 9.1 - t * 0.008 * settle));
  float wob = clamp((0.8 * n1 + 0.2 * n2 - 0.5) * 2.4 + 0.5, 0.0, 1.0);
  float rb = EDGE_R * ell + EDGE_WOBBLE * (wob - 0.5);
  float rho = rn / rb;
  float lr = log(max(rho, 0.05));
  float x = rn - rb; // signed distance past the boundary (R)

  // --- the throat: from the opening's lower arc down to (and past) the horizon. xT = signed distance past its sides;
  //     xU = past the union of opening and throat, which the crust and the smoke wrap
  float depth = 0.0, xT = 1e3, xU = x;
  if (uWoundThroat > 0.001) {
    float wEl = max(asin(clamp(W.y, -1.0, 1.0)) / R, 0.6);
    depth = clamp(-p.y / wEl, 0.0, 1.0);
    // (its two sides wander independently; they only meet far inside it, where the switch cannot show)
    float edgeN = vnoise(vec3(p.y * 2.2, dir.x > 0.0 ? 5.0 : 11.0, 3.0 + t * 0.004));
    xT = abs(p.x) - throatHalf(depth) * (0.9 + 0.2 * edgeN);
    xU = min(x, xT + max(p.y, 0.0) * 3.0 + 3.0 * (1.0 - uWoundThroat));
  }

  // the crust, its light and its debris turn slowly with the vortex (rigidly, so nothing winds up)
  float spin = -t * 0.0035;
  vec2 pc = rot2(p, spin);

  // the spiral grain inside the opening, near its rim (≈ 10° pitch), clearest on the lower right
  float fsk = 0.5;
  if (rho > 0.55 && rho < 1.05) {
    vec2 fd = rot2(dir, 5.5 * lr + spin * 1.5);
    float f1 = vnoise(vec3(fd * 4.5, rho * 3.0 + 1.0));
    #if SKY_DETAIL >= 1
    float f2 = lite ? f1 : vnoise(vec3(fd * 11.0 + 3.0, rho * 7.0 + 5.0));
    #else
    float f2 = f1;
    #endif
    float lrw = smoothstep(-0.2, 0.8, dot(dir, vec2(0.6, -0.8)));
    fsk = mix(0.5, smoothstep(0.15, 0.85, 0.6 * f1 + 0.4 * f2), 0.45 + 0.55 * lrw);
  }

  // the vortex: smoke and matter streaked along a looser spiral (≈ 20° pitch) from a quarter radius past the edge
  // outward (never at the lip itself), in patches
  float swl = 0.5, swW = 0.0;
  if (x > 0.12 && x < 1.9) {
    vec2 fs = rot2(dir, 2.7 * lr + spin * 1.5);
    float w1 = vnoise(vec3(fs * 5.0, rho * 2.2 + 61.0));
    #if SKY_DETAIL >= 1
    float w2 = lite ? w1 : vnoise(vec3(fs * 13.0 + 2.0, rho * 5.0 + 67.0));
    #else
    float w2 = w1;
    #endif
    swl = smoothstep(0.2, 0.8, 0.6 * w1 + 0.4 * w2);
    swW = smoothstep(0.15, 0.35, x) * (1.0 - smoothstep(0.9, 1.8, x)) * smoothstep(0.25, 0.65, vnoise(vec3(fs * 2.0, rho + 71.0)));
  }

  // --- 1. smoke: a broad, cool grey field, marbled, asymmetric (dark on the upper right, a lit plume toward the
  //        lower left and the red remnant, whose crimson bleeds into it; vertical curtains on the right flank). It is
  //        matter, not glow: it hides the sky behind it.
  float hReach = 1.3 + 0.45 * ulw + 0.6 * plume + 0.4 * sr + 0.25 * rgt - 0.3 * ur;
  float wv0 = 0.0, smDark = 0.0;
  if (xU > -0.2 && xU < hReach + 0.5) {
    vec2 ps = rot2(pc, 0.22 * log(max(rn, 0.3)));
    #if SKY_DETAIL >= 1
    vec3 q = vec3(ps * 1.9, t * 0.004);
    vec2 wv = vec2(vnoise(q + 3.0), vnoise(q + 19.0)) - 0.5;
    float s = FBM_BIG(vec3(ps * 3.3 + wv * 2.6, t * 0.005 + 7.0));
    float fine = lite ? s : FBM_SMALL(vec3(ps * 10.0 + wv * 5.0, 2.0 + t * 0.007));
    float cur = vnoise(vec3(p.x * 6.5 + 1.6 * wv.x, p.y * 0.75 + t * 0.008, 23.0));
    float cur2 = lite ? cur : vnoise(vec3(p.x * 17.0 + 2.5 * wv.y, p.y * 1.5 + t * 0.012, 29.0));
    #else
    vec2 wv = vec2(0.0);
    float s = fbm3(vec3(ps * 3.3, 7.0));
    float fine = s;
    float cur = vnoise(vec3(p.x * 6.5, p.y * 0.75, 23.0));
    float cur2 = cur;
    #endif
    wv0 = wv.x;
    // thin pale folds where the turbulence shears: the marbling
    float marble = pow(1.0 - abs(2.0 * fine - 1.0), 6.0);
    // on the right flank and down the throat's sides it falls in vertical curtains
    float vert = max(rgt * (1.0 - 0.6 * ur), smoothstep(0.25, 0.8, down));
    float curt = smoothstep(0.25, 0.8, 0.6 * cur + 0.4 * cur2);
    float sv = smoothstep(0.3, 0.8, s);
    float sm = mix(sv, 0.3 * sv + 0.7 * curt, vert * 0.75);
    sm = mix(sm, 0.3 * sm + 0.7 * swl, swW * (1.0 - 0.8 * vert) * 0.8);
    float prof = smoothstep(-0.16, 0.06, xU) * pow(1.0 - smoothstep(0.0, hReach + 0.5, xU), 1.3);
    float smA = min(prof * (1.0 + 0.6 * plume), 1.0) * (0.6 + 0.4 * smoothstep(0.25, 0.7, s)) * uWoundHalo;
    float light = 0.5 + 0.55 * plume + 0.1 * sr + 0.8 * rgt * (1.0 - ur) - 0.5 * ur;
    // beside the throat, low down, the smoke is in the funnel's shadow
    light *= 1.0 - 0.55 * smoothstep(0.55, 0.0, xU) * smoothstep(0.1, 0.6, down) * (1.0 - 0.6 * plume);
    float v = (0.056 + 0.155 * sm + 0.09 * marble * smoothstep(0.4, 0.7, s) * (1.0 - 0.5 * vert)) * max(light, 0.15);
    #if SKY_DETAIL >= 2
    // fine mottling (the painting's smoke has grain at a few pixels, not only billows)
    if (!lite) v *= 0.8 + 0.4 * vnoise(vec3(ps * 30.0 + wv * 3.0, 59.0)) * (1.0 - smoothstep(0.3, 0.6, pxn * 30.0)) + 0.2 * smoothstep(0.3, 0.6, pxn * 30.0);
    #endif
    // dust grains: dark specks drifting in the smoke (upper left and the right flank)
    #if SKY_DETAIL >= 2
    if (!lite) {
      float gd = vnoise(vec3(pc * 38.0 + wv * 4.0, 53.0));
      smDark = smoothstep(0.77, 0.82, gd) * (0.35 + 0.65 * max(ulw, rgt)) * (1.0 - smoothstep(0.3, 0.6, pxn * 38.0)) * smoothstep(0.1, 0.3, xU)
             * (1.0 - smoothstep(0.5, 0.9, xU)) * (1.0 - 0.7 * sr);
    }
    #endif
    vec3 smC = SMOKE * v * (1.0 - 0.85 * smDark);
    float bleed = sr * smoothstep(0.0, 0.8, xU);
    smC = mix(smC * mt, RED_SMOKE * v * 1.3, min(bleed * 0.6, 0.42));
    col = mix(col, smC * uSwirl, smA);
  }

  // drag streaks where matter is pulled in over the edge: a steep spiral (≈ 45° pitch), so they cross the edge
  float fdr = 0.5;
  if (x > -0.34 && x < 0.36) {
    vec2 fe = rot2(dir, 1.0 * lr + spin * 1.5);
    float g1 = vnoise(vec3(fe * 5.0, rho * 4.0 + 21.0));
    #if SKY_DETAIL >= 1
    float g2 = lite ? g1 : vnoise(vec3(fe * 12.0 + 5.0, rho * 8.0 + 13.0));
    #else
    float g2 = g1;
    #endif
    fdr = smoothstep(0.18, 0.82, 0.62 * g1 + 0.38 * g2);
  }

  // the black of its rock: charcoal, never darker than the void itself (or the void reads as a lighter disc)
  vec3 ink = CORE_RIM * 1.1 * uWoundCore * uCoreTint;
  float open = 1.0 - 0.3 * uClosed;

  // --- 2. the throat: a curtain of falling ash, darker than any smoke, lighter than the void; its streaks follow the
  //        funnel's taper and drift slowly down
  float throatA = 0.0;
  if (uWoundThroat > 0.001 && p.y < 0.25 && xT < 0.25) {
    float hw = throatHalf(depth);
    float tx = p.x / hw;
    float s1 = vnoise(vec3(tx * 4.2 + 0.6 * wv0, p.y * 0.55 + t * 0.012, 41.0));
    #if SKY_DETAIL >= 1
    float s2 = lite ? s1 : vnoise(vec3(tx * 12.0, p.y * 1.3 + t * 0.018, 47.0));
    #else
    float s2 = s1;
    #endif
    float streak = smoothstep(0.3, 0.85, 0.6 * s1 + 0.4 * s2);
    // (it ends a little under the horizon, behind the city: it never hangs on into open space below)
    float hgt = asin(clamp(d.y, -1.0, 1.0)) / R;
    throatA = (1.0 - smoothstep(-0.45, 0.2, xT)) * smoothstep(0.15, -0.25, p.y) * smoothstep(-0.6, -0.15, hgt) * uWoundThroat * uWoundDebris * open;
    vec3 thC = ink * (0.95 + 0.75 * streak * (0.5 + 0.5 * smoothstep(0.0, 0.6, depth))) + LAVGREY * mt * 0.003 * streak * smoothstep(-0.3, 0.0, xT);
    col = mix(col, thC, throatA);
  }

  // --- 3. the void, and the crust's streaks dragged in over its edge
  float voidA = woundVoid(rn, wob, ell);
  if (voidA > 0.0) col = mix(col, woundCore(rho, fsk) * uWoundCore * uCoreTint, voidA);
  if (rho > 0.72 && rho < 1.06) {
    float drag = smoothstep(0.74, 0.96, rho) * (1.0 - smoothstep(0.98, 1.06, rho));
    float sA = drag * smoothstep(0.45, 0.85, fdr) * (0.4 + 0.4 * max(ulw, rgt)) * uWoundDebris * open;
    col = mix(col, ink * (0.9 + 0.6 * fdr), sA * 0.8);
  }

  // the violet clusters: irregular regions of the crust lit from within, riding the crust (upper left, about 0.45 R
  // across; fainter and smaller on the right flank)
  float vio = (0.35 + 0.65 * act) * (1.0 - 0.9 * uClosed);
  float vcl = 0.0;
  if (!lite && rn > 0.8 && rn < 2.0) {
    float vn = vnoise(vec3(pc * 5.0, 61.0));
    vec2 d1 = (pc - vec2(-1.02, 0.74)) * vec2(1.0, 1.35);
    vec2 d2 = pc - vec2(1.16, 0.3);
    vcl = smoothstep(0.3, 0.75, exp(-dot(d1, d1) / 0.07) + 0.55 * (vn - 0.5))
        + 0.8 * smoothstep(0.35, 0.8, exp(-dot(d2, d2) / 0.05) + 0.5 * (vn - 0.5));
  }

  // --- 4. the crust: one ragged mass of smoky rock crowding the boundary, breaking into splatter outward. Lit grey
  //        matter with black ink-blot masses and specks fused into it; out to ≈ 2.4 R on the upper left and the right
  //        flank, short below and on the upper right
  float matter = 0.0, inkA = 0.0;
  vec2 wb = vec2(0.0);
  float outR = (mix(0.3, 1.35, ulw * ulw) + 0.7 * rgt * (1.0 - ulw) * (1.0 - 0.5 * ur) + 0.06 * down) * (0.85 + 0.3 * act)
             * (0.7 + 0.6 * vnoise(FBM_ROT * vec3(dir * 1.6, 8.0 + t * 0.004)));
  if (xU > -0.32 && xU < outR + 0.15) {
    float inR = mix(0.04, 0.24, smoothstep(0.3, 0.7, vnoise(FBM_ROT * vec3(dir * 1.4, 5.0 + t * 0.005)))) * (0.55 + 0.45 * max(ulw, rgt));
    float band = smoothstep(-inR - 0.06, -inR + 0.06, xU) * (1.0 - smoothstep(outR * 0.25, outR, xU));
    #if SKY_DETAIL >= 1
    vec3 qb = vec3(pc * 2.2, 4.0);
    wb = vec2(vnoise(qb + 1.0), vnoise(qb + 13.0)) - 0.5;
    float blob = FBM_CRUST(vec3(pc * 2.8 + wb * 1.4, 4.0 + t * 0.002));
    // the ink's own splatter field: finer than the matter's, so its masses run from a third of a radius to specks
    float sp = fbm3(vec3(pc * 6.5 + wb * 2.2, 11.0));
    float ero = lite ? 0.5 : 0.6 * vnoise(vec3(pc * 15.0 + wb, 21.0)) + 0.4 * vnoise(vec3(pc * 34.0, 27.0));
    float cur = 0.65 * vnoise(vec3(p.x * 11.0 + 1.2 * wb.x, p.y * 0.8 + t * 0.006, 33.0)) + 0.35 * vnoise(vec3(p.x * 27.0 + 2.0 * wb.y, p.y * 1.6 + t * 0.009, 37.0));
    #else
    float blob = fbm3(vec3(pc * 2.8, 4.0));
    float sp = vnoise(vec3(pc * 6.5, 11.0));
    float ero = 0.5;
    float cur = vnoise(vec3(p.x * 8.0, p.y * 0.9, 33.0));
    #endif
    // on the right flank (and down the throat's sides) the matter hangs in vertical curtains; where it reaches in over
    // the void it is dragged into the funnel (streaks, never lumps)
    float vert = max(rgt * (1.0 - 0.6 * ur), smoothstep(0.3, 0.8, down));
    float n = mix(blob, 0.35 * blob + 0.65 * cur, vert * 0.8);
    n = mix(n, 0.3 * blob + 0.7 * fdr, smoothstep(0.06, -0.1, x));
    n = mix(n, 0.4 * n + 0.6 * swl, swW * 0.6 * (1.0 - vert));
    // one mass at the opening, splatter further out (patches of matter in smoke), softening into the smoke at its end
    float soft = smoothstep(0.0, outR, xU);
    float spl = smoothstep(0.3, 0.8, xU);
    matter = smoothstep(0.38 - 0.06 * soft + 0.14 * spl, 0.48 + 0.08 * soft + 0.2 * spl, n + 0.6 * (band - 0.5) * (1.0 - 0.6 * spl) + 0.3 * (ero - 0.5) + 0.04);
    matter *= 1.0 - smoothstep(0.6 * outR, 1.1 * outR, xU);
    // the lining: the first ≈ 0.2 R past the edge is the funnel's wall, one smooth dark mass streaked along a steep
    // spiral (no chunks, no highlights), so the opening grades softly into the crust instead of being cut out of it
    float lining = 1.0 - smoothstep(0.1, 0.3, xU + 0.1 * (ero - 0.5) + 0.06 * (blob - 0.5));
    matter = max(matter, lining * smoothstep(-0.12, 0.0, xU));
    // ink: black rock where the mass is densest, its edges bitten by finer noise (eroded, not cut); out past the
    // matter only its largest masses survive, as splatter breaking away
    // (black masses crowd the upper left and the right flank a little way out; few at the opening's lip, few below)
    float inkF = sp + 0.46 * (ero - 0.5) + 0.22 * (band - 0.5) + 0.22 * (blob - 0.5) - 0.12 * smoothstep(0.0, -0.12, x)
               - 0.1 * smoothstep(0.6 * outR, 1.2 * outR, xU) + 0.09 * (ulw * ulw - 0.5) + 0.05 * (rgt - 0.5)
               - 0.22 * lining * (1.0 - 0.6 * ulw * ulw) - 0.06 * smoothstep(0.3, 0.8, down) - 0.06 * sr - 0.05 * ur - 0.04 * rgt;
    float aaI = max(fwidth(inkF) * 0.8, 0.004);
    inkA = smoothstep(0.66 - aaI, 0.66 + aaI, inkF);
    #if SKY_DETAIL >= 2
    // grit: pure-black specks scattered through the matter, crowded just outside the opening (1.15 – 1.4 R)
    if (!lite) {
      float gq = vnoise(vec3(pc * 46.0 + wb * 3.0, 41.0));
      float gd = 0.78 - 0.07 * smoothstep(0.1, 0.2, xU) * (1.0 - smoothstep(0.42, 0.6, xU));
      inkA = max(inkA, smoothstep(gd, gd + 0.03, gq) * max(smoothstep(0.2, 0.6, band), 0.6 * matter) * (1.0 - smoothstep(0.25, 0.6, pxn * 46.0)));
    }
    #endif
    // the edge of an ink mass that faces the light catches it: the Wound's lavender, or the red remnant's crimson
    vec2 gi = vec2(dFdx(inkF), dFdy(inkF));
    float gl = length(gi);
    float redness = smoothstep(0.45, 0.95, sr);
    vec2 Lr = normalize(mix(normalize(UL - dir * 0.6), toRed, redness));
    float facing = gl > 1e-6 ? max(dot(-gi / gl, Lr), 0.0) : 0.0;
    float rimBand = 1.0 - smoothstep(0.66 + aaI, 0.66 + aaI + clamp(1.6 * gl, 0.002, 0.06), inkF);
    float inkRim = inkA * rimBand * facing * facing;
    // the matter's light: mottled (its relief), strongest upper left, greyer in the right flank's curtains
    float tex = 0.5 + 1.7 * (blob - 0.5) + 0.7 * (ero - 0.5) + 0.8 * vert * (cur - 0.5);
    float mott = clamp(mix(tex, 0.5 + 1.4 * (fdr - 0.5), lining), 0.0, 1.5);
    float hl = smoothstep(0.42 - 0.16 * ulw, 0.85 - 0.12 * ulw, mott) * (1.0 - lining);
    // its highlights: a tighter lobe than its light (upper left, then the right flank), so the top stays dim
    float gateH = 0.15 + 0.85 * smoothstep(0.5, 0.97, dot(dir, UL)) + 0.45 * rgt * (1.0 - ur);
    // the lining darkens into the opening: no lit lip, only a few lit streaks running on down into it
    float deep = 0.75 + 0.25 * smoothstep(-0.05, 0.4, xU + 0.12 * (fdr - 0.5) + 0.08 * (ero - 0.5));
    // …streaked along a steep spiral (matter sliding in, never concentric grooves)
    deep *= mix(1.0, 0.7 + 0.6 * fdr, 1.0 - smoothstep(0.08, 0.34, xU));
    // its unlit tone rises outward to the smoke's, so the crust dissolves into the smoke instead of ending in an edge
    float outer = smoothstep(0.0, outR * 1.1, xU);
    // (a preset that lifts its smoke lifts its crust half as much: behind Z10's veil both must still read)
    float lum = (mix(0.056, 0.074, outer) * (0.5 + 0.9 * mott) + 0.22 * gateH * hl * hl) * deep * mix(1.0, uSwirl, 0.5);
    vec3 matC = mix(CHAR, LAVGREY, smoothstep(0.05, 0.16, lum)) * lum * mt;
    matC = mix(matC, RED_SMOKE * lum * 0.7, redness * 0.45);
    // at the lip it settles onto the void's own rock colour, whatever the preset lifts its matter to: the opening is
    // never ringed by a lit edge, even where the void is near-black (Z10, Z12)
    matC = mix(min(matC, ink * (1.2 + 0.9 * fdr) + matC * 0.2), matC, smoothstep(-0.04, 0.3, xU));
    // inside a violet cluster the lit faces turn lavender-violet
    float vl = min(vcl * 1.15, 1.0) * vio;
    matC = mix(matC, LAVVIO * (lum * 2.1 + 0.08 * hl * deep + 0.015 * deep), min(vl, 0.92));
    col = mix(col, matC, matter * mix(0.95, 0.75, outer) * uWoundDebris * open);
    vec3 rimC = mix(LAVGREY * mt * 0.17 * gate, vec3(0.26, 0.05, 0.025), redness) * deep;
    rimC = mix(rimC, LAVVIO * 0.5 * deep, min(vl, 0.9));
    // the rock is charcoal with a faint grain and sheen, never a flat cut-out
    vec3 inkC = ink * (0.7 + 0.6 * ero) + LAVGREY * mt * 0.008 * gate * deep * smoothstep(0.45, 0.75, ero);
    col = mix(col, inkC + rimC * inkRim, inkA * uWoundDebris * open);
    // a violet cluster is an area light: it also glows softly in the smoke and dust over and around its chunks
    col += LAVVIO * mt * 0.045 * vl * (1.0 - 0.6 * inkA) * uWoundDebris;
  }

  // --- 5. the violet: light on matter. Glints and a few veins inside the clusters, and forked crackle filaments
  //        along the lower-right lip (and one small one in the upper-left cluster). They flare with the activity.
  float glow = 0.0;
  if (!lite && vio > 0.01 && rn > 0.75 && rn < 2.0) {
    #if SKY_DETAIL >= 1
    float lipLR = (0.25 + 0.75 * smoothstep(0.2, 0.9, dot(dir, vec2(0.6, -0.8)))) * exp(-abs(x + 0.03) / 0.1);
    if (vcl > 0.02 || lipLR > 0.02) {
      vec2 fv = rot2(dir, 2.1 * lr + spin * 1.5);
      float v1 = vnoise(vec3(fv * 9.0 + wb * 0.8, rho * 5.0 + 31.0 + t * 0.01));
      float v2 = vnoise(vec3(fv * 21.0 + 7.0 + wb, rho * 11.0 + 37.0 - t * 0.012));
      float w1 = max(fwidth(v1) * 0.7, 0.004);
      float w2 = max(fwidth(v2) * 0.6, 0.004);
      // filaments along the noise's mid contours, each cut short by the other: a branching network, not a lattice
      float vein = (1.0 - smoothstep(0.0, w1, abs(v1 - 0.5))) * smoothstep(0.42, 0.62, v2)
                 + 0.7 * (1.0 - smoothstep(0.0, w2, abs(v2 - 0.5))) * smoothstep(0.5, 0.66, v1);
      glow += vein * (1.0 - inkA) * (matter * min(vcl, 1.0) * 0.3 + 0.3 * lipLR);
      #if SKY_DETAIL >= 2
      // glints: tiny hot points on the lit faces
      float gn = vnoise(vec3(pc * 70.0, 71.0));
      glow += smoothstep(0.87, 0.92, gn) * matter * min(vcl, 1.0) * (1.0 - smoothstep(0.3, 0.6, pxn * 70.0)) * 1.2;
      #endif
    }
    #endif
    // the crackle: a forked thread along the lower-right lip, and a short one in the upper-left cluster
    float cw = max(0.004, pxn * 0.7);
    vec2 a0 = rot2(vec2(1.0, 0.0), -0.28) * 1.03, b0 = rot2(vec2(1.0, 0.0), -0.98) * 0.99;
    if (dot(pc - (a0 + b0) * 0.5, pc - (a0 + b0) * 0.5) < 0.25) {
      vec2 m1 = mix(a0, b0, 0.42), m2 = mix(a0, b0, 0.7);
      float flick = 0.75 + 0.25 * sin(t * 0.9) * sin(t * 0.37 + 1.3);
      float c = crackle(pc, a0, b0, 3.0, cw, t)
              + 0.75 * crackle(pc, m1, rot2(vec2(1.0, 0.0), -0.5) * 0.86, 5.0, cw * 0.8, t)
              + 0.6 * crackle(pc, m2, rot2(vec2(1.0, 0.0), -0.66) * 1.2, 7.0, cw * 0.7, t);
      glow += c * flick * 0.4;
    }
  }
  // (the hottest light runs toward white, so a filament's core blooms violet-white rather than flat purple)
  vec3 vg = mix(VIOLET, LAVVIO, 0.35) * glow * vio;
  col += (vg + vec3(0.30, 0.28, 0.36) * max(glow * vio - 0.8, 0.0)) * uWoundDebris;

  // --- 6. flying debris (front-most): a lane of medium and large rocks from the upper left to the red remnant's right
  //        limb, then a band dropping left under the remnant; a thin trail toward the white remnant; loose chunks off
  //        the crust. Each is shaded by the light it is nearest and drags a short smear.
  vec3 preRocks = col;
  float occ = 0.0;
  float flow = t * 0.010;
  float warmth = uRedVis * smoothstep(0.35, 0.8, rn / max(rn + length(redP - p), 1e-3));
  float cool = exp(-max(rn - 1.2, 0.0) / 1.3) * (0.4 + 0.6 * gate);
  vec2 Lw = -dir;
  vec2 Lr = normalize(redP - p + 1e-4);
  vec2 su, sv;
  float dust = 0.0;
  if (uRedVis > 0.01) {
    // the remnant's frame: uR points from it toward the Wound, vR up
    vec2 uR = -toRed;
    vec2 vR = rot2(uR, 1.5708 * sgn);
    // lane 1: from the Wound's upper left to the remnant's right limb, arching slightly
    vec2 A = rot2(toRed, -0.62 * sgn) * 1.45;
    vec2 B = redP + uR * rr * 1.18 + vR * rr * 0.2;
    vec3 ac = arcCoords(p, A, B, -0.06 * sgn, su, sv);
    float L1 = length(B - A);
    vec4 prof = vec4(0.16, 0.24, uRedVis, 1.0);
    if (ac.x > -0.3 && ac.x < 1.3 && abs(ac.y) < mix(prof.x, prof.y, clamp(ac.x, 0.0, 1.0)) * 1.3 + 0.3)
      arcRocks(ac, L1, su, sv, prof, flow, 5.0, pxn, Lw, Lr, warmth, cool, ink, !lite, col, occ);
    float tc = clamp(ac.x, 0.0, 1.0);
    float wh = 0.22 + 0.2 * tc;
    dust = exp(-ac.y * ac.y / (wh * wh)) * smoothstep(-0.05, 0.06, ac.x) * (1.0 - smoothstep(0.85, 1.1, ac.x)) * (1.0 - 0.4 * tc);
    // lane 2: from the remnant's right limb, a band dropping left under it, thinning
    vec2 C = redP + uR * rr * 1.1 - vR * rr * 0.3;
    vec2 D = redP - uR * rr * 3.4 - vR * rr * 2.1;
    vec3 ac2 = arcCoords(p, C, D, 0.05 * sgn, su, sv);
    vec4 prof2 = vec4(0.2, 0.36, 0.85 * uRedVis, 0.7);
    if (ac2.x > -0.3 && ac2.x < 1.3 && abs(ac2.y) < mix(prof2.x, prof2.y, clamp(ac2.x, 0.0, 1.0)) * 1.3 + 0.3)
      arcRocks(ac2, length(D - C), su, sv, prof2, flow * 0.8, 11.0, pxn, Lw, Lr, warmth, cool, ink, !lite, col, occ);
    float tc2 = clamp(ac2.x, 0.0, 1.0);
    float wh2 = 0.3 + 0.35 * tc2;
    dust = max(dust, exp(-ac2.y * ac2.y / (wh2 * wh2)) * smoothstep(-0.1, 0.05, ac2.x) * (1.0 - smoothstep(0.8, 1.1, ac2.x)) * (0.8 - 0.5 * tc2));
    dust *= uRedVis;
  }
  if (uWhiteVis > 0.01) {
    // a thin trail toward the white remnant
    float cW = dot(uWhiteDir, W);
    vec3 tw = uWhiteDir - W * cW;
    vec2 toW = vec2(dot(tw, Xc), dot(tw, Yc));
    toW = length(toW) > 1e-5 ? normalize(toW) : vec2(1.0, 0.0);
    float wd = acos(clamp(cW, -1.0, 1.0)) / R;
    vec2 A3 = rot2(toW, -0.2 * sgn) * 1.35;
    vec2 B3 = toW * min(wd * 0.82, reach - 0.1);
    vec3 ac3 = arcCoords(p, A3, B3, 0.05, su, sv);
    vec4 prof3 = vec4(0.06, 0.14, 0.4 * uWhiteVis, 0.35);
    if (ac3.x > -0.3 && ac3.x < 1.3 && abs(ac3.y) < mix(prof3.x, prof3.y, clamp(ac3.x, 0.0, 1.0)) * 1.3 + 0.3)
      arcRocks(ac3, length(B3 - A3), su, sv, prof3, flow, 17.0, pxn, Lw, Lr, warmth, cool, ink, false, col, occ);
  }
  // loose chunks breaking off the crust's outer edge (small: big shards over the crust read as stickers)
  if (xU > 0.1 && xU < 1.4) {
    float fl = 0.55 * smoothstep(outR * 0.4, outR * 0.9, xU) * exp(-max(xU - outR, 0.0) / 0.45) * (0.3 + 0.7 * max(ulw, rgt)) * open;
    float sa = spin + 0.3;
    vec2 cq = rot2(p, sa);
    vec2 Wq = rot2(Lw, sa), Rq = rot2(Lr, sa);
    vec2 dq = rot2(dir, sa);
    vec4 r = splatRock(cq / 0.16, fl * 0.6, 0.2, 23.0, pxn / 0.16, dq);
    col = mix(col, ink * 2.0, r.w * 0.3);
    col = mix(col, rockShade(r.yz, Wq, Rq, warmth, cool, ink), r.x);
    occ += r.x * (1.0 - occ);
    #if SKY_DETAIL >= 1
    if (!lite) {
      r = splatRock(cq / 0.07 + vec2(0.41, 0.77), fl * 0.8, 0.2, 29.0, pxn / 0.07, dq);
      col = mix(col, rockShade(r.yz, Wq, Rq, warmth, cool, ink), r.x);
      occ += r.x * (1.0 - occ);
    }
    #endif
  }
  if (dust > 0.01) {
    float dn = vnoise(vec3(pc * 5.0 + vec2(flow, 0.0), 4.0)) * 0.6 + vnoise(vec3(pc * 13.0, 9.0)) * 0.4;
    float dA = dust * smoothstep(0.3, 0.75, dn) * 0.5 * uWoundHalo * (1.0 - occ);
    vec3 dC = mix(SMOKE * mt * 0.05, RED_SMOKE * 0.10, smoothstep(0.3, 0.9, warmth)) * uSwirl;
    col = mix(col, dC, dA);
  }
  col = mix(preRocks, col, uWoundDebris);

  // --- closed: the boundary calms (it keeps its wandering outline) and a stitched gold seam seals it: segments of
  //     varying thickness along that outline, with gaps; the crust stays
  if (uClosed > 0.001) {
    float gw = max(0.005, pxn * 0.8) * (0.4 + 1.2 * vnoise(vec3(dir * 4.1, 8.0)));
    float seg = smoothstep(0.4, 0.52, 0.65 * vnoise(vec3(dir * 12.0, 4.0)) + 0.35 * vnoise(vec3(dir * 4.3, 9.0)));
    float gx = (x - 0.02 * (vnoise(vec3(dir * 13.0, 6.0)) - 0.5)) / gw;
    vec3 gold = vec3(1.0, 0.64, 0.24);
    col += gold * (exp(-gx * gx) * 1.3 * min(1.0, 0.012 / gw) * seg + exp(-abs(x) / 0.05) * 0.02 * (0.4 + 0.6 * seg)) * uClosed;
  }

  gWoundVoid = voidA * uWoundVis;
  gWoundDark = max(voidA, throatA * 0.95) * uWoundVis;
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
  gWoundDark = 0.0;

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
  // the atmosphere barely veils the Wound's void and its throat (an absence, not an object behind the haze); it
  // follows their own soft edges, so the haze never draws a circle across them, and thickens again just over the
  // horizon, where the city's glow lies in front of the throat
  float absence = gWoundDark * smoothstep(0.0, 0.045, d.y);
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
