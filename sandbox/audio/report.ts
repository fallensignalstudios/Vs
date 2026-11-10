/**
 * The measurement report ("verification without ears"). Every row is a render of the real engine with the
 * numbers that matter for it and a list of flags; a clean report has no flags.
 *
 *  chain     the dynamics transfer curve and each compressor's make-up gain
 *  sfx       every one-shot, warm: loudness against its authored level, true peak against its ceiling,
 *            and the same cue on a cold chain (must agree)
 *  loop      sustaining ids: start, hold, stop
 *  music     every state at its reference intensity; adaptive states also at 0 and 1; combat states are
 *            held to a punch, brightness, compression and wet/dry standard
 *  ambience  every bed, and 24 s with its random events
 *  stinger   the eight stingers
 *  scene     scripted behaviour (cross-fade entrance, sever, resolution, stress, a full fight)
 *  mix       the things a player can break: sliders reach silence, ducks reach their depth, muffle and
 *            pause leave the score alone
 *  perf      live source nodes and node churn of the score and of a whole encounter; a main-thread stall
 *  exact     the Eclipse cues are the same sound every time
 */
import { SFX } from '@/audio/sfx';
import { dbToGain, loudnessTarget, peakCeiling } from '@/audio/sfx/recipe';
import { MUSIC } from '@/audio/music/defs';
import { STINGER_DB, STINGER_KINDS } from '@/audio/music/stingers';
import { AMBIENCE } from '@/audio/ambience/defs';
import { AMB_NORM, MUSIC_NORM, SFX_NORM } from '@/audio/calibration';
import { DYNAMICS, Mixer, REFERENCE_VOLUMES, type Volumes } from '@/audio/mixer';
import { makeShared } from '@/audio/synth/shared';
import type { AudioEngine } from '@/audio/engine';
import type { AmbienceId, MusicState } from '@/core/api';
import { analyze, type Metrics } from './analyze';
import { loopSeam } from '@/audio/synth/bake';
import { Probe, WARM, cut, prepared, render, renderFull, renderGraph, type RenderOpts } from './render';
import { ADAPTIVE, COMBAT, LOOP_IDS, SCENES, renderAmbience, renderLoop, renderMusic, renderMusicFull, renderScene, renderSfx, renderStinger, musicOpts, sfxLength } from './lab';

export type Kind = 'chain' | 'sfx' | 'loop' | 'music' | 'ambience' | 'stinger' | 'scene' | 'mix' | 'perf' | 'exact';

export interface Row extends Metrics {
  kind: Kind;
  id: string;
  /** authored level (see recipe.ts for SFX; RMS dB for beds) */
  targetDb: number | null;
  /** what was measured beyond the standard columns */
  note: string;
  flags: string[];
}

const EMPTY: Metrics = {
  peak: 0, peakDb: -180, rms: 0, rmsDb: -180, crestPeakDb: -180, loudDb: -180, punchDb: 0, durationMs: 0, spectralCentroidHz: 0,
  bands: [0, 0, 0, 0, 0], dc: 0, stereo: 1, silent: true, clipped: false, nan: false,
};

const f1 = (v: number): string => (Math.round(v * 10) / 10).toFixed(1);
const signed = (v: number): string => `${v > 0 ? '+' : ''}${f1(v)}`;

/** RMS (dB) of a slice of a buffer. */
function sliceDb(buf: AudioBuffer, from: number, to: number): number {
  return analyze(buf, Math.max(0, from), Math.min(buf.duration, to)).rmsDb;
}

function peakDbOf(buf: AudioBuffer, from = 0, to = buf.duration): number {
  let p = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    const end = Math.min(d.length, Math.floor(to * buf.sampleRate));
    for (let i = Math.max(0, Math.floor(from * buf.sampleRate)); i < end; i++) {
      const a = d[i] < 0 ? -d[i] : d[i];
      if (a > p) p = a;
    }
  }
  return p > 1e-9 ? 20 * Math.log10(p) : -180;
}

function baseFlags(row: Row, buf: AudioBuffer): void {
  const f = row.flags;
  const peaky = row.kind === 'sfx' || row.kind === 'stinger';
  if (row.nan) f.push('NaN');
  if (row.silent) f.push('SILENT');
  if (row.clipped) f.push('CLIP');
  if (Math.abs(row.dc) > 0.02 && Math.abs(row.dc) > 0.25 * row.rms) f.push('DC');
  // a one-shot must be dying away by the end of its render (dry length + 2.6 s of room)
  if (peaky && sliceDb(buf, buf.duration - 0.25, buf.duration) > row.peakDb - 38) f.push('LONG');
  if (row.kind === 'sfx' && buf.duration >= 13.9) f.push('LONG');
}

