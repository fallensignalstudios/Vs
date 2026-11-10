/**
 * Rig builder: bones + painted procedural parts → one skinned BufferGeometry (a cached RigTemplate), and the
 * per-instance Rig (bone hierarchy, skeleton, sockets) that animates it. One draw call per creature.
 *
 * Authoring conventions: model space is the creature's root frame — Y up, FRONT = −Z, right = +X. Bones are
 * declared at absolute model-space bind positions with identity rest rotation, so additive Euler posing is
 * intuitive (rotation.x pitches about model X at rest, etc).
 */
import * as THREE from 'three';
import { cloneSoup, computeNormals, tube, xform, type Pt3, type Soup } from './geo';

/** Surface description of a part; colour is an sRGB hex. */
export interface Paint {
  c: number;
  /** roughness */
  r: number;
  /** metalness */
  m: number;
  /** emissive strength (emissive colour = c); > 1 blooms */
  e?: number;
  /** edge-wear strength on bevels 0..1 (default 0.5) */
  edge?: number;
  /** tissue weight 0..1: where Eclipse veins prefer to run */
  seam?: number;
}

export interface PartOpts {
  /** shader group id 0..7 (emissive gating: eye, vent, joint …) */
  group?: number;
  /** per-part random 0..1; default = deterministic sequence */
  rand?: number;
  /** plate slide vector in model space (metres at knit = 1) */
  slide?: Pt3;
  /** crease angle in degrees for normal smoothing (default 60; 180 = fully smooth, 0 = faceted) */
  crease?: number;
  /** structure that outlives the creature: exempt from the dissolve and mostly from corruption */
  keep?: boolean;
}

export interface BoneSpec {
  name: string;
  parent: number;
  /** model-space bind position */
  at: Pt3;
}

export interface SocketSpec {
  name: string;
  bone: number;
  /** offset in the bone's bind frame (= model-space offset, bones have identity rest rotation) */
  offset: Pt3;
  rot: Pt3;
}

export interface RigTemplate {
  geometry: THREE.BufferGeometry;
  bones: BoneSpec[];
  sockets: SocketSpec[];
  triangles: number;
  /** bind-pose bounds */
  center: THREE.Vector3;
  radius: number;
  /** model-space bind bounds of the vertices carried by each bone: [minX, minY, minZ, maxX, maxY, maxZ] per bone */
  boneBox: Float32Array;
}

const _c = new THREE.Color();

export class RigBuilder {
  readonly bones: BoneSpec[] = [];
  readonly sockets: SocketSpec[] = [];
  private readonly index = new Map<string, number>();
  private readonly pos: number[] = [];
  private readonly nrm: number[] = [];
  private readonly col: number[] = [];
  private readonly surf: number[] = [];
  private readonly part: number[] = [];
  private readonly slide: number[] = [];
  private readonly skinI: number[] = [];
  private readonly skinW: number[] = [];
  private parts = 0;
  private warp: ((p: [number, number, number]) => void) | null = null;

  /**
   * Install a model-space position warp (proportion edits: e.g. lengthen the legs of an authored figure).
   * It is applied to every part as it is added — normals are computed after it — and to bones and sockets at
   * build(). Authoring coordinates (`at()`, part placement) stay un-warped.
   */
  setWarp(fn: (p: [number, number, number]) => void): void {
    this.warp = fn;
  }

  /** Declare a bone at a model-space bind position. Parents must be declared first. */
  bone(name: string, parent: string | null, at: Pt3): string {
    const p = parent === null ? -1 : this.idx(parent);
    this.index.set(name, this.bones.length);
    this.bones.push({ name, parent: p, at });
    return name;
  }

  /** Declare a chain of bones through the given points; returns their names (`prefix0`, `prefix1`, …). */
  chain(prefix: string, parent: string, points: readonly Pt3[]): string[] {
    const names: string[] = [];
    let par = parent;
    for (let i = 0; i < points.length; i++) {
      par = this.bone(prefix + i, par, points[i]!);
      names.push(par);
    }
    return names;
  }

  has(name: string): boolean {
    return this.index.has(name);
  }

  at(name: string): Pt3 {
    return this.bones[this.idx(name)]!.at;
  }

  private idx(name: string): number {
    const i = this.index.get(name);
    if (i === undefined) throw new Error(`[creatures] rig: unknown bone "${name}"`); // build-time authoring error only
    return i;
  }

