/**
 * Z06 — Encounter E3 (plan §09): three bodies and a ceiling attacker, then — once the rescue approach is open AND
 * at most three of the first four are left — a second breach with two more bodies and the link source. Cap six,
 * seven committed. Melee tokens: two, three once the player has cut a link (`linkLearned`, the director's rule).
 *
 * Teaching, in the plan's order: Selene arrests the first ceiling attacker as it announces itself and the player
 * takes the opening (hint + a slow-motion beat); the link rule (silhouette and sound first: the cadence is the AI's;
 * captions and one procedural sentence from Selene; the hint names the remedy); the plate (hold from the protected
 * side; a hit only cancels it). Lyessa holds a defensive lane by the plate and calls the player back if he leaves
 * it. Combat information lives in barks, mechanics in hints. Every line written for the game is tagged `// NEW`.
 */
import * as THREE from 'three';
import type { Actor, Encounter, Interactable, Routine, WallPerch, ZoneRuntime } from '@/core/api';
import { isHumanoidVisual } from '@/core/api';
import { GOLD, VIOLET, barker, encounterMusic, onZoneEvent, sustainDrops, tutorialHint, waitOr } from '../shared';
import { SEAM } from './layout';
import { S } from './state';

/** E3: peak six active, seven committed (plan) */
const E3_CAP = 6;
/** the rescue approach opens when the lead comes this close to the plate's protected side */
const APPROACH_R = 7;
/** Lyessa's suppressing bursts and Selene's covering arrests while the plate is held: seconds between them */
const SUPPRESS_EVERY = 6.5;
const COVER_EVERY = 9;
/** the lead has left the plate when he is this far from it for this long (Lyessa calls him back) */
const ABANDON_R = 15;
const ABANDON_S = 8;

const DEG = Math.PI / 180;
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

/** the first four (three bodies and the ceiling attacker) still alive */
function initialAlive(enc: Encounter): number {
  return enc.alive.filter((a) => a.tags.has('init')).length;
}

/**
 * Wall perches for the ceiling attacker (floor point under it, cling height, the wall's inward yaw). The seam on
 * the north pier is the first it takes: it is the one nearest the band it hunts in while the party is at the entry.
 */
function perches(z: ZoneRuntime): WallPerch[] {
  const wy = (deg: number): number => -deg * DEG;
  return [
    { pos: z.m('seamPerch'), height: 5.6, wallYaw: wy(270) },
    { pos: z.P(35, 9.75), height: 5, wallYaw: wy(0) },
    { pos: z.P(31, 32.4), height: 6, wallYaw: wy(180) },
    { pos: z.P(54.4, 13), height: 6, wallYaw: wy(270) },
    { pos: z.P(22, 1.6), height: 6, wallYaw: wy(0) },
  ];
}

/**
 * E3 (idempotent). Wave 1: the three bodies at the plate, dormant until `wakeE3`. Wave 2: the ceiling attacker,
 * announced from the seam once Selene is through the entry (`flags.seleneIn`). Wave 3: the second breach.
 */
export function setupE3(z: ZoneRuntime): Encounter {
  if (S.enc) return S.enc;
  const game = z.game;
  const enc = z.encounter({
    id: 'E3',
    maxActive: E3_CAP,
    meleeSlots: 2,
    waves: [
      {
        spawns: (['lb0', 'lb1', 'lb2'] as const).map((m) => ({
          role: 'linkbound' as const, at: m, opts: { yaw: z.myaw(m), dormant: true, tags: ['e3', 'init'] },
        })),
      },
      {
        // «Selene enters behind them as a creature races across the ceiling.»
        when: (e) => e.flags.seleneIn === true,
        telegraph: 1.6,
        onTelegraph: () => {
          S.seamFlicker = 1.9;
          if (z.skipping) return;
          game.audio.play('wallrunnerSkitter', { pos: z.m('seamMid') });
          game.events.emit('caption', { text: 'Movement in the wall seam', kind: 'alert', pos: z.m('seamMid') }); // NEW
          z.bark('Lyessa', 'On the wall.'); // NEW
        },
        spawns: [{ role: 'wallrunner', at: 'wrDrop', opts: { via: 'ceiling', perches: perches(z), tags: ['e3', 'init'] } }],
        onSpawn: (a) => {
          S.wallrunner = a[0] ?? null;
        },
      },
      {
        when: (e) => e.flags.rescueOpen === true && initialAlive(e) <= 3,
        telegraph: 2,
        onTelegraph: () => burstBreachB(z, true),
        spawns: [
          { role: 'linkbound', at: 'lb3', opts: { yaw: z.myaw('lb3'), via: 'breach', tags: ['e3'] } },
          { role: 'linkbound', at: 'lb4', opts: { yaw: z.myaw('lb4'), via: 'breach', tags: ['e3'] } },
          // the source: marked as an objective for the tactical read and nav assistance
          { role: 'weaver', at: 'weaverIn', opts: { yaw: z.myaw('weaverIn'), via: 'breach', tags: ['e3', 'objective'] } },
        ],
        onSpawn: (a) => {
          S.weaver = a[2] ?? null;
          if (!S.anchor) S.anchor = game.ai.devices.weaverAnchor({ id: 'e3-anchor', pos: z.m('anchor'), yaw: z.myaw('anchor') });
          z.bark('Soldier', 'Second breach, south wall!'); // NEW
        },
      },
    ],
  });
  S.enc = enc;
  // the player has learned the link response once he cuts a link or breaks its anchor
  onZoneEvent(z, 'link:severed', (e) => {
    if (e.by && e.by === game.player.actor) enc.flags.linkLearned = true;
  });
  onZoneEvent(z, 'device:disabled', (e) => {
    if (e.id === 'e3-anchor') enc.flags.linkLearned = true;
  });
  enc.start();
  return enc;
}