/** Loudness-calibrated cues: on target unless their peak is at its ceiling. */
function levelFlags(row: Row, db: number): void {
  const ceiling = peakCeiling(db);
  const capped = row.peakDb >= ceiling - 0.7;
  const err = row.loudDb - loudnessTarget(db);
  if (row.peakDb > ceiling + 1) row.flags.push(`PEAK${signed(row.peakDb - ceiling)}`);
  if (Math.abs(err) > 1.5 && !(capped && err < 0)) row.flags.push(`LEVEL${signed(err)}`);
  row.note = `loud ${f1(row.loudDb)} (target ${f1(loudnessTarget(db))})${capped ? ' · peak-capped' : ''}`;
}

export interface ReportOpts {
  only: string[];
  ids: string[] | null;
  secs: number;
  cold: boolean;
  onProgress(text: string): void;
  keep(key: string, buf: AudioBuffer): void;
}

// ---------------------------------------------------------------------------------------------------------

/** 1 kHz sine through the bare mix chain at several input levels: reveals the dynamics transfer curve. */
async function chainRows(): Promise<Row[]> {
  const rows: Row[] = [];
  for (const inDb of [-40, -24, -18, -12, -9, -6, -3, 0, 6]) {
    const buf = await renderGraph(1.6, (ctx) => {
      const mixer = new Mixer(ctx, makeShared(ctx));
      const o = ctx.createOscillator();
      o.frequency.value = 1000;
      const g = ctx.createGain();
      g.gain.value = dbToGain(inDb);
      o.connect(g);
      g.connect(mixer.ui); // dry path: no reverb, no muffle
      o.start(0.5);
    });
    const m = analyze(buf, 1.1, 1.55);
    const cold = analyze(buf, 0.502, 0.53);
    const row: Row = { kind: 'chain', id: `sine ${inDb >= 0 ? '+' : ''}${inDb} dBFS in`, targetDb: inDb, note: `first 30 ms ${f1(cold.peakDb)}`, flags: [], ...m };
    rows.push(row);
  }
  // a sine from the very first sample of a new graph: the first 150 ms must not be swallowed
  {
    const buf = await renderGraph(1.2, (ctx) => {
      const mixer = new Mixer(ctx, makeShared(ctx));
      const o = ctx.createOscillator();
      o.frequency.value = 1000;
      const g = ctx.createGain();
      g.gain.value = dbToGain(-20);
      o.connect(g);
      g.connect(mixer.ui);
      o.start(0);
    });
    const early = peakDbOf(buf, 0.012, 0.03);
    const late = peakDbOf(buf, 0.9, 1.1);
    const row: Row = { kind: 'chain', id: 'cold start: −20 dBFS sine from t = 0', targetDb: -20, note: `12–30 ms ${f1(early)} · settled ${f1(late)}`, flags: [], ...analyze(buf, 0.9, 1.1) };
    if (Math.abs(early - late) > 1.5) row.flags.push(`COLD${signed(early - late)}`);
    rows.push(row);
  }
  // built-in make-up gain of each compressor stage (should equal DYNAMICS.*.makeupDb)
  for (const stage of ['music', 'glue', 'limiter'] as const) {
    const c = DYNAMICS[stage];
    const buf = await renderGraph(1.2, (ctx) => {
      const n = ctx.createDynamicsCompressor();
      n.threshold.value = c.threshold; n.knee.value = c.knee; n.ratio.value = c.ratio; n.attack.value = c.attack; n.release.value = c.release;
      const o = ctx.createOscillator();
      o.frequency.value = 1000;
      const g = ctx.createGain();
      g.gain.value = dbToGain(-40);
      o.connect(g); g.connect(n); n.connect(ctx.destination);
      o.start(0);
    });
    const m = analyze(buf, 0.7, 1.15);
    const row: Row = { kind: 'chain', id: `${stage} make-up`, targetDb: c.makeupDb - 40, note: `measured ${(m.peakDb + 40).toFixed(2)} dB, table ${c.makeupDb}`, flags: [], ...m };
    if (Math.abs(m.peakDb + 40 - c.makeupDb) > 0.3) row.flags.push('MAKEUP');
    rows.push(row);
  }
  return rows;
}