  /** Attachment point at a model-space position, carried by `bone`. */
  socket(name: string, bone: string, at: Pt3, rot: Pt3 = [0, 0, 0]): void {
    const b = this.idx(bone);
    const o = this.bones[b]!.at;
    this.sockets.push({ name, bone: b, offset: [at[0] - o[0], at[1] - o[1], at[2] - o[2]], rot });
  }

  /** Add a rigid part bound to one bone. `m` places the soup in model space. */
  add(bone: string, paint: Paint, soup: Soup, m?: THREE.Matrix4, opts: PartOpts = {}): void {
    const s = m ? xform(cloneSoup(soup), m) : soup;
    const b = this.idx(bone);
    this.emit(s, paint, opts, () => b, null);
  }

  /** Add the part on the +X side bound to `boneR` and its mirror image (x → −x) bound to `boneL`. */
  addPair(boneR: string, boneL: string, paint: Paint, soup: Soup, m: THREE.Matrix4, opts: PartOpts = {}, paintL: Paint = paint): void {
    this.add(boneR, paint, soup, m, opts);
    const mm = new THREE.Matrix4().makeScale(-1, 1, 1).multiply(m);
    const slide = opts.slide ? ([-opts.slide[0], opts.slide[1], opts.slide[2]] as Pt3) : undefined;
    this.add(boneL, paintL, soup, mm, { ...opts, slide });
  }

  /**
   * Add a soft part skinned along a bone chain using the soup's `u` parameter. `joints[i]` is the u at which
   * chain bone i starts (default: evenly spaced). `blend` is the fraction of a segment that bends at joints.
   */
  addSkinned(chain: readonly string[], paint: Paint, soup: Soup, m?: THREE.Matrix4, opts: PartOpts = {}, joints?: readonly number[], blend = 0.4): void {
    const s = m ? xform(cloneSoup(soup), m) : soup;
    const ids = chain.map((n) => this.idx(n));
    const k = ids.length;
    const js = joints ?? ids.map((_, i) => i / k);
    const u = s.u;
    this.emit(s, paint, { crease: 180, ...opts }, () => ids[0]!, (v, out) => {
      const uv = u ? u[v]! : 0;
      let seg = 0;
      for (let i = 0; i < k; i++) if (uv >= js[i]!) seg = i;
      const u0 = js[seg]!, u1 = seg + 1 < k ? js[seg + 1]! : 1.0001;
      const f = Math.min(1, Math.max(0, (uv - u0) / Math.max(1e-5, u1 - u0)));
      out[0] = ids[seg]!; out[1] = 1; out[2] = 0; out[3] = 0;
      if (f < blend && seg > 0) {
        const w = 0.5 * (1 - f / blend);
        out[1] = 1 - w; out[2] = ids[seg - 1]!; out[3] = w;
      } else if (f > 1 - blend && seg + 1 < k) {
        const w = 0.5 * ((f - (1 - blend)) / blend);
        out[1] = 1 - w; out[2] = ids[seg + 1]!; out[3] = w;
      }
    });
  }

