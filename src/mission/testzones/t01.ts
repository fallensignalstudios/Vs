/**
 * T01 — mission-system test hall. NOT a production zone: registered only by the mission sandbox and tests.
 * Exercises every ZoneRuntime feature in one short walk north:
 *   arrival (CP0)  cinematic + skip, dialogue, hint, press interaction, pickup, bark, optional marker
 *   lift           hold interaction (interruptible), flags
 *   handoff (CP1)  mid-zone checkpoint, authored protagonist handoff
 *   choice         decision panel + commit-once + save, story flag
 *   fight (CP2)    encounter, objective changes
 *   leave          nav-assisted objective, exit to T02
 * Plan space: 24 m east × 40 m north, origin at the south-west corner. A partition at n = 22 with a door
 * (x 10–14) forces a real nav path between the south and north halves.
 */
import type { Game, Routine, ZoneBuilder, ZoneDef, ZoneId, ZoneRuntime } from '@/core/api';
import { LOOKS } from '@/render/looks';
import { Greybox } from './greybox';

export const T01_ID = 'T01' as ZoneId;
export const T02_ID = 'T02' as ZoneId;

const GOLD = 0xffc56b;
const AMBER = 0xffa033;
const BLUE = 0xa8d8ff;

function build(b: ZoneBuilder, g: Greybox): void {
  b.setEnv({ sky: 'breachDeep', look: LOOKS.gallery, ambience: 'gallery', music: 'approachTarrik', key: null });

  g.floor(12, 20, 24, 40);
  // perimeter (6 m) and the partition with its door
  g.block(12, -0.3, 25.2, 6, 0.6, 'whiteGoldPanel');
  g.block(-0.3, 20, 0.6, 6, 40, 'whiteGoldPanel');
  g.block(24.3, 20, 0.6, 6, 40, 'whiteGoldPanel');
  g.block(4.75, 40.3, 10.5, 6, 0.6, 'whiteGoldPanel');
  g.block(19.25, 40.3, 10.5, 6, 0.6, 'whiteGoldPanel');
  g.block(12, 40.3, 4, 2.2, 0.6, 'whiteGoldPanel', { h: 3.8, solid: false });
  g.block(12, 41.2, 4, 3.8, 0.3, 'blackStone'); // the sealed threshold behind the exit frame
  g.block(5, 22, 10, 4.2, 0.6, 'whiteGold');
  g.block(19, 22, 10, 4.2, 0.6, 'whiteGold');
  g.block(12, 22, 4, 0.7, 0.6, 'goldDark', { h: 3.5, solid: false });

  // stations
  g.block(6, 14.6, 1.6, 1.05, 0.6, 'refSteel');
  g.block(6, 14.6, 1.2, 0.5, 0.08, 'refNavy', { h: 1.05, solid: false }).material = g.glow(BLUE, 2.2);
  g.block(18, 18.2, 2.4, 0.28, 1.6, 'domBronze', { solid: false });
  g.block(18, 19.4, 2.8, 1.2, 0.5, 'domOxblood', { cover: 'low' });
  g.block(12, 30.6, 0.9, 1.1, 0.5, 'goldDark');
  g.block(12, 30.6, 0.7, 0.06, 0.4, 'goldTrim', { h: 1.1, solid: false }).material = g.glow(GOLD, 2.6);
  g.block(7, 27, 3, 1.2, 1, 'whiteGold', { cover: 'low' });
  g.block(17, 27, 3, 2.2, 1, 'whiteGold', { cover: 'high' });

  // gold route channels (recognition / route continuity) and the white point over the exit
  g.strip([12, 1], [12, 12], GOLD);
  g.strip([12, 12], [9, 15], GOLD);
  g.strip([12, 12], [15, 15], GOLD);
  g.strip([9, 15], [12, 21], GOLD);
  g.strip([15, 15], [12, 21], GOLD);
  g.strip([12, 21], [12, 39.5], GOLD);
  g.whitePoint(12, 39.7, 4.6);

  g.key(12, 20, [-14, 22, 10], 0xfff0dc, 2.4);
  g.point(6, 13, 3.2, BLUE, 26, 12);
  g.point(18, 17, 3.2, AMBER, 30, 12);
  g.point(12, 31, 3.6, GOLD, 30, 14);
  g.point(12, 6, 4.2, 0xffe2a8, 40, 16);

  b.marker('start', 12, 3, 0, 0);
  b.marker('lyessa', 10.2, 4.2, 0, 0);
  b.marker('selene', 14.5, 9, 0, 200);
  b.marker('console', 6, 13.6, 0, 0);
  b.marker('sustain', 9, 9, 0, 0);
  b.marker('lift', 18, 17, 0, 0);
  b.marker('liftSelene', 15.5, 15, 0, 60);
  b.marker('record', 21.5, 6, 0, 0);
  b.marker('door', 12, 22, 0, 0);
  b.marker('panel', 12, 29.6, 0, 0);
  b.marker('panelLead', 12, 27.4, 0, 0);
  b.marker('panelPartner', 9.6, 26.2, 0, 0);
  b.marker('enemyA', 8, 35, 0, 180);
  b.marker('enemyB', 16, 36, 0, 180);
  b.marker('exit', 12, 38.6, 0, 0);
  b.finalize();
}

