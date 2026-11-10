/**
 * Sky dome shader: deep-space gradient, stable star field, nebula, the red remnant, the white remnant and
 * the Wound (true-black disc with lensing, orbiting angular debris and restrained violet movement).
 *
 * The vertex stage ignores camera translation, so the dome sits at infinity for ANY camera (main view, planar
 * reflection camera, PMREM cube faces) without having to follow anything on the CPU. It is pinned to the far
 * plane and drawn after the opaque scene with a depth test and no depth write, so interiors that hide the sky
 * pay nothing for it.
 *
 * COST. The fragment program is compiled per quality tier (`#define SKY_DETAIL` 0 low · 1 medium · 2 high/ultra,
 * from QualityProfile), so the cheaper tiers do not merely branch around the expensive code — it is not in the
 * program at all (software rasterisers and some mobile compilers flatten uniform branches). Worst-case
 * value-noise evaluations per pixel (inside the Wound's halo AND the red nebula): low ≈ 14, medium ≈ 26,
 * high ≈ 34 (the first version: ≈ 50 everywhere within 7 remnant radii). Each body is skipped outside its own
 * cone: red nebula 4.6 radii, Wound 3.3 radii. `uLite` (set per pass for small secondary targets: reflections,
 * PMREM faces) additionally drops the fine debris and the violet at run time.
 */
