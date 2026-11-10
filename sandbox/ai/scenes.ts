/**
 * The five sandbox scenes: each builds a greybox, the cast and the encounter the way a zone script would, and
 * returns the small amount of scripting the encounter needs (flags, the E4 Thermal Fracture sequence).
 */
import * as THREE from 'three';
import type { Actor, Companion, DeviceHandle, EliteController, Encounter, Game, ProtagonistId, Vec3Like } from '@/core/api';
import { buildZ04, buildZ08, planPos } from '@/world/physics/fixtures';
import type { Bot } from './bot';
import { coverBlock, hall, type Greybox } from './greybox';

export type SceneId = 'e1' | 'e2' | 'e3' | 'e4' | 'companions' | 'stage';

export interface SceneCtx {
  game: Game;
  gb: Greybox;
  scene: THREE.Scene;
  bot: Bot;
  /** append a line to the run log (shown in the report) */
  log(msg: string): void;
}

export interface Scene {
  id: SceneId;
  who: ProtagonistId;
  start: { pos: Vec3Like; yaw: number };
  enc: Encounter | null;
  /** per-tick scene script */
  update(dt: number): void;
  /** named things for the console / screenshots */
  refs: Record<string, unknown>;
  /** facts for the report */
  facts(): Record<string, unknown>;
}

const EAST = -Math.PI / 2;
const SOUTH = Math.PI;

// --------------------------------------------------------------------------------------------------------------------
// E1 — pressure hall: six drones (4 + 2), three lanes, a command emitter synchronising two of them
// --------------------------------------------------------------------------------------------------------------------
function e1(c: SceneCtx): Scene {
  const { game, gb } = c;
  hall(gb, 0, -13, 56, 13);
  for (const [x, zs] of [[10, [-7, 0, 7]], [22, [-9, -2, 6]], [38, [-6, 3, 9]]] as Array<[number, number[]]>) {
    zs.forEach((z, i) => coverBlock(gb, x, z, 0.9, 3, i === 1 ? 'high' : 'low'));
  }
  gb.flush();
  game.physics.nav.rebuild();
  let emitter: DeviceHandle | null = null;
  const enc = game.ai.createEncounter({
    id: 'E1', maxActive: 4,
    waves: [
      {
        spawns: [
          { role: 'secDrone', at: { x: 47, y: 0, z: -7.5 }, opts: { yaw: -EAST, lane: 0 } },
          { role: 'secDrone', at: { x: 49, y: 0, z: 0 }, opts: { yaw: -EAST, lane: 1 } },
          { role: 'secDrone', at: { x: 47, y: 0, z: 7.5 }, opts: { yaw: -EAST, lane: 2 } },
          { role: 'secDrone', at: { x: 51, y: 0, z: 4 }, opts: { yaw: -EAST, lane: 1 } },
        ],
        onSpawn: (actors) => {
          // the two outer lanes cover each other through the emitter
          emitter = game.ai.devices.commandEmitter({ id: 'emitter', pos: { x: 42, y: 0, z: -11 }, drones: [actors[0] as Actor, actors[2] as Actor] });
          c.bot.objective = () => (emitter && !emitter.disabled ? emitter.actor : null);
        },
      },
      {
        when: (e) => e.flags.formationBroken === true && e.aliveCount <= 2,
        telegraph: 1.4,
        onTelegraph: () => {
          c.log('aperture opens');
          game.audio.play('apertureOpen', { pos: { x: 55, y: 5, z: 0 } });
          game.events.emit('caption', { text: 'Service aperture opening', kind: 'door' });
        },
        spawns: [
          { role: 'secDrone', at: { x: 46, y: 0, z: -3 }, opts: { via: 'aperture', from: { x: 55, y: 5.5, z: -2 } } },
          { role: 'secDrone', at: { x: 46, y: 0, z: 5 }, opts: { via: 'aperture', from: { x: 55, y: 5.5, z: 2 } } },
        ],
      },
    ],
    onCleared: () => c.log('E1 cleared'),
  });
  // formationBroken = emitter destroyed / staggered OR the first drone destroyed
  game.events.on('device:disabled', (e) => {
    if (e.id === 'emitter') enc.flags.formationBroken = true;
  });
  game.events.on('actor:staggered', (e) => {
    if (emitter && e.actor === emitter.actor) enc.flags.formationBroken = true;
  });
  game.events.on('actor:died', (e) => {
    if (enc.has?.(e.actor)) enc.flags.formationBroken = true;
  });
  const lyessa = game.ai.spawnCompanion('lyessa', { pos: { x: 2.5, y: 0, z: 5 }, yaw: EAST, mode: 'hold' });
  return {
    id: 'e1', who: 'tarrik', start: { pos: { x: 4, y: 0, z: 0 }, yaw: EAST }, enc,
    update() {},
    refs: { enc, lyessa, get emitter() { return emitter; } },
    facts: () => ({ emitterDown: emitter?.disabled ?? null, formationBroken: enc.flags.formationBroken === true }),
  };
}

