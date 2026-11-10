import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Routine, ZoneId, ZoneRuntime } from '@/core/api';
import { SAVE_KEY } from './save';
import { createTestWorld, idle, MemoryStorage, spawnAtStart, zoneOf } from './testkit';

const errors = (): string[] => ((globalThis as { __aurelionErrors?: string[] }).__aurelionErrors ??= []);
const quiet = () => {
  const spies = [vi.spyOn(console, 'error').mockImplementation(() => {}), vi.spyOn(console, 'warn').mockImplementation(() => {})];
  return () => spies.forEach((s) => s.mockRestore());
};

afterEach(() => {
  errors().length = 0;
});

describe('beat runner', () => {
  function world() {
    const calls: string[] = [];
    const beat = (id: string, seconds: number, checkpoint?: 'CP0' | 'CP1' | 'CP2') => ({
      id,
      checkpoint,
      enter(z: ZoneRuntime) {
        calls.push(`enter:${id}`);
        z.spawnPlayer('tarrik', 'start');
      },
      *run(): Routine {
        calls.push(`run:${id}`);
        yield seconds;
        calls.push(`end:${id}`);
      },
    });
    const w = createTestWorld({ zones: [zoneOf('Z00', [beat('a', 1, 'CP0'), beat('b', 1), beat('c', 1, 'CP1')])] });
    return { w, calls };
  }

  it('runs beats in order and calls enter only for the first beat executed', async () => {
    const { w, calls } = world();
    await w.mission.gotoZone('Z00');
    expect(w.mission.loading).toBe(false);
    expect(calls).toEqual(['enter:a']);
    w.tick(5);
    expect(calls).toEqual(['enter:a', 'run:a', 'end:a', 'run:b', 'end:b', 'run:c', 'end:c']);
    expect(w.eventsOf('zone:beat').map((e) => e.beat)).toEqual(['a', 'b', 'c']);
    expect(w.eventsOf('checkpoint:saved').map((e) => e.id)).toEqual(['CP0', 'CP1']);
    expect(w.mission.state).toMatchObject({ zone: 'Z00', beat: 'c', checkpoint: 'CP1' });
    expect(w.mission.beatLog.map((b) => b.beat)).toEqual(['a', 'b', 'c']);
  });

  it('starting at a later beat enters that beat only and skips the earlier ones', async () => {
    const { w, calls } = world();
    await w.mission.gotoZone('Z00', 'c');
    w.tick(3);
    expect(calls).toEqual(['enter:c', 'run:c', 'end:c']);
    expect(w.player.spawns).toHaveLength(1);
  });

  it('brackets a load with zone:loading / zone:ready, loading true in between, HUD on afterwards', async () => {
    const { w } = world();
    const p = w.mission.gotoZone('Z00');
    expect(w.mission.loading).toBe(true);
    w.tick(1); // ticks during loading must not run scripts
    expect(w.eventsOf('zone:beat')).toHaveLength(0);
    await p;
    expect(w.events.filter((e) => e.type === 'zone:loading' || e.type === 'zone:ready').map((e) => e.type)).toEqual(['zone:loading', 'zone:ready']);
    expect(w.ui.hud).toBe(true);
    expect(w.ui.fade).toBe(0);
    expect(w.mission.currentZone!.id).toBe('Z00');
  });

  it('accounts play time per zone and per beat in sim seconds', async () => {
    const { w } = world();
    await w.mission.gotoZone('Z00');
    w.tick(2.5);
    const s = w.mission.state.stats;
    expect(s.playSeconds).toBeCloseTo(2.5, 1);
    expect(s.zoneSeconds.Z00).toBeCloseTo(2.5, 1);
    expect(s.zoneSeconds['Z00/a']).toBeCloseTo(1, 1);
    expect(s.zoneSeconds['Z00/b']).toBeCloseTo(1, 1);
  });

  it('a throwing beat is reported and the next beat still runs; presentation is restored', async () => {
    const restore = quiet();
    const order: string[] = [];
    const w = createTestWorld({
      zones: [zoneOf('Z00', [
        { id: 'a', enter: spawnAtStart, *run(z): Routine { yield* z.fadeOut(0.2); yield 0.1; throw new Error('boom'); } },
        { id: 'b', *run(): Routine { order.push('b'); } },
      ])],
    });
    await w.mission.gotoZone('Z00');
    w.tick(1);
    restore();
    expect(order).toEqual(['b']);
    expect(errors().some((e) => e.includes('zone:Z00:a') && e.includes('boom'))).toBe(true);
    expect(w.ui.fade).toBe(0);
    expect(w.player.enabled).toBe(true);
  });

  it('a zone whose build or enter throws still goes live and never stays behind the fade', async () => {
    const restore = quiet();
    const z = zoneOf('Z00', [{ id: 'a', enter() { throw new Error('enter failed'); }, run: idle }], { build() { throw new Error('build failed'); } });
    const w = createTestWorld({ zones: [z] });
    await w.mission.gotoZone('Z00');
    restore();
    expect(w.mission.loading).toBe(false);
    expect(w.mission.currentZone!.id).toBe('Z00');
    expect(w.ui.fade).toBe(0);
    expect(w.player.spawns).toHaveLength(1); // safety net placed the lead
    expect(errors().filter((e) => e.includes('failed'))).toHaveLength(2);
  });

  it('unknown zones and beats warn and fall back instead of throwing', async () => {
    const restore = quiet();
    const { w, calls } = world();
    await w.mission.gotoZone('Z42' as ZoneId);
    expect(w.mission.currentZone).toBeNull();
    expect(w.mission.loading).toBe(false);
    await w.mission.gotoZone('Z00', 'nope');
    restore();
    expect(calls).toEqual(['enter:a']);
    expect(errors()).toEqual([]);
  });

  it('exit fades, unloads and enters the next zone at its first beat; the old zone runs no further', async () => {
    const seen: string[] = [];
    const w = createTestWorld({
      zones: [
        zoneOf('Z00', [{ id: 'a', enter: spawnAtStart, *run(z): Routine { z.onDispose(() => seen.push('disposed Z00')); yield* z.exit('Z01', { seconds: 0.2 }); seen.push('never'); } }]),
        zoneOf('Z01', [{ id: 'in', checkpoint: 'CP1', enter: spawnAtStart, *run(): Routine { seen.push('Z01 running'); } }]),
      ],
    });
    await w.mission.gotoZone('Z00');
    w.tick(0.5);
    expect(w.mission.loading).toBe(true);
    await vi.waitFor(() => expect(w.mission.loading).toBe(false));
    w.tick(0.2);
    expect(seen).toEqual(['disposed Z00', 'Z01 running']);
    expect(w.eventsOf('zone:exit')).toEqual([{ zone: 'Z00', to: 'Z01' }]);
    expect(w.mission.state).toMatchObject({ zone: 'Z01', beat: 'in', checkpoint: 'CP1' });
  });

  it('exit to an unregistered zone stays put with the screen visible', async () => {
    const restore = quiet();
    const w = createTestWorld({ zones: [zoneOf('Z00', [{ id: 'a', enter: spawnAtStart, *run(z): Routine { yield* z.exit('Z09'); z.setFlag('after', true); } }])] });
    await w.mission.gotoZone('Z00');
    w.tick(2);
    restore();
    expect(w.mission.state.flags.after).toBe(true);
    expect(w.ui.fade).toBe(0);
    expect(w.mission.currentZone!.id).toBe('Z00');
  });
});

