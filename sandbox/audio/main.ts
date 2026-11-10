/**
 * Audio sandbox.
 *   /sandbox/audio/                  audition page: every SFX, loop, music state, ambience, stinger, speaker
 *   /sandbox/audio/?report=1         offline-render everything and publish window.__audioReport
 *        &only=sfx,loop,music,ambience,stinger,scene,chain   &ids=a,b   &secs=8   &intensity=0.6   &sweep=1
 *   /sandbox/audio/?calibrate=1      measure normalisation → window.__calibration (see write-calibration.mjs)
 *        &only=sfx,music,stinger,ambience   &ids=a,b   &passes=4      (starts from the existing tables)
 *   /sandbox/audio/?detail=music:combatTarrik[&secs=12]      one large spectrogram
 * The page sets window.__ready when the requested work is finished.
 */
import { createAudioSystem } from '@/audio';
import { AudioEngine, type NormTables } from '@/audio/engine';
import { SFX, SFX_GROUPS } from '@/audio/sfx';
import { dbToGain } from '@/audio/sfx/recipe';
import { MUSIC, MUSIC_STATES } from '@/audio/music/defs';
import { STINGER_DB, STINGER_KINDS } from '@/audio/music/stingers';
import { AMBIENCE, AMBIENCE_IDS } from '@/audio/ambience/defs';
import { AMB_NORM, MUSIC_NORM, SFX_NORM } from '@/audio/calibration';
import { DYNAMICS, Mixer } from '@/audio/mixer';
import { makeShared } from '@/audio/synth/shared';
import type { AmbienceId, LoopHandle, MusicState } from '@/core/api';
import { miniGame } from '../harness';
import { analyze, drawSpectrogram, type Metrics } from './analyze';
import { render, renderGraph, toWav } from './render';

type Kind = 'sfx' | 'loop' | 'music' | 'ambience' | 'stinger' | 'scene' | 'chain';

interface Row extends Metrics {
  kind: Kind;
  id: string;
  /** authored target (peak dB for sfx/stingers, RMS dB for beds) */
  targetDb: number | null;
  flags: string[];
}

const W = window as unknown as Record<string, unknown>;
const q = new URLSearchParams(location.search);
const app = document.getElementById('app') as HTMLElement;
const stat = document.getElementById('stat') as HTMLElement;
addEventListener('error', (e) => ((W.__aurelionErrors ??= []) as string[]).push(String(e.error?.stack ?? e.message)));
addEventListener('unhandledrejection', (e) => ((W.__aurelionErrors ??= []) as string[]).push(`unhandled: ${String(e.reason?.stack ?? e.reason)}`));

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] => {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...kids);
  return n;
};
const section = (title: string, ...kids: Node[]): HTMLElement => {
  const s = el('section', {}, el('h2', { textContent: title }), ...kids);
  app.append(s);
  return s;
};

const LOOP_IDS = Object.keys(SFX).filter((id) => SFX[id].loop);
const ADAPTIVE = (Object.keys(MUSIC) as Exclude<MusicState, 'silence'>[]).filter((s) => MUSIC[s].fixedIntensity === undefined);

// ---------------------------------------------------------------------------------------------------------
// offline renders
// ---------------------------------------------------------------------------------------------------------

const lengthCache = new Map<string, number>();
/** scheduled (dry) length of a one-shot, found by building it on a throwaway context */
function sfxLength(id: string): number {
  let v = lengthCache.get(id);
  if (v === undefined) {
    v = new AudioEngine(new OfflineAudioContext(2, 128, 44100), { seed: 7283 }).play(id);
    lengthCache.set(id, v);
  }
  return v;
}

const renderSfx = (id: string, norm?: Partial<NormTables>, tail = 2.6): Promise<AudioBuffer> =>
  render({ seconds: Math.min(14, sfxLength(id) + tail), norm, setup: (e) => void e.play(id) });

