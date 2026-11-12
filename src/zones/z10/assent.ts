/**
 * Z10 `assentTarrik` → handoff → `assentSelene` (SCRIPT_SOURCE Z10). Each assents alone, at a separate interface,
 * in their own name and in their own authored frame; neither authorizes for the other; nobody kneels, nobody
 * touches Crownmark Five. The screen keeps both `ASSENT PENDING` lines until the dark — nothing reads
 * «accepted», «confirmed» or «1 / 2». The final press belongs to no player input: after his “Yes.” it plays by
 * itself. Walking away from an interface only pauses the scene.
 */
import * as THREE from 'three';
import type { CineCtx, Companion, Interactable, Routine, ZoneRuntime } from '@/core/api';
import { isHumanoidVisual } from '@/core/api/chars';
import { C, DAIS_H, S, Z10_LOOK, setLights, setRise, show, snapProps, terminal, under } from './state';

/** pin a body's right palm onto its interface (`hand` marker) and hold the assent pose */
export function palm(z: ZoneRuntime, who: 'tarrik' | 'selene', on: boolean): void {
  const key = who === 'tarrik' ? 'T' : 'S';
  const lead = z.game.player.protagonist === who;
  const comp: Companion | null = lead ? null : z.cast(who);
  const visual = lead ? z.player.visual : comp?.actor.visual ?? null;
  if (on) {
    if (lead) z.game.player.playScripted('assent', { faceTo: z.m(`pad${key}`) });
    else comp?.play('assent');
  } else if (comp) {
    comp.stopAction();
  }
  if (isHumanoidVisual(visual)) visual.setHandTarget('R', on ? z.m(`hand${key}`) : null, on ? 1 : 0);
}

/** put a bearer at their interface (stand point, facing it) */
export function toPad(z: ZoneRuntime, who: 'tarrik' | 'selene'): void {
  const key = who === 'tarrik' ? 'T' : 'S';
  if (z.game.player.protagonist === who) z.game.player.teleport(z.m(`stand${key}`), z.myaw(`stand${key}`));
  else {
    const c = z.cast(who);
    if (c) {
      c.stopAction();
      c.mode = 'scripted';
      c.teleport(z.m(`stand${key}`), z.myaw(`stand${key}`));
      c.face(z.m(`pad${key}`));
    }
  }
}

const feet = (z: ZoneRuntime, who: 'tarrik' | 'selene'): THREE.Vector3 => {
  if (z.game.player.protagonist === who) return z.player.pos.clone();
  const c = z.cast(who);
  return c ? c.actor.pos.clone() : z.m(who === 'tarrik' ? 'standT' : 'standS');
};