describe('checkpoints and saves', () => {
  const zones = () => [
    zoneOf('Z00', [
      { id: 'a', checkpoint: 'CP0' as const, enter: spawnAtStart, *run(z: ZoneRuntime): Routine { yield 1; z.setFlag('aDone', true); } },
      { id: 'b', checkpoint: 'CP1' as const, enter(z: ZoneRuntime) { z.setFlag('aDone', true); z.spawnPlayer('selene', 'far'); }, *run(z: ZoneRuntime): Routine { yield 1; z.setFlag('bDone', true); yield 1000; } },
    ]),
  ];

  it('newGame resets state, clears the old save and loads the first zone', async () => {
    const storage = new MemoryStorage();
    storage.setItem(SAVE_KEY, '{"junk":true}');
    const w = createTestWorld({ storage, zones: zones() });
    w.mission.state.flags.stale = true;
    await w.mission.newGame('hard');
    expect(w.mission.state.flags.stale).toBeUndefined();
    expect(w.mission.state.difficulty).toBe('hard');
    w.tick(0.1);
    expect(w.mission.hasSave()).toBe(true);
    expect(JSON.parse(storage.getItem(SAVE_KEY)!).current).toBe('CP0');
  });

  it('reload restores the snapshot, counts the retry, keeps deaths and restores the player', async () => {
    const w = createTestWorld({ zones: zones() });
    await w.mission.newGame();
    w.tick(2.5); // into b: CP1 saved with aDone; bDone set after the save
    expect(w.mission.state.flags).toMatchObject({ aDone: true, bDone: true });
    w.game.events.emit('player:died', {});
    await w.mission.reloadCheckpoint();
    expect(w.mission.state.flags.bDone).toBeUndefined();
    expect(w.mission.state.flags.aDone).toBe(true);
    expect(w.mission.state.stats.deaths).toBe(1);
    expect(w.mission.state.stats.retries).toEqual({ CP1: 1 });
    expect(w.mission.state.stats.playSeconds).toBeGreaterThan(2);
    expect(w.mission.currentBeat).toBe('b');
    expect(w.player.protagonist).toBe('selene');
    expect(w.player.restored).toBe(1);
    // resuming at a checkpoint beat does not announce the checkpoint a second time
    w.tick(0.2);
    expect(w.eventsOf('checkpoint:saved').map((e) => e.id)).toEqual(['CP0', 'CP1']);
  });

  it('continueGame resumes a save from a previous session; without one it starts fresh and reports false', async () => {
    const storage = new MemoryStorage();
    const first = createTestWorld({ storage, zones: zones() });
    await first.mission.newGame('story');
    first.tick(1.5);
    const second = createTestWorld({ storage, zones: zones() });
    expect(second.mission.hasSave()).toBe(true);
    expect(await second.mission.continueGame()).toBe(true);
    expect(second.mission.state).toMatchObject({ zone: 'Z00', beat: 'b', checkpoint: 'CP1', difficulty: 'story' });
    expect(second.mission.state.flags.aDone).toBe(true);

    const empty = createTestWorld({ zones: zones() });
    expect(empty.mission.hasSave()).toBe(false);
    expect(await empty.mission.continueGame()).toBe(false);
    expect(empty.mission.currentBeat).toBe('a');
  });

  it('a corrupt save is not a save', () => {
    const restore = quiet();
    const storage = new MemoryStorage();
    storage.setItem(SAVE_KEY, '{"v":1,"current":"CP3","snapshots":{"CP3":{"version":1,"zone":17}}}');
    const w = createTestWorld({ storage, zones: zones() });
    expect(w.mission.hasSave()).toBe(false);
    expect(storage.getItem(SAVE_KEY)).toBeNull();
    restore();
  });

  it('loadCheckpoint of an id never saved starts its beat from the table', async () => {
    const w = createTestWorld({ zones: zones() });
    await w.mission.loadCheckpoint('CP1');
    expect(w.mission.currentBeat).toBe('b');
    expect(w.mission.state.checkpoint).toBe('CP1');
    expect(w.mission.checkpoints.map((c) => c.id)).toEqual(['CP0', 'CP1', 'CP9']);
  });

  it('completeMission sets departed, saves CP9 and emits mission:complete once', async () => {
    const w = createTestWorld({ zones: [zoneOf('Z12', [{ id: 'departure', enter: spawnAtStart, *run(z): Routine { yield* z.completeMission(); } }])] });
    await w.mission.gotoZone('Z12');
    w.tick(3);
    expect(w.mission.state.flags.departed).toBe(true);
    expect(w.mission.state.checkpoint).toBe('CP9');
    expect(w.eventsOf('mission:complete')).toHaveLength(1);
    expect(w.eventsOf('checkpoint:saved').map((e) => e.id)).toEqual(['CP9']);
  });
});