const renderLoop = (id: string, norm?: Partial<NormTables>): Promise<AudioBuffer> => {
  let h: LoopHandle | null = null;
  return render({
    seconds: 4.5, norm, stepped: true,
    setup: (e) => { h = e.loop(id); },
    tick: (_e, t) => { if (t >= 2.8 && h) { h.stop(0.4); h = null; } },
  });
};

const renderMusic = (state: MusicState, seconds: number, intensity: number, norm?: Partial<NormTables>): Promise<AudioBuffer> =>
  render({ seconds, norm, stepped: true, setup: (e) => { e.setIntensity(intensity, true); e.setMusic(state, 0.1); } });

/** `events` false = bed only (what the loudness target and calibration refer to). */
const renderAmbience = (id: AmbienceId, seconds: number, norm?: Partial<NormTables>, events = false): Promise<AudioBuffer> =>
  render({ seconds, norm, stepped: true, setup: (e) => { e.ambience.eventsEnabled = events; e.setAmbience(id, 0.1); } });

const renderStinger = (kind: string, norm?: Partial<NormTables>): Promise<AudioBuffer> =>
  render({ seconds: 7, norm, stepped: true, setup: (e) => e.stinger(kind as never) });

/** Scripted scenes: the dynamic behaviour (cross-fades, sever, resolution, voice limiting) under measurement. */
const SCENES: Record<string, { seconds: number; run(e: AudioEngine, t: number): void; setup(e: AudioEngine): void }> = {
  // approach → combat on a bar line while intensity climbs
  crossfade: {
    seconds: 12,
    setup: (e) => { e.setMusic('approachTarrik', 0.1); },
    run: (e, t) => { if (near(t, 4)) { e.setMusic('combatTarrik', 2); e.setIntensity(1); } },
  },
  // Eclipse cadence: stamped out, then stinger('sever') at 5 s makes it stumble
  sever: {
    seconds: 12,
    setup: (e) => { e.setIntensity(0.2, true); e.setMusic('breach', 0.1); },
    run: (e, t) => { if (near(t, 5)) e.stinger('sever'); },
  },
  // King identity: unresolved, then meridianComplete at 4 s admits the third
  meridian: {
    seconds: 14,
    setup: (e) => { e.setIntensity(0.6, true); e.setMusic('core', 0.1); },
    run: (e, t) => { if (near(t, 4)) e.play('meridianComplete'); },
  },
  // stress: a whole encounter firing in the same 150 ms — must limit, never clip
  sixDrones: {
    seconds: 5,
    setup: (e) => { e.setIntensity(1, true); e.setMusic('combatSelene', 0.1); e.setAmbience('relayOverlook', 0.1); },
    run: (e, t) => {
      if (near(t, 2)) {
        for (let i = 0; i < 6; i++) { e.play('droneVolley', { pos: { x: i * 3 - 8, y: 2, z: -6 } }); e.play('droneBolt'); e.play('droneCharge'); }
        for (let i = 0; i < 4; i++) { e.play('explosionLarge'); e.play('shieldBreak'); e.play('cinderSlam'); e.play('bladeHitMetal'); e.play('axiomShot'); }
      }
    },
  },
  // gameplay supplies the Eclipse cadence (period 1.3 s) from 4 s; from 9 s the beats arrive irregular
  cadence: {
    seconds: 14,
    setup: (e) => { e.setIntensity(0.3, true); e.setMusic('breach', 0.1); },
    run: (e, t) => {
      for (let b = 4; b < 9; b += 1.3) if (near(t, b)) e.cadenceTick({ x: 3, y: 1, z: -6 });
      for (const b of [9.4, 10.2, 11.9, 12.5]) if (near(t, b)) e.cadenceTick({ x: 3, y: 1, z: -6 }, true);
    },
  },
  // dialogue duck at 2 s, muffle in at 4 s, out at 6 s
  duckMuffle: {
    seconds: 9,
    setup: (e) => { e.setIntensity(0.5, true); e.setMusic('approachSelene', 0.1); e.setAmbience('pressureHall', 0.1); },
    run: (e, t) => {
      if (near(t, 2)) { e.speak('Tharne', 'radio'); e.duck(0.5, 1.5); }
      if (near(t, 4)) e.setMuffle(1, 0.5);
      if (near(t, 6)) e.setMuffle(0, 0.5);
      if (near(t, 4.5) || near(t, 5.2) || near(t, 6.6)) e.play('fleetImpact');
    },
  },
  // Z09: battle stripped to one held tone, then recognition
  quarantine: {
    seconds: 12,
    setup: (e) => { e.setIntensity(0.9, true); e.setMusic('elite', 0.1); e.setAmbience('crucible', 0.1); },
    run: (e, t) => {
      if (near(t, 3)) { e.play('quarantineSeal'); e.setMusic('quarantine', 1.2); e.setAmbience('woundGallery', 1.5); e.setIntensity(0); }
      if (near(t, 8.5)) e.play('recognitionTone');
    },
  },
  // Thermal Fracture: window, then the strike and the resonance stinger
  resonance: {
    seconds: 10,
    setup: (e) => { e.setIntensity(0.9, true); e.setMusic('elite', 0.1); },
    run: (e, t) => {
      if (near(t, 2)) { e.setMusic('resonance', 0.3); e.play('frostArrest'); e.play('resonanceWindow'); }
      if (near(t, 5)) { e.play('thermalFracture'); e.stinger('resonance'); }
      if (near(t, 6.5)) e.setMusic('elite', 1.5);
    },
  },
};
const near = (t: number, at: number): boolean => Math.abs(t - at) < 0.024;

