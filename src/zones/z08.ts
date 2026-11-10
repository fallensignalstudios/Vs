/**
 * Z08 · Quarantine crucible / Encounter E4 — enter as Selene, handoff to Tarrik. The officer: kill or spare.
 * PASS-THROUGH STUB (see ./stub.ts): keeps the cross-zone contract of tasks/ZONES.md — lead, cast, beat ids,
 * checkpoints, handoffs, recorded choices, story flags — until the zone's author replaces this file.
 */
import { LOOKS } from '@/render/looks';
import { stubZone } from './stub';

export default stubZone({
  id: 'Z08',
  title: 'Quarantine Crucible',
  lead: 'selene',
  cast: [
    { who: 'tarrik' }, { who: 'lyessa', mode: 'hold' }, { who: 'dominionSoldier', mode: 'hold' }, { who: 'dominionSoldier', mode: 'hold' },
    { who: 'tharne', mode: 'hold' }, { who: 'lyric', mode: 'hold' }, { who: 'medic', mode: 'hold' }, { who: 'survivor', mode: 'hold' },
  ],
  beats: [
    { id: 'phaseA', checkpoint: 'CP5' },
    { id: 'phaseB', checkpoint: 'CP5b', handoffTo: 'tarrik', choice: 'officer' },
    { id: 'quarantine', story: ['quarantineSeparated'] },
  ],
  next: 'Z09',
  env: { sky: 'breachDeep', look: LOOKS.crucible, ambience: 'crucible', music: 'elite' },
  art: 'quarantine-cooperation',
});
