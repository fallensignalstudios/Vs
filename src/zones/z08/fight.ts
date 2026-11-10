/**
 * Z08 — Encounter E4: the elite fed by a Weaver and two linkbound (phase A, Selene), a wall-runner from the north
 * rib after the first cut; isolated in phase B (Tarrik) with Selene on the frost anchor for the one joint
 * Resonance (Thermal Fracture). The organism never dies to the player: at its last health the zone hands over to
 * the authored finish (./finish.ts), where Lyessa's round ends it.
 *
 * Barks and hints are new text (`// NEW`) under SCRIPT_SOURCE Z08's INVENT rules; “Hold it.” is the author's.
 */
import * as THREE from 'three';
import type { Actor, CineCtx, Companion, Encounter, NoGoRect, Routine, ZoneRuntime } from '@/core/api';
import { FACE, barker, onZoneEvent, tutorialHint, waitOr } from '../shared';
import { CLEAN_ANCHOR, RECESS_E, RECESS_W } from './layout';
import { S } from './state';

/** the organism's health fraction at which the authored finish takes over */
export const FINISH_FRAC = 0.2;
/** while Selene leads it cannot be brought below this (the finish needs Tarrik and the officer's moment) */
const PHASE_A_FLOOR = 0.6;
/** E4: the elite plus four ordinary actors at most (plan) */
const E4_CAP = 5;
/** seconds of phase A after which stragglers are removed so the mission can never stall */
const PHASE_A_LIMIT = 330;
/** the Thermal Fracture confirm window (s, before the difficulty scale) */
const FRACTURE_WINDOW = 6;
/** label for the elite frame (SCRIPT_SOURCE system text: «BREACH ORGANISM») */
const FRAME_NAME = 'BREACH ORGANISM'; // NEW

const _v = new THREE.Vector3();

/** plan rectangle → world no-go rectangle */
function rect(x0: number, x1: number, n0: number, n1: number): NoGoRect {
  return { minX: x0, maxX: x1, minZ: -n1, maxZ: -n0 };
}

/** the survivor recesses and the companion staging: outside every spawn and charge path */
function noGo(): NoGoRect[] {
  return [
    rect(RECESS_W.x0, RECESS_W.x1, RECESS_W.n0, RECESS_W.n1),
    rect(RECESS_E.x0, RECESS_E.x1, RECESS_E.n0, RECESS_E.n1),
    rect(28.5, 41.5, 1, 7.2),
  ];
}

// =====================================================================================================================
// Setup
// =====================================================================================================================

/**
 * E4 as the given stage finds it (idempotent). 'A': the whole cast, dormant until `wakeE4`; the wall-runner wave
 * waits for the first cut. 'B' / 'finish': the isolated organism alone (checkpoint restores).
 */
