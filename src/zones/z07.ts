/**
 * Z07 · Capture-control gallery — enter as Tarrik, handoff to Selene. Both cages, the bridge, the West / East choice.
 * PASS-THROUGH STUB (see ./stub.ts): keeps the cross-zone contract of tasks/ZONES.md — lead, cast, beat ids,
 * checkpoints, handoffs, recorded choices, story flags — until the zone's author replaces this file.
 */
import { LOOKS } from '@/render/looks';
import { stubZone } from './stub';

export default stubZone({
  id: 'Z07',
  title: 'Capture-Control Gallery',
  lead: 'tarrik',
  cast: [{ who: 'selene' }, { who: 'lyessa', mode: 'hold' }, { who: 'tharne', mode: 'hold' }, { who: 'lyric', mode: 'hold' }, { who: 'survivor', mode: 'hold' }],
  beats: [
    { id: 'cages', handoffTo: 'selene', story: ['cageDominionDestroyed', 'cageReformationDestroyed'] },
    { id: 'bridge', story: ['threatExchangeOpen'] },
    { id: 'choice', checkpoint: 'CP4b', choice: 'priority' },
  ],
  next: 'Z08',
  env: { sky: 'breachDeep', look: LOOKS.gallery, ambience: 'gallery', music: 'decision' },
  art: 'quarantine-cooperation',
  blackStone: true,
});
