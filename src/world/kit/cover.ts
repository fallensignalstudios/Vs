/**
 * Cover — 1.2 m low / 2.2 m high, five visual families. Colliders are tagged `cover: 'low' | 'high'`.
 * Local frame: the long side runs along X, the protected sides are ±Z.
 */
import * as THREE from 'three';
import type { CoverOpts } from '@/core/api';
import type { V2 } from './geo';
import { KitCtx, Part } from './core';

export const COVER_LOW = 1.2;
export const COVER_HIGH = 2.2;

type CoverStyle = NonNullable<CoverOpts['style']>;

function ancient(p: Part, w: number, d: number, H: number): void {
  const wg = p.g('whiteGold'), trim = p.g('goldTrim'), dk = p.g('goldDark'), ch = p.g(p.ctx.inlay('goldChannel'));
  wg.tbox(w, 0.2, d, 0.04, 0, 0, 0).tbox(w - 0.14, H - 0.4, d - 0.14, 0.03, 0, 0.2, 0).tbox(w, 0.2, d, 0.05, 0, H - 0.2, 0);
  trim.box(w - 0.08, 0.045, d - 0.08, 0, H - 0.27, 0).box(w - 0.08, 0.035, d - 0.08, 0, 0.26, 0);
  const rows = H > 1.6 ? 2 : 1, ph = (H - 0.75) / rows;
  for (let r = 0; r < rows; r++) {
    const y = 0.36 + ph * r + (ph - 0.08) / 2;
    for (const s of [-1, 1]) {
      dk.box(w * 0.72, ph - 0.14, 0.03, 0, y, s * (d / 2 - 0.06));
      ch.ribbon([[-w * 0.3, y, s * (d / 2 - 0.042)], [w * 0.3, y, s * (d / 2 - 0.042)]], 0.045, [0, 0, s]);
    }
  }
  for (const s of [-1, 1]) dk.box(0.03, H - 0.62, d * 0.5, s * (w / 2 - 0.06), H / 2, 0);
}

function dominion(p: Part, w: number, d: number, H: number): void {
  const blk = p.g('domBlack'), brz = p.g('domBronze'), ox = p.g('domOxblood'), amb = p.g('domAmberGlow');
  const hd = d / 2, tw = Math.min(0.2, hd * 0.5);
  const trap = (grow: number, top: number): V2[] => [[-hd - grow, 0], [hd + grow, 0], [tw + grow, top], [-tw - grow, top]];
  blk.prismX(trap(0, H - 0.06), w - 0.28, 0);
  for (const s of [-1, 1]) {
    brz.prismX(trap(0.05, H), 0.16, s * (w / 2 - 0.08));
    brz.prismX([[-hd - 0.32, 0], [hd + 0.32, 0], [hd * 0.4, 0.34], [-hd * 0.4, 0.34]], 0.1, s * (w / 2 - 0.3));
  }
  brz.box(w - 0.2, 0.09, tw * 2 + 0.12, 0, H - 0.02, 0);
  // oxblood plates laid on both sloped faces, amber louvre near the crest
  const slope = Math.atan2(hd - tw, H - 0.06);
  for (const s of [-1, 1]) {
    const zc = s * (hd + tw) / 2, yc = (H - 0.06) / 2;
    ox.push().move(0, yc, zc).rotX(-s * slope).box(w * 0.62, (H - 0.06) * 0.6, 0.05, 0, 0, s * 0.02).pop();
    brz.push().move(0, yc, zc).rotX(-s * slope).box(w * 0.7, 0.07, 0.07, 0, (H - 0.06) * 0.34, s * 0.02).box(w * 0.7, 0.07, 0.07, 0, -(H - 0.06) * 0.34, s * 0.02).pop();
    amb.push().move(0, H - 0.3, s * (tw + (hd - tw) * 0.22)).rotX(-s * slope).box(w * 0.4, 0.09, 0.03, 0, 0, s * 0.03).pop();
  }
  if (H > 1.6) {
    brz.prismX([[-0.16, H], [0.16, H], [0, H + 0.2]], w * 0.5, 0);
    blk.box(w * 0.3, 0.12, d + 0.02, 0, H * 0.72, 0);
  }
}

function reformation(p: Part, w: number, d: number, H: number): void {
  const navy = p.g('refNavy'), slate = p.g('refSlate'), steel = p.g('refSteel'), blue = p.g('refBlueGlow');
  const mods = Math.max(1, Math.round(w / 1.1)), mw = w / mods, rows = H > 1.6 ? 2 : 1, ph = (H - 0.36) / rows, pd = Math.min(0.34, d * 0.4);
  slate.tbox(w, 0.16, d * 0.82, 0.03, 0, 0, 0);
  steel.box(w, 0.07, pd + 0.1, 0, H - 0.035, 0);
  for (let i = 0; i <= mods; i++) {
    const x = -w / 2 + mw * i;
    steel.boxOn(0.09, H - 0.2, pd + 0.06, Math.max(-w / 2 + 0.045, Math.min(w / 2 - 0.045, x)), 0.16, 0);
  }
  for (let i = 0; i < mods; i++) {
    const cx = -w / 2 + mw * (i + 0.5);
    for (let r = 0; r < rows; r++) {
      const cy = 0.22 + ph * (r + 0.5);
      navy.cbox(mw - 0.14, ph - 0.08, pd, 0.035, cx, cy, 0);
      for (const s of [-1, 1]) {
        slate.box(mw * 0.5, ph * 0.3, 0.02, cx - mw * 0.12, cy - ph * 0.12, s * (pd / 2 + 0.008));
        blue.box(0.045, ph * 0.46, 0.02, cx + mw * 0.3, cy, s * (pd / 2 + 0.01));
        steel.box(0.07, 0.05, 0.03, cx - mw * 0.36, cy + ph * 0.32, s * (pd / 2 + 0.01));
      }
    }
  }
  for (const s of [-1, 1]) {
    for (const e of [-1, 1]) slate.prismX([[0, 0], [s * (d / 2 + 0.2), 0], [s * (d / 2 + 0.12), 0.1], [0, 0.42]], 0.1, e * (w / 2 - 0.2));
  }
}

