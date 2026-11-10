/**
 * Z02 · Survivor bend — lead Tarrik. The Varo scene, optional O1, cut to Selene.
 * PASS-THROUGH STUB (see ./stub.ts): keeps the cross-zone contract of tasks/ZONES.md — lead, cast, beat ids,
 * checkpoints, handoffs, recorded choices, story flags — until the zone's author replaces this file.
 */
import { LOOKS } from '@/render/looks';
import { stubZone } from './stub';

export default stubZone({
  id: 'Z02',
  title: 'Survivor Bend',
  lead: 'tarrik',
  cast: [{ who: 'lyessa' }, { who: 'malik', mode: 'hold' }, { who: 'dominionSoldier', mode: 'hold' }, { who: 'dominionSoldier', mode: 'hold' }],
  beats: [{ id: 'stabilize' }, { id: 'bend' }, { id: 'cut' }],
  next: 'Z03',
  env: { sky: 'crashRib', look: LOOKS.survivorBend, ambience: 'survivorBend', music: 'approachTarrik' },
  art: 'relay-route',
});
