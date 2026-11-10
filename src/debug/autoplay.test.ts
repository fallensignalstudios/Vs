import { describe, expect, it, vi } from 'vitest';
import type { ButtonAction, Game, Routine, ZoneDef, ZoneRuntime } from '@/core/api';
import { createTestWorld, spawnAtStart, zoneOf } from '@/mission/testkit';
import type { TestWorld } from '@/mission/testkit';
import { AutoplayBot } from './autoplay';

/** Virtual-input recorder + an input system that reads it, the way the real one merges virtual input. */
function botWorld(zones: ZoneDef[]) {
  const virtual = {
    active: false,
    world: null as { x: number; z: number } | null,
    holds: new Set<ButtonAction>(),
    presses: new Set<ButtonAction>(),
    setMove() {},
    setMoveWorld(d: { x: number; z: number } | null) { this.world = d ? { x: d.x, z: d.z } : null; },
    addLook() {},
    press(a: ButtonAction) { this.presses.add(a); },
    hold(a: ButtonAction, down: boolean) { if (down) this.holds.add(a); else this.holds.delete(a); },
    clear() { this.world = null; this.holds.clear(); this.presses.clear(); this.active = false; },
  };
  let context = 'game';
  const input = new Proxy({
    virtual,
    get context() { return context; },
    setContext(c: string) { context = c; },
    heldTime: () => 0,
    lastHeldTime: () => 0,
    pressed: (a: ButtonAction) => virtual.presses.has(a),
    released: () => false,
    take: (a: ButtonAction) => virtual.holds.has(a) || virtual.presses.has(a),
    engaged: (a: ButtonAction) => virtual.holds.has(a),
    disengage() {},
    glyph: (a: ButtonAction) => a,
  } as Record<string, unknown>, { get: (t, p, r) => (p in t ? Reflect.get(t, p, r) : () => undefined) });
  const w = createTestWorld({ zones, overrides: { input } });
  const bot = new AutoplayBot(w.game);
  /** one frame: bot → movement from the virtual stick (unless `blocked`) → sim */
  const frames = (seconds: number, blocked = false, dt = 1 / 30): void => {
    for (let t = 0; t < seconds; t += dt) {
      bot.update(dt);
      const a = w.player.actor;
      if (a && virtual.world && !blocked && w.player.enabled) {
        const speed = virtual.holds.has('sprint') ? 7.2 : 5.2;
        a.pos.x += virtual.world.x * speed * dt;
        a.pos.z += virtual.world.z * speed * dt;
        a.yaw = Math.atan2(-virtual.world.x, -virtual.world.z);
      }
      w.tick(dt, dt);
      virtual.presses.clear();
    }
  };
  return { w, bot, virtual, frames };
}

const errands = (): ZoneDef => zoneOf('Z00', [{
  id: 'a',
  enter: spawnAtStart,
  *run(z: ZoneRuntime): Routine {
    const plate = z.interact({ id: 'plate', at: z.P(12, 0), prompt: 'Lift', hold: 1, required: true });
    z.interact({ id: 'optional', at: z.P(-30, 0), prompt: 'Read' }); // not required: the bot must ignore it
    yield z.untilInteract(plate);
    z.setFlag('lifted', true);
    z.objective('Reach the far marker', 'far');
    yield z.untilNear('far', 2);
    z.setFlag('arrived', true);
    z.objective(null);
  },
}]);

const pos = (w: TestWorld) => w.player.actor!.pos;