/**
 * The second breach bursts: the growth that plugged it is gone, violet light from the throat. `fx` = the burst
 * itself (the wave telegraph); false restores the open state silently (checkpoint / debug entries).
 */
export function burstBreachB(z: ZoneRuntime, fx: boolean): void {
  if (S.plug) S.plug.visible = false;
  if (S.plugLight) S.plugLight.intensity = 9;
  if (!fx || z.skipping) return;
  const game = z.game;
  const at = z.m('breachB');
  game.vfx.spawn('violetBurst', at, { scale: 1.6 });
  game.vfx.spawn('debrisFall', at.clone().setY(4.5));
  game.audio.play('breachCrack', { pos: at });
  game.audio.play('debrisFall', { pos: at });
  game.camera.shake(0.25, 0.5);
  game.events.emit('caption', { text: 'Breach opening, south wall', kind: 'breach', pos: at }); // NEW
  z.bark('Lyessa', 'More.'); // RELOCATED (ch24, Tarrik's approach corridor) — the second breach opens
}

/** wake the bodies at the plate: from here the junction is live */
export function wakeE3(z: ZoneRuntime): void {
  z.game.ai.alert('e3');
  z.setFlag('z06Awake', true);
}

/** the plate: one hold from its protected side. A hit cancels it (progress lost, prompt stays); it never hurts him. */
export function liftInteraction(z: ZoneRuntime): Interactable {
  if (S.lift) return S.lift;
  const player = z.game.player;
  const release = (): void => {
    S.lifting = false;
    const v = player.actor.visual;
    v?.stop('liftPlate');
    if (isHumanoidVisual(v)) {
      v.setHandTarget('L', null);
      v.setHandTarget('R', null);
    }
    player.setMovementLocked(false);
  };
  S.lift = z.interact({
    id: 'z06-lift', at: 'plateStand', prompt: 'Lift the plate', hold: 2.6, radius: 1.9, required: true, // NEW
    interruptible: true, markerRange: 18,
    onStart: () => {
      S.lifting = true;
      player.setMovementLocked(true);
      player.teleport(z.m('plateStand'), z.myaw('plateStand'));
      player.playScripted('liftPlate', { faceTo: z.m('plateCentre') });
    },
    onCancel: release,
    onDone: release,
  });
  return S.lift;
}

/**
 * Start the fight's forked routines once per load (music, recovery, teaching, Selene's assists, Lyessa's lane,
 * barks, the approach watcher). Called by the fight beats; a debug entry at `rescue` gets them too.
 */
export function startFight(z: ZoneRuntime, enc: Encounter): void {
  if (S.fightLive) return;
  S.fightLive = true;
  z.fork(encounterMusic(z, enc, 'combatEclipse', 'breach', { begin: () => z.flag('z06Awake') === true }), 'music');
  sustainDrops(z, ['sustainLane', 'sustainLoop', 'sustainEast']);
  z.fork(approach(z, enc), 'approach');
  z.fork(firstCeiling(z, enc), 'opening');
  z.fork(teachLinks(z, enc), 'links');
  z.fork(lyessaLane(z, enc), 'lyessa');
  z.fork(seleneCover(z, enc), 'cover');
}

