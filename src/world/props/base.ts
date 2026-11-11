/**
 * Shared foundation of the hero props (OWNER: hero-props): the `PropBase` class (eased parameters, sockets,
 * disposal), material access with fallbacks for headless tests / stub libraries, HDR glow materials and the small
 * unlit effect-shader helper used for fields, planes and reveal lines.
 */
import * as THREE from 'three';
import type { ColliderShape, HeroProp, MaterialLibrary, MatId, Vec3Like } from '@/core/api';
import { isStub } from '@/core/stub';
import { clamp } from '@/core/mathx';

// ------------------------------------------------------------------------------------------------ easing

/** How a parameter follows the value a script wrote into `params`. */
export interface Ease {
  /** 'spring' = second-order follow (`z` < 1 overshoots slightly); 'rate' = constant speed (authored timelines) */
  kind: 'spring' | 'rate';
  /** spring: natural frequency rad/s */
  w: number;
  /** spring: damping ratio */
  z: number;
  /** rate: units per second */
  rate: number;
  min: number;
  max: number;
}

/** Spring follow. `w` ≈ 9 settles in ~0.6 s; `z` 0.7 gives a slight overshoot, 1 none. */
export const spring = (w = 9, z = 0.72, min = 0, max = 1): Ease => ({ kind: 'spring', w, z, rate: 0, min, max });
/** Constant-speed follow: the full 0 → 1 range takes `seconds`. */
export const rate = (seconds: number, min = 0, max = 1): Ease => ({ kind: 'rate', w: 0, z: 1, rate: 1 / Math.max(0.01, seconds), min, max });

const warned = new Set<string>();
/** console.warn once per message */
export function warnOnce(msg: string): void {
  if (warned.has(msg)) return;
  warned.add(msg);
  console.warn(`[props] ${msg}`);
}

/** Shared sim-time uniform of every effect shader in this folder. */
export const FX_TIME: { value: number } = { value: 0 };

export type PropCollider = { shape: ColliderShape; offset: Vec3Like; yaw?: number };

/**
 * Base class of every hero prop. Scripts write targets into `params`; `update` eases `cur` toward them and calls
 * `apply`. The first `update` (and `snap()`) applies the targets instantly, so a zone that restores state at
 * load never shows a transition.
 */
export abstract class PropBase<P extends Record<string, number>> implements HeroProp<P> {
  readonly object: THREE.Group;
  params: P;
  colliders?: PropCollider[];
  /** eased values `apply` reads */
  protected readonly cur: P;
  protected readonly mk: MatKit;
  private readonly keys: Array<keyof P & string>;
  private readonly vel: number[];
  private readonly eases: Ease[];
  private readonly sockets = new Map<string, THREE.Object3D>();
  private readonly owned: Array<{ dispose(): void }> = [];
  private started = false;
  private disposed = false;
  private clock = 0;

  constructor(name: string, lib: MaterialLibrary | null, defaults: P, eases: Partial<Record<keyof P, Ease>> = {}) {
    this.object = new THREE.Group();
    this.object.name = `prop:${name}`;
    this.params = { ...defaults };
    this.cur = { ...defaults };
    this.keys = Object.keys(defaults) as Array<keyof P & string>;
    this.vel = this.keys.map(() => 0);
    this.eases = this.keys.map((k) => eases[k] ?? spring());
    this.mk = new MatKit(lib, (d) => this.own(d));
  }

  socket(name: string): THREE.Object3D | null {
    const s = this.sockets.get(name);
    if (!s) warnOnce(`${this.object.name}: unknown socket "${name}"`);
    return s ?? null;
  }

  /** names of every socket (debug / tests) */
  socketNames(): string[] {
    return [...this.sockets.keys()];
  }

  update(dt: number, time: number): void {
    if (this.disposed) return;
    const h = Number.isFinite(dt) ? clamp(dt, 0, 0.1) : 0;
    this.clock = Number.isFinite(time) ? time : this.clock + h;
    FX_TIME.value = this.clock;
    if (!this.started) {
      this.started = true;
      this.settle();
    } else {
      this.ease(h);
    }
    this.apply(h, this.clock);
  }

