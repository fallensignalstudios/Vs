/**
 * Z10 · Fifth Crownmark chamber — enter as Tarrik, handoff to Selene at her assent. No combat (SCRIPT_SOURCE Z10).
 *
 *   constants (./z10/state.ts) → build (./z10/space.ts, ./z10/witness-set.ts) → cast → beats → ZoneDef
 *
 * SPACE (plan coordinates, origin at the south-west corner, x east, n north): a Ø 54 m disc of mirror-black stone
 * centred at (27, 27) around a Ø 10 m dais; Crownmark Five seated in its mechanism at the centre, facing the entry
 * walkway on the south; the nested rings fill the volume above; two independent assent interfaces in front of it,
 * one each side (sunk until the protocol raises them). Glass rail round the edge; the view boundary stays dark and
 * shut (sky `coreChamber`). Exit: the return lift on the north edge → Z11.
 *
 * BEATS: `diagnostic` (arrival, then the argument at the dais), `assentTarrik` (the protocol; his palm and his
 * name), `assentSelene` (handoff → Selene; her palm, her sentence, his clause, her “Yes.” — the player's confirm —
 * and his; the press, the dark, 5 / 5), `witness` (Witness V, watched), `consequence` (the book's strings),
 * `after` → CP7 (saved only after the whole consequence: a reload never repeats an assent or skips its cost).
 *
 * SCRIPT: SCRIPT_SOURCE.md § Z10 — exact lines, CORE only (*(ext — trimmed)* lines are not played). The terminal
 * is text only (status board). Prompts are acts («Place your palm»), never outcomes; the forecast is a readout,
 * never a timer. New UI strings carry `// NEW`.
 */
import type { Beat, Routine, ZoneBuilder, ZoneDef, ZoneRuntime } from '@/core/api';
import { isHumanoidVisual } from '@/core/api/chars';
import { palm, confirmYes, meridianScene, placePalm, protocolScene, selenePalmScene, tarrikPalmScene } from './z10/assent';
import { consequenceScene } from './z10/consequence';
import { arrivalScene, diagnosticScene } from './z10/diagnostic';
import { buildScenic, buildSpace, wetMirror } from './z10/space';
import { S, Z10_LOOK, resetState, setLights, setRise, updateShared } from './z10/state';
import { showWitness, witnessScene } from './z10/witness';
import { buildWitnessSet, disposeWitnessSet, updateWitnessSet } from './z10/witness-set';

// =====================================================================================================================
// Build
// =====================================================================================================================

function build(b: ZoneBuilder): void {
  resetState();
  b.game.sky.reset();
  b.setEnv({
    sky: 'coreChamber', look: Z10_LOOK, ambience: 'coreChamber', music: 'core',
    // nearly overhead (the preset's key): the mirror floor keeps its glint out of the usual view
    key: { dirFrom: [8, -10, 46], intensity: 1.1, color: 0xffe9c4 },
  });
  buildSpace(b);
  S.witness = buildWitnessSet(b);
  buildScenic(b);
  b.finalize();
  // polish 4: the black floor mirrors like the painting's wet marble
  wetMirror(b, 3.2, 0.07);
}

// =====================================================================================================================
// Cast and world state per stage
// =====================================================================================================================

type Stage = 'entry' | 'protocol' | 'seleneAssent' | 'witness' | 'consequence' | 'after';
const ORDER: Stage[] = ['entry', 'protocol', 'seleneAssent', 'witness', 'consequence', 'after'];
const at = (s: Stage, from: Stage): boolean => ORDER.indexOf(s) >= ORDER.indexOf(from);

/** the lead, the partner and the chamber as the beats before `stage` leave them */
function spawnCast(z: ZoneRuntime, stage: Stage): void {
  const game = z.game;
  const seleneLeads = at(stage, 'witness');
  const assentT = at(stage, 'seleneAssent');
  const meridian = at(stage, 'witness');
  // fixed story flags of the earlier beats
  if (assentT) z.story('assentTarrik');
  if (meridian) {
    z.story('assentSelene');
    z.story('meridianComplete');
  }
  if (stage === 'after') {
    z.story('releaseWithheld');
    z.story('grammarPropagated');
  }
  // bodies
  if (!seleneLeads) {
    const t = stage === 'entry' ? 'start' : stage === 'protocol' ? 'tarrikShoulder' : 'standT';
    const s = stage === 'entry' ? 'seleneStart' : stage === 'protocol' ? 'seleneConsole' : 'standS';
    z.spawnPlayer('tarrik', t);
    const selene = z.companion('selene', s, stage === 'entry' ? 'follow' : 'scripted');
    selene.actor.visual?.setLoadout({ melee: false, ranged: false });
    if (stage === 'seleneAssent') palm(z, 'tarrik', true);
  } else {
    z.spawnPlayer('selene', 'standS');
    const tarrik = z.companion('tarrik', 'standT', stage === 'after' ? 'follow' : 'scripted');
    tarrik.actor.visual?.setLoadout({ melee: false, ranged: false });
  }
  // the chamber
  const sky = game.sky;
  sky.setWoundActivity(meridian ? 0.05 : 0.3, { snap: true });
  sky.setBoundaryClosed(stage === 'after', 0, { snap: true });
  setRise(assentT ? 1 : 0, true);
  if (S.padT.prop) S.padT.prop.params.active = assentT ? 1 : 0;
  if (S.padS.prop) S.padS.prop.params.active = meridian ? 1 : 0;
  for (const p of [S.padT.prop, S.padS.prop]) if (p) p.params.assent = meridian ? 1 : 0;
  if (S.rings) {
    S.rings.params.align = meridian ? 1 : 0;
    S.rings.params.energy = meridian ? 1 : 0.45;
  }
  if (S.crownmark) {
    S.crownmark.params.glow = meridian ? 1 : 0.55;
    // ignited at the end of the Witness: from the consequence on its core is steady rather than pulsing
    S.crownmark.params.steady = at(stage, 'consequence') ? 1 : 0;
  }
  if (S.diag) {
    S.diag.params.visible = stage === 'entry' ? 0 : 1;
    S.diag.params.progress = meridian ? 1 : 0;
  }
  if (S.forecast) S.forecast.params.visible = stage === 'protocol' || stage === 'seleneAssent' ? 1 : 0;
  setLights(meridian ? 5 : 0);
  for (const p of [S.crownmark, S.rings, S.padT.prop, S.padS.prop, S.diag, S.forecast]) p?.snap();
  showWitness(z, false);
  game.audio.setMusic(at(stage, 'consequence') ? 'consequence' : 'core', 0.5);
}