const renderScene = (id: string): Promise<AudioBuffer> => {
  const s = SCENES[id];
  return render({ seconds: s.seconds, stepped: true, setup: s.setup, tick: s.run });
};

/** 1 kHz sine through the bare mix chain at several input levels: reveals the dynamics transfer curve. */
async function chainRows(): Promise<Row[]> {
  const rows: Row[] = [];
  for (const inDb of [-40, -24, -18, -12, -9, -6, -3, 0, 6]) {
    const buf = await renderGraph(1.2, (ctx) => {
      const mixer = new Mixer(ctx, makeShared(ctx));
      const o = ctx.createOscillator();
      o.frequency.value = 1000;
      const g = ctx.createGain();
      g.gain.value = dbToGain(inDb);
      o.connect(g);
      g.connect(mixer.ui); // dry path: no reverb worth mentioning, no muffle
      o.start(0);
    });
    const m = analyze(buf, 0.7, 1.15);
    rows.push({ kind: 'chain', id: `sine ${inDb >= 0 ? '+' : ''}${inDb} dBFS in`, targetDb: inDb, flags: [], ...m });
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
    const row: Row = { kind: 'chain', id: `${stage} make-up (measured ${(m.peakDb + 40).toFixed(2)} dB)`, targetDb: c.makeupDb - 40, flags: [], ...m };
    if (Math.abs(m.peakDb + 40 - c.makeupDb) > 0.3) row.flags.push('MAKEUP');
    rows.push(row);
  }
  return rows;
}

// ---------------------------------------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------------------------------------

/** RMS (dB) of a slice of a buffer. */
function sliceDb(buf: AudioBuffer, from: number, to: number): number {
  return analyze(buf, Math.max(0, from), Math.min(buf.duration, to)).rmsDb;
}