/** «Opening the approach sets rescueOpen»: the lead reaches the plate's protected side (or starts the lift) */
function* approach(z: ZoneRuntime, enc: Encounter): Routine {
  yield () => enc.flags.rescueOpen === true || z.player.pos.distanceTo(z.m('plateStand')) < APPROACH_R || (S.lift?.progress ?? 0) > 0;
  enc.flags.rescueOpen = true;
  z.setFlag('z06RescueOpen', true);
  tutorialHint(z, 'z06Lift', 'Hold to lift the plate from this side. A hit only cancels the lift.', 'interact', 8); // NEW
}

/**
 * The scripted contextual assist (not the Resonance): as the first ceiling attacker announces its pounce, Selene
 * arrests it — it drops, frozen and open. A slow-motion beat and the hint; the player takes the hit.
 */
function* firstCeiling(z: ZoneRuntime, enc: Encounter): Routine {
  const game = z.game;
  yield () => S.wallrunner !== null || enc.cleared;
  const wr = S.wallrunner;
  if (!wr) return;
  let announced = false;
  // the AI announces the pounce it starts winding up (`ai:telegraph`, never the caption text)
  onZoneEvent(z, 'ai:telegraph', (e) => {
    if (e.actor === wr && e.kind === 'pounce' && wr.alive) announced = true;
  });
  // the announcement (or, failing it, a few seconds on the wall)
  let perchedFor = 0;
  yield () => {
    perchedFor = wr.flying ? perchedFor + game.time.dt : 0;
    return announced || perchedFor > 4.5 || !wr.alive || enc.cleared;
  };
  const selene = z.cast('selene');
  if (!wr.alive || !selene || selene.disrupted || selene.downed) {
    z.log(`z06: no opening (attacker alive ${wr.alive}, selene ${selene ? 'disrupted' : 'missing'})`);
    return;
  }
  z.log(`z06: Selene arrests the first ceiling attacker (${announced ? 'on its announcement' : 'on the wall'})`);
  selene.assist(wr, 'frostArrest');
  let frozen = false;
  onZoneEvent(z, 'actor:frozen', (e) => {
    if (e.actor === wr) frozen = true;
  });
  yield waitOr(z, () => frozen || !wr.alive, 2.5);
  if (!frozen || !wr.alive) return;
  z.setFlag('z06Arrested', true);
  game.time.slowMo(0.4, 1.1);
  tutorialHint(z, 'z06Opening', 'Frost holds it. Strike now.', 'heavy', 5); // NEW
  game.ui.marker('z06-opening', wr.aimPoint(_w), { label: 'Opening', kind: 'threat', hideWithin: 2 }); // NEW
  yield waitOr(z, () => !wr.alive || !wr.frozen, 4);
  game.ui.marker('z06-opening', null);
}

/** the Eclipse rule: link formed → caption, one procedural sentence from Selene, the hint; then short calls */
function* teachLinks(z: ZoneRuntime, enc: Encounter): Routine {
  const game = z.game;
  const say = barker(z, 4);
  let firstLink = -1;
  let cutCaption = -Infinity;
  onZoneEvent(z, 'link:created', ({ link }) => {
    if (firstLink >= 0 || enc.cleared) return;
    firstLink = z.time;
    game.events.emit('caption', { text: 'Link formed', kind: 'link', pos: link.midpoint(_v).clone() }); // NEW
  });
  onZoneEvent(z, 'link:severed', ({ link, by }) => {
    if (z.time - cutCaption > 3) {
      cutCaption = z.time;
      game.events.emit('caption', { text: 'Link cut', kind: 'link', pos: link.midpoint(_v).clone() }); // NEW
    }
    if (by && by === game.player.actor) say('cut', 'Selene', 'Next line.'); // NEW
  });
  yield () => firstLink >= 0 || enc.cleared;
  if (enc.cleared) return;
  yield 1.2;
  // she sees the pattern: one sentence, said once
  z.bark('Selene', 'They move on one count. Cut the line.'); // NEW
  yield 2.5;
  tutorialHint(z, 'z06Link', 'Linked bodies move and strike as one. Cut the link, or destroy its anchor, and they come apart.', 'scan', 9); // NEW
  while (!enc.cleared) {
    const links = game.ai.links.all.length;
    if (links > 0 && S.anchor && !S.anchor.disabled && z.time - firstLink > 14) say('anchor', 'Selene', 'The anchor. South breach.'); // NEW
    if (S.weaver && S.weaver.alive && links === 0 && enc.flags.linkLearned === true) say('source', 'Selene', 'The source. Now.'); // NEW
    yield 0.5;
  }
}

