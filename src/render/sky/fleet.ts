/**
 * Fleet silhouettes. Capital ships sit at infinity, so the direction they are seen from never changes: every
 * hull is baked once into a flat, back-face-culled, depth-sorted (painter's order) impostor mesh in its own
 * view frame. The whole fleet is ONE draw call with no depth interaction, correct self-occlusion, and it can
 * be re-aimed by the preset (battle direction / spread) with two uniforms.
 *
 * "Battle plane" coordinates: (u, v) in [-1, 1]² around the battle direction, scaled by the preset spread.
 * Dominion holds the left (u < 0), Reformation the right.
 */
import * as THREE from 'three';
import { mulberry32 } from '@/core/mathx';
import { GLSL_HAZE } from './glsl';
import { GeoBuilder } from './scenic/geo';
import { PartSink, buildHull, paletteFor, type ShipKind } from './scenic/hulls';
import type { SharedUniforms } from './shared';

export interface FleetShip {
  /** battle-plane position */
  u: number;
  v: number;
  faction: 0 | 1;
  /** length in battle-plane units */
  size: number;
  /** visible while preset fleet visibility > rank */
  rank: number;
  /** engine / running-light anchor points in battle-plane units relative to (u, v), with a visibility weight */
  lights: Array<{ x: number; y: number; w: number; engine: boolean }>;
}

const HULL_LENGTH = 660;
const ENGINES: Record<'dominionCapital' | 'reformationCapital', Array<[number, number, number]>> = {
  dominionCapital: [[38, -8, 349], [-38, -8, 349], [0, 12, 357]],
  reformationCapital: [[-17, 12, 341], [17, 12, 341], [-17, -12, 341], [17, -12, 341]],
};
const RUNNING: Record<'dominionCapital' | 'reformationCapital', Array<[number, number, number]>> = {
  dominionCapital: [[0, 206, 196], [0, -14, -312], [70, -6, 120], [-70, -6, 120]],
  reformationCapital: [[0, 96, 40], [0, 0, -398], [84, 0, -170], [-84, 0, -170], [160, 18, 150], [-160, 18, 150]],
};

export const FLEET_VERTEX = /* glsl */ `
uniform mat3 uFrame;
uniform float uSpread;
vec3 skyPoint(vec2 uv, vec2 local, out vec3 r, out vec3 u, out vec3 c) {
  c = normalize(uFrame[2] + (uFrame[0] * uv.x + uFrame[1] * uv.y) * uSpread);
  r = normalize(uFrame[0] - c * dot(uFrame[0], c));
  u = cross(r, c);
  return c + (r * local.x + u * local.y) * uSpread;
}
`;

const SHIP_VERTEX = /* glsl */ `
attribute vec2 aLocal;
attribute vec2 aCenter;
attribute vec3 aNormal;
attribute vec3 aColor;
attribute vec2 aMeta;
uniform float uFleet;
uniform vec3 uRedDir;
uniform vec3 uWhiteDir;
uniform vec3 uRedLight;
uniform vec3 uWhiteLight;
varying vec3 vCol;
varying vec3 vDir;
${FLEET_VERTEX}
void main() {
  float vis = smoothstep(aMeta.y, aMeta.y + 0.1, uFleet);
  vec3 r, u, c;
  vec3 dir = skyPoint(aCenter, aLocal * vis, r, u, c);
  vec3 lw = vec3(dot(uWhiteDir, r), dot(uWhiteDir, u), -dot(uWhiteDir, c));
  vec3 lr = vec3(dot(uRedDir, r), dot(uRedDir, u), -dot(uRedDir, c));
  // the remnants sit behind the fleets, so wrap their light around the hull and add a soft terminal-side fill
  float kw = clamp((dot(aNormal, lw) + 0.55) / 1.55, 0.0, 1.0);
  float kr = clamp((dot(aNormal, lr) + 0.55) / 1.55, 0.0, 1.0);
  kw *= kw; kr *= kr;
  float kf = 0.25 + 0.75 * max(aNormal.z, 0.0);
  float sky = 0.5 + 0.5 * aNormal.y;
  vec3 albedo = aColor * 1.5 + 0.012;
  vCol = albedo * (uWhiteLight * kw + uRedLight * kr + vec3(0.16, 0.17, 0.21) * kf * (0.55 + 0.45 * sky)) + aColor * aMeta.x;
  vDir = dir;
  vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * dir, 1.0);
  gl_Position = vec4(p.xy, 0.0, p.w);
}
`;

