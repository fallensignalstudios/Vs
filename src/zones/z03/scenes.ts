/**
 * Z03 — the authored scenes (SCRIPT_SOURCE Z03). The author's lines are exact (curly apostrophes are the book's)
 * and play in order; every new string is tagged `// NEW`. Skip = fast-forward: every state change happens inside
 * the routine; only sound, VFX and captions sit behind `!z.skipping`.
 *
 *   arrivalScene   the tether, the hatch; Lyric nearly collapses and Tharne catches her (played as the book writes it)
 *   scanScene      the first plane crosses ahead; their own sensors have tagged them hostile
 *   terminalScene  what Lyric feels; the reconstruction; the manifest; Sol; Selene closes the channel
 *   updateScenes   ZoneDef.update: hatch, tether, the stirring tissue, the hologram, held hands (a skip snaps)
 */
import * as THREE from 'three';
import type { CineCtx, Companion, Routine, ZoneRuntime } from '@/core/api';
import { isHumanoidVisual } from '@/core/api';
import { damp, yawTo } from '@/core/mathx';
import { FROST, VIOLET, atPost, conversation, feet, waitOr, walkTo } from '../shared';
import { HATCH_OPEN_DEG, HOLO_GRID_H, TERMINAL, TETHER_FROM, TETHER_TO, WRECK_N, WRECK_REAR_X } from './layout';
import { S } from './state';

/** Lyric's marks here: violet traces above her collar, along her jaw (Z05 starts her at 0.2, Z06 at 0.26) */
export const LYRIC_MARKS = { arrive: 0.2, feel: 0.26 } as const;

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

// =====================================================================================================================
// Arrival
// =====================================================================================================================

/**
 * `arrival` (ch24): the tether snaps taut on the rib — “Anchor.” The hatch drops. “Lyric steps down and nearly
 * collapses. Tharne catches her, and this time she does not pull away.” The joke comes back in the same breath,
 * the hand she puts to the rib trembles, and when Tharne says “Move.” she moves. Nobody explains it.
 */
