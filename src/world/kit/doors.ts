/**
 * Doors and isolation barriers — the kit's animated, collider-toggling pieces.
 * Door local frame: the opening spans local X, the passage runs along Z (yawDeg 0 = a door you walk through
 * heading north). Leaves slide apart into the wall on either side.
 */
import * as THREE from 'three';
import type { BarrierHandle, ColliderHandle, DoorHandle, DoorOpts } from '@/core/api';
import { clamp01 } from '@/core/mathx';
import { KitCtx, Part } from './core';

type DoorStyle = NonNullable<DoorOpts['style']>;
type DoorState = 'locked' | 'ready' | 'open' | 'sealed';

const OPEN_SECONDS = 0.8;
const STATE_LIGHT: Record<DoorState, { color: number; intensity: number; pulse: number }> = {
  locked: { color: 0xff4326, intensity: 2.6, pulse: 0 },
  ready: { color: 0xffc56b, intensity: 3.2, pulse: 0.45 },
  open: { color: 0xfff0d2, intensity: 4.2, pulse: 0 },
  sealed: { color: 0xa8d8ff, intensity: 1.6, pulse: 0 },
};

interface FrameDims { W: number; H: number; jw: number; hh: number; fd: number; lt: number }

function emitFrame(p: Part, style: DoorStyle, f: FrameDims): void {
  const { W, H, jw, hh, fd } = f, ctx = p.ctx;
  const service = style === 'service';
  const wg = p.g('whiteGold'), trim = p.g('goldTrim'), dk = p.g('goldDark');
  for (const s of [-1, 1]) {
    const jx = s * (W / 2 + jw / 2);
    wg.cboxOn(jw, H + hh, fd, 0.05, jx, 0, 0);
    wg.tbox(jw + 0.16, 0.5, fd + 0.16, 0.05, jx, 0, 0);
    trim.box(jw + 0.18, 0.04, fd + 0.18, jx, 0.54, 0);
    if (!service) trim.box(0.07, H - 0.9, fd + 0.02, jx, H / 2 + 0.25, 0);
    dk.box(0.04, H, fd - 0.24, s * (W / 2 + 0.015), H / 2, 0);
  }
  wg.cbox(W + 2 * jw + 0.3, hh, fd + 0.1, 0.06, 0, H + hh / 2, 0);
  trim.box(W + 2 * jw + 0.1, 0.045, fd + 0.12, 0, H + 0.1, 0);
  dk.box(W, 0.04, fd - 0.24, 0, H - 0.015, 0);
  // threshold plate with channel lines across the passage
  dk.boxOn(W, 0.018, fd, 0, 0, 0);
  for (const z of [-fd * 0.28, fd * 0.28]) p.g(ctx.inlay('goldChannel')).ribbon([[-W / 2 + 0.1, 0.024, z], [W / 2 - 0.1, 0.024, z]], 0.05);
  if (style === 'ancient' || style === 'threshold') {
    trim.push().move(0, H + hh + 0.04, 0).rotZ(Math.PI / 4).cbox(0.46, 0.46, fd + 0.16, 0.05).pop();
    dk.push().move(0, H + hh + 0.04, 0).rotZ(Math.PI / 4).box(0.22, 0.22, fd + 0.2).pop();
  }
  if (style === 'threshold') {
    // the ancient gold-inlaid threshold: flanking pylons and an angular inlay carpet on both sides
    for (const s of [-1, 1]) {
      const px = s * (W / 2 + jw + 0.75);
      wg.tbox(1.1, 0.4, 1.1, 0.06, px, 0, 0).taperOn(0.8, 0.8, 0.55, 0.55, H + 1.2, px, 0.4, 0, true);
      trim.taperOn(0.6, 0.6, 0.2, 0.2, 0.3, px, H + 1.6, 0);
      for (const z of [-1, 1]) p.g(ctx.inlay('goldChannel')).ribbon([[px, 0.9, z * 0.36], [px, H + 1.2, z * 0.3]], 0.06, [0, 0.02, z]);
    }
    const ch = p.g(ctx.inlay('goldChannel')), tr = p.g(ctx.inlay('goldTrim'));
    for (const z of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const k = fd / 2 + 0.35 + i * 0.5, hwk = W / 2 + 0.3 - i * 0.35;
        (i === 1 ? tr : ch).ribbon([[-hwk - 0.4, 0.007, z * (k - 0.4)], [-hwk, 0.007, z * k], [hwk, 0.007, z * k], [hwk + 0.4, 0.007, z * (k - 0.4)]], 0.05);
      }
    }
  } else if (style === 'quarantine') {
    for (const s of [-1, 1]) {
      const jx = s * (W / 2 + jw + 0.28);
      wg.prismZ([[jx - s * 0.3, 0], [jx + s * 0.45, 0], [jx - s * 0.3, H * 0.8]], fd * 0.7, 0);
      for (const z of [-1, 1]) p.g('whiteLight').box(0.07, H * 0.5, 0.03, s * (W / 2 + jw / 2), H * 0.55, z * (fd / 2 + 0.012));
    }
    dk.box(W + 2 * jw + 0.5, 0.16, fd + 0.2, 0, H + hh + 0.08, 0);
  }
}

