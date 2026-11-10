/**
 * Sky dome shader: deep-space gradient, stable star field, nebula, the red remnant, the white remnant and
 * the Wound (true-black disc with lensing, orbiting debris and restrained violet movement).
 *
 * The vertex stage ignores camera translation, so the dome sits at infinity for ANY camera (main view, planar
 * reflection camera, PMREM cube faces) without having to follow anything on the CPU.
 */
import { GLSL_DITHER, GLSL_HAZE, GLSL_NOISE } from './glsl';

export const DOME_VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
  gl_Position = vec4(p.xy, 0.0, p.w);
}
`;

export const DOME_FRAGMENT = /* glsl */ `
precision highp float;
varying vec3 vDir;

uniform float uTime;
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

// ---------------------------------------------------------------------------------------------------------
// Stars: one jittered star per 3D lattice cell that the unit sphere passes through. Radius is clamped to the
// pixel footprint (energy conserving) so stars never shimmer when the camera turns; nothing depends on time.
// ---------------------------------------------------------------------------------------------------------
vec3 starLayer(vec3 d, float n, float px, float seed, float occupancy, float r0, float gamma) {
  vec3 c = floor(d * n);
  vec3 h = hash33(c + seed);
  if (h.x > occupancy) return vec3(0.0);
  vec3 q = c + 0.5 + (hash33(c + seed + 19.7) - 0.5) * 0.7;
  vec3 sd = normalize(q);
  vec3 sp = sd * n - c - 0.5;
  float edge = 0.5 - max(abs(sp.x), max(abs(sp.y), abs(sp.z)));
  float r = max(r0, px * 1.15);
  float w = clamp((edge - 2.3 * r * n) * 12.0, 0.0, 1.0);
  if (w <= 0.0) return vec3(0.0);
  vec3 dv = d - sd;
  float i = exp(-dot(dv, dv) / (r * r)) * (r0 * r0) / (r * r);
  float mag = pow(h.y, gamma);
  vec3 warm = vec3(1.0, 0.80, 0.58), cool = vec3(0.66, 0.80, 1.0);
  vec3 tint = mix(mix(warm, vec3(1.0), smoothstep(0.0, 0.45, h.z)), cool, smoothstep(0.55, 1.0, h.z));
  return tint * (i * mag * w);
}

vec3 starField(vec3 d, float px) {
  vec3 s = vec3(0.0);
  s += starLayer(d, 86.0, px, 3.0, 0.50, 0.00050, 6.0) * 7.0;
  s += starLayer(d, 47.0, px, 11.0, 0.42, 0.00062, 5.0) * 9.0;
  s += starLayer(d, 23.0, px, 23.0, 0.30, 0.00085, 4.0) * 11.0;
  // a few bright stars with a soft glare
  vec3 c = floor(d * 7.0);
  vec3 h = hash33(c + 71.0);
  if (h.x < 0.20) {
    vec3 sd = normalize(c + 0.5 + (hash33(c + 90.7) - 0.5) * 0.5);
    vec3 sp = sd * 7.0 - c - 0.5;
    float edge = 0.5 - max(abs(sp.x), max(abs(sp.y), abs(sp.z)));
    float w = clamp((edge - 0.16) * 10.0, 0.0, 1.0);
    vec3 dv = d - sd;
    float a2 = dot(dv, dv);
    float r = max(0.0011, px * 1.2);
    float core = exp(-a2 / (r * r)) * (0.0011 * 0.0011) / (r * r) * 14.0;
    float glare = 0.0000016 / (a2 + 0.00003) * exp(-a2 / 0.00035);
    vec3 tint = mix(vec3(1.0, 0.86, 0.70), vec3(0.74, 0.86, 1.0), h.z);
    s += tint * (core + glare) * (0.35 + 0.65 * h.y) * w;
  }
  return s;
}

vec3 nebula(vec3 d) {
  vec3 p = d * 1.9;
  vec3 w = vec3(vnoise(p * 1.3 + 3.1), vnoise(p * 1.3 + 41.7), vnoise(p * 1.3 + 77.3)) - 0.5;
  float n = fbm5(p + w * 1.5);
  float m = smoothstep(0.40, 0.82, n);
  float n2 = fbm3(p * 2.9 - w * 1.2 + 9.0);
  vec3 c = mix(vec3(0.030, 0.036, 0.062), vec3(0.070, 0.056, 0.086), n2);
  c *= m * m * (0.3 + 0.7 * smoothstep(0.28, 0.72, n2));
  return c;
}