  snap(): void {
    if (this.disposed) return;
    this.started = true;
    this.settle();
    this.apply(0, this.clock);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.object.removeFromParent();
    this.object.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const im = o as THREE.InstancedMesh;
      if (im.isInstancedMesh) im.dispose();
    });
    for (const d of this.owned) d.dispose();
    this.owned.length = 0;
    this.object.clear();
  }

  /** read a target, sanitised into its range */
  private target(i: number): number {
    const v = this.params[this.keys[i]];
    const e = this.eases[i];
    return typeof v === 'number' && Number.isFinite(v) ? clamp(v, e.min, e.max) : (this.cur[this.keys[i]] as number);
  }

  private settle(): void {
    for (let i = 0; i < this.keys.length; i++) {
      (this.cur as Record<string, number>)[this.keys[i]] = this.target(i);
      this.vel[i] = 0;
    }
  }

  private ease(dt: number): void {
    if (dt <= 0) return;
    const steps = Math.max(1, Math.ceil(dt * 120));
    const h = dt / steps;
    for (let i = 0; i < this.keys.length; i++) {
      const e = this.eases[i];
      const goal = this.target(i);
      let x = this.cur[this.keys[i]] as number;
      if (e.kind === 'rate') {
        const d = goal - x, m = e.rate * dt;
        x = Math.abs(d) <= m ? goal : x + Math.sign(d) * m;
      } else {
        let v = this.vel[i];
        for (let s = 0; s < steps; s++) {
          v += (e.w * e.w * (goal - x) - 2 * e.z * e.w * v) * h;
          x += v * h;
        }
        if (Math.abs(goal - x) < 1e-4 && Math.abs(v) < 1e-3) { x = goal; v = 0; }
        this.vel[i] = v;
      }
      (this.cur as Record<string, number>)[this.keys[i]] = x;
    }
  }

  /** push the eased values (`this.cur`) into the scene objects */
  protected abstract apply(dt: number, time: number): void;

  /**
   * Called at the end of every subclass constructor: puts the scene objects into the state of the default
   * parameters, so a prop is presentable even before its first `update()`.
   */
  protected ready(): void {
    this.settle();
    this.apply(0, 0);
  }

  /** register something to dispose with the prop */
  protected own<T extends { dispose(): void }>(d: T): T {
    this.owned.push(d);
    return d;
  }

  /**
   * Create a named socket. `yaw` uses the engine convention (0 faces −Z): a character placed at the socket's
   * world position with the socket's world yaw faces the way the socket does.
   */
  protected addSocket(name: string, x: number, y: number, z: number, yaw = 0, parent: THREE.Object3D = this.object): THREE.Object3D {
    const s = new THREE.Object3D();
    s.name = `socket:${name}`;
    s.position.set(x, y, z);
    s.rotation.y = yaw;
    parent.add(s);
    this.sockets.set(name, s);
    return s;
  }

  protected addCollider(shape: ColliderShape, x: number, y: number, z: number, yaw = 0): void {
    (this.colliders ??= []).push({ shape, offset: { x, y, z }, yaw });
  }
}

// ------------------------------------------------------------------------------------------------ materials

/** rough stand-ins used when no material library is available (unit tests, stubbed game) */
const FALLBACK: Record<string, readonly [number, number, number]> = {
  whiteGold: [0xd9d2c0, 0.42, 0.3], whiteGoldPanel: [0xd9d2c0, 0.42, 0.3], whiteGoldFloor: [0xcfc8b6, 0.35, 0.3],
  goldTrim: [0xc9a45c, 0.28, 1], goldDark: [0x8a6a2e, 0.45, 1], blackStone: [0x0b0c10, 0.15, 0], blackStoneFloor: [0x0b0c10, 0.1, 0],
  domBronze: [0x8a5a2b, 0.4, 1], domOxblood: [0x5a1616, 0.35, 0.3], domBlack: [0x121012, 0.5, 0.6],
  refNavy: [0x1b2a44, 0.5, 0.4], refSlate: [0x3a4656, 0.5, 0.5], refSteel: [0xc5ccd4, 0.35, 0.9],
  darkWood: [0x1c120c, 0.4, 0], agedLeather: [0x3a2418, 0.55, 0], rubble: [0x6b655c, 0.9, 0], glass: [0x202830, 0.05, 0],
};

/** HDR unlit glow: the material colour is `base × intensity`; values above ~1 bloom. */
export class Glow {
  readonly material: THREE.MeshBasicMaterial;
  private readonly base = new THREE.Color();
  private last = -1;

  constructor(color: number, intensity = 1, vertexColors = false) {
    this.base.setHex(color);
    // light strips sit a few millimetres proud of their surface: the offset keeps them stable at any distance
    this.material = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6 });
    this.material.name = 'prop.glow';
    this.set(intensity);
  }

  /** set the HDR intensity (no-op when unchanged) */
  set(intensity: number): void {
    const i = Number.isFinite(intensity) ? Math.max(0, intensity) : 0;
    if (i === this.last) return;
    this.last = i;
    this.material.color.copy(this.base).multiplyScalar(i);
  }
}

