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
 * {@link woundVoidOpacity} mirror its maths on the CPU (tests), so "the core is not black" and "the edge is not a
 * step" are checked against the numbers the GPU actually uses.
 */
export const WOUND_LOOK = {
  /** linear colour of the void at its centre, and where it meets the shell (before the zone grade) */
  coreDeep: [0.0057, 0.0056, 0.0053],
  coreRim: [0.0081, 0.008, 0.0069],
  /** how the lift is spread from the centre to the rim (higher = it stays nearer the rim) */
  coreLift: 2.2,
  /** ± brightness of the striations at the rim (30 % of it at the centre, which stays calm) */
  striation: 0.35,
  /** mean boundary radius and how far it wobbles with angle (Wound radii) */
  edgeR: 0.965,
  edgeWobble: 0.14,
  /** the void fades out over [boundary − edgeIn, boundary + edgeOut]: a soft edge, never a step */
  edgeIn: 0.13,
  edgeOut: 0.05,
} as const;

/** Inside this radius (Wound radii) the void is opaque at every angle: nothing behind it needs shading. */
export const WOUND_SOLID = WOUND_LOOK.edgeR - WOUND_LOOK.edgeWobble * 0.5 - WOUND_LOOK.edgeIn - 0.01;

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

/** Linear colour of the void `rn` Wound radii from its centre, where the striation noise is `streak` (0..1). */
export function woundCoreColor(rn: number, streak: number): [number, number, number] {
  const L = WOUND_LOOK;
  const k = Math.pow(smooth(0, 1, rn), L.coreLift);
  const m = 1 + L.striation * (0.3 + 0.7 * k) * (2 * streak - 1);
  return [0, 1, 2].map((i) => (L.coreDeep[i] + (L.coreRim[i] - L.coreDeep[i]) * k) * m) as [number, number, number];
}

