/** Effect library registry — every VfxId maps to an EffectDef here. */
import type { EffectDef } from '../defs';
import { CINDER } from './cinder';
import { DESTRUCTION } from './destruction';
import { ECLIPSE } from './eclipse';
import { FEEDBACK } from './feedback';
import { FROST } from './frost';
import { IMPACTS } from './impacts';
import { STORY } from './story';
import { WEAPONS } from './weapons';

export const EFFECT_LIBRARY: Readonly<Record<string, EffectDef>> = {
  ...IMPACTS, ...CINDER, ...FROST, ...ECLIPSE, ...WEAPONS, ...DESTRUCTION, ...FEEDBACK, ...STORY,
};

/** Effects grouped by family (sandbox gallery, docs). */
export const EFFECT_FAMILIES: Readonly<Record<string, readonly string[]>> = {
  impacts: Object.keys(IMPACTS),
  cinder: Object.keys(CINDER),
  frost: Object.keys(FROST),
  eclipse: Object.keys(ECLIPSE),
  weapons: Object.keys(WEAPONS),
  destruction: Object.keys(DESTRUCTION),
  feedback: Object.keys(FEEDBACK),
  story: Object.keys(STORY),
};
