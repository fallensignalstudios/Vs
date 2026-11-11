/** Test support: a minimal headless Game around the real ActorManager / PlayerController. Not shipped. */
import * as THREE from 'three';
import type { ActionInfo, Actor, ActorDesc, ButtonAction, CharacterVisual, Game, GameEvents, PhysicsWorld } from '@/core/api';
import { Emitter } from '@/core/events';
import { SettingsStoreImpl } from '@/core/settings';
import { nullObject } from '@/core/stub';
import { ActorManagerImpl } from './manager';
import { PlayerControllerImpl } from './player/controller';

/** Scriptable stand-in for the input system (only what the player controller reads). */
export class FakeInput {
  move = { x: 0, y: 0 };
  moveWorld: { x: number; z: number } | null = null;
  look = { x: 0, y: 0 };
  private readonly held = new Map<string, number>();
  private readonly edges = new Set<string>();

  press(a: ButtonAction): void {
    this.edges.add(a);
  }
  hold(a: ButtonAction, down: boolean): void {
    if (down) {
      if (!this.held.has(a)) {
        this.held.set(a, 0);
        this.edges.add(a);
      }
    } else this.held.delete(a);
  }
  down(a: ButtonAction): boolean {
    return this.held.has(a);
  }
  engaged(a: ButtonAction): boolean {
    return this.held.has(a);
  }
  pressed(a: ButtonAction): boolean {
    return this.edges.has(a);
  }
  take(a: ButtonAction): boolean {
    return this.edges.delete(a);
  }
  heldTime(a: ButtonAction): number {
    return this.held.get(a) ?? 0;
  }
  disengage(a: ButtonAction): void {
    this.held.delete(a);
  }
  rumble(): void {}
  /** end of a sim step: edges are seen by one step only */
  endStep(dt: number): void {
    this.edges.clear();
    for (const [k, v] of this.held) this.held.set(k, v + dt);
  }
}

/** A figure with fixed action timings and sockets (no rendering). */
export class FakeVisual {
  readonly root = new THREE.Group();
  readonly height: number;
  readonly radius = 0.4;
  readonly played: string[] = [];
  frozen = 0;
  private readonly sockets = new Map<string, THREE.Object3D>();
  constructor(readonly archetype: string, height = 1.8, readonly timings: Record<string, ActionInfo> = {}) {
    this.height = height;
  }
  /** place a socket at a local offset (weak points, muzzle) */
  setSocket(name: string, x: number, y: number, z: number): void {
    const o = new THREE.Object3D();
    o.position.set(x, y, z);
    this.root.add(o);
    this.sockets.set(name, o);
  }
  socket(name: string): THREE.Object3D {
    return this.sockets.get(name) ?? this.root;
  }
  play(action: string): ActionInfo {
    this.played.push(action);
    return this.timings[action] ?? { duration: 0.5, hitTimes: [0.2], loop: false };
  }
  info(action: string): ActionInfo {
    return this.timings[action] ?? { duration: 0.5, hitTimes: [0.2], loop: false };
  }
  setFrozen(n: number): void {
    this.frozen = n;
  }
  /** stop() calls, by action name ('*' = everything) */
  readonly stopped: string[] = [];
  stop(action?: string): void {
    this.stopped.push(action ?? '*');
  }
  isPlaying(): boolean {
    return false;
  }
  setLocomotion(): void {}
  lookAt(): void {}
  setAimPitch(): void {}
  setLoadout(): void {}
  flash(): void {}
  setCorruption(): void {}
  setDissolve(): void {}
  setGlow(): void {}
  setTelegraph(): void {}
  setExposed(): void {}
  setRim(): void {}
  setVisible(): void {}
  update(): void {}
  dispose(): void {}
  asVisual(): CharacterVisual {
    return this as unknown as CharacterVisual;
  }
}

export interface TestWorld {
  game: Game;
  events: Emitter<GameEvents>;
  time: { now: number; dt: number; hitStops: number; slowMos: number };
  actors: ActorManagerImpl;
  player: PlayerControllerImpl;
  input: FakeInput;
  /** advance the simulation like Game.simulate (player → actors) in 1/60 steps */
  step(seconds: number): void;
  /** spawn a plain actor */
  dummy(desc: Partial<ActorDesc> & { x?: number; z?: number }): Actor;
}

export function makeWorld(opts: { physics?: PhysicsWorld; chars?: boolean } = {}): TestWorld {
  const events = new Emitter<GameEvents>();
  const settings = new SettingsStoreImpl(events);
  const time = {
    now: 0, dt: 0, unscaledDt: 0, scale: 1, frame: 0, hitStops: 0, slowMos: 0,
    hitStop() {
      time.hitStops++;
    },
    slowMo() {
      time.slowMos++;
    },
  };
  const input = new FakeInput();
  let seed = 12345;
  const shell: Record<string, unknown> = {
    events, settings, time,
    scene: new THREE.Scene(),
    physics: opts.physics ?? nullObject('physics'),
    input,
    camera: nullObject('camera'),
    vfx: nullObject('vfx'),
    audio: nullObject('audio'),
    ui: nullObject('ui'),
    ai: nullObject('ai'),
    chars: opts.chars === false
      ? nullObject('chars')
      : { create: (a: string) => new FakeVisual(a, a === 'selene' ? 1.68 : 1.9).asVisual(), warm() {} },
    random: () => ((seed = (seed * 16807) % 2147483647) / 2147483647),
    flags: {},
  };
  const game = shell as unknown as Game;
  const actors = new ActorManagerImpl(game);
  shell.actors = actors;
  const player = new PlayerControllerImpl(game);
  shell.player = player;
  const world: TestWorld = {
    game, events, time, actors, player, input,
    step(seconds: number) {
      const n = Math.max(1, Math.round(seconds * 60));
      for (let i = 0; i < n; i++) {
        const dt = 1 / 60;
        time.dt = dt;
        time.now += dt;
        time.frame++;
        player.update(dt);
        actors.update(dt);
        input.endStep(dt);
      }
    },
    dummy(desc) {
      return actors.spawn({
        archetype: 'linkbound', team: 'eclipse', hp: 100, poise: 30,
        pos: { x: desc.x ?? 0, y: 0, z: desc.z ?? 0 },
        ...desc,
      } as ActorDesc);
    },
  };
  return world;
}