function flag(row: Row, buf: AudioBuffer, calibrated: boolean): void {
  const f = row.flags;
  const peaky = row.kind === 'sfx' || row.kind === 'stinger';
  if (row.nan) f.push('NaN');
  if (row.silent) f.push('SILENT');
  if (row.clipped) f.push('CLIP');
  if (Math.abs(row.dc) > 0.02 && Math.abs(row.dc) > 0.25 * row.rms) f.push('DC');
  // a one-shot must be dying away by the end of its render (dry length + 2.6 s of room)
  if (peaky && sliceDb(buf, buf.duration - 0.25, buf.duration) > row.peakDb - 38) f.push('LONG');
  if (row.kind === 'sfx' && buf.duration >= 13.9) f.push('LONG');
  // a stopped loop must have fallen well below its sustain level
  if (row.kind === 'loop' && sliceDb(buf, 4.2, 4.5) > sliceDb(buf, 1.5, 2.5) - 24) f.push('NOSTOP');
  if (!calibrated) f.push('NOCAL');
  if (row.targetDb !== null && calibrated && row.kind !== 'loop' && row.kind !== 'chain') {
    const got = peaky ? row.peakDb : row.rmsDb;
    const tol = peaky ? 3 : 2.5;
    if (Math.abs(got - row.targetDb) > tol) f.push(`LEVEL${got > row.targetDb ? '+' : ''}${(got - row.targetDb).toFixed(1)}`);
  }
}

const buffers = new Map<string, AudioBuffer>();

async function buildReport(): Promise<Row[]> {
  const only = (q.get('only') ?? 'chain,sfx,loop,music,ambience,stinger,scene').split(',');
  const ids = q.get('ids')?.split(',') ?? null;
  const secs = Number(q.get('secs') ?? 8);
  const intensity = Number(q.get('intensity') ?? 0.6);
  const want = (kind: Kind, id: string): boolean => only.includes(kind) && (!ids || ids.includes(id));
  const rows: Row[] = [];
  const push = (kind: Kind, id: string, buf: AudioBuffer, targetDb: number | null, calibrated: boolean, from = 0): void => {
    const row: Row = { kind, id, targetDb, flags: [], ...analyze(buf, from) };
    flag(row, buf, calibrated);
    rows.push(row);
    buffers.set(`${kind}:${id}`, buf);
    stat.textContent = `rendering… ${rows.length} done (${kind}:${id})`;
  };

  if (only.includes('chain')) rows.push(...(await chainRows()));
  for (const id of Object.keys(SFX)) {
    if (want('sfx', id)) push('sfx', id, await renderSfx(id), SFX[id].db, id in SFX_NORM);
  }
  for (const id of LOOP_IDS) {
    if (want('loop', id)) push('loop', id, await renderLoop(id), SFX[id].db, true);
  }
  for (const state of Object.keys(MUSIC) as Exclude<MusicState, 'silence'>[]) {
    const def = MUSIC[state];
    if (want('music', state)) push('music', state, await renderMusic(state, secs, def.fixedIntensity ?? intensity), def.db ?? -20, state in MUSIC_NORM, 1);
    if (q.has('sweep') && ADAPTIVE.includes(state)) {
      for (const i of [0, 1]) if (want('music', state)) push('music', `${state}@${i}`, await renderMusic(state, secs, i), null, true, 1);
    }
  }
  for (const id of Object.keys(AMBIENCE) as Exclude<AmbienceId, 'none'>[]) {
    if (want('ambience', id)) {
      push('ambience', id, await renderAmbience(id, secs), AMBIENCE[id].db, id in AMB_NORM, 1);
      push('scene', `${id}+events`, await renderAmbience(id, 24, undefined, true), null, true, 1);
    }
  }
  for (const kind of STINGER_KINDS) {
    if (want('stinger', kind)) push('stinger', kind, await renderStinger(kind), STINGER_DB[kind], `stinger:${kind}` in MUSIC_NORM);
  }
  for (const id of Object.keys(SCENES)) {
    if (want('scene', id)) push('scene', id, await renderScene(id), null, true);
  }
  return rows;
}

const BAND_COLORS = ['#5a1616', '#8a5a2b', '#c9a45c', '#a8d8ff', '#ffffff'];