/** “MERIDIAN COMPLETION PROTOCOL” — the interfaces rise, one before each of them; four negations; “Only us.” */
export function* protocolScene(z: ZoneRuntime): Routine {
  const game = z.game;
  const selene = z.cast('selene');
  yield* z.cinematic('z10-protocol', function* (c: CineCtx): Routine {
    toPad(z, 'tarrik');
    toPad(z, 'selene');
    // “Two interfaces rise from the floor, one before each of them.” — the crownmark-chamber painting's framing:
    // low on the axis, the two of them at their interfaces either side of Crownmark Five, the chrome rings and the
    // light column filling the volume above. Polish 4: tighter, so the bearers stand a quarter of the frame tall
    // (they were small figures under the overlays); the protocol strings sit at the side, above their heads
    terminal(z, ['MERIDIAN COMPLETION PROTOCOL', 'INDEPENDENT ASSENT REQUIRED'], true, 'side');
    c.cut({ pos: z.P(C.x, C.n - 12.6, 1.15), look: z.P(C.x, C.n - 0.5, 3.3), fov: 50 });
    c.moveAsync({ pos: z.P(C.x, C.n - 11.4, 1.2), look: z.P(C.x, C.n - 0.5, 3.0), fov: 46 }, 5, 'inOut');
    setRise(1);
    if (!z.skipping) {
      game.audio.play('liftMove', { pos: z.m('padT'), volume: 0.6 });
      game.audio.play('liftMove', { pos: z.m('padS'), volume: 0.6, delay: 0.15 });
      game.vfx.spawn('dustPuff', z.m('padT'));
      game.vfx.spawn('dustPuff', z.m('padS'));
    }
    yield 2.8;
    game.ui.statusBoard(null);
    for (const p of [S.padT.prop, S.padS.prop]) if (p) p.params.active = 0.35;
    const t = feet(z, 'tarrik');
    const s = feet(z, 'selene');
    c.twoShot(t, s, { side: -1, distance: 2.4, fov: 36 });
    yield* z.say('Tarrik', 'Independent.', { actor: z.player });
    c.twoShot(s, t, { side: 1, distance: 2.4, fov: 36 });
    yield* z.say('Selene', 'No bearer can authorize the other.', { actor: selene });
    c.twoShot(t, s, { side: -1, distance: 2.4, fov: 36 });
    yield* z.say('Tarrik', 'No command hierarchy.', { actor: z.player });
    c.twoShot(s, t, { side: 1, distance: 2.4, fov: 36 });
    yield* z.say('Selene', 'No.', { actor: selene });
    c.twoShot(t, s, { side: -1, distance: 2.4, fov: 36 });
    yield* z.say('Tarrik', 'No Emperor.', { actor: z.player });
    c.twoShot(s, t, { side: 1, distance: 2.4, fov: 36 });
    yield* z.say('Selene', 'No Council.', { actor: selene });
    yield* z.say('Selene', 'Only us.', { actor: selene });
    // “his eyes stay on hers for one second before he places his hand against the interface.”
    c.shot(t, { yawDeg: 140, distance: 2.0, height: 1.62, lookHeight: 1.62, fov: 30 });
    yield 1.1;
    // end state
    setRise(1, true);
    ui(z);
    snapProps(z);
  });
}

function ui(z: ZoneRuntime): void {
  z.game.ui.statusBoard(null);
}

/**
 * The palm interaction at one interface (played as that bearer). Resolves once the palm is down. The player may
 * look around first; walking away only pauses.
 */
export function* placePalm(z: ZoneRuntime, who: 'tarrik' | 'selene'): Routine {
  const key = who === 'tarrik' ? 'T' : 'S';
  z.objective('Place your palm', `pad${key}`); // NEW
  const it: Interactable = z.interact({
    id: `z10-palm-${who}`, at: `pad${key}`, prompt: 'Place your palm', hold: 1.0, radius: 1.9, required: true, markerRange: 10, // NEW
  });
  yield z.untilInteract(it);
  it.remove();
  z.objective(null);
}

/** Tarrik's palm and his sentence of record — his assent, in his own frame (warm) */
export function* tarrikPalmScene(z: ZoneRuntime): Routine {
  const game = z.game;
  yield* z.cinematic('z10-palm-tarrik', function* (c: CineCtx): Routine {
    toPad(z, 'tarrik');
    palm(z, 'tarrik', true);
    const hand = z.m('handT');
    // his frame: low and warm, over the interface toward him, the Crownmark behind
    c.cut({ pos: hand.clone().add(new THREE.Vector3(1.3, 0.25, 1.15)), look: hand.clone().setY(hand.y + 0.25), fov: 34 });
    if (S.padT.prop) S.padT.prop.params.active = 1;
    if (!z.skipping) {
      game.vfx.spawn('assentTarrik', z.m('padT'));
      game.audio.play('assentToneTarrik', { pos: hand });
    }
    // “The screen keeps both ASSENT PENDING lines until the dark” — under his sentence, not before it
    yield* under(z, ['BEARER A: ASSENT PENDING'], 1.6);
    c.shot(z.player.pos, { yawDeg: 160, distance: 2.3, height: 1.65, lookHeight: 1.6, fov: 32 });
    yield* z.say('Tarrik', 'My name is Tarrik Walcur. If this decision is wrong, that belongs in the record.', { actor: z.player });
    z.story('assentTarrik');
    yield 0.5;
    // end state — the board gives way to the palm prompt
    z.game.ui.statusBoard(null);
    snapProps(z);
  });
}

