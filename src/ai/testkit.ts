/** Test support: the combat test world plus the real physics world and the real AI system. Not shipped. */
import type { Actor, AiSystem, GameEvents, PhysicsWorld } from '@/core/api';
import { makeWorld, type TestWorld } from '@/combat/testkit';
import { createPhysicsWorld } from '@/world/physics';
import { createAiSystem } from './index';

export interface AiTestWorld extends TestWorld {
  ai: AiSystem;
  physics: PhysicsWorld;
  /** advance like Game.tick: player → ai → actors, in 1/60 steps */
  run(seconds: number): void;
  /** events seen so far, by type */
  seen: Partial<{ [K in keyof GameEvents]: GameEvents[K][] }>;
  /** a 60 × 60 m floor centred on the origin, walled in */
  arena(): void;
  /** put the protagonist in the world (god mode on by default so long runs do not end in a death) */
  hero(id?: 'tarrik' | 'selene', x?: number, z?: number, god?: boolean): Actor;
}

export function makeAiWorld(): AiTestWorld {
  const physics = createPhysicsWorld(null);
  const w = makeWorld({ physics }) as AiTestWorld;
  const ai = createAiSystem(w.game);
  (w.game as unknown as { ai: AiSystem }).ai = ai;
  w.ai = ai;
  w.physics = physics;
  w.seen = {};
  const record = <K extends keyof GameEvents>(type: K): void => {
    w.events.on(type, (p) => {
      ((w.seen[type] ??= [] as never) as GameEvents[K][]).push(p);
    });
  };
  for (const t of [
    'encounter:started', 'encounter:wave', 'encounter:cleared', 'link:created', 'link:severed', 'device:disabled',
    'scan:detected', 'actor:hit', 'actor:died', 'caption', 'player:echo',
  ] as const) record(t);
  w.run = (seconds: number) => {
    const n = Math.max(1, Math.round(seconds * 60));
    for (let i = 0; i < n; i++) {
      const dt = 1 / 60;
      w.time.dt = dt;
      w.time.now += dt;
      (w.time as unknown as { frame: number }).frame++;
      w.player.update(dt);
      ai.update(dt);
      w.actors.update(dt);
      w.input.endStep(dt);
    }
  };
  w.arena = () => {
    physics.addSurface({ shape: { kind: 'rect', hx: 30, hz: 30 }, x: 0, z: 0, y: 0, tag: 'floor' });
    const wall = (x: number, z: number, hx: number, hz: number) =>
      physics.addCollider({ shape: { kind: 'box', hx, hy: 5, hz }, x, y: 5, z, tag: 'wall' });
    wall(0, -30.5, 31, 0.5);
    wall(0, 30.5, 31, 0.5);
    wall(-30.5, 0, 0.5, 31);
    wall(30.5, 0, 0.5, 31);
    physics.nav.rebuild();
  };
  w.hero = (id = 'tarrik', x = 0, z = 0, god = true) => {
    w.player.setProtagonist(id, { pos: { x, y: 0, z }, yaw: 0 });
    w.player.godMode = god;
    return w.player.actor;
  };
  return w;
}
