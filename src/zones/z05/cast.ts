/**
 * Z05 cast: ONE spawnCast(z, stage) that every beat's `enter` calls with the stage that beat starts in, so a
 * checkpoint reload or a `?beat=` jump lands in the world the earlier beats leave behind (lead, bodies, poses,
 * the carrier, the control ring, flags).
 */
import type { Companion, ZoneRuntime } from '@/core/api';
import { CINDER } from '../shared';
import { S } from './state';

export type Stage = 'meeting' | 'carrier' | 'aftermath';

/** the three Dominion soldiers who come in behind Lyessa */
export const SOLDIERS = ['sol1', 'sol2', 'sol3'] as const;

/** where the north side waits, out of sight on the north bridge, until the meeting scene brings it in */
const HIDDEN: Record<string, readonly [number, number]> = {
  lyessa: [-1.2, 52], tarrik: [0.8, 53.5], sol1: [-1.8, 55.5], sol2: [1.8, 55.5], sol3: [0, 57.5],
};

export function spawnCast(z: ZoneRuntime, stage: Stage): void {
  const game = z.game;
  const met = stage !== 'meeting';
  const after = stage === 'aftermath';

  // --- Selene's side ---
  z.spawnPlayer('selene', after ? 'ring' : met ? 'dSelLock' : 'start');
  const tharne = z.companion('tharne', met ? 'tharneFar' : 'tharneStart', met ? 'hold' : 'follow');
  const lyric = z.companion('lyric', met ? 'lyricFar' : 'lyricStart', met ? 'hold' : 'follow');
  if (met) {
    tharne.holdAt(z.m('tharneFar'), z.myaw('tharneFar'));
    lyric.holdAt(z.m('lyricFar'), z.myaw('lyricFar'));
    tharne.play('holdConsole', { loop: true });
  }
  lyric.actor.visual?.setCorruption(met ? 0.28 : 0.2);

  // --- the Dominion side ---
  const tarrik = z.companion('tarrik', after ? 'tarrikBehind' : met ? 'dTarLock' : 'centre', 'scripted');
  const lyessa = z.companion('lyessa', met ? 'lyessaStop' : 'centre', 'hold');
  const soldiers = SOLDIERS.map((s) => z.npc('dominionSoldier', met ? `${s}Stop` : 'centre', met ? undefined : 'aimRifle', s));
  if (met) {
    lyessa.holdAt(z.m('lyessaStop'), z.myaw('lyessaStop'));
    lyessa.play('aimRifle', { loop: true });
    tarrik.face(after ? z.m('ring') : z.player.pos.clone());
    if (!after) tarrik.play('guard', { loop: true });
  } else {
    // out of sight on the north bridge until the meeting scene brings them in
    for (const [c, key] of [[tarrik, 'tarrik'], [lyessa, 'lyessa'], ...soldiers.map((s, i) => [s, SOLDIERS[i]] as const)] as const) {
      hide(z, c, HIDDEN[key]);
    }
  }
  if (met && !after) burnBlade(z, tarrik);

  // --- the carrier, the ring, flags ---
  const carrier = game.sky.carrier;
  S.carrierTarget = 0;
  S.jetsTarget = 0;
  carrier.setAnchor(S.centre, 0);
  carrier.visible = false;
  carrier.setProgress(after ? 1 : 0);
  carrier.setStabilized(0);
  if (S.stab) {
    S.stab.params.active = after ? 0.25 : 0;
    S.stab.params.plane = 0;
    S.stab.snap();
  }
  if (S.holo) {
    S.holo.params.visible = 0;
    S.holo.params.progress = 0;
    S.holo.snap();
  }
  if (met) z.setFlag('z05Met', true);
  if (after) {
    z.story('carrierLost');
    z.setFlag('z05Held', true);
  }
}

/** a body standing out of sight (hidden and parked on the north bridge) */
function hide(z: ZoneRuntime, c: Companion, off: readonly [number, number]): void {
  const m = z.m('centre');
  c.teleport(z.P(0, 0).set(m.x + off[0], m.y, m.z - off[1]), Math.PI);
  c.actor.visual?.setVisible(false);
}

/** “with Velkorran burning in one hand”: embers ride the blade while the duel lasts */
export function burnBlade(z: ZoneRuntime, tarrik: Companion | null): void {
  const v = tarrik?.actor.visual;
  if (!v || S.embers) return;
  S.embers = z.game.vfx.spawn('cinderEmbers', v.socket('weaponMid').getWorldPosition(z.P(0, 0)), {
    attachTo: v.socket('weaponMid'), duration: 1e5, color: CINDER,
  });
}

/** the blade cools once the fight is over */
export function coolBlade(): void {
  S.embers?.stop();
  S.embers = null;
}