function emitLeaf(p: Part, style: DoorStyle, side: number, lw: number, H: number, lt: number): void {
  const inner = -side * (lw / 2);
  if (style === 'service') {
    p.g('goldDark').cbox(lw, H, lt, 0.02, 0, H / 2, 0);
    for (const y of [0.22, 0.5, 0.78]) p.g('whiteGold').box(lw - 0.2, 0.14, lt + 0.05, 0, H * y, 0);
    p.g('goldChannel').box(0.035, H * 0.3, lt + 0.012, inner + side * 0.05, H * 0.5, 0);
    return;
  }
  if (style === 'quarantine') {
    p.g('whiteGold').cbox(lw, H, lt, 0.04, 0, H / 2, 0);
    for (const y of [0.16, 0.84]) p.g('goldDark').box(lw - 0.1, 0.22, lt + 0.08, 0, H * y, 0);
    for (const y of [0.36, 0.5, 0.64]) {
      p.g('goldTrim').push().move(0, H * y, 0).rotZ(side * 0.55).box(lw * 0.72, 0.09, lt + 0.05).pop();
    }
    p.g('whiteLight').box(0.05, H * 0.6, lt + 0.012, inner + side * 0.07, H * 0.5, 0);
    return;
  }
  if (style === 'threshold') {
    p.g('goldDark').cbox(lw, H, lt, 0.03, 0, H / 2, 0);
    p.g('whiteGold').box(lw - 0.3, 0.18, lt + 0.04, 0, 0.3, 0).box(lw - 0.3, 0.18, lt + 0.04, 0, H - 0.3, 0);
    for (const k of [-0.25, 0, 0.25]) p.g('goldChannel').box(0.05, H - 0.9, lt + 0.012, lw * k, H / 2, 0);
    return;
  }
  // ancient: white-gold slab, gold border, a great ring split across the two leaves
  p.g('whiteGold').cbox(lw, H, lt, 0.03, 0, H / 2, 0);
  const trim = p.g('goldTrim');
  trim.box(0.05, H - 0.34, lt + 0.02, side * (lw / 2 - 0.14), H / 2, 0);
  trim.box(lw - 0.3, 0.05, lt + 0.02, side * 0.02, 0.2, 0).box(lw - 0.3, 0.05, lt + 0.02, side * 0.02, H - 0.2, 0);
  const R = Math.min(lw * 0.82, H * 0.3), a0 = side < 0 ? Math.PI : 0, a1 = a0 + Math.PI;
  trim.push().move(inner, H * 0.56, 0).rotX(Math.PI / 2).arcBand(R - 0.09, R, a0, a1, -lt / 2 - 0.015, lt / 2 + 0.015, 14, { bottom: true }).pop();
  p.g('goldDark').push().move(inner, H * 0.56, 0).rotX(Math.PI / 2).arcBand(R * 0.5, R * 0.62, a0, a1, -lt / 2 - 0.01, lt / 2 + 0.01, 10, { bottom: true }).pop();
  p.g('goldChannel').box(0.035, R * 1.1, lt + 0.014, inner + side * 0.03, H * 0.56, 0);
}

class Door implements DoorHandle {
  readonly object = new THREE.Group();
  readonly pos: THREE.Vector3;
  readonly collider: ColliderHandle | null;
  private t: number;
  private target: number;
  private state: DoorState;
  private readonly leaves: THREE.Object3D[] = [];
  private readonly bolts: THREE.Object3D[] = [];
  private readonly light: THREE.MeshStandardMaterial;
  private readonly slide: number;
  private readonly lw: number;