// ---------------------------------------------------------------------------------------------------------
// Red remnant: a dying shell — turbulent sphere with an HDR limb, corona, and a billowing nebula mass.
// ---------------------------------------------------------------------------------------------------------
// rgb = emitted light, a = how much of the star field behind it is hidden
vec4 redRemnant(vec3 d, float px) {
  float cr = dot(d, uRedDir);
  float ang = acos(clamp(cr, -1.0, 1.0));
  float r = ang / uRedR;
  if (r > 8.5) return vec4(0.0);
  // which way is the Wound from here: the mass and the bright limb lean toward it (being drawn in)
  vec3 er = d - uRedDir * cr;
  vec3 en = er / max(length(er), 1e-5);
  vec3 tw = uWoundDir - uRedDir * dot(uWoundDir, uRedDir);
  float side = dot(en, tw / max(length(tw), 1e-4));

  float f = 1.1 / uRedR;
  vec3 q = d * f + vec3(0.0, uTime * 0.003, 0.0);
  vec3 w = vec3(vnoise(q * 0.55 + 11.0), vnoise(q * 0.55 + 37.0), vnoise(q * 0.55 + 71.0)) - 0.5;
  float n1 = fbm5(q + w * 2.4);
  float billow = 1.0 - abs(2.0 * fbm3(q * 1.9 - w * 1.7 + 5.0) - 1.0);
  float fall = exp(-max(r - 0.9, 0.0) * (0.34 - 0.10 * max(side, 0.0))) * (1.0 - smoothstep(4.0, 8.5, r));
  float dens = smoothstep(0.47 - 0.22 * fall, 0.80 - 0.18 * fall, n1 * 0.75 + billow * 0.25) * fall;
  float heat = dens * (0.3 + 0.7 * billow) * fall;
  vec3 col = mix(vec3(0.10, 0.004, 0.004), vec3(0.50, 0.024, 0.012), smoothstep(0.05, 0.5, heat));
  col = mix(col, vec3(1.5, 0.14, 0.04), smoothstep(0.5, 1.0, heat) * 0.85);
  col *= dens * (0.3 + 0.7 * billow) * 0.85;
  // dark dust lanes cut through the mass
  col *= 0.30 + 0.70 * smoothstep(0.30, 0.56, fbm3(q * 0.9 + w + 31.0));
  // inner corona
  col += vec3(1.2, 0.085, 0.03) * exp(-max(r - 1.0, 0.0) * 2.8) * 0.22 * (0.5 + n1);
  // the sphere itself: banded plasma, bright veins, an HDR limb leaning toward the Wound
  float aa = max(px / uRedR, 0.004);
  float disc = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, r);
  if (disc > 0.0) {
    float z = sqrt(max(1.0 - r * r, 0.0));
    vec3 sq = d * (f * 2.6) + w * 2.6 + vec3(uTime * 0.005, 0.0, 0.0);
    float pl = fbm5(sq);
    float veins = pow(1.0 - abs(2.0 * fbm3(sq * 2.1 + pl * 2.0) - 1.0), 4.0);
    float limb = pow(1.0 - z, 3.0);
    vec3 surf = mix(vec3(0.035, 0.0015, 0.0015), vec3(0.42, 0.020, 0.008), smoothstep(0.25, 0.8, pl));
    surf += vec3(1.25, 0.085, 0.022) * veins * smoothstep(0.35, 0.8, pl);
    surf += vec3(2.8, 0.26, 0.05) * limb * (0.25 + 0.75 * smoothstep(-0.4, 0.9, side));
    col = mix(col, surf + col * 0.25, disc);
  }
  return vec4(col, max(disc, min(dens * 1.1, 0.8)));
}

// ---------------------------------------------------------------------------------------------------------
// White remnant: small, hard, very bright, with a clean glare (no noise anywhere near it).
// ---------------------------------------------------------------------------------------------------------
vec3 whiteRemnant(vec3 d, float px) {
  vec3 dv = d - uWhiteDir;
  float a2 = dot(dv, dv);
  float ang = sqrt(a2);
  float r0 = max(uWhiteR, px * 1.25);
  float comp = (uWhiteR * uWhiteR) / (r0 * r0);
  float core = (1.0 - smoothstep(r0 * 0.82, r0 * 1.12, ang)) * 22.0 * max(comp, 0.25);
  float glare = 0.9 * pow(uWhiteR / (ang + uWhiteR), 2.6) + 0.022 * pow(uWhiteR / (ang + uWhiteR), 1.2);
  // hairline anamorphic streak + faint vertical counterpart
  vec3 up = vec3(0.0, 1.0, 0.0);
  vec3 rt = normalize(cross(up, uWhiteDir));
  vec3 vt = cross(uWhiteDir, rt);
  float u = dot(dv, rt), v = dot(dv, vt);
  float lw = max(uWhiteR * 0.22, px * 0.9);
  float streak = exp(-abs(v) / lw) * exp(-abs(u) / (uWhiteR * 16.0)) * 0.30;
  streak += exp(-abs(u) / lw) * exp(-abs(v) / (uWhiteR * 6.0)) * 0.12;
  return vec3(0.80, 0.90, 1.0) * (core + glare + streak);
}