export function setupE4(z: ZoneRuntime, stage: 'A' | 'B' | 'finish'): Encounter {
  if (S.enc) return S.enc;
  const game = z.game;
  S.frost = game.ai.devices.frostAnchor({ id: 'e4-frost', pos: z.m('frostAnchor') });
  const eliteAt = stage === 'A' ? 'eliteIn' : stage === 'B' ? 'eliteB' : 'eliteFinish';
  const elite = {
    role: 'elite' as const, at: eliteAt,
    opts: { yaw: z.myaw(eliteAt), noGo: noGo(), dormant: stage === 'A', via: stage === 'A' ? ('breach' as const) : ('none' as const), tags: ['e4'] },
  };
  const perches = [
    { pos: z.P(17.75, 46.6), height: 5.5, wallYaw: z.myaw('wrIn') },
    { pos: z.P(52.25, 46.6), height: 5.5, wallYaw: z.myaw('wrIn') },
    { pos: z.P(1.4, 26), height: 5, wallYaw: -FACE.east * (Math.PI / 180) },
    { pos: z.P(29.25, 1.4), height: 5, wallYaw: 0 },
  ];
  const enc = z.encounter({
    id: 'E4',
    maxActive: E4_CAP,
    waves: stage !== 'A'
      ? [{ spawns: [elite], onSpawn: (a) => bindElite(z, a[0] ?? null) }]
      : [
        {
          spawns: [
            elite,
            // the source: marked as an objective (tactical read, nav assistance)
            { role: 'weaver', at: 'weaverIn', opts: { yaw: z.myaw('weaverIn'), via: 'breach', dormant: true, tags: ['e4', 'objective'] } },
            { role: 'linkbound', at: 'lbIn0', opts: { yaw: z.myaw('lbIn0'), via: 'breach', dormant: true, tags: ['e4'] } },
            { role: 'linkbound', at: 'lbIn1', opts: { yaw: z.myaw('lbIn1'), via: 'breach', dormant: true, tags: ['e4'] } },
          ],
          onSpawn: (actors) => {
            bindElite(z, actors[0] ?? null);
            S.weaver = actors[1] ?? null;
            S.anchor = game.ai.devices.weaverAnchor({ id: 'e4-anchor', pos: z.m('anchor'), yaw: z.myaw('anchor') });
          },
        },
        {
          // a wall-runner joins from a visible rib after the first anchor / link falls
          when: (e) => e.flags.firstCut === true,
          telegraph: 1.8,
          onTelegraph: () => {
            game.events.emit('caption', { text: 'Movement on the north rib', kind: 'alert', pos: z.m('wrIn') }); // NEW
            z.bark('Tarrik', 'Above.'); // NEW
          },
          spawns: [{ role: 'wallrunner', at: 'wrIn', opts: { via: 'ceiling', perches, tags: ['e4'] } }],
        },
      ],
  });
  S.enc = enc;
  const cut = (): void => {
    enc.flags.firstCut = true;
  };
  onZoneEvent(z, 'link:severed', cut);
  onZoneEvent(z, 'device:disabled', (e) => {
    if (e.id === 'e4-anchor') cut();
  });
  onZoneEvent(z, 'actor:died', (e) => {
    if (e.actor === S.weaver) cut();
  });
  enc.start();
  return enc;
}

function bindElite(z: ZoneRuntime, a: Actor | null): void {
  S.elite = a;
  S.ctl = z.game.ai.elite(a);
}

/** wake the dormant cast: from here the court is live */
export function wakeE4(z: ZoneRuntime): void {
  z.game.ai.alert('e4');
  z.setFlag('z08Awake', true);
}

/** the enemies other than the organism that are still in play (alive, queued or not yet released) */
function ordinaryLeft(enc: Encounter): number {
  const alive = enc.alive.filter((a) => a !== S.elite).length;
  return alive + (enc.queued ?? 0) + (enc.total - enc.spawned);
}

/**
 * Once no link can feed it again, the bodies still standing round it are what keeps it from standing alone:
 * they become the objective (HUD line and markers) until they are down.
 */
export function* isolateA(z: ZoneRuntime): Routine {
  yield () => S.stage !== 'A' || !S.weaver || !S.weaver.alive || (S.anchor?.disabled ?? false);
  yield 2;
  if (S.stage !== 'A' || !S.enc || ordinaryLeft(S.enc) === 0) return;
  z.objective('Clear the bodies around it'); // NEW
  while (S.stage === 'A' && S.enc) {
    for (const a of S.enc.alive) if (a !== S.elite) a.tags.add('objective');
    yield 0.5;
  }
}

/** phase A is over: no link can feed it again and the organism stands alone */
export function phaseADone(): boolean {
  const enc = S.enc;
  const e = S.elite;
  if (!enc || !e || !e.alive) return false;
  const sourceGone = !S.weaver || !S.weaver.alive || (S.anchor?.disabled ?? false);
  return sourceGone && S.ctl?.phase === 'B' && ordinaryLeft(enc) === 0 && S.announced;
}

/** never soft-lock: after PHASE_A_LIMIT seconds of phase A the stragglers are removed (a real fight never gets here) */
export function* phaseAFailsafe(z: ZoneRuntime): Routine {
  yield waitOr(z, () => S.stage !== 'A', PHASE_A_LIMIT);
  if (S.stage !== 'A' || !S.enc) return;
  z.log('E4 phase A fail-safe: removing the remaining ordinary actors');
  S.enc.flags.firstCut = true;
  while (S.stage === 'A' && S.enc) {
    for (const a of S.enc.alive) if (a !== S.elite && a.alive) z.game.actors.kill(a, null);
    if (S.anchor && !S.anchor.disabled) S.anchor.disable(null);
    yield 0.5;
  }
}