  constructor(private readonly ctx: KitCtx, o: DoorOpts) {
    const style: DoorStyle = o.style === 'service' || o.style === 'quarantine' || o.style === 'threshold' ? o.style : 'ancient';
    const W = ctx.num(o.width, 3, 1, 12), H = ctx.num(o.height, 3.5, 1.8, 12);
    const heavy = style === 'quarantine';
    const f: FrameDims = { W, H, jw: style === 'service' ? 0.38 : heavy ? 0.7 : 0.5, hh: heavy ? 0.7 : 0.55, fd: style === 'service' ? 0.84 : heavy ? 1.2 : 0.96, lt: heavy ? 0.3 : 0.2 };
    this.pos = ctx.P(ctx.num(o.x, 0), ctx.num(o.n, 0), ctx.num(o.h, 0));
    const yaw = ctx.yaw(ctx.num(o.yawDeg, 0));
    this.object.name = `door-${style}`;
    ctx.root.add(this.object);

    const frame = new Part(ctx, 'door-frame', this.pos, yaw);
    emitFrame(frame, style, f);
    frame.done(this.object);

    const mover = new THREE.Group();
    mover.position.copy(this.pos);
    mover.rotation.y = yaw;
    this.object.add(mover);

    this.light = ctx.clone<THREE.MeshStandardMaterial>('whiteLight', { objectSpace: true });
    const lamp = new Part(ctx, 'door-light', new THREE.Vector3(), 0, { local: true });
    for (const z of [-1, 1]) lamp.g(this.light).box(W * 0.42, 0.075, 0.03, 0, H + f.hh * 0.55, z * (f.fd / 2 + 0.065));
    lamp.done(mover);

    this.lw = W / 2;
    this.slide = this.lw * 0.97;
    const hasLeaves = !o.frameOnly;
    if (hasLeaves) {
      for (const side of [-1, 1]) {
        const leaf = new Part(ctx, 'door-leaf', new THREE.Vector3(side * (W / 4), 0, 0), 0, { local: true });
        emitLeaf(leaf, style, side, this.lw, H, f.lt);
        this.leaves.push(leaf.done(mover));
      }
      const ys = [0.5, 0.28, 0.72];
      for (let i = 0; i < 3; i++) {
        const bolt = new Part(ctx, 'door-bolt', new THREE.Vector3(0, H * ys[i], 0), 0, { local: true });
        bolt.g('goldDark').cbox(Math.min(1.3, W * 0.4), 0.2, f.lt + 0.14, 0.03);
        bolt.g(this.light).box(Math.min(0.5, W * 0.16), 0.06, f.lt + 0.16);
        this.bolts.push(bolt.done(mover));
      }
      this.collider = ctx.collider(frame.pose.box(0, H / 2, 0, W / 2, H / 2, 0.25, { tag: 'door' }));
    } else {
      this.collider = null;
    }
    const open = !hasLeaves || !!o.open;
    this.t = this.target = open ? 1 : 0;
    this.state = open ? 'open' : 'ready';
    if (this.collider) this.collider.enabled = !open;
    this.apply(0);
    if (hasLeaves) ctx.updaters.push((dt, time) => this.update(dt, time));
  }

  get isOpen(): boolean { return this.target === 1; }

  setOpen(open: boolean, opts?: { instant?: boolean; silent?: boolean }): void {
    const target = open ? 1 : 0;
    if (!this.leaves.length || (target === this.target && !opts?.instant)) return;
    const changed = target !== this.target;
    this.target = target;
    if (changed && !opts?.silent) this.ctx.audio(open ? 'doorOpen' : 'doorClose', this.pos);
    if (this.state === 'ready' && open) this.state = 'open';
    else if (this.state === 'open' && !open) this.state = 'ready';
    if (opts?.instant) this.t = target;
    // closing blocks at once; opening frees the way once the leaves are half apart
    if (!open || opts?.instant) this.setBlocked(!open);
    this.apply(0);
  }

  setState(state: DoorState): void {
    if (!(state in STATE_LIGHT)) { this.ctx.warn(`door-state:${String(state)}`, `door.setState: unknown state "${String(state)}"`); return; }
    this.state = state;
    this.apply(0);
  }

  private setBlocked(blocked: boolean): void {
    const c = this.collider;
    if (!c || c.enabled === blocked) return;
    c.enabled = blocked;
    this.ctx.navChanged();
  }

  private update(dt: number, time: number): void {
    if (this.t !== this.target) {
      const step = dt / OPEN_SECONDS;
      this.t = this.target > this.t ? Math.min(1, this.t + step) : Math.max(0, this.t - step);
      if (this.target === 1 && this.t >= 0.5) this.setBlocked(false);
      this.apply(time);
    } else if (STATE_LIGHT[this.state].pulse > 0) {
      this.apply(time);
    }
  }

  private apply(time: number): void {
    const e = this.t * this.t * (3 - 2 * this.t);
    for (let i = 0; i < this.leaves.length; i++) {
      const side = i === 0 ? -1 : 1;
      this.leaves[i].position.x = side * (this.lw / 2 + e * this.slide);
    }
    const closed = this.t < 0.04;
    const s = STATE_LIGHT[this.state];
    if (this.bolts.length) {
      this.bolts[0].visible = closed && (this.state === 'locked' || this.state === 'sealed');
      this.bolts[1].visible = this.bolts[2].visible = closed && this.state === 'sealed';
    }
    this.light.emissive.setHex(s.color);
    this.light.emissiveIntensity = s.intensity * (1 - s.pulse * (0.5 + 0.5 * Math.sin(time * 3.2)));
  }
}