// ---------------------------------------------------------------------------------------------------------

/** Score rows: reference intensity, then 0 and 1 for adaptive states, with the combat standard at 1. */
async function musicRows(state: Exclude<MusicState, 'silence'>, o: ReportOpts, push: (row: Row, buf: AudioBuffer) => void): Promise<void> {
  const def = MUSIC[state];
  const db = def.db ?? -20;
  /** `gr`: average reduction of the tonal bus's levelling compressor (the only dynamics the score passes) */
  const measure = async (intensity: number): Promise<{ buf: AudioBuffer; m: Metrics; gr: number; note: string }> => {
    let min = 0, sum = 0, n = 0;
    const r = await renderMusicFull(state, o.secs, intensity, {
      fps: 60,
      tick: (e, t) => {
        if (t < 1) return;
        const v = e.mixer.musicReduction;
        min = Math.min(min, v);
        sum += v;
        n++;
      },
    });
    const buf = cut(r.buf, r.t0);
    const gr = n ? sum / n : 0;
    return { buf, m: analyze(buf, 1), gr, note: `levelling avg ${f1(gr)} / max ${f1(min)} dB` };
  };
  const ref = await measure(def.fixedIntensity ?? 0.6);
  const row: Row = { kind: 'music', id: state, targetDb: db, note: ref.note, flags: [], ...ref.m };
  baseFlags(row, ref.buf);
  if (!(state in MUSIC_NORM)) row.flags.push('NOCAL');
  else if (Math.abs(row.rmsDb - db) > 2) row.flags.push(`LEVEL${signed(row.rmsDb - db)}`);
  if (ref.gr < -3) row.flags.push(`GR${f1(ref.gr)}`);
  push(row, ref.buf);
  if (!ADAPTIVE.includes(state)) return;

  const lo = await measure(0);
  const loRow: Row = { kind: 'music', id: `${state}@0`, targetDb: null, note: lo.note, flags: [], ...lo.m };
  baseFlags(loRow, lo.buf);
  push(loRow, lo.buf);

  const hi = await measure(1);
  const hiRow: Row = { kind: 'music', id: `${state}@1`, targetDb: db + 2.5, note: hi.note, flags: [], ...hi.m };
  baseFlags(hiRow, hi.buf);
  if (hiRow.rmsDb > db + 3.2) hiRow.flags.push(`HOT${signed(hiRow.rmsDb - db)}`);
  if (hiRow.peakDb > -3.5) hiRow.flags.push(`PEAK${f1(hiRow.peakDb)}`);
  hiRow.note += ` · peaks ${f1(hiRow.crestPeakDb)} (max ${f1(hiRow.peakDb)})`;
  if (hi.gr < -3) hiRow.flags.push(`GR${f1(hi.gr)}`);
  if (state in COMBAT) {
    // the combat standard: hits stand out of the bed, 2–8 kHz carries real energy, dry leads wet
    if (hiRow.punchDb < COMBAT[state]) hiRow.flags.push(`PUNCH${f1(hiRow.punchDb)}`);
    if (hiRow.bands[3] < 0.06) hiRow.flags.push(`DARK${(hiRow.bands[3] * 100).toFixed(1)}%`);
    const dry = analyze(await renderMusic(state, o.secs, 1, { tap: (e) => { e.mixer.scoreSend.gain.value = 0; e.mixer.scoreRoom.gain.value = 0; } }), 1);
    const wet = analyze(await renderMusic(state, o.secs, 1, { tap: (e) => { e.mixer.music.gain.value = 0; e.mixer.musicDrums.gain.value = 0; e.mixer.musicDirect.gain.value = 0; } }), 1);
    hiRow.note += ` · dry ${f1(dry.rmsDb)} / wet ${f1(wet.rmsDb)}`;
    if (dry.rmsDb - wet.rmsDb < 6) hiRow.flags.push(`WET${signed(wet.rmsDb - dry.rmsDb)}`);
  }
  push(hiRow, hi.buf);
}

// ---------------------------------------------------------------------------------------------------------