/** Material access for one prop: per-prop clones (disposed with it), fallbacks without a library. */
export class MatKit {
  readonly lib: MaterialLibrary | null;

  constructor(lib: MaterialLibrary | null, private readonly track: (d: { dispose(): void }) => unknown) {
    this.lib = lib && !isStub(lib) ? lib : null;
  }

  /**
   * Object-space clone of a library material with vertex tinting enabled (the `color` attribute multiplies the
   * albedo, so one material can carry lighter and darker parts of the same substance).
   */
  solid(id: MatId, overrides: Record<string, unknown> = {}): THREE.MeshStandardMaterial {
    let m: THREE.MeshStandardMaterial;
    if (this.lib) {
      m = this.lib.clone(id, { objectSpace: true, vertexColors: true, ...overrides });
    } else {
      const f = FALLBACK[id] ?? [0x888888, 0.5, 0.2];
      m = new THREE.MeshStandardMaterial({ color: f[0], roughness: f[1], metalness: f[2], vertexColors: true });
      m.setValues(overrides as THREE.MeshStandardMaterialParameters);
    }
    this.track(m);
    return m;
  }

  /** HDR glow material (see {@link Glow}) */
  glow(color: number, intensity = 1, vertexColors = false): Glow {
    const g = new Glow(color, intensity, vertexColors);
    this.track(g.material);
    return g;
  }

  /** additive display material: the library's `hologram` (object space, RGBA vertex colours) or a plain fallback */
  holo(gain = 1.6): THREE.MeshBasicMaterial {
    let m: THREE.MeshBasicMaterial;
    if (this.lib) {
      m = this.lib.clone<THREE.MeshBasicMaterial>('hologram', { objectSpace: true, vertexColors: true, color: 0xffffff, gain });
    } else {
      m = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    }
    this.track(m);
    return m;
  }

  /** set the `reveal` fade of a material from {@link holo} */
  holoReveal(m: THREE.MeshBasicMaterial, v: number): void {
    if (this.lib) this.lib.setParam(m, 'reveal', v);
    else m.opacity = v;
  }

  /** unlit effect shader (see {@link fxMaterial}), disposed with the prop */
  fx(o: FxOpts): THREE.ShaderMaterial {
    const m = fxMaterial(o);
    this.track(m);
    return m;
  }
}

// ------------------------------------------------------------------------------------------------ effect shaders

export interface FxOpts {
  /** GLSL statements that assign `vec3 col` and `float alpha` (see FX_FRAGMENT_HEAD for the inputs) */
  body: string;
  uniforms?: Record<string, THREE.IUniform>;
  /** additive (default) or opaque */
  blend?: 'add' | 'opaque' | 'alpha';
  side?: THREE.Side;
  /** geometry carries the `aT` reveal attribute → `vT` */
  reveal?: boolean;
}

const FX_VERTEX = /* glsl */ `
#include <clipping_planes_pars_vertex>
varying vec2 vUv;
varying vec3 vPos;
varying vec3 vN;
varying vec3 vV;
#ifdef FX_AT
	attribute float aT;
	varying float vT;
#endif
varying vec3 vICol;
void main() {
	vUv = uv;
	vPos = position;
	#ifdef FX_AT
		vT = aT;
	#endif
	vec4 p = vec4( position, 1.0 );
	vec3 n = normal;
	#ifdef USE_INSTANCING
		p = instanceMatrix * p;
		n = mat3( instanceMatrix ) * n;
	#endif
	#ifdef USE_INSTANCING_COLOR
		vICol = instanceColor;
	#else
		vICol = vec3( 1.0 );
	#endif
	vec4 wp = modelMatrix * p;
	vN = normalize( mat3( modelMatrix ) * n );
	vV = cameraPosition - wp.xyz;
	vec4 mvPosition = viewMatrix * wp;
	#include <clipping_planes_vertex>
	gl_Position = projectionMatrix * mvPosition;
}
`;

