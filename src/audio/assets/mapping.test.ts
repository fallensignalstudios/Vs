/** The state → recording table and the loop arithmetic, checked against the real music manifest. */
import { describe, expect, it } from 'vitest';
import API from '../../core/api/audio.ts?raw';
import MANIFEST_JSON from '../../../public/audio/music/manifest.json?raw';
import type { MusicState } from '@/core/api';
import { MUSIC } from '../music/defs';
import {
  LOOP_XFADE, SCORE_PLAN, TRACKS, TRACK_NAMES, layerMatches, loopPeriod, loopSpec, overlayDef, planGain, planTone, scorePlan,
  type TrackMeta, type TrackName,
} from './mapping';

const MANIFEST = JSON.parse(MANIFEST_JSON) as Record<TrackName, TrackMeta>;

const STATES = ((): MusicState[] => {
  const m = /export type MusicState =([\s\S]*?);\n/.exec(API);
  if (!m) throw new Error('MusicState not found');
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1] as MusicState);
})();

describe('state → track mapping', () => {
  it('scores every MusicState, and only existing tracks', () => {
    expect(Object.keys(SCORE_PLAN).sort()).toEqual([...STATES].sort());
    for (const s of STATES) {
      const p = scorePlan(s);
      if (p.track) expect(TRACK_NAMES).toContain(p.track);
      if (p.warm) expect(TRACK_NAMES).toContain(p.warm);
      expect(p.tone[0]).toBeGreaterThan(100);
      expect(p.tone[1]).toBeGreaterThanOrEqual(p.tone[0]);
      expect(p.gain[1]).toBeGreaterThanOrEqual(p.gain[0]);
      if (p.track) expect(p.gain[1]).toBeLessThanOrEqual(-16);
    }
    expect(scorePlan('nonsense' as MusicState)).toBe(SCORE_PLAN.silence);
  });

  it('is the table the task specifies', () => {
    const by = (t: TrackName | null): string[] => STATES.filter((s) => SCORE_PLAN[s].track === t).sort();
    expect(by('main_theme')).toEqual(['credits', 'departure', 'title']);
    expect(by('dominion_combat')).toEqual(['combatTarrik']);
    expect(by('frozen_stealth')).toEqual(['approachSelene', 'stealth']);
    expect(by('relay_combat')).toEqual(['combatSelene']);
    expect(by('atrium_carrier')).toEqual(['atrium', 'carrier', 'duel']);
    expect(by('eclipse_combat')).toEqual(['combatEclipse', 'elite', 'resonance']);
    expect(by('core_witness')).toEqual(['consequence', 'core', 'observation', 'recognition', 'witness']);
    expect(by(null)).toEqual(['approachTarrik', 'breach', 'context', 'decision', 'quarantine', 'silence']);
  });

  it('gives atrium_carrier its dynamics through the states: duel quieter, carrier louder', () => {
    expect(SCORE_PLAN.duel.gain[1]).toBeLessThan(SCORE_PLAN.atrium.gain[1]);
    expect(SCORE_PLAN.carrier.gain[0]).toBeGreaterThan(SCORE_PLAN.atrium.gain[1] + 2);
    expect(SCORE_PLAN.atrium.region).toBe('stillness');
    expect(SCORE_PLAN.carrier.region).toBe('swell');
  });

  it('selects generative layers that really exist in the state they are for', () => {
    for (const s of STATES) {
      const p = SCORE_PLAN[s];
      if (!p.track) {
        expect(p.generativeLayers).toEqual([]);
        continue;
      }
      const def = MUSIC[s as keyof typeof MUSIC];
      for (const sel of p.generativeLayers) expect(def.layers.some((l) => layerMatches(l, sel)), `${s}: ${sel}`).toBe(true);
      const over = overlayDef(def, p.generativeLayers);
      if (!p.generativeLayers.length) expect(over).toBeNull();
      else {
        expect(over!.layers.length).toBeGreaterThan(0);
        expect(over!.layers.length).toBeLessThan(def.layers.length);
        // nothing struck on the beat is ever laid over a recording (their beats are not on a grid)
        expect(over!.layers.filter((l) => l.kind === 'perc' || l.kind === 'cadence' || l.kind === 'strings')).toEqual([]);
        expect(over!.bpm).toBe(def.bpm);
      }
    }
    expect(overlayDef(MUSIC.core, ['motif:bell:resolved'])!.layers.every((l) => l.when === 'resolved')).toBe(true);
  });

  it('opens level and tone with intensity', () => {
    const p = SCORE_PLAN.combatTarrik;
    const loop = loopSpec('dominion_combat', MANIFEST.dominion_combat);
    expect(planGain(p, loop, 1)).toBeGreaterThan(planGain(p, loop, 0) * 1.5);
    expect(20 * Math.log10(planGain(p, loop, 1))).toBeCloseTo(p.gain[1] - MANIFEST.dominion_combat.meanDb, 5);
    expect(planTone(p, 0)).toBeCloseTo(3200, 5);
    expect(planTone(p, 1)).toBeCloseTo(20000, 5);
    expect(planTone(p, 0.5)).toBeCloseTo(Math.sqrt(3200 * 20000), 3);
    expect(planGain(p, loop, Number.NaN)).toBe(planGain(p, loop, 0));
    // every recording stays under the limiter at full intensity (file peak × gain ≤ −2.5 dBFS)
    for (const s of STATES) {
      const q = SCORE_PLAN[s];
      if (!q.track || q.region !== 'whole') continue;
      const m = MANIFEST[q.track];
      expect(m.maxDb + 20 * Math.log10(planGain(q, loopSpec(q.track, m), 1)), s).toBeLessThanOrEqual(-2.5);
    }
  });
});