export function* arrivalScene(z: ZoneRuntime): Routine {
  const game = z.game;
  const tharne = z.cast('tharne');
  const lyric = z.cast('lyric');
  const hatch = z.P(WRECK_REAR_X + 0.6, WRECK_N, 1.2);

  yield* z.cinematic('z03-arrival', function* (c: CineCtx): Routine {
    // inside the hull's rear, the hatch still shut
    for (const s of [tharne, lyric]) {
      s?.stopAction();
      if (s) s.mode = 'scripted';
    }
    game.player.cancelAction?.();
    game.player.teleport(z.m('seleneHatch'), z.myaw('seleneHatch'));
    // Verity collapsed in her hand until she comes down off the hatch (the blades ignite on «What kind?»)
    game.player.playScripted('verityCollapsed');
    tharne?.teleport(z.m('tharneHatch'), z.myaw('tharneHatch'));
    lyric?.teleport(z.m('lyricHatch'), z.myaw('lyricHatch'));
    lyric?.actor.visual?.setCorruption(LYRIC_MARKS.arrive);
    S.hatchTarget = 0;
    S.tetherTarget = 0;

    // (1) the dropship lodged among the ribs, seen from inside the corridor; frost on everything
    c.cut({ pos: z.P(-1.6, 3.4, 1.7), look: z.P(1.2, 13.0, 4.4), fov: 56 });
    c.moveAsync({ pos: z.P(-0.8, 4.2, 1.9), look: z.P(1.4, 13.2, 4.9), fov: 50 }, 6.5, 'inOut');
    if (!z.skipping) game.audio.play('structuralGroan', { volume: 0.55 });
    yield 2.2;
    // the anchor line fires from the hull and snaps taut on the broken rib
    S.tetherTarget = 1;
    if (!z.skipping) game.audio.play('stasisThrow', { pos: TETHER_FROM.clone(), pitch: 0.7 });
    yield 0.4;
    if (!z.skipping) {
      game.audio.play('guardBlock', { pos: TETHER_TO.clone(), pitch: 0.55 });
      game.camera.shake(0.16, 0.35);
    }
    yield* z.say('Selene', 'Anchor.', { offscreen: true });

    // (2) the rear hatch drops; cold light spills out over the ice
    c.cut({ pos: z.P(7.4, 9.6, 1.55), look: z.P(0.6, WRECK_N + 0.5, 1.35), fov: 42 });
    c.moveAsync({ pos: z.P(6.8, 10.0, 1.5), look: z.P(1.2, WRECK_N + 0.6, 1.3), fov: 38 }, 4, 'inOut');
    S.hatchTarget = 1;
    if (!z.skipping) {
      game.audio.play('doorOpen', { pos: hatch, pitch: 0.75 });
      game.vfx.spawn('frostBurst', z.P(WRECK_REAR_X + 1.8, WRECK_N, 0.3), { scale: 0.7 });
    }
    yield 1.5;
    // “Lyric steps down and nearly collapses. Tharne catches her, and this time she does not pull away.”
    walkTo(z, lyric, 'lyricStep');
    walkTo(z, tharne, 'tharneCatch');
    yield waitOr(z, () => z.skipping || atPost(z, lyric, 'lyricStep', 0.45), 3.4);
    lyric?.teleport(z.m('lyricStep'), z.myaw('lyricStep'));
    lyric?.play('stagger');
    if (!z.skipping) game.audio.play('armorRattle', { pos: z.m('lyricStep'), volume: 0.6 });
    yield 0.4;
    tharne?.teleport(z.m('tharneCatch'), z.myaw('tharneCatch'));
    tharne?.face(z.m('lyricStep'));
    lyric?.play('limp', { loop: true });
    // held where they are while he holds her up (no separation push between the two bodies)
    for (const s of [tharne, lyric]) if (s) s.actor.fixed = true;
    S.catching = true;
    const L = z.m('lyricStep');
    const T = z.m('tharneCatch');
    const both = L.clone().lerp(T, 0.5);
    c.shot(both, { yawDeg: 118, distance: 2.6, height: 1.3, lookHeight: 1.2, fov: 36 });
    yield 1.4;
    c.shot(both, { yawDeg: 105, distance: 2.0, height: 1.5, lookHeight: 1.4, fov: 32 });
    yield* sayHeld(z, 'Tharne', 'Talk to me.', tharne);
    c.shot(L, { yawDeg: 100, distance: 1.45, height: 1.55, lookHeight: 1.45, fov: 30 });
    yield* sayHeld(z, 'Lyric', 'I hate that sentence.', lyric);
    c.twoShot(T, L, { side: -1, distance: 1.3, fov: 32 });
    yield* sayHeld(z, 'Tharne', 'Talk anyway.', tharne);

    // she straightens out of his hold and puts one trembling hand against the rib
    S.catching = false;
    holdOff(tharne, lyric);
    lyric?.stopAction();
    for (const s of [tharne, lyric]) if (s) s.actor.fixed = false;
    lyric?.teleport(z.m('lyricWall'), z.myaw('lyricWall'));
    S.tremble = z.m('wallTouch');
    c.shot(z.m('lyricWall'), { yawDeg: 125, distance: 2.0, height: 1.5, lookHeight: 1.35, fov: 36 });
    yield 0.5;
    yield* sayHeld(z, 'Lyric', 'There are things inside this place.', lyric);

    // Selene comes down off the hatch; her staff separates at both ends into twin blades of blue-white energy
    game.player.teleport(z.m('seleneStep'), z.myaw('seleneStep'));
    const sel = z.m('seleneStep');
    c.twoShot(sel, z.m('lyricWall'), { side: 1, distance: 1.7, fov: 36 });
    // «blades flare»: the hilt comes up, the blades snap out of both ends and flare cold-white (draws Verity)
    z.player.visual?.stop('verityCollapsed');
    game.player.playScripted('igniteBlades', { faceTo: L });
    z.player.visual?.setGlow(1.6);
    // the ignition ('hit' at 0.24 of the 1.15 s clip): the frost flash and the whirl ride it
    yield 0.28;
    if (!z.skipping) {
      game.vfx.flash(z.player.aimPoint(_v), FROST, 1.2, 0.3);
      game.vfx.spawn('frostBurst', z.player.visual?.socket('handR').getWorldPosition(_w) ?? z.player.aimPoint(_w), { scale: 0.35 });
      game.audio.play('verityWhirl', { pos: sel, volume: 0.5, pitch: 1.2 });
    }
    yield 0.32;
    yield* z.say('Selene', 'What kind?', { actor: z.player });
    c.shot(z.m('lyricWall'), { yawDeg: bearing(z.m('lyricWall'), sel) - 25, distance: 1.7, height: 1.6, lookHeight: 1.5, fov: 32 });
    yield* z.say('Lyric', 'The kind that know we came.', { actor: lyric });
    c.twoShot(T, sel, { side: -1, distance: 1.8, fov: 36 });
    yield* z.say('Tharne', 'Move.', { actor: tharne });

    // end state — identical watched or skipped
    S.hatchTarget = 1;
    S.tetherTarget = 1;
    S.tremble = null;
    S.catching = false;
    holdOff(tharne, lyric);
    for (const s of [tharne, lyric]) if (s) s.actor.fixed = false;
    z.player.visual?.stop('verityCollapsed');
    z.player.visual?.setLoadout({ melee: true });
    z.player.visual?.setGlow(1);
    placeAtStart(z, tharne, lyric);
    z.setFlag('z03Landed', true);
  }, { blendOut: 0.6 });
}

