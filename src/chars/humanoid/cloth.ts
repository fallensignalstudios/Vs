/**
 * Cloth: capes, cloaks, mantles and coat tails.
 *
 * A panel is a small grid of particles (cols × rows). Each particle is a bone; the panel mesh is skinned
 * bilinearly to the four surrounding particles. The top row is pinned to a body bone; the rest is a verlet
 * simulation in WORLD space (so travel and turns drag the cloth) with fixed sub-steps, distance constraints,
 * a tether to the pin (cloth cannot stretch or explode), and capsule collision against torso and legs.
 * A large frame-to-frame jump of the root (teleport) resets the panel to its rest shape.
 */
import * as THREE from 'three';
import { MeshBuilder, Prim, PART, type Surf } from './geo/builder';
import { addBone, type RigSpec } from './rig';

export interface ClothDef {
  cols: number;
  rows: number;
  /** rest positions in model space, index (c * rows + r) * 3 */
  rest: Float32Array;
  /** first bone index; bones are laid out c * rows + r */
  bone0: number;
  /** bone each column's top particle is pinned to */
  pin: number[];
  /** rows pinned from the top (≥ 1) */
  pinRows: number;
  /** 0..1 how strongly the panel resists leaving its rest shape (stiff mantles vs loose capes) */
  shape: number;
  damping: number;
  /** particle collision radius (model units) */
  radius: number;
}

export interface ClothPanelOpts {
  cols: number;
  rows: number;
  /** rest surface: u across 0..1, v down 0..1 → model-space point */
  at: (u: number, v: number) => [number, number, number];
  /** bone name the top edge hangs from (per column chooser allowed) */
  pin: string | ((u: number) => string);
  pinRows?: number;
  shape?: number;
  damping?: number;
  surf: Surf;
  /** inner face surf (lining) */
  lining?: Surf;
  /** trim along the hem + side edges */
  trim?: Surf;
  trimWidth?: number;
  /** subdivisions per cell */
  sub?: number;
  thick?: number;
  name: string;
}

/** Create the particle bones and emit the two-sided panel mesh. Returns the ClothDef for the simulator. */
export function clothPanel(b: MeshBuilder, spec: RigSpec, o: ClothPanelOpts): ClothDef {
  const { cols, rows } = o;
  const rest = new Float32Array(cols * rows * 3);
  const bone0 = spec.names.length;
  const pin: number[] = [];
  for (let c = 0; c < cols; c++) {
    const u = cols > 1 ? c / (cols - 1) : 0.5;
    const pn = typeof o.pin === 'string' ? o.pin : o.pin(u);
    pin.push(spec.index[pn] ?? 0);
    for (let r = 0; r < rows; r++) {
      const p = o.at(u, r / (rows - 1));
      const i = (c * rows + r) * 3;
      rest[i] = p[0]; rest[i + 1] = p[1]; rest[i + 2] = p[2];
      addBone(spec, `${o.name}_${c}_${r}`, 'root', p[0], p[1], p[2]);
    }
  }
  const sub = o.sub ?? 3;
  const nu = (cols - 1) * sub + 1, nv = (rows - 1) * sub + 1;
  const thick = o.thick ?? 0.006;
  const tw = o.trim ? (o.trimWidth ?? 0.03) : 0;
  const prim = new Prim();
  const skin: number[] = [];
  const P = (iu: number, iv: number): [number, number, number] => o.at(iu / (nu - 1), iv / (nv - 1));
  const front: number[] = [], back: number[] = [];
  const nrm: number[] = [];
  // approximate panel size for trim widths
  const pa = o.at(0, 0.5), pb = o.at(1, 0.5), pc = o.at(0.5, 0), pd = o.at(0.5, 1);
  const width = Math.hypot(pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]) || 1;
  const height = Math.hypot(pd[0] - pc[0], pd[1] - pc[1], pd[2] - pc[2]) || 1;
  for (let side = 0; side < 2; side++) {
    for (let iv = 0; iv < nv; iv++) {
      for (let iu = 0; iu < nu; iu++) {
        const u = iu / (nu - 1), v = iv / (nv - 1);
        const p = P(iu, iv);
        // surface normal from neighbours
        const pu0 = P(Math.max(0, iu - 1), iv), pu1 = P(Math.min(nu - 1, iu + 1), iv);
        const pv0 = P(iu, Math.max(0, iv - 1)), pv1 = P(iu, Math.min(nv - 1, iv + 1));
        const ux = pu1[0] - pu0[0], uy = pu1[1] - pu0[1], uz = pu1[2] - pu0[2];
        const vx = pv1[0] - pv0[0], vy = pv1[1] - pv0[1], vz = pv1[2] - pv0[2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const nl = Math.hypot(nx, ny, nz) || 1;
        nx /= nl; ny /= nl; nz /= nl;
        const edgeDist = Math.min(u * width, (1 - u) * width, (1 - v) * height);
        const isTrim = tw > 0 && edgeDist < tw;
        const off = side === 0 ? thick * 0.5 : -thick * 0.5;
        const idx = prim.v(p[0] + nx * off, p[1] + ny * off, p[2] + nz * off, side === 0 ? (isTrim ? 1 : 0) : (isTrim ? 1 : 2), 0, side === 0 ? 1 : 0.7);
        (side === 0 ? front : back).push(idx);
        if (side === 0) nrm.push(nx, ny, nz);
        // bilinear weights over the particle cell
        const fc = Math.min(cols - 1 - 1e-6, u * (cols - 1)), fr = Math.min(rows - 1 - 1e-6, v * (rows - 1));
        const c0 = Math.floor(fc), r0 = Math.floor(fr), tc = fc - c0, tr = fr - r0;
        const bi = (c: number, r: number): number => bone0 + Math.min(cols - 1, c) * rows + Math.min(rows - 1, r);
        skin.push(bi(c0, r0), (1 - tc) * (1 - tr), bi(c0 + 1, r0), tc * (1 - tr), bi(c0, r0 + 1), (1 - tc) * tr, bi(c0 + 1, r0 + 1), tc * tr);
      }
    }
  }
  for (let iv = 0; iv < nv - 1; iv++) {
    for (let iu = 0; iu < nu - 1; iu++) {
      const i = iv * nu + iu;
      const nx = nrm[i * 3], ny = nrm[i * 3 + 1], nz = nrm[i * 3 + 2];
      prim.quadDir(front[i], front[i + 1], front[i + nu + 1], front[i + nu], nx, ny, nz);
      prim.quadDir(back[i], back[i + 1], back[i + nu + 1], back[i + nu], -nx, -ny, -nz);
    }
  }
  prim.k = skin;
  const base: Surf = { part: PART.cloth, rough: 0.82, ...o.surf };
  b.push();
  b.matrix.identity();
  b.surf(base);
  b.commit(prim, [base, o.trim ? { part: PART.cloth, ...o.trim } : base, o.lining ? { part: PART.cloth, rough: 0.85, ...o.lining } : { ...base, color: darken(base.color, 0.6) }]);
  b.pop();
  return { cols, rows, rest, bone0, pin, pinRows: o.pinRows ?? 1, shape: o.shape ?? 0.12, damping: o.damping ?? 0.04, radius: 0.028 };
}

