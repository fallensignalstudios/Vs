/**
 * Z09 · Wound gallery — lead Tarrik; Selene walks with him. No combat.
 * PASS-THROUGH STUB (see ./stub.ts): keeps the cross-zone contract of tasks/ZONES.md — lead, cast, beat ids,
 * checkpoints, handoffs, recorded choices, story flags — until the zone's author replaces this file.
 */
import { LOOKS } from '@/render/looks';
import { stubZone } from './stub';

export default stubZone({
  id: 'Z09',
  title: 'Wound Gallery',
  lead: 'tarrik',
  cast: [{ who: 'selene' }],
  beats: [{ id: 'descent', checkpoint: 'CP6' }, { id: 'overlook' }, { id: 'recognition', story: ['contraryRecognized'] }],
  next: 'Z10',
  env: { sky: 'woundVista', look: LOOKS.woundGallery, ambience: 'woundGallery', music: 'recognition' },
  art: 'wound-overlook',
  blackStone: true,
});