/** the three where the arrival leaves them (also the `arrival` checkpoint restore after the scene) */
export function placeAtStart(z: ZoneRuntime, tharne: Companion | null, lyric: Companion | null): void {
  z.game.player.teleport(z.m('start'), z.myaw('start'));
  for (const [s, at] of [[tharne, 'tharneStart'], [lyric, 'lyricStart']] as const) {
    if (!s) continue;
    s.stopAction();
    s.teleport(z.m(at), z.myaw(at));
    s.mode = 'follow';
  }
}

/** compass bearing (plan degrees: 0 north, 90 east) from a to b — for `c.shot` yawDeg toward a face */
function bearing(a: THREE.Vector3, b: THREE.Vector3): number {
  return (Math.atan2(b.x - a.x, -(b.z - a.z)) * 180) / Math.PI;
}

/**
 * A line said without turning the speaker to the lead (the two of them face each other here); the mouth is driven
 * directly for its length.
 */
function* sayHeld(z: ZoneRuntime, speaker: string, text: string, who: Companion | null): Routine {
  const v = who?.actor.visual;
  const hv = isHumanoidVisual(v) ? v : null;
  hv?.setSpeaking(0.7);
  yield* z.say(speaker, text);
  hv?.setSpeaking(0);
}

/** release both figures' IK hands */
function holdOff(tharne: Companion | null, lyric: Companion | null): void {
  for (const c of [tharne, lyric]) {
    const v = c?.actor.visual;
    if (isHumanoidVisual(v)) {
      v.setHandTarget('L', null);
      v.setHandTarget('R', null);
    }
  }
}

// =====================================================================================================================
// Scan
// =====================================================================================================================

/**
 * `scan` (RELOCATED from the Accord, ch24, spliced into one exchange): the first plane crosses ahead and Tharne
 * sees their own sensors tag them hostile. The new line after “Already attempting it.” says the fix is physical
 * and ahead — the two receivers E2 asks the player to take down.
 */