// =====================================================================================================================
// Phase A: support, teaching, barks
// =====================================================================================================================

/** Lyessa covers from the chosen position; she suppresses the bodies, never the organism, and never solves it */
export function* lyessaSupport(z: ZoneRuntime, lyessa: Companion | null): Routine {
  if (!lyessa) return;
  const say = barker(z, 6);
  let next = z.time + 4;
  while (S.stage === 'A' || S.stage === 'B') {
    if (z.time >= next && !lyessa.assisting && !lyessa.disrupted && S.enc) {
      next = z.time + 7;
      const target = nearestOrdinary(S.enc, lyessa.actor);
      if (target) {
        lyessa.assist(target, 'suppress');
        if (!say('fire1', 'Lyessa', 'Covering.')) say('fire2', 'Lyessa', 'Firing.'); // NEW
      }
    }
    yield 0.4;
  }
}

function nearestOrdinary(enc: Encounter, from: Actor): Actor | null {
  let best: Actor | null = null;
  let bestD = 30;
  for (const a of enc.alive) {
    if (a === S.elite || !a.alive) continue;
    const d = a.distanceTo(from);
    if (d < bestD) {
      best = a;
      bestD = d;
    }
  }
  return best;
}

/** the plan's teaching order: the pulses mark the links → the pressure contest (HUD text only) */
export function* teachA(z: ZoneRuntime): Routine {
  yield 2.5;
  tutorialHint(z, 'z08Links', 'Repeated pulses mark the links that feed it. Get an angle and break them.', 'scan', 9); // NEW
  yield waitOr(z, () => (S.ctl?.pressureActive ?? false) || S.stage !== 'A', 120);
  if (S.stage !== 'A') return;
  tutorialHint(z, 'z08Pressure', 'Pressure rising. Break a link, leave its field, or reach the clean anchor.', undefined, 8); // NEW
}

/** information barks: a link falls, the player is hurt */
export function* barksA(z: ZoneRuntime): Routine {
  const say = barker(z, 4);
  let cuts = 0;
  onZoneEvent(z, 'link:severed', () => {
    if (S.stage !== 'A') return;
    cuts++;
    z.game.events.emit('caption', { text: 'Link cut', kind: 'link', pos: S.elite?.pos }); // NEW
    if (cuts === 1) say('cut1', 'Selene', 'Source cut.'); // NEW
    else say(`cut${Math.min(cuts, 3)}`, 'Selene', 'Link down.'); // NEW
  });
  while (S.stage === 'A') {
    if (z.player.hp < z.player.maxHp * 0.4) say('hurt', 'Tarrik', 'Back.'); // NEW
    yield 0.3;
  }
}

// =====================================================================================================================
// Phase B: the joint Resonance (Thermal Fracture)
// =====================================================================================================================

function onAnchor(z: ZoneRuntime, c: Companion): boolean {
  const p = S.frost ? S.frost.actor.pos : z.m('frostAnchor');
  return Math.hypot(c.actor.pos.x - p.x, c.actor.pos.z - p.z) < 1.2;
}

/**
 * Selene holds the frost anchor; when the organism can be held she asks for a window, arrests the joint and the
 * player confirms the strike. A stagger cancels it, a missed window costs nothing — the setup comes back.
 */
