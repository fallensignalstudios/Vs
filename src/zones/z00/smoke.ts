/**
 * Z00 — slow smoke columns over the crash site (the VFX library has impact smoke but no lasting column).
 * One instanced billboard mesh per column: puffs rise from the base, widen, drift with a light wind and fade;
 * every puff loops on its own phase, so the column never pulses. Shaded dark with a warm under-glow near the
 * base (the fires below) and fogged like the scene. All motion runs on the sim clock passed to `update`.
 */
import * as THREE from 'three';

export interface SmokeColumnOpts {
  /** puffs in the column (default 26) */
  count?: number;
  /** height the column rises to (m, default 26) */
  height?: number;
  /** puff size at the base / at the top (m) */
  size0?: number;
  size1?: number;
  /** horizontal drift at the top (world x, z metres) */
  wind?: [number, number];
  /** seconds for one puff to rise the whole column (default 22) */
  life?: number;
  /** 0..1 peak opacity (default 0.5) */
  opacity?: number;
  /** linear colour of the smoke body and of the fire glow at its base */
  color?: number;
  glow?: number;
  seed?: number;
}

export interface SmokeColumn {
  readonly object: THREE.Mesh;
  update(time: number): void;
  dispose(): void;
}

const VERT = /* glsl */ `
  attribute vec4 aPuff; // x: phase 0..1, y: lateral seed, z: size jitter, w: spin seed
  uniform float uTime, uLife, uHeight, uSize0, uSize1;
  uniform vec2 uWind;
  varying vec2 vUv;
  varying float vAge;
  varying float vSeed;
  #include <fog_pars_vertex>
  void main() {
    float age = fract(aPuff.x + uTime / uLife);
    vAge = age;
    vSeed = aPuff.w;
    float rise = pow(age, 0.82) * uHeight;
    float lat = (aPuff.y - 0.5) * (0.8 + age * 3.5);
    vec3 centre = vec3(uWind.x * age * age + lat, rise, uWind.y * age * age + lat * 0.6);
    float size = mix(uSize0, uSize1, pow(age, 0.7)) * (0.75 + aPuff.z * 0.5);
    float a = aPuff.w * 6.2831 + uTime * (aPuff.w - 0.5) * 0.12;
    vec2 corner = mat2(cos(a), -sin(a), sin(a), cos(a)) * position.xy;
    vec4 mvPosition = modelViewMatrix * vec4(centre, 1.0);
    mvPosition.xy += corner * size;
    vUv = position.xy + 0.5;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const FRAG = /* glsl */ `
  uniform vec3 uColor, uGlow;
  uniform float uOpacity;
  varying vec2 vUv;
  varying float vAge;
  varying float vSeed;
  #include <fog_pars_fragment>
  float hash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  void main() {
    vec2 p = vUv - 0.5;
    float r = length(p) * 2.0;
    float n = noise(vUv * 3.1 + vSeed * 17.0) * 0.6 + noise(vUv * 7.3 - vSeed * 9.0) * 0.4;
    float body = smoothstep(1.0, 0.25, r + (n - 0.5) * 0.55);
    float life = smoothstep(0.0, 0.12, vAge) * (1.0 - smoothstep(0.55, 1.0, vAge));
    float alpha = body * life * uOpacity;
    if (alpha < 0.004) discard;
    vec3 col = mix(uGlow, uColor, smoothstep(0.0, 0.28, vAge)) * (0.7 + n * 0.5);
    gl_FragColor = vec4(col, alpha);
    #include <fog_fragment>
  }
`;

/** Build one smoke column; position `object` at its base in world space and call `update(simTime)` per frame. */
export function smokeColumn(o: SmokeColumnOpts = {}): SmokeColumn {
  const count = Math.max(4, Math.min(64, Math.round(o.count ?? 26)));
  let s = (o.seed ?? 7) * 9301 + 49297;
  const rnd = (): number => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  const quad = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index;
  geo.setAttribute('position', quad.getAttribute('position'));
  const puff = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    puff[i * 4] = (i + rnd() * 0.6) / count;
    puff[i * 4 + 1] = rnd();
    puff[i * 4 + 2] = rnd();
    puff[i * 4 + 3] = rnd();
  }
  geo.setAttribute('aPuff', new THREE.InstancedBufferAttribute(puff, 4));
  geo.instanceCount = count;
  const height = o.height ?? 26;
  const wind = o.wind ?? [6, -2];
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(wind[0] * 0.5, height * 0.5, wind[1] * 0.5), height * 0.75 + (o.size1 ?? 14));
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uLife: { value: o.life ?? 22 },
        uHeight: { value: height },
        uSize0: { value: o.size0 ?? 3.5 },
        uSize1: { value: o.size1 ?? 14 },
        uWind: { value: new THREE.Vector2(wind[0], wind[1]) },
        uOpacity: { value: o.opacity ?? 0.6 },
        uColor: { value: new THREE.Color(o.color ?? 0x6a5d52) },
        uGlow: { value: new THREE.Color(o.glow ?? 0xe0782e) },
      },
    ]),
    transparent: true,
    depthWrite: false,
    fog: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'z00-smoke';
  mesh.renderOrder = 2;
  mesh.frustumCulled = true;
  return {
    object: mesh,
    update(time: number): void {
      if (Number.isFinite(time)) mat.uniforms.uTime.value = time;
    },
    dispose(): void {
      geo.dispose();
      quad.dispose();
      mat.dispose();
      mesh.removeFromParent();
    },
  };
}
