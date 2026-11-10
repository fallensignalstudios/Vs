/**
 * Shared GLSL chunks for the sky dome, the fleet battle layer and the scenic megastructure shaders.
 * Everything is procedural (no textures); hashes are sine-free so results match across GPUs.
 */

/** Hashes + 3D value noise + rotated fbm. */
export const GLSL_NOISE = /* glsl */ `
float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash31(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
vec3 hash33(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}
float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = mix(hash31(i), hash31(i + vec3(1.0, 0.0, 0.0)), f.x);
  float b = mix(hash31(i + vec3(0.0, 1.0, 0.0)), hash31(i + vec3(1.0, 1.0, 0.0)), f.x);
  float c = mix(hash31(i + vec3(0.0, 0.0, 1.0)), hash31(i + vec3(1.0, 0.0, 1.0)), f.x);
  float d = mix(hash31(i + vec3(0.0, 1.0, 1.0)), hash31(i + vec3(1.0, 1.0, 1.0)), f.x);
  return mix(mix(a, b, f.y), mix(c, d, f.y), f.z);
}
// octave rotation hides the value-noise lattice
const mat3 FBM_ROT = mat3(0.00, 0.80, 0.60, -0.80, 0.36, -0.48, -0.60, -0.48, 0.64);
float fbm3(vec3 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 3; i++) { s += a * vnoise(p); p = FBM_ROT * p * 2.03 + 17.1; a *= 0.5; }
  return s / 0.875;
}
float fbm5(vec3 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = FBM_ROT * p * 2.03 + 17.1; a *= 0.5; }
  return s / 0.96875;
}
// Rodrigues rotation of v about unit axis k
vec3 rotAxis(vec3 v, vec3 k, float a) {
  float c = cos(a), s = sin(a);
  return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c);
}
`;

/**
 * Atmospheric haze colour toward a view direction — shared by the dome's horizon band and every scenic
 * material so far geometry dissolves into exactly the colour the sky has behind it.
 * Requires uniforms: uHaze, uRedDir, uWhiteDir, uWoundDir, uHazeRed, uHazeWhite.
 */
export const GLSL_HAZE = /* glsl */ `
uniform vec3 uHaze;
uniform vec3 uHazeRed;
uniform vec3 uHazeWhite;
uniform vec3 uRedDir;
uniform vec3 uWhiteDir;
uniform vec3 uWoundDir;
vec3 skyHaze(vec3 d) {
  vec3 fd = normalize(vec3(d.x, d.y * 0.35, d.z));
  float lr = max(dot(fd, normalize(vec3(uRedDir.x, uRedDir.y * 0.35, uRedDir.z))), 0.0);
  float lw = max(dot(fd, normalize(vec3(uWhiteDir.x, uWhiteDir.y * 0.35, uWhiteDir.z))), 0.0);
  vec3 c = uHaze;
  c += uHazeRed * (lr * lr * lr * lr * lr * lr);
  c += uHazeWhite * pow(lw, 10.0);
  return c;
}
`;

/** Tiny hash dither to kill banding in dark gradients (amplitude ≈ half an 8-bit step after tone mapping). */
export const GLSL_DITHER = /* glsl */ `
vec3 skyDither(vec3 c, vec2 frag) {
  float n = hash21(frag) + hash21(frag + 57.31) - 1.0;
  return max(c + n * (0.0009 + 0.012 * c), 0.0);
}
`;