function showReport(rows: Row[]): void {
  const bad = rows.filter((r) => r.flags.length);
  const summary = el('div', { id: 'summary' });
  summary.innerHTML = `<b>${rows.length}</b> renders · <b class="${bad.length ? 'bad' : 'ok'}">${bad.length} flagged</b>` +
    (bad.length ? ` — ${bad.slice(0, 14).map((r) => `${r.id} [${r.flags.join(' ')}]`).join(', ')}` : '') +
    ` · spectrogram: 40 Hz–16 kHz log, 72 dB; blue line = level (−60…0 dBFS)`;
  // contact sheet (paginated for screenshots: __sheet(page))
  const sheet = el('div', { className: 'row' });
  sheet.style.gap = '6px';
  const tiles: HTMLElement[] = rows.filter((r) => r.kind !== 'chain').map((r) => {
    const buf = buffers.get(`${r.kind}:${r.id}`);
    const wide = r.kind === 'music' || r.kind === 'ambience' || r.kind === 'scene';
    const cv = el('canvas', { className: 'sg', width: wide ? 306 : 150, height: 64 });
    if (buf) drawSpectrogram(cv, buf);
    const cap = el('div', {});
    cap.innerHTML = `<span style="color:${r.flags.length ? 'var(--bad)' : '#f0e6cf'}">${r.id}</span> <span style="color:var(--dim)">${r.kind === 'sfx' || r.kind === 'stinger' ? r.peakDb + ' pk' : r.rmsDb + ' rms'} · ${r.spectralCentroidHz} Hz${r.flags.length ? ' · ' + r.flags.join(' ') : ''}</span>`;
    cap.style.cssText = `font-size:10px;width:${wide ? 306 : 150}px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis`;
    const t = el('div', {}, cv, cap);
    if (buf) cv.onclick = () => { const a = el('a', { href: URL.createObjectURL(toWav(buf)), download: `${r.kind}-${r.id}.wav` }); a.click(); };
    return t;
  });
  sheet.append(...tiles);
  const PER = 54;
  W.__sheet = (page: number): number => {
    let units = 0;
    let p = 0;
    tiles.forEach((t) => {
      const u = t.querySelector('canvas')!.width > 200 ? 2 : 1;
      if (units + u > PER) { p++; units = 0; }
      units += u;
      t.style.display = page < 0 || p === page ? '' : 'none';
    });
    scrollTo(0, 0);
    return p + 1;
  };

  const table = el('table');
  table.innerHTML = '<tr><th>id</th><th>kind</th><th>target</th><th>peak dB</th><th>rms dB</th><th>ms</th><th>centroid</th><th>bands &lt;80 · 250 · 2k · 8k · &gt;</th><th>stereo</th><th>dc</th><th>flags</th></tr>';
  for (const r of rows) {
    const tr = el('tr', { className: r.flags.length ? 'flag' : '' });
    const bands = `<span class="bands">${r.bands.map((b, i) => `<i style="width:${(b * 100).toFixed(1)}%;background:${BAND_COLORS[i]}"></i>`).join('')}</span>`;
    tr.innerHTML = `<td class="id">${r.id}</td><td class="kind">${r.kind}</td><td>${r.targetDb ?? ''}</td><td>${r.peakDb}</td><td>${r.rmsDb}</td><td>${r.durationMs}</td><td>${r.spectralCentroidHz}</td><td>${bands}</td><td>${r.stereo}</td><td>${r.dc}</td><td class="flags">${r.flags.join(' ')}</td>`;
    table.append(tr);
  }
  section('Report', summary, sheet);
  section('Measurements', table);
}

// ---------------------------------------------------------------------------------------------------------
// calibration
// ---------------------------------------------------------------------------------------------------------

/**
 * Iterate each id's normalisation until its measured level at the FINAL output (whole mix chain, reference
 * volume settings) sits on its authored target. Starts from the existing tables, so `&only=music` after a
 * score tweak converges in a pass or two and leaves everything else as it was.
 */
