/**
 * GLSL for the four particle layers. One vertex shader (billboard / ground / upright / velocity-stretched via
 * defines) and one fragment shader (additive / premultiplied alpha / lit-soft via defines).
 * Instance layout (16 floats): iPosSize(xyz,size) iColor(rgb HDR, alpha) iMisc(rot, frame, aspect|length, facing)
 * iVel(velocity xyz | glow, floorY).
 */

export const PARTICLE_VERT = /* glsl */ `
attribute vec4 iPosSize;
attribute vec4 iColor;
attribute vec4 iMisc;
attribute vec4 iVel;
uniform vec2 uGrid;
varying vec2 vUv;
varying vec2 vQuad;
varying vec4 vColor;
varying vec3 vWorld;
varying vec3 vCenter;
varying vec3 vFloor; // floorY, fade distance, glow
varying float vViewZ;
#include <common>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>

void main() {
  vec3 center = iPosSize.xyz;
  float size = iPosSize.w;
  vec2 corner = position.xy;
  vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 world;
#ifdef STRETCH
  vec3 vv = (viewMatrix * vec4(iVel.xyz, 0.0)).xyz;
  float l2 = length(vv.xy);
  vec2 dir = l2 > 1e-5 ? vv.xy / l2 : vec2(0.0, 1.0);
  float fore = l2 / max(length(vv), 1e-5);
  float len = max(size * 1.6, iMisc.z * fore);
  vec2 q = dir * (corner.y - 0.42) * len + vec2(-dir.y, dir.x) * corner.x * size;
  world = center + camRight * q.x + camUp * q.y;
#else
  float cr = cos(iMisc.x), sr = sin(iMisc.x);
  vec2 q = vec2(corner.x, corner.y * iMisc.z);
  q = vec2(cr * q.x - sr * q.y, sr * q.x + cr * q.y) * size;
  if (iMisc.w < 0.5) {
    world = center + camRight * q.x + camUp * q.y;
  } else if (iMisc.w < 1.5) {
    world = center + vec3(q.x, 0.0, -q.y);
  } else {
    vec3 level = vec3(camRight.x, 0.0, camRight.z);
    world = center + normalize(level + vec3(1e-5, 0.0, 0.0)) * q.x + vec3(0.0, q.y, 0.0);
  }
#endif
  vec4 mvPosition = viewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  float frame = floor(iMisc.y + 0.5);
  vec2 cell = vec2(mod(frame, uGrid.x), floor(frame / uGrid.x));
  vUv = (cell + uv) / uGrid;
  vQuad = corner;
  vColor = iColor;
  vWorld = world;
  vCenter = center;
#ifdef STRETCH
  vFloor = vec3(-1.0e6, 1.0, 0.0);
#else
  vFloor = vec3(iVel.w, clamp(size * 0.3, 0.04, 0.6), iVel.x);
#endif
  vViewZ = mvPosition.z;
  #include <logdepthbuf_vertex>
  #include <fog_vertex>
}
`;

export const PARTICLE_FRAG = /* glsl */ `
uniform sampler2D uAtlas;
varying vec2 vUv;
varying vec2 vQuad;
varying vec4 vColor;
varying vec3 vWorld;
varying vec3 vCenter;
varying vec3 vFloor;
varying float vViewZ;
#ifdef LIT
uniform vec3 uAmbient;
uniform vec3 uKeyDir;
uniform vec3 uKeyColor;
uniform vec4 uFlashPos[4];
uniform vec3 uFlashColor[4];
#endif
#ifdef SOFT_DEPTH
uniform sampler2D uDepth;
uniform vec2 uResolution;
uniform vec2 uNearFar;
#endif
#include <common>
#include <packing>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>

void main() {
  #include <logdepthbuf_fragment>
  vec4 tex = texture2D(uAtlas, vUv);
  float soft = vFloor.x > -1.0e5 ? smoothstep(0.0, vFloor.y, vWorld.y - vFloor.x) : 1.0;
#ifdef SOFT_DEPTH
  float sceneZ = perspectiveDepthToViewZ(texture2D(uDepth, gl_FragCoord.xy / uResolution).x, uNearFar.x, uNearFar.y);
  soft *= clamp((vViewZ - sceneZ) / max(vFloor.y * 1.5, 0.08), 0.0, 1.0);
#endif
  float a = tex.a * vColor.a * soft;
  if (a < 0.0015) discard;
  vec3 col = vColor.rgb * tex.rgb;
#ifdef LIT
  vec2 p = vQuad * 2.0;
  vec3 n = normalize(vec3(p, sqrt(max(0.0, 1.0 - dot(p, p))) + 0.4));
  vec3 keyV = normalize((viewMatrix * vec4(uKeyDir, 0.0)).xyz);
  float nl = dot(n, keyV) * 0.5 + 0.5;
  vec3 light = uAmbient + uKeyColor * nl * nl;
  for (int i = 0; i < 4; i++) {
    vec3 d = uFlashPos[i].xyz - vCenter;
    float d2 = dot(d, d);
    float w = clamp(1.0 - d2 / (uFlashPos[i].w * uFlashPos[i].w + 1e-4), 0.0, 1.0);
    light += uFlashColor[i] * (w * w / (1.0 + d2));
  }
  float heat = vFloor.z;
  col = col * light + vColor.rgb * tex.rgb * heat;
#endif
  float fogFactor = 0.0;
#ifdef USE_FOG
  #ifdef FOG_EXP2
    fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
  #else
    fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
  #endif
#endif
#ifdef ADDITIVE
  gl_FragColor = vec4(col * a * (1.0 - fogFactor), 1.0);
#else
  #ifdef USE_FOG
    col = mix(col, fogColor, fogFactor * 0.85);
  #endif
  gl_FragColor = vec4(col * a, a);
#endif
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
