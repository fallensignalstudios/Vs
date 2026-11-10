/**
 * Cloth: capes, cloaks, mantles and coat tails.
 *
 * A panel is a small grid of particles (cols × rows). Each particle is a bone; the panel mesh is skinned
 * bilinearly to the four surrounding particles. The top row is pinned to a body bone and is written to its
 * target EVERY frame, whatever the frame time; the rest is a verlet simulation in WORLD space (so travel and
 * turns drag the cloth) that always integrates exactly up to the current frame (1–4 sub-steps of at most 1/60 s,
 * time-corrected), with stretch + bend constraints, a tether to the pin (cloth cannot stretch or explode),
 * air drag normal to the fabric, and collision against body capsules, a seat disc and the floor.
 * When time does not advance (pause, stasis) the panel is carried rigidly with the figure instead of being left
 * behind; a large jump of the root (teleport) resets it to its rest shape.
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
  /** vertical folds pressed into the mesh: [count across the panel, depth in metres at the hem] */
  folds?: readonly [number, number];
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
  const sub = b.detail >= 1 ? o.sub ?? 3 : Math.max(1, Math.round((o.sub ?? 3) * Math.max(0.34, b.detail)));
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
  // decide which face is the outside: the one whose normal points away from the body axis at the panel centre
  let flip = 1;
  {
    const c = o.at(0.5, 0.5), cu = o.at(0.6, 0.5), cv = o.at(0.5, 0.6);
    const ux = cu[0] - c[0], uy = cu[1] - c[1], uz = cu[2] - c[2], vx = cv[0] - c[0], vy = cv[1] - c[1], vz = cv[2] - c[2];
    const nx = uy * vz - uz * vy, nz = ux * vy - uy * vx;
    if (nx * c[0] + nz * c[2] < 0) flip = -1;
  }
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
        const nl = (Math.hypot(nx, ny, nz) || 1) * flip;
        nx /= nl; ny /= nl; nz /= nl;
        const edgeDist = Math.min(u * width, (1 - u) * width, (1 - v) * height);
        const isTrim = tw > 0 && edgeDist < tw;
        // folds deepen toward the hem; they live in the mesh, so they bend and swing with the particles
        const fold = o.folds ? Math.sin(u * Math.PI * o.folds[0] + 0.6) * o.folds[1] * Math.pow(v, 0.8) * Math.min(1, edgeFade(u) * 4) : 0;
        const off = (side === 0 ? thick * 0.5 : -thick * 0.5) + fold;
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
  b.group('cloth', () => {
    b.push();
    b.matrix.identity();
    b.surf(base);
    b.commit(prim, [base, o.trim ? { part: PART.cloth, ...o.trim } : base, o.lining ? { part: PART.cloth, rough: 0.85, ...o.lining } : { ...base, color: darken(base.color, 0.6) }]);
    b.pop();
  });
  return { cols, rows, rest, bone0, pin, pinRows: o.pinRows ?? 1, shape: o.shape ?? 0.12, damping: o.damping ?? 0.04, radius: 0.028 };
}

function edgeFade(u: number): number { return Math.min(u, 1 - u); }

function darken(hex: number, k: number): number {
  const r = Math.round(((hex >> 16) & 255) * k), g = Math.round(((hex >> 8) & 255) * k), bl = Math.round((hex & 255) * k);
  return (r << 16) | (g << 8) | bl;
}

/** A capsule in model space the cloth must stay outside of. */
export interface ClothCapsule { a: THREE.Vector3; b: THREE.Vector3; r: number }

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
const _m = new THREE.Matrix4(), _mi = new THREE.Matrix4(), _d = new THREE.Matrix4();
const _q = new THREE.Quaternion(), _qr = new THREE.Quaternion();
/** longest sub-step; a frame is split into ≤ MAX_SUB steps of at most this */
const STEP = 1 / 60;
const MAX_SUB = 4;
const ITERATIONS = 4;
const MAX_CAPS = 16;

export class ClothSim {
  private readonly n: number;
  private readonly pos: Float32Array;
  private readonly prev: Float32Array;
  private readonly model: Float32Array;
  /** rest-shape targets under the current / previous skeleton (world space) */
  private readonly target: Float32Array;
  private readonly targetPrev: Float32Array;
  private readonly nrm: Float32Array;
  private readonly capW = new Float32Array(MAX_CAPS * 7);
  private readonly restInv: THREE.Quaternion[] = [];
  private fresh = true;
  private hPrev = STEP;
  private readonly lastWorld = new THREE.Matrix4();
  private readonly lastRoot = new THREE.Vector3();
  private readonly restLen: { v: Float32Array; h: Float32Array; v2: Float32Array; h2: Float32Array; tether: Float32Array };
  private time = 0;
  /**
   * Seat disc in MODEL space: particles within `r` of (x, z) are kept above `y` (sitting on a chair or the
   * floor). r = 0 disables it.
   */
  readonly seat = { x: 0, y: 0, z: 0, r: 0 };