function darken(hex: number, k: number): number {
  const r = Math.round(((hex >> 16) & 255) * k), g = Math.round(((hex >> 8) & 255) * k), bl = Math.round((hex & 255) * k);
  return (r << 16) | (g << 8) | bl;
}

/** A capsule in model space the cloth must stay outside of. */
export interface ClothCapsule { a: THREE.Vector3; b: THREE.Vector3; r: number }

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
const _m = new THREE.Matrix4(), _mi = new THREE.Matrix4();
const _q = new THREE.Quaternion(), _qr = new THREE.Quaternion();
const STEP = 1 / 60;

export class ClothSim {
  private readonly n: number;
  private readonly pos: Float32Array;
  private readonly prev: Float32Array;
  private readonly model: Float32Array;
  private readonly restInv: THREE.Quaternion[] = [];
  private acc = 0;
  private fresh = true;
  private readonly lastRoot = new THREE.Vector3();
  private readonly restLen: { v: Float32Array; h: Float32Array; tether: Float32Array };
  private time = 0;

  constructor(readonly def: ClothDef, private readonly bones: THREE.Bone[], private readonly seed = 0) {
    const { cols, rows, rest } = def;
    this.n = cols * rows;
    this.pos = new Float32Array(this.n * 3);
    this.prev = new Float32Array(this.n * 3);
    this.model = new Float32Array(rest);
    const v = new Float32Array(this.n), h = new Float32Array(this.n), tether = new Float32Array(this.n);
    for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) {
      const i = c * rows + r;
      if (r > 0) v[i] = dist(rest, i, i - 1);
      if (c > 0) h[i] = dist(rest, i, i - rows);
      // tether: path length from the pinned row
      tether[i] = r === 0 ? 0 : tether[i - 1] + v[i];
    }
    this.restLen = { v, h, tether };
    for (let i = 0; i < this.n; i++) {
      this.frame(rest, i, _q);
      this.restInv.push(_q.clone().invert());
    }
  }

  /** orientation of particle i from its grid neighbours */
  private frame(P: Float32Array, i: number, out: THREE.Quaternion): void {
    const { cols, rows } = this.def;
    const c = Math.floor(i / rows), r = i % rows;
    const up = r > 0 ? i - 1 : i, dn = r < rows - 1 ? i + 1 : i;
    const lf = c > 0 ? i - rows : i, rt = c < cols - 1 ? i + rows : i;
    _y.set(P[up * 3] - P[dn * 3], P[up * 3 + 1] - P[dn * 3 + 1], P[up * 3 + 2] - P[dn * 3 + 2]);
    if (_y.lengthSq() < 1e-10) _y.set(0, 1, 0);
    _y.normalize();
    if (cols > 1) _x.set(P[rt * 3] - P[lf * 3], P[rt * 3 + 1] - P[lf * 3 + 1], P[rt * 3 + 2] - P[lf * 3 + 2]);
    else _x.set(1, 0, 0);
    _x.addScaledVector(_y, -_x.dot(_y));
    if (_x.lengthSq() < 1e-10) { _x.set(1, 0, 0).addScaledVector(_y, -_y.x); if (_x.lengthSq() < 1e-6) _x.set(0, 0, 1); }
    _x.normalize();
    _z.crossVectors(_x, _y);
    _m.makeBasis(_x, _y, _z);
    out.setFromRotationMatrix(_m);
  }

  /** Snap to the rest shape under the current skeleton on the next update. */
  reset(): void { this.fresh = true; }

  /**
   * @param modelWorld model→world matrix of the figure
   * @param jointPos/jointQuat model-space transforms of the body bones (from the solver)
   * @param caps collision capsules in model space
   */
  update(dt: number, modelWorld: THREE.Matrix4, jointPos: THREE.Vector3[], jointQuat: THREE.Quaternion[], rigRest: number[], caps: ClothCapsule[], scale: number): void {
    const { cols, rows, rest, pin, pinRows } = this.def;
    const pos = this.pos, prev = this.prev;
    // teleport detection
    _v.setFromMatrixPosition(modelWorld);
    const jump = _v.distanceTo(this.lastRoot);
    this.lastRoot.copy(_v);
    if (jump > 2.5 * scale || !Number.isFinite(jump)) this.fresh = true;

    // pinned targets (world)
    const pinTarget = (i: number, out: THREE.Vector3): void => {
      const c = Math.floor(i / rows);
      const bn = pin[c];
      out.set(rest[i * 3] - rigRest[bn * 3], rest[i * 3 + 1] - rigRest[bn * 3 + 1], rest[i * 3 + 2] - rigRest[bn * 3 + 2]).applyQuaternion(jointQuat[bn]).add(jointPos[bn]).applyMatrix4(modelWorld);
    };

    if (this.fresh) {
      for (let i = 0; i < this.n; i++) {
        pinTarget(i, _v);
        pos[i * 3] = prev[i * 3] = _v.x; pos[i * 3 + 1] = prev[i * 3 + 1] = _v.y; pos[i * 3 + 2] = prev[i * 3 + 2] = _v.z;
      }
      this.fresh = false;
      this.acc = 0;
    }

    this.acc = Math.min(this.acc + dt, STEP * 4);
    const g = -9.8 * scale * 0.9;
    const damp = 1 - this.def.damping;
    const rad = this.def.radius * scale;
    const { v: lv, h: lh, tether } = this.restLen;
    while (this.acc >= STEP) {
      this.acc -= STEP;
      this.time += STEP;
      // integrate
      for (let i = 0; i < this.n; i++) {
        const r = i % rows;
        const k = i * 3;
        if (r < pinRows) {
          pinTarget(i, _v);
          prev[k] = pos[k]; prev[k + 1] = pos[k + 1]; prev[k + 2] = pos[k + 2];
          pos[k] = _v.x; pos[k + 1] = _v.y; pos[k + 2] = _v.z;
          continue;
        }
        const vx = (pos[k] - prev[k]) * damp, vy = (pos[k + 1] - prev[k + 1]) * damp, vz = (pos[k + 2] - prev[k + 2]) * damp;
        prev[k] = pos[k]; prev[k + 1] = pos[k + 1]; prev[k + 2] = pos[k + 2];
        // a little turbulence keeps hanging cloth alive
        const fl = Math.sin(this.time * 2.3 + i * 1.7 + this.seed) * 0.35 * scale * (r / rows);
        pos[k] += vx + fl * STEP * STEP;
        pos[k + 1] += vy + g * STEP * STEP;
        pos[k + 2] += vz + fl * 0.6 * STEP * STEP;
        // pull toward the rest shape (stiffness of the weave / hidden weights)
        if (this.def.shape > 0) {
          pinTarget(i, _v);
          const s = this.def.shape * (1 - 0.6 * (r / (rows - 1)));
          pos[k] += (_v.x - pos[k]) * s; pos[k + 1] += (_v.y - pos[k + 1]) * s; pos[k + 2] += (_v.z - pos[k + 2]) * s;
        }
      }
      // constraints
      for (let it = 0; it < 3; it++) {
        for (let c = 0; c < cols; c++) for (let r = 1; r < rows; r++) {
          const i = c * rows + r;
          this.link(i, i - 1, lv[i] * scale, r < pinRows, r - 1 < pinRows);
          if (c > 0) this.link(i, i - rows, lh[i] * scale, r < pinRows, r < pinRows);
        }
        // tether to the pin: never longer than the cloth itself
        for (let c = 0; c < cols; c++) {
          const top = c * rows + (pinRows - 1);
          for (let r = pinRows; r < rows; r++) {
            const i = c * rows + r;
            const maxD = (tether[i] - tether[top]) * scale * 1.03;
            const k = i * 3, t = top * 3;
            const dx = pos[k] - pos[t], dy = pos[k + 1] - pos[t + 1], dz = pos[k + 2] - pos[t + 2];
            const d = Math.hypot(dx, dy, dz);
            if (d > maxD && d > 1e-6) { const s = maxD / d; pos[k] = pos[t] + dx * s; pos[k + 1] = pos[t + 1] + dy * s; pos[k + 2] = pos[t + 2] + dz * s; }
          }
        }
        // collision
        for (const cap of caps) {
          _v.copy(cap.a).applyMatrix4(modelWorld);
          _w.copy(cap.b).applyMatrix4(modelWorld);
          const rr = cap.r * scale + rad;
          const abx = _w.x - _v.x, aby = _w.y - _v.y, abz = _w.z - _v.z;
          const ab2 = abx * abx + aby * aby + abz * abz || 1e-9;
          for (let i = 0; i < this.n; i++) {
            if (i % rows < pinRows) continue;
            const k = i * 3;
            let t = ((pos[k] - _v.x) * abx + (pos[k + 1] - _v.y) * aby + (pos[k + 2] - _v.z) * abz) / ab2;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            const dx = pos[k] - (_v.x + abx * t), dy = pos[k + 1] - (_v.y + aby * t), dz = pos[k + 2] - (_v.z + abz * t);
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 < rr * rr && d2 > 1e-12) { const d = Math.sqrt(d2), s = (rr - d) / d; pos[k] += dx * s; pos[k + 1] += dy * s; pos[k + 2] += dz * s; }
          }
        }
      }
      // keep off the floor
      const floorY = this.lastRoot.y + 0.02 * scale;
      for (let i = 0; i < this.n; i++) if (pos[i * 3 + 1] < floorY) pos[i * 3 + 1] = floorY;
    }

    // world → model, write bones
    _mi.copy(modelWorld).invert();
    const M = this.model;
    for (let i = 0; i < this.n; i++) {
      const k = i * 3;
      if (!Number.isFinite(pos[k] + pos[k + 1] + pos[k + 2])) { this.fresh = true; return; }
      _v.set(pos[k], pos[k + 1], pos[k + 2]).applyMatrix4(_mi);
      M[k] = _v.x; M[k + 1] = _v.y; M[k + 2] = _v.z;
    }
    const b0 = this.def.bone0;
    for (let i = 0; i < this.n; i++) {
      const bone = this.bones[b0 + i];
      bone.position.set(M[i * 3], M[i * 3 + 1], M[i * 3 + 2]);
      this.frame(M, i, _qr);
      bone.quaternion.copy(_qr).multiply(this.restInv[i]);
    }
  }

  private link(i: number, j: number, restLen: number, iPinned: boolean, jPinned: boolean): void {
    const pos = this.pos;
    const a = i * 3, b = j * 3;
    const dx = pos[a] - pos[b], dy = pos[a + 1] - pos[b + 1], dz = pos[a + 2] - pos[b + 2];
    const d = Math.hypot(dx, dy, dz);
    if (d < 1e-7) return;
    const diff = (d - restLen) / d;
    const wi = iPinned ? 0 : 1, wj = jPinned ? 0 : 1;
    const sum = wi + wj;
    if (sum === 0) return;
    const si = (wi / sum) * diff, sj = (wj / sum) * diff;
    pos[a] -= dx * si; pos[a + 1] -= dy * si; pos[a + 2] -= dz * si;
    pos[b] += dx * sj; pos[b + 1] += dy * sj; pos[b + 2] += dz * sj;
  }
}

function dist(P: Float32Array, i: number, j: number): number {
  return Math.hypot(P[i * 3] - P[j * 3], P[i * 3 + 1] - P[j * 3 + 1], P[i * 3 + 2] - P[j * 3 + 2]);
}