export function* resonanceLoop(z: ZoneRuntime): Routine {
  const game = z.game;
  const say = barker(z, 3);
  let cooldown = z.time + 2.5;
  let tries = 0;
  while (!S.fractured && !S.finishDue && S.stage === 'B') {
    const selene = z.cast('selene');
    const ctl = S.ctl;
    const elite = S.elite;
    if (!selene || !ctl || !elite || !elite.alive) {
      yield 0.5;
      continue;
    }
    // back to a valid position
    if (!onAnchor(z, selene)) {
      selene.mode = 'scripted';
      selene.moveTo(S.frost ? S.frost.actor.pos : z.m('frostAnchor'), { run: true, stopDistance: 0.6 });
      yield waitOr(z, () => onAnchor(z, selene) || selene.arrived || S.finishDue, 14);
    }
    yield () => S.finishDue || (z.time >= cooldown && !selene.disrupted);
    if (S.finishDue) break;
    if (!ctl.requestResonanceWindow(10)) {
      yield 1;
      continue;
    }
    yield waitOr(z, () => ctl.jointExposed || !!selene.disrupted || S.finishDue, 12);
    if (S.finishDue) break;
    if (!ctl.jointExposed || selene.disrupted) {
      ctl.cancelResonanceWindow();
      if (selene.disrupted) say(`lost${tries}`, 'Selene', 'Lost the hold.'); // NEW
      cooldown = z.time + 5;
      continue;
    }
    tries++;
    // step 1 — the joint. “Tarrik glances toward her but does not argue.”
    z.fork(z.say('Selene', 'Hold it.', { actor: selene }), 'holdIt');
    const pv = game.player.actor.visual;
    pv?.lookAt(selene.actor.aimPoint(_v));
    selene.face(elite.pos);
    selene.assist(elite, 'frostArrest');
    ctl.arrest(FRACTURE_WINDOW + 3);
    game.audio.play('resonanceWindow');
    const joint = jointPos(elite);
    const ring = game.vfx.spawn('resonanceRing', joint, { duration: FRACTURE_WINDOW });
    let confirmed = false;
    let expired = false;
    game.player.setContextAction({
      id: 'thermalFracture', prompt: 'Thermal Fracture', button: 'heavy', window: FRACTURE_WINDOW, autoConfirmable: true, // NEW (prompt)
      onConfirm: () => {
        confirmed = true;
        S.vignette = true;
      },
      onExpire: () => {
        expired = true;
      },
    });
    tutorialHint(z, 'z08Fracture', 'Selene holds the joint. Confirm the strike: Thermal Fracture.', 'heavy', 6); // NEW
    yield 1.2;
    pv?.lookAt(null);
    yield () => confirmed || expired || !!selene.disrupted || S.finishDue;
    ring.stop();
    if (confirmed) {
      yield* fractureVignette(z, selene);
      break;
    }
    game.player.setContextAction(null);
    ctl.cancelResonanceWindow();
    if (S.finishDue) break;
    if (selene.disrupted) say(`lost${tries}`, 'Selene', 'Lost the hold.'); // NEW
    else say(`again${tries}`, 'Tarrik', 'Again.'); // NEW
    cooldown = z.time + 6;
  }
  // after the fracture (or the finish) she is already moving: she joins the fight
  const selene = z.cast('selene');
  if (selene && S.stage === 'B') selene.mode = 'combat';
}

/** world position of the regenerating joint (falls back to the chest) */
export function jointPos(elite: Actor): THREE.Vector3 {
  const s = elite.visual?.socket('joint');
  return s ? s.getWorldPosition(new THREE.Vector3()) : elite.aimPoint(new THREE.Vector3());
}

/**
 * The confirmed strike, staged: Velkorran strikes the frozen joint and it explodes into black fragments; the
 * creature shrieks; Tarrik looks once toward Selene — she is already moving.
 */