export function buildDoor(ctx: KitCtx, o: DoorOpts): DoorHandle {
  return new Door(ctx, o ?? ({} as DoorOpts));
}

class Barrier implements BarrierHandle {
  readonly object: THREE.Group;
  private amount: number;
  private target: number;
  private readonly mat: THREE.Material;
  private readonly wall: THREE.Mesh;
  private readonly glow: THREE.PointLight;
  private readonly collider: ColliderHandle;
  private readonly mid: THREE.Vector3;

  constructor(private readonly ctx: KitCtx, o: { from: [number, number]; to: [number, number]; h?: number; height?: number; active?: boolean }) {
    const h = ctx.num(o.h, 0), H = ctx.num(o.height, 4, 1, 30);
    const a = ctx.P(o.from[0], o.from[1], h), b = ctx.P(o.to[0], o.to[1], h);
    const L = Math.max(0.5, Math.hypot(b.x - a.x, b.z - a.z)), ry = Math.atan2(-(b.z - a.z), b.x - a.x);
    this.object = new THREE.Group();
    this.object.name = 'barrier';
    ctx.root.add(this.object);
    this.mid = a.clone().lerp(b, 0.5).setY(h + H * 0.5);

    // emitter posts + floor rail (static)
    const fx = new Part(ctx, 'barrier-emitters', a, ry);
    for (const px of [0, L]) {
      fx.g('whiteGold').tbox(0.62, 0.3, 0.62, 0.05, px, 0, 0).vbox(0.4, H + 0.1, 0.4, 0.06, px, 0.3, 0);
      fx.g('goldTrim').tbox(0.5, 0.12, 0.5, 0.05, px, H + 0.4, 0).box(0.44, 0.04, 0.44, px, 0.36, 0);
      const inward = px === 0 ? 1 : -1;
      fx.g('whiteLight').box(0.03, H - 0.5, 0.1, px + inward * 0.205, H / 2 + 0.3, 0);
    }
    fx.g('goldDark').boxOn(L - 0.4, 0.05, 0.34, L / 2, 0, 0);
    fx.g(ctx.inlay('whiteLight')).ribbon([[0.3, 0.056, 0], [L - 0.3, 0.056, 0]], 0.07);
    fx.done(this.object);

    // the light wall itself (dynamic: its material is animated)
    this.mat = ctx.clone<THREE.Material>('quarantineBarrier');
    const sheet = new Part(ctx, 'barrier-wall', a, ry, { local: true });
    sheet.g(this.mat).quad([0.2, 0.06, 0], [L - 0.2, 0.06, 0], [L - 0.2, H + 0.25, 0], [0.2, H + 0.25, 0]);
    const grp = sheet.done(this.object);
    this.wall = grp.children[0] as THREE.Mesh;
    this.wall.renderOrder = 6;
    this.wall.castShadow = false;

    this.glow = new THREE.PointLight(0xffe2a8, 0, Math.max(8, L * 1.2), 2);
    this.glow.position.copy(this.mid);
    this.object.add(this.glow);
    ctx.lights.push(this.glow);

    this.collider = ctx.collider(fx.pose.box(L / 2, H / 2, 0, L / 2, H / 2, 0.15, { blocksSight: false, tag: 'barrier' }));
    const on = o.active !== false;
    this.amount = this.target = on ? 1 : 0;
    this.collider.enabled = on;
    this.apply();
    ctx.updaters.push((dt) => this.update(dt));
  }

  get active(): boolean { return this.target === 1; }

  setActive(active: boolean, opts?: { instant?: boolean }): void {
    const target = active ? 1 : 0;
    if (target === this.target && !opts?.instant) return;
    if (target !== this.target) this.ctx.audio(active ? 'barrierUp' : 'barrierDown', this.mid);
    this.target = target;
    if (opts?.instant) this.amount = target;
    if (active || opts?.instant) this.setBlocked(active);
    this.apply();
  }

  private setBlocked(blocked: boolean): void {
    if (this.collider.enabled === blocked) return;
    this.collider.enabled = blocked;
    this.ctx.navChanged();
  }

  private update(dt: number): void {
    if (this.amount === this.target) return;
    const step = dt / 0.6;
    this.amount = this.target > this.amount ? Math.min(1, this.amount + step) : Math.max(0, this.amount - step);
    if (this.target === 0 && this.amount < 0.3) this.setBlocked(false);
    this.apply();
  }

  private apply(): void {
    const a = clamp01(this.amount);
    this.ctx.setParam(this.mat, 'amount', a);
    this.wall.visible = a > 0.002;
    this.glow.intensity = 14 * a;
    this.glow.visible = a > 0.002;
  }
}

export function buildBarrier(ctx: KitCtx, o: { from: [number, number]; to: [number, number]; h?: number; height?: number; active?: boolean }): BarrierHandle {
  return new Barrier(ctx, o);
}
