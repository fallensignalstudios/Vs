/**
 * Z05 · Meeting atrium — enter as Selene, handoff to Tarrik. The duel; the carrier is lost with all hands.
 * PASS-THROUGH STUB (see ./stub.ts): keeps the cross-zone contract of tasks/ZONES.md — lead, cast, beat ids,
 * checkpoints, handoffs, recorded choices, story flags — until the zone's author replaces this file.
 */
import { LOOKS } from '@/render/looks';
import { stubZone } from './stub';

export default stubZone({
  id: 'Z05',
  title: 'Meeting Atrium',
  lead: 'selene',
  cast: [{ who: 'tharne', mode: 'hold' }, { who: 'lyric', mode: 'hold' }, { who: 'tarrik', mode: 'hold' }, { who: 'lyessa', mode: 'hold' }],
  beats: [{ id: 'meeting', checkpoint: 'CP3' }, { id: 'carrier', story: ['carrierLost'] }, { id: 'aftermath', handoffTo: 'tarrik' }],
  next: 'Z06',
  env: { sky: 'battleCeiling', look: LOOKS.atrium, ambience: 'atrium', music: 'atrium' },
  art: 'wound-overlook',
});