describe('loop arithmetic (against the real manifest)', () => {
  it('lists every track the table uses', () => {
    for (const t of TRACK_NAMES) expect(MANIFEST[t], t).toBeDefined();
  });

  it('loops each whole track over a whole number of bars with a 2 s tail', () => {
    for (const t of TRACK_NAMES) {
      const m = MANIFEST[t];
      const l = loopSpec(t, m);
      expect(l.xfade).toBe(LOOP_XFADE);
      expect(l.to + l.xfade).toBeCloseTo(m.seconds, 9);
      const bars = (l.to - l.from) / (240 / m.bpm);
      expect(Math.abs(bars - Math.round(bars)), `${t}: ${bars} bars`).toBeLessThan(0.01);
      expect(Math.round(bars)).toBe(m.loopBars);
      expect(loopPeriod(l)).toBeCloseTo((m.seconds - 2) / Math.pow(2, TRACKS[t].tune / 12), 9);
    }
  });

  it('loops the regions of atrium_carrier inside the file, on bar lines, clear of the next section', () => {
    const m = MANIFEST.atrium_carrier;
    const bar = 240 / m.bpm;
    const still = loopSpec('atrium_carrier', m, 'stillness');
    const swell = loopSpec('atrium_carrier', m, 'swell');
    for (const l of [still, swell]) {
      expect((l.to - l.from) / bar).toBeCloseTo(Math.round((l.to - l.from) / bar), 6);
      expect(l.intro).toBe(l.from);
      expect(l.to + l.xfade).toBeLessThanOrEqual(m.seconds);
    }
    expect(still.to + still.xfade).toBeLessThan(36); // the swell starts at ~36 s
    expect(swell.from).toBeGreaterThanOrEqual(36);
    expect(swell.to + swell.xfade).toBeLessThan(76); // the decay starts at ~76 s
    // a region a track does not have means the whole track
    expect(loopSpec('main_theme', MANIFEST.main_theme, 'swell')).toEqual(loopSpec('main_theme', MANIFEST.main_theme));
  });

  it('starts a combat track past its introduction when the state is entered hot — once', () => {
    for (const t of ['dominion_combat', 'relay_combat'] as const) {
      const m = MANIFEST[t];
      const cold = loopSpec(t, m);
      const hot = loopSpec(t, m, 'whole', true);
      expect(cold.intro).toBe(0);
      expect(hot.intro).toBe(TRACKS[t].body);
      expect(hot.intro / (240 / m.bpm)).toBeCloseTo(Math.round(hot.intro / (240 / m.bpm)), 6); // on a bar line
      expect({ ...hot, intro: 0 }).toEqual(cold); // the loop itself is unchanged
    }
    expect(loopSpec('main_theme', MANIFEST.main_theme, 'whole', true).intro).toBe(0);
    expect(loopSpec('atrium_carrier', MANIFEST.atrium_carrier, 'swell', true).intro).toBe(loopSpec('atrium_carrier', MANIFEST.atrium_carrier, 'swell').from);
  });

  it('survives degenerate metadata', () => {
    const l = loopSpec('main_theme', { file: 'x', seconds: 1, bpm: 0, loopStart: 5, meanDb: Number.NaN, maxDb: 0 });
    expect(l.xfade).toBeCloseTo(0.25, 9);
    expect(l.to).toBeGreaterThan(l.from);
    expect(Number.isFinite(l.meanDb)).toBe(true);
    const z = loopSpec('main_theme', { file: 'x', seconds: Number.NaN, bpm: 0, loopStart: 0, meanDb: -16, maxDb: 0 });
    expect(z.to - z.from).toBe(0); // the director refuses to play this
  });
});
