/**
 * What gets pre-rendered when audio starts, and the per-sample-rate cache of the result:
 *  - every SFX recipe marked `bake` (frequent one-shots) and every `exact` one (the Eclipse voices);
 *  - every percussion stroke the score can play: instrument × tuning × three velocity tiers;
 *  - the ensemble loops (pads, strings, brass) for the registers the score actually uses.
 * One render per sample rate serves the live context and every offline measurement render.
 */
import { bake, canBake, type BakeJob } from './synth/bake';
import { bakeWaves, waveKey, waveOctave, type EnsembleName, type WaveBank } from './synth/waves';
import { SFX } from './sfx';
import { MUSIC } from './music/defs';
import { PERC_TIERS, PERC_TUNE, hit, percSampleId } from './music/instruments';
import { rootAndPartner } from './music/layers';
import { mtof, openVoicing, voicing } from './music/theory';
import type { PercInst } from './music/types';

/** Stinger percussion (music/stingers.ts) — tunings that no state definition uses. */
const STINGER_PERC: ReadonlyArray<readonly [PercInst, number]> = [
  ['odaiko', 46], ['odaiko', 49], ['odaiko', 36.7], ['taiko', 73.4], ['boom', 36.7], ['boom', 34], ['rim', 0], ['kick', 0],
];

function sfxJobs(): BakeJob[] {
  const jobs: BakeJob[] = [];
  for (const [id, r] of Object.entries(SFX)) {
    if (r.loop || r.bake <= 0) continue;
    jobs.push({ id, variants: r.bake, exact: r.exact, build: r.make });
  }
  return jobs;
}

function percJobs(): BakeJob[] {
  const seen = new Set<string>();
  const jobs: BakeJob[] = [];
  const add = (inst: PercInst, tune: number): void => {
    const f = tune || PERC_TUNE[inst];
    PERC_TIERS.forEach((vel, tier) => {
      const id = percSampleId(inst, f, tier);
      if (seen.has(id)) return;
      seen.add(id);
      jobs.push({ id, variants: 1, build: (k) => hit(inst, k, 0, vel, f) });
    });
  };
  for (const def of Object.values(MUSIC)) {
    for (const l of def.layers) {
      if (l.kind === 'perc') add(l.inst, l.tune ?? 0);
      if (l.kind === 'strings' && l.gate?.length) add('bow', 0);
    }
  }
  for (const [inst, tune] of STINGER_PERC) add(inst, tune);
  return jobs;
}

/** Every `ensemble@octave` loop the score definitions can ask for. */
export function waveNeeds(): Set<string> {
  const keys = new Set<string>();
  const need = (name: EnsembleName, hz: number): void => void keys.add(waveKey(name, waveOctave(hz)));
  for (const def of Object.values(MUSIC)) {
    const chords = [...def.chords, ...(def.resolved ?? [])];
    for (const l of def.layers) {
      if (l.kind === 'pad' && (l.voice === 'warm' || l.voice === 'glass' || l.voice === 'choir' || l.voice === 'wrong')) {
        for (const c of chords) for (const m of voicing(def.tonic, c, l.low, l.n)) need(l.voice, mtof(m));
      } else if (l.kind === 'strings') {
        for (const c of chords) for (const m of openVoicing(def.tonic, c, l.low, l.n)) need('strings', mtof(m));
      } else if (l.kind === 'brass') {
        for (const c of chords) {
          const [f1, f2] = rootAndPartner(def.tonic, c, l.low);
          need('brass', f1);
          need('brass', f2);
          need('brass', f1 * 2);
        }
      } else if (l.kind === 'motif' && l.voice === 'horn') {
        for (const phrase of l.phrases) for (const note of phrase) need('horn', mtof(l.base + note[1]));
      }
    }
  }
  return keys;
}

export interface Prerendered {
  /** sample-bank id → variants */
  samples: Map<string, AudioBuffer[]>;
}

const cache = new Map<number, Promise<Prerendered>>();

/**
 * Pre-render everything for a sample rate (once; later calls share the same promise). Ensemble loops are
 * written straight into `waves` (the per-rate shared bank). Never rejects.
 */
export function prerender(sampleRate: number, waves: WaveBank): Promise<Prerendered> {
  let p = cache.get(sampleRate);
  if (!p) {
    p = (async (): Promise<Prerendered> => {
      if (!canBake()) return { samples: new Map() };
      // percussion first: the score is usually the first thing heard
      const samples = await bake(sampleRate, [...percJobs(), ...sfxJobs()]);
      await bakeWaves(sampleRate, waveNeeds(), waves);
      return { samples };
    })().catch((err) => {
      console.warn('[audio] pre-render failed — everything stays live-synthesised:', err);
      return { samples: new Map<string, AudioBuffer[]>() };
    });
    cache.set(sampleRate, p);
  }
  return p;
}
