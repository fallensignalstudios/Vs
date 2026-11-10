/**
 * ScreenFeedbackEffect — pulse colours and the Eclipse corruption overlay.
 *
 * Runs in the main EffectPass after the grade and before the tone map (so its HDR colours roll off filmically).
 * Corruption: the frame edges warp (mainUv), darken toward violet-black, and thin violet veins creep inward
 * from the border with pulses travelling along them. The centre of the frame — where the player is reading the
 * fight — always stays clean. Costs one uniform branch when idle.
 */
import { Uniform, Vector3 } from 'three';
import { BlendFunction, Effect } from 'postprocessing';
import type { FeedbackOutput } from '../feedback';

const frag = /* glsl */ `
uniform vec3 fbEdge;
uniform vec3 fbFlash;
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

// 0 at the frame border, growing inward; follows the rectangle with rounded corners
float fbInward(vec2 uv) {
  vec2 q = abs(uv - 0.5) * 2.0;
  float box = max(q.x, q.y);
  float rnd = length(q) * 0.7071;
  return 1.0 - mix(box, rnd, 0.45);
}

void mainUv(inout vec2 uv) {
  if (fbDistort > 0.001) {
    vec2 p = uv - 0.5;
    float inward = fbInward(uv);
    float edge = 1.0 - smoothstep(0.0, 0.1 + 0.3 * fbDistort, inward);
    float a = atan(p.y, p.x);
    float w = sin(a * 5.0 + fbClock * 1.3) * 0.6 + sin(a * 11.0 - fbClock * 0.8 + inward * 9.0) * 0.4;
    // breathing pull toward the centre plus a slow tangential shiver, only near the border
    uv -= p * edge * edge * fbDistort * (0.022 + 0.016 * w);
  }
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = inputColor.rgb;
  if (fbActive > 0.5) {
    vec2 p = vUv - 0.5;
    float inward = fbInward(vUv);
    float rim = 1.0 - smoothstep(0.0, 0.55, inward);
    float rim2 = rim * rim;

    // --- pulses ---------------------------------------------------------------------------------------
    c *= 1.0 - fbDarken * rim2;
    c += fbFlash;
    c += fbEdge * rim2 * (0.55 + 0.45 * rim);

    if (fbFrost > 0.001) {
      // crystalline rim: fine angular streaks growing in from the border
      float ang = atan(p.y, p.x);
      vec3 fp = vec3(cos(ang) * 9.0, sin(ang) * 9.0, inward * 26.0);
      float n = fbNoise(fp) * 0.6 + fbNoise(fp * 2.7 + 11.0) * 0.4;
      float crystal = smoothstep(0.45, 0.8, n) * (1.0 - smoothstep(0.0, 0.24 * fbFrost + 0.04, inward));
      c += vec3(0.55, 0.8, 1.0) * crystal * fbFrost * 0.7;
    }

    // --- corruption -----------------------------------------------------------------------------------
    if (fbCorruption > 0.001) {
      float ang = atan(p.y, p.x);
      // cylinder coordinates: seamless around the frame, stretched so features run inward
      vec3 cp = vec3(cos(ang) * 3.2, sin(ang) * 3.2, inward * 5.0 - fbClock * 0.035);
      float warp = fbNoise(cp * 1.7 + vec3(0.0, 0.0, fbClock * 0.05));
      // ragged front: how far the corruption has crept in at this angle
      float reach = fbCorruption * (0.2 + 0.26 * warp);
      float mask = 1.0 - smoothstep(reach * 0.35, reach, inward);

      if (mask > 0.001) {
        vec3 vp = vec3(cos(ang) * 7.5, sin(ang) * 7.5, inward * 9.0 + warp * 1.6);
        float n1 = fbNoise(vp);
        float n2 = fbNoise(vp * 2.3 + 5.2);
        // veins = thin ridges of the noise; a second octave branches them
        float ridge = 1.0 - abs(2.0 * (n1 * 0.68 + n2 * 0.32) - 1.0);
        float vein = pow(ridge, 14.0);
        float fine = pow(1.0 - abs(2.0 * n2 - 1.0), 22.0) * 0.5;
        // pulses travelling inward along the veins
        float travel = 0.55 + 0.45 * sin(inward * 46.0 - fbClock * 2.6 + warp * 9.0);
        float glow = (vein + fine * mask) * travel;

        // the edge loses colour and light, leaning violet-black
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        vec3 drained = mix(vec3(l), c, 0.45) * vec3(0.46, 0.36, 0.62);
        c = mix(c, drained, mask * (0.35 + 0.5 * fbCorruption));
        c += vec3(0.022, 0.005, 0.07) * mask * mask * fbCorruption;
        c += vec3(0.38, 0.1, 1.35) * glow * mask * (0.5 + 0.9 * fbCorruption);
        c += vec3(0.9, 0.7, 1.4) * pow(vein, 3.0) * mask * travel * fbCorruption * 0.6;
      }
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
    u.get('fbDarken')!.value = o.darken;
    u.get('fbFrost')!.value = o.frost;
    u.get('fbCorruption')!.value = o.corruption;
    u.get('fbDistort')!.value = o.distort;
    u.get('fbClock')!.value = o.time;
    u.get('fbActive')!.value = o.active ? 1 : 0;
  }
}
