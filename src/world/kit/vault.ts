/**
 * The enclosed King-era vault (`ceiling({ style: 'vaultClosed' })`): a thick barrel shell that springs from the
 * wall tops, carried by transverse ribs. Between each pair of ribs three narrow gold-edged seams — one along the
 * crown, one high on each shoulder — open onto bright warm haze (light boxes, so no sky or stars ever show), and
 * soft sheets of light fall from them along the key light. Both gable ends are closed, each with a vertical seam.
 *
 * Draw calls: the shell (one material), ribs and trim (merged with the zone's white-gold / gold), the haze (one
 * mesh for every seam) and the light sheets (one mesh, hidden without volumetrics). The shell casts no shadow:
 * the key light stands for the light that enters through the seams.
 *
 * Local frame: X across the vault (the short side), Y up from the springing height, Z along the vault.
 */
import * as THREE from 'three';
import { RENDER_LAYERS } from '@/core/api/render';
import type { CeilingOpts } from '@/core/api';
import type { V3 } from './geo';
import { familyOf, type KitCtx, type Part } from './core';

/** shell thickness, rib projection below the shell and rib half-depth (m) */
const SHELL = 0.32;
const RIB_DROP = 0.46;
const RIB_HALF = 0.38;
/** depth of a seam's light box beyond the shell's outer face (m) */
const BOX = 0.3;
/** profile fullness: < 1 gives the vault full shoulders and a broad crown */
const FULL = 0.78;

const SHEET_VERT = /* glsl */ `
attribute vec2 aSheet;
varying vec3 vWorld;
varying vec3 vNormalW;
varying vec2 vSheet;
void main() {
  vec4 wp = modelMatrix * vec4( position, 1.0 );
  vWorld = wp.xyz;
  vNormalW = normalize( mat3( modelMatrix ) * normal );
  vSheet = aSheet;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const SHEET_FRAG = /* glsl */ `
