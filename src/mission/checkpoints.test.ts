import { describe, expect, it } from 'vitest';
import type { ZoneDef, ZoneId } from '@/core/api';
import { deriveCheckpoints, firstZone, orderedZones } from './checkpoints';
import { resumeBeatIndex } from './system';
import { idle, zoneOf } from './testkit';

const map = (...zones: ZoneDef[]): Map<ZoneId, ZoneDef> => new Map(zones.map((z) => [z.id, z]));

describe('checkpoint table', () => {
  const z01 = zoneOf('Z01', [{ id: 'threshold', checkpoint: 'CP1', run: idle }, { id: 'e1', run: idle }, { id: 'clear', run: idle }]);
  const z00 = zoneOf('Z00', [{ id: 'context', checkpoint: 'CP0', run: idle }, { id: 'landing', run: idle }]);
  const z07 = zoneOf('Z07', [{ id: 'cages', checkpoint: 'CP4b', run: idle }, { id: 'bridge', run: idle }, { id: 'choice', checkpoint: 'CP4b', run: idle }]);

  it('lists declared checkpoints in mission order regardless of registration order', () => {
    const table = deriveCheckpoints(map(z07, z01, z00));
    expect(table.map((c) => `${c.id}:${c.zone}/${c.beat}`)).toEqual(['CP0:Z00/context', 'CP1:Z01/threshold', 'CP4b:Z07/cages', 'CP9:Z07/choice']);
  });

  it('first declaration of an id wins; CP9 falls back to the last beat of the last zone', () => {
    const table = deriveCheckpoints(map(z07));
    expect(table.find((c) => c.id === 'CP4b')!.beat).toBe('cages');
    expect(table.find((c) => c.id === 'CP9')).toMatchObject({ zone: 'Z07', beat: 'choice' });
    const withCp9 = zoneOf('Z12', [{ id: 'concourse', run: idle }, { id: 'departure', checkpoint: 'CP9', run: idle }, { id: 'credits', run: idle }]);
    expect(deriveCheckpoints(map(z07, withCp9)).find((c) => c.id === 'CP9')).toMatchObject({ zone: 'Z12', beat: 'departure' });
  });

  it('is empty without zones', () => {
    expect(deriveCheckpoints(new Map())).toEqual([]);
    expect(firstZone(new Map())).toBeNull();
  });

  it('orders unknown zone ids after the mission zones, in registration order', () => {
    const t2 = zoneOf('T02', [{ id: 'a', run: idle }]);
    const t1 = zoneOf('T01', [{ id: 'a', run: idle }]);
    expect(orderedZones(map(t2, z01, t1, z00)).map((z) => z.id)).toEqual(['Z00', 'Z01', 'T02', 'T01']);
    expect(firstZone(map(t2, t1))!.id).toBe('T02');
  });

  it('a snapshot resumes at its beat, or the nearest earlier beat that can rebuild the world', () => {
    const beats = [{ id: 'a', enter() {}, run: idle }, { id: 'b', run: idle }, { id: 'c', enter() {}, run: idle }, { id: 'd', run: idle }];
    expect(resumeBeatIndex(beats, 'a')).toBe(0);
    expect(resumeBeatIndex(beats, 'b')).toBe(0);
    expect(resumeBeatIndex(beats, 'c')).toBe(2);
    expect(resumeBeatIndex(beats, 'd')).toBe(2);
    expect(resumeBeatIndex(beats, 'nope')).toBe(0);
  });
});
