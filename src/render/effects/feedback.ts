/**
 * ScreenFeedbackEffect — pulse colours and the Eclipse corruption overlay.
 *
 * Runs in the main EffectPass after the grade and before the tone map (so its HDR colours roll off filmically).
 * Corruption: the frame edges warp (mainUv), drain toward violet-black, and thin violet veins creep inward
 * from the border, tapering to their tips, with pulses travelling along them. The centre of the frame — where
 * the player is reading the fight — always stays clean. Costs one uniform branch when idle.
 */
import { Uniform, Vector3 } from 'three';
import { BlendFunction, Effect } from 'postprocessing';
import type { FeedbackOutput } from '../feedback';

const frag = /* glsl */ `
uniform vec3 fbEdge;
uniform vec3 fbFlash;
uniform vec3 fbTint;
uniform float fbTintAmount;
uniform float fbDarken;
uniform float fbFrost;
uniform float fbCorruption;
uniform float fbDistort;
uniform float fbClock;
uniform float fbActive;

float fbHash(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.x + p.y) * p.z);
}

float fbNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = mix(mix(fbHash(i), fbHash(i + vec3(1.0, 0.0, 0.0)), f.x),
                mix(fbHash(i + vec3(0.0, 1.0, 0.0)), fbHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y);
  float b = mix(mix(fbHash(i + vec3(0.0, 0.0, 1.0)), fbHash(i + vec3(1.0, 0.0, 1.0)), f.x),
                mix(fbHash(i + vec3(0.0, 1.0, 1.0)), fbHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y);
  return mix(a, b, f.z);
}

// 0 on the frame border, 1 once a point is half a frame-height away from every border. Measured in pixels
// (aspect-corrected) so the band is equally wide on all four sides; a superellipse rounds the corners.
float fbInward(vec2 uv) {
  vec2 d = (0.5 - abs(uv - 0.5)) * vec2(aspect, 1.0) * 2.0;
  vec2 q = clamp(1.0 - d, 0.0, 1.0);
  vec2 q2 = q * q;
  vec2 q6 = q2 * q2 * q2;
  return max(0.0, 1.0 - pow(q6.x + q6.y, 1.0 / 6.0));
}

void mainUv(inout vec2 uv) {
  if (fbDistort > 0.001) {
    vec2 p = uv - 0.5;
    float inward = fbInward(uv);
    float edge = 1.0 - smoothstep(0.0, 0.08 + 0.3 * fbDistort, inward);
    float a = atan(p.y, p.x);
    float w = sin(a * 5.0 + fbClock * 1.3) * 0.6 + sin(a * 11.0 - fbClock * 0.8 + inward * 9.0) * 0.4;
    // breathing pull toward the centre plus a slow shiver, only near the border
    uv -= p * edge * edge * fbDistort * (0.03 + 0.022 * w);
  }
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = inputColor.rgb;
  if (fbActive > 0.5) {
    vec2 p = vUv - 0.5;
    float inward = fbInward(vUv);
    float rim = 1.0 - smoothstep(0.0, 0.5, inward);
    // concentrated on the border: half strength ~5 % of the frame height in, gone by ~15 %
    float rim2 = rim * rim;
    float edge = rim2 * rim2 * rim;
    float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));

    // --- pulses ---------------------------------------------------------------------------------------
    c = mix(c, lum * fbTint, fbTintAmount * edge);
    c *= 1.0 - fbDarken * edge;
    c += fbFlash;
    c += fbEdge * edge;

    if (fbFrost > 0.001) {
      // crystalline rim: fine needles growing in from the border
      float ang = atan(p.y, p.x);
      vec3 fp = vec3(cos(ang) * 24.0, sin(ang) * 24.0, inward * 5.0);
      float n = fbNoise(fp) * 0.65 + fbNoise(fp * vec3(2.3, 2.3, 3.0) + 11.0) * 0.35;
      float grow = 1.0 - smoothstep(0.0, 0.03 + 0.16 * fbFrost * n, inward);
      float needle = smoothstep(0.52, 0.8, n) * grow;
      c += vec3(0.5, 0.74, 0.95) * (needle * 0.3 + grow * grow * 0.05) * fbFrost;
    }

    // --- corruption -----------------------------------------------------------------------------------
    if (fbCorruption > 0.001) {
      float ang = atan(p.y, p.x);
      vec2 dir = vec2(cos(ang), sin(ang));
      // ragged front: how far the corruption has crept in at this angle
      float front = fbNoise(vec3(dir * 2.6, fbClock * 0.06));
      float reach = fbCorruption * (0.16 + 0.4 * front);
      float depth = clamp(inward / max(reach, 0.001), 0.0, 1.5);
      float mask = 1.0 - smoothstep(0.45, 1.0, depth);

      // Veins = contour lines of noise sampled on a cylinder around the frame and stretched along the inward
      // axis, so they run from the border toward the centre and meander. Dividing by the screen-space
      // gradient gives the distance to the contour in pixels: hairlines of constant width, never blobs.
      vec3 vp = vec3(dir * 9.0, inward * 1.7 - fbClock * 0.015);
      float bend = fbNoise(vp * vec3(0.5, 0.5, 1.3) + 3.1);
      float n1 = fbNoise(vp + vec3(0.0, 0.0, bend * 0.8));
      float n2 = fbNoise(vp * vec3(2.3, 2.3, 2.0) + 7.3);
      float px = resolution.y / 720.0;
      float d1 = abs(n1 - 0.5) / max(fwidth(n1), 1e-5);
      float d2 = abs(n2 - 0.5) / max(fwidth(n2), 1e-5);
      // thick where they enter the frame, hairline at the tips; only some sectors carry veins
      float taper = 1.0 - smoothstep(0.15, 1.0, depth);
      float sector = smoothstep(0.34, 0.56, fbNoise(vec3(dir * 3.3, 17.0)));
      float w1 = (0.7 + 2.0 * taper) * px;
      float core = (1.0 - smoothstep(w1 * 0.5, w1, d1)) * sector;
      float halo = (1.0 - smoothstep(w1, w1 * 7.0, d1)) * sector * 0.2;
      float twig = (1.0 - smoothstep(0.3 * px, 1.1 * px, d2)) * taper * 0.45 * (1.0 - smoothstep(8.0 * px, 30.0 * px, d1)) * sector;
      // pulses travelling inward along the veins
      float travel = 0.6 + 0.4 * sin(inward * 60.0 - fbClock * 2.4 + n2 * 6.0);

      // the edge loses colour and light, leaning violet-black
      vec3 drained = mix(vec3(lum), c, 0.4) * vec3(0.42, 0.3, 0.6);
      c = mix(c, drained, mask * (0.4 + 0.5 * fbCorruption));
      c *= 1.0 - 0.5 * mask * mask * fbCorruption;
      c += vec3(0.016, 0.003, 0.05) * mask * mask * fbCorruption;
      float k = mask * travel * (0.35 + 0.65 * fbCorruption);
      c += vec3(0.26, 0.07, 0.95) * (core + halo + twig) * k;
      c += vec3(0.55, 0.42, 0.9) * core * taper * k * 0.6;
    }
  }
  outputColor = vec4(max(c, vec3(0.0)), inputColor.a);
}`;

