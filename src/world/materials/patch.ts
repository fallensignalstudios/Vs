/**
 * Shader patch host — the one place that touches `onBeforeCompile`.
 *
 * A material gets a host; the host owns an ordered list of {@link SurfacePatch}es (triplanar mapping, corruption
 * overlay, glow patterns, ice, …) and composes them into three's standard / physical / basic shader at
 * well-defined points WITHOUT removing any of three's `#include` tokens, so other systems can keep patching the
 * same material.
 *
 * Chaining: the host installs accessors for `onBeforeCompile` and `customProgramCacheKey` on the material
 * instance. Anything another subsystem assigns to those properties afterwards (the renderer's reflective-floor
 * injection, a character shader) is captured and run AFTER the host's patches; a hook that was already present
 * when the host was installed is preserved the same way. A foreign hook or key function that itself chains by
 * calling the "previous" one cannot recurse (re-entry guards). The cache key combines every patch key with the
 * foreign key. Fragment-stage locals use the `mx` prefix so they cannot collide with other subsystems' code.
 */
import * as THREE from 'three';

type Shader = THREE.WebGLProgramParametersWithUniforms & { skinning?: boolean };
type Hook = (shader: Shader, renderer: THREE.WebGLRenderer) => void;

/** Uniform holder. `shared` holders keep their identity when a material is cloned (textures, global time). */
export interface AurUniform { value: unknown; shared?: boolean }

export interface SurfacePatch {
  /** Program-cache identity: materials with the same ordered patch keys share one program. */
  key: string;
  /** Position in the surface block (lower runs first). */
  order: number;
  defines?: Record<string, string | number>;
  uniforms?: Record<string, AurUniform>;
  vertexPars?: string;
  /** Fragment declarations (uniforms, functions). */
  fragmentPars?: string;
  /** After three's physical lighting declarations — may redefine `RE_Direct` (lit materials only). */
  lightPars?: string;
  /**
   * Runs before lighting with the mapping-space surface in scope:
   * `mxPos`, `mxGeoN`, `mxViewM`, `mxN` (perturbable), `mxAO`, `mxMask`, `diffuseColor`, `roughnessFactor`,
   * `metalnessFactor`, `totalEmissiveRadiance` (lit); unlit materials get `mxPos`, `mxGeoN` (mapping space),
   * `mxWorldN`, `mxV`, `mxNdotV` and write `diffuseColor` directly.
   */
  surface?: string;
  /** Runs once the view-space `normal` is final: `mxV`, `mxNdotV` available (lit materials only). */
  post?: string;
  /** Named scalar parameters → uniform component, for `setParam()` and `clone()` overrides. */
  params?: Record<string, ParamBinding>;
}

export interface ParamBinding {
  uniform: string;
  /** vector component; omit for a float uniform */
  comp?: 'x' | 'y' | 'z' | 'w';
  /** value transform (e.g. metres-per-repeat → repeats-per-metre) */
  map?: (v: number) => number;
}

/** Global animation clock shared by every patched material (seconds). */
export const AUR_TIME: AurUniform = { value: 0, shared: true };

export interface PatchHost {
  readonly material: THREE.Material;
  readonly patches: SurfacePatch[];
  /** true = object-space mapping (texture sticks to a moving mesh); false = world-space. */
  local: boolean;
  /** true for MeshStandard/Physical; false for the unlit (MeshBasic) effect materials. */
  readonly lit: boolean;
  add(patch: SurfacePatch): void;
  find(keyPrefix: string): SurfacePatch | undefined;
}

const HOSTS = new WeakMap<THREE.Material, PatchHost>();
const warned = new Set<string>();

function warnOnce(msg: string): void {
  if (warned.has(msg)) return;
  warned.add(msg);
  console.warn(`[mats] ${msg}`);
}

