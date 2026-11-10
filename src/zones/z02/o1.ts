/**
 * Z02 — O1 · Casualty log (optional, SCRIPT_SOURCE Z02 O1): a Dominion field relay in the side loop shows the
 * insertion team's casualty list. Tarrik starts to read it and stops; Lyessa asks short, precise questions and
 * waits (she does not comfort him); then the two ch23 exchanges, RELOCATED. No invented names and no total —
 * ranks and unit rows run off the edge of the hologram. Ends with `z.optionalDone('O1')`.
 */
import * as THREE from 'three';
import type { CineCtx, HologramProp, Interactable, Routine, ZoneBuilder, ZoneRuntime } from '@/core/api';
import type { Companion } from '@/core/api';
import type { ConvLine } from '../shared';

interface O1State {
  log: HologramProp | null;
  running: boolean;
}
let L: O1State = { log: null, running: false };
export function resetO1(): void {
  L = { log: null, running: false };
}

/** true while the O1 conversation plays (the main path waits for it before the cut) */
export function o1Running(): boolean {
  return L.running;
}

/** the log display over the field relay: plan (x, n), facing `yawDeg` (its readable front) */
export function buildLog(b: ZoneBuilder, x: number, n: number, yawDeg: number): void {
  const log = b.game.props.hologram('casualtyLog');
  log.object.position.copy(b.P(x, n, 0));
  log.object.rotation.y = b.yaw(yawDeg);
  log.setText('LAST THRONE - CASUALTY LOG'); // NEW
  log.params.visible = 0.55;
  log.params.progress = 0.08;
  b.add(log.object);
  b.onUpdate((dt, t) => log.update(dt, t));
  L.log = log;
}

/** dispose the display (zone dispose) */
export function disposeLog(): void {
  L.log?.dispose();
}

/** the optional marker and the interaction; the conversation runs when the lead reads the log */
export function* o1(z: ZoneRuntime): Routine {
  if (z.state.optional.O1) {
    if (L.log) {
      L.log.params.visible = 0.55;
      L.log.params.progress = 1;
      L.log.snap();
    }
    return;
  }
  z.optionalMarker('O1', 'o1Log', 'O1 · Casualty log'); // NEW
  const it: Interactable = z.interact({ id: 'z02-o1-log', at: 'o1Log', prompt: 'Read the casualty log', radius: 2.2 }); // NEW
  yield z.untilInteract(it);
  z.optionalMarker('O1', null);
  L.running = true;
  try {
    yield* scene(z);
  } finally {
    L.running = false;
  }
  z.optionalDone('O1');
}

/**
 * Front three-quarter singles from the glass side of the passage (over-the-shoulder coverage would sit behind
 * Tarrik's sheathed greatsword in this narrow loop). A line by the same speaker holds the shot.
 */
function* singles(z: ZoneRuntime, c: CineCtx, lines: ConvLine[], lyessa: Companion | null): Routine {
  let prev = '';
  for (const [who, text, opts] of lines) {
    const self = who === 'Tarrik' ? z.player.pos : lyessa ? lyessa.actor.pos : z.m('o1Lyessa');
    const other = who === 'Tarrik' ? (lyessa ? lyessa.actor.pos : z.m('o1Lyessa')) : z.player.pos;
    if (who !== prev) {
      const toOther = THREE.MathUtils.radToDeg(Math.atan2(other.x - self.x, -(other.z - self.z)));
      // turn toward the glass (south) side of the line between them
      const side = Math.sin(THREE.MathUtils.degToRad(toOther)) >= 0 ? 1 : -1;
      c.shot(self, { yawDeg: toOther + 42 * side, distance: 2.1, height: 1.62, lookHeight: 1.58, fov: 34 });
      prev = who;
    }
    yield* z.say(who, text, { ...opts, actor: who === 'Tarrik' ? z.player : lyessa });
  }
}

function* scene(z: ZoneRuntime): Routine {
  const lyessa = z.cast('lyessa');
  const log = L.log;
  yield* z.cinematic('z02-o1', function* (c: CineCtx): Routine {
    z.game.player.teleport(z.m('o1Tarrik'), z.myaw('o1Tarrik'));
    if (lyessa) {
      lyessa.teleport(z.m('o1Lyessa'), z.myaw('o1Lyessa'));
      lyessa.holdAt(z.m('o1Lyessa'), z.myaw('o1Lyessa'));
    }
    if (log) log.params.visible = 1;
    // over his shoulder: the rows, and through them the casualties behind the glass
    const t = z.m('o1Tarrik');
    const logAt = z.m('o1Log');
    // from his left: his profile, the rows, and through them the casualties behind the glass
    c.cut({ pos: t.clone().add(new THREE.Vector3(-1.75, 1.62, -0.25)), look: logAt.clone().setY(1.4), fov: 42 });
    c.moveAsync({ pos: t.clone().add(new THREE.Vector3(-1.5, 1.6, -0.15)), look: logAt.clone().setY(1.38), fov: 38 }, 9, 'inOut');
    if (log) log.params.progress = 0.4;
    yield 1.8;
    // he starts to read the list, and stops
    yield* z.say('Tarrik', 'Sergeant. Fourth squad.', { actor: z.player }); // NEW
    if (log) log.params.progress = 0.62;
    yield* z.say('Tarrik', 'Legionary. Fourth squad.', { actor: z.player }); // NEW
    if (log) log.params.progress = 0.66;
    yield 1.6;
    // he turns from the list to her; the passage runs east–west, so the coverage has room
    if (lyessa) {
      z.game.player.playScripted('idle', { faceTo: lyessa.actor.pos });
      lyessa.face(z.player.pos);
    }
    const lines: ConvLine[] = [
      ['Lyessa', 'Have you counted them?'], // NEW
      ['Tarrik', 'Not yet.'], // NEW
    ];
    yield* singles(z, c, lines, lyessa);
    // she waits
    yield 1.4;
    if (log) log.params.progress = 1;
    const mission: ConvLine[] = [
      ['Lyessa', 'What is our actual mission?'], // RELOCATED (ch23, the command deck)
      ['Tarrik', 'Get there first.'],
      ['Lyessa', 'Before the Reformation?'],
      ['Tarrik', 'Yes.'],
      ['Lyessa', 'Before Crownwatch?'],
      ['Tarrik', 'Before anyone who believes possession gives them the right to decide.'],
      ['Lyessa', 'To take the Crownmark?'],
      ['Tarrik', 'No.'],
      ['Lyessa', 'Secure it?'],
      ['Tarrik', 'No.'],
      ['Lyessa', 'Then what?'],
      ['Tarrik', 'Keep anyone from touching it.'],
    ];
    yield* singles(z, c, mission, lyessa);
    yield 1.2;
    c.shot(z.player.pos, { yawDeg: 125, distance: 2.4, height: 1.6, lookHeight: 1.55, fov: 34 });
    yield* z.say('Lyessa', 'And if Caelus orders you to take Crownmark Five?', { actor: lyessa }); // RELOCATED (ch23, the observation deck)
    yield 0.8;
    yield* z.say('Tarrik', 'I don’t know.', { actor: z.player });
    yield 1.4;
    // end state
    if (log) {
      log.params.visible = 0.55;
      log.params.progress = 1;
    }
    if (lyessa) {
      lyessa.mode = 'follow';
      lyessa.follow(z.player, { right: -1.6, back: 2.2 });
    }
  }, { blendOut: 0.6 });
}