  /** Convenience: a tube through the chain's bone positions (+ a tip point), skinned to that chain. */
  tubeOn(chain: readonly string[], tip: Pt3, paint: Paint, radius: number | ((t: number) => number), sides = 6, opts: PartOpts = {}, flatten = 1, sub = 2): void {
    const pts: Pt3[] = [];
    const ctrl = [...chain.map((n) => this.at(n)), tip];
    const lens: number[] = [0];
    for (let i = 0; i < ctrl.length - 1; i++) {
      const a = ctrl[i]!, b = ctrl[i + 1]!;
      lens.push(lens[i]! + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
      for (let j = 0; j < sub; j++) {
        const t = j / sub;
        pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
      }
    }
    pts.push(tip);
    // tube u is by point index; joints are at every `sub` points
    const n = pts.length - 1;
    const joints = chain.map((_, i) => (i * sub) / n);
    this.addSkinned(chain, paint, tube(pts, radius, sides, true, flatten), undefined, opts, joints);
  }

  private emit(soupIn: Soup, paint: Paint, opts: PartOpts, bone: () => number, skin: ((v: number, out: number[]) => void) | null): void {
    let s = soupIn;
    const nv = s.p.length / 3;
    if (nv === 0) return;
    if (this.warp) {
      if (s === soupIn) s = cloneSoup(s);
      const q: [number, number, number] = [0, 0, 0];
      for (let v = 0; v < nv; v++) {
        q[0] = s.p[v * 3]!; q[1] = s.p[v * 3 + 1]!; q[2] = s.p[v * 3 + 2]!;
        this.warp(q);
        s.p[v * 3] = q[0]; s.p[v * 3 + 1] = q[1]; s.p[v * 3 + 2] = q[2];
      }
    }
    const n = computeNormals(s.p, opts.crease ?? 60);
    _c.setHex(paint.c); // sRGB hex → linear working space
    const rnd = opts.rand ?? ((this.parts * 0.6180339887) % 1);
    this.parts++;
    const edge = paint.edge ?? 0.5;
    const sl = opts.slide ?? [0, 0, 0];
    const b = bone();
    const sk = [b, 1, 0, 0];
    for (let v = 0; v < nv; v++) {
      this.pos.push(s.p[v * 3]!, s.p[v * 3 + 1]!, s.p[v * 3 + 2]!);
      this.nrm.push(n[v * 3]!, n[v * 3 + 1]!, n[v * 3 + 2]!);
      this.col.push(_c.r, _c.g, _c.b);
      this.surf.push(paint.r, paint.m, paint.e ?? 0, s.e[v]! * edge);
      this.part.push(opts.group ?? 0, rnd, paint.seam ?? 0, opts.keep ? 1 : 0);
      this.slide.push(sl[0], sl[1], sl[2]);
      if (skin) skin(v, sk);
      this.skinI.push(sk[0]!, sk[2]!, 0, 0);
      this.skinW.push(sk[1]!, sk[3]!, 0, 0);
    }
  }

  build(): RigTemplate {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aSurf', new THREE.Float32BufferAttribute(this.surf, 4));
    g.setAttribute('aPart', new THREE.Float32BufferAttribute(this.part, 4));
    g.setAttribute('aSlide', new THREE.Float32BufferAttribute(this.slide, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.skinI, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.skinW, 4));
    g.computeBoundingSphere();
    const bs = g.boundingSphere ?? new THREE.Sphere(new THREE.Vector3(), 1);
    let bones = this.bones.slice();
    let sockets = this.sockets.slice();
    const w = this.warp;
    if (w) {
      const wp = (p: Pt3): Pt3 => {
        const q: [number, number, number] = [p[0], p[1], p[2]];
        w(q);
        return q;
      };
      const src = bones;
      bones = src.map((b) => ({ ...b, at: wp(b.at) }));
      sockets = sockets.map((s) => {
        const o = src[s.bone]!.at, n = bones[s.bone]!.at;
        const m = wp([o[0] + s.offset[0], o[1] + s.offset[1], o[2] + s.offset[2]]);
        return { ...s, offset: [m[0] - n[0], m[1] - n[1], m[2] - n[2]] as Pt3 };
      });
    }
    const boneBox = new Float32Array(bones.length * 6);
    for (let i = 0; i < bones.length; i++) { boneBox.fill(Infinity, i * 6, i * 6 + 3); boneBox.fill(-Infinity, i * 6 + 3, i * 6 + 6); }
    for (let v = 0; v < this.pos.length / 3; v++) {
      const o = this.skinI[v * 4]! * 6;
      for (let k = 0; k < 3; k++) {
        const c = this.pos[v * 3 + k]!;
        if (c < boneBox[o + k]!) boneBox[o + k] = c;
        if (c > boneBox[o + 3 + k]!) boneBox[o + 3 + k] = c;
      }
    }
    return { geometry: g, bones, sockets, triangles: this.pos.length / 9, center: bs.center.clone(), radius: bs.radius, boneBox };
  }
}

const templates = new Map<string, RigTemplate>();

/** Build-once cache: geometry is shared by every instance of the same archetype/variant. */
export function getTemplate(key: string, build: () => RigTemplate): RigTemplate {
  let t = templates.get(key);
  if (!t) {
    t = build();
    templates.set(key, t);
  }
  return t;
}

/** Free every cached template geometry (tests / hot reload). */
export function disposeTemplates(): void {
  for (const t of templates.values()) t.geometry.dispose();
  templates.clear();
}

const warned = new Set<string>();
/** console.warn once per key */
export function warnOnce(key: string, msg: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(msg);
}

/** Per-instance skeleton + skinned mesh over a shared template. */
export class Rig {
  readonly group = new THREE.Group();
  readonly mesh: THREE.SkinnedMesh;
  readonly bones: THREE.Bone[] = [];
  readonly sockets = new Map<string, THREE.Object3D>();
  private readonly byName = new Map<string, THREE.Bone>();
  private readonly rest: Float32Array;
  private readonly skeleton: THREE.Skeleton;
  private readonly dummy = new THREE.Bone();
  /** inverse of the rig group's world matrix (world → model space), refreshed by syncModelSpace() */
  readonly toModel = new THREE.Matrix4();