/** world state the south half leaves behind (used by the `enter` of every later beat) */
function southDone(z: ZoneRuntime): void {
  z.setFlag('t01ConsoleRead', true);
  z.setFlag('t01PlateLifted', true);
}

function* arrival(z: ZoneRuntime): Routine {
  const lyessa = z.cast('lyessa');
  yield* z.cinematic('t01-intro', function* (c): Routine {
    c.cut({ pos: z.P(20.5, 0.9, 5.2), look: z.P(11, 20, 1.2), fov: 48 });
    c.moveAsync({ pos: z.P(17.5, 1.2, 3.4), look: z.P(11.5, 22, 1.3), fov: 44 }, 4, 'inOut');
    yield* z.say('Narrator', 'A test hall. Everything the mission system can do, in forty metres.', { channel: 'narration' });
    c.twoShot(z.m('start'), z.m('lyessa'), { side: -1 });
    yield* z.say('Lyessa', 'Console first. Then the plate. Then we see who leads.', { actor: lyessa });
    c.shot(z.m('start'), { yawDeg: 20, distance: 3.4 });
    c.drift({ around: z.m('start'), yawRate: 0.08 });
    yield* z.say('Tarrik', 'Then we stop talking and walk.', { actor: z.player });
    z.setFlag('t01IntroSeen', true);
  });
  z.titleCard();
  z.objective('Read the console', 'console');
  z.optionalMarker('O1', 'record', 'O1 · Test record');
  z.pickup('sustain', 'sustain');
  z.hint('Move to the console', 'interact', 6);
  z.fork(recordPocket(z), 'record');
  const console = z.interact({ id: 't01-console', at: 'console', prompt: 'Read the console', required: true, radius: 2.4 });
  yield z.untilInteract(console);
  z.setFlag('t01ConsoleRead', true);
  z.bark('Lyessa', 'Logged. The plate is next.', { channel: 'radio', offscreen: true });
}

/** optional pocket: stays available for the whole zone, never required */
function* recordPocket(z: ZoneRuntime): Routine {
  const rec = z.interact({ id: 't01-record', at: 'record', prompt: 'Recover the test record', radius: 2.2 });
  yield z.untilInteract(rec);
  z.optionalDone('O1');
}

function* lift(z: ZoneRuntime): Routine {
  z.objective('Lift the plate', 'lift');
  z.hint('Hold to lift', 'interact', 5);
  z.cast('selene')?.moveTo(z.m('liftSelene'), { yaw: z.myaw('liftSelene') });
  const plate = z.interact({
    id: 't01-plate', at: 'lift', prompt: 'Lift the plate', hold: 1.6, required: true, interruptible: true, radius: 2.4,
    onStart: () => z.game.audio.play('plateLift', { pos: z.m('lift') }),
  });
  yield z.untilInteract(plate);
  z.setFlag('t01PlateLifted', true);
  yield* z.say('Selene', 'That would have taken my people a requisition form.', { actor: z.cast('selene') });
}

