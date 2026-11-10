/**
 * Z10 · Fifth Crownmark chamber — enter as Tarrik, handoff to Selene at her assent. No combat.
 * PASS-THROUGH STUB (see ./stub.ts): keeps the cross-zone contract of tasks/ZONES.md — lead, cast, beat ids,
 * checkpoints, handoffs, recorded choices, story flags — until the zone's author replaces this file.
 */
import { LOOKS } from '@/render/looks';
import { stubZone } from './stub';

export default stubZone({
  id: 'Z10',
  title: 'Fifth Crownmark Chamber',
  lead: 'tarrik',
  cast: [{ who: 'selene' }],
  beats: [
    { id: 'diagnostic' },
    { id: 'assentTarrik', story: ['assentTarrik'] },
    { id: 'assentSelene', handoffTo: 'selene', story: ['assentSelene', 'meridianComplete'] },
    { id: 'witness' },
    { id: 'consequence', story: ['releaseWithheld', 'grammarPropagated'] },
    { id: 'after', checkpoint: 'CP7' },
  ],
  next: 'Z11',
  env: { sky: 'coreChamber', look: LOOKS.core, ambience: 'coreChamber', music: 'core' },
  art: 'crownmark-chamber',
  blackStone: true,
});
