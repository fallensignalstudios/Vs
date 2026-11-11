/**
 * Fleet battle: baked capital silhouettes + one instanced additive draw for everything that glows — steady
 * engine / running lights, tracer volleys (amber = Dominion, blue-white = Reformation), impact flashes and
 * occasional violet arcs. The simulation is a tiny CPU pool driven by `dt` (deterministic, no timers); density
 * and tempo follow the battle intensity, and `glow` reports the summed light for zones to flicker with.
 */
import * as THREE from 'three';
import { PALETTE } from '@/core/api';
import { clamp01, mulberry32 } from '@/core/mathx';
import { FLEET_VERTEX, battleFrame, battlePlaneCoords, createFleet, type Fleet, type FleetShip } from './fleet';
import { GLSL_NOISE } from './glsl';
import type { SkyState } from './presets';
import { SKY_ORDER, viewportTracker, type SharedUniforms } from './shared';

const MAX_TRACERS = 120;
const MAX_FLASHES = 40;
const MAX_ARCS = 6;
const TYPE_SPRITE = 0, TYPE_TRACER = 1, TYPE_ARC = 2;

const FX_VERTEX = /* glsl */ `
attribute vec4 iA;
attribute vec4 iB;
attribute vec4 iC;
attribute vec4 iD;
uniform vec2 uViewport;
uniform float uFarZ;
uniform float uHazeAmt;
uniform float uHazeFall;
varying vec2 vQ;
varying vec3 vCol;
varying float vType;
varying float vSeed;
${FLEET_VERTEX}
void main() {
  float type = iC.w;
  vType = type;
  vSeed = iD.y;
  vQ = position.xy;
  vec3 r, u, c;
  vec3 d0 = skyPoint(iA.xy, iA.zw, r, u, c);
  vec3 d1 = type < 0.5 ? d0 : skyPoint(iB.xy, iB.zw, r, u, c);
  vec4 c0 = projectionMatrix * vec4(mat3(viewMatrix) * d0, 1.0);
  vec4 c1 = projectionMatrix * vec4(mat3(viewMatrix) * d1, 1.0);
  float lum = iC.r + iC.g + iC.b;
  if (c0.w < 0.05 || c1.w < 0.05 || lum <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vCol = vec3(0.0); return; }
  vec2 half_ = uViewport * 0.5;
  vec2 p0 = c0.xy / c0.w * half_;
  vec2 p1 = c1.xy / c1.w * half_;
  float pxPerRad = projectionMatrix[1][1] * half_.y;
  float want = iD.x * uSpread * pxPerRad;
  float minPx = type < 0.5 ? 1.6 : (type < 1.5 ? 1.25 : 6.0);
  float sizePx = max(want, minPx);
  float k = clamp(want / sizePx, 0.0, 1.0);
  float comp = type < 0.5 ? max(k * k, 0.2) : max(k, 0.3);
  vec2 along = p1 - p0;
  float len = length(along);
  vec2 dir = len > 1e-3 ? along / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  vec2 p = type < 0.5
    ? p0 + position.xy * sizePx
    : mix(p0, p1, position.x * 0.5 + 0.5) + dir * position.x * sizePx + nrm * position.y * sizePx;
  float band = exp(-max(normalize(d0).y, 0.0) * uHazeFall) * uHazeAmt;
  vCol = iC.rgb * comp * (1.0 - 0.75 * band);
  gl_Position = vec4(p / half_, uFarZ, 1.0);
}
`;

