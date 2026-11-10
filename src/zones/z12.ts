/**
 * Z12 · Outer-ring hangar — lead Tarrik. Departure; `z.completeMission()` saves CP9.
 * PASS-THROUGH STUB (see ./stub.ts): keeps the cross-zone contract of tasks/ZONES.md — lead, cast, beat ids,
 * checkpoints, handoffs, recorded choices, story flags — until the zone's author replaces this file.
 */
import { LOOKS } from '@/render/looks';
import { stubZone } from './stub';

export default stubZone({
  id: 'Z12',
  title: 'Outer-Ring Hangar',
  lead: 'tarrik',
  cast: [{ who: 'selene' }, { who: 'lyessa', mode: 'hold' }, { who: 'tharne', mode: 'hold' }, { who: 'lyric', mode: 'hold' }],
  beats: [{ id: 'concourse' }, { id: 'farewell' }, { id: 'departure' }],
  next: null,
  env: { sky: 'hangar', look: LOOKS.hangar, ambience: 'hangar', music: 'departure' },
  art: 'wound-overlook',
});