describe('autoplay bot', () => {
  it('walks to the required interaction, holds it through input, then follows the objective marker', async () => {
    const { w, bot, frames } = botWorld([errands()]);
    await w.mission.gotoZone('Z00');
    bot.start({});
    expect(w.game.player.godMode).toBe(true);
    frames(2);
    expect(bot.status).toContain('plate');
    frames(4);
    expect(w.mission.state.flags.lifted).toBe(true);
    expect(bot.forced).toEqual([]);
    frames(8);
    expect(w.mission.state.flags.arrived).toBe(true);
    expect(bot.teleports).toBe(0);
    expect(bot.progress).toBeGreaterThan(10);
    frames(1);
    expect(bot.status).toContain('idle');
    bot.stop();
    expect(w.game.player.godMode).toBe(false);
  });

  it('when it cannot move it nudges, then teleports as a last resort — and records it', async () => {
    const { w, bot, frames } = botWorld([errands()]);
    await w.mission.gotoZone('Z00');
    bot.start({});
    frames(6.5, true);
    expect(bot.log.some((l) => l.includes('nudging sideways'))).toBe(true);
    expect(bot.teleports).toBe(0);
    frames(6.5, true);
    expect(bot.teleports).toBe(1);
    expect(bot.log.some((l) => l.includes('TELEPORT #1'))).toBe(true);
    expect(Math.hypot(pos(w).x - 12, pos(w).z)).toBeLessThan(0.5);
  });

  it('forces an interaction only after input has failed for eight seconds, and says so', async () => {
    const zone = zoneOf('Z00', [{
      id: 'a',
      enter: spawnAtStart,
      *run(z: ZoneRuntime): Routine {
        // unreachable prompt: far smaller radius than the bot can close in on a point it is "blocked" from
        yield z.untilInteract(z.interact({ id: 'tiny', at: z.P(0.5, 0), prompt: 'Use', required: true, enabled: () => true, radius: 0.01, hold: 1 }));
        z.setFlag('done', true);
      },
    }]);
    const { w, bot, frames } = botWorld([zone]);
    await w.mission.gotoZone('Z00');
    bot.start({});
    frames(7, true);
    expect(w.mission.state.flags.done).toBeUndefined();
    frames(2, true);
    expect(w.mission.state.flags.done).toBe(true);
    expect(bot.forced).toEqual(['tiny']);
    expect(bot.log.some((l) => l.includes('FORCED interaction "tiny"'))).toBe(true);
  });

  it('answers a choice with the configured option and skips only skippable scenes', async () => {
    const zone = zoneOf('Z07', [{
      id: 'a',
      enter: spawnAtStart,
      *run(z: ZoneRuntime): Routine {
        yield* z.cinematic('skippable', function* (): Routine { yield 30; });
        z.setFlag('first', z.time);
        yield* z.cinematic('fixed', function* (): Routine { yield 3; }, { skippable: false });
        z.setFlag('second', z.time);
        const pick = yield* z.choice({ id: 'rescue', title: 't', prompt: 'p', options: [{ id: 'WestStretchers', label: 'W', detail: '' }, { id: 'EastWalkers', label: 'E', detail: '' }] });
        z.commitRescuePriority(pick as 'EastWalkers');
      },
    }]);
    const { w, bot, frames } = botWorld([zone]);
    await w.mission.gotoZone('Z07');
    bot.start({ choice: 'EastWalkers' });
    frames(5);
    expect(Number(w.mission.state.flags.first)).toBeLessThan(0.5);
    expect(Number(w.mission.state.flags.second)).toBeGreaterThan(3);
    expect(w.mission.state.rescuePriority).toBe('EastWalkers');
    expect(bot.log.some((l) => l.includes('choice "rescue" → EastWalkers'))).toBe(true);
  });

  it('answers the officer choice with its own option, also when the panel opens inside a skipped scene', async () => {
    const zone = zoneOf('Z08', [{
      id: 'phaseB',
      enter: spawnAtStart,
      *run(z: ZoneRuntime): Routine {
        yield* z.cinematic('officer', function* (): Routine {
          yield 4;
          const pick = yield* z.choice({ id: 'officerFate', title: 't', prompt: 'p', options: [{ id: 'killed', label: 'K', detail: '' }, { id: 'spared', label: 'S', detail: '' }] });
          z.setFlag('officerFate', pick);
          yield 20;
        });
        z.setFlag('done', true);
      },
    }]);
    for (const officer of ['killed', 'spared'] as const) {
      const { w, bot, frames } = botWorld([zone]);
      await w.mission.gotoZone('Z08');
      bot.start({ choice: 'EastWalkers', officer });
      frames(3);
      expect(w.mission.state.flags.officerFate).toBe(officer);
      expect(w.mission.state.flags.done).toBe(true);
    }
  });

  it('does nothing while a zone is loading or the game is not in play', async () => {
    const { w, bot, virtual, frames } = botWorld([errands()]);
    await w.mission.gotoZone('Z00');
    bot.start({});
    (w.game as { phase: Game['phase'] }).phase = 'title';
    frames(1);
    expect(virtual.world).toBeNull();
    expect(bot.status).toBe('phase title');
    const spy = vi.fn();
    w.game.events.on('interact:done', spy);
    frames(5);
    expect(spy).not.toHaveBeenCalled();
  });
});