/** Things that must hold whatever the player does with the sliders and whatever gameplay asks for. */
async function mixRows(o: ReportOpts): Promise<Row[]> {
  const rows: Row[] = [];
  const row = (id: string, m: Metrics, note: string): Row => {
    const r: Row = { kind: 'mix', id, targetDb: null, note, flags: [], ...m };
    rows.push(r);
    return r;
  };
  const vol = (v: Partial<Volumes>) => (e: AudioEngine): void => e.setVolumes({ ...REFERENCE_VOLUMES, ...v }, 0);
  const expectSilent = (r: Row): void => { if (r.peak > 0.0008) r.flags.push(`AUDIBLE${f1(r.peakDb)}`); };
  const step = (text: string): void => o.onProgress(`mix: ${text}`);

  // --- a slider at zero is silence -------------------------------------------------------------------
  for (const state of ['title', 'combatTarrik', 'witness'] as const) {
    step(`music slider 0 · ${state}`);
    const buf = await render({ ...musicOpts(state, 7, 1), tap: vol({ music: 0 }) });
    expectSilent(row(`music slider 0 · ${state}`, analyze(buf), 'must be silent'));
  }
  {
    step('music slider 0 · stinger');
    const buf = await render({ seconds: 6, stepped: true, tap: vol({ music: 0 }), setup: (e) => e.stinger('revelation') });
    expectSilent(row('music slider 0 · stinger revelation', analyze(buf), 'must be silent'));
  }
  for (const id of ['explosionLarge', 'meridianComplete', 'uiCheckpoint', 'speakKing']) {
    step(`sfx slider 0 · ${id}`);
    const buf = await render({ seconds: 5, tap: vol({ sfx: 0 }), setup: (e) => void e.play(id) });
    expectSilent(row(`sfx slider 0 · ${id}`, analyze(buf), 'must be silent'));
  }
  {
    step('sfx slider 0 · ambience + loop');
    const buf = await render({ seconds: 5, stepped: true, tap: vol({ sfx: 0 }), setup: (e) => { e.setAmbience('crucible', 0.1); e.loop('droneHum'); } });
    expectSilent(row('sfx slider 0 · ambience + loop', analyze(buf), 'must be silent'));
    const all = await render({ seconds: 5, stepped: true, tap: vol({ master: 0 }), setup: (e) => { e.setIntensity(1, true); e.setMusic('elite', 0.1); e.setAmbience('crucible', 0.1); e.play('explosionLarge'); } });
    expectSilent(row('master slider 0 · everything', analyze(all), 'must be silent'));
  }

  // --- ducks reach their depth -----------------------------------------------------------------------
  for (const [amount, want] of [[0.9, 20], [0.4, 4.4]] as const) {
    step(`duck ${amount}`);
    const buf = await render({ ...musicOpts('witness', 12, 0.5), tick: (e, t) => { if (Math.abs(t - 6) < 0.024) e.duck(amount, 5); } });
    const before = sliceDb(buf, 3, 6);
    const during = sliceDb(buf, 7.2, 10.6);
    const r = row(`duck(${amount}) on witness`, analyze(buf, 7.2, 10.6), `drop ${f1(before - during)} dB (expected ${want})`);
    if (Math.abs(before - during - want) > (want > 10 ? 2.5 : 1.2)) r.flags.push(`DUCK${f1(before - during)}`);
  }

  // --- muffle never touches the score ----------------------------------------------------------------
  {
    step('muffle');
    const a = analyze(await renderMusic('witness', 8, 0.6), 2);
    const b = analyze(await renderMusic('witness', 8, 0.6, { tap: (e) => e.setMuffle(1, 0) }), 2);
    const r = row('setMuffle(1) under witness', b, `rms ${signed(b.rmsDb - a.rmsDb)} dB · centroid ${a.spectralCentroidHz} → ${b.spectralCentroidHz} Hz`);
    if (Math.abs(b.rmsDb - a.rmsDb) > 0.4 || Math.abs(b.spectralCentroidHz - a.spectralCentroidHz) > 0.04 * a.spectralCentroidHz) r.flags.push('MUFFLE');
    // … and it does close the world
    const open = analyze(await renderAmbience('pressureHall', 6));
    const shut = analyze(await render({ seconds: 6, stepped: true, tap: (e) => e.setMuffle(1, 0), setup: (e) => { e.ambience.eventsEnabled = false; e.setAmbience('pressureHall', 0.1); } }));
    const w = row('setMuffle(1) on the world', shut, `centroid ${open.spectralCentroidHz} → ${shut.spectralCentroidHz} Hz`);
    if (shut.spectralCentroidHz > open.spectralCentroidHz * 0.6) w.flags.push('NOMUFFLE');
  }

  // --- pause: the world stops, the score drops back by 6.9 dB (×0.45) -------------------------------
  {
    step('pause');
    const buf = await render({ ...musicOpts('witness', 11, 0.5), tick: (e, t) => { if (Math.abs(t - 5) < 0.024) e.setPaused(true); } });
    const drop = sliceDb(buf, 2, 5) - sliceDb(buf, 7, 10.5);
    const r = row('pause · score', analyze(buf, 7, 10.5), `drop ${f1(drop)} dB (expected 6.9)`);
    if (Math.abs(drop - 6.9) > 1.2) r.flags.push(`PAUSE${f1(drop)}`);
    const world = await render({ seconds: 6, stepped: true, setup: (e) => { e.setAmbience('crucible', 0.1); e.loop('droneHum'); }, tick: (e, t) => { if (Math.abs(t - 2) < 0.024) e.setPaused(true); } });
    const w = row('pause · world', analyze(world, 3.5, 6), 'must be silent');
    if (w.peak > 0.0008) w.flags.push(`AUDIBLE${f1(w.peakDb)}`);
  }

  // --- pre-rendered playback sits where live synthesis does -----------------------------------------
  for (const id of ['footStone', 'bladeHitMetal', 'verityHit', 'droneBolt', 'explosionSmall', 'eclipseLunge']) {
    step(`bake parity · ${id}`);
    // eight plays each way (every play is a different random variation): compare the average loudness
    const series = async (baked: boolean): Promise<{ avg: number; m: Metrics }> => {
      const gap = sfxLength(id) + 0.45;
      let played = 0;
      const buf = await render({ seconds: 8 * gap + 1, stepped: true, baked, setup: () => undefined, tick: (e, t) => { if (played < 8 && t >= played * gap + 0.02) { e.play(id); played++; } } });
      let sum = 0;
      for (let i = 0; i < 8; i++) sum += analyze(buf, i * gap, (i + 1) * gap).loudDb;
      return { avg: sum / 8, m: analyze(buf) };
    };
    const live = await series(false);
    const baked = await series(true);
    const r = row(`pre-rendered vs live · ${id}`, baked.m, `average loudness of 8 plays: ${f1(baked.avg)} vs ${f1(live.avg)} live`);
    if (Math.abs(baked.avg - live.avg) > 1.5) r.flags.push(`PARITY${signed(baked.avg - live.avg)}`);
  }
  {
    step('bake parity · combatTarrik');
    const live = analyze(await renderMusic('combatTarrik', 8, 1, { baked: false }), 1);
    const baked = analyze(await renderMusic('combatTarrik', 8, 1), 1);
    const r = row('pre-rendered vs live · combatTarrik@1', baked, `rms ${f1(baked.rmsDb)} vs ${f1(live.rmsDb)} live · 2–8 k ${(baked.bands[3] * 100).toFixed(1)}% vs ${(live.bands[3] * 100).toFixed(1)}%`);
    if (Math.abs(baked.rmsDb - live.rmsDb) > 1.2) r.flags.push(`PARITY${signed(baked.rmsDb - live.rmsDb)}`);
  }
  return rows;
}