/** Selene's palm, her sentence, his clause that finishes it (no escape clause) */
export function* selenePalmScene(z: ZoneRuntime): Routine {
  const game = z.game;
  yield* z.cinematic('z10-palm-selene', function* (c: CineCtx): Routine {
    toPad(z, 'selene');
    palm(z, 'selene', true);
    palm(z, 'tarrik', true);
    const hand = z.m('handS');
    // her frame: high, still, exact — straight down the axis of the interface
    c.cut({ pos: hand.clone().add(new THREE.Vector3(-0.9, 0.95, 1.2)), look: hand, fov: 32 });
    if (S.padS.prop) S.padS.prop.params.active = 1;
    if (!z.skipping) {
      game.vfx.spawn('assentSelene', z.m('padS'));
      game.audio.play('assentToneSelene', { pos: hand });
    }
    yield* under(z, ['BEARER A: ASSENT PENDING', 'BEARER B: ASSENT PENDING'], 1.8);
    const s = feet(z, 'selene');
    const t = feet(z, 'tarrik');
    c.shot(s, { yawDeg: 200, distance: 2.3, height: 1.6, lookHeight: 1.58, fov: 32 });
    yield* z.say('Selene', 'My name is Selene Veyne.', { actor: z.player });
    yield* z.say('Selene', 'We are completing the Sovereign Meridian to restore primary containment stability.', { actor: z.player });
    const tarrik = z.cast('tarrik');
    c.twoShot(t, s, { side: -1, distance: 3.2, fov: 34 });
    yield* z.say('Tarrik', 'Knowing that terminal authority may become available afterward.', { actor: tarrik });
    yield 0.4;
    // end state — the board gives way to the confirm prompt (it returns for the two “Yes.”)
    z.game.ui.statusBoard(null);
  });
}

/** her “Yes.” is the player's confirm */
export function* confirmYes(z: ZoneRuntime): Routine {
  z.objective('Confirm', 'padS'); // NEW
  const it = z.interact({ id: 'z10-confirm', at: 'padS', prompt: 'Confirm', radius: 1.9, required: true, markerRange: 10 }); // NEW
  yield z.untilInteract(it);
  it.remove();
  z.objective(null);
}

/**
 * “Yes.” / “Yes.” — then the press by itself, the dark, the five lights one at a time, the geometry closes,
 * 5 / 5. A breath both of them take; neither mentions it. The pressure falls. “It worked.” / “For that part.”
 * Ends on `WITNESS V: AUTHENTICATED`.
 */
