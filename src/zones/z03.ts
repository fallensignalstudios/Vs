/**
 * Z03 · Frozen sensor access — lead Selene; Tharne and Lyric follow. Two scan planes, the terminal read.
 * PASS-THROUGH STUB (see ./stub.ts): keeps the cross-zone contract of tasks/ZONES.md — lead, cast, beat ids,
 * checkpoints, handoffs, recorded choices, story flags — until the zone's author replaces this file.
 */
import { LOOKS } from '@/render/looks';
import { stubZone } from './stub';

export default stubZone({
  id: 'Z03',
  title: 'Frozen Sensor Access',
  lead: 'selene',
  cast: [{ who: 'tharne' }, { who: 'lyric' }],
  beats: [{ id: 'arrival', checkpoint: 'CP2' }, { id: 'scan' }, { id: 'terminalRead' }],
  next: 'Z04',
  env: { sky: 'frozenInterior', look: LOOKS.frozen, ambience: 'frozenCorridor', music: 'approachSelene' },
  art: 'relay-route',
});