/** Opacity of the void `rn` Wound radii from its centre, where the boundary's wobble noise is `wob` (0..1). */
export function woundVoidOpacity(rn: number, wob: number): number {
  const L = WOUND_LOOK;
  const rb = L.edgeR + L.edgeWobble * (wob - 0.5);
  return 1 - smooth(rb - L.edgeIn, rb + L.edgeOut, rn);
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
  `const float CORE_STRIATION = ${glf(WOUND_LOOK.striation)};`,
  `const float EDGE_R = ${glf(WOUND_LOOK.edgeR)};`,
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
//   CORE    not black: a charcoal void, darkest at the centre and lifting toward the rim, with faint striations
//           like a curtain of falling ash that bows with the funnel and drifts slowly down;
//   EDGE    no drawn rim and no circle: a soft, wobbling falloff crowded by a FRACTURED SHELL of dark rock plates
//           whose near faces catch lavender-violet light (brightest upper left), with glints and glowing cracks;
//   SMOKE   grey matter churning around it in slow spiral tendrils, heavier low and toward the red remnant;
//   STREAM  a long arc of rocks and dust torn off its left edge toward the red remnant, thinning with distance.
// Everything is drawn in a chart around the Wound (azimuthal-equidistant, x right / y up as seen, in Wound radii),
// so nothing has a seam, and each debris layer turns RIGIDLY at its own slow rate, so nothing winds up over time.
// ---------------------------------------------------------------------------------------------------------
${WOUND_GLSL_CONSTANTS}
const vec2 UL = vec2(-0.6963, 0.7177);
const vec3 VIOLET = vec3(0.60, 0.30, 0.88);
const vec3 LAVENDER = vec3(0.53, 0.46, 0.74);
// the light on the plates' faces: a cool grey with only a breath of violet (the grade cools it further)
const vec3 FACE = vec3(0.50, 0.45, 0.50);
// opacity of the void at this pixel: woundComposite writes it, the horizon haze and the white remnant read it
float gWoundVoid;

vec2 rot2(vec2 v, float a) { float c = cos(a), s = sin(a); return vec2(c * v.x - s * v.y, s * v.x + c * v.y); }

// Void colour at rn Wound radii from the centre; streak 0..1 = the striation there (mirrored by woundCoreColor()).
vec3 woundCore(float rn, float streak) {
  float k = pow(smoothstep(0.0, 1.0, rn), CORE_LIFT);
  return mix(CORE_DEEP, CORE_RIM, k) * (1.0 + CORE_STRIATION * (0.3 + 0.7 * k) * (2.0 * streak - 1.0));
}
// Opacity of the void; wob 0..1 = the boundary's wobble noise at this angle (mirrored by woundVoidOpacity()).
float woundVoid(float rn, float wob) {
  float rb = EDGE_R + EDGE_WOBBLE * (wob - 0.5);
  return 1.0 - smoothstep(rb - EDGE_IN, rb + EDGE_OUT, rn);
}

// One angular rock per lattice cell: an irregular five-sided silhouette (never a round blob), with flat facets lit
// from L and a thin bright edge. q = cell coordinates, asp = cell width / height, fill = chance that a cell holds a
// rock (also sets its size), na = lattice period along x. Returns (coverage, facet light).
vec2 rock(vec2 q, float asp, float fill, float seed, float na, float aa, vec2 L) {
  vec2 c = floor(q);
  vec3 h = hash33(vec3(mod(c.x, na), c.y, seed));
  if (h.z > fill) return vec2(0.0);
  float size = 0.07 + 0.37 * pow(1.0 - h.z / fill, 3.0); // many small, few large
  vec2 r = q - (c + 0.5 + (h.xy - 0.5) * (1.0 - 2.0 * size));
  r.x *= asp;
  float a = h.x * 6.2832 + h.y * 40.0;
  float ca = cos(a), sa = sin(a);
  vec2 rr = vec2(ca * r.x + sa * r.y, -sa * r.x + ca * r.y);
  float dmax = -1.0;
  vec2 nmax = vec2(1.0, 0.0);
  float k = fract(h.x * 91.7);
  float e0 = dot(rr, vec2(1.0, 0.0)) / (0.62 + 0.38 * k);
  float e1 = dot(rr, vec2(0.3746, 0.9272)) / (0.62 + 0.38 * fract(k * 7.3));
  float e2 = dot(rr, vec2(-0.7660, 0.6428)) / (0.62 + 0.38 * fract(k * 13.1));
  float e3 = dot(rr, vec2(-0.8192, -0.5736)) / (0.62 + 0.38 * fract(k * 23.9));
  float e4 = dot(rr, vec2(0.3420, -0.9397)) / (0.62 + 0.38 * fract(k * 31.7));
  if (e0 > dmax) { dmax = e0; nmax = vec2(1.0, 0.0); }
  if (e1 > dmax) { dmax = e1; nmax = vec2(0.3746, 0.9272); }
  if (e2 > dmax) { dmax = e2; nmax = vec2(-0.7660, 0.6428); }
  if (e3 > dmax) { dmax = e3; nmax = vec2(-0.8192, -0.5736); }
  if (e4 > dmax) { dmax = e4; nmax = vec2(0.3420, -0.9397); }
  float m = 1.0 - smoothstep(size - aa, size + aa, dmax);
  vec2 n2 = vec2(ca * nmax.x - sa * nmax.y, sa * nmax.x + ca * nmax.y);
  float lam = max(dot(n2, L), 0.0);
  float edge = smoothstep(size - 3.5 * aa - 0.03, size - aa, dmax);
  return vec2(m, m * lam * (0.22 + 0.78 * edge));
}

// Cellular noise: the two nearest feature points of a jittered lattice. Returns (F1, ≈ distance to the cell's
// edge) and the nearest feature point fp (cell units). Its cells are the broken plates of the Wound's shell.
vec2 cells(vec2 q, float seed, out vec2 fp) {
  vec2 c = floor(q);
  vec2 f = q - c;
  float d1 = 9.0, d2 = 9.0;
  fp = c;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 o = vec2(float(i), float(j)) + 0.12 + 0.76 * hash33(vec3(c + vec2(float(i), float(j)), seed)).xy;
      vec2 r = o - f;
      float dd = dot(r, r);
      if (dd < d1) { d2 = d1; d1 = dd; fp = c + o; }
      else if (dd < d2) { d2 = dd; }
    }
  }
  d1 = sqrt(d1);
  return vec2(d1, 0.5 * (sqrt(d2) - d1));
}