export function* scanScene(z: ZoneRuntime): Routine {
  const game = z.game;
  const tharne = z.cast('tharne');
  const lyric = z.cast('lyric');
  yield* z.cinematic('z03-scan', function* (c: CineCtx): Routine {
    // the two of them close up behind her (they are never scanned)
    if (tharne && !atPost(z, tharne, 'tharneScan', 2.5)) tharne.teleport(z.m('tharneScan'), z.myaw('tharneScan'));
    if (lyric && !atPost(z, lyric, 'lyricScan', 2.5)) lyric.teleport(z.m('lyricScan'), z.myaw('lyricScan'));
    // a pale sheet crosses the corridor ahead, its edge bright; far off, on the deck, something tracks it
    c.cut({ pos: z.P(5.2, 9.2, 1.75), look: z.P(17, 13.5, 1.9), fov: 50 });
    c.moveAsync({ pos: z.P(6.0, 9.8, 1.7), look: z.P(18, 13, 1.8), fov: 44 }, 5, 'inOut');
    if (!z.skipping) game.events.emit('caption', { text: 'Scan plane sweeping', kind: 'scan', pos: z.P(14, 13, 1.5) }); // NEW
    yield 2.6;
    const th = feet(z, tharne);
    c.shot(th, { yawDeg: 60, distance: 1.7, height: 1.62, lookHeight: 1.4, fov: 34 });
    yield* conversation(z, c, [
      ['Tharne', 'That’s wrong.'],
      ['Selene', 'What is?'],
      ['Tharne', 'Control contamination.'],
      ['Selene', 'Sever external network links.'],
      ['Tharne', 'Already attempting it.'],
      ['Tharne', 'Not from here. The links run through two receivers ahead.'], // NEW
    ], { Tharne: tharne, Selene: z.player }, { distance: 1.6, fov: 34 });
    // end state
    if (tharne) tharne.mode = 'follow';
    if (lyric) lyric.mode = 'follow';
  });
}

// =====================================================================================================================
// Terminal
// =====================================================================================================================

/** the manifest rows (the book's words: “Cold-field containment equipment and biological isolation systems”) */
const MANIFEST = [
  { label: 'COLD-FIELD CONTAINMENT EQUIPMENT', value: 'DEPLOYED', tone: 'neutral' as const }, // NEW (value)
  { label: 'BIOLOGICAL ISOLATION SYSTEMS', value: 'DEPLOYED', tone: 'neutral' as const }, // NEW (value)
  { label: 'SAMPLE RECOVERY UNITS', value: 'STANDBY', tone: 'warn' as const }, // NEW (value)
];

/**
 * `terminalRead` (≈ 2 min). What Lyric feels (RELOCATED from the Accord); the reconstruction Tharne reads (NEW);
 * the manifest and Sol's «sample recovery» (RELOCATED from the Accord, where the deployment manifest is what she
 * reads); Selene closes the channel with her hand on Caerion II.
 */