// ---------------------------------------------------------------------------------------------------------
// The Wound.
// ---------------------------------------------------------------------------------------------------------
float debrisField(vec3 p, float seed) {
  return 0.58 * vnoise(p + seed) + 0.30 * vnoise(p * 2.6 + seed * 1.7) + 0.12 * vnoise(p * 6.1 + seed * 0.3);
}

vec3 woundComposite(vec3 col, vec3 d, float th, vec3 e, float px) {
  float R = uWoundR;
  float rn = th / R;
  if (rn > 4.6) return col;
  vec3 W = uWoundDir;
  float pxn = px / R;
  vec3 base = col;
  float outside = smoothstep(1.0 - pxn, 1.0 + pxn, rn);

  vec3 tr = uRedDir - W * dot(uRedDir, W);
  vec3 tw = uWhiteDir - W * dot(uWhiteDir, W);
  vec3 toRed = tr / max(length(tr), 1e-4);
  vec3 toWhite = tw / max(length(tw), 1e-4);
  float sr = max(dot(e, toRed), 0.0);
  float sw = max(dot(e, toWhite), 0.0);

  // --- swirled dust halo, lit faintly from each remnant's side
  float twist = 1.7 * log(max(rn, 0.35));
  vec3 q = rotAxis(d, W, twist + uTime * 0.0045);
  float fq = 3.0 / R;
  float dust = fbm5(q * fq + W * (uTime * 0.012));
  float ring = exp(-pow(max(rn - 1.0, 0.0) / 0.62, 1.25));
  float halo = ring * smoothstep(0.28, 0.80, dust) * uWoundHalo * outside;
  vec3 haloCol = vec3(0.034, 0.030, 0.050) + vec3(0.110, 0.016, 0.010) * sr * sr + vec3(0.040, 0.048, 0.062) * sw * sw;
  col += haloCol * halo * 2.4;

  // --- violet: thin filaments riding the swirl, alive only in a few drifting arcs, slow swell (never a strobe)
  float settle = 1.0 - 0.88 * uClosed;
  float act = uActivity * settle;
  float v1 = vnoise(q * fq * 1.6 + vec3(0.0, uTime * 0.045, 3.0));
  float v2 = vnoise(q * fq * 3.7 + vec3(7.0, -uTime * 0.06, 0.0));
  float ridge = 1.0 - abs(2.0 * (0.64 * v1 + 0.36 * v2) - 1.0);
  float fil = pow(ridge, 16.0);
  float gate = smoothstep(0.50, 0.78, vnoise(q * (1.3 / R) + vec3(uTime * 0.028, 0.0, uTime * 0.019)));
  float swell = 0.55 + 0.45 * sin(uTime * 0.6 + 6.2832 * vnoise(q * (0.9 / R) + 4.0));
  float band = smoothstep(0.80, 1.0, rn) * exp(-max(rn - 1.0, 0.0) / 0.34);
  vec3 violet = vec3(0.50, 0.20, 1.0) * fil * gate * swell * band * act * 2.6;
  violet += vec3(0.12, 0.035, 0.30) * gate * band * dust * act * 0.42;
  col += violet * outside;

  // --- behind the boundary: movement that fades to true black toward the core
  float depth = smoothstep(0.42, 1.0, rn);
  vec3 qi = rotAxis(d, W, -uTime * 0.010 - 2.4 * rn);
  float m = fbm3(qi * (2.2 / R) + W * (uTime * 0.018));
  float veil = smoothstep(0.50, 0.86, m) * depth * depth;
  vec3 inner = vec3(0.085, 0.028, 0.22) * veil * act * 0.42;
  float surge = vnoise(qi * (1.1 / R) + vec3(uTime * 0.11, 3.0, -uTime * 0.07));
  inner += vec3(0.30, 0.11, 0.80) * pow(max(surge - 0.70, 0.0) / 0.30, 2.0) * veil * act * 0.5;
  col = mix(inner, col, outside);

  // --- the boundary itself: a hairline of light bent around the rim, brightest toward each remnant
  float lw = max(0.0045, 1.15 * pxn);
  float x = (rn - 1.0 - lw) / lw;
  float line = exp(-x * x) * min(1.0, 0.0045 / lw * 2.0);
  vec3 bent = vec3(0.50, 0.56, 0.74) * (0.035 + 0.30 * pow(sw, 6.0)) + vec3(0.9, 0.10, 0.04) * 0.22 * pow(sr, 6.0);
  col += bent * line * (1.0 - uClosed);

  // --- orbiting dark debris: three bands at different angular speeds (inner faster) → differential motion
  float stream = pow(sr, 5.0);
  float occ = 0.0;
  float lit = 0.0;
  {
    // ragged mass hugging the rim
    vec3 p = rotAxis(d, W, uTime * 0.0060 + 0.6) * (5.2 / R);
    float n = debrisField(p, 1.7);
    float thr = mix(0.36, 0.80, smoothstep(0.92, 1.75 + 0.5 * stream, rn));
    float aa = clamp(5.2 / R * px * 1.4, 0.02, 0.3);
    float w = smoothstep(0.80, 0.94, rn) * (1.0 - uClosed * (1.0 - smoothstep(1.10, 1.55, rn)));
    float mk = w * smoothstep(thr - aa, thr + aa, n);
    float n2 = debrisField(p + toWhite * 0.22, 1.7);
    lit += mk * clamp((n - n2) * 5.0, 0.0, 1.0) * (1.0 - smoothstep(thr + 0.02, thr + 0.16, n));
    occ = max(occ, mk);
  }
  {
    // mid chunks
    vec3 p = rotAxis(d, W, uTime * 0.0038 + 2.1) * (11.5 / R);
    float n = debrisField(p, 9.2);
    float thr = mix(0.60, 0.84, smoothstep(1.0, 2.3 + 0.4 * stream, rn)) - 0.05 * stream;
    float aa = clamp(11.5 / R * px * 1.4, 0.02, 0.3);
    float w = smoothstep(0.95 + 0.12 * uClosed, 1.12 + 0.16 * uClosed, rn) * (1.0 - smoothstep(2.0 + 0.3 * stream, 2.6 + 0.3 * stream, rn));
    float mk = w * smoothstep(thr - aa, thr + aa, n);
    float n2 = debrisField(p + toWhite * 0.25, 9.2);
    lit += mk * clamp((n - n2) * 5.0, 0.0, 1.0) * (1.0 - smoothstep(thr + 0.02, thr + 0.14, n));
    occ = max(occ, mk);
  }
  {
    // far flecks
    vec3 p = rotAxis(d, W, uTime * 0.0022 + 4.4) * (25.0 / R);
    float n = debrisField(p, 23.9);
    float thr = mix(0.70, 0.88, smoothstep(1.2, 2.8 + 0.3 * stream, rn)) - 0.04 * stream;
    float aa = clamp(25.0 / R * px * 1.4, 0.02, 0.3);
    float w = smoothstep(1.05, 1.3, rn) * (1.0 - smoothstep(2.2 - 0.5 * stream, 3.0 - 1.0 * stream, rn));
    occ = max(occ, w * smoothstep(thr - aa, thr + aa, n));
  }
  occ *= uWoundDebris;
  col *= 1.0 - occ;
  col += vec3(0.11, 0.125, 0.15) * lit * uWoundDebris * (0.25 + 0.75 * sw) * 0.5;

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
  col += nebula(dl) * uNebula;
  vec4 red = uRedVis > 0.002 ? redRemnant(dl, pxl) * uRedVis : vec4(0.0);
  col += starField(dl, pxl) * uStars * (1.0 - red.a);
  col += red.rgb;
  if (uWoundVis > 0.002) col = woundComposite(col, d, th, e, px);

  // --- horizon haze, then whatever lies below the horizon
  vec3 hz = skyHaze(d);
  float band = exp(-max(d.y, 0.0) * uHazeFall) * uHazeAmt;
  // the atmosphere does not veil the Wound: it is an absence, not an object behind the haze
  float absence = (1.0 - smoothstep(0.985, 1.0, rn)) * uWoundVis * smoothstep(0.0, 0.09, d.y);
  col = mix(col, hz, band * (1.0 - 0.94 * absence));
  float below = smoothstep(0.0, -0.035, d.y) * uGround;
  col = mix(col, hz * mix(1.0, 0.35, smoothstep(0.0, -0.6, d.y)), below);

  if (uWhiteVis > 0.002) col += whiteRemnant(d, px) * uWhiteVis * (1.0 - 0.6 * band) * (1.0 - below);

  col = skyDither(col * uGain, gl_FragCoord.xy);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
