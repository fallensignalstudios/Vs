import { describe, expect, it } from 'vitest';
import type { MissionState } from './api';
import { buildMissionSummary } from './summary';

function state(over: Partial<MissionState> = {}): MissionState {
  return {
    version: 1, checkpoint: 'CP9', zone: 'Z12', beat: 'departure', difficulty: 'standard', rescuePriority: 'pending',
    flags: {}, optional: { O1: false, O2: false, O3: false, O4: false },
    stats: { playSeconds: 0, deaths: 0, zoneSeconds: {}, retries: {} },
    ...over,
  };
}
const row = (s: MissionState, label: string): string | undefined => buildMissionSummary(s).lines.find((l) => l.label === label)?.value;

describe('mission summary', () => {
  it('always opens with the book\'s four states', () => {
    const lines = buildMissionSummary(state()).lines.slice(0, 4).map((l) => `${l.label}: ${l.value}`.toUpperCase());
    expect(lines).toEqual([
      'BOUNDARY STATE: CLOSED', 'SOVEREIGN MERIDIAN: COMPLETE', 'RELEASE COMMAND: WITHHELD',
      'TERMINAL RELEASE: REQUIRES CONTRARY BEARER CONCURRENCE',
    ]);
  });

  it('records the carrier as lost with all hands only when the story flag is set', () => {
    expect(row(state(), 'Reformation carrier')).toBeUndefined();
    expect(row(state({ flags: { carrierLost: true } }), 'Reformation carrier')).toBe('Lost with all hands');
  });

  it('records the officer from the officerFate flag, in neutral words', () => {
    expect(row(state(), 'The officer')).toBeUndefined();
    expect(row(state({ flags: { officerFate: 'killed' } }), 'The officer')).toBe('Killed at his request');
    expect(row(state({ flags: { officerFate: 'spared' } }), 'The officer')).toBe('Spared — fate unknown');
  });

  it('records the local priority and the fixed exchanges', () => {
    expect(row(state({ rescuePriority: 'WestStretchers' }), 'Local priority')).toBe('West — stretcher cases first');
    expect(row(state({ rescuePriority: 'EastWalkers' }), 'Local priority')).toBe('East — walking wounded first');
    const s = state({ flags: { evidenceExchanged: true, pactAgreed: true } });
    expect(row(s, 'Evidence')).toBe('Exchanged');
    expect(row(s, 'Pact')).toBe('Agreed');
  });

  it('never calls the outcome a victory, a rescue or safe', () => {
    const s = state({ rescuePriority: 'EastWalkers', flags: { carrierLost: true, officerFate: 'spared', evidenceExchanged: true, pactAgreed: true } });
    const text = buildMissionSummary(s).lines.map((l) => `${l.label} ${l.value}`).join(' ').toLowerCase();
    for (const word of ['victory', 'rescued', 'saved', 'diverted', 'safe', 'survivor', 'score']) expect(text).not.toContain(word);
  });

  it('formats the mission time', () => {
    expect(row(state({ stats: { playSeconds: 3725, deaths: 0, zoneSeconds: {}, retries: {} } }), 'Mission time')).toBe('62:05');
  });
});