// One layer of the fractured shell: broken rock plates (cells with gaps between them) crowding the boundary. The
// layer turns rigidly by a; whether a cell holds a plate is decided once per cell from where its centre sits
// (prof = radial profile in, full, full, out; bias = how much thicker it is upper left; dens = overall), so the
// outline breaks into WHOLE plates. Each plate is split through its centre into two faces tilted apart, with grain.
// p = chart position, k = cells per Wound radius, Lv = light in chart space (x right, y up, z toward the viewer).
// Returns (coverage, light on its faces); crack = a thin glowing fracture across the plate or in the gap beside it.
vec2 shellPlates(vec2 p, float k, float a, float seed, vec4 prof, float bias, float dens, float pxn, vec3 Lv, out float crack) {
  crack = 0.0;
  vec2 q = rot2(p, a) * k;
  // warp the lattice so plate edges are broken and wavy (rubble, not crystal)
  vec2 qw = q + 0.42 * (vec2(vnoise(vec3(q * 0.85, seed)), vnoise(vec3(q * 0.85, seed + 5.0))) - 0.5);
  vec2 fp;
  vec2 ce = cells(qw, seed, fp);
  vec3 h = hash33(vec3(floor(fp), seed + 7.0));
  vec2 fc = rot2(fp / k, -a);
  float rc = length(fc);
  vec2 dc = fc / max(rc, 1e-4);
  // thicker (reaching further out) on the upper left, thinner lower right
  float ul = 0.5 + 0.5 * dot(dc, UL);
  float crowd = smoothstep(prof.x, prof.y, rc) * (1.0 - smoothstep(prof.z, prof.w + 0.22 * ul * ul, rc));
  crowd *= 1.0 - bias + bias * ul;
  crowd *= dens * (0.45 + 1.0 * vnoise(vec3(dc * 2.3, rc * 2.0 + seed)));
  if (h.x > crowd) return vec2(0.0);
  float aa = max(pxn * k, 0.02);
  float gap = 0.02 + 0.05 * h.y;
  float m = smoothstep(gap - aa, gap + aa, ce.y);
  vec2 rel = qw - fp;
  float fa = h.z * 6.2832;
  vec2 sd = vec2(cos(fa), sin(fa));
  float side = dot(rel, sd);
  vec3 h2 = hash33(vec3(floor(fp), seed + 13.0));
  // a lumpy chunk: its surface bulges toward the viewer (normal leans out from its centre), tilted at random,
  // with a weak break through the middle
  vec2 tilt = dc * 0.4 + (h2.xy - 0.5) * 1.1 + rot2(rel * 0.6 + sd * (side > 0.0 ? 0.22 : -0.22), -a);
  float lam = max(dot(normalize(vec3(tilt, 1.0)), Lv), 0.0);
  // rough, pitted faces (grain at two scales) and only a faint lip where an edge faces the light
  float grain = 0.35 + 0.65 * vnoise(vec3(qw * 3.3, seed + 2.0)) + 0.4 * (vnoise(vec3(qw * 11.0, seed + 9.0)) - 0.5);
  float lip = (1.0 - smoothstep(gap + aa, gap + 0.10 + aa, ce.y)) * 0.4;
  // a third of the chunks are dark rock that hardly catches the light
  float albedo = h2.z < 0.45 ? 0.10 : 0.45 + 0.55 * h2.z;
  float lit = (lam * lam * grain + lip * lam * lam * 0.2) * albedo;
  float cw = max(0.03, aa * 0.7);
  crack = (h.y > 0.55 ? exp(-abs(side) / cw) * m : 0.0) + (1.0 - m) * smoothstep(0.45, 0.9, crowd);
  return vec2(m, lit);
}