// ---------------------------------------------------------------------------------------------------------

/** Live source nodes, node churn, and a main-thread stall. */
async function perfRows(o: ReportOpts): Promise<Row[]> {
  Probe.install();
  const rows: Row[] = [];
  const add = (id: string, buf: AudioBuffer | null, note: string, flags: string[] = []): void => {
    rows.push({ kind: 'perf', id, targetDb: null, note, flags, ...(buf ? analyze(buf) : EMPTY) });
  };
  const score = async (state: MusicState, extra: Partial<RenderOpts> = {}): Promise<{ live: number; perSec: number; rt: number }> => {
    Probe.reset();
    const r = await renderFull(musicOpts(state, 14, 1, { fps: 60, ...extra }));
    return { live: Probe.maxLive(WARM + 3, WARM + 14), perSec: Math.round(Probe.created / 14), rt: 14 / r.wall };
  };
  for (const state of ['combatTarrik', 'elite', 'carrier', 'combatSelene', 'combatEclipse', 'duel', 'witness'] as const) {
    o.onProgress(`perf: score ${state}`);
    const s = await score(state);
    add(`score ${state}@1`, null, `${s.live} live sources · ${s.perSec} nodes/s · ${f1(s.rt)}× realtime`, s.live > 44 ? [`SRC${s.live}`] : []);
  }
  {
    o.onProgress('perf: score combatTarrik (live synthesis)');
    const s = await score('combatTarrik', { baked: false });
    add('score combatTarrik@1 · live synthesis (before pre-render lands)', null, `${s.live} live sources · ${s.perSec} nodes/s · ${f1(s.rt)}× realtime`);
  }
  {
    o.onProgress('perf: full fight');
    Probe.reset();
    let peakVoices = 0;
    const scene = SCENES.fight;
    const r = await renderFull({ seconds: scene.seconds, fps: 60, stepped: true, setup: scene.setup, tick: (e, t) => { scene.run(e, t); peakVoices = Math.max(peakVoices, e.voices.count); } });
    const live = Probe.maxLive(WARM + 3, WARM + scene.seconds);
    const buf = cut(r.buf, r.t0);
    const m = analyze(buf, 3);
    const flags: string[] = [];
    if (live > 66) flags.push(`SRC${live}`);
    rows.push({ kind: 'perf', id: 'full fight: elite score + crucible + 7 loops + 12 cues/s', targetDb: null, note: `${live} live sources · ${Math.round(Probe.created / scene.seconds)} nodes/s · ${peakVoices} SFX voices peak · ${f1(scene.seconds / r.wall)}× realtime`, flags, ...m });
    o.keep('perf:fight', buf);
  }
  // a main-thread stall in combat: no hole in the rhythm, no shift of the beat
  for (const stall of [0.3, 0.8, 1.6]) {
    // the long one is what a zone build looks like, and the game announces those (mission.loading → setBusy)
    const busy = stall > 1;
    o.onProgress(`perf: ${stall} s stall`);
    Probe.reset();
    await renderFull(musicOpts('combatTarrik', 10, 1, { fps: 60, stall: (t) => t > 5 && t < 5 + stall, tick: (e, t) => { if (busy && t > 3.5) e.setBusy(t < 5 + stall + 0.2); } }));
    const starts = Probe.starts(WARM + 3, WARM + 9.5).map((t) => t - WARM);
    const stepDur = 60 / MUSIC.combatTarrik.bpm / 4;
    const phase = (a: number, b: number): number => {
      let sx = 0, sy = 0;
      for (const t of starts) if (t >= a && t < b) { const p = ((t % stepDur) / stepDur) * 2 * Math.PI; sx += Math.cos(p); sy += Math.sin(p); }
      return (((Math.atan2(sy, sx) / (2 * Math.PI)) * stepDur * 1000) + stepDur * 1000) % (stepDur * 1000);
    };
    let before = 0, around = 0;
    for (let i = 1; i < starts.length; i++) {
      const gap = starts[i] - starts[i - 1];
      if (starts[i] < 4.8) before = Math.max(before, gap);
      else if (starts[i - 1] < 5.4 + stall) around = Math.max(around, gap);
    }
    const shift = Math.abs(phase(3, 4.9) - phase(5.4 + stall, 9.4));
    const drift = Math.min(shift, stepDur * 1000 - shift);
    const flags: string[] = [];
    if (around > before + 0.12) flags.push(`HOLE${Math.round(around * 1000)}ms`);
    if (drift > 4) flags.push(`PHASE${f1(drift)}ms`);
    add(`${stall} s main-thread stall in combatTarrik${busy ? ' (announced: loading)' : ''}`, null, `largest note gap ${Math.round(around * 1000)} ms (${Math.round(before * 1000)} ms normally) · beat phase moved ${f1(drift)} ms`, flags);
  }
  return rows;
}

