/**
 * Z06 · Breach rescue / Encounter E3 — lead Tarrik; Selene fights beside him.
 * PASS-THROUGH STUB (see ./stub.ts): keeps the cross-zone contract of tasks/ZONES.md — lead, cast, beat ids,
 * checkpoints, handoffs, recorded choices, story flags — until the zone's author replaces this file.
 */
import { LOOKS } from '@/render/looks';
import { stubZone } from './stub';

export default stubZone({
  id: 'Z06',
  title: 'Breach Rescue',
  lead: 'tarrik',
  cast: [{ who: 'selene' }, { who: 'lyessa', mode: 'hold' }, { who: 'tharne', mode: 'hold' }, { who: 'lyric', mode: 'hold' }, { who: 'reformationMarine', mode: 'hold' }],
  beats: [{ id: 'breach', checkpoint: 'CP4' }, { id: 'rescue', story: ['marineRescued'] }, { id: 'grounding' }],
  next: 'Z07',
  env: { sky: 'breachDeep', look: LOOKS.breach, ambience: 'breach', music: 'breach' },
  art: 'quarantine-cooperation',
});
