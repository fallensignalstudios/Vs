/**
 * Z11 `reunion` (SCRIPT_SOURCE Z11 — the author's ruling 5: all five physically together, at the lift landing).
 * The lift arrives; the quarantine retracts — the isolation barriers on both corridors fall; Lyessa first, rifle
 * raised, and she says nothing yet; Tharne supporting Lyric; Selene takes Lyric's other arm. Lyric is alive,
 * quieter, and not cured. The summonses come in on both sides. “We should talk first.” / “Yes.” Lyessa chooses to
 * hold Cross's teams off. Then Selene takes the side passage; Tarrik follows; Lyessa stays at the junction.
 *
 * Trimmed lines (ext — trimmed) are not played. Every state change happens inside the routine (skip = fast-forward).
 */
import * as THREE from 'three';
import type { Actor, CamPose, CineCtx, Companion, Routine, ZoneRuntime } from '@/core/api';
import { yawTo } from '@/core/mathx';
import { atPost, feet, waitOr, walkTo } from '../shared';
import { S, comm, hold } from './state';

/** a pose in front of a body: `off` degrees off its facing (positive = toward its right), at head height */
function frontPose(z: ZoneRuntime, who: Actor | null, at: string, off: number, distance: number, fov: number, h = 1.62): CamPose {
  const p = who ? who.pos.clone() : z.m(at);
  const facing = who ? who.yaw : z.myaw(at);
  const b = -facing + THREE.MathUtils.degToRad(off);
  return { pos: new THREE.Vector3(p.x + Math.sin(b) * distance, p.y + h, p.z - Math.cos(b) * distance), look: p.clone().setY(p.y + h - 0.03), fov };
}
function front(z: ZoneRuntime, c: CineCtx, who: Actor | null, at: string, off: number, distance: number, fov: number, h = 1.62): void {
  c.cut(frontPose(z, who, at, off, distance, fov, h));
}

/** Lyric's upper arm on the side facing `from` (a hand rests there) */
function armOf(lyric: Companion | null, from: () => THREE.Vector3): () => THREE.Vector3 | null {
  const v = new THREE.Vector3();
  return () => {
    if (!lyric?.actor.visual) return null;
    lyric.actor.visual.socket('chest').getWorldPosition(v);
    const f = from();
    const side = f.clone().sub(v).setY(0);
    if (side.lengthSq() < 1e-4) return v;
    side.normalize();
    return v.addScaledVector(side, 0.2).setY(v.y - 0.16);
  };
}

