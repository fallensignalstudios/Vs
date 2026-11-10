/**
 * Test support (vitest only — not imported by the game): a headless fake Game with the real event bus, script
 * runner and mission system, and small recording fakes for the subsystems the mission system talks to.
 */
import * as THREE from 'three';
import type { Actor, ButtonAction, ChoiceHandle, ChoiceOpts, Game, GameEvents, InputContext, ProtagonistId, UrlFlags, Vec3Like, ZoneDef, ZoneId, ZoneRuntime, Routine } from '@/core/api';
import { Emitter } from '@/core/events';
import { ScriptRunnerImpl } from '@/core/script';
import { nullObject } from '@/core/stub';
import { MissionSystemImpl } from './system';
import type { StorageLike } from './save';

/** object whose unknown members are null-object stubs */
function withStubs<T extends object>(name: string, real: object): T {
  return new Proxy(real as Record<string | symbol, unknown>, {
    get(t, p, recv) {
      if (p in t) return Reflect.get(t, p, recv);
      if (typeof p === 'symbol' || p === 'then' || p === '__isStub') return undefined;
      return nullObject(`${name}.${String(p)}`);
    },
  }) as unknown as T;
}

export class MemoryStorage implements StorageLike {
  readonly data = new Map<string, string>();
  failWrites = false;
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error('quota');
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
}

export interface FakeInput {
  context: InputContext;
  held: Partial<Record<ButtonAction, number>>;
  presses: Set<ButtonAction>;
  down: Set<ButtonAction>;
}

export interface TestWorld {
  game: Game;
  mission: MissionSystemImpl;
  storage: MemoryStorage;
  input: FakeInput;
  ui: { hud: boolean; fade: number; letterbox: boolean; subtitles: Array<string | null>; choices: Array<ChoiceHandle & { opts: ChoiceOpts }>; prompts: Array<string | null>; toasts: string[] };
  player: { actor: Actor | null; protagonist: ProtagonistId | undefined; enabled: boolean; spawns: Array<{ id: ProtagonistId; pos: Vec3Like }>; restored: number };
  events: Array<{ type: keyof GameEvents; payload: unknown }>;
  /** advance the simulation the way Game.tick does (scripts, then the mission system) unless loading */
  tick(seconds: number, dt?: number): void;
  eventsOf<K extends keyof GameEvents>(type: K): Array<GameEvents[K]>;
}

function makeActor(pos: Vec3Like, yaw: number): Actor {
  return withStubs<Actor>('actor', {
    id: 1, pos: new THREE.Vector3(pos.x, pos.y, pos.z), yaw, alive: true, invulnerable: false, height: 1.8, radius: 0.4,
    visual: null, team: 'player', tags: new Set<string>(),
  });
}

