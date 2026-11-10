/**
 * Z05 · Meeting atrium — enter as Selene (Tharne, Lyric behind her); Tarrik, Lyessa and Dominion soldiers come
 * in from the opposite side. Handoff to Tarrik at the end. Plan §08 (plan.txt 359–401), SCRIPT_SOURCE § Z05.
 *
 * SPACE (plan coordinates, origin at the south-west corner; see ./z05/layout.ts): a Ø72 m surviving platform
 * centred at (64, 64) in the ~300 m scenic atrium, with an 18 m local shaft in its middle and the lift plate to
 * Crownmark Five below. Four 6 m bridges on the cardinals: south gate (entry), north gate (the Dominion side),
 * east broken over the void, west down a ramp to the lower corridor (exit to Z06). The control ring stands
 * west-south-west of the shaft. The transparent ceiling shows the battle — amber, blue-white, violet — and the
 * carrier's pass (`sky.carrier`), anchored to the same frame as the shell.
 *
 * BEATS: `meeting` → CP3 (the walk in, the meeting, the fierce duel — prompts, no victor), `carrier` (the lance,
 * the strip, the control ring, the hold; the ship is lost with all hands — `z.story('carrierLost')`),
 * `aftermath` (silence, the screams below, his turn away from the shaft, `z.handoff('tarrik')`, the walk down).
 *
 * SCRIPT: the author's lines are exact (curly apostrophes are the book's); every UI string written for the game
 * is tagged `// NEW`. No line was invented here: SCRIPT_SOURCE's Z05 INVENT lists ask for none.
 *
 * FILES: ./z05/layout.ts (numbers, markers), space.ts (build), state.ts (per-load state, per-frame animation),
 * cast.ts (spawnCast), duel.ts (`meeting`), carrier.ts (`carrier`, `aftermath`).
 */
import type { Beat, ZoneDef } from '@/core/api';
import { spawnCast } from './z05/cast';
import { aftermath, carrierBeat } from './z05/carrier';
import { meeting } from './z05/duel';
import { buildSpace } from './z05/space';
import { disposeState, freshState, updateZone } from './z05/state';

const beats: Beat[] = [
  { id: 'meeting', checkpoint: 'CP3', enter: (z) => spawnCast(z, 'meeting'), run: meeting },
  { id: 'carrier', enter: (z) => spawnCast(z, 'carrier'), run: carrierBeat },
  { id: 'aftermath', enter: (z) => spawnCast(z, 'aftermath'), run: aftermath },
];

const Z05_DEF: ZoneDef = {
  id: 'Z05',
  title: 'Meeting Atrium',
  art: 'wound-overlook',
  cast: ['tarrik', 'selene', 'lyessa', 'tharne', 'lyric', 'dominionSoldier'],
  build(b) {
    freshState();
    buildSpace(b);
  },
  beats,
  /** carried moves, the carrier's pass and sink, the key light under its shadow, the battle light */
  update: updateZone,
  dispose() {
    disposeState();
  },
};

export default Z05_DEF;