export function* reunionScene(z: ZoneRuntime): Routine {
  const g = z.game;
  const sp = S.sp;
  const tarrik = z.cast('tarrik');
  const lyessa = z.cast('lyessa');
  const soldiers = [z.cast('soldier1'), z.cast('soldier2')];
  const tharne = z.cast('tharne');
  const lyric = z.cast('lyric');
  const P = (x: number, n: number, h: number): THREE.Vector3 => z.P(x, n, h);
  const say = (who: string, text: string, body: Companion | null | 'player'): Routine =>
    z.say(who, text, { actor: body === 'player' ? z.player : body });

  yield* z.cinematic('z11-reunion', function* (c: CineCtx): Routine {
    // (1) the lift arrives: gold light climbs the cab, the door opens on the two of them
    c.cut({ pos: P(11.9, 7.4, 1.72), look: P(11, -1.6, 1.55), fov: 40 });
    c.moveAsync({ pos: P(11.7, 6.4, 1.68), look: P(11, -1.6, 1.5), fov: 38 }, 4.4, 'inOut');
    if (!z.skipping) g.audio.play('liftMove', { pos: z.m('liftSelene') });
    if (sp?.liftLight) sp.liftLight.intensity = 46;
    yield 1.5;
    sp?.lift?.setState('open');
    sp?.lift?.setOpen(true);
    yield 2.2;

    // (2) the quarantine retracts: the west barrier falls, and Lyessa is behind it with her rifle raised
    c.cut({ pos: P(8.2, 3.2, 1.6), look: P(1.4, 5.1, 1.45), fov: 36 });
    g.player.teleport(z.m('meetSelene'), z.myaw('meetSelene'));
    tarrik?.teleport(z.m('meetTarrik'), z.myaw('meetTarrik'));
    tarrik?.holdAt(z.m('meetTarrik'), z.myaw('meetTarrik'));
    lyessa?.play('aimRifle', { loop: true });
    for (const s of soldiers) s?.play('aimRifle', { loop: true });
    yield 1.0;
    sp?.barrierW?.setActive(false);
    yield 1.6;

    // (3) what she sees: the two of them standing close enough that neither appears ready to kill the other
    const mid = z.m('meetSelene').lerp(z.m('meetTarrik'), 0.5);
    c.twoShot(mid, feet(z, lyessa ?? 'lyessaGate'), { side: 1, distance: 1.8, fov: 30 });
    yield 2.6;
    // (4) she lowers the rifle by degrees, and says nothing
    c.shot(feet(z, lyessa ?? 'lyessaGate'), { yawDeg: 75, distance: 2.3, height: 1.62, lookHeight: 1.6, fov: 30 });
    c.moveAsync({ pos: z.m('lyessaGate').add(new THREE.Vector3(2.0, 1.6, -0.45)), look: z.m('lyessaGate').setY(1.55), fov: 29 }, 3.4, 'inOut');
    lyessa?.play('lowerWeapon');
    yield 1.1;
    for (const s of soldiers) s?.play('lowerWeapon');
    yield 1.4;
    // the two soldiers take up the junction while the scene goes on
    for (const [s, at] of [[soldiers[0], 'soldier1Post'], [soldiers[1], 'soldier2Post']] as const) {
      s?.stopAction();
      walkTo(z, s, at);
    }
    yield 0.8;

    // (5) the east barrier: Tharne, supporting Lyric
    c.cut({ pos: P(12.6, 7.0, 1.6), look: P(19.8, 4.9, 1.35), fov: 38 });
    sp?.barrierE?.setActive(false);
    yield 0.8;
    lyric?.play('limp', { loop: true });
    walkTo(z, tharne, 'tharneStop');
    walkTo(z, lyric, 'lyricStop');
    hold(tharne, 'L', armOf(lyric, () => feet(z, tharne ?? 'tharneStop')));
    c.moveAsync({ pos: P(12.9, 6.6, 1.6), look: P(16.2, 5.0, 1.4), fov: 36 }, 4.5, 'inOut');
    yield waitOr(z, () => z.skipping || (atPost(z, tharne, 'tharneStop') && atPost(z, lyric, 'lyricStop')), 6);
    // Selene moves at once to meet them and takes Lyric's other arm
    lyric?.stopAction();
    lyric?.teleport(z.m('lyricStop'), z.myaw('lyricStop'));
    tharne?.teleport(z.m('tharneStop'), z.myaw('tharneStop'));
    g.player.teleport(z.m('seleneLyric'), z.myaw('seleneLyric'));
    hold(z.player, 'R', armOf(lyric, () => z.player.pos));
    lyric?.actor.visual?.setCorruption(0.24);

    c.twoShot(feet(z, lyric ?? 'lyricStop'), z.player.pos, { side: 1, distance: 1.55, fov: 32 });
    yield 0.6;
    yield* say('Selene', 'Lyric?', 'player');
    yield* say('Lyric', 'Still annoyingly alive.', lyric);
    c.twoShot(z.player.pos, feet(z, lyric ?? 'lyricStop'), { side: -1, distance: 1.55, fov: 32 });
    yield* say('Selene', 'How bad?', 'player');
    front(z, c, lyric?.actor ?? null, 'lyricStop', 45, 1.7, 28);
    yield* say('Lyric', 'It’s quieter.', lyric);
    c.twoShot(z.player.pos, feet(z, tharne ?? 'tharneStop'), { side: 1, distance: 1.6, fov: 32 });
    yield* say('Selene', 'And the corruption?', 'player');
    front(z, c, tharne?.actor ?? null, 'tharneStop', -35, 1.9, 30);
    yield* say('Tharne', 'It isn’t reversing.', tharne);
    z.story('lyricAliveNotCured');
    c.twoShot(z.player.pos, feet(z, lyric ?? 'lyricStop'), { side: -1, distance: 1.5, fov: 31 });
    yield* say('Selene', 'Do you still feel the Wound?', 'player');
    front(z, c, lyric?.actor ?? null, 'lyricStop', 50, 1.55, 26);
    c.moveAsync(frontPose(z, lyric?.actor ?? null, 'lyricStop', 50, 1.2, 24), 6, 'inOut');
    yield* say('Lyric', 'No.', lyric);
    yield 0.6;
    yield* say('Lyric', 'I feel remembered.', lyric);
    // for once she does not deflect; the room goes quiet
    yield 2.2;

    // (6) comms return: the summonses, on both sides
    hold(z.player, 'R', null);
    hold(tharne, 'L', null);
    walkTo(z, tarrik, 'tarrikNear');
    front(z, c, tarrik?.actor ?? null, 'meetTarrik', 35, 2.4, 32, 1.5);
    if (!z.skipping) g.audio.play('ambCommBlip', { pos: feet(z, tarrik ?? 'meetTarrik') });
    comm(S.commT, tarrik?.actor ?? null, ['SOVEREIGN PRIORITY', 'RETURN TO CROWNWATCH']);
    yield* z.say('Caelus', 'SOVEREIGN PRIORITY · RETURN TO CROWNWATCH', { channel: 'system', offscreen: true }); // speaker label NEW
    comm(S.commT, null, null);
    yield waitOr(z, () => z.skipping || atPost(z, tarrik, 'tarrikNear'), 2.5);
    tarrik?.teleport(z.m('tarrikNear'), z.myaw('tarrikNear'));
    tarrik?.holdAt(z.m('tarrikNear'), z.myaw('tarrikNear'));
    // she turns from Lyric to him
    const tn = z.m('tarrikNear');
    g.player.teleport(z.player.pos, yawTo(z.player.pos.x, z.player.pos.z, tn.x, tn.z));
    front(z, c, z.player, 'seleneLyric', -30, 2.0, 30, 1.48);
    if (!z.skipping) g.audio.play('ambCommBlip', { pos: z.player.pos });
    comm(S.commS, z.player, ['KEEPER VEYNE', 'REPORT TO MESTRIA']);
    yield* z.say('Reformation Command', 'KEEPER VEYNE · REPORT TO MESTRIA', { channel: 'system', offscreen: true });
    comm(S.commS, z.player, ['DO NOT AUTHORIZE', 'TERMINAL RELEASE']);
    yield* z.say('Voss', 'DO NOT AUTHORIZE TERMINAL RELEASE', { channel: 'system', offscreen: true }); // speaker label NEW (a private message)
    comm(S.commS, null, null);
    walkTo(z, tharne, 'tharneRest');
    walkTo(z, lyric, 'lyricRest');

    // (7) the two of them, choosing to remain — a short strong scene
    const t = () => feet(z, tarrik ?? 'tarrikNear');
    c.twoShot(z.player.pos, t(), { side: 1, distance: 1.7, fov: 32 });
    yield* say('Selene', 'They want us back.', 'player');
    c.twoShot(t(), z.player.pos, { side: -1, distance: 1.7, fov: 32 });
    yield* say('Tarrik', 'Of course they do.', tarrik);
    c.twoShot(z.player.pos, t(), { side: 1, distance: 1.6, fov: 31 });
    yield* say('Selene', 'Immediately.', 'player');
    // a slow push on him for the decision
    front(z, c, tarrik?.actor ?? null, 'tarrikNear', 38, 2.1, 30);
    c.moveAsync(frontPose(z, tarrik?.actor ?? null, 'tarrikNear', 30, 1.55, 26), 5, 'inOut');
    yield 0.5;
    yield* say('Tarrik', 'We should talk first.', tarrik);
    // she says it quietly and voluntarily
    front(z, c, z.player, 'seleneLyric', -38, 1.9, 28, 1.52);
    c.moveAsync(frontPose(z, z.player, 'seleneLyric', -30, 1.45, 25, 1.52), 5, 'inOut');
    yield 1.0;
    yield* say('Selene', 'Yes.', 'player');
    yield 1.6;

    // (8) Lyessa: Cross's teams — her choice, not an order obeyed
    walkTo(z, lyessa, 'lyessaTalk');
    yield waitOr(z, () => z.skipping || atPost(z, lyessa, 'lyessaTalk'), 3);
    lyessa?.teleport(z.m('lyessaTalk'), z.myaw('lyessaTalk'));
    lyessa?.holdAt(z.m('lyessaTalk'), z.myaw('lyessaTalk'));
    const lt = z.m('lyessaTalk');
    const tn2 = z.m('tarrikNear');
    tarrik?.holdAt(tn2, yawTo(tn2.x, tn2.z, lt.x, lt.z));
    if (tarrik) tarrik.actor.yaw = yawTo(tn2.x, tn2.z, lt.x, lt.z);
    const l = () => feet(z, lyessa ?? 'lyessaTalk');
    c.twoShot(l(), t(), { side: 1, distance: 1.9, fov: 32 });
    yield* say('Lyessa', 'Cross wants the terminal.', lyessa);
    yield* say('Lyessa', 'He has three Continuity teams coming down.', lyessa);
    c.twoShot(t(), l(), { side: -1, distance: 1.9, fov: 32 });
    yield* say('Tarrik', 'Keep them out.', tarrik);
    yield* say('Tarrik', 'I need to understand what we just saw before Crownwatch tells me what it means.', tarrik);
    front(z, c, lyessa?.actor ?? null, 'lyessaTalk', 30, 1.9, 29);
    yield* say('Lyessa', 'Only the terminal?', lyessa);
    // he could make this easier, but he does not
    front(z, c, tarrik?.actor ?? null, 'tarrikNear', -30, 2.0, 29);
    yield* say('Tarrik', 'No.', tarrik);
    yield 0.5;
    front(z, c, lyessa?.actor ?? null, 'lyessaTalk', 25, 1.6, 26);
    yield 0.4;
    yield* say('Lyessa', 'Fine.', lyessa);
    c.twoShot(t(), l(), { side: -1, distance: 1.8, fov: 31 });
    yield* say('Tarrik', 'If Crownwatch gives you a direct order to let them through?', tarrik);
    c.twoShot(l(), t(), { side: 1, distance: 1.8, fov: 31 });
    yield* say('Lyessa', 'You told me to decide what I do.', lyessa);
    front(z, c, tarrik?.actor ?? null, 'tarrikNear', -30, 1.9, 28);
    yield* say('Tarrik', 'Yes.', tarrik);
    front(z, c, lyessa?.actor ?? null, 'lyessaTalk', 25, 1.7, 26);
    yield* say('Lyessa', 'I’m deciding.', lyessa);
    // she turns back to hold the junction
    walkTo(z, lyessa, 'lyessaPost');
    yield 1.6;

    // end state — identical watched or skipped: Lyessa holds the junction with the two soldiers; Tharne and Lyric
    // rest by the bench; Tarrik goes with Selene
    for (const [s, at] of [[soldiers[0], 'soldier1Post'], [soldiers[1], 'soldier2Post']] as const) {
      if (z.skipping || atPost(z, s, at)) s?.teleport(z.m(at), z.myaw(at));
    }
    if (z.skipping) lyessa?.teleport(z.m('lyessaPost'), z.myaw('lyessaPost'));
    lyessa?.holdAt(z.m('lyessaPost'), z.myaw('lyessaPost'));
    restAtBench(z, tharne, lyric);
    comm(S.commT, null, null);
    comm(S.commS, null, null);
    hold(z.player, 'R', null);
    hold(tharne, 'L', null);
    if (tarrik) {
      tarrik.mode = 'follow';
      tarrik.follow(z.player, { right: 1.1, back: 1.4 });
    }
  });
}

/** Tharne and Lyric at the bench by the passage: Lyric seated, Tharne beside her */
export function restAtBench(z: ZoneRuntime, tharne: Companion | null, lyric: Companion | null): void {
  if (tharne) {
    tharne.stopAction();
    tharne.teleport(z.m('tharneRest'), z.myaw('tharneRest'));
    tharne.holdAt(z.m('tharneRest'), z.myaw('tharneRest'));
  }
  if (lyric) {
    lyric.stopAction();
    lyric.teleport(z.m('lyricRest'), z.myaw('lyricRest'));
    lyric.play('sitInjured');
    lyric.actor.visual?.setCorruption(0.24);
  }
}

/** the bystander's local-priority callback as the group passes (NEW lines; SCRIPT_SOURCE Z11 INVENT) */
export function callbackLine(z: ZoneRuntime): [string, string] {
  return z.state.rescuePriority === 'EastWalkers'
    ? ['Survivor', 'I went back for the last stretcher. It made it through.'] // NEW
    : ['Medic', 'The stretchers came through under cover. Every one of them.']; // NEW
}