describe('zone loading extras', () => {
  it('preloads the zone cast plus both leads and the common companions before the zone goes live', async () => {
    const seen: string[][] = [];
    const order: string[] = [];
    const chars = { preload: async (list: string[]) => { seen.push(list); await Promise.resolve(); order.push('preloaded'); }, warm() {}, create() { return null; } };
    const z = zoneOf('Z06', [{ id: 'a', enter(rt: ZoneRuntime) { order.push('enter'); spawnAtStart(rt); }, run: idle }], { cast: ['linkbound', 'weaver', 'tarrik'] });
    const w = createTestWorld({ zones: [z], overrides: { chars } });
    await w.mission.gotoZone('Z06');
    expect(order).toEqual(['preloaded', 'enter']);
    expect(seen).toHaveLength(1);
    expect([...seen[0]].sort()).toEqual(['linkbound', 'lyessa', 'lyric', 'selene', 'tarrik', 'tharne', 'weaver']);
  });

  it('queued loads run one after another and loading stays true until the last one is live', async () => {
    const built: string[] = [];
    const mk = (id: string) => zoneOf(id, [{ id: 'a', enter: spawnAtStart, run: idle }], { async build(b) { built.push(`${id}:start`); await new Promise((r) => setTimeout(r, 5)); b.finalize(); built.push(`${id}:end`); } });
    const w = createTestWorld({ zones: [mk('Z00'), mk('Z01')] });
    const first = w.mission.gotoZone('Z00');
    const second = w.mission.gotoZone('Z01');
    await first;
    expect(w.mission.loading).toBe(true);
    await second;
    expect(w.mission.loading).toBe(false);
    expect(built).toEqual(['Z00:start', 'Z00:end', 'Z01:start', 'Z01:end']);
    expect(w.mission.currentZone!.id).toBe('Z01');
  });
});