  constructor(readonly def: ClothDef, private readonly bones: THREE.Bone[], private readonly seed = 0) {
    const { cols, rows, rest } = def;
    this.n = cols * rows;
    this.pos = new Float32Array(this.n * 3);
    this.prev = new Float32Array(this.n * 3);
    this.model = new Float32Array(rest);
    this.target = new Float32Array(this.n * 3);
    this.targetPrev = new Float32Array(this.n * 3);
    this.nrm = new Float32Array(this.n * 3);
    const v = new Float32Array(this.n), h = new Float32Array(this.n), v2 = new Float32Array(this.n), h2 = new Float32Array(this.n), tether = new Float32Array(this.n);
    for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) {
      const i = c * rows + r;
      if (r > 0) v[i] = dist(rest, i, i - 1);
      if (c > 0) h[i] = dist(rest, i, i - rows);
      if (r > 1) v2[i] = dist(rest, i, i - 2);
      if (c > 1) h2[i] = dist(rest, i, i - 2 * rows);
      // tether: path length from the pinned row
      tether[i] = r === 0 ? 0 : tether[i - 1] + v[i];
    }
    this.restLen = { v, h, v2, h2, tether };
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
   * @param dt simulated seconds this frame (0 = time is stopped: the panel rides the figure rigidly)
   * @param modelWorld model→world matrix of the figure
   * @param jointPos/jointQuat model-space transforms of the body bones (from the solver)
   * @param caps collision capsules in model space
   * @param carry 0..1 share of the figure's own motion the cloth follows rigidly (stasis: 1 = arrested with it)
   */
  update(dt: number, modelWorld: THREE.Matrix4, jointPos: THREE.Vector3[], jointQuat: THREE.Quaternion[], rigRest: number[], caps: ClothCapsule[], scale: number, carry = 0): void {
    const { rows, rest, pin, pinRows } = this.def;
    const pos = this.pos, prev = this.prev, n = this.n;
    if (!(dt > 0)) dt = 0;
    carry = carry > 0 ? Math.min(1, carry) : 0;
    // teleport detection
    _v.setFromMatrixPosition(modelWorld);
    const jump = _v.distanceTo(this.lastRoot);
    this.lastRoot.copy(_v);
    if (jump > 2.5 * scale || !Number.isFinite(jump)) this.fresh = true;

    // rest-shape targets under the current skeleton, in world space (computed once per frame)
    const tg = this.target, tp = this.targetPrev;
    tp.set(tg);
    for (let i = 0; i < n; i++) {
      const bn = pin[Math.floor(i / rows)];
      _v.set(rest[i * 3] - rigRest[bn * 3], rest[i * 3 + 1] - rigRest[bn * 3 + 1], rest[i * 3 + 2] - rigRest[bn * 3 + 2]).applyQuaternion(jointQuat[bn]).add(jointPos[bn]).applyMatrix4(modelWorld);
      tg[i * 3] = _v.x; tg[i * 3 + 1] = _v.y; tg[i * 3 + 2] = _v.z;
    }

    if (this.fresh) {
      pos.set(tg); prev.set(tg); tp.set(tg);
      this.fresh = false;
      this.hPrev = STEP;
    } else {
      // time that does not advance for the cloth: ride the figure's rigid motion instead of staying behind
      const rigid = dt <= 1e-6 ? 1 : carry;
      if (rigid > 0) {
        _d.copy(this.lastWorld).invert().premultiply(modelWorld);
        for (let i = 0; i < n; i++) {
          const k = i * 3;
          _v.set(pos[k], pos[k + 1], pos[k + 2]); _w.copy(_v).applyMatrix4(_d);
          pos[k] += (_w.x - _v.x) * rigid; pos[k + 1] += (_w.y - _v.y) * rigid; pos[k + 2] += (_w.z - _v.z) * rigid;
          _v.set(prev[k], prev[k + 1], prev[k + 2]); _w.copy(_v).applyMatrix4(_d);
          prev[k] += (_w.x - _v.x) * rigid; prev[k + 1] += (_w.y - _v.y) * rigid; prev[k + 2] += (_w.z - _v.z) * rigid;
        }
      }
    }
    this.lastWorld.copy(modelWorld);

    const sim = dt * (1 - carry);
    if (sim > 1e-6) {
      const steps = Math.min(MAX_SUB, Math.max(1, Math.ceil(sim / STEP - 1e-6)));
      const h = Math.min(STEP, sim / steps);
      // capsules → world, once per frame
      const nc = Math.min(caps.length, MAX_CAPS), cw = this.capW;
      const rad = this.def.radius * scale;
      for (let c = 0; c < nc; c++) {
        const cap = caps[c];
        _v.copy(cap.a).applyMatrix4(modelWorld); _w.copy(cap.b).applyMatrix4(modelWorld);
        cw[c * 7] = _v.x; cw[c * 7 + 1] = _v.y; cw[c * 7 + 2] = _v.z; cw[c * 7 + 3] = _w.x; cw[c * 7 + 4] = _w.y; cw[c * 7 + 5] = _w.z; cw[c * 7 + 6] = cap.r > 0 ? cap.r * scale + rad : 0;
      }
      const seat = this.seat;
      let seatOn = false, sx = 0, sy = 0, sz = 0, sr2 = 0;
      if (seat.r > 0) { _v.set(seat.x, seat.y, seat.z).applyMatrix4(modelWorld); sx = _v.x; sy = _v.y + rad; sz = _v.z; sr2 = seat.r * seat.r * scale * scale; seatOn = true; }
      const floorY = this.lastRoot.y + 0.02 * scale;
      for (let s = 1; s <= steps; s++) this.step(h, s / steps, scale, nc, floorY, seatOn, sx, sy, sz, sr2);
    }
    // the pinned rows sit exactly on the body, whether or not anything was simulated
    for (let i = 0; i < n; i++) {
      if (i % rows >= pinRows) continue;
      const k = i * 3;
      prev[k] = pos[k] = tg[k]; prev[k + 1] = pos[k + 1] = tg[k + 1]; prev[k + 2] = pos[k + 2] = tg[k + 2];
    }

    // world → model, write bones
    _mi.copy(modelWorld).invert();
    const M = this.model;
    for (let i = 0; i < n; i++) {
      const k = i * 3;
      if (!Number.isFinite(pos[k] + pos[k + 1] + pos[k + 2])) { this.fresh = true; return; }
      _v.set(pos[k], pos[k + 1], pos[k + 2]).applyMatrix4(_mi);
      M[k] = _v.x; M[k + 1] = _v.y; M[k + 2] = _v.z;
    }
    const b0 = this.def.bone0;
    for (let i = 0; i < n; i++) {
      const bone = this.bones[b0 + i];
      bone.position.set(M[i * 3], M[i * 3 + 1], M[i * 3 + 2]);
      this.frame(M, i, _qr);
      bone.quaternion.copy(_qr).multiply(this.restInv[i]);
    }
  }