varying vec3 vWorld;
varying vec3 vNormalW;
varying vec2 vSheet;
uniform vec3 uColor;
uniform float uStrength;
uniform float uTime;
uniform float uFog;
float hash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float noise( vec2 p ) {
  vec2 i = floor( p ), f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( hash( i ), hash( i + vec2( 1.0, 0.0 ) ), f.x ), mix( hash( i + vec2( 0.0, 1.0 ) ), hash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}
void main() {
  vec3 toCam = cameraPosition - vWorld;
  float dist = length( toCam );
  // a sheet seen face-on glows, seen edge-on it vanishes: no hard lines; it thins out as it falls
  float face = pow( abs( dot( normalize( vNormalW ), toCam / dist ) ), 1.3 );
  float along = pow( 1.0 - vSheet.y, 1.7 ) * smoothstep( 0.0, 0.04, vSheet.y );
  float ends = smoothstep( 0.0, 0.2, vSheet.x ) * smoothstep( 1.0, 0.8, vSheet.x );
  float dust = 0.55 + 0.45 * noise( vec2( vWorld.x + vWorld.z, vWorld.y * 0.6 ) * 0.7 + vec2( uTime * 0.04, -uTime * 0.025 ) );
  // depth fade: lit haze thins with view depth like the scene fog it stands in for
  float haze = uFog * dist;
  float a = uStrength * face * along * ends * dust * smoothstep( 0.6, 4.0, dist ) * exp( - haze * haze );
  gl_FragColor = vec4( uColor * a, a );
}`;

interface Seam { t0: number; t1: number; z0: number; z1: number; crown: boolean }

/** Emit an enclosed vault into `part` (already placed and turned so local Z runs along the long side). */
export function emitClosedVault(ctx: KitCtx, part: Part, o: CeilingOpts, w: number, d: number, springH: number): void {
  const hw = w / 2, hd = d / 2;
  const R = ctx.num(o.rise, Math.max(2, w * 0.24), 0.5, w);
  const glow = ctx.num(o.glow, 3.2, 0, 20);
  const hazeColor = ctx.num(o.hazeColor, 0xffe6bf);
  const fam = familyOf(o.mat);
  // the shell is lit from below by the hall itself: a faint warm bounce keeps it ivory rather than grey
  const shellMat = ctx.variant(o.mat ?? 'whiteGold', fam.dark ? {} : { emissive: 0x6b5c46, emissiveIntensity: 0.45 });
  const shell = part.g(shellMat), rib = part.g(fam.frame), trim = part.g('goldTrim');

  // ---- the arch: t = 0 left springing → π/2 crown → π right springing -----------------------------------
  const base = (t: number): [number, number] => [-Math.cos(t) * hw, R * Math.pow(Math.max(0, Math.sin(t)), FULL)];
  const nrm = (t: number): [number, number] => {
    const e = 1e-3, a = base(Math.max(0, t - e)), b = base(Math.min(Math.PI, t + e));
    let nx = b[1] - a[1], ny = -(b[0] - a[0]);
    const l = Math.hypot(nx, ny) || 1;
    nx /= l; ny /= l;
    // outward = away from the vault's interior
    if (nx * base(t)[0] + ny * (base(t)[1] - R * 0.3) < 0) { nx = -nx; ny = -ny; }
    return [nx, ny];
  };
  /** point on the arch at `t`, pushed `off` metres outward (negative = into the room) */
  const at = (t: number, off: number, z: number): V3 => {
    const p = base(t), n = nrm(t);
    return [p[0] + n[0] * off, p[1] + n[1] * off, z];
  };
  const inward = (t: number): V3 => { const n = nrm(t); return [-n[0], -n[1], 0]; };

  // ---- ribs and seams: a narrow slit along the crown and one high on each shoulder, in every bay ------------
  const cw = Math.min(0.7, Math.max(0.36, w * 0.02)), sx = hw * 0.5, sw = Math.min(0.9, Math.max(0.42, w * 0.029));
  const tOf = (x: number): number => Math.acos(Math.max(-1, Math.min(1, -x / hw)));
  const slitsT: Array<[number, number, boolean]> = [
    [tOf(-sx - sw / 2), tOf(-sx + sw / 2), false], [tOf(-cw / 2), tOf(cw / 2), true], [tOf(sx - sw / 2), tOf(sx + sw / 2), false],
  ];
  const zb = ribStations(ctx, o, d);
  const margin = RIB_HALF + 0.4;
  const seams: Seam[] = [];
  for (let k = 0; k + 1 < zb.length; k++) {
    const z0 = zb[k] + margin, z1 = zb[k + 1] - margin;
    if (z1 - z0 < 0.8) continue;
    for (const [t0, t1, crown] of slitsT) seams.push({ t0, t1, z0, z1, crown });
  }

  // ---- shell: a (t, z) grid with the seams left open ---------------------------------------------------------
  const N = Math.max(16, Math.round((Math.PI * hw) / 1.4));
  const ts = new Set<number>();
  for (let i = 0; i <= N; i++) ts.add(Math.PI * (i / N));
  for (const [a, b] of slitsT) { ts.add(a); ts.add(b); }
  const tl = [...ts].sort((a, b) => a - b).filter((t, i, arr) => i === 0 || t - arr[i - 1] > 1e-4);
  const zs = new Set<number>(zb);
  for (const s of seams) { zs.add(s.z0); zs.add(s.z1); }
  const zl = [...zs].sort((a, b) => a - b);
  const open = (ta: number, tb: number, za: number, zb2: number): boolean =>
    seams.some((s) => ta >= s.t0 - 1e-5 && tb <= s.t1 + 1e-5 && za >= s.z0 - 1e-5 && zb2 <= s.z1 + 1e-5);
  for (let i = 0; i + 1 < tl.length; i++) {
    const ta = tl[i], tb = tl[i + 1], na = inward(ta), nb = inward(tb);
    for (let j = 0; j + 1 < zl.length; j++) {
      const za = zl[j], zc = zl[j + 1];
      if (open(ta, tb, za, zc)) continue;
      shell.quadN(at(ta, 0, za), na, at(tb, 0, za), nb, at(tb, 0, zc), nb, at(ta, 0, zc), na);
    }
  }
  // gable ends: closed lunettes (fan from the springing line's centre)
  for (const s of [-1, 1]) {
    const z = s * hd, face: V3 = [0, 0, -s];
    for (let i = 0; i + 1 < tl.length; i++) {
      shell.triN([0, 0, z], face, at(tl[i], 0, z), face, at(tl[i + 1], 0, z), face);
    }
  }

  // ---- transverse ribs, crown spine, springing ledges -------------------------------------------------------
  const rs = 28;
  for (const z of zb) {
    for (let i = 0; i < rs; i++) {
      const ta = Math.PI * (i / rs), tb = Math.PI * ((i + 1) / rs);
      const a = at(ta, -RIB_DROP, 0), b = at(tb, -RIB_DROP, 0), c = at(ta, 0.04, 0), e = at(tb, 0.04, 0);
      const z0 = Math.max(-hd, z - RIB_HALF), z1 = Math.min(hd, z + RIB_HALF);
      rib.hull([
        [[a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1], [a[0], a[1], z1]],
        [[a[0], a[1], z0], [b[0], b[1], z0], [e[0], e[1], z0], [c[0], c[1], z0]],
        [[a[0], a[1], z1], [b[0], b[1], z1], [e[0], e[1], z1], [c[0], c[1], z1]],
      ], [(c[0] + e[0]) / 2, (c[1] + e[1]) / 2 + 0.3, (z0 + z1) / 2]);
      const g0 = at(ta, -RIB_DROP - 0.01, z), g1 = at(tb, -RIB_DROP - 0.01, z), gn = inward((ta + tb) / 2);
      trim.ribbon([g0, g1], 0.09, gn);
    }
  }
  // every seam is edged in gold on the room side, just outside the opening
  for (const s of seams) {
    const tm = (s.t0 + s.t1) / 2, a = base(tm - 0.01), b = base(tm + 0.01);
    const lip = 0.035 / (Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.02 || 1);
    for (const t of [s.t0 - lip, s.t1 + lip]) trim.ribbon([at(t, -0.012, s.z0 - 0.08), at(t, -0.012, s.z1 + 0.08)], 0.05, inward(t));
  }
  for (const s of [-1, 1]) {
    rib.box(0.7, 0.42, d, s * (hw - 0.3), 0.04, 0);
    trim.box(0.74, 0.03, d + 0.02, s * (hw - 0.3), -0.18, 0);
  }

  // ---- haze: light boxes behind the seams, a lit lip on every reveal, a vertical seam in each gable -----------
  const hz = new HazeWriter(hazeColor);
  const deep = SHELL + BOX;
  for (const s of seams) {
    const zm = 0.35;
    // back of the box: brightest along the middle of the bay, a touch dimmer toward the ribs
    const bands = 6;
    for (let k = 0; k < bands; k++) {
      const za = s.z0 + ((s.z1 - s.z0) * k) / bands, zc = s.z0 + ((s.z1 - s.z0) * (k + 1)) / bands;
      const ka = 1 - zm * Math.abs((2 * k) / bands - 1), kc = 1 - zm * Math.abs((2 * (k + 1)) / bands - 1);
      hz.quad(at(s.t0, deep, za), at(s.t1, deep, za), at(s.t1, deep, zc), at(s.t0, deep, zc), inward((s.t0 + s.t1) / 2), [ka, ka, kc, kc]);
    }
    // reveals: lit by the haze, a little dimmer at the room edge (narrow seams are mostly seen through them)
    const lo = 0.62, hi = 0.95, ends = 1 - zm * 0.5;
    for (const t of [s.t0, s.t1]) {
      const n = t === s.t0 ? nrmAlong(s.t1, s.t0) : nrmAlong(s.t0, s.t1);
      hz.quad(at(t, 0, s.z0), at(t, deep, s.z0), at(t, deep, s.z1), at(t, 0, s.z1), n, [lo * ends, hi * ends, hi * ends, lo * ends]);
    }
    for (const [z, f] of [[s.z0, 1], [s.z1, -1]] as const) {
      hz.quad(at(s.t0, 0, z), at(s.t1, 0, z), at(s.t1, deep, z), at(s.t0, deep, z), [0, 0, f], [lo * ends, lo * ends, hi * ends, hi * ends]);
    }
  }
  for (const s of [-1, 1]) {
    const z = s * (hd - 0.02), f: V3 = [0, 0, -s], y0 = R * 0.22, y1 = R * 0.8, half = 0.2;
    hz.quad([-half, y0, z], [half, y0, z], [half, y1, z], [-half, y1, z], f, [0.55, 0.55, 0.9, 0.9]);
    trim.box(half * 2 + 0.16, y1 - y0 + 0.16, 0.04, 0, (y0 + y1) / 2, s * (hd - 0.01));
  }
  /** normal of a reveal face at the seam edge `from`, pointing across the opening toward `to` */
  function nrmAlong(to: number, from: number): V3 {
    const a = base(from), b = base(to);
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(b[0] - a[0]) / l, (b[1] - a[1]) / l, 0];
  }
  part.group.add(hz.mesh(ctx, glow, false));

  // ---- spill: the haze lights the shell around each seam (additive, fades out ~1 m from the opening) ----------
  const sp = new HazeWriter(hazeColor);
  const SPILL = 1.2, FADE = 0.5, k0 = 0.11, inner = -0.015;
  /** quadratic falloff across the spill band (no visible outer edge) */
  const fall = (u: number): number => k0 * (1 - u) * (1 - u);
  for (const s of seams) {
    const tm = (s.t0 + s.t1) / 2, a = base(tm - 0.01), b = base(tm + 0.01);
    const dt = SPILL / (Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.02 || 1);
    const ta = Math.max(0, s.t0 - dt), tb = Math.min(Math.PI, s.t1 + dt);
    for (const [e, f] of [[s.t0, ta], [s.t1, tb]] as const) {
      const n0 = inward(e), z0 = s.z0 - FADE, z1 = s.z1 + FADE;
      for (let i = 0; i < 3; i++) {
        const ea = e + ((f - e) * i) / 3, eb = e + ((f - e) * (i + 1)) / 3, ka = fall(i / 3), kb = fall((i + 1) / 3);
        sp.quad(at(ea, inner, s.z0), at(eb, inner, s.z0), at(eb, inner, s.z1), at(ea, inner, s.z1), n0, [ka, kb, kb, ka]);
        sp.quad(at(ea, inner, z0), at(eb, inner, z0), at(eb, inner, s.z0), at(ea, inner, s.z0), n0, [0, 0, kb, ka]);
        sp.quad(at(ea, inner, s.z1), at(eb, inner, s.z1), at(eb, inner, z1), at(ea, inner, z1), n0, [ka, kb, 0, 0]);
      }
    }
    for (const [z, zf] of [[s.z0, s.z0 - FADE], [s.z1, s.z1 + FADE]] as const) {
      sp.quad(at(s.t0, inner, z), at(s.t1, inner, z), at(s.t1, inner, zf), at(s.t0, inner, zf), inward(tm), [k0, k0, 0, 0]);
    }
  }
  part.group.add(sp.mesh(ctx, glow, true));

  // ---- light sheets from the seams, along the key light -------------------------------------------------------
  if (o.shafts !== false && seams.length) part.group.add(lightSheets(ctx, part, seams.filter((s) => s.crown), at, springH, hazeColor));
}

/**
 * Rib stations along the vault (local Z, both gable ends included): evenly fitted bays by default, or exactly
 * `bay` apart from `bayPhase` metres after the start when a phase is given (to sit on an existing rib row).
 */
function ribStations(ctx: KitCtx, o: CeilingOpts, d: number): number[] {
  const hd = d / 2, bay = ctx.num(o.bay, 7, 2, 40);
  const out = [-hd];
  if (o.bayPhase !== undefined && Number.isFinite(o.bayPhase)) {
    const phase = ((o.bayPhase % bay) + bay) % bay;
    for (let z = -hd + phase; z < hd - 1; z += bay) if (z > -hd + 1) out.push(z);
  } else {
    const n = Math.max(1, Math.round(d / bay));
    for (let k = 1; k < n; k++) out.push(-hd + (d * k) / n);
  }
  out.push(hd);
  return out;
}

/** vertex-coloured unlit quads (HDR via the material colour), fogged like the rest of the hall */
class HazeWriter {
  private readonly pos: number[] = [];
  private readonly nor: number[] = [];
  private readonly col: number[] = [];
  private readonly c: THREE.Color;
  constructor(color: number) { this.c = new THREE.Color(color); }

  quad(a: V3, b: V3, c: V3, d: V3, n: V3, k: [number, number, number, number]): void {
    // wind toward n
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    const flip = cx * n[0] + cy * n[1] + cz * n[2] < 0;
    const P = flip ? [a, d, c, b] : [a, b, c, d], K = flip ? [k[0], k[3], k[2], k[1]] : k;
    for (const i of [0, 1, 2, 0, 2, 3]) {
      this.pos.push(P[i][0], P[i][1], P[i][2]);
      this.nor.push(n[0], n[1], n[2]);
      this.col.push(this.c.r * K[i], this.c.g * K[i], this.c.b * K[i]);
    }
  }

  /** `additive`: a glow laid over other surfaces (unfogged — fog would add its colour — and not reflected) */
  mesh(ctx: KitCtx, glow: number, additive: boolean): THREE.Mesh {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(this.nor), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.col), 3));
    g.computeBoundingSphere();
    const m = additive
      ? new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
      : new THREE.MeshBasicMaterial({ vertexColors: true, fog: true });
    m.color.setScalar(glow);
    m.name = additive ? 'kit-vault-spill' : 'kit-vault-haze';
    const mesh = new THREE.Mesh(ctx.own(g), ctx.own(m));
    mesh.name = additive ? 'vault-spill' : 'vault-haze';
    if (additive) { mesh.layers.set(RENDER_LAYERS.noReflect); mesh.renderOrder = 7; }
    return mesh;
  }
}

/** one additive mesh: a sheet per seam, falling along the key light to the floor */
function lightSheets(ctx: KitCtx, part: Part, seams: Seam[], at: (t: number, off: number, z: number) => V3, springH: number, color: number): THREE.Mesh {
  // the key light in the part's frame (falls back to a steep light from one side)
  const key = ctx.lights.find((l) => l.name === 'kit-key');
  const kd = key?.userData.kitDir instanceof THREE.Vector3 ? (key.userData.kitDir as THREE.Vector3).clone() : new THREE.Vector3(0.3, 0.9, 0.25);
  kd.applyAxisAngle(new THREE.Vector3(0, 1, 0), -part.group.rotation.y).normalize();
  if (kd.y < 0.35) { kd.y = 0.35; kd.normalize(); }
  const pos: number[] = [], nor: number[] = [], uv: number[] = [];
  for (const s of seams) {
    const tm = (s.t0 + s.t1) / 2, top = at(tm, 0, 0);
    const len = Math.min(60, (springH + top[1]) / kd.y);
    const dx = -kd.x * len, dy = -kd.y * len, dz = -kd.z * len;
    // one sheet down the middle of the seam (its face-on glow and edge-on fade give it volume)
    const p: V3 = [top[0], top[1], s.z0], q: V3 = [top[0], top[1], s.z1];
    {
      const ex = q[0] - p[0], ey = q[1] - p[1], ez = q[2] - p[2];
      let nx = ey * dz - ez * dy, ny = ez * dx - ex * dz, nz = ex * dy - ey * dx;
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;
      const P: V3[] = [p, q, [q[0] + dx, q[1] + dy, q[2] + dz], [p[0] + dx, p[1] + dy, p[2] + dz]];
      const UV = [[0, 0], [1, 0], [1, 1], [0, 1]];
      for (const i of [0, 1, 2, 0, 2, 3]) {
        pos.push(P[i][0], P[i][1], P[i][2]);
        nor.push(nx, ny, nz);
        uv.push(UV[i][0], UV[i][1]);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nor), 3));
  g.setAttribute('aSheet', new THREE.BufferAttribute(new Float32Array(uv), 2));
  g.computeBoundingSphere();
  const uniforms = { uColor: { value: new THREE.Color(color) }, uStrength: { value: 0.24 }, uTime: { value: 0 }, uFog: { value: 0 } };
  const m = new THREE.ShaderMaterial({
    vertexShader: SHEET_VERT, fragmentShader: SHEET_FRAG, uniforms, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false, toneMapped: true,
  });
  m.name = 'kit-vault-sheets';
  const mesh = new THREE.Mesh(ctx.own(g), ctx.own(m));
  mesh.name = 'vault-light-sheets';
  mesh.layers.set(RENDER_LAYERS.noReflect);
  mesh.renderOrder = 8;
  ctx.updaters.push((_dt, time) => {
    uniforms.uTime.value = time;
    uniforms.uFog.value = ctx.fogDensity();
    mesh.visible = ctx.volumetrics();
  });
  return mesh;
}