/** Lyessa holds a defensive lane by the plate: suppressing fire, the calls of her lane, and the call back */
function* lyessaLane(z: ZoneRuntime, enc: Encounter): Routine {
  const lyessa = z.cast('lyessa');
  if (!lyessa) return;
  lyessa.mode = 'hold';
  lyessa.holdAt(z.m('lyessaPost'), z.myaw('lyessaPost'));
  const stand = z.m('plateStand');
  let next = z.time + 3;
  let away = 0;
  let lastCall = -Infinity;
  let calls = 0;
  let plateCall = -Infinity;
  while (!enc.cleared || !(S.lift?.done ?? false)) {
    const dt = z.game.time.dt;
    if (!enc.cleared && z.time >= next && !lyessa.assisting && !lyessa.disrupted) {
      next = z.time + SUPPRESS_EVERY;
      const target = nearestTo(enc.alive, stand, 18);
      if (target) lyessa.assist(target, 'suppress');
    }
    // a body on the plate while the lead is elsewhere
    const onPlate = nearestTo(enc.alive, stand, 3.5);
    if (onPlate && z.player.pos.distanceTo(stand) > 9 && z.time - plateCall > 20) {
      plateCall = z.time;
      z.bark('Lyessa', 'At the plate.'); // NEW
    }
    // he walked away from the marine: his first name and the task, nothing else (SCRIPT_SOURCE Z06 rescue)
    const open = enc.flags.rescueOpen === true && S.lift !== null && !S.lift.done;
    away = open && z.player.pos.distanceTo(stand) > ABANDON_R ? away + dt : 0;
    if (away > ABANDON_S && z.time - lastCall > 30 && calls < 3) {
      lastCall = z.time;
      calls++;
      away = 0;
      z.bark('Lyessa', 'Tarrik. The plate.'); // NEW
    }
    yield 0.25;
  }
}

/** while the lead holds the plate, Selene arrests whatever comes for him (two methods, one problem) */
function* seleneCover(z: ZoneRuntime, enc: Encounter): Routine {
  const stand = z.m('plateStand');
  let next = 0;
  while (!enc.cleared && !(S.lift?.done ?? false)) {
    const selene = z.cast('selene');
    if (S.lifting && selene && z.time >= next && !selene.assisting && !selene.disrupted) {
      const threat = nearestTo(enc.alive, stand, 5);
      if (threat && !threat.frozen) {
        selene.assist(threat, 'frostArrest');
        next = z.time + COVER_EVERY;
      }
    }
    yield 0.2;
  }
}

function nearestTo(list: readonly Actor[], pos: THREE.Vector3, within: number): Actor | null {
  let best: Actor | null = null;
  let bestD = within;
  for (const a of list) {
    const d = a.pos.distanceTo(pos);
    if (a.alive && d < bestD) {
      best = a;
      bestD = d;
    }
  }
  return best;
}

/**
 * ZoneDef.update helpers: the seam's light (gold at rest; violet and quick while something moves inside it or
 * clings over it), and the plate following the hold (the front edge strains up as the hold fills).
 */
export function updateFight(z: ZoneRuntime, dt: number): void {
  const mat = S.seamMat;
  if (mat) {
    let target = 0;
    const wr = S.wallrunner;
    if (S.seamFlicker > 0) {
      S.seamFlicker -= dt;
      target = 0.65 + 0.35 * Math.sin(z.time * 37);
    } else if (wr && wr.alive && wr.flying && Math.hypot(wr.pos.x - SEAM_PERCH_X, wr.pos.z - SEAM_PERCH_Z) < 3) {
      target = 0.8 + 0.2 * Math.sin(z.time * 9);
    }
    S.seamGlow = z.skipping ? target : S.seamGlow + (target - S.seamGlow) * Math.min(1, dt * 7);
    mat.emissive.setHex(GOLD).lerp(_violet, S.seamGlow);
    mat.emissiveIntensity = 1.4 + 3.4 * S.seamGlow;
  }
  const plate = S.plate;
  const lift = S.lift;
  if (plate && lift && !lift.done) plate.params.lift = S.lifting ? 0.12 + 0.55 * lift.progress : 0;
  if (S.lifting && plate) {
    const v = z.game.player.actor.visual;
    const l = plate.socket('gripL');
    const r = plate.socket('gripR');
    if (isHumanoidVisual(v) && l && r) {
      v.setHandTarget('L', l.getWorldPosition(_v), 1);
      v.setHandTarget('R', r.getWorldPosition(_w), 1);
    }
  }
}

const _violet = new THREE.Color(VIOLET);
/** world x / z of the floor point under the seam perch (plan → world: z = −n) */
const SEAM_PERCH_X = SEAM.x - 1.25;
const SEAM_PERCH_Z = -SEAM.n;