// --------------------------------------------------------------------------------------------------------------------
// E2 — relay overlook: four Enforcers (shield front) + two contaminated drones on a relay network
// --------------------------------------------------------------------------------------------------------------------
function e2(c: SceneCtx): Scene {
  const { game, gb } = c;
  const fx = buildZ04(gb.physics);
  gb.flush();
  game.physics.nav.rebuild();
  const rxA = game.ai.devices.relayReceiver({ id: 'receiverA', pos: planPos(35, 18), network: 'z04' });
  const rxB = game.ai.devices.relayReceiver({ id: 'receiverB', pos: planPos(16, 27), network: 'z04' });
  const head = game.ai.devices.scanHead({ id: 'scanS', pos: planPos(8, 11), yaw: EAST, arcDeg: 80, range: 30, period: 7, onDetect: () => c.log('scan head saw the player') });
  const enc = game.ai.createEncounter({
    id: 'E2', maxActive: 6,
    waves: [{
      spawns: [
        ...[29.6, 32.4, 35.2, 38].map((x) => ({ role: 'enforcer' as const, at: planPos(x, 23), opts: { yaw: SOUTH, via: 'march' as const, from: planPos(x, 31) } })),
        { role: 'contamDrone', at: planPos(20, 15), opts: { network: 'z04' } },
        { role: 'contamDrone', at: planPos(43, 17), opts: { network: 'z04' } },
      ],
    }],
    onCleared: () => c.log('E2 cleared'),
  });
  c.bot.objective = () => (!rxA.disabled ? rxA.actor : !rxB.disabled ? rxB.actor : null);
  return {
    id: 'e2', who: 'selene', start: { pos: fx.marks.floorMid, yaw: 0 }, enc,
    update() {},
    refs: { enc, rxA, rxB, head, fx },
    facts: () => {
      const net = game.ai.devices.network('z04');
      return { receiversDown: [rxA.disabled, rxB.disabled], networkDown: net.down, release: net.down && enc.cleared };
    },
  };
}