async function calibrate(): Promise<{ sfx: Record<string, number>; music: Record<string, number>; amb: Record<string, number>; log: string[] }> {
  const sfx: Record<string, number> = {};
  const music: Record<string, number> = {};
  const amb: Record<string, number> = {};
  const log: string[] = [];
  const secs = Number(q.get('secs') ?? 8);
  const only = (q.get('only') ?? 'sfx,music,stinger,ambience').split(',');
  const ids = q.get('ids')?.split(',') ?? null;
  const want = (id: string): boolean => !ids || ids.includes(id);
  for (const id of Object.keys(SFX)) sfx[id] = SFX_NORM[id] ?? 1;
  for (const s of Object.keys(MUSIC)) music[s] = MUSIC_NORM[s] ?? 0.22;
  for (const kind of STINGER_KINDS) music[`stinger:${kind}`] = MUSIC_NORM[`stinger:${kind}`] ?? 0.2;
  for (const a of Object.keys(AMBIENCE)) amb[a] = AMB_NORM[a] ?? 12;
  const PASSES = Number(q.get('passes') ?? 4);
  const step = (k: number): number => Math.min(16, Math.max(0.0625, k));
  for (let pass = 1; pass <= PASSES; pass++) {
    let worst = 0;
    let worstId = '';
    const track = (id: string, errDb: number): void => { if (Math.abs(errDb) > Math.abs(worst)) { worst = errDb; worstId = id; } };
    const norm = { sfx, music, amb };
    if (only.includes('sfx')) for (const id of Object.keys(SFX).filter(want)) {
      stat.textContent = `calibrating pass ${pass}/${PASSES}: sfx ${id}`;
      const m = analyze(await renderSfx(id, norm, 0.5));
      if (m.peak <= 1e-5) { log.push(`! ${id} silent`); continue; }
      const k = dbToGain(SFX[id].db) / m.peak;
      track(id, 20 * Math.log10(k));
      sfx[id] *= step(k);
    }
    if (only.includes('music')) for (const s of (Object.keys(MUSIC) as Exclude<MusicState, 'silence'>[]).filter(want)) {
      stat.textContent = `calibrating pass ${pass}/${PASSES}: music ${s}`;
      const def = MUSIC[s];
      const m = analyze(await renderMusic(s, secs, def.fixedIntensity ?? 0.6, norm), 1);
      if (m.rms <= 1e-6) { log.push(`! music ${s} silent`); continue; }
      const k = dbToGain(def.db ?? -20) / m.rms;
      track(`music:${s}`, 20 * Math.log10(k));
      music[s] *= step(k);
    }
    if (only.includes('stinger')) for (const kind of STINGER_KINDS.filter(want)) {
      stat.textContent = `calibrating pass ${pass}/${PASSES}: stinger ${kind}`;
      const m = analyze(await renderStinger(kind, norm));
      if (m.peak <= 1e-5) { log.push(`! stinger ${kind} silent`); continue; }
      const k = dbToGain(STINGER_DB[kind]) / m.peak;
      track(`stinger:${kind}`, 20 * Math.log10(k));
      music[`stinger:${kind}`] *= step(k);
    }
    if (only.includes('ambience')) for (const a of (Object.keys(AMBIENCE) as Exclude<AmbienceId, 'none'>[]).filter(want)) {
      stat.textContent = `calibrating pass ${pass}/${PASSES}: ambience ${a}`;
      const m = analyze(await renderAmbience(a, secs, norm), 1);
      if (m.rms <= 1e-6) { log.push(`! ambience ${a} silent`); continue; }
      const k = dbToGain(AMBIENCE[a].db) / m.rms;
      track(`amb:${a}`, 20 * Math.log10(k));
      amb[a] *= step(k);
    }
    log.push(`pass ${pass}: worst correction ${worst.toFixed(2)} dB (${worstId})`);
    if (Math.abs(worst) < 0.4) break;
  }
  return { sfx, music, amb, log };
}

// ---------------------------------------------------------------------------------------------------------
// audition UI (live AudioContext through the real façade)
// ---------------------------------------------------------------------------------------------------------

