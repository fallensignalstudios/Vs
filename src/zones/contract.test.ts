/**
 * The fixed cross-zone contract (tasks/ZONES.md): every zone keeps its id, beat ids, checkpoints and an `enter`
 * on every beat a save or a debug jump can land on. Zone authors: this must stay green when you replace a stub.
 */
import { describe, expect, it } from 'vitest';
import type { ZoneDef } from '@/core/api';
import z00 from './z00';
import z01 from './z01';
import z02 from './z02';
import z03 from './z03';
import z04 from './z04';
import z05 from './z05';
import z06 from './z06';
import z07 from './z07';
import z08 from './z08';
import z09 from './z09';
import z10 from './z10';
import z11 from './z11';
import z12 from './z12';

/** beat ids in order; `@CPn` marks the beat that saves that checkpoint (ZONES.md cast table) */
const CONTRACT: Record<string, string[]> = {
  Z00: ['context@CP0', 'landing'],
  Z01: ['threshold@CP1', 'e1', 'clear'],
  Z02: ['stabilize', 'bend', 'cut'],
  Z03: ['arrival@CP2', 'scan', 'terminalRead'],
  Z04: ['overlook@CP2b', 'e2', 'release'],
  Z05: ['meeting@CP3', 'carrier', 'aftermath'],
  Z06: ['breach@CP4', 'rescue', 'grounding'],
  Z07: ['cages', 'bridge', 'choice@CP4b'],
  Z08: ['phaseA@CP5', 'phaseB@CP5b', 'quarantine'],
  Z09: ['descent@CP6', 'overlook', 'recognition'],
  Z10: ['diagnostic', 'assentTarrik', 'assentSelene', 'witness', 'consequence', 'after@CP7'],
  Z11: ['reunion', 'conversation@CP8', 'linger'],
  Z12: ['concourse', 'farewell', 'departure'],
};

const ZONES: ZoneDef[] = [z00, z01, z02, z03, z04, z05, z06, z07, z08, z09, z10, z11, z12];

describe('zone contract', () => {
  it('registers the thirteen zones in mission order', () => {
    expect(ZONES.map((z) => z.id)).toEqual(Object.keys(CONTRACT));
  });

  for (const zone of ZONES) {
    it(`${zone.id}: beats and checkpoints match ZONES.md; every first / checkpoint beat can be entered`, () => {
      const got = zone.beats.map((b) => (b.checkpoint ? `${b.id}@${b.checkpoint}` : b.id));
      expect(got).toEqual(CONTRACT[zone.id]);
      zone.beats.forEach((b, i) => {
        if (i === 0 || b.checkpoint) expect(typeof b.enter, `${zone.id}/${b.id} needs enter()`).toBe('function');
      });
      expect(zone.title.length).toBeGreaterThan(0);
      expect(typeof zone.build).toBe('function');
    });
  }
});