  /** One sub-step of `h` seconds; `a` = how far through the frame it ends (pins move with the body). */
  private step(h: number, a: number, scale: number, nc: number, floorY: number, seatOn: boolean, sx: number, sy: number, sz: number, sr2: number): void {
    const { cols, rows, pinRows } = this.def;
    const pos = this.pos, prev = this.prev, tg = this.target, tp = this.targetPrev, nrm = this.nrm, n = this.n;
    const { v: lv, h: lh, v2, h2, tether } = this.restLen;
    const ratio = h / this.hPrev;
    this.hPrev = h;
    this.time += h;
    const kStep = h / STEP;
    const damp = Math.pow(1 - this.def.damping, kStep);
    const air = 1 - Math.exp(-5.5 * h);
    const g = -9.8 * scale * 0.9 * h * h;
    this.normals();
    for (let i = 0; i < n; i++) {
      const r = i % rows, k = i * 3;
      if (r < pinRows) {
        prev[k] = pos[k]; prev[k + 1] = pos[k + 1]; prev[k + 2] = pos[k + 2];
        pos[k] = tp[k] + (tg[k] - tp[k]) * a; pos[k + 1] = tp[k + 1] + (tg[k + 1] - tp[k + 1]) * a; pos[k + 2] = tp[k + 2] + (tg[k + 2] - tp[k + 2]) * a;
        continue;
      }
      let vx = (pos[k] - prev[k]) * ratio * damp, vy = (pos[k + 1] - prev[k + 1]) * ratio * damp, vz = (pos[k + 2] - prev[k + 2]) * ratio * damp;
      // still air resists motion ACROSS the fabric: a moving wearer makes the panel trail and lift
      const vn = (vx * nrm[k] + vy * nrm[k + 1] + vz * nrm[k + 2]) * air;
      vx -= nrm[k] * vn; vy -= nrm[k + 1] * vn; vz -= nrm[k + 2] * vn;
      prev[k] = pos[k]; prev[k + 1] = pos[k + 1]; prev[k + 2] = pos[k + 2];
      const speed = Math.hypot(vx, vy, vz) / (h * scale);
      // a little turbulence keeps hanging cloth alive; more of it in an air stream
      const fl = Math.sin(this.time * 2.3 + i * 1.7 + this.seed) * (0.35 + Math.min(3, speed) * 0.5) * scale * (r / rows) * h * h;
      pos[k] += vx + fl; pos[k + 1] += vy + g; pos[k + 2] += vz + fl * 0.6;
      // pull toward the rest shape (weave stiffness / hidden weights); it lets go as the cloth starts to fly
      if (this.def.shape > 0) {
        const base = this.def.shape * (1 - 0.6 * (r / (rows - 1))) / (1 + speed * speed * 0.16);
        const s = 1 - Math.pow(1 - Math.min(0.95, base), kStep);
        pos[k] += (tg[k] - pos[k]) * s; pos[k + 1] += (tg[k + 1] - pos[k + 1]) * s; pos[k + 2] += (tg[k + 2] - pos[k + 2]) * s;
      }
    }
    const cw = this.capW;
    for (let it = 0; it < ITERATIONS; it++) {
      // bending: skip-one links resist creasing softly and forbid folding flat
      for (let c = 0; c < cols; c++) for (let r = 2; r < rows; r++) { const i = c * rows + r; this.bend(i, i - 2, v2[i] * scale, r < pinRows, r - 2 < pinRows); }
      for (let c = 2; c < cols; c++) for (let r = pinRows; r < rows; r++) { const i = c * rows + r; this.bend(i, i - 2 * rows, h2[i] * scale, false, false); }
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
      for (let c = 0; c < nc; c++) {
        const o = c * 7, rr = cw[o + 6];
        if (rr <= 0) continue;
        const ax = cw[o], ay = cw[o + 1], az = cw[o + 2];
        const abx = cw[o + 3] - ax, aby = cw[o + 4] - ay, abz = cw[o + 5] - az;
        const ab2 = abx * abx + aby * aby + abz * abz || 1e-9;
        for (let i = 0; i < n; i++) {
          if (i % rows < pinRows) continue;
          const k = i * 3;
          let t = ((pos[k] - ax) * abx + (pos[k + 1] - ay) * aby + (pos[k + 2] - az) * abz) / ab2;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const dx = pos[k] - (ax + abx * t), dy = pos[k + 1] - (ay + aby * t), dz = pos[k + 2] - (az + abz * t);
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < rr * rr && d2 > 1e-12) { const d = Math.sqrt(d2), s = (rr - d) / d; pos[k] += dx * s; pos[k + 1] += dy * s; pos[k + 2] += dz * s; }
        }
      }
    }
    // seat + floor
    for (let i = 0; i < n; i++) {
      const k = i * 3;
      if (seatOn && pos[k + 1] < sy) { const dx = pos[k] - sx, dz = pos[k + 2] - sz; if (dx * dx + dz * dz < sr2) pos[k + 1] = sy; }
      if (pos[k + 1] < floorY) pos[k + 1] = floorY;
    }
  }

  /** per-particle surface normals from the grid neighbours (world space) */
  private normals(): void {
    const { cols, rows } = this.def;
    const P = this.pos, N = this.nrm;
    for (let i = 0; i < this.n; i++) {
      const c = Math.floor(i / rows), r = i % rows;
      const up = (r > 0 ? i - 1 : i) * 3, dn = (r < rows - 1 ? i + 1 : i) * 3;
      const lf = (c > 0 ? i - rows : i) * 3, rt = (c < cols - 1 ? i + rows : i) * 3;
      const ux = P[rt] - P[lf], uy = P[rt + 1] - P[lf + 1], uz = P[rt + 2] - P[lf + 2];
      const vx = P[dn] - P[up], vy = P[dn + 1] - P[up + 1], vz = P[dn + 2] - P[up + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz);
      const k = i * 3;
      if (l > 1e-9) { N[k] = nx / l; N[k + 1] = ny / l; N[k + 2] = nz / l; } else { N[k] = 0; N[k + 1] = 0; N[k + 2] = 0; }
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

  /** Skip-one constraint: soft toward its rest length, hard below 70 % of it (no fold-over). */
  private bend(i: number, j: number, restLen: number, iPinned: boolean, jPinned: boolean): void {
    const pos = this.pos;
    const a = i * 3, b = j * 3;
    const dx = pos[a] - pos[b], dy = pos[a + 1] - pos[b + 1], dz = pos[a + 2] - pos[b + 2];
    const d = Math.hypot(dx, dy, dz);
    if (d < 1e-7 || d >= restLen) return;
    const min = restLen * 0.7;
    const want = d < min ? min : d + (restLen - d) * 0.12;
    const diff = (d - want) / d;
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
