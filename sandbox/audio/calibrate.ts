/**
 * Calibration: iterate each id's normalisation until its measured level at the FINAL output (whole mix
 * chain, reference volume settings, a warm chain) sits on its authored target.
 *
 *  SFX / stingers  loudness (loudest 100 ms, K-weighted) → `db − 9`, with the true peak held under its
 *                  ceiling (see sfx/recipe.ts) — whichever asks for less gain wins
 *  music           RMS at the reference intensity → `db`; adaptive states are also rendered flat out and
 *                  held to `db + 2.5` RMS and to peaks of −5.5 dBFS (the level 1 sample in 10 000 exceeds;
 *                  nothing but level sets this: the score has no limiter of its own to lean on)
 *  ambience        bed RMS → `db`
 *
 * Starts from the existing tables, so `&only=music` after a score tweak converges in a pass or two and leaves
 * everything else as it was.
 */
import { SFX } from '@/audio/sfx';
import { dbToGain, loudnessTarget, peakCeiling } from '@/audio/sfx/recipe';
import { MUSIC } from '@/audio/music/defs';
import { STINGER_DB, STINGER_KINDS } from '@/audio/music/stingers';
import { AMBIENCE } from '@/audio/ambience/defs';
import { AMB_NORM, MUSIC_NORM, SFX_NORM } from '@/audio/calibration';
import type { AmbienceId, MusicState } from '@/core/api';
import { analyze } from './analyze';
import { ADAPTIVE, renderAmbience, renderMusic, renderSfx, renderStinger } from './lab';

export interface Calibration {
  sfx: Record<string, number>;
  music: Record<string, number>;
  amb: Record<string, number>;
  log: string[];
}

export interface CalibrateOpts {
  only: string[];
  ids: string[] | null;
  secs: number;
  passes: number;
  onProgress(text: string): void;
}

/**
 * full-intensity ceilings for adaptive score states. The peak ceiling is on the level one sample in ten
 * thousand exceeds (see Metrics.crestPeakDb): the absolute maximum of a render is a single chance alignment,
 * and a level set by it would move by decibels every time a patch changes.
 */
const HOT_RMS_OVER = 2.5;
const HOT_PEAK = -5.5;
const CONVERGED_DB = 0.3;

export async function calibrate(o: CalibrateOpts): Promise<Calibration> {
  const sfx: Record<string, number> = {};
  const music: Record<string, number> = {};
  const amb: Record<string, number> = {};
  const log: string[] = [];
  const want = (id: string): boolean => !o.ids || o.ids.includes(id);
  for (const id of Object.keys(SFX)) sfx[id] = SFX_NORM[id] ?? 1;
  for (const s of Object.keys(MUSIC)) music[s] = MUSIC_NORM[s] ?? 0.22;
  for (const kind of STINGER_KINDS) music[`stinger:${kind}`] = MUSIC_NORM[`stinger:${kind}`] ?? 0.2;
  for (const a of Object.keys(AMBIENCE)) amb[a] = AMB_NORM[a] ?? 12;
  const step = (k: number): number => Math.min(16, Math.max(0.0625, k));
  const done = new Set<string>();

  for (let pass = 1; pass <= o.passes; pass++) {
    let worst = 0;
    let worstId = '';
    const track = (id: string, k: number): void => {
      const errDb = 20 * Math.log10(k);
      if (Math.abs(errDb) < CONVERGED_DB) done.add(id);
      if (Math.abs(errDb) > Math.abs(worst)) { worst = errDb; worstId = id; }
    };
    const norm = { sfx, music, amb };
    /** gain that puts a cue's loudness on target without lifting its peak over the ceiling */
    const cueGain = (db: number, m: { loudDb: number; peakDb: number }): number =>
      dbToGain(Math.min(loudnessTarget(db) - m.loudDb, peakCeiling(db) - m.peakDb));

    if (o.only.includes('sfx')) for (const id of Object.keys(SFX).filter(want)) {
      if (done.has(id)) continue;
      o.onProgress(`calibrating pass ${pass}/${o.passes}: sfx ${id}`);
      const m = analyze(await renderSfx(id, { norm }, 0.6));
      if (m.peak <= 1e-5) { log.push(`! ${id} silent`); done.add(id); continue; }
      const k = cueGain(SFX[id].db, m);
      track(id, k);
      sfx[id] *= step(k);
    }
    if (o.only.includes('music')) for (const s of (Object.keys(MUSIC) as Exclude<MusicState, 'silence'>[]).filter(want)) {
      if (done.has(`music:${s}`)) continue;
      o.onProgress(`calibrating pass ${pass}/${o.passes}: music ${s}`);
      const def = MUSIC[s];
      const db = def.db ?? -20;
      const m = analyze(await renderMusic(s, o.secs, def.fixedIntensity ?? 0.6, { norm }), 1);
      if (m.rms <= 1e-6) { log.push(`! music ${s} silent`); done.add(`music:${s}`); continue; }
      let k = dbToGain(db - m.rmsDb);
      if (ADAPTIVE.includes(s)) {
        const hot = analyze(await renderMusic(s, o.secs, 1, { norm }), 1);
        const kHot = dbToGain(Math.min(db + HOT_RMS_OVER - hot.rmsDb, HOT_PEAK - hot.crestPeakDb));
        if (kHot < k) { k = kHot; if (pass === o.passes || Math.abs(20 * Math.log10(k)) < CONVERGED_DB) log.push(`music ${s}: held by its full-intensity ceiling (reference intensity sits ${(m.rmsDb + 20 * Math.log10(k) - db).toFixed(1)} dB under target)`); }
      }
      track(`music:${s}`, k);
      music[s] *= step(k);
    }
    if (o.only.includes('stinger')) for (const kind of STINGER_KINDS.filter(want)) {
      if (done.has(`stinger:${kind}`)) continue;
      o.onProgress(`calibrating pass ${pass}/${o.passes}: stinger ${kind}`);
      const m = analyze(await renderStinger(kind, norm));
      if (m.peak <= 1e-5) { log.push(`! stinger ${kind} silent`); done.add(`stinger:${kind}`); continue; }
      const k = cueGain(STINGER_DB[kind], m);
      track(`stinger:${kind}`, k);
      music[`stinger:${kind}`] *= step(k);
    }
    if (o.only.includes('ambience')) for (const a of (Object.keys(AMBIENCE) as Exclude<AmbienceId, 'none'>[]).filter(want)) {
      if (done.has(`amb:${a}`)) continue;
      o.onProgress(`calibrating pass ${pass}/${o.passes}: ambience ${a}`);
      const m = analyze(await renderAmbience(a, o.secs, norm), 1);
      if (m.rms <= 1e-6) { log.push(`! ambience ${a} silent`); done.add(`amb:${a}`); continue; }
      const k = dbToGain(AMBIENCE[a].db - m.rmsDb);
      track(`amb:${a}`, k);
      amb[a] *= step(k);
    }
    log.push(`pass ${pass}: worst correction ${worst.toFixed(2)} dB (${worstId})`);
    if (Math.abs(worst) < CONVERGED_DB) break;
  }
  return { sfx, music, amb, log };
}