function debris(p: Part, w: number, d: number, H: number): void {
  const r = p.ctx.rand, wg = p.g('whiteGold'), rb = p.g('rubble');
  wg.push().move((r() - 0.5) * 0.1, H * 0.5, 0).rotZ((r() - 0.5) * 0.12).rotY((r() - 0.5) * 0.14).chunk(w * 0.94, H, d * 0.86, 0.16, r).pop();
  wg.push().move(-w * 0.2, H * 0.28, d * 0.18).rotY(0.5).rotZ(0.3).chunk(w * 0.45, H * 0.5, d * 0.6, 0.3, r).pop();
  p.g('goldTrim').push().move(w * 0.1, H * 0.62, d * 0.44).rotZ(-0.2).box(w * 0.5, 0.05, 0.04, 0, 0, 0).pop();
  for (let i = 0; i < 9; i++) {
    const s = 0.18 + r() * 0.4, side = r() < 0.5 ? -1 : 1;
    rb.push().move((r() - 0.5) * (w + 0.5), s * 0.3, side * (d / 2 + r() * 0.5)).rotY(r() * 3).rotX((r() - 0.5) * 0.6).chunk(s * 1.5, s * 0.8, s, 0.45, r).pop();
  }
}

function plate(p: Part, w: number, d: number, H: number): void {
  const r = p.ctx.rand, lean = 0.3, len = H / Math.cos(lean) + 0.05;
  const pl = p.g('whiteGoldPanel');
  pl.push().move(0, 0, d * 0.32).rotX(-lean).cbox(w, len, 0.24, 0.04, 0, len / 2, 0).pop();
  p.g('goldTrim').push().move(0, 0, d * 0.32).rotX(-lean).box(w * 0.92, 0.05, 0.25, 0, len * 0.82, 0).box(w * 0.92, 0.05, 0.25, 0, len * 0.2, 0).pop();
  p.g('goldDark').push().move(0, 0, d * 0.32).rotX(-lean).box(w * 0.6, len * 0.4, 0.02, 0, len * 0.5, 0.125).pop();
  // what it leans on
  p.g('whiteGold').push().move(w * 0.12, 0, -d * 0.12).rotY(0.2).chunk(w * 0.6, H * 1.5, d * 0.55, 0.22, r, 0, H * 0.36, 0).pop();
  for (let i = 0; i < 6; i++) {
    const s = 0.2 + r() * 0.35;
    p.g('rubble').push().move((r() - 0.5) * w, s * 0.3, (r() - 0.5) * d * 1.3).rotY(r() * 3).chunk(s * 1.4, s * 0.8, s, 0.45, r).pop();
  }
}

const STYLES: Record<CoverStyle, (p: Part, w: number, d: number, H: number) => void> = { ancient, dominion, reformation, debris, plate };

export function buildCover(ctx: KitCtx, o: CoverOpts, kind: 'low' | 'high'): THREE.Object3D {
  const H = kind === 'low' ? COVER_LOW : COVER_HIGH;
  const w = ctx.num(o.w, 3, 0.4), d = ctx.num(o.d, 1, 0.3);
  const style: CoverStyle = o.style && o.style in STYLES ? o.style : 'ancient';
  if (o.style && !(o.style in STYLES)) ctx.warn(`cover:${String(o.style)}`, `unknown cover style "${String(o.style)}" — using "ancient"`);
  const part = new Part(ctx, `cover-${kind}-${style}`, ctx.P(ctx.num(o.x, 0), ctx.num(o.n, 0), ctx.num(o.h, 0)), ctx.yaw(ctx.num(o.yawDeg, 0)));
  ctx.collider(part.pose.box(0, H / 2, 0, w / 2, H / 2, d / 2, { cover: kind, tag: `cover-${kind}` }));
  if (style === 'debris' || style === 'plate') {
    STYLES[style](part, w, d, H);
    return part.done();
  }
  // deterministic families share one template per size
  const tpl = ctx.cached(`cover:${style}:${kind}:${w.toFixed(2)}:${d.toFixed(2)}`, () => {
    const proto = new Part(ctx, 'cover-proto', new THREE.Vector3());
    STYLES[style](proto, w, d, H);
    return proto.template();
  });
  return part.place(tpl);
}