export function createTestWorld(opts: { storage?: MemoryStorage; zones?: ZoneDef[]; overrides?: Partial<Record<keyof Game, object>> } = {}): TestWorld {
  const storage = opts.storage ?? new MemoryStorage();
  const events = new Emitter<GameEvents>();
  const scripts = new ScriptRunnerImpl();
  const time = { now: 0, dt: 0, unscaledDt: 0, scale: 1, frame: 0, hitStop() {}, slowMo() {} };
  const flags: UrlFlags = { zone: null, beat: null, checkpoint: null, debug: false, autoplay: false, mute: true, nopost: true, quality: null, manual: true, seed: 7283 };
  const log: TestWorld['events'] = [];

  const input: FakeInput = { context: 'game', held: {}, presses: new Set(), down: new Set() };
  const inputSys = withStubs<Game['input']>('input', {
    get context() { return input.context; },
    setContext(c: InputContext) { input.context = c; },
    heldTime: (a: ButtonAction) => input.held[a] ?? 0,
    lastHeldTime: () => 0,
    pressed: (a: ButtonAction) => input.presses.has(a),
    released: () => false,
    take: (a: ButtonAction) => input.presses.delete(a),
    engaged: (a: ButtonAction) => input.down.has(a),
    disengage: (a: ButtonAction) => { input.down.delete(a); },
    glyph: (a: ButtonAction) => a.toUpperCase(),
  });

  const ui: TestWorld['ui'] = { hud: false, fade: 0, letterbox: false, subtitles: [], choices: [], prompts: [], toasts: [] };
  const uiSys = withStubs<Game['ui']>('ui', {
    get hudVisible() { return ui.hud; },
    setHudVisible(v: boolean) { ui.hud = v; },
    get fadeLevel() { return ui.fade; },
    fade(level: number) { ui.fade = level; },
    letterbox(on: boolean) { ui.letterbox = on; },
    get modalOpen() { return ui.choices.some((c) => c.selected === null); },
    subtitle(line: { text: string } | null) { ui.subtitles.push(line ? line.text : null); },
    prompt(p: { text: string } | null) { ui.prompts.push(p ? p.text : null); },
    toast(text: string) { ui.toasts.push(text); },
    choice(o: ChoiceOpts): ChoiceHandle {
      const h = { opts: o, selected: null as string | null, select(id: string) { if (o.options.some((x) => x.id === id)) this.selected = id; } };
      ui.choices.push(h);
      return h;
    },
  });

  const player: TestWorld['player'] = { actor: null, protagonist: undefined, enabled: true, spawns: [], restored: 0 };
  const playerSys = withStubs<Game['player']>('player', {
    get actor() { return player.actor; },
    get protagonist() { return player.protagonist; },
    get enabled() { return player.enabled; },
    set enabled(v: boolean) { player.enabled = v; },
    godMode: false,
    contextAction: null,
    setProtagonist(id: ProtagonistId, at: { pos: Vec3Like; yaw: number }) {
      player.protagonist = id;
      player.actor = makeActor(at.pos, at.yaw);
      player.spawns.push({ id, pos: { x: at.pos.x, y: at.pos.y, z: at.pos.z } });
      events.emit('player:protagonist', { id });
    },
    restoreForCheckpoint() { player.restored++; },
    teleport(pos: Vec3Like) { player.actor?.pos.set(pos.x, pos.y, pos.z); },
  });

  const settings = withStubs<Game['settings']>('settings', { get: (k: string) => (k === 'difficulty' ? 'standard' : k === 'navAssist' ? false : undefined) });

  const base = {
    events, scripts, time, flags, settings,
    scene: new THREE.Scene(),
    input: inputSys, ui: uiSys, player: playerSys,
    phase: 'playing', paused: false,
    setPhase() {}, setPaused() {},
    random: () => 0.5,
    createZoneBuilder: () => nullObject('kit'),
    ...(opts.overrides ?? {}),
  };
  const game = withStubs<Game>('game', base);
  const mission = new MissionSystemImpl(game, storage);
  (base as Record<string, unknown>).mission = mission;
  for (const z of opts.zones ?? []) mission.registerZone(z);

  const types: Array<keyof GameEvents> = [
    'zone:loading', 'zone:ready', 'zone:beat', 'zone:exit', 'checkpoint:saved', 'mission:complete', 'dialogue:line', 'dialogue:clear',
    'cinematic:start', 'cinematic:end', 'objective:changed', 'interact:done', 'choice:made', 'handoff',
  ];
  for (const type of types) events.on(type, (payload) => log.push({ type, payload }));

  const world: TestWorld = {
    game, mission, storage, input, ui, player, events: log,
    tick(seconds: number, dt = 1 / 30): void {
      const n = Math.max(1, Math.round(seconds / dt));
      for (let i = 0; i < n; i++) {
        time.frame++;
        if (mission.loading) continue;
        time.dt = dt;
        time.now += dt;
        scripts.update(dt);
        mission.update(dt);
      }
    },
    eventsOf<K extends keyof GameEvents>(type: K): Array<GameEvents[K]> {
      return log.filter((e) => e.type === type).map((e) => e.payload as GameEvents[K]);
    },
  };
  return world;
}

/** Minimal zone: no geometry, one marker at the origin, the given beats. */
export function zoneOf(id: string, beats: ZoneDef['beats'], extra: Partial<ZoneDef> = {}): ZoneDef {
  return {
    id: id as ZoneId,
    title: `Zone ${id}`,
    build(b) {
      b.marker('start', 0, 0, 0, 0);
      b.marker('far', 20, 20, 0, 90);
      b.finalize();
    },
    beats,
    ...extra,
  };
}

/** `enter` that spawns Tarrik at the start marker. */
export const spawnAtStart = (z: ZoneRuntime): void => {
  z.spawnPlayer('tarrik', 'start');
};

/** a routine that does nothing */
export function* idle(): Routine {
  /* empty beat */
}