/** the forecast as an in-fiction readout while the player has control — never a clock to race */
function forecastReadout(z: ZoneRuntime, on: boolean): void {
  z.game.ui.readout(on ? { label: 'FORECAST TO CRITICAL FAILURE', value: '02:11:43', tone: 'violet' } : null);
}

// =====================================================================================================================
// Beats
// =====================================================================================================================

/** `diagnostic` — the arrival, the walk to the dais, the argument */
function* diagnostic(z: ZoneRuntime): Routine {
  yield* arrivalScene(z);
  z.objective('Approach the dais', 'daisFront'); // NEW
  yield z.untilNear('daisFront', 3.2);
  z.objective(null);
  yield* diagnosticScene(z);
}

/** `assentTarrik` — the protocol; played as Tarrik: his palm, his name on the record */
function* assentTarrik(z: ZoneRuntime): Routine {
  yield* protocolScene(z);
  forecastReadout(z, true);
  yield* placePalm(z, 'tarrik');
  yield* tarrikPalmScene(z);
}

/** `assentSelene` — handoff; played as Selene: her palm, her sentence, his clause, her “Yes.”; then the press */
function* assentSelene(z: ZoneRuntime): Routine {
  z.game.ui.statusBoard(null);
  yield* z.handoff('selene', { partnerMode: 'scripted', seconds: 3 });
  // his palm stays on his interface while hers is placed
  palm(z, 'tarrik', true);
  forecastReadout(z, true);
  yield* placePalm(z, 'selene');
  yield* selenePalmScene(z);
  yield* confirmYes(z);
  forecastReadout(z, false);
  yield* meridianScene(z);
}

function* witness(z: ZoneRuntime): Routine {
  forecastReadout(z, false);
  yield* witnessScene(z);
}

function* consequence(z: ZoneRuntime): Routine {
  yield* consequenceScene(z);
}

/** `after` → CP7. Quiet: the core steady, the Wound settled. The walk to the return lift is silent. */
function* after(z: ZoneRuntime): Routine {
  const tarrik = z.cast('tarrik');
  if (tarrik) tarrik.mode = 'follow';
  const v = z.player.visual;
  if (isHumanoidVisual(v)) v.setHandTarget('R', null);
  z.objective('Take the return lift', 'lift'); // NEW
  yield z.untilNear('lift', 2.0);
  z.objective(null);
  if (!z.skipping) z.game.audio.play('liftMove', { pos: z.m('lift') });
  yield 0.8;
  yield* z.exit('Z11', { fade: 'black', seconds: 1.6 });
}

// =====================================================================================================================
// Zone definition
// =====================================================================================================================

const beats: Beat[] = [
  { id: 'diagnostic', enter: (z) => spawnCast(z, 'entry'), run: diagnostic },
  { id: 'assentTarrik', enter: (z) => spawnCast(z, 'protocol'), run: assentTarrik },
  { id: 'assentSelene', enter: (z) => spawnCast(z, 'seleneAssent'), run: assentSelene },
  { id: 'witness', enter: (z) => spawnCast(z, 'witness'), run: witness },
  { id: 'consequence', enter: (z) => spawnCast(z, 'consequence'), run: consequence },
  { id: 'after', checkpoint: 'CP7', enter: (z) => spawnCast(z, 'after'), run: after },
];

const Z10_DEF: ZoneDef = {
  id: 'Z10',
  title: 'Fifth Crownmark Chamber',
  art: 'crownmark-chamber',
  // the two Witness V bodies (generated `king` and `vesryn`) are preloaded with the zone
  cast: ['kingWitness', 'vesryn'],
  build,
  beats,
  update(z: ZoneRuntime, dt: number) {
    updateShared(z, dt);
    if (S.witness) updateWitnessSet(z, S.witness, dt);
  },
  dispose() {
    if (S.witness) disposeWitnessSet(S.witness);
    resetState();
  },
};

export default Z10_DEF;