  constructor(readonly template: RigTemplate, material: THREE.Material, private readonly label: string) {
    const specs = template.bones;
    this.rest = new Float32Array(specs.length * 3);
    const inverses: THREE.Matrix4[] = [];
    for (let i = 0; i < specs.length; i++) {
      const s = specs[i]!;
      const b = new THREE.Bone();
      b.name = s.name;
      const p = s.parent >= 0 ? specs[s.parent]!.at : ([0, 0, 0] as const);
      b.position.set(s.at[0] - p[0], s.at[1] - p[1], s.at[2] - p[2]);
      this.rest[i * 3] = b.position.x; this.rest[i * 3 + 1] = b.position.y; this.rest[i * 3 + 2] = b.position.z;
      if (s.parent >= 0) this.bones[s.parent]!.add(b);
      else this.group.add(b);
      this.bones.push(b);
      this.byName.set(s.name, b);
      inverses.push(new THREE.Matrix4().makeTranslation(-s.at[0], -s.at[1], -s.at[2]));
    }
    this.skeleton = new THREE.Skeleton(this.bones, inverses);
    this.mesh = new THREE.SkinnedMesh(template.geometry, material);
    this.mesh.bind(this.skeleton, new THREE.Matrix4());
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.boundingSphere = new THREE.Sphere(template.center.clone(), template.radius * 1.5);
    this.group.add(this.mesh);
    for (const s of template.sockets) {
      const o = new THREE.Object3D();
      o.name = 'socket:' + s.name;
      o.position.set(s.offset[0], s.offset[1], s.offset[2]);
      o.rotation.set(s.rot[0], s.rot[1], s.rot[2]);
      this.bones[s.bone]!.add(o);
      this.sockets.set(s.name, o);
    }
  }

  /** Bone by name. Unknown names return a detached dummy (and warn once) so animation code never throws. */
  b(name: string): THREE.Bone {
    const bone = this.byName.get(name);
    if (bone) return bone;
    warnOnce(`${this.label}:bone:${name}`, `[creatures] ${this.label}: unknown bone "${name}"`);
    return this.dummy;
  }

  /**
   * Refresh `toModel` from the group's current world matrix. Returns false when the group is degenerate
   * (a zero scale somewhere above it) — callers then skip posing for the frame instead of dividing by it.
   */
  syncModelSpace(): boolean {
    this.group.updateWorldMatrix(true, false);
    const det = this.group.matrixWorld.determinant();
    if (!(Math.abs(det) > 1e-18)) return false;
    this.toModel.copy(this.group.matrixWorld).invert();
    return true;
  }

  /** bind position (model space) of a bone by index */
  restOf(index: number, out: THREE.Vector3): THREE.Vector3 {
    const a = this.template.bones[index]?.at;
    return a ? out.set(a[0], a[1], a[2]) : out.set(0, 0, 0);
  }

  indexOf(bone: THREE.Bone): number {
    return this.bones.indexOf(bone);
  }

  /** true when every bone transform is a finite number */
  finite(): boolean {
    const bs = this.bones;
    for (let i = 0; i < bs.length; i++) {
      const b = bs[i]!, p = b.position, q = b.quaternion, s = b.scale;
      if (!Number.isFinite(p.x + p.y + p.z + q.x + q.y + q.z + q.w + s.x + s.y + s.z)) return false;
    }
    return true;
  }

  /** Restore the rest pose (called at the start of every pose evaluation). */
  reset(): void {
    const r = this.rest, bs = this.bones;
    for (let i = 0; i < bs.length; i++) {
      const b = bs[i]!;
      b.position.set(r[i * 3]!, r[i * 3 + 1]!, r[i * 3 + 2]!);
      b.rotation.set(0, 0, 0);
      b.scale.set(1, 1, 1);
    }
  }

  /** Re-centre the culling sphere (mesh-local) — call when the body travels far from the root (cling, drops). */
  setBoundsCenter(x: number, y: number, z: number, radiusScale = 1.5): void {
    const s = this.mesh.boundingSphere;
    if (!s) return;
    s.center.set(x, y, z);
    s.radius = this.template.radius * radiusScale;
  }

  /** Culling sphere with an absolute radius (model units) — for debris that travels far from a small device. */
  setBounds(x: number, y: number, z: number, radius: number): void {
    const s = this.mesh.boundingSphere;
    if (!s) return;
    s.center.set(x, y, z);
    s.radius = radius;
  }

  dispose(): void {
    this.skeleton.dispose();
    this.group.removeFromParent();
  }
}

/** re-export for archetype modules */
export type { Pt3 };
