/**
 * Prop placement. Every prop kind is built once per (kind, variant) into a template and instanced by reference,
 * so `finalize()` can merge or instance repeats. Unknown kinds fall back to a neutral crate with one warning.
 */
import * as THREE from 'three';
import type { PropKind, PropOpts } from '@/core/api';
import { hashString, mulberry32 } from '@/core/mathx';
import { KitCtx, Part } from '../core';
import { ANCIENT_PROPS } from './ancient';
import { DRESSING_PROPS } from './dressing';
import { FACTION_PROPS } from './faction';
import type { PropDef, PropTable } from './types';

export const PROPS: PropTable = { ...FACTION_PROPS, ...ANCIENT_PROPS, ...DRESSING_PROPS };

/** Every kind `ZoneBuilder.prop` understands (for sandboxes, debug menus and tests). */
export const PROP_KINDS: readonly string[] = Object.keys(PROPS).filter((k) => k !== 'neutralCrate');

export function buildProp(ctx: KitCtx, kind: PropKind, o: PropOpts): THREE.Object3D {
  let def: PropDef | undefined = Object.prototype.hasOwnProperty.call(PROPS, kind) ? PROPS[kind] : undefined;
  if (!def) {
    ctx.warn(`prop:${String(kind)}`, `unknown prop kind "${String(kind)}" — placing a neutral crate`);
    def = PROPS.neutralCrate;
    kind = 'neutralCrate';
  }
  const opts = o ?? ({} as PropOpts);
  const variants = Math.max(1, def.variants ?? 1);
  const pick = Number.isFinite(opts.variant) ? Math.floor(opts.variant as number) : Math.floor(ctx.rand() * variants);
  const variant = ((pick % variants) + variants) % variants;
  const scale = ctx.num(opts.scale, 1, 0.05, 20);
  const part = new Part(ctx, `prop:${kind}`, ctx.P(ctx.num(opts.x, 0), ctx.num(opts.n, 0), ctx.num(opts.h, 0)), ctx.yaw(ctx.num(opts.yawDeg, 0)), { noReflect: def.noReflect });
  part.group.scale.setScalar(scale);
  const build = def.build;
  const tpl = ctx.cached(`prop:${kind}:${variant}`, () => {
    const proto = new Part(ctx, 'prop-proto', new THREE.Vector3());
    build(proto, mulberry32(hashString(kind) + variant * 7919), variant);
    return proto.template();
  });
  const group = part.place(tpl);

  const wantCollider = opts.collider ?? !def.colliderOptIn;
  if (wantCollider && def.colliders) {
    for (const c of def.colliders(variant)) {
      const ax = (c.at?.[0] ?? 0) * scale, az = (c.at?.[1] ?? 0) * scale;
      const extra = { cover: c.cover, blocksSight: c.sight !== false, tag: `prop:${kind}` };
      if (c.box) ctx.collider(part.pose.box(ax, (c.box[1] * scale) / 2, az, (c.box[0] * scale) / 2, (c.box[1] * scale) / 2, (c.box[2] * scale) / 2, extra, c.ry ?? 0));
      else if (c.cyl) ctx.collider(part.pose.cyl(ax, (c.cyl[1] * scale) / 2, az, c.cyl[0] * scale, (c.cyl[1] * scale) / 2, extra));
    }
  }
  const l = def.light?.(variant);
  if (l) {
    let light: THREE.PointLight | THREE.SpotLight;
    if (l.target) {
      const spot = new THREE.SpotLight(l.color, l.intensity, l.distance * Math.max(1, scale), ((l.angleDeg ?? 35) * Math.PI) / 180, 0.6, 2);
      spot.target.position.set(l.target[0], l.target[1], l.target[2]);
      group.add(spot.target);
      light = spot;
    } else {
      light = new THREE.PointLight(l.color, l.intensity, l.distance * Math.max(1, scale), 2);
    }
    light.position.set(l.at[0], l.at[1], l.at[2]);
    light.name = `prop-light:${kind}`;
    // a fixture light: finalize() may share it with its neighbours or drop it to emissive-only (light budget)
    light.userData.kitFixture = true;
    group.add(light);
    ctx.lights.push(light);
  }
  return group;
}
