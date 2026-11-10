/**
 * Z00 · Broken landing — lead Tarrik. Context cards, then the landing pocket (move, guard, heavy).
 * PASS-THROUGH STUB (see ./stub.ts): keeps the cross-zone contract of tasks/ZONES.md — lead, cast, beat ids,
 * checkpoints, handoffs, recorded choices, story flags — until the zone's author replaces this file.
 */
import { LOOKS } from '@/render/looks';
import { stubZone } from './stub';

export default stubZone({
  id: 'Z00',
  title: 'Broken Landing',
  lead: 'tarrik',
  cast: [{ who: 'lyessa' }, { who: 'malik', mode: 'hold' }, { who: 'dominionSoldier', mode: 'hold' }, { who: 'dominionSoldier', mode: 'hold' }],
  beats: [{ id: 'context', checkpoint: 'CP0' }, { id: 'landing' }],
  next: 'Z01',
  env: { sky: 'crashRib', look: LOOKS.crash, ambience: 'crash', music: 'context' },
  art: 'wound-overlook',
});
