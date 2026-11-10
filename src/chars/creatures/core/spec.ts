/**
 * Shared declarations of the creature animator: what an action is (ActionDef), a playing action (Slot) and the
 * per-archetype description CreatureBase is built from (CreatureSpec).
 */
import type { Archetype } from '@/core/api';
import type { RigTemplate } from './rig';

export interface ActionDef {
  /** seconds */
  dur: number;
  loop?: boolean;
  /** keep the final pose until another main action starts (deaths, disabled states) */
  hold?: boolean;
  /** seconds at which 'hit' (or `hitName`) fires */
  hits?: readonly number[];
  hitName?: 'hit' | 'release';
  /** extra named events: [seconds, name] */
  events?: readonly (readonly [number, string])[];
  /** default blend-in / blend-out seconds */
  fade?: number;
  out?: number;
  /** additive reaction: layered over the main action and never interrupts it */
  react?: boolean;
  /** runs in real (game) time even while the body is frozen — deaths, the fracture, hit reactions */
  ignoreFreeze?: boolean;
  /** starting it shatters the frost: the visual thaws itself and stays thawed until setFrozen(0) */
  thaw?: boolean;
  /** brings a dead visual back (spawn) */
  revive?: boolean;
  /** [t0, t1] seconds over which the body dissolves away by itself (Eclipse deaths) */
  dissolveOut?: readonly [number, number];
  /** seconds over which the body materialises out of a full dissolve (spawns) */
  dissolveIn?: number;
}

/** A playing action. `t` is seconds since start, `w` the eased blend weight 0..1. */
export interface Slot {
  /** pose name: a key of the archetype's action table, or 'generic' */
  name: string;
  /** what the caller asked for (canonical name, or the raw string for unknown actions) — isPlaying / stop match this */
  key: string;
  def: ActionDef;
  t: number;
  w: number;
  speed: number;
  fadeIn: number;
  fadeOut: number;
  /** 0 = playing, 1 = holding final pose, 2 = fading out */
  state: 0 | 1 | 2;
  raw: number;
  loop: boolean;
  react: boolean;
  onEvent?: (name: string) => void;
}

export interface CreatureSpec {
  archetype: Archetype;
  height: number;
  radius: number;
  template: RigTemplate;
  actions: Readonly<Record<string, ActionDef>>;
  /** action name → canonical action of this creature */
  aliases?: Readonly<Record<string, string>>;
  /** group name → shader group id (setExposed / group glow) */
  groups?: Readonly<Record<string, number>>;
  /** bind-space origin + range of the frost creep */
  frostOrigin?: readonly [number, number, number];
  frostRange?: number;
  /** Eclipse-made: follows the shared cadence and dissolves on death */
  eclipse?: boolean;
  /** baseline corruption the creature is authored with (setCorruption adds on top, clamped) */
  baseCorruption?: number;
  /** vein pattern frequency multiplier (default 1; big bodies < 1) */
  veinScale?: number;
  /** uniform scale from authored model units to metres (default 1); `height`/`radius` are already in metres */
  modelScale?: number;
  /** authored readability rim [sRGB hex, amount 0..1] the creature always carries (setRim layers on top) */
  rim?: readonly [number, number];
}