// ---------------------------------------------------------------------------------------------------------

/** Two plays of an exact id, 3 s apart, reverb off: they must be the same samples. */
async function exactRows(o: ReportOpts): Promise<Row[]> {
  const rows: Row[] = [];
  const ids = Object.keys(SFX).filter((id) => SFX[id].exact && !SFX[id].loop);
  for (const id of ids) {
    if (o.ids && !o.ids.includes(id)) continue;
    o.onProgress(`exact: ${id}`);
    const gap = 3;
    const buf = await render({
      seconds: gap + 2.5, stepped: true,
      tap: (e) => { e.mixer.room.gain.value = 0; e.mixer.near.gain.value = 0; },
      setup: (e) => void e.play(id),
      tick: (e, t) => { if (Math.abs(t - gap) < 0.024) e.play(id); },
    });
    const l = buf.getChannelData(0);
    const sr = buf.sampleRate;
    const n = Math.floor(0.5 * sr);
    const a0 = Math.floor(0.004 * sr);
    let ea = 0;
    for (let i = 0; i < n; i++) ea += l[a0 + i] * l[a0 + i];
    let best = -2, bestLag = 0;
    for (let lag = Math.floor((gap - 0.02) * sr); lag < Math.floor((gap + 0.08) * sr); lag++) {
      let c = 0, eb = 0;
      for (let i = 0; i < n; i += 2) { const b = l[a0 + lag + i]; c += l[a0 + i] * b; eb += b * b; }
      const v = (c * 2) / Math.sqrt(ea * eb * 2 + 1e-20);
      if (v > best) { best = v; bestLag = lag; }
    }
    let eb = 0;
    for (let i = 0; i < n; i++) eb += l[a0 + bestLag + i] * l[a0 + bestLag + i];
    const diff = 10 * Math.log10((eb + 1e-20) / (ea + 1e-20));
    const row: Row = { kind: 'exact', id, targetDb: SFX[id].db, note: `correlation ${best.toFixed(4)} · level difference ${diff.toFixed(2)} dB`, flags: [], ...analyze(buf) };
    if (best < 0.99 || Math.abs(diff) > 0.2) row.flags.push(`DIFF${best.toFixed(2)}`);
    rows.push(row);
  }
  return rows;
}

