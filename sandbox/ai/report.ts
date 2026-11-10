/**
 * `__aiReport(seconds)`: run the current scene headless under the bot and summarise what happened — spawns,
 * synchronised volleys, links, phases — together with the fairness checks the quality bar asks for
 * (telegraph lengths, melee through walls, bodies off the floor, bodies that stopped moving, warnings, NaNs).
 */
import * as THREE from 'three';
import type { Actor, Game } from '@/core/api';
import type { Bot } from './bot';
import type { Scene } from './scenes';

interface ReporterDeps {
  game: Game;
  tick(dt: number, withUi?: boolean): void;
  scene: Scene;
  log: string[];
  bot: Bot;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const r1 = (v: number): number => Math.round(v * 10) / 10;

export function makeReporter(d: ReporterDeps) {
  const { game } = d;
  const warnings: string[] = [];
  const origWarn = console.warn.bind(console);
  console.warn = (...args: unknown[]) => {
    if (warnings.length < 40) warnings.push(args.map(String).join(' ').slice(0, 220));
    origWarn(...args);
  };
  const counts = {
    waves: [] as number[], linksCreated: 0, linksSevered: 0, devicesDown: [] as string[], detections: 0,
    hitsOnPlayer: {} as Record<string, number>, blocked: 0, perfect: 0, hitsOnCompanions: 0, kills: {} as Record<string, number>,
    meleeThroughWalls: 0, captions: [] as string[], companionDowns: 0,
  };
  const isPlayer = (a: Actor | null): boolean => !!a && a === game.player.actor;
  game.events.on('encounter:wave', (e) => counts.waves.push(e.wave));
  game.events.on('link:created', () => counts.linksCreated++);
  game.events.on('link:severed', () => counts.linksSevered++);
  game.events.on('device:disabled', (e) => counts.devicesDown.push(e.id));
  game.events.on('scan:detected', () => counts.detections++);
  game.events.on('caption', (e) => {
    if (/is down/.test(e.text)) counts.companionDowns++;
    if (counts.captions.indexOf(e.text) < 0 && counts.captions.length < 24) counts.captions.push(e.text);
  });
  game.events.on('actor:died', (e) => {
    const k = String(e.actor.archetype);
    counts.kills[k] = (counts.kills[k] ?? 0) + 1;
  });
  game.events.on('actor:hit', (e) => {
    const { target, hit, result } = e;
    if (isPlayer(target)) {
      if (result.immune) return;
      const key = hit.tag ?? `${String(hit.attacker?.archetype ?? 'none')}:${hit.kind}`;
      counts.hitsOnPlayer[key] = (counts.hitsOnPlayer[key] ?? 0) + 1;
      if (result.perfect) counts.perfect++;
      else if (result.blocked) counts.blocked++;
      // nothing may strike through a wall
      const by = hit.attacker;
      if (by && by.alive && hit.kind === 'melee' && hit.tag !== 'slam' && hit.tag !== 'charge') {
        if (!game.physics.lineOfFire(by.aimPoint(_a), target.aimPoint(_b))) counts.meleeThroughWalls++;
      }
    } else if (target.tags.has('companion') && !result.immune) counts.hitsOnCompanions++;
  });

  function snapshot() {
    const p = game.player.actor;
    const enc = d.scene.enc;
    return {
      scene: d.scene.id, t: r1(game.time.now), who: game.player.protagonist, bot: d.bot.enabled ? d.bot.doing : 'off',
      player: { hp: r1(p.hp), pos: [r1(p.pos.x), r1(p.pos.z)], threat: r1(game.player.threat), echo: game.player.echo, action: game.player.action },
      enc: enc ? { state: enc.state, alive: enc.aliveCount, spawned: enc.spawned, total: enc.total, killed: enc.killed, wave: enc.wave, queued: enc.queued ?? 0, peak: enc.peakActive ?? 0, meleeHeld: enc.meleeSlotsHeld ?? 0, flags: { ...enc.flags } } : null,
      hostiles: game.actors.hostilesOf(p).map((h) => ({
        name: h.name, hp: r1(h.hp), pos: [r1(h.pos.x), r1(h.pos.y), r1(h.pos.z)], linked: h.linked, staggered: h.staggered, frozen: h.frozen,
        weak: h.weakPoints.filter((w) => w.exposed).map((w) => w.id),
      })),
      links: game.ai.links.all.length, intensity: r1(game.ai.intensity),
      facts: d.scene.facts(),
    };
  }

  function run(seconds: number) {
    const god = game.player.godMode;
    const botWas = d.bot.enabled;
    game.player.godMode = true;
    d.bot.enabled = true;
    const n = Math.max(1, Math.round(seconds * 60));
    let nan = 0;
    let offFloor = 0;
    let peakAlive = 0;
    let maxThreat = 0;
    let maxIntensity = 0;
    let maxMeleeHeld = 0;
    // "never gets stuck": a ground enemy that has a target and has not moved a metre in 12 s without attacking
    const lastMove = new Map<Actor, { x: number; z: number; t: number; attacks: number }>();
    const stuck = new Set<string>();
    const t0 = performance.now();
    let clearedAt = -1;
    for (let i = 0; i < n; i++) {
      d.tick(1 / 60, false);
      const enc = d.scene.enc;
      if (enc) {
        peakAlive = Math.max(peakAlive, enc.aliveCount);
        maxMeleeHeld = Math.max(maxMeleeHeld, enc.meleeSlotsHeld ?? 0);
        if (enc.cleared && clearedAt < 0) clearedAt = game.time.now;
      }
      maxThreat = Math.max(maxThreat, game.player.threat);
      maxIntensity = Math.max(maxIntensity, game.ai.intensity);
      if (i % 30 !== 0) continue;
      for (const a of game.actors.all) {
        if (!Number.isFinite(a.pos.x + a.pos.y + a.pos.z + a.yaw + a.hp)) nan++;
        if (!a.alive || a.fixed) continue;
        if (!a.flying && !game.physics.canStand(a.pos.x, a.pos.y, a.pos.z, 0.25, 1, 0)) offFloor++;
        if (!a.tags.has('enemy') || a.flying) continue;
        const brain = a.controller as unknown as { lastAttackAt?: number; target?: Actor | null; dormant?: boolean };
        const m = lastMove.get(a);
        const attackStamp = brain.lastAttackAt ?? 0;
        if (!m || Math.hypot(a.pos.x - m.x, a.pos.z - m.z) > 1 || attackStamp !== m.attacks || !brain.target || brain.dormant) {
          lastMove.set(a, { x: a.pos.x, z: a.pos.z, t: game.time.now, attacks: attackStamp });
        } else if (game.time.now - m.t > 12) stuck.add(`${a.name}#${a.id}`);
      }
    }
    const wallMs = Math.round(performance.now() - t0);
    game.player.godMode = god;
    d.bot.enabled = botWas;
    if (!botWas) game.input.virtual.clear();
    const s = game.ai.stats;
    const enc = d.scene.enc;
    return {
      scene: d.scene.id, simulated: seconds, wallMs, msPerTick: Math.round((wallMs / n) * 100) / 100,
      encounter: enc ? { state: enc.state, clearedAt: clearedAt < 0 ? null : r1(clearedAt), spawned: enc.spawned, total: enc.total, killed: enc.killed, wavesReleased: counts.waves, peakAlive, cap: enc.maxActive, maxMeleeHeld, meleeSlots: enc.meleeSlots, flags: { ...enc.flags } } : null,
      stats: { ...s, minTelegraph: Number.isFinite(s.minTelegraph) ? Math.round(s.minTelegraph * 100) / 100 : null },
      links: { created: counts.linksCreated, severed: counts.linksSevered, alive: game.ai.links.all.length },
      devicesDown: counts.devicesDown, detections: counts.detections,
      player: { hitsTaken: counts.hitsOnPlayer, blocked: counts.blocked, perfect: counts.perfect, maxThreat: r1(maxThreat), echo: game.player.echo },
      companions: { hitsTaken: counts.hitsOnCompanions, downs: counts.companionDowns },
      kills: counts.kills, maxIntensity: r1(maxIntensity),
      checks: {
        capRespected: enc ? peakAlive <= (enc.maxActive ?? Infinity) : true,
        meleeSlotsRespected: enc ? maxMeleeHeld <= Math.max(enc.meleeSlots, enc.flags.linkLearned ? 3 : 0) : true,
        telegraphsReadable: !Number.isFinite(s.minTelegraph) || s.minTelegraph >= 0.45,
        meleeThroughWalls: counts.meleeThroughWalls, nan, offFloorSamples: offFloor, stuck: [...stuck], warnings,
      },
      facts: d.scene.facts(), captions: counts.captions, log: d.log.slice(-30), end: snapshot(),
    };
  }

  return { run, snapshot };
}