function buildControls(): void {
  const game = miniGame(null);
  const audio = createAudioSystem(game);
  W.__audio = audio;
  W.__game = game;
  let last = performance.now();
  const loop = (now: number): void => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    audio.update(dt);
    const d = audio.debugInfo();
    stat.textContent = d.unlocked
      ? `ctx ${d.contextState} · voices ${d.voices}/28 · music ${d.music} · ambience ${d.ambience} · intensity ${d.intensity.toFixed(2)} · muffle ${d.muffle.toFixed(2)}${d.meridianResolved ? ' · meridian resolved' : ''}`
      : 'locked — press any control';
    requestAnimationFrame(loop);
  };
  if (!q.has('manual')) requestAnimationFrame(loop);

  const btn = (label: string, fn: (b: HTMLButtonElement) => void): HTMLButtonElement => {
    const b = el('button', { textContent: label });
    b.onclick = () => { audio.unlock(); fn(b); };
    return b;
  };
  const radio = (labels: readonly string[], fn: (v: string) => void, initial: string): HTMLElement => {
    const row = el('div', { className: 'row' });
    const bs = labels.map((l) => btn(l, () => { bs.forEach((x) => x.classList.toggle('on', x.textContent === l)); fn(l); }));
    bs.find((b) => b.textContent === initial)?.classList.add('on');
    row.append(...bs);
    return row;
  };
  const slider = (label: string, v: number, fn: (v: number) => void): HTMLElement => {
    const i = el('input', { type: 'range', min: '0', max: '1', step: '0.01', value: String(v) });
    i.oninput = () => { audio.unlock(); fn(Number(i.value)); };
    return el('label', {}, label, i);
  };

  let positional = false;
  let angle = 0;
  const playAt = (id: string): void => {
    if (!positional) return audio.play(id);
    angle += 0.9;
    audio.play(id, { pos: { x: Math.sin(angle) * 9, y: 1.5, z: -Math.cos(angle) * 9 } });
  };

  section('Mix',
    el('div', { className: 'row' },
      slider('master', game.settings.get('masterVolume'), (v) => game.settings.set('masterVolume', v)),
      slider('music', game.settings.get('musicVolume'), (v) => game.settings.set('musicVolume', v)),
      slider('sfx', game.settings.get('sfxVolume'), (v) => game.settings.set('sfxVolume', v)),
      slider('intensity', 0, (v) => audio.setIntensity(v)),
      slider('muffle', 0, (v) => audio.setMuffle(v, 0.3)),
      btn('duck 3 s', () => audio.duck(0.5, 3)),
      btn('pause', (b) => { const on = b.classList.toggle('on'); game.events.emit('game:paused', { paused: on }); }),
      btn('positional (9 m orbit)', (b) => { positional = b.classList.toggle('on'); }),
      btn('meridian resolved', (b) => audio.setMeridianResolved(b.classList.toggle('on'))),
      btn('cadence irregular', (b) => audio.setCadenceIrregular(b.classList.toggle('on') ? 1 : 0)),
    ));
  section('Music state', radio(MUSIC_STATES, (s) => audio.setMusic(s as MusicState, 2), 'silence'));
  section('Ambience', radio(AMBIENCE_IDS, (s) => audio.setAmbience(s as AmbienceId, 2), 'none'));
  section('Stingers', el('div', { className: 'row' }, ...STINGER_KINDS.map((k) => btn(k, () => audio.stinger(k)))));
  const speakers = ['Tarrik', 'Lyessa', 'Malik', 'Cross', 'Dominion Command', 'Selene', 'Tharne', 'Lyric', 'Sol', 'Reformation Command', 'Medic', 'Survivor', 'Terminal', 'King', 'Narrator'];
  section('speak()', el('div', { className: 'row' },
    ...speakers.map((s) => btn(s, () => audio.speak(s, s === 'Narrator' ? 'narration' : s === 'Terminal' ? 'system' : 'voice'))),
    ...['Tarrik', 'Selene', 'Dominion Command', 'Reformation Command', 'Medic'].map((s) => btn(`${s} (radio)`, () => audio.speak(s, 'radio'))),
    btn('dialogue:line event', () => game.events.emit('dialogue:line', { line: { speaker: 'Lyessa', text: 'Three lanes. They are not guessing.', channel: 'radio' } })),
    btn('cadence tick', () => audio.cadenceTick()),
    btn('cadence tick (irregular)', () => audio.cadenceTick(undefined, true)),
  ));
  const loops = new Map<string, LoopHandle>();
  section('Loops', el('div', { className: 'row' }, ...LOOP_IDS.map((id) => btn(id, (b) => {
    const h = loops.get(id);
    if (h) { h.stop(0.4); loops.delete(id); b.classList.remove('on'); } else { loops.set(id, audio.loop(id)); b.classList.add('on'); }
  })), btn('clear()', () => { audio.clear(); loops.clear(); document.querySelectorAll('section:nth-of-type(6) button.on').forEach((b) => b.classList.remove('on')); })));
  for (const [name, ids] of SFX_GROUPS) {
    section(`SFX · ${name}`, el('div', { className: 'row' }, ...ids.map((id) => btn(id, () => playAt(id)))));
  }
}