vec3 woundComposite(vec3 col, vec3 d, float rn, vec3 e, float px, float R) {
  vec3 W = uWoundDir;
  // its stream reaches toward the red remnant, so the Wound's cone grows with that distance (when there is one)
  float cRed = dot(uRedDir, W);
  float redDist = acos(clamp(cRed, -1.0, 1.0)) / R;
  float reach = uRedVis > 0.01 ? clamp(redDist * 1.3, 2.8, 5.2) : 2.8;
  if (rn > reach) return col;
  float pxn = px / R;
  vec3 base = col;
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
  float sr = max(dot(dir, toRed), 0.0);
  // the Wound's own light, from the upper left and a little toward the viewer: pale lavender on its matter,
  // saturated violet only in what glows (cracks, glints, veins) — that rises with the activity
  vec3 Lv = vec3(-0.6157, 0.5459, 0.5683);
  float vio = 0.45 + 0.55 * act;
  vec3 violet = VIOLET * vio;
  vec3 lav = LAVENDER * (0.85 + 0.3 * act);
  // how strongly the shell is lit where this pixel sits: brightest upper left, a little on the right flank
  float gul = smoothstep(-0.25, 0.95, dot(dir, UL));
  float gate = 0.05 + 0.95 * gul * sqrt(gul) + 0.35 * pow(max(dir.x, 0.0), 3.0);

  // --- stream geometry: an arc leaving the left edge a little below the line to the red remnant, sagging under
  //     its chord as it reaches toward it and on past it, widening and thinning with distance
  float stream = 0.0, haze = 0.0, sl = 0.0, soff = 0.0, st = 0.0;
  vec2 su = vec2(1.0, 0.0), sv = vec2(0.0, -1.0);
  if (uRedVis > 0.01) {
    vec2 A = rot2(toRed, toRed.x < 0.0 ? 0.30 : -0.30) * 0.95;
    vec2 B = rot2(toRed, toRed.x < 0.0 ? 0.16 : -0.16) * max(redDist + 0.6, 2.2);
    vec2 ch = B - A;
    float Lc = length(ch);
    su = ch / Lc;
    sv = vec2(-su.y, su.x);
    if (sv.y > 0.0) sv = -sv;
    vec2 rp = p - A;
    st = dot(rp, su) / Lc;
    float tc = clamp(st, 0.0, 1.0);
    soff = dot(rp, sv) - 0.52 * Lc * tc * (1.0 - tc);
    sl = st * Lc;
    float along = smoothstep(-0.10, 0.05, st) * (1.0 - smoothstep(0.70, 1.0, st)) * uRedVis;
    float w = 0.10 + 0.30 * tc;
    stream = exp(-soff * soff / (w * w)) * along;
    // the smoky haze the stream drags along is much wider than its rocks
    float wh = 0.30 + 0.55 * tc;
    haze = exp(-soff * soff / (wh * wh)) * along;
  }

  // --- 1. smoke: grey matter churning in slow spiral tendrils, heavier low and toward the red remnant where the
  //        Wound meets the crimson nebula, packed into a dense crust against the boundary. It is matter, not glow:
  //        it hides the sky behind it.
  // (deep inside the void nothing shows it: a constant stands in, faded so nothing pops where it starts)
  float smoke = 0.5, smA = 0.0;
  vec3 smC = vec3(0.0);
  if (rn > 0.70 && rn < 2.9) {
    vec2 ps = rot2(p, 0.95 * log(max(rn, 0.3)) - uTime * 0.0042);
    #if SKY_DETAIL >= 1
    vec3 q = vec3(ps * 1.6, uTime * 0.006);
    vec2 wv = vec2(vnoise(q + 3.0), vnoise(q + 19.0)) - 0.5;
    smoke = FBM_BIG(vec3(ps * 2.6 + wv * 1.9, uTime * 0.005 + 7.0));
    #else
    smoke = fbm3(vec3(ps * 2.6, 7.0));
    #endif
    smoke = mix(0.5, smoke, smoothstep(0.70, 0.78, rn));
    float prof = smoothstep(0.78, 1.0, rn) * exp(-pow(max(rn - 0.98, 0.0) / 1.15, 1.3));
    float heavy = 0.6 + 0.3 * sr + 0.3 * max(-dir.y, 0.0);
    smA = prof * heavy * smoothstep(0.26, 0.72, smoke) * 1.2;
    float crust = smoothstep(0.86, 0.97, rn) * (1.0 - smoothstep(1.04, 1.24, rn)) * (0.55 + 0.45 * smoke);
    smA = clamp(max(smA, crust), 0.0, 0.95);
    float near = exp(-max(rn - 1.0, 0.0) / 0.4);
    smC = mix(vec3(0.020, 0.0185, 0.016), vec3(0.098, 0.090, 0.080), smoothstep(0.38, 0.92, smoke));
    smC *= (0.55 + 0.45 * near) * uSwirl;
    // the crust nearest the boundary catches the Wound's light (upper left): the plates sit in lit matter
    smC += lav * 0.7 * near * near * gate * gate * smoothstep(0.3, 0.8, smoke);
    smC += vec3(0.11, 0.022, 0.016) * sr * sr * smoothstep(1.0, 1.9, rn) * uRedVis * smoothstep(0.35, 0.8, smoke);
  }
  if (haze > 0.01) {
    float dn = 0.6 * vnoise(vec3(sl * 2.2 + uTime * 0.02, soff * 6.0, 4.0)) + 0.4 * vnoise(vec3(p * 3.1, 11.0));
    float tc = clamp(st, 0.0, 1.0);
    float dust = haze * smoothstep(0.25, 0.75, dn) * (1.0 - 0.45 * tc) * 0.8;
    vec3 dcol = (vec3(0.075, 0.056, 0.050) + vec3(0.13, 0.03, 0.021) * smoothstep(0.1, 0.8, st) * uRedVis) * uSwirl;
    smC = mix(smC, dcol, dust / max(smA + dust, 1e-4));
    smA = max(smA, dust);
  }
  col = mix(col, smC, smA * uWoundHalo);

  // --- 2. the void: soft, wobbling boundary; inside, the ash curtain
  // (the wobble only matters where the void is not opaque at every angle)
  vec2 wq = dir * 2.4;
  float wob = rn < WOUND_SOLID ? 0.5 : 0.6 * vnoise(vec3(wq, 1.7 + uTime * 0.008)) + 0.4 * vnoise(vec3(wq * 3.5, 9.1 - uTime * 0.011));
  // tongues of the smoke beneath lick in over the boundary, so the outline is never a clean circle
  float voidA = woundVoid(rn, wob) * (1.0 - 0.85 * smoothstep(0.82, 1.0, rn) * smoothstep(0.48, 0.78, smoke));
  if (voidA > 0.0) {
    // striations bow a little with the funnel (meridians of a sphere seen from inside) and drift slowly down
    float bow = p.x / sqrt(max(1.0 - 0.35 * p.y * p.y, 0.4));
    #if SKY_DETAIL >= 1
    bow += 0.09 * (vnoise(vec3(p * 2.2, uTime * 0.01 + 3.0)) - 0.5);
    #endif
    float fall = uTime * 0.010;
    float s1 = vnoise(vec3(bow * 13.0, p.y * 2.4 + fall, uTime * 0.012));
    #if SKY_DETAIL >= 1
    float s2 = lite ? s1 : vnoise(vec3(bow * 31.0 + 7.3, p.y * 2.3 + fall * 1.7, uTime * 0.017 + 4.0));
    #else
    float s2 = s1;
    #endif
    float streak = smoothstep(0.2, 0.85, 0.6 * s1 + 0.4 * s2);
    vec3 core = woundCore(rn, streak) * uWoundCore;
    // the Wound's own violet stirs faintly in the curtain near the rim while it is active
    core += VIOLET * 0.012 * uWoundCore * streak * streak * streak * smoothstep(0.55, 0.95, rn) * act * gate;
    col = mix(col, core, voidA);
  }

  // --- 3. the fractured shell: broken plates crowd the boundary and break its outline
  float open = 1.0 - 0.75 * uClosed;
  if (rn > 0.70 && rn < 1.55) {
    vec3 dark = vec3(0.0125, 0.0115, 0.0095);
    vec3 redRim = vec3(0.035, 0.008, 0.006) * sr * sr * uRedVis;
    float ck;
    vec2 a = shellPlates(p, 7.5, uTime * 0.0040, 3.0, vec4(0.76, 0.90, 1.03, 1.16), 0.75, 1.0, pxn, Lv, ck);
    float crack = ck * a.x;
    vec3 face = dark + (FACE * 0.42 * gate + redRim) * a.y;
    col = mix(col, face, a.x * uWoundDebris * open);
    #if SKY_DETAIL >= 1
    if (!lite) {
      vec2 b = shellPlates(p, 15.0, uTime * 0.0055 + 1.3, 11.0, vec4(0.86, 0.99, 1.10, 1.40), 0.7, 0.75, pxn, Lv, ck);
      face = dark + (FACE * 0.34 * gate + redRim) * b.y;
      col = mix(col, face, b.x * uWoundDebris * open);
      crack = max(crack * (1.0 - b.x), ck * b.x);
    }
    #endif
    // which cracks glow drifts slowly; they flare with the activity
    float cg = smoothstep(0.5, 0.8, vnoise(vec3(dir * 2.6, uTime * 0.035 + 2.0)));
    col += violet * crack * cg * (0.10 + 0.40 * act) * (0.35 + 0.65 * gate) * uWoundDebris * open;
    #if SKY_DETAIL >= 1
    // glints: sparse specks of light riding the big plates
    if (!lite) {
      vec2 gq = rot2(p, uTime * 0.0040) * 46.0;
      vec2 gc = floor(gq);
      vec3 gh = hash33(vec3(gc, 57.0));
      float prob = 0.14 * smoothstep(0.85, 0.97, rn) * (1.0 - smoothstep(1.1, 1.3, rn)) * (0.3 + 0.7 * gate);
      if (gh.z < prob) {
        vec2 dv = gq - (gc + 0.2 + 0.6 * gh.xy);
        float r = max(0.07, pxn * 46.0 * 0.7);
        float tw = 0.55 + 0.45 * sin(uTime * (0.7 + gh.x) + gh.y * 40.0);
        col += vec3(0.75, 0.62, 1.0) * exp(-dot(dv, dv) / (r * r)) * (0.0049 / (r * r)) * tw * vio * uWoundDebris * open;
      }
    }
    #endif
  }
  // the lavender-violet glow the shell sits in: strongest upper left, hugging the boundary on both sides
  col += violet * 0.18 * gate * gate * exp(-abs(rn - 1.0) / 0.15) * (0.45 + 0.55 * smoke) * uWoundHalo;
  // violet veins: a network of thin glowing fractures through the matter just outside the boundary (the edges of
  // a cellular pattern turning with the smoke), lit only along a few drifting stretches; they swell with the activity
  if (!lite && rn > 0.85 && rn < 1.6) {
    vec2 pv = rot2(p, 0.95 * log(max(rn, 0.3)) - uTime * 0.0042) * 9.0;
    vec2 vfp;
    vec2 ve = cells(pv + 0.3 * (vec2(vnoise(vec3(pv * 0.7, 3.0)), vnoise(vec3(pv * 0.7, 8.0))) - 0.5), 71.0, vfp);
    float vw = max(0.022, pxn * 9.0 * 0.6);
    float fil = exp(-ve.y / vw) * (0.022 / vw);
    float live = smoothstep(0.45, 0.75, vnoise(vec3(vfp * 0.45, uTime * 0.03 + 41.0)));
    float band = smoothstep(0.86, 0.98, rn) * exp(-max(rn - 1.0, 0.0) / 0.3);
    col += violet * 2.8 * fil * live * band * (0.45 + 0.55 * gate) * (0.25 + 0.75 * act) * smoothstep(0.3, 0.6, smoke) * uWoundHalo;
  }

  // --- 4. flying debris (front-most): the stream's rocks drifting in toward the Wound, and loose chunks thrown
  //        off the shell, most toward the upper left and the red remnant. Near the Wound they catch its light;
  //        out in front of the crimson nebula they are black silhouettes rimmed red.
  float occ = 0.0, lit = 0.0;
  float redness = smoothstep(1.3, 2.4, rn) * uRedVis;
  vec2 Lc2 = normalize(mix(UL, toRed, redness) + vec2(1e-4, 0.0));
  if (stream > 0.01) {
    vec2 sq = vec2(sl + uTime * 0.006, soff);
    vec2 Ls = vec2(dot(Lc2, su), dot(Lc2, sv));
    float fill = stream * (0.62 - 0.38 * clamp(st, 0.0, 1.0));
    vec2 r1 = rock(sq * 5.0, 1.0, fill * 0.8, 5.0, 1e4, clamp(pxn * 4.5, 0.004, 0.4), Ls);
    occ = r1.x; lit = r1.y;
    if (!lite) {
      vec2 r2 = rock(sq * 11.0 + vec2(0.37, 0.61), 1.0, fill, 13.0, 1e4, clamp(pxn * 9.9, 0.004, 0.4), Ls);
      lit = mix(lit, r2.y, step(occ, r2.x)); occ = max(occ, r2.x);
    }
  }
  if (rn > 0.95 && rn < 2.6) {
    float a = uTime * 0.0030 + 0.7;
    vec2 cq = rot2(p, a) * 8.0;
    float fill = 0.36 * smoothstep(0.98, 1.15, rn) * exp(-max(rn - 1.1, 0.0) / 0.6)
      * (0.3 + 0.7 * max(dot(dir, normalize(UL + toRed)), 0.0)) * open;
    vec2 Lq = rot2(Lc2, a);
    vec2 r3 = rock(cq, 1.0, fill, 29.0, 1e4, clamp(pxn * 7.2, 0.004, 0.4), Lq);
    lit = mix(lit, r3.y, step(occ, r3.x)); occ = max(occ, r3.x);
    #if SKY_DETAIL >= 1
    if (!lite) {
      vec2 r4 = rock(cq * 2.3 + vec2(0.41, 0.77), 1.0, fill * 1.2, 31.0, 1e4, clamp(pxn * 16.6, 0.004, 0.4), Lq);
      lit = mix(lit, r4.y, step(occ, r4.x)); occ = max(occ, r4.x);
    }
    #endif
  }
  occ *= uWoundDebris;
  col *= 1.0 - occ;
  col += (FACE * 0.30 * gate * (1.0 - redness) + vec3(0.12, 0.022, 0.013) * redness) * lit * uWoundDebris;

  // --- closed: the torn edge has receded and a thin steady gold rim seals the (still irregular) boundary
  if (uClosed > 0.001) {
    float rb = EDGE_R + EDGE_WOBBLE * (wob - 0.5);
    float gl = max(0.0045, pxn);
    float gx = (rn - rb) / gl;
    vec3 gold = vec3(1.0, 0.64, 0.24);
    col += gold * (exp(-gx * gx) * 1.5 * min(1.0, 0.009 / gl) + exp(-max(rn - rb, 0.0) / 0.03) * 0.045 * smoothstep(rb - 0.01, rb + 0.01, rn)) * uClosed;
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
