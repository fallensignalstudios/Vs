/**
 * Z11 · Observation gallery — lead Selene. The reunion, the exchange and the pact; optional O4.
 * PASS-THROUGH STUB (see ./stub.ts): keeps the cross-zone contract of tasks/ZONES.md — lead, cast, beat ids,
 * checkpoints, handoffs, recorded choices, story flags — until the zone's author replaces this file.
 */
import { LOOKS } from '@/render/looks';
import { stubZone } from './stub';

export default stubZone({
  id: 'Z11',
  title: 'Observation Gallery',
  lead: 'selene',
  cast: [
    { who: 'tarrik' }, { who: 'lyessa', mode: 'hold' }, { who: 'dominionSoldier', mode: 'hold' }, { who: 'dominionSoldier', mode: 'hold' },
    { who: 'tharne', mode: 'hold' }, { who: 'lyric', mode: 'hold' }, { who: 'medic', mode: 'hold' },
  ],
  beats: [
    { id: 'reunion', story: ['lyricAliveNotCured'] },
    { id: 'conversation', checkpoint: 'CP8', story: ['evidenceExchanged', 'pactAgreed'] },
    { id: 'linger' },
  ],
  next: 'Z12',
  env: { sky: 'observation', look: LOOKS.observation, ambience: 'observation', music: 'observation' },
  art: 'wound-overlook',
  blackStone: true,
});