export function* terminalScene(z: ZoneRuntime): Routine {
  const game = z.game;
  const ui = game.ui;
  const tharne = z.cast('tharne');
  const lyric = z.cast('lyric');
  const holo = z.m('holo');
  const stir = z.m('stir');

  yield* z.cinematic('z03-terminal', function* (c: CineCtx): Routine {
    for (const s of [tharne, lyric]) {
      s?.stopAction();
      if (s) s.mode = 'scripted';
    }
    game.player.cancelAction?.();
    game.player.teleport(z.m('terminal'), z.myaw('terminal'));
    tharne?.teleport(z.m('tharneTerm'), z.myaw('tharneTerm'));
    lyric?.teleport(z.m('lyricTerm'), z.myaw('lyricTerm'));
    const sel = z.m('terminal');
    const th = z.m('tharneTerm');
    const ly = z.m('lyricTerm');
    // the middle of the reconstruction (its grid floats at HOLO_GRID_H; the figures stand on it)
    const display = holo.clone().setY(HOLO_GRID_H + 0.3);
    game.player.playScripted('interact', { faceTo: z.P(TERMINAL[0], TERMINAL[1], 1) });

    // before she reads: the dark tissue behind the ice stirs
    S.stirTarget = 1;
    c.cut({ pos: z.P(35.2, 17.4, 1.5), look: stir.clone().setY(1.6), fov: 38 });
    c.moveAsync({ pos: z.P(35.8, 18.2, 1.55), look: stir.clone().setY(1.5), fov: 34 }, 4, 'inOut');
    if (!z.skipping) game.audio.play('eclipseBreath', { pos: stir, volume: 0.45 });
    yield 1.8;
    lyric?.face(stir);
    lyric?.actor.visual?.lookAt(stir);
    lyric?.actor.visual?.setCorruption(LYRIC_MARKS.feel);
    if (!z.skipping) lyric?.actor.visual?.flash(VIOLET, 0.8, 0.35);
    // she turns from the console to Lyric
    game.player.teleport(sel, yawTo(sel.x, sel.z, ly.x, ly.z));
    const onLyric = (): void => c.shot(ly, { yawDeg: bearing(ly, sel) - 28, distance: 1.8, height: 1.6, lookHeight: 1.52, fov: 32 });
    const onSelene = (): void => c.shot(sel, { yawDeg: bearing(sel, ly) + 30, distance: 1.9, height: 1.6, lookHeight: 1.5, fov: 32 });
    onSelene();
    yield* z.say('Selene', 'What do you feel?', { actor: z.player });
    onLyric();
    yield* z.say('Lyric', 'They’re awake.', { actor: lyric });
    onSelene();
    yield* z.say('Selene', 'Who?', { actor: z.player });
    onLyric();
    yield* z.say('Lyric', 'All of it.', { actor: lyric });
    onSelene();
    yield* z.say('Selene', 'Can they feel you?', { actor: z.player });
    // she takes too long to answer
    c.shot(ly, { yawDeg: bearing(ly, sel) - 12, distance: 1.4, height: 1.62, lookHeight: 1.55, fov: 28 });
    yield 2.2;
    yield* z.say('Lyric', 'I think so.', { actor: lyric });
    S.stirTarget = 0.35;
    lyric?.actor.visual?.lookAt(null);

    // she reads: the reconstruction of the corridor's own scans
    S.holoVisible = 1;
    S.holoProgress = 0.15;
    S.holo?.setText('LOCAL SENSOR RECONSTRUCTION'); // NEW (display header)
    game.player.teleport(sel, yawTo(sel.x, sel.z, display.x, display.z));
    // (the look sits over the grid so the header line along its far edge stays in frame)
    const over = display.clone().setY(HOLO_GRID_H + 0.6);
    c.cut({ pos: z.P(40.2, 14.4, 2.25), look: over, fov: 44 });
    c.moveAsync({ pos: z.P(40.7, 14.2, 2.1), look: over, fov: 40 }, 8, 'inOut');
    if (!z.skipping) game.audio.play('ambConsoleTick', { pos: holo });
    tharne?.face(holo);
    yield 1.2;
    S.holoProgress = 0.55;
    // he reads it off the display (he keeps his eyes on it): from the console side, Tharne at the left of the
    // frame and the reconstruction beside him at the same distance — the figures walking through the fans he names
    const mid = th.clone().lerp(display, 0.36).setY(1.45);
    c.cut({ pos: z.P(39.3, 14.2, 1.85), look: mid, fov: 44 });
    c.moveAsync({ pos: z.P(39.6, 14.0, 1.8), look: mid, fov: 42 }, 9, 'inOut');
    yield* sayHeld(z, 'Tharne', 'The forward relay nodes are compromised.', tharne); // NEW
    yield* sayHeld(z, 'Tharne', 'They address friendly contacts as threats.', tharne); // NEW
    yield* sayHeld(z, 'Tharne', 'Two drones ahead are on that net.', tharne); // NEW
    S.holoProgress = 1;

    // the deployment manifest, then the line she stops on
    S.holo?.setText('DEPLOYMENT MANIFEST'); // NEW (display header)
    // (integration) the board sits in the lower third: the frame is her close-up and the rows run under it
    ui.statusBoard(MANIFEST.slice(0, 2), { title: 'DEPLOYMENT MANIFEST', placement: 'lowerThird' }); // NEW (title)
    const toDisplay = bearing(sel, display);
    c.shot(sel, { yawDeg: toDisplay + 205, distance: 1.5, height: 1.62, lookHeight: 1.5, fov: 30 });
    yield 1.6;
    ui.statusBoard(MANIFEST, { title: 'DEPLOYMENT MANIFEST', placement: 'lowerThird' });
    yield 1.4;
    if (!z.skipping) game.audio.play('ambCommBlip', { pos: sel });
    yield* z.say('Sol', 'Keeper Veyne.', { offscreen: true, channel: 'radio' }); // NEW (his opening on the channel)
    yield* z.say('Selene', 'Sample recovery units?', { actor: z.player });
    yield* z.say('Sol', 'Research assets.', { offscreen: true, channel: 'radio' });
    yield* z.say('Selene', 'For Eclipse material.', { actor: z.player });
    yield* z.say('Sol', 'Understanding the Eclipse is essential to preventing future outbreaks.', { offscreen: true, channel: 'radio' });
    // Lyric, low, to Selene
    ui.statusBoard(null);
    c.shot(ly, { yawDeg: bearing(ly, sel) - 24, distance: 1.7, height: 1.58, lookHeight: 1.5, fov: 32 });
    lyric?.face(sel);
    yield* z.say('Lyric', 'Do not let them put anything in those.', { actor: lyric });
    const onSeleneComm = (): void => c.shot(sel, { yawDeg: toDisplay + 32, distance: 1.8, height: 1.6, lookHeight: 1.5, fov: 32 });
    onSeleneComm();
    yield* z.say('Selene', 'You brought specimen-recovery equipment into an active containment failure.', { actor: z.player });
    yield* z.say('Sol', 'This is the first recoverable living material encountered in centuries.', { offscreen: true, channel: 'radio' });
    yield* z.say('Selene', 'Then leave it where it is.', { actor: z.player });
    yield* z.say('Sol', 'That is not your decision.', { offscreen: true, channel: 'radio' });
    yield* z.say('Selene', 'Keep the extraction units away from my team.', { actor: z.player });
    yield* z.say('Sol', 'That is not your authority.', { offscreen: true, channel: 'radio' });
    // her hand on Caerion II under her armor; the Crownmark warms beneath her hand; she closes the channel
    c.shot(sel, { yawDeg: toDisplay + 18, distance: 1.3, height: 1.5, lookHeight: 1.35, fov: 30 });
    handToChest(z, true);
    if (!z.skipping) {
      game.vfx.flash(z.player.aimPoint(_w), 0xeaf4ff, 0.9, 0.6);
      game.audio.play('ambGoldPing', { pos: sel, volume: 0.6 });
    }
    yield 0.6;
    yield* z.say('Selene', 'No. But this is.', { actor: z.player });
    if (!z.skipping) game.audio.play('ambCommBlip', { pos: sel, pitch: 0.7 });
    yield 0.5;
    handToChest(z, false);
    c.twoShot(th, sel, { side: -1, distance: 1.8, fov: 34 });
    yield* z.say('Tharne', 'That was strategically unwise.', { actor: tharne });
    c.twoShot(sel, th, { side: 1, distance: 1.8, fov: 34 });
    yield* z.say('Selene', 'Yes.', { actor: z.player });
    // a thin smile
    c.shot(ly, { yawDeg: bearing(ly, sel) - 20, distance: 1.6, height: 1.6, lookHeight: 1.52, fov: 30 });
    yield* z.say('Lyric', 'She’s learning.', { actor: lyric });
    // she turns for the door
    const exit = z.m('exit');
    game.player.teleport(sel, yawTo(sel.x, sel.z, exit.x, exit.z));
    c.shot(sel, { yawDeg: bearing(sel, exit) + 25, distance: 2.2, height: 1.6, lookHeight: 1.5, fov: 36 });
    yield* z.say('Selene', 'We go.', { actor: z.player });

    // end state — identical watched or skipped
    ui.statusBoard(null);
    handToChest(z, false);
    S.stirTarget = 0.35;
    S.holoVisible = 0.6;
    S.holoProgress = 1;
    S.holo?.setText('DEPLOYMENT MANIFEST'); // NEW (display header)
    lyric?.actor.visual?.lookAt(null);
    if (tharne) tharne.mode = 'follow';
    if (lyric) lyric.mode = 'follow';
    S.exit?.setState('ready');
    z.setFlag('z03TerminalRead', true);
  });
}