// ---------------------------------------------------------------------------------------------------------

export async function buildReport(o: ReportOpts): Promise<Row[]> {
  const want = (kind: Kind, id: string): boolean => o.only.includes(kind) && (!o.ids || o.ids.includes(id));
  const rows: Row[] = [];
  const push = (row: Row, buf: AudioBuffer): void => {
    rows.push(row);
    o.keep(`${row.kind}:${row.id}`, buf);
    o.onProgress(`rendering… ${rows.length} done (${row.kind}:${row.id})`);
  };

  if (o.only.includes('chain')) rows.push(...(await chainRows()));

  for (const id of Object.keys(SFX)) {
    if (!want('sfx', id)) continue;
    const buf = await renderSfx(id);
    const row: Row = { kind: 'sfx', id, targetDb: SFX[id].db, note: '', flags: [], ...analyze(buf) };
    baseFlags(row, buf);
    if (!(id in SFX_NORM)) row.flags.push('NOCAL');
    else levelFlags(row, SFX[id].db);
    if (o.cold) {
      // The same cue as the first sound of a session, on a chain that has only just been built. Compared by
      // loudness: the sample peak of a click moves by a decibel with where it falls between two samples.
      const cold = analyze(await renderSfx(id, { cold: true }, 0.6)).loudDb;
      if (Math.abs(cold - row.loudDb) > 1.5) row.flags.push(`COLD${signed(cold - row.loudDb)}`);
      row.note += ` · cold ${signed(cold - row.loudDb)} dB`;
    }
    push(row, buf);
  }

  for (const id of LOOP_IDS) {
    if (!want('loop', id)) continue;
    // 12 s: long enough to pass the wrap point of a pre-rendered loop at least once
    const buf = await renderLoop(id, {}, 12);
    const sustain = sliceDb(buf, 1.5, 10);
    const row: Row = { kind: 'loop', id, targetDb: SFX[id].db, note: `sustain ${f1(sustain)} dB rms`, flags: [], ...analyze(buf) };
    baseFlags(row, buf);
    // a stopped loop must have fallen well below its sustain level
    if (sliceDb(buf, 11.7, 12) > sustain - 24) row.flags.push('NOSTOP');
    const baked = prepared?.samples.bakedOf(id)[0];
    if (baked?.loop) {
      // pre-rendered as one seamless buffer: no click at the wrap, and the same level as the live patch
      const seam = loopSeam(baked.buffer);
      const live = sliceDb(await renderLoop(id, { baked: false }, 6), 1.5, 4);
      row.note += ` · one ${baked.buffer.duration.toFixed(2)} s buffer loop (wrap step ×${f1(seam)}) · live patch ${f1(live)} dB`;
      if (seam > 6) row.flags.push(`SEAM×${f1(seam)}`);
      if (Math.abs(sustain - live) > 1.5) row.flags.push(`PARITY${signed(sustain - live)}`);
      // the level over the loop must not lurch where the cross-fade sits: compare 250 ms windows
      let lo = Infinity, hi = -Infinity;
      for (let t = 2; t + 0.25 <= 10; t += 0.25) { const v = sliceDb(buf, t, t + 0.25); lo = Math.min(lo, v); hi = Math.max(hi, v); }
      row.note += ` · level range ${f1(hi - lo)} dB`;
    }
    push(row, buf);
  }

  for (const state of Object.keys(MUSIC) as Exclude<MusicState, 'silence'>[]) {
    if (want('music', state)) await musicRows(state, o, push);
  }

  for (const id of Object.keys(AMBIENCE) as Exclude<AmbienceId, 'none'>[]) {
    if (!want('ambience', id)) continue;
    const buf = await renderAmbience(id, o.secs);
    const row: Row = { kind: 'ambience', id, targetDb: AMBIENCE[id].db, note: '', flags: [], ...analyze(buf, 1) };
    baseFlags(row, buf);
    if (!(id in AMB_NORM)) row.flags.push('NOCAL');
    else if (Math.abs(row.rmsDb - AMBIENCE[id].db) > 2.5) row.flags.push(`LEVEL${signed(row.rmsDb - AMBIENCE[id].db)}`);
    push(row, buf);
    const ev = await renderAmbience(id, 24, undefined, true);
    const evRow: Row = { kind: 'scene', id: `${id}+events`, targetDb: null, note: `events peak ${f1(peakDbOf(ev, 1))} over a ${f1(row.rmsDb)} dB bed`, flags: [], ...analyze(ev, 1) };
    baseFlags(evRow, ev);
    push(evRow, ev);
  }

  for (const kind of STINGER_KINDS) {
    if (!want('stinger', kind)) continue;
    const buf = await renderStinger(kind);
    const row: Row = { kind: 'stinger', id: kind, targetDb: STINGER_DB[kind], note: '', flags: [], ...analyze(buf) };
    baseFlags(row, buf);
    if (!(`stinger:${kind}` in MUSIC_NORM)) row.flags.push('NOCAL');
    else levelFlags(row, STINGER_DB[kind]);
    push(row, buf);
  }

  for (const id of Object.keys(SCENES)) {
    if (!want('scene', id)) continue;
    const r = await renderScene(id);
    const buf = cut(r.buf, r.t0);
    const row: Row = { kind: 'scene', id, targetDb: null, note: '', flags: [], ...analyze(buf) };
    baseFlags(row, buf);
    if (id === 'crossfade') {
      // the incoming combat state must be heard on its first downbeat, not after a fade-in
      const start = (r.engine.music.activeDeck?.startAt ?? WARM) - r.t0;
      const bar = (60 / MUSIC.combatTarrik.bpm) * 4;
      const first = peakDbOf(buf, start, start + 0.25);
      const later = peakDbOf(buf, start + bar, start + bar + 0.25);
      row.note = `combat entered ${f1(start - 4)} s after the call · first downbeat ${f1(first)} dB, the next bar's ${f1(later)} dB`;
      if (first < later - 3) row.flags.push(`ENTRANCE${signed(first - later)}`);
    }
    if (id === 'fight') {
      const m = analyze(buf, 3);
      row.note = `from 3 s: rms ${f1(m.rmsDb)} · peak ${f1(m.peakDb)} · cues +${f1(m.punchDb)} dB over the bed`;
      if (m.rmsDb > -15.5) row.flags.push(`HOT${f1(m.rmsDb)}`);
      if (m.peakDb > -2) row.flags.push(`PEAK${f1(m.peakDb)}`);
    }
    if (id === 'combo') {
      // half a second after the last hit of the combo the vast room must be well under the hits themselves
      const tail = sliceDb(buf, 2.25, 2.45);
      row.note = `0.5 s after the last hit: ${f1(tail)} dB rms, ${f1(tail - row.loudDb)} dB under the hits' loudness (${f1(row.loudDb)})`;
      if (tail > row.loudDb - 12) row.flags.push(`SMEAR${f1(tail - row.loudDb)}`);
    }
    push(row, buf);
  }

  if (o.only.includes('mix')) rows.push(...(await mixRows(o)));
  if (o.only.includes('exact')) rows.push(...(await exactRows(o)));
  if (o.only.includes('perf')) rows.push(...(await perfRows(o)));
  return rows;
}
