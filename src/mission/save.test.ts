import { describe, expect, it, vi } from 'vitest';
import { assignState, cloneState, createMissionState, SAVE_KEY, SaveStore, validateSaveFile, validateState } from './save';
import { MemoryStorage } from './testkit';

describe('mission state validation', () => {
  it('round-trips a state through JSON unchanged', () => {
    const s = createMissionState('hard', 'Z04', 'e2');
    s.checkpoint = 'CP2b';
    s.rescuePriority = 'EastWalkers';
    s.flags.carrierRescued = true;
    s.flags.z03Detected = 2;
    s.flags['choice:rescue'] = 'EastWalkers';
    s.optional.O2 = true;
    s.stats = { playSeconds: 812.5, deaths: 3, zoneSeconds: { Z04: 120.25 }, retries: { CP2b: 2 } };
    expect(validateState(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });

  it('rejects structurally wrong data', () => {
    const good = createMissionState();
    const bad: unknown[] = [
      null, 42, 'x', [],
      { ...good, version: 2 },
      { ...good, checkpoint: 'CP42' },
      { ...good, zone: '' },
      { ...good, difficulty: 'nightmare' },
      { ...good, rescuePriority: 'North' },
      { ...good, flags: null },
      { ...good, optional: { O1: true } },
      { ...good, stats: { ...good.stats, playSeconds: -1 } },
      { ...good, stats: { ...good.stats, deaths: Number.NaN } },
      { ...good, stats: { ...good.stats, retries: 'none' } },
    ];
    for (const b of bad) expect(validateState(b)).toBeNull();
  });

  it('drops non-primitive flags and unknown keys instead of trusting them', () => {
    const raw = { ...createMissionState(), flags: { ok: true, n: 3, s: 'x', obj: { a: 1 }, arr: [1], nan: Number.NaN }, extra: 'ignored' };
    const v = validateState(raw)!;
    expect(v.flags).toEqual({ ok: true, n: 3, s: 'x' });
    expect('extra' in v).toBe(false);
  });

  it('assignState copies deeply and keeps the target object', () => {
    const live = createMissionState();
    const snap = createMissionState('story', 'Z07', 'choice');
    snap.flags.a = 1;
    const same = assignState(live, snap);
    expect(same).toBe(live);
    expect(live).toEqual(snap);
    live.flags.a = 2;
    live.stats.retries.CP4b = 1;
    expect(snap.flags.a).toBe(1);
    expect(snap.stats.retries).toEqual({});
    expect(cloneState(live)).not.toBe(live);
  });
});

describe('SaveStore', () => {
  it('stores one snapshot per checkpoint and remembers the current one', () => {
    const storage = new MemoryStorage();
    const a = new SaveStore(storage);
    expect(a.read()).toBeNull();
    const s = createMissionState('standard', 'Z00', 'context');
    a.put('CP0', s);
    s.checkpoint = 'CP1';
    s.zone = 'Z01';
    s.flags.x = true;
    a.put('CP1', s);
    // a fresh store (page reload) sees the same file
    const file = new SaveStore(storage).read()!;
    expect(file.current).toBe('CP1');
    expect(file.snapshots.CP0!.zone).toBe('Z00');
    expect(file.snapshots.CP0!.flags.x).toBeUndefined();
    expect(file.snapshots.CP1!.flags.x).toBe(true);
  });

  it('snapshots are isolated from later changes to the live state', () => {
    const store = new SaveStore(new MemoryStorage());
    const s = createMissionState();
    store.put('CP0', s);
    s.rescuePriority = 'WestStretchers';
    expect(store.read()!.snapshots.CP0!.rescuePriority).toBe('pending');
  });

  it('discards corrupt data and removes it from storage', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const text of ['{not json', '{"v":1,"current":"CP1","snapshots":{}}', '{"v":7,"current":"CP0","snapshots":{}}', '"hello"', JSON.stringify({ v: 1, current: 'CP0', snapshots: { CP0: { version: 1 } } })]) {
      const storage = new MemoryStorage();
      storage.setItem(SAVE_KEY, text);
      const store = new SaveStore(storage);
      expect(store.read()).toBeNull();
      expect(storage.getItem(SAVE_KEY)).toBeNull();
    }
    warn.mockRestore();
  });

  it('keeps valid snapshots when another one in the file is damaged', () => {
    const good = createMissionState('standard', 'Z01', 'threshold');
    good.checkpoint = 'CP1';
    const file = validateSaveFile({ v: 1, current: 'CP1', snapshots: { CP0: { junk: true }, CP1: good, CP2: { ...good, checkpoint: 'CP3' } } })!;
    expect(Object.keys(file.snapshots)).toEqual(['CP1']);
  });

  it('still works for the session when storage is unavailable or full', () => {
    const none = new SaveStore(null);
    none.put('CP0', createMissionState());
    expect(none.read()!.current).toBe('CP0');

    const storage = new MemoryStorage();
    storage.failWrites = true;
    const full = new SaveStore(storage);
    expect(full.put('CP0', createMissionState())).toBe(false);
    expect(full.read()!.current).toBe('CP0');
    full.clear();
    expect(full.read()).toBeNull();
  });
});
