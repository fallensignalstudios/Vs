/**
 * Z04 · Relay overlook / Encounter E2 — lead Selene; Tharne and Lyric hold at the entry.
 * PASS-THROUGH STUB (see ./stub.ts): keeps the cross-zone contract of tasks/ZONES.md — lead, cast, beat ids,
 * checkpoints, handoffs, recorded choices, story flags — until the zone's author replaces this file.
 */
import { LOOKS } from '@/render/looks';
import { stubZone } from './stub';

export default stubZone({
  id: 'Z04',
  title: 'Relay Overlook',
  lead: 'selene',
  cast: [{ who: 'tharne', mode: 'hold' }, { who: 'lyric', mode: 'hold' }],
  beats: [{ id: 'overlook', checkpoint: 'CP2b' }, { id: 'e2' }, { id: 'release' }],
  next: 'Z05',
  env: { sky: 'frozenInterior', look: LOOKS.relay, ambience: 'relayOverlook', music: 'stealth' },
  art: 'relay-route',
});