function hashText(s: string): string {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

/** Insert `code` after (or before) the first occurrence of `anchor`; warns once and leaves `src` alone if absent. */
function inject(src: string, anchor: string, code: string, before = false): string {
  if (!code) return src;
  const i = src.indexOf(anchor);
  if (i < 0) { warnOnce(`shader anchor "${anchor}" not found — a patch was skipped`); return src; }
  return before ? src.slice(0, i) + code + '\n' + src.slice(i) : src.slice(0, i + anchor.length) + '\n' + code + src.slice(i + anchor.length);
}

const COMMON_FRAG = /* glsl */ `
uniform float aurTime;
// integer-lattice hashes (exact, device independent): inputs are floored to integers first
vec2 aurHash22( vec2 p ) {
	uvec2 q = uvec2( ivec2( floor( p ) ) ) * uvec2( 1597334673u, 3812015801u );
	uvec2 r = uvec2( q.x ^ q.y ) * uvec2( 1597334673u, 2798796415u );
	r ^= r >> 15u; r *= 2246822519u; r ^= r >> 13u;
	return vec2( r ) * ( 1.0 / 4294967296.0 );
}
float aurHash31( vec3 p ) {
	uvec3 q = uvec3( ivec3( floor( p ) ) ) * uvec3( 1597334673u, 3812015801u, 2798796415u );
	uint n = ( q.x ^ q.y ^ q.z ) * 1597334673u;
	n ^= n >> 15u; n *= 2246822519u; n ^= n >> 13u;
	return float( n ) * ( 1.0 / 4294967296.0 );
}
vec3 aurTriWeights( vec3 n ) {
	vec3 w = max( abs( n ) - 0.2, 0.0 );
	w = w * w * w;
	return w / max( w.x + w.y + w.z, 1e-5 );
}
`;

const VERT_PARS = /* glsl */ `
varying vec3 vAurPos;
#ifdef AUR_LOCAL
	varying vec3 vAurM0;
	varying vec3 vAurM1;
	varying vec3 vAurM2;
#endif
#ifdef AUR_UNLIT
	varying vec3 vAurWPos;
	varying vec3 vAurWN;
	varying vec3 vAurMN;
#endif
`;

const VERT_MAIN = /* glsl */ `
{
	vec4 aurW = vec4( transformed, 1.0 );
	mat3 aurLin = mat3( modelMatrix );
	#ifdef USE_BATCHING
		aurW = batchingMatrix * aurW;
	#endif
	#ifdef USE_INSTANCING
		aurW = instanceMatrix * aurW;
		aurLin = aurLin * mat3( instanceMatrix );
	#endif
	aurW = modelMatrix * aurW;
	#ifdef AUR_LOCAL
		// object-space mapping in metres: bind-pose position scaled by the object's world scale
		vAurPos = position * vec3( length( aurLin[ 0 ] ), length( aurLin[ 1 ] ), length( aurLin[ 2 ] ) );
		mat3 aurMv = mat3( viewMatrix ) * aurLin;
		#ifdef USE_SKINNING
			aurMv = aurMv * mat3( skinMatrix );
		#endif
		vAurM0 = normalize( aurMv[ 0 ] );
		vAurM1 = normalize( aurMv[ 1 ] );
		vAurM2 = normalize( aurMv[ 2 ] );
	#else
		vAurPos = aurW.xyz;
	#endif
	#ifdef AUR_UNLIT
		vAurWPos = aurW.xyz;
		vec3 aurON = vec3( normal );
		#ifdef USE_SKINNING
			aurON = mat3( skinMatrix ) * aurON;
		#endif
		vAurWN = aurLin * aurON;
		#ifdef AUR_LOCAL
			vAurMN = vec3( normal );
		#else
			vAurMN = vAurWN;
		#endif
	#endif
}
`;

const FRAG_PARS = /* glsl */ `
varying vec3 vAurPos;
#ifdef AUR_LOCAL
	varying vec3 vAurM0;
	varying vec3 vAurM1;
	varying vec3 vAurM2;
#endif
#ifdef AUR_UNLIT
	varying vec3 vAurWPos;
	varying vec3 vAurWN;
	varying vec3 vAurMN;
#endif
`;

const LIT_SURFACE_BEGIN = /* glsl */ `
vec3 mxPos = vAurPos;
#ifdef AUR_LOCAL
	mat3 mxM = mat3( normalize( vAurM0 ), normalize( vAurM1 ), normalize( vAurM2 ) );
	vec3 mxGeoN = normalize( normal * mxM );
	vec3 mxViewM = normalize( vViewPosition * mxM );
#else
	vec3 mxGeoN = normalize( ( vec4( normal, 0.0 ) * viewMatrix ).xyz );
	vec3 mxViewM = normalize( ( vec4( vViewPosition, 0.0 ) * viewMatrix ).xyz );
#endif
vec3 mxN = mxGeoN;
float mxAO = 1.0;
float mxMask = 0.0;
`;

const LIT_SURFACE_END = /* glsl */ `
#ifdef AUR_LOCAL
	normal = normalize( mxM * mxN );
#else
	normal = normalize( ( viewMatrix * vec4( mxN, 0.0 ) ).xyz );
#endif
vec3 mxV = normalize( vViewPosition );
float mxNdotV = saturate( dot( normal, mxV ) );
{
	// specular anti-aliasing: widen the lobe by the normal variance inside the pixel footprint
	vec3 mxDx = dFdx( normal ), mxDy = dFdy( normal );
	float mxVar = min( 0.25 * ( dot( mxDx, mxDx ) + dot( mxDy, mxDy ) ), 0.18 );
	roughnessFactor = sqrt( saturate( roughnessFactor * roughnessFactor + mxVar ) );
}
`;

const LIT_AO = /* glsl */ `
{
	reflectedLight.indirectDiffuse *= mxAO;
	#if defined( USE_ENVMAP ) && defined( STANDARD )
		float mxDotNV = saturate( dot( geometryNormal, geometryViewDir ) );
		reflectedLight.indirectSpecular *= computeSpecularOcclusion( mxDotNV, mxAO, material.roughness );
	#endif
}
`;

const UNLIT_SURFACE_BEGIN = /* glsl */ `
vec3 mxPos = vAurPos;
vec3 mxV = normalize( cameraPosition - vAurWPos );
// geometry without normals falls back to a camera-facing normal (no fresnel) instead of NaN
bool mxHasN = dot( vAurWN, vAurWN ) > 1e-8;
float mxFace = gl_FrontFacing ? 1.0 : - 1.0;
vec3 mxWorldN = mxHasN ? normalize( vAurWN ) * mxFace : mxV;
vec3 mxGeoN = mxHasN ? normalize( vAurMN ) * mxFace : vec3( 0.0, 0.0, 1.0 );
float mxNdotV = saturate( dot( mxWorldN, mxV ) );
`;

function compose(host: HostImpl, shader: Shader): void {
  const ps = host.patches;
  const local = host.local || shader.skinning === true;
  let defines = '';
  if (local) defines += '#define AUR_LOCAL\n';
  if (!host.lit) defines += '#define AUR_UNLIT\n';
  for (const p of ps) if (p.defines) for (const k in p.defines) defines += `#define ${k} ${p.defines[k]}\n`;

  shader.uniforms.aurTime = AUR_TIME as THREE.IUniform;
  for (const p of ps) if (p.uniforms) for (const k in p.uniforms) shader.uniforms[k] = p.uniforms[k] as THREE.IUniform;

  const join = (sel: (p: SurfacePatch) => string | undefined): string => ps.map(sel).filter(Boolean).join('\n');

  let vs = shader.vertexShader;
  vs = inject(vs, '#include <common>', VERT_PARS + join((p) => p.vertexPars));
  vs = inject(vs, '#include <project_vertex>', VERT_MAIN);
  shader.vertexShader = defines + vs;

  let fs = shader.fragmentShader;
  fs = inject(fs, '#include <common>', FRAG_PARS + COMMON_FRAG + join((p) => p.fragmentPars));
  if (host.lit) {
    fs = inject(fs, '#include <lights_physical_pars_fragment>', join((p) => p.lightPars));
    fs = inject(fs, '#include <normal_fragment_maps>', LIT_SURFACE_BEGIN + join((p) => p.surface) + LIT_SURFACE_END + join((p) => p.post));
    fs = inject(fs, '#include <aomap_fragment>', LIT_AO);
  } else {
    fs = inject(fs, '#include <map_fragment>', UNLIT_SURFACE_BEGIN + join((p) => p.surface));
  }
  shader.fragmentShader = defines + fs;
}

class HostImpl implements PatchHost {
  readonly patches: SurfacePatch[] = [];
  local = false;
  foreignHook: Hook | null = null;
  foreignKey: (() => string) | null = null;
  private running = false;
  private keying = false;

  constructor(readonly material: THREE.Material, readonly lit: boolean) {}

  add(patch: SurfacePatch): void {
    const i = this.patches.findIndex((p) => p.key === patch.key);
    if (i >= 0) this.patches.splice(i, 1);
    this.patches.push(patch);
    this.patches.sort((a, b) => a.order - b.order);
    this.material.needsUpdate = true;
  }

  find(keyPrefix: string): SurfacePatch | undefined {
    return this.patches.find((p) => p.key.startsWith(keyPrefix));
  }

  readonly hook: Hook = (shader, renderer) => {
    if (this.running) return; // a foreign hook chained back into us
    this.running = true;
    try {
      compose(this, shader);
      if (this.foreignHook) this.foreignHook.call(this.material, shader, renderer);
    } catch (err) {
      warnOnce(`shader patch failed on "${this.material.name}": ${String(err)}`);
    } finally {
      this.running = false;
    }
  };

  readonly cacheKey = (): string => {
    let k = `aur:${this.local ? 'L' : 'W'}${this.lit ? '' : 'U'}:` + this.patches.map((p) => p.key).join(',');
    if (this.keying) return k; // a foreign key function chained back into us
    this.keying = true;
    try {
      if (this.foreignKey) k += '|' + this.foreignKey.call(this.material);
      else if (this.foreignHook) k += '|' + hashText(this.foreignHook.toString());
    } catch (err) {
      warnOnce(`foreign customProgramCacheKey failed on "${this.material.name}": ${String(err)}`);
    } finally {
      this.keying = false;
    }
    return k;
  };
}

/** The host of a material, if it has one. */
export function getHost(material: THREE.Material): PatchHost | undefined {
  return HOSTS.get(material);
}

/**
 * Give `material` a patch host (idempotent). Works on any MeshStandard/Physical material (lit) or MeshBasic
 * material (unlit) — including materials created by other subsystems; an `onBeforeCompile` they already set is
 * kept and chained.
 */
export function ensureHost(material: THREE.Material): PatchHost {
  const existing = HOSTS.get(material);
  if (existing) return existing;
  const lit = (material as THREE.MeshStandardMaterial).isMeshStandardMaterial === true;
  const host = new HostImpl(material, lit);
  const own = material as unknown as Record<string, unknown>;
  const has = (k: string): boolean => Object.prototype.hasOwnProperty.call(material, k);
  if (has('onBeforeCompile') && typeof own.onBeforeCompile === 'function') host.foreignHook = own.onBeforeCompile as Hook;
  if (has('customProgramCacheKey') && typeof own.customProgramCacheKey === 'function') host.foreignKey = own.customProgramCacheKey as () => string;

  Object.defineProperty(material, 'onBeforeCompile', {
    configurable: true,
    enumerable: false,
    get: () => host.hook,
    set: (fn: unknown) => {
      if (fn === host.hook) return;
      host.foreignHook = typeof fn === 'function' ? (fn as Hook) : null;
      material.needsUpdate = true;
    },
  });
  Object.defineProperty(material, 'customProgramCacheKey', {
    configurable: true,
    enumerable: false,
    get: () => host.cacheKey,
    set: (fn: unknown) => {
      if (fn === host.cacheKey) return;
      host.foreignKey = typeof fn === 'function' ? (fn as () => string) : null;
      material.needsUpdate = true;
    },
  });

  // keep patches when someone calls material.clone()
  const protoClone = material.clone;
  Object.defineProperty(material, 'clone', {
    configurable: true,
    enumerable: false,
    writable: true,
    value: function cloneHosted(this: THREE.Material): THREE.Material {
      const copy = protoClone.call(this) as THREE.Material;
      copyHost(this, copy);
      return copy;
    },
  });

  HOSTS.set(material, host);
  material.needsUpdate = true;
  return host;
}

function cloneValue(v: unknown): unknown {
  if (v && typeof v === 'object' && !(v as THREE.Texture).isTexture && typeof (v as { clone?: unknown }).clone === 'function') {
    return (v as { clone(): unknown }).clone();
  }
  return v;
}

/** Copy of a patch whose non-shared uniforms are independent of the original. */
export function clonePatch(p: SurfacePatch): SurfacePatch {
  if (!p.uniforms) return { ...p };
  const uniforms: Record<string, AurUniform> = {};
  for (const k in p.uniforms) {
    const u = p.uniforms[k];
    uniforms[k] = u.shared ? u : { value: cloneValue(u.value) };
  }
  return { ...p, uniforms };
}

/** Give `dst` the same patches as `src` (independent per-material uniforms, shared textures). */
export function copyHost(src: THREE.Material, dst: THREE.Material): void {
  const from = HOSTS.get(src) as HostImpl | undefined;
  if (!from) return;
  const to = ensureHost(dst) as HostImpl;
  to.local = from.local;
  for (const p of from.patches) to.add(clonePatch(p));
  to.foreignHook = from.foreignHook;
  to.foreignKey = from.foreignKey;
}

/** Find a named uniform on any of a material's patches. */
export function findUniform(material: THREE.Material, name: string): AurUniform | undefined {
  const host = HOSTS.get(material);
  if (!host) return undefined;
  for (const p of host.patches) if (p.uniforms && name in p.uniforms) return p.uniforms[name];
  return undefined;
}

/** Set a named scalar parameter declared by one of the material's patches. Returns false if nothing declares it. */
export function setPatchParam(material: THREE.Material, name: string, value: number): boolean {
  const host = HOSTS.get(material);
  if (!host) return false;
  let hit = false;
  for (const p of host.patches) {
    const b = p.params?.[name];
    const u = b && p.uniforms ? p.uniforms[b.uniform] : undefined;
    if (!b || !u) continue;
    const v = b.map ? b.map(value) : value;
    if (b.comp) (u.value as Record<string, number>)[b.comp] = v;
    else u.value = v;
    hit = true;
  }
  return hit;
}