/** Inputs available to an effect body: uTime, vUv, vPos (object space), vN / vV (world), vT, vICol, fxHash, fxNoise, fxLine. */
const FX_FRAGMENT_HEAD = /* glsl */ `
#include <clipping_planes_pars_fragment>
uniform float uTime;
varying vec2 vUv;
varying vec3 vPos;
varying vec3 vN;
varying vec3 vV;
#ifdef FX_AT
	varying float vT;
#endif
varying vec3 vICol; // per-instance colour (white when the mesh has none)
float fxHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float fxNoise( vec2 p ) {
	vec2 i = floor( p ), f = fract( p );
	f = f * f * ( 3.0 - 2.0 * f );
	return mix( mix( fxHash( i ), fxHash( i + vec2( 1.0, 0.0 ) ), f.x ), mix( fxHash( i + vec2( 0.0, 1.0 ) ), fxHash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}
// anti-aliased line of half-width w around d = 0
float fxLine( float d, float w ) { float aa = fwidth( d ) + 1e-5; return 1.0 - smoothstep( w - aa, w + aa, abs( d ) ); }
float fxFresnel( float p ) { return pow( 1.0 - abs( dot( normalize( vN ), normalize( vV ) ) ), p ); }
`;

/**
 * Small unlit ShaderMaterial with the engine's tone mapping / output colour space applied like a built-in
 * material. The body writes `col` (HDR, scene-linear) and `alpha`.
 */
export function fxMaterial(o: FxOpts): THREE.ShaderMaterial {
  const blend = o.blend ?? 'add';
  // declare the caller's uniforms from their value types
  let decl = '';
  for (const [name, u] of Object.entries(o.uniforms ?? {})) {
    const v = u.value as unknown;
    const type = typeof v === 'number' ? 'float'
      : (v as THREE.Color).isColor || (v as THREE.Vector3).isVector3 ? 'vec3'
        : (v as THREE.Vector2).isVector2 ? 'vec2' : (v as THREE.Vector4).isVector4 ? 'vec4' : null;
    if (type) decl += `uniform ${type} ${name};\n`;
    else warnOnce(`fx uniform "${name}" has an unsupported type`);
  }
  const m = new THREE.ShaderMaterial({
    uniforms: { uTime: FX_TIME, ...(o.uniforms ?? {}) },
    vertexShader: FX_VERTEX,
    fragmentShader: `${FX_FRAGMENT_HEAD}${decl}\nvoid main() {\n\t#include <clipping_planes_fragment>\n\tvec3 col = vec3( 0.0 );\n\tfloat alpha = 1.0;\n${o.body}\n\tgl_FragColor = vec4( col, alpha );\n\t#include <tonemapping_fragment>\n\t#include <colorspace_fragment>\n}\n`,
    transparent: blend !== 'opaque',
    depthWrite: blend === 'opaque',
    blending: blend === 'add' ? THREE.AdditiveBlending : THREE.NormalBlending,
    side: o.side ?? (blend === 'opaque' ? THREE.FrontSide : THREE.DoubleSide),
    // cut by the renderer's global clipping planes like the built-in materials (debug planView)
    clipping: true,
  });
  if (o.reveal) m.defines = { FX_AT: '' };
  if (blend === 'opaque') { m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -6; }
  m.name = 'prop.fx';
  return m;
}

/** uniform helpers */
export const uF = (v: number): THREE.IUniform<number> => ({ value: v });
export const uC = (hex: number): THREE.IUniform<THREE.Color> => ({ value: new THREE.Color(hex) });

/**
 * Opaque line light that is lit only up to `uReveal` along its `aT` order, with a brighter head at the front —
 * channels that open, filaments that knit. Uniforms: uColor, uGain, uReveal (0…1), uHead, uDim (brightness of
 * the part that is not lit yet; 0 = not drawn at all).
 */
export function revealBody(): string {
  return /* glsl */ `
	float lit = step( vT, uReveal ) * step( 0.0005, uReveal );
	if ( lit < 0.5 && uDim <= 0.0 ) discard;
	float head = smoothstep( uReveal - 0.06, uReveal, vT ) * step( uReveal, 0.999 );
	col = uColor * mix( uDim, uGain * ( 1.0 + head * uHead ), lit );
`;
}

/** shared temporaries for instance-matrix composition */
export const TMP = {
  m: new THREE.Matrix4(), m2: new THREE.Matrix4(), q: new THREE.Quaternion(), q2: new THREE.Quaternion(),
  v: new THREE.Vector3(), v2: new THREE.Vector3(), s: new THREE.Vector3(1, 1, 1), e: new THREE.Euler(), c: new THREE.Color(),
};

/** easeOutBack with a gentle overshoot */
export const outBack = (t: number, k = 1.2): number => {
  const x = clamp(t, 0, 1) - 1;
  return 1 + (k + 1) * x * x * x + k * x * x;
};
/** smooth 0…1 ramp of `v` between `a` and `b` */
export const ramp = (v: number, a: number, b: number): number => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