export function* meridianScene(z: ZoneRuntime): Routine {
  const game = z.game;
  const render = game.render;
  yield* z.cinematic('z10-meridian', function* (c: CineCtx): Routine {
    toPad(z, 'selene');
    palm(z, 'selene', true);
    palm(z, 'tarrik', true);
    const tarrik = z.cast('tarrik');
    const s = feet(z, 'selene');
    const t = feet(z, 'tarrik');
    // both PENDING lines stay on screen until the dark
    terminal(z, ['BEARER A: ASSENT PENDING', 'BEARER B: ASSENT PENDING'], true, 'lowerThird');
    c.twoShot(s, t, { side: 1, distance: 2.6, fov: 34 });
    yield* z.say('Selene', 'Yes.', { actor: z.player });
    z.story('assentSelene');
    c.twoShot(t, s, { side: -1, distance: 2.6, fov: 34 });
    yield* z.say('Tarrik', 'Yes.', { actor: tarrik });

    // “They press their palms forward, and the chamber goes dark.”
    c.cut({ pos: z.P(C.x, C.n - 11.5, 2.4), look: z.P(C.x, C.n, 4.5), fov: 52 });
    for (const p of [S.padT.prop, S.padS.prop]) if (p) p.params.assent = 1;
    game.ui.statusBoard(null);
    game.ui.readout(null);
    render.setLook({ exposure: 0.16, bloom: { intensity: 1.1 } }, z.skipping ? 0 : 0.7);
    if (S.rings) S.rings.params.energy = 0.1;
    if (S.crownmark) S.crownmark.params.glow = 0.15;
    if (S.diag) S.diag.params.visible = 0;
    if (S.forecast) S.forecast.params.visible = 0;
    yield 1.3;
    // “Five lights appear one at a time.” Ianis, Caerion II, Neon Veil, Cauldron, Aurelion — each white-gold,
    // no faction colour, no ownership mark
    c.cut({ pos: z.P(C.x, C.n - 13, 1.4), look: z.P(C.x, C.n, 11), fov: 54 });
    for (let i = 1; i <= 5; i++) {
      setLights(i);
      if (!z.skipping) game.audio.play('ambGoldPing', { volume: 0.8, pitch: 0.9 + i * 0.05 });
      yield 0.75;
    }
    // “The geometry closes.”
    if (S.rings) {
      S.rings.params.align = 1;
      S.rings.params.energy = 1;
    }
    if (!z.skipping) {
      game.audio.play('meridianAlign');
      game.vfx.spawn('meridianComplete', z.P(C.x, C.n, DAIS_H));
    }
    render.setLook(Z10_LOOK, z.skipping ? 0 : 2.6);
    yield 2.2;
    z.story('meridianComplete');
    game.audio.play('meridianComplete');
    if (S.crownmark) S.crownmark.params.glow = 1;
    if (S.diag) {
      S.diag.params.visible = 1;
      S.diag.params.progress = 1;
    }
    c.cut({ pos: z.P(C.x, C.n - 14.5, 0.9), look: z.P(C.x, C.n, 5.2), fov: 50 });
    yield* show(z, ['MERIDIAN CONTINUITY: 5 / 5', 'SOVEREIGN MERIDIAN: COMPLETE'], 2.4);
    // for less than a second each senses the other — a shared sharp breath, both hands pulled back. No line, ever.
    // (the `breath` gesture: the chest fills, the shoulders rise, it is let go — both at once)
    c.cut({ pos: t.clone().lerp(s, 0.5).add(new THREE.Vector3(0, 1.5, 4.2)), look: t.clone().lerp(s, 0.5).setY(t.y + 1.2), fov: 40 });
    yield 0.4;
    palm(z, 'selene', false);
    palm(z, 'tarrik', false);
    game.player.playScripted('breath', { faceTo: z.m('padS') });
    tarrik?.play('breath');
    yield 1.3;
    // “The Wound contracts violently, drawing the violet pressure back from its surface.”
    game.sky.setWoundActivity(0.05, { snap: z.skipping });
    if (!z.skipping) game.camera.shake(0.35, 1.2);
    c.cut({ pos: z.P(C.x - 3, C.n - 15, 1.2), look: z.P(C.x, C.n, 6), fov: 52 });
    terminal(z, [['BOUNDARY PRESSURE: FALLING', 'warn']], true, 'lowerThird');
    for (const v of ['132%', '119%', '103%', '87%']) {
      yield 0.65;
      terminal(z, [['BOUNDARY PRESSURE: FALLING', 'warn'], [`BOUNDARY PRESSURE: ${v}`, 'neutral']], false, 'lowerThird'); // NEW (the book's count)
    }
    yield 0.6;
    // the falling count stays under “It worked.”
    c.twoShot(t, s, { side: -1, distance: 2.4, fov: 34 });
    yield* z.say('Tarrik', 'It worked.', { actor: tarrik });
    game.ui.statusBoard(null);
    c.twoShot(s, t, { side: 1, distance: 2.4, fov: 34 });
    yield* z.say('Selene', 'For that part.', { actor: z.player });
    c.cut({ pos: z.P(C.x, C.n - 12, 1.6), look: z.P(C.x, C.n, 2.2), fov: 40 });
    yield* show(z, ['WITNESS V: AUTHENTICATED'], 2.0);
    // end state — identical watched or skipped
    setLights(5);
    if (S.rings) S.rings.params.align = 1;
    render.setLook(Z10_LOOK, 0);
    game.ui.statusBoard(null);
    snapProps(z);
  });
}