const FX_FRAGMENT = /* glsl */ `
precision highp float;
varying vec2 vQ;
varying vec3 vCol;
varying float vType;
varying float vSeed;
${GLSL_NOISE}
void main() {
  float a;
  if (vType < 0.5) {
    float r2 = dot(vQ, vQ);
    float r = sqrt(r2);
    a = (exp(-r2 * 14.0) + 0.16 * exp(-r * 3.6)) * (1.0 - smoothstep(0.72, 1.0, r));
  } else if (vType < 1.5) {
    float across = exp(-vQ.y * vQ.y * 4.5);
    float head = smoothstep(-1.0, 0.92, vQ.x);
    a = across * head * head * (1.0 - smoothstep(0.86, 1.0, vQ.x)) * (1.0 - smoothstep(0.7, 1.0, abs(vQ.y)));
  } else {
    float x = vQ.x * 0.5 + 0.5;
    float pin = sin(3.14159 * clamp(x, 0.0, 1.0));
    float y = (vnoise(vec3(x * 6.0, vSeed, 1.0)) - 0.5) * 1.1 + (vnoise(vec3(x * 17.0, vSeed + 9.0, 4.0)) - 0.5) * 0.45;
    float dy = vQ.y - y * pin;
    a = (exp(-dy * dy * 520.0) * 1.8 + exp(-abs(dy) * 8.0) * 0.10) * smoothstep(0.0, 0.05, x) * (1.0 - smoothstep(0.95, 1.0, x));
    a *= 1.0 - smoothstep(0.75, 1.0, abs(vQ.y));
  }
  gl_FragColor = vec4(vCol * a, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

interface Tracer { live: boolean; u0: number; v0: number; u1: number; v1: number; t: number; dur: number; len: number; hit: boolean; faction: 0 | 1; big: boolean }
interface Flash { live: boolean; u: number; v: number; age: number; atk: number; decay: number; size: number; peak: number; r: number; g: number; b: number }
interface Arc { live: boolean; u0: number; v0: number; u1: number; v1: number; age: number; dur: number; seed: number; restrike: number }
interface Gun { cool: number; left: number; gap: number; target: number }

export interface FleetBattle {
  readonly object: THREE.Object3D;
  /** linear HDR colour of the battle light this frame */
  readonly glow: THREE.Color;
  update(dt: number, state: SkyState, intensity: number, reduceFlash: boolean): void;
  /** scripted impact; `dir` null = somewhere inside the battle */
  impact(dir: THREE.Vector3 | null, colorHex: number | null, strength: number): void;
  /** kill every live tracer, flash and arc and zero the glow (snap preset changes, zone loads) */
  clear(): void;
  dispose(): void;
}

const _amber = new THREE.Color(PALETTE.domAmber);
// Reformation fire leans cyan so it never reads as a second white remnant
const _blue = new THREE.Color(PALETTE.refBlue).multiply(new THREE.Color(0.72, 0.95, 1.0));
const _violet = new THREE.Color(PALETTE.eclipseViolet);
const _tmp = new THREE.Color();
const _uv = { u: 0, v: 0 };

export function createFleetBattle(shared: SharedUniforms, seed = 7283): FleetBattle {
  const fleet: Fleet = createFleet(shared, seed);
  const ships = fleet.ships;
  const rand = mulberry32(seed ^ 0x5eed);
  const object = new THREE.Group();
  object.name = 'sky:battle';
  object.add(fleet.mesh);

  // ---- instance layout: [steady lights][tracers][flashes][arcs]
  const lightSlots: Array<{ ship: FleetShip; l: FleetShip['lights'][number] }> = [];
  for (const s of ships) for (const l of s.lights) lightSlots.push({ ship: s, l });
  const N_LIGHT = lightSlots.length;
  const T0 = N_LIGHT, F0 = T0 + MAX_TRACERS, A0 = F0 + MAX_FLASHES, COUNT = A0 + MAX_ARCS;
  const iA = new Float32Array(COUNT * 4), iB = new Float32Array(COUNT * 4), iC = new Float32Array(COUNT * 4), iD = new Float32Array(COUNT * 4);

  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  const attrs = [iA, iB, iC, iD].map((arr, i) => {
    const a = new THREE.InstancedBufferAttribute(arr, 4);
    a.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute(['iA', 'iB', 'iC', 'iD'][i], a);
    return a;
  });
  const touch = (): void => {
    for (let i = 0; i < attrs.length; i++) attrs[i].needsUpdate = true;
  };
  geometry.instanceCount = COUNT;
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
  const material = new THREE.ShaderMaterial({
    name: 'SkyBattleFx',
    uniforms: {
      uFrame: fleet.uniforms.uFrame, uSpread: fleet.uniforms.uSpread,
      uViewport: shared.uViewport, uFarZ: shared.uFarZ, uHazeAmt: shared.uHazeAmt, uHazeFall: shared.uHazeFall,
    },
    vertexShader: FX_VERTEX,
    fragmentShader: FX_FRAGMENT,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    depthTest: true,
    depthWrite: false,
    fog: false,
  });
  const fx = new THREE.Mesh(geometry, material);
  fx.name = 'sky:battleFx';
  fx.frustumCulled = false;
  fx.renderOrder = SKY_ORDER.battleFx;
  fx.matrixAutoUpdate = false;
  fx.onBeforeRender = viewportTracker(shared);
  object.add(fx);

  for (let i = 0; i < N_LIGHT; i++) {
    const { ship, l } = lightSlots[i];
    iA[i * 4] = ship.u; iA[i * 4 + 1] = ship.v; iA[i * 4 + 2] = l.x; iA[i * 4 + 3] = l.y;
    iC[i * 4 + 3] = TYPE_SPRITE;
    iD[i * 4] = l.engine ? ship.size * 0.085 : ship.size * 0.022;
  }

  const tracers: Tracer[] = Array.from({ length: MAX_TRACERS }, () => ({ live: false, u0: 0, v0: 0, u1: 0, v1: 0, t: 0, dur: 1, len: 0.1, hit: false, faction: 0 as const, big: false }));
  const flashes: Flash[] = Array.from({ length: MAX_FLASHES }, () => ({ live: false, u: 0, v: 0, age: 0, atk: 0.05, decay: 0.3, size: 0.02, peak: 1, r: 1, g: 1, b: 1 }));
  const arcs: Arc[] = Array.from({ length: MAX_ARCS }, () => ({ live: false, u0: 0, v0: 0, u1: 0, v1: 0, age: 0, dur: 0.6, seed: 0, restrike: 0 }));
  const guns: Gun[] = ships.map(() => ({ cool: 0.5 + rand() * 5, left: 0, gap: 0, target: -1 }));
  let arcCool = 4 + rand() * 6;
  let softFlash = false;
  /** current battle intensity (0..1): shapes the tempo of new flashes; scripted impacts use the hot tempo */
  let tempo = 1;
  const glow = new THREE.Color(0, 0, 0);

  const spawnFlash = (u: number, v: number, size: number, peak: number, decay: number, c: THREE.Color, whiten: number): void => {
    // a free slot, else recycle the flash that has decayed the furthest (indexed loops: no closures per shot)
    let slot = flashes[0], spent = -1;
    for (let i = 0; i < MAX_FLASHES; i++) {
      const f = flashes[i];
      if (!f.live) { slot = f; break; }
      const k = f.age / f.decay;
      if (k > spent) { spent = k; slot = f; }
    }
    slot.live = true; slot.u = u; slot.v = v; slot.age = 0; slot.size = size;
    // a quiet battle flashes slower and softer (longer swell, lower peak); a hot one snaps
    const calm = 1 - tempo;
    slot.atk = softFlash ? 0.28 : 0.045 + 0.16 * calm;
    slot.decay = (softFlash ? decay * 2.2 : decay) * (1 + 0.9 * calm);
    slot.peak = softFlash ? Math.min(peak * 0.3, 2.2) : peak * (0.55 + 0.45 * tempo);
    slot.r = c.r + (1 - c.r) * whiten; slot.g = c.g + (1 - c.g) * whiten; slot.b = c.b + (1 - c.b) * whiten;
  };

  const pickTarget = (from: FleetShip, fleetVis: number): number => {
    for (let tries = 0; tries < 6; tries++) {
      const j = Math.floor(rand() * ships.length);
      const t = ships[j];
      if (t.faction !== from.faction && t.rank < fleetVis) return j;
    }
    return -1;
  };

  const fire = (si: number, gun: Gun): void => {
    const from = ships[si], to = ships[gun.target];
    let tr: Tracer | null = null;
    for (let i = 0; i < MAX_TRACERS; i++) if (!tracers[i].live) { tr = tracers[i]; break; }
    if (!tr || !to) return;
    const big = from.size > 0.09 && rand() < 0.3;
    tr.live = true; tr.faction = from.faction; tr.big = big;
    tr.u0 = from.u + (rand() - 0.5) * from.size * 0.5; tr.v0 = from.v + (rand() - 0.5) * from.size * 0.18;
    const spreadAim = to.size * (0.3 + rand() * 0.9);
    tr.u1 = to.u + (rand() - 0.5) * spreadAim; tr.v1 = to.v + (rand() - 0.5) * spreadAim * 0.6;
    tr.hit = rand() < 0.55;
    if (!tr.hit) { // misses carry on past the target and fade
      const k = 1.25 + rand() * 0.5;
      tr.u1 = tr.u0 + (tr.u1 - tr.u0) * k; tr.v1 = tr.v0 + (tr.v1 - tr.v0) * k;
    }
    const dist = Math.hypot(tr.u1 - tr.u0, tr.v1 - tr.v0);
    tr.dur = (0.9 + rand() * 0.5) * (0.6 + dist * 0.9) * (big ? 1.5 : 1) * (1.5 - 0.5 * tempo);
    tr.len = (big ? 0.085 : 0.05) / Math.max(dist, 0.05);
    tr.t = 0;
  };

  const writeSprite = (i: number, u: number, v: number, lx: number, ly: number, size: number, r: number, g: number, b: number): void => {
    const o = i * 4;
    iA[o] = u; iA[o + 1] = v; iA[o + 2] = lx; iA[o + 3] = ly;
    iC[o] = r; iC[o + 1] = g; iC[o + 2] = b; iC[o + 3] = TYPE_SPRITE;
    iD[o] = size;
  };

  return {
    object, glow,
    update(dt, state, intensity, reduceFlash) {
      softFlash = reduceFlash;
      const fleetVis = state.fleet;
      battleFrame(state.battleDir, fleet.uniforms.uFrame.value);
      fleet.uniforms.uSpread.value = state.battleSpread;
      fleet.uniforms.uFleet.value = fleetVis;
      fleet.uniforms.uWhiteLight.value.setRGB(2.2, 2.45, 2.8).multiplyScalar(0.25 + 0.75 * state.whiteVis);
      fleet.uniforms.uRedLight.value.setRGB(1.5, 0.26, 0.12).multiplyScalar(state.redVis);
      // anything still in flight keeps the layer alive, so a tracer never pops off when the last flash ends
      let anyLive = false;
      for (let i = 0; i < MAX_FLASHES && !anyLive; i++) anyLive = flashes[i].live;
      for (let i = 0; i < MAX_TRACERS && !anyLive; i++) anyLive = tracers[i].live;
      for (let i = 0; i < MAX_ARCS && !anyLive; i++) anyLive = arcs[i].live;
      object.visible = fleetVis > 0.004 || anyLive;
      const k = clamp01(intensity);
      let gr = 0, gg = 0, gb = 0;

      // ---- steady lights follow fleet visibility
      for (let i = 0; i < N_LIGHT; i++) {
        const { ship, l } = lightSlots[i];
        const vis = clamp01((fleetVis - ship.rank) / 0.1) * l.w;
        const c = ship.faction === 0 ? _amber : _blue;
        const e = l.engine ? 3.4 : 1.6;
        iC[i * 4] = c.r * e * vis; iC[i * 4 + 1] = c.g * e * vis; iC[i * 4 + 2] = c.b * e * vis;
      }

      // ---- guns: salvos of several bolts; tempo and density follow the intensity
      let liveTracers = 0;
      for (let i = 0; i < MAX_TRACERS; i++) if (tracers[i].live) liveTracers++;
      tempo = k;
      if (dt > 0) {
        for (let si = 0; si < ships.length; si++) {
          const ship = ships[si], gun = guns[si];
          if (ship.rank >= fleetVis) continue;
          if (gun.left > 0) {
            gun.gap -= dt;
            if (gun.gap <= 0) { fire(si, gun); gun.left--; gun.gap = 0.07 + rand() * 0.09; }
            continue;
          }
          // a quiet battle is visibly quiet: far fewer salvos, shorter ones, and a cap on what is in flight
          gun.cool -= dt * (0.06 + 1.94 * Math.pow(k, 1.25));
          if (gun.cool <= 0) {
            gun.cool = 1.6 + rand() * 5.2;
            if (k > 0.02 && rand() < 0.12 + 0.88 * k && liveTracers < 10 + 110 * k) {
              gun.target = pickTarget(ship, fleetVis);
              if (gun.target >= 0) { gun.left = 1 + Math.floor(rand() * (1 + 6 * k)); gun.gap = 0; }
            }
          }
        }
        // ---- violet arcs: rare, only when the battle is hot enough
        arcCool -= dt * k;
        if (arcCool <= 0 && k > 0.2) {
          arcCool = 3.5 + rand() * 7;
          let a: Arc | null = null;
          for (let i = 0; i < MAX_ARCS; i++) if (!arcs[i].live) { a = arcs[i]; break; }
          const s = ships[Math.floor(rand() * ships.length)];
          if (a && s.rank < fleetVis) {
            const ang = rand() * Math.PI * 2, len = 0.08 + rand() * 0.16;
            a.live = true; a.age = 0; a.dur = 0.45 + rand() * 0.5; a.seed = rand() * 100; a.restrike = 0;
            a.u0 = s.u + (rand() - 0.5) * s.size * 0.6; a.v0 = s.v + (rand() - 0.5) * s.size * 0.3;
            a.u1 = a.u0 + Math.cos(ang) * len; a.v1 = a.v0 + Math.sin(ang) * len;
          }
        }
      }

      // ---- tracers
      for (let i = 0; i < MAX_TRACERS; i++) {
        const tr = tracers[i], o = (T0 + i) * 4;
        if (tr.live) {
          tr.t += dt / tr.dur;
          if (tr.t >= 1) {
            tr.live = false;
            if (tr.hit) {
              const c = tr.faction === 0 ? _amber : _blue;
              const major = rand() < 0.07 + 0.08 * k;
              // little whitening: pure white belongs to the white remnant alone
              if (major) spawnFlash(tr.u1, tr.v1, 0.030 + rand() * 0.022, 7 + rand() * 6, 0.45 + rand() * 0.5, c, 0.1);
              else spawnFlash(tr.u1, tr.v1, (tr.big ? 0.014 : 0.008) + rand() * 0.005, (tr.big ? 5 : 3) + rand() * 2, 0.14 + rand() * 0.14, c, 0.12);
            }
          }
        }
        if (!tr.live) { iC[o] = 0; iC[o + 1] = 0; iC[o + 2] = 0; iC[o + 3] = TYPE_TRACER; continue; }
        const head = tr.t, tail = Math.max(0, tr.t - tr.len);
        iA[o] = tr.u0 + (tr.u1 - tr.u0) * tail; iA[o + 1] = tr.v0 + (tr.v1 - tr.v0) * tail; iA[o + 2] = 0; iA[o + 3] = 0;
        iB[o] = tr.u0 + (tr.u1 - tr.u0) * head; iB[o + 1] = tr.v0 + (tr.v1 - tr.v0) * head; iB[o + 2] = 0; iB[o + 3] = 0;
        const c = tr.faction === 0 ? _amber : _blue;
        const fade = (tr.hit ? 1 : 1 - Math.max(0, (tr.t - 0.7) / 0.3)) * Math.min(1, tr.t * 12);
        const e = (tr.big ? 7 : 4.2) * fade;
        iC[o] = c.r * e; iC[o + 1] = c.g * e; iC[o + 2] = c.b * e; iC[o + 3] = TYPE_TRACER;
        iD[o] = tr.big ? 0.0050 : 0.0030;
      }

      // ---- flashes
      for (let i = 0; i < MAX_FLASHES; i++) {
        const f = flashes[i], idx = F0 + i;
        if (f.live) {
          f.age += dt;
          const env = f.age < f.atk ? f.age / f.atk : Math.exp(-(f.age - f.atk) / f.decay);
          if (f.age > f.atk && env < 0.012) f.live = false;
          else {
            const e = f.peak * env;
            writeSprite(idx, f.u, f.v, 0, 0, f.size * (0.75 + 0.5 * Math.min(1, f.age / (f.atk + f.decay))), f.r * e, f.g * e, f.b * e);
            const w = e * f.size * f.size * 8;
            gr += f.r * w; gg += f.g * w; gb += f.b * w;
            continue;
          }
        }
        iC[idx * 4] = 0; iC[idx * 4 + 1] = 0; iC[idx * 4 + 2] = 0; iC[idx * 4 + 3] = TYPE_SPRITE;
      }

      // ---- arcs: a strike that re-strikes once or twice (held steady when flashes are reduced)
      for (let i = 0; i < MAX_ARCS; i++) {
        const a = arcs[i], o = (A0 + i) * 4;
        if (a.live) {
          a.age += dt;
          if (a.age >= a.dur) a.live = false;
        }
        if (!a.live) { iC[o] = 0; iC[o + 1] = 0; iC[o + 2] = 0; iC[o + 3] = TYPE_ARC; continue; }
        const phase = a.age / a.dur;
        if (!softFlash) {
          const strike = Math.floor(phase * 3);
          if (strike !== a.restrike) { a.restrike = strike; a.seed += 3.7; }
        }
        const local = softFlash ? Math.sin(Math.PI * phase) * 0.45 : Math.exp(-((phase * 3) % 1) * 3.2) * (1 - phase * 0.5);
        const e = 5.5 * local;
        iA[o] = a.u0; iA[o + 1] = a.v0; iA[o + 2] = 0; iA[o + 3] = 0;
        iB[o] = a.u1; iB[o + 1] = a.v1; iB[o + 2] = 0; iB[o + 3] = 0;
        iC[o] = _violet.r * e + 0.25 * e; iC[o + 1] = _violet.g * e + 0.12 * e; iC[o + 2] = _violet.b * e; iC[o + 3] = TYPE_ARC;
        iD[o] = Math.hypot(a.u1 - a.u0, a.v1 - a.v0) * 0.22; iD[o + 1] = a.seed;
        const w = e * 0.05;
        gr += (_violet.r + 0.25) * w; gg += (_violet.g + 0.12) * w; gb += _violet.b * w;
      }

      glow.setRGB(gr, gg, gb);
      touch();
    },
    impact(dir, colorHex, strength) {
      const s = clamp01(strength);
      const was = tempo;
      tempo = 1; // a scripted hit is always a hard, fast flash
      const spread = fleet.uniforms.uSpread.value;
      let u = (rand() - 0.5) * 0.9, v = (rand() - 0.5) * 0.7;
      if (dir && battlePlaneCoords(fleet.uniforms.uFrame.value, spread, dir, _uv)) { u = _uv.u; v = _uv.v; }
      const c = colorHex == null ? (rand() < 0.5 ? _amber : _blue) : _tmp.setHex(colorHex);
      const size = (0.022 + 0.05 * s) / Math.max(spread, 0.2);
      spawnFlash(u, v, size, 7 + 16 * s, 0.45 + 0.9 * s, c, 0.4);
      spawnFlash(u + (rand() - 0.5) * size, v + (rand() - 0.5) * size, size * 0.45, 5 + 8 * s, 0.25 + 0.3 * s, c, 0.7);
      tempo = was;
    },
    clear() {
      for (let i = 0; i < MAX_TRACERS; i++) { tracers[i].live = false; const o = (T0 + i) * 4; iC[o] = 0; iC[o + 1] = 0; iC[o + 2] = 0; }
      for (let i = 0; i < MAX_FLASHES; i++) { flashes[i].live = false; const o = (F0 + i) * 4; iC[o] = 0; iC[o + 1] = 0; iC[o + 2] = 0; }
      for (let i = 0; i < MAX_ARCS; i++) { arcs[i].live = false; const o = (A0 + i) * 4; iC[o] = 0; iC[o + 1] = 0; iC[o + 2] = 0; }
      for (let i = 0; i < guns.length; i++) { guns[i].left = 0; guns[i].target = -1; }
      glow.setRGB(0, 0, 0);
      touch();
    },
    dispose() {
      fleet.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
}
