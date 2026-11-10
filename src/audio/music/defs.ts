/** Every MusicState → its definition (`silence` has none). */
import type { MusicState } from '@/core/api';
import type { MusicDef } from './types';
import { FACTION_MUSIC } from './defs-factions';
import { ECLIPSE_MUSIC } from './defs-eclipse';
import { KING_MUSIC } from './defs-king';

export const MUSIC: Readonly<Record<Exclude<MusicState, 'silence'>, MusicDef>> = {
  ...FACTION_MUSIC,
  ...ECLIPSE_MUSIC,
  ...KING_MUSIC,
};

export const MUSIC_STATES = ['silence', ...Object.keys(MUSIC)] as readonly MusicState[];
