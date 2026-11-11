/**
 * Prop definitions: each prop is a small authored model emitted into a Part.
 * Local frame: +X right, +Y up, the prop FACES −Z (north when placed with yawDeg 0). Sizes in metres.
 */
import type { Part } from '../core';

export interface PropCollider {
  /** box footprint [w, h, d] or cylinder [r, h] */
  box?: [number, number, number];
  cyl?: [number, number];
  /** local offset of the collider's footprint centre */
  at?: [number, number];
  /** local yaw of a box */
  ry?: number;
  cover?: 'low' | 'high';
  /** false = can be seen over / through (lamps, benches, low gear) */
  sight?: boolean;
}

export interface PropLight {
  color: number; intensity: number; distance: number; at: [number, number, number];
  /** make it a spot aimed at this local point (fixtures that must light their own face, not whoever stands there) */
  target?: [number, number, number];
  /** spot half-angle, degrees (default 35) */
  angleDeg?: number;
}

export interface PropDef {
  /** number of visual variants (default 1); `variant` cycles through them */
  variants?: number;
  /** emit the model; `rand` is seeded from kind + variant, so the result is a cacheable template */
  build(p: Part, rand: () => number, variant: number): void;
  colliders?(variant: number): PropCollider[];
  light?(variant: number): PropLight | null;
  /** small dressing: keep it out of floor reflections and the reflection probe */
  noReflect?: boolean;
  /** props whose collider is opt-in (`collider: true`) rather than default */
  colliderOptIn?: boolean;
}

export type PropTable = Record<string, PropDef>;