function* handoff(z: ZoneRuntime): Routine {
  z.objective('Regroup with Selene', 'liftSelene');
  yield z.untilNear('liftSelene', 2.6);
  z.objective(null);
  yield* z.handoff('selene', { partnerMode: 'follow', line: ['Selene', 'My turn. Stay close.'] });
  z.setFlag('t01HandedOff', true);
}

function* choice(z: ZoneRuntime): Routine {
  z.objective('Set the priority at the recovery panel', 'panel');
  const panel = z.interact({ id: 't01-panel', at: 'panel', prompt: 'Open the recovery panel', required: true, radius: 2.4 });
  yield z.untilInteract(panel);
  const pick = yield* z.choice({
    id: 't01-priority',
    title: 'Local priority',
    prompt: 'Lyessa can hold one position. Where does she set it?',
    options: [
      { id: 'WestStretchers', label: 'West recess', detail: 'Stretcher cases first. The walking wounded wait for the second lift.', tag: 'WEST' },
      { id: 'EastWalkers', label: 'East recess', detail: 'Walking wounded first. The stretcher cases hold behind the shutter.', tag: 'EAST' },
    ],
    note: 'This choice is explicit and untimed.',
  });
  z.commitRescuePriority(pick === 'EastWalkers' ? 'EastWalkers' : 'WestStretchers');
  z.story('threatExchangeOpen');
  yield* z.say('Lyessa', pick === 'EastWalkers' ? 'East it is. Walkers move now.' : 'West it is. Stretchers move now.', { channel: 'radio', offscreen: true });
}

function* fight(z: ZoneRuntime): Routine {
  z.objective('Clear the north half');
  const enc = z.encounter({
    id: 't01-e',
    maxActive: 2,
    waves: [{ spawns: [{ role: 'linkbound', at: 'enemyA' }, { role: 'secDrone', at: 'enemyB', opts: { team: 'contaminated' } }] }],
  });
  enc.start();
  z.bark('Tarrik', 'Two. One on the floor, one in the air.');
  yield z.until(() => enc.cleared);
  z.setFlag('t01Cleared', true);
}

function* leave(z: ZoneRuntime): Routine {
  z.objective('Leave through the north threshold', 'exit');
  yield z.untilNear('exit', 2.2);
  yield* z.exit(T02_ID, { fade: 'black', seconds: 0.7 });
}

/** cast for a start in the north half with Selene leading (after the handoff) */
function enterNorth(z: ZoneRuntime, at: string): void {
  southDone(z);
  z.setFlag('t01HandedOff', true);
  z.spawnPlayer('selene', at);
  z.companion('tarrik', 'panelPartner', 'follow');
  z.companion('lyessa', 'lyessa', 'hold');
}

export function createT01(game: Game): ZoneDef {
  return {
    id: T01_ID,
    title: 'Mission Test Hall',
    subtitle: 'Every runtime feature in forty metres',
    art: 'relay-route',
    cast: ['linkbound', 'secDrone'],
    build: (b) => build(b, new Greybox(game, b)),
    beats: [
      {
        id: 'arrival',
        checkpoint: 'CP0',
        enter(z) {
          z.spawnPlayer('tarrik', 'start');
          z.companion('lyessa', 'lyessa', 'follow');
          z.companion('selene', 'selene', 'hold');
        },
        run: arrival,
      },
      { id: 'lift', run: lift },
      {
        id: 'handoff',
        checkpoint: 'CP1',
        enter(z) {
          southDone(z);
          z.spawnPlayer('tarrik', 'lift');
          z.companion('lyessa', 'lyessa', 'follow');
          z.companion('selene', 'liftSelene', 'hold');
        },
        run: handoff,
      },
      { id: 'choice', enter: (z) => enterNorth(z, 'panelLead'), run: choice },
      { id: 'fight', checkpoint: 'CP2', enter: (z) => enterNorth(z, 'panelLead'), run: fight },
      { id: 'leave', run: leave },
    ],
  };
}
