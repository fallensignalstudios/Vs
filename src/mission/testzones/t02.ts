/**
 * T02 — mission-system test annex. NOT a production zone (see t01.ts). Entered from T01's exit:
 *   annex (CP3)   zone entry as Selene, unskippable vignette, handoff back to Tarrik
 *   finale        hold interaction, then completeMission() (CP9)
 * Plan space: 16 m × 16 m, origin at the south-west corner.
 */
import type { Game, Routine, ZoneBuilder, ZoneDef, ZoneRuntime } from '@/core/api';
import { LOOKS } from '@/render/looks';
import { Greybox } from './greybox';
import { T02_ID } from './t01';

const GOLD = 0xffc56b;

function build(b: ZoneBuilder, g: Greybox): void {
  b.setEnv({ sky: 'coreChamber', look: LOOKS.core, ambience: 'coreChamber', music: 'recognition', key: null });
  g.floor(8, 8, 16, 16);
  g.block(8, -0.3, 17.2, 7, 0.6, 'blackStone');
  g.block(8, 16.3, 17.2, 7, 0.6, 'blackStone');
  g.block(-0.3, 8, 0.6, 7, 16, 'blackStone');
  g.block(16.3, 8, 0.6, 7, 16, 'blackStone');
  g.block(8, 12.6, 1.4, 1.0, 1.4, 'goldDark');
  g.block(8, 12.6, 1.0, 0.08, 1.0, 'goldTrim', { h: 1.0, solid: false }).material = g.glow(GOLD, 3);
  for (const x of [3, 13]) g.block(x, 8, 0.8, 5, 0.8, 'blackStone');
  g.strip([8, 1], [8, 11.6], GOLD);
  g.strip([2, 11.9], [14, 11.9], GOLD, 2.2);
  g.strip([2, 13.3], [14, 13.3], GOLD, 2.2);
  g.whitePoint(8, 15.6, 5);
  g.key(8, 8, [10, 18, 12], 0xffe9c8, 1.6, 14);
  g.point(8, 12.6, 3.4, GOLD, 36, 14);
  g.point(8, 3, 3.6, 0xbfd4ff, 14, 12);

  b.marker('start', 8, 2.5, 0, 0);
  b.marker('partner', 6.2, 3.6, 0, 0);
  b.marker('centre', 8, 8, 0, 0);
  b.marker('core', 8, 11.4, 0, 0);
  b.finalize();
}

function* annex(z: ZoneRuntime): Routine {
  yield* z.cinematic(
    't02-arrive',
    function* (c): Routine {
      c.shot(z.m('core'), { yawDeg: 200, distance: 9, height: 2.6, lookHeight: 1.2, fov: 44 });
      c.drift({ around: z.m('core'), yawRate: 0.05 });
      yield* z.talk([
        ['Selene', 'One more room.', { actor: z.player }],
        ['Tarrik', 'Then this one is mine.', { actor: z.cast('tarrik') }],
      ]);
    },
    { skippable: false, blendOut: 0.8 },
  );
  z.objective('Walk to the centre', 'centre');
  yield z.untilNear('centre', 2.4);
  yield* z.handoff('tarrik', { partnerMode: 'follow' });
}

function* finale(z: ZoneRuntime): Routine {
  z.objective('Close the test at the core', 'core');
  const core = z.interact({ id: 't02-core', at: 'core', prompt: 'Close the test', hold: 1.2, required: true, radius: 2.4 });
  yield z.untilInteract(core);
  z.game.vfx.spawn('goldRecognition', z.m('core'));
  z.game.audio.play('recognitionTone', { pos: z.m('core') });
  z.objective(null);
  yield* z.say('Tarrik', 'Done. Nothing left to prove here.', { actor: z.player });
  yield* z.completeMission();
}

export function createT02(game: Game): ZoneDef {
  return {
    id: T02_ID,
    title: 'Mission Test Annex',
    subtitle: 'Zone entry, handoff back, completion',
    art: 'crownmark-chamber',
    build: (b) => build(b, new Greybox(game, b)),
    beats: [
      {
        id: 'annex',
        checkpoint: 'CP3',
        enter(z) {
          z.spawnPlayer('selene', 'start');
          z.companion('tarrik', 'partner', 'follow');
        },
        run: annex,
      },
      { id: 'finale', run: finale },
    ],
  };
}