// --------------------------------------------------------------------------------------------------------------------
// E3 — breach rescue: three linkbound + a wallrunner, then two linkbound + a Weaver through the second breach
// --------------------------------------------------------------------------------------------------------------------
function e3(c: SceneCtx): Scene {
  const { game, gb } = c;
  hall(gb, 0, -17, 56, 17);
  coverBlock(gb, 14, -6, 3, 0.9, 'low');
  coverBlock(gb, 14, 8, 0.9, 3, 'high');
  coverBlock(gb, 30, 10, 3, 0.9, 'low');
  coverBlock(gb, 36, -10, 0.9, 3, 'high');
  // the fallen plate (a low slab the fight turns around)
  gb.physics.addCollider({ shape: { kind: 'box', hx: 2.2, hy: 0.5, hz: 1.4 }, x: 24, y: 0.5, z: 0, yaw: 0.3, tag: 'kerb', cover: 'low' });
  gb.flush();
  game.physics.nav.rebuild();
  const anchor = game.ai.devices.weaverAnchor({ id: 'anchor', pos: { x: 51, y: 0, z: -11 } });
  const selene = game.ai.spawnCompanion('selene', { pos: { x: 3, y: 0, z: 2.5 }, yaw: EAST, mode: 'combat' });
  let t = 0;
  let arrested = false;
  const enc = game.ai.createEncounter({
    id: 'E3', maxActive: 6, meleeSlots: 2,
    waves: [
      {
        spawns: [
          { role: 'linkbound', at: { x: 28, y: 0, z: -5 }, opts: { yaw: -EAST } },
          { role: 'linkbound', at: { x: 30, y: 0, z: 1 }, opts: { yaw: -EAST } },
          { role: 'linkbound', at: { x: 28, y: 0, z: 6 }, opts: { yaw: -EAST } },
          { role: 'wallrunner', at: { x: 34, y: 0, z: 13 }, opts: { via: 'ceiling' } },
        ],
      },
      {
        when: (e) => e.flags.rescueOpen === true && e.aliveCount <= 3,
        telegraph: 1.2,
        onTelegraph: () => {
          c.log('second breach');
          game.audio.play('breachCrack', { pos: { x: 50, y: 0, z: -8 } });
          game.events.emit('caption', { text: 'A second breach is opening', kind: 'breach', pos: { x: 50, y: 1, z: -8 } });
        },
        spawns: [
          { role: 'linkbound', at: { x: 47, y: 0, z: -6 }, opts: { via: 'breach' } },
          { role: 'linkbound', at: { x: 46, y: 0, z: -10 }, opts: { via: 'breach' } },
          { role: 'weaver', at: { x: 50, y: 0, z: -8 }, opts: { via: 'breach' } },
        ],
      },
    ],
    onCleared: () => c.log('E3 cleared'),
  });
  // the player has learned the link response once a link has been cut
  game.events.on('link:severed', () => {
    enc.flags.linkLearned = true;
  });
  // Selene arrests the first ceiling attacker as it announces itself
  game.events.on('caption', (e) => {
    if (arrested || e.kind !== 'breach' || !/Skitter/.test(e.text)) return;
    const wr = enc.alive.find((a) => String(a.archetype) === 'wallrunner');
    if (!wr) return;
    arrested = true;
    selene.assist(wr, 'frostArrest');
    c.log('Selene arrests the wallrunner');
  });
  return {
    id: 'e3', who: 'tarrik', start: { pos: { x: 4, y: 0, z: 0 }, yaw: EAST }, enc,
    update(dt) {
      t += dt;
      // "the rescue approach is open": here, simply once the fight has run a little
      if (t > 6 && !enc.flags.rescueOpen) {
        enc.flags.rescueOpen = true;
        c.log('rescueOpen');
      }
    },
    refs: { enc, selene, anchor },
    facts: () => ({ rescueOpen: enc.flags.rescueOpen === true, linkLearned: enc.flags.linkLearned === true, arrestedCeilingAttacker: arrested, anchorDown: anchor.disabled }),
  };
}