import { GLSL_DITHER, GLSL_HAZE, GLSL_NOISE } from './glsl';

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
  s += starLayer(d, 86.0, px, 3.0, 0.50 * dens.x, 0.00050, 7.5) * 6.5;
  s += starLayer(d, 47.0, px, 11.0, 0.40 * dens.x, 0.00062, 6.5) * 8.0;
  s += starLayer(d, 23.0, px, 23.0, 0.24 * dens.x, 0.00085, 6.0) * 9.0;
  // unresolved stars of the band itself: a faint milky glow that the lanes cut through
  s += vec3(0.020, 0.021, 0.027) * dens.y * dens.y;
  // a few bright stars with a soft glare (much rarer than before; none of them rivals the white remnant)
  vec3 c = floor(d * 7.0);
  vec3 h = hash33(c + 71.0);
  if (h.x < 0.07) {
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
  col = mix(col, vec3(1.5, 0.14, 0.04), smoothstep(0.5, 1.0, heat) * 0.85);
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
    surf += vec3(3.0, 0.27, 0.05) * limb * smoothstep(-0.25, 0.85, side);
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
// The Wound.
// ---------------------------------------------------------------------------------------------------------
// Pulverised matter hugging the rim. The triangle-wave folds put hard creases into the iso-contours, so the
// thresholded silhouette is chipped and angular (shattered rock) rather than a row of soft ink blots.
float debrisField(vec3 p, float seed) {
  float n = 0.58 * vnoise(p + seed) + 0.30 * vnoise(p * 2.6 + seed * 1.7) + 0.12 * vnoise(p * 6.1 + seed * 0.3);
  vec3 f = abs(fract(p * vec3(2.3, 2.9, 2.6) + seed) - 0.5);
  vec3 g = abs(fract(p.yzx * vec3(5.1, 4.3, 5.7) + seed * 2.0) - 0.5);
  return n + (f.x + f.y + f.z - 0.75) * 0.085 + (g.x + g.y + g.z - 0.75) * 0.04;
}

// One angular rock per lattice cell in (angle, radius) space around the Wound: an irregular five-sided
// silhouette (never a round blob), with flat facets lit from the white remnant's side and a thin bright edge.
// q = cell coordinates, asp = cell width / height, fill = chance that a cell holds a rock (also sets its size),
// L = direction toward the white remnant in (tangential, radial) coordinates. Returns (coverage, facet light).
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

// Two interleaved lattices per band so rocks overlap and never betray the grid.
vec2 rockBand(float turn, float rn, float na, float nr, float seed, float fill, float px, vec2 L, bool twice) {
  vec2 q = vec2(turn * na, rn * nr);
  float asp = 6.2832 * rn * nr / na;
  float aa = clamp(px * nr / uWoundR * 0.9, 0.004, 0.4);
  vec2 a = rock(q, asp, fill, seed, na, aa, L);
  if (twice) {
    vec2 b = rock(q + vec2(0.5, 0.37), asp, fill * 0.8, seed + 31.0, na, aa, L);
    a = vec2(max(a.x, b.x), mix(a.y, b.y, step(a.x, b.x)));
  }
  return a;
}

vec3 woundComposite(vec3 col, vec3 d, float th, vec3 e, float px) {
  float R = uWoundR;
  float rn = th / R;
  if (rn > 3.3) return col;
  vec3 W = uWoundDir;
  float pxn = px / R;
  vec3 base = col;
  float settle = 1.0 - 0.88 * uClosed;
  float act = uActivity * settle;

  // --- behind the boundary: movement that fades to true black toward the core
  vec3 inner = vec3(0.0);
  if (rn < 1.0 + 2.0 * pxn && rn > 0.42) {
    float depth = smoothstep(0.42, 1.0, rn);
    vec3 qi = rotAxis(d, W, -uTime * 0.010 - 2.4 * rn);
    #if SKY_DETAIL >= 1
    float m = fbm3(qi * (2.2 / R) + W * (uTime * 0.018));
    #else
    float m = vnoise(qi * (2.2 / R) + W * (uTime * 0.018));
    #endif
    float veil = smoothstep(0.50, 0.86, m) * depth * depth;
    inner = vec3(0.085, 0.028, 0.22) * veil * act * 0.42;
    float surge = vnoise(qi * (1.1 / R) + vec3(uTime * 0.11, 3.0, -uTime * 0.07));
    inner += vec3(0.30, 0.11, 0.80) * pow(max(surge - 0.70, 0.0) / 0.30, 2.0) * veil * act * 0.5;
  }
  // well inside the disc nothing else can contribute (dust, debris and the rim all start at 0.8 R)
  if (rn < 0.78) return mix(base, inner, uWoundVis);
  float outside = smoothstep(1.0 - pxn, 1.0 + pxn, rn);

  vec3 tr = uRedDir - W * dot(uRedDir, W);
  vec3 tw = uWhiteDir - W * dot(uWhiteDir, W);
  vec3 toRed = tr / max(length(tr), 1e-4);
  vec3 toWhite = tw / max(length(tw), 1e-4);
  float sr = max(dot(e, toRed), 0.0);
  float sw = max(dot(e, toWhite), 0.0);
  // polar frame: angle measured from the red remnant's bearing, tangent = direction of increasing angle
  vec3 tang = cross(W, e);
  float theta = atan(dot(e, cross(W, toRed)), dot(e, toRed));
  float thetaW = atan(dot(toWhite, cross(W, toRed)), dot(toWhite, toRed));
  vec2 L = normalize(vec2(dot(toWhite, tang), dot(toWhite, e)) + vec2(1e-4, 0.0));

  // --- two streams of debris being drawn in: a long, heavy one from the red remnant (it spirals as it falls)
  //     and a thin one crossing in front of the white remnant
  float lr = log(max(rn, 0.5));
  float dr = theta + 0.50 * lr;
  dr = atan(sin(dr), cos(dr));
  float streamR = exp(-pow(dr * rn / 0.30, 2.0)) * smoothstep(0.95, 1.25, rn) * (1.0 - smoothstep(2.5, 3.3, rn));
  float dw = theta - thetaW - 0.35 * lr;
  dw = atan(sin(dw), cos(dw));
  float streamW = exp(-pow(dw * rn / 0.13, 2.0)) * smoothstep(1.05, 1.4, rn) * (1.0 - smoothstep(2.4, 3.2, rn));
  float stream = max(streamR, 0.7 * streamW);

  // --- swirled dust halo, lit faintly from each remnant's side
  float twist = 1.7 * log(max(rn, 0.35));
  vec3 q = rotAxis(d, W, twist + uTime * 0.0045);
  float fq = 3.0 / R;
  float dust = FBM_BIG(q * fq + W * (uTime * 0.012));
  float ring = exp(-pow(max(rn - 1.0, 0.0) / 0.62, 1.25));
  float halo = (ring * smoothstep(0.28, 0.80, dust) + 0.55 * stream * (0.35 + dust)) * uWoundHalo * outside;
  vec3 haloCol = vec3(0.034, 0.030, 0.050) + vec3(0.110, 0.016, 0.010) * (sr * sr + streamR) + vec3(0.040, 0.048, 0.062) * (sw * sw + streamW);
  col += haloCol * halo * 2.4;

  // --- violet: thin filaments riding the swirl, alive only in a few drifting arcs, slow swell (never a strobe)
  if (uLite < 0.5) {
    float v1 = vnoise(q * fq * 1.6 + vec3(0.0, uTime * 0.045, 3.0));
    #if SKY_DETAIL >= 1
    float v2 = vnoise(q * fq * 3.7 + vec3(7.0, -uTime * 0.06, 0.0));
    float swell = 0.55 + 0.45 * sin(uTime * 0.6 + 6.2832 * vnoise(q * (0.9 / R) + 4.0));
    #else
    float v2 = v1;
    float swell = 0.75;
    #endif
    float ridge = 1.0 - abs(2.0 * (0.64 * v1 + 0.36 * v2) - 1.0);
    float fil = pow(ridge, 22.0);
    float gate = smoothstep(0.52, 0.80, vnoise(q * (1.3 / R) + vec3(uTime * 0.028, 0.0, uTime * 0.019)));
    float band = smoothstep(0.80, 1.0, rn) * exp(-max(rn - 1.0, 0.0) / 0.34);
    // sub-linear in activity so the default mid settings still show a few live threads
    float vio = act * (0.55 + 0.45 * act) + 0.5 * sqrt(act) * (1.0 - act);
    vec3 violet = vec3(0.50, 0.20, 1.0) * fil * gate * swell * band * vio * 2.0;
    violet += vec3(0.12, 0.035, 0.30) * gate * band * dust * vio * 0.45;
    col += violet * outside;
  }

  col = mix(inner, col, outside);

  // --- the boundary itself: a hairline of light bent around the rim, brightest toward each remnant
  float lw = max(0.0045, 1.15 * pxn);
  float x = (rn - 1.0 - lw) / lw;
  float line = exp(-x * x) * min(1.0, 0.0045 / lw * 2.0);
  vec3 bent = vec3(0.50, 0.56, 0.74) * (0.035 + 0.30 * pow(sw, 6.0)) + vec3(0.9, 0.10, 0.04) * 0.22 * pow(sr, 6.0);
  col += bent * line * (1.0 - uClosed);

  // --- orbiting dark debris. A ragged veil of pulverised matter hugs the rim; around and beyond it, three bands
  //     of angular rocks orbit at different speeds (inner faster) → differential motion and parallax.
  float occ = 0.0;
  float lit = 0.0;
  #if SKY_DETAIL >= 1
  if (uLite < 0.5) {
    vec3 p = rotAxis(d, W, uTime * 0.0060 + 0.6) * (5.2 / R);
    float n = debrisField(p, 1.7);
    float thr = mix(0.38, 0.82, smoothstep(0.92, 1.65 + 0.5 * streamR, rn));
    float aa = clamp(5.2 / R * px * 1.4, 0.02, 0.3);
    float w = smoothstep(0.80, 0.94, rn) * (1.0 - uClosed * (1.0 - smoothstep(1.10, 1.55, rn))) * (1.0 - smoothstep(1.7, 2.1, rn));
    occ = w * smoothstep(thr - aa, thr + aa, n);
  }
  #endif
  float turn = theta / 6.2832 + 0.5;
  float open = 1.0 - uClosed * (1.0 - smoothstep(1.10, 1.55, rn));
  {
    float fill = (0.42 * smoothstep(0.86, 1.02, rn) * (1.0 - smoothstep(1.25, 1.9, rn)) + 0.50 * stream) * open;
    vec2 rk = rockBand(turn + uTime * 0.00095, rn, 22.0, 7.0, 3.0, fill, px, L, SKY_DETAIL >= 1);
    lit = mix(lit, rk.y, step(occ, rk.x)); occ = max(occ, rk.x);
  }
  #if SKY_DETAIL >= 1
  if (uLite < 0.5) {
    float fill = (0.30 * smoothstep(0.98, 1.15, rn) * (1.0 - smoothstep(1.7, 2.5, rn)) + 0.55 * stream) * open;
    vec2 rk = rockBand(turn + uTime * 0.00060 + 0.31, rn, 46.0, 15.0, 9.0, fill, px, L, SKY_DETAIL >= 2);
    lit = mix(lit, rk.y, step(occ, rk.x)); occ = max(occ, rk.x);
  }
  #endif
  if (uLite < 0.5) {
    float fill = 0.17 * smoothstep(1.05, 1.3, rn) * (1.0 - smoothstep(2.0, 3.0, rn)) + 0.60 * stream;
    vec2 rk = rockBand(turn + uTime * 0.00035 + 0.67, rn, 96.0, 34.0, 23.0, fill, px, L, SKY_DETAIL >= 2);
    lit = mix(lit, rk.y, step(occ, rk.x)); occ = max(occ, rk.x);
  }
  occ *= uWoundDebris;
  col *= 1.0 - occ;
  col += (vec3(0.150, 0.165, 0.200) * (0.2 + 0.8 * sw) + vec3(0.20, 0.03, 0.015) * sr * sr) * lit * uWoundDebris;

  // --- closed: the torn edge has receded and a thin steady gold rim seals the boundary
  vec3 gold = vec3(1.0, 0.64, 0.24);
  float gl = max(0.0038, 1.0 * pxn);
  float gx = (rn - 1.0) / gl;
  col += gold * (exp(-gx * gx) * 1.5 * min(1.0, 0.0076 / gl) + exp(-max(rn - 1.0, 0.0) / 0.03) * 0.045 * outside) * uClosed;

  return mix(base, col, uWoundVis);
}

void main() {
  vec3 d = normalize(vDir);
  float px = max(length(dFdx(d)), length(dFdy(d)));

  // --- lensing around the Wound: background directions are pulled toward the disc (tangential arcs at the rim)
  float cw = dot(d, uWoundDir);
  float th = acos(clamp(cw, -1.0, 1.0));
  vec3 er = d - uWoundDir * cw;
  vec3 e = er / max(length(er), 1e-5);
  float rn = th / uWoundR;
  float defl = uWoundLens * uWoundVis * uWoundR / max(rn, 0.4) * (1.0 - smoothstep(1.4, 5.0, rn));
  float beta = th - defl;
  vec3 dl = uWoundDir * cos(beta) + e * sin(beta);
  float pxl = max(max(length(dFdx(dl)), length(dFdy(dl))), px);

  // --- deep space
  float up = clamp(d.y, 0.0, 1.0);
  vec3 col = mix(uHorizon, uZenith, pow(up, 0.55));
  // nothing behind the Wound's disc or under an opaque ground needs shading
  bool buried = uGround > 0.999 && d.y < -0.04;
  bool hidden = buried || (uWoundVis > 0.999 && rn < 0.97);
  if (!hidden) {
    if (uNebula > 0.01) col += nebula(dl) * uNebula;
    vec4 red = uRedVis > 0.002 ? redRemnant(dl, pxl) * uRedVis : vec4(0.0);
    if (uStars > 0.01) col += starField(dl, pxl) * uStars * (1.0 - red.a);
    col += red.rgb;
  }
  if (uWoundVis > 0.002 && !buried) col = woundComposite(col, d, th, e, px);

  // --- horizon haze, then whatever lies below the horizon
  vec3 hz = skyHaze(d);
  float band = exp(-max(d.y, 0.0) * uHazeFall) * uHazeAmt;
  // the atmosphere does not veil the Wound: it is an absence, not an object behind the haze
  float absence = (1.0 - smoothstep(0.985, 1.0, rn)) * uWoundVis * smoothstep(0.0, 0.09, d.y);
  col = mix(col, hz, band * (1.0 - 0.94 * absence));
  float below = smoothstep(0.0, -0.035, d.y) * uGround;
  col = mix(col, hz * mix(1.0, 0.35, smoothstep(0.0, -0.6, d.y)), below);

  // (its glare never reaches into the Wound: the disc stays exactly black)
  if (uWhiteVis > 0.002) col += whiteRemnant(d, px) * uWhiteVis * (1.0 - 0.6 * band) * (1.0 - below) * (1.0 - uWoundVis * (1.0 - smoothstep(0.97, 1.02, rn)));

  col = skyDither(col * uGain, gl_FragCoord.xy);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