export class ScreenFeedbackEffect extends Effect {
  constructor() {
    super('ScreenFeedbackEffect', frag, {
      blendFunction: BlendFunction.SRC,
      uniforms: new Map<string, Uniform>([
        ['fbEdge', new Uniform(new Vector3())],
        ['fbFlash', new Uniform(new Vector3())],
        ['fbTint', new Uniform(new Vector3(1, 1, 1))],
        ['fbTintAmount', new Uniform(0)],
        ['fbDarken', new Uniform(0)],
        ['fbFrost', new Uniform(0)],
        ['fbCorruption', new Uniform(0)],
        ['fbDistort', new Uniform(0)],
        ['fbClock', new Uniform(0)],
        ['fbActive', new Uniform(0)],
      ]),
    });
  }

  /** Copy this frame's feedback state into the uniforms. */
  apply(o: FeedbackOutput): void {
    const u = this.uniforms;
    (u.get('fbEdge')!.value as Vector3).set(o.edge[0], o.edge[1], o.edge[2]);
    (u.get('fbFlash')!.value as Vector3).set(o.flash[0], o.flash[1], o.flash[2]);
    (u.get('fbTint')!.value as Vector3).set(o.tint[0], o.tint[1], o.tint[2]);
    u.get('fbTintAmount')!.value = o.tintAmount;
    u.get('fbDarken')!.value = o.darken;
    u.get('fbFrost')!.value = o.frost;
    u.get('fbCorruption')!.value = o.corruption;
    u.get('fbDistort')!.value = o.distort;
    u.get('fbClock')!.value = o.time;
    u.get('fbActive')!.value = o.active ? 1 : 0;
  }
}