// --------------------------------------------------------------------------------------------------------------------
// E4 — quarantine crucible: the elite fed by a Weaver and two linkbound; isolation; one Thermal Fracture
// --------------------------------------------------------------------------------------------------------------------
function e4(c: SceneCtx): Scene {
  const { game, gb } = c;
  const fx = buildZ08(gb.physics);
  gb.flush();
  game.physics.nav.rebuild();
  game.physics.nav.warm(1.2, 3.6);
  const noGo = [{ minX: 3, maxX: 15, minZ: -45, maxZ: -35 }, { minX: 62, maxX: 69, minZ: -45, maxZ: -35 }];
  // the bot lets phase A play before it starts cutting links
  c.bot.severAfter = 35;
  const frost = game.ai.devices.frostAnchor({ id: 'frostAnchor', pos: planPos(49, 21) });
  const tarrik = game.ai.spawnCompanion('tarrik', { pos: planPos(33, 6), mode: 'combat' });
  const lyessa = game.ai.spawnCompanion('lyessa', { pos: planPos(38, 5), mode: 'hold' });
  let partner: Companion = tarrik;
  let ctl: EliteController | null = null;
  let elite: Actor | null = null;
  let weaver: Actor | null = null;
  let phaseB = false;
  let seenA = false;
  let fractureAt = -1;
  let stage: 'A' | 'B' | 'window' | 'confirm' | 'fracturing' | 'finish' = 'A';
  let windows = 0;
  let cooldown = 0;
  const enc = game.ai.createEncounter({
    id: 'E4', maxActive: 5,
    waves: [
      {
        spawns: [
          { role: 'elite', at: fx.marks.courtMid, opts: { yaw: SOUTH, noGo } },
          { role: 'weaver', at: planPos(35, 41), opts: { yaw: SOUTH } },
          { role: 'linkbound', at: planPos(29, 36), opts: { yaw: SOUTH } },
          { role: 'linkbound', at: planPos(41, 36), opts: { yaw: SOUTH } },
        ],
        onSpawn: (actors) => {
          elite = actors[0] as Actor;
          weaver = actors[1] as Actor;
          // once it starts cutting, the bot goes for the source: the Weaver
          c.bot.objective = () => (weaver && weaver.alive && game.time.now >= c.bot.severAfter ? weaver : null);
          ctl = game.ai.elite(elite);
          if (ctl) ctl.onPhase = (p) => c.log(`elite phase ${p}`);
        },
      },
      {
        // a wallrunner joins from a rib after the first link falls
        when: (e) => e.flags.anchorDown === true,
        spawns: [{ role: 'wallrunner', at: planPos(22, 30), opts: { via: 'ceiling' } }],
      },
    ],
    onCleared: () => c.log('E4 cleared'),
  });
  game.events.on('link:severed', () => {
    enc.flags.anchorDown = true;
  });

  function update(dt: number): void {
    if (!ctl || !elite || !elite.alive) return;
    cooldown -= dt;
    const now = game.time.now;
    if (ctl.phase === 'A') seenA = true;
    const weaverAlive = !!weaver && weaver.alive;
    if (stage === 'A' && seenA && ctl.phase === 'B' && !weaverAlive) {
      // explicit handoff: Tarrik takes the court, Selene (AI) goes to the frost anchor
      stage = 'B';
      phaseB = true;
      const at = { pos: tarrik.actor.pos.clone(), yaw: tarrik.actor.yaw };
      const old = { pos: game.player.actor.pos.clone(), yaw: game.player.actor.yaw };
      tarrik.remove();
      game.player.setProtagonist('tarrik', at);
      partner = game.ai.spawnCompanion('selene', { pos: old.pos, yaw: old.yaw, mode: 'scripted' });
      partner.moveTo(frost.actor.pos, { run: true, stopDistance: 0.6 });
      game.events.emit('handoff', { from: 'selene', to: 'tarrik' });
      c.log('handoff → Tarrik; Selene to the frost anchor');
      cooldown = 4;
    }
    if (stage === 'B' && cooldown <= 0 && partner.arrived && !partner.disrupted) {
      if (ctl.requestResonanceWindow(8)) {
        stage = 'window';
        windows++;
        c.log('resonance window requested');
      }
    }
    if (stage === 'window') {
      if (partner.disrupted) {
        ctl.cancelResonanceWindow();
        stage = 'B';
        cooldown = 5;
        c.log('window cancelled: partner disrupted');
      } else if (ctl.jointExposed) {
        partner.assist(elite, 'frostArrest');
        stage = 'confirm';
        game.audio.play('resonanceWindow');
        const joint = elite.visual?.socket('joint').getWorldPosition(new THREE.Vector3()) ?? elite.pos;
        const ring = game.vfx.spawn('resonanceRing', joint, { duration: 5 });
        game.player.setContextAction({
          id: 'thermalFracture', prompt: 'Thermal Fracture', button: 'heavy', window: 5, autoConfirmable: true,
          onConfirm: () => {
            ring.stop();
            stage = 'fracturing';
            fractureAt = game.time.now + 0.98;
            const j = elite!.visual?.socket('joint').getWorldPosition(new THREE.Vector3()) ?? elite!.pos;
            game.vfx.spawn('thermalFracture', j);
            game.audio.play('thermalFracture', { pos: j });
            game.time.slowMo(0.35, 0.9);
            c.log('Thermal Fracture confirmed');
          },
          onExpire: () => {
            ring.stop();
            ctl!.cancelResonanceWindow();
            stage = 'B';
            cooldown = 6;
            c.log('window missed — it costs nothing');
          },
        });
      } else if (!ctl.jointExposed && now > 0 && cooldown < -14) {
        stage = 'B';
        cooldown = 2;
      }
    }
    if (stage === 'confirm' && c.bot.enabled) game.input.virtual.press('heavy');
    if (stage === 'fracturing' && now >= fractureAt) {
      ctl.fracture(game.player.actor);
      lyessa.assist(elite, 'rifleShot');
      stage = 'finish';
      c.log('fractured; Lyessa takes the finishing shot');
    }
  }

  return {
    id: 'e4', who: 'selene', start: { pos: fx.marks.staging, yaw: 0 }, enc,
    update,
    refs: { enc, lyessa, frost, fx, get elite() { return elite; }, get ctl() { return ctl; }, get partner() { return partner; } },
    facts: () => ({
      phase: ctl?.phase ?? null, phaseBReached: phaseB, resonanceWindows: windows, fractured: ctl?.fractured ?? false, stage,
      eliteHp: elite ? Math.round(elite.hp) : null,
    }),
  };
}