function* fractureVignette(z: ZoneRuntime, selene: Companion): Routine {
  const game = z.game;
  S.vignette = true;
  yield* z.cinematic('z08-fracture', function* (c: CineCtx): Routine {
    const elite = S.elite;
    const ctl = S.ctl;
    if (!elite || !ctl) return;
    const joint = jointPos(elite);
    const p = game.player.actor.pos;
    let dx = p.x - elite.pos.x;
    let dz = p.z - elite.pos.z;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    const at = { x: elite.pos.x + dx * 2.7, y: elite.pos.y, z: elite.pos.z + dz * 2.7 };
    game.player.teleport(at, Math.atan2(dx, dz));
    game.player.actor.face(elite.pos);
    // three-quarter on the strike, low, the joint high in frame
    c.cut({ pos: { x: at.x + dz * 3.4 + dx * 1.2, y: 1.25, z: at.z - dx * 3.4 + dz * 1.2 }, look: { x: joint.x, y: joint.y - 0.6, z: joint.z }, fov: 46 });
    if (!z.skipping) {
      game.vfx.spawn('thermalFracture', joint);
      game.audio.play('thermalFracture', { pos: joint });
      game.time.slowMo(0.35, 0.9);
    }
    game.audio.setMusic('resonance', 0.3);
    game.audio.stinger('resonance');
    game.player.playScripted('attackHeavy', { faceTo: joint });
    yield 0.98;
    ctl.fracture(game.player.actor);
    S.fractured = true;
    z.log(`Thermal Fracture: organism at ${Math.round(elite.hp)} hp`);
    z.setFlag('z08Fractured', true);
    if (!z.skipping) {
      game.vfx.spawn('frostShatter', joint);
      game.vfx.spawn('violetBurst', joint, { scale: 0.8 });
      game.audio.play('eliteRoar', { pos: elite.pos });
    }
    yield 1.1;
    // the look — not friendship; recognition. She is already moving.
    selene.mode = 'combat';
    selene.focus(elite);
    const sp = selene.actor.pos;
    c.shot(game.player.actor.pos, { yawDeg: bearing(game.player.actor.pos, sp), distance: 1.9, height: 1.6, lookHeight: 1.62, fov: 34 });
    game.player.actor.visual?.lookAt(selene.actor.aimPoint(_v));
    yield 1.5;
    game.player.actor.visual?.lookAt(null);
  }, { letterbox: false, blendOut: 0.6 });
  S.fractured = true;
  S.vignette = false;
  tutorialHint(z, 'z08Core', 'The core is exposed. Ordinary attacks count now.', 'attack', 6); // NEW
}

/** plan bearing (degrees, 0 = north) from a to b */
function bearing(a: THREE.Vector3, b: THREE.Vector3): number {
  return (Math.atan2(b.x - a.x, -(b.z - a.z)) * 180) / Math.PI;
}

// =====================================================================================================================
// Per tick (ZoneDef.update)
// =====================================================================================================================

/** health floor and finish trigger, the elite frame, pressure captions, the clean anchor */
export function updateFight(z: ZoneRuntime, dt: number): void {
  const game = z.game;
  const e = S.elite;
  const ctl = S.ctl;
  const live = !!e && e.alive && (S.stage === 'A' || S.stage === 'B');
  if (live && e) {
    if (S.stage === 'A' && e.hp < e.maxHp * PHASE_A_FLOOR) e.hp = e.maxHp * PHASE_A_FLOOR;
    if (S.stage === 'B' && !S.finishDue && e.hp <= e.maxHp * FINISH_FRAC) {
      e.invulnerable = true;
      S.finishDue = true;
      z.log(`the organism's last health (${Math.round(e.hp)} hp, fractured ${S.fractured}): the finish is due`);
    }
    game.ui.eliteBar({
      name: FRAME_NAME, hp: Math.max(e.hp, e.maxHp * 0.01), maxHp: e.maxHp,
      regenerating: !S.fractured && (ctl ? ctl.phase === 'A' : true), exposed: S.fractured || (ctl?.jointExposed ?? false),
    });
  } else if (S.stage !== 'A' && S.stage !== 'B') {
    game.ui.eliteBar(null);
  }
  // the pressure contest: a relationship with a visible source, never a clock
  const pressure = live && (ctl?.pressureActive ?? false);
  if (pressure !== S.pressureWas) {
    S.pressureWas = pressure;
    const pos = e ? e.pos : undefined;
    game.events.emit('caption', { text: pressure ? 'Pressure rising' : 'Pressure falling', kind: 'pressure', pos }); // NEW
    game.ui.marker('z08-clean', pressure ? z.m('cleanAnchor') : null, { label: 'Clean anchor', kind: 'return', hideWithin: 2 }); // NEW
  }
  if (pressure) {
    const p = z.player.pos;
    if (Math.hypot(p.x - CLEAN_ANCHOR.x, -p.z - CLEAN_ANCHOR.n) < CLEAN_ANCHOR.r) {
      game.player.threat = Math.max(0, game.player.threat - 1.05 * dt);
    }
  }
}