/** Selene's hand on Caerion II under her armor (IK to her own chest), or released */
function handToChest(z: ZoneRuntime, on: boolean): void {
  const v = z.player.visual;
  if (!isHumanoidVisual(v)) return;
  if (!on) {
    v.setHandTarget('R', null);
    return;
  }
  const chest = v.socket('chest').getWorldPosition(_v);
  const fwd = _w.set(-Math.sin(z.player.yaw), 0, -Math.cos(z.player.yaw));
  v.setHandTarget('R', chest.clone().addScaledVector(fwd, 0.16).setY(chest.y - 0.04), 1);
}

// =====================================================================================================================
// Per-frame (ZoneDef.update)
// =====================================================================================================================

const HATCH_CLOSED = 0;
const HATCH_OPEN = -(Math.PI / 2 + (HATCH_OPEN_DEG * Math.PI) / 180);

/** hatch, tether, the tissue's stir, the hologram, held hands and the trembling hand; a skip snaps every target */
export function updateScenes(z: ZoneRuntime, dt: number): void {
  const snap = z.skipping;
  const ease = (cur: number, target: number, rate: number): number => (snap ? target : damp(cur, target, rate, dt));
  if (S.hatch) {
    S.hatchOpen = ease(S.hatchOpen, S.hatchTarget, 2.6);
    S.hatch.rotation.z = HATCH_CLOSED + (HATCH_OPEN - HATCH_CLOSED) * S.hatchOpen;
    if (S.hatchLight) S.hatchLight.intensity = 26 * S.hatchOpen;
  }
  if (S.tether) {
    // fired: it shoots out fast and settles with a small overshoot
    const cur = S.tether.scale.y;
    const next = snap ? S.tetherTarget : cur + (S.tetherTarget - cur) * Math.min(1, dt * 14);
    S.tether.scale.y = Math.max(0.001, next);
  }
  if (S.stir) {
    S.stirLevel = ease(S.stirLevel, S.stirTarget, 1.6);
    const t = z.time;
    const swell = 1 + 0.16 * S.stirLevel + 0.05 * S.stirLevel * Math.sin(t * 2.3) + 0.02 * Math.sin(t * 0.9);
    S.stir.scale.set(swell, swell, 1 + 0.4 * S.stirLevel);
  }
  if (S.holo) {
    const p = S.holo.params;
    p.visible = S.holoVisible;
    p.progress = snap ? S.holoProgress : Math.min(S.holoProgress, p.progress + dt * 0.08);
    if (snap) S.holo.snap();
  }
  const tharne = z.cast('tharne');
  const lyric = z.cast('lyric');
  const tv = tharne?.actor.visual;
  const lv = lyric?.actor.visual;
  if (S.catching && isHumanoidVisual(tv) && lv) {
    // his hands on her right upper arm and her back; her free right hand on his shoulder (her left carries the
    // case) — she does not pull away
    const chest = lv.socket('chest').getWorldPosition(_v);
    const ry = lyric ? lyric.actor.yaw : 0;
    const rx = Math.cos(ry);
    const rz = -Math.sin(ry);
    const fx = -Math.sin(ry);
    const fz = -Math.cos(ry);
    tv.setHandTarget('L', _w.set(chest.x + rx * 0.19, chest.y + 0.02, chest.z + rz * 0.19), 1);
    tv.setHandTarget('R', _w.set(chest.x - fx * 0.17 + rx * 0.06, chest.y - 0.12, chest.z - fz * 0.17 + rz * 0.06), 0.9);
    const shoulder = tharne?.actor.visual?.socket('chest').getWorldPosition(_w);
    if (isHumanoidVisual(lv) && shoulder) lv.setHandTarget('R', shoulder.setY(shoulder.y + 0.12), 0.85);
  }
  if (S.tremble && isHumanoidVisual(lv)) {
    const t = z.time;
    const j = 0.012;
    _w.copy(S.tremble);
    _w.y += j * Math.sin(t * 61) + j * 0.6 * Math.sin(t * 37);
    _w.x += j * 0.7 * Math.sin(t * 47 + 1);
    lv.setHandTarget('R', _w, 1);
  } else if (!S.catching && S.tremble === null && isHumanoidVisual(lv) && S.handsHeld) {
    lv.setHandTarget('R', null);
  }
  S.handsHeld = S.catching || S.tremble !== null;
}

/** the arrival's end state for an entry that skips the scene (checkpoint reload after it, debug goto) */
export function arrivedState(): void {
  S.hatchTarget = 1;
  S.hatchOpen = 1;
  S.tetherTarget = 1;
  if (S.tether) S.tether.scale.y = 1;
  if (S.hatch) S.hatch.rotation.z = HATCH_OPEN;
  if (S.hatchLight) S.hatchLight.intensity = 26;
}