// --------------------------------------------------------------------------------------------------------------------
// companions — follow, hold, scripted moves, poses, a doorway and a target for the assists
// --------------------------------------------------------------------------------------------------------------------
function companions(c: SceneCtx): Scene {
  const { game, gb } = c;
  hall(gb, -20, -12, 20, 12);
  // a partition with a 3 m doorway
  gb.physics.addCollider({ shape: { kind: 'box', hx: 0.3, hy: 1.75, hz: 5.25 }, x: 6, y: 1.75, z: -6.75, tag: 'wall' });
  gb.physics.addCollider({ shape: { kind: 'box', hx: 0.3, hy: 1.75, hz: 5.25 }, x: 6, y: 1.75, z: 6.75, tag: 'wall' });
  coverBlock(gb, -6, 5, 3, 0.9, 'low');
  gb.flush();
  game.physics.nav.rebuild();
  const selene = game.ai.spawnCompanion('selene', { pos: { x: -12, y: 0, z: 2 }, yaw: EAST });
  const lyessa = game.ai.spawnCompanion('lyessa', { pos: { x: -12, y: 0, z: -2 }, yaw: EAST });
  const tharne = game.ai.spawnNpc('tharne', { pos: { x: -4, y: 0, z: -8 }, yaw: 0.6, pose: 'kneelTend' });
  const lyric = game.ai.spawnNpc('lyric', { pos: { x: -3, y: 0, z: -8.6 }, yaw: -1.2, pose: 'distress' });
  const survivor = game.ai.spawnNpc('survivor', { pos: { x: 6, y: 0, z: 0 }, yaw: -EAST, seed: 4 });
  const marine = game.ai.spawnNpc('reformationMarine', { pos: { x: -8, y: 0, z: 8 }, yaw: 2, pose: 'sitInjured', seed: 2 });
  const foe = game.ai.spawnEnemy('linkbound', { pos: { x: 14, y: 0, z: 0 }, yaw: -EAST, dormant: true, hpScale: 3 });
  return {
    id: 'companions', who: 'tarrik', start: { pos: { x: -14, y: 0, z: 0 }, yaw: EAST }, enc: null,
    update() {},
    refs: { selene, lyessa, tharne, lyric, survivor, marine, foe },
    facts: () => ({
      seleneToPlayer: Math.round(selene.actor.distanceTo(game.player.actor) * 10) / 10,
      lyessaToPlayer: Math.round(lyessa.actor.distanceTo(game.player.actor) * 10) / 10,
      survivorInDoorway: Math.abs(survivor.actor.pos.z) < 1.2 && Math.abs(survivor.actor.pos.x - 6) < 0.8,
      downed: [selene.downed, lyessa.downed],
    }),
  };
}

// --------------------------------------------------------------------------------------------------------------------
// stage — an empty hall: spawn anything from the console (`__ai.ai.spawnEnemy(...)`) for close-up captures
// --------------------------------------------------------------------------------------------------------------------
function stageScene(c: SceneCtx): Scene {
  const { game, gb } = c;
  hall(gb, -22, -12, 22, 12);
  gb.flush();
  game.physics.nav.rebuild();
  game.actors.setHostile('player', 'reformation', true);
  game.actors.setHostile('player', 'dominion', true);
  return { id: 'stage', who: 'tarrik', start: { pos: { x: -6, y: 0, z: 0 }, yaw: EAST }, enc: null, update() {}, refs: {}, facts: () => ({}) };
}

export function buildScene(id: SceneId, c: SceneCtx): Scene {
  switch (id) {
    case 'stage': return stageScene(c);
    case 'e2': return e2(c);
    case 'e3': return e3(c);
    case 'e4': return e4(c);
    case 'companions': return companions(c);
    default: return e1(c);
  }
}