const SHIP_FRAGMENT = /* glsl */ `
precision highp float;
uniform float uHazeAmt;
uniform float uHazeFall;
varying vec3 vCol;
varying vec3 vDir;
${GLSL_HAZE}
void main() {
  vec3 d = normalize(vDir);
  float band = exp(-max(d.y, 0.0) * uHazeFall) * uHazeAmt;
  vec3 col = mix(vCol, skyHaze(d), band);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

interface RawHull { pos: readonly number[]; nrm: readonly number[]; col: readonly number[]; glow: readonly number[]; idx: readonly number[] }

function rawHull(kind: ShipKind): RawHull {
  const b = new GeoBuilder();
  buildHull(kind, PartSink.single(paletteFor(kind), b));
  return b.raw();
}

export interface Fleet {
  readonly mesh: THREE.Mesh;
  readonly ships: readonly FleetShip[];
  readonly uniforms: { uFrame: { value: THREE.Matrix3 }; uSpread: { value: number }; uFleet: { value: number }; uRedLight: { value: THREE.Color }; uWhiteLight: { value: THREE.Color } };
  dispose(): void;
}

/** Bake the two fleets. Deterministic for a given seed. */
export function createFleet(shared: SharedUniforms, seed = 7283): Fleet {
  const rand = mulberry32(seed);
  const hulls = { dominionCapital: rawHull('dominionCapital'), reformationCapital: rawHull('reformationCapital') };
  const ships: FleetShip[] = [];
  const aLocal: number[] = [], aCenter: number[] = [], aNormal: number[] = [], aColor: number[] = [], aMeta: number[] = [], index: number[] = [];
  const m = new THREE.Matrix4(), e = new THREE.Euler(), v = new THREE.Vector3(), n = new THREE.Vector3();
  const nm = new THREE.Matrix3();

  // layout: [u, v, size, rank]; large ships first so the line of battle reads even at low fleet visibility
  const layout: Array<[number, number, number, number]> = [];
  const perSide = 9;
  for (let side = 0; side < 2; side++) {
    const sgn = side === 0 ? -1 : 1;
    for (let i = 0; i < perSide; i++) {
      const big = i < 2, mid = i < 5;
      const size = big ? 0.17 + rand() * 0.04 : mid ? 0.09 + rand() * 0.03 : 0.045 + rand() * 0.018;
      const depth = big ? 0.26 + rand() * 0.2 : 0.2 + rand() * 0.8;
      const u = sgn * depth;
      const vv = (i / (perSide - 1) - 0.5) * 1.5 + (rand() - 0.5) * 0.22;
      layout.push([u, vv * (big ? 0.55 : 1), size, big ? rand() * 0.12 : mid ? 0.12 + rand() * 0.3 : 0.3 + rand() * 0.62]);
    }
  }
  // far ships first (small), near (large) last → painter's order between ships
  const order = layout.map((_, i) => i).sort((a, b) => layout[a][2] - layout[b][2]);

  for (const li of order) {
    const [u, vv, size, rank] = layout[li];
    const faction: 0 | 1 = u < 0 ? 0 : 1;
    const kind = faction === 0 ? 'dominionCapital' : 'reformationCapital';
    const hull = hulls[kind];
    // nose (−Z) toward the enemy, seen roughly broadside with some yaw toward / away from the viewer
    const yaw = (faction === 0 ? -1 : 1) * (Math.PI / 2 + (rand() - 0.5) * 1.1);
    e.set((rand() - 0.5) * 0.5, yaw, (rand() - 0.5) * 0.45, 'YXZ');
    const k = size / HULL_LENGTH;
    m.makeRotationFromEuler(e).scale(v.set(k, k, k));
    nm.setFromMatrix4(m);
    const base = aLocal.length / 2;
    const nv = hull.pos.length / 3;
    const zs = new Float32Array(nv);
    for (let i = 0; i < nv; i++) {
      v.set(hull.pos[i * 3], hull.pos[i * 3 + 1], hull.pos[i * 3 + 2]).applyMatrix4(m);
      n.set(hull.nrm[i * 3], hull.nrm[i * 3 + 1], hull.nrm[i * 3 + 2]).applyMatrix3(nm).normalize();
      zs[i] = v.z;
      aLocal.push(v.x, v.y);
      aCenter.push(u, vv);
      aNormal.push(n.x, n.y, n.z);
      aColor.push(hull.col[i * 3], hull.col[i * 3 + 1], hull.col[i * 3 + 2]);
      // thin light strips are sub-pixel at fleet scale (they would shimmer): keep engines, mute the rest;
      // running lights are drawn as size-clamped sprites instead
      aMeta.push(hull.glow[i] >= 5 ? hull.glow[i] : hull.glow[i] * 0.08, rank);
    }
    // cull faces pointing away from the viewer (+Z is toward the viewer), then sort far → near
    const tris: Array<{ z: number; a: number; b: number; c: number }> = [];
    for (let t = 0; t < hull.idx.length; t += 3) {
      const a = hull.idx[t], b = hull.idx[t + 1], c = hull.idx[t + 2];
      if (aNormal[(base + a) * 3 + 2] <= 0.02) continue;
      tris.push({ z: (zs[a] + zs[b] + zs[c]) / 3, a: base + a, b: base + b, c: base + c });
    }
    tris.sort((p, q) => p.z - q.z);
    for (const t of tris) index.push(t.a, t.b, t.c);

    const lights: FleetShip['lights'] = [];
    for (const [x, y, z] of ENGINES[kind]) {
      v.set(x, y, z).applyMatrix4(m);
      n.set(0, 0, 1).applyMatrix3(nm).normalize();
      lights.push({ x: v.x, y: v.y, w: Math.max(0.12, n.z), engine: true });
    }
    for (const [x, y, z] of RUNNING[kind]) {
      v.set(x, y, z).applyMatrix4(m);
      lights.push({ x: v.x, y: v.y, w: 1, engine: false });
    }
    ships.push({ u, v: vv, faction, size, rank, lights });
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('aLocal', new THREE.Float32BufferAttribute(aLocal, 2));
  geometry.setAttribute('aCenter', new THREE.Float32BufferAttribute(aCenter, 2));
  geometry.setAttribute('aNormal', new THREE.Float32BufferAttribute(aNormal, 3));
  geometry.setAttribute('aColor', new THREE.Float32BufferAttribute(aColor, 3));
  geometry.setAttribute('aMeta', new THREE.Float32BufferAttribute(aMeta, 2));
  geometry.setIndex(new THREE.Uint32BufferAttribute(index, 1));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);

  const uniforms = {
    uFrame: { value: new THREE.Matrix3() },
    uSpread: { value: 0.5 },
    uFleet: { value: 0 },
    uRedLight: { value: new THREE.Color(1.5, 0.26, 0.12) },
    uWhiteLight: { value: new THREE.Color(2.2, 2.45, 2.8) },
  };
  const material = new THREE.ShaderMaterial({
    name: 'SkyFleet',
    uniforms: {
      ...uniforms,
      uRedDir: shared.uRedDir, uWhiteDir: shared.uWhiteDir, uWoundDir: shared.uWoundDir,
      uHaze: shared.uHaze, uHazeRed: shared.uHazeRed, uHazeWhite: shared.uHazeWhite,
      uHazeAmt: shared.uHazeAmt, uHazeFall: shared.uHazeFall,
    },
    vertexShader: SHIP_VERTEX,
    fragmentShader: SHIP_FRAGMENT,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'sky:fleet';
  mesh.frustumCulled = false;
  mesh.renderOrder = -990;
  mesh.matrixAutoUpdate = false;

  return {
    mesh, ships, uniforms,
    dispose() { geometry.dispose(); material.dispose(); },
  };
}

const _c = new THREE.Vector3();
const _r = new THREE.Vector3();
const _u = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const ALT = new THREE.Vector3(0, 0, -1);

/** Battle frame: columns right, up, centre for a battle direction. */
export function battleFrame(dir: THREE.Vector3, out: THREE.Matrix3): THREE.Matrix3 {
  _c.copy(dir).normalize();
  _r.crossVectors(_c, Math.abs(_c.y) > 0.985 ? ALT : UP).normalize();
  _u.crossVectors(_r, _c).normalize();
  return out.set(_r.x, _u.x, _c.x, _r.y, _u.y, _c.y, _r.z, _u.z, _c.z);
}

/** World direction → battle-plane (u, v); returns false when the direction is behind the battle plane. */
export function battlePlaneCoords(frame: THREE.Matrix3, spread: number, dir: THREE.Vector3, out: { u: number; v: number }): boolean {
  const e = frame.elements;
  const x = dir.x * e[0] + dir.y * e[1] + dir.z * e[2];
  const y = dir.x * e[3] + dir.y * e[4] + dir.z * e[5];
  const z = dir.x * e[6] + dir.y * e[7] + dir.z * e[8];
  if (z < 0.15 || spread <= 1e-4) return false;
  out.u = x / z / spread;
  out.v = y / z / spread;
  return true;
}
