/** Generic moveset: stances + clips every humanoid can fall back to. */
import type { Moveset } from '../anim/moveset';

export const GENERIC: Moveset = {
  name: 'generic',
  clips: {},
  stances: {
    none: { idle: {} },
  },
};