// ---------------------------------------------------------------------------------------------------------

/** One or more large spectrograms: `?detail=sfx:swingHeavy,music:combatTarrik,scene:sever`. */
async function detail(specs: string): Promise<void> {
  const list = specs.split(',');
  const secs = Number(q.get('secs') ?? 8);
  const intensity = Number(q.get('intensity') ?? 0.6);
  const h = Math.max(120, Math.min(520, Math.floor(590 / list.length) - 22));
  const out: Record<string, Metrics> = {};
  const s = section('Detail');
  s.id = 'detail';
  for (const spec of list) {
    const [kind, id] = spec.split(':');
    let buf: AudioBuffer;
    if (kind === 'music') buf = await renderMusic(id as MusicState, secs, MUSIC[id as keyof typeof MUSIC]?.fixedIntensity ?? intensity);
    else if (kind === 'ambience') buf = await renderAmbience(id as AmbienceId, secs, undefined, q.has('events'));
    else if (kind === 'stinger') buf = await renderStinger(id);
    else if (kind === 'scene') buf = await renderScene(id);
    else if (kind === 'loop') buf = await renderLoop(id);
    else buf = await renderSfx(id);
    const m = analyze(buf, kind === 'music' || kind === 'ambience' ? 1 : 0);
    out[spec] = m;
    const cv = el('canvas', { className: 'sg', width: 1240, height: h });
    drawSpectrogram(cv, buf);
    const info = el('div', { id: 'summary' });
    info.style.margin = '4px 0 2px';
    info.innerHTML = `<b>${spec}</b> · ${buf.duration.toFixed(2)} s · peak ${m.peakDb} dB · rms ${m.rmsDb} dB · centroid ${m.spectralCentroidHz} Hz · bands ${m.bands.join(' / ')} · stereo ${m.stereo} · audible ${m.durationMs} ms — 40 Hz (bottom) … 16 kHz (top), log`;
    s.append(info, cv);
  }
  W.__detail = out;
}

async function main(): Promise<void> {
  if (q.has('calibrate')) {
    W.__calibration = await calibrate();
    stat.textContent = 'calibration done';
  } else if (q.has('detail')) {
    await detail(q.get('detail') as string);
    stat.textContent = 'detail rendered';
  } else if (q.has('report')) {
    const rows = await buildReport();
    W.__audioReport = rows;
    W.__flagged = rows.filter((r) => r.flags.length).map((r) => `${r.kind}:${r.id} ${r.flags.join(' ')}`);
    showReport(rows);
    stat.textContent = `report: ${rows.length} renders, ${(W.__flagged as string[]).length} flagged`;
  } else {
    buildControls();
  }
  W.__ready = true;
}

main().catch((err) => {
  ((W.__aurelionErrors ??= []) as string[]).push(String(err?.stack ?? err));
  stat.textContent = `error: ${String(err)}`;
  console.error(err);
  W.__ready = true;
});
