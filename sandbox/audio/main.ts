/**
 * Audio sandbox.
 *   /sandbox/audio/                  audition page: every SFX, loop, music state, ambience, stinger, speaker
 *   /sandbox/audio/?report=1         offline-render everything and publish window.__audioReport
 *        &only=chain,sfx,loop,music,ambience,stinger,scene,mix,exact,perf   &ids=a,b   &secs=8   &nocold=1
 *   /sandbox/audio/?calibrate=1      measure normalisation → window.__calibration (see write-calibration.mjs)
 *        &only=sfx,music,stinger,ambience   &ids=a,b   &passes=4      (starts from the existing tables)
 *   /sandbox/audio/?detail=music:combatTarrik[&secs=12][&intensity=1]      one or more large spectrograms
 * The page sets window.__ready when the requested work is finished.
 *
 * report.ts explains what each row asserts; calibrate.ts how levels are set; render.ts how renders are made.
 */
import { createAudioSystem } from '@/audio';
import { SFX, SFX_GROUPS } from '@/audio/sfx';
import { MUSIC, MUSIC_STATES } from '@/audio/music/defs';
import { STINGER_KINDS } from '@/audio/music/stingers';
import { AMBIENCE_IDS } from '@/audio/ambience/defs';
import type { AmbienceId, LoopHandle, MusicState } from '@/core/api';
import { miniGame } from '../harness';
import { analyze, drawSpectrogram, type Metrics } from './analyze';
import { calibrate } from './calibrate';
import { LOOP_IDS, renderAmbience, renderLoop, renderMusic, renderScene, renderSfx, renderStinger } from './lab';
import { cut, prepare, prepareMs, toWav } from './render';
import { buildReport, type Row } from './report';

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
const list = (name: string): string[] | null => q.get(name)?.split(',').filter(Boolean) ?? null;

// ---------------------------------------------------------------------------------------------------------
// report view
// ---------------------------------------------------------------------------------------------------------

const BAND_COLORS = ['#5a1616', '#8a5a2b', '#c9a45c', '#a8d8ff', '#ffffff'];
const buffers = new Map<string, AudioBuffer>();

function showReport(rows: Row[]): void {
  const bad = rows.filter((r) => r.flags.length);
  const summary = el('div', { id: 'summary' });
  summary.innerHTML = `<b>${rows.length}</b> rows · <b class="${bad.length ? 'bad' : 'ok'}">${bad.length} flagged</b>` +
    (bad.length ? ` — ${bad.slice(0, 16).map((r) => `${r.id} [${r.flags.join(' ')}]`).join(', ')}` : '') +
    ` · spectrogram: 40 Hz–16 kHz log, 72 dB; blue line = level (−60…0 dBFS)`;
  // contact sheet (paginated for screenshots: __sheet(page))
  const sheet = el('div', { className: 'row' });
  sheet.style.gap = '6px';
  const tiles: HTMLElement[] = [];
  for (const r of rows) {
    const buf = buffers.get(`${r.kind}:${r.id}`);
    if (!buf) continue;
    const wide = r.kind === 'music' || r.kind === 'ambience' || r.kind === 'scene' || r.kind === 'perf';
    const cv = el('canvas', { className: 'sg', width: wide ? 306 : 150, height: 64 });
    drawSpectrogram(cv, buf);
    const cap = el('div', {});
    const level = r.kind === 'sfx' || r.kind === 'stinger' ? `${r.loudDb} ld · ${r.peakDb} pk` : `${r.rmsDb} rms`;
    cap.innerHTML = `<span style="color:${r.flags.length ? 'var(--bad)' : '#f0e6cf'}">${r.id}</span> <span style="color:var(--dim)">${level}${r.flags.length ? ' · ' + r.flags.join(' ') : ''}</span>`;
    cap.style.cssText = `font-size:10px;width:${wide ? 306 : 150}px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis`;
    cv.onclick = () => el('a', { href: URL.createObjectURL(toWav(buf)), download: `${r.kind}-${r.id}.wav` }).click();
    tiles.push(el('div', {}, cv, cap));
  }
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
  table.innerHTML = '<tr><th>id</th><th>kind</th><th>target</th><th>loud</th><th>peak</th><th>rms</th><th>punch</th><th>ms</th><th>centroid</th><th>bands &lt;80 · 250 · 2k · 8k · &gt;</th><th>stereo</th><th>measured</th><th>flags</th></tr>';
  for (const r of rows) {
    const tr = el('tr', { className: r.flags.length ? 'flag' : '' });
    const bands = `<span class="bands">${r.bands.map((b, i) => `<i style="width:${(b * 100).toFixed(1)}%;background:${BAND_COLORS[i]}"></i>`).join('')}</span>`;
    const audio = r.peak > 0 || r.kind !== 'perf';
    const cell = (v: number | string): string => (audio ? String(v) : '');
    tr.innerHTML = `<td class="id">${r.id}</td><td class="kind">${r.kind}</td><td>${r.targetDb ?? ''}</td><td>${cell(r.loudDb)}</td><td>${cell(r.peakDb)}</td><td>${cell(r.rmsDb)}</td><td>${cell(r.punchDb)}</td><td>${cell(r.durationMs)}</td><td>${cell(r.spectralCentroidHz)}</td><td>${audio ? bands : ''}</td><td>${cell(r.stereo)}</td><td class="note">${r.note}</td><td class="flags">${r.flags.join(' ')}</td>`;
    table.append(tr);
  }
  // __table(kind) keeps only one kind of row (screenshots of a section)
  W.__table = (kind: string): number => {
    let n = 0;
    table.querySelectorAll('tr').forEach((tr, i) => {
      const show = i === 0 || !kind || tr.querySelector('.kind')?.textContent === kind;
      (tr as HTMLElement).style.display = show ? '' : 'none';
      if (show) n++;
    });
    sheetSection.style.display = kind ? 'none' : '';
    scrollTo(0, 0);
    return n - 1;
  };
  const sheetSection = section('Report', summary, sheet);
  section('Measurements', table);
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
      ? `ctx ${d.contextState} · voices ${d.voices}/28 · loops ${d.loops}/${d.loopsRequested} · music ${d.music} · ambience ${d.ambience} · intensity ${d.intensity.toFixed(2)} · muffle ${d.muffle.toFixed(2)} · pre-rendered ${d.prerendered}${d.meridianResolved ? ' · meridian resolved' : ''}${d.cadenceIrregular > 0 ? ' · cadence irregular' : ''}`
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
  section('Ambience (also selects the reverb space)', radio(AMBIENCE_IDS, (s) => audio.setAmbience(s as AmbienceId, 2), 'none'));
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
  const loopRow = el('div', { className: 'row' }, ...LOOP_IDS.map((id) => btn(id, (b) => {
    const h = loops.get(id);
    if (h) { h.stop(0.4); loops.delete(id); b.classList.remove('on'); } else { loops.set(id, audio.loop(id)); b.classList.add('on'); }
  })));
  loopRow.append(btn('clear()', () => { audio.clear(); loops.clear(); loopRow.querySelectorAll('button.on').forEach((b) => b.classList.remove('on')); }));
  section('Loops', loopRow);
  for (const [name, ids] of SFX_GROUPS) {
    section(`SFX · ${name}`, el('div', { className: 'row' }, ...ids.map((id) => {
      const b = btn(id, () => playAt(id));
      const r = SFX[id];
      b.title = `${r.db} dB · ${r.exact ? 'exact · ' : ''}${r.bake ? `pre-rendered ×${r.exact ? 1 : r.bake} · ` : ''}tail ${r.tail}`;
      return b;
    })));
  }
}

// ---------------------------------------------------------------------------------------------------------

/** One or more large spectrograms: `?detail=sfx:swingHeavy,music:combatTarrik,scene:sever`. */
async function detail(specs: string): Promise<void> {
  const items = specs.split(',');
  const secs = Number(q.get('secs') ?? 8);
  const intensity = Number(q.get('intensity') ?? 0.6);
  const h = Math.max(120, Math.min(520, Math.floor(590 / items.length) - 22));
  const out: Record<string, Metrics> = {};
  const s = section('Detail');
  s.id = 'detail';
  for (const spec of items) {
    const [kind, id] = spec.split(':');
    let buf: AudioBuffer;
    if (kind === 'music') buf = await renderMusic(id as MusicState, secs, MUSIC[id as keyof typeof MUSIC]?.fixedIntensity ?? intensity);
    else if (kind === 'ambience') buf = await renderAmbience(id as AmbienceId, secs, undefined, q.has('events'));
    else if (kind === 'stinger') buf = await renderStinger(id);
    else if (kind === 'scene') { const r = await renderScene(id); buf = cut(r.buf, r.t0); }
    else if (kind === 'loop') buf = await renderLoop(id);
    else buf = await renderSfx(id);
    const m = analyze(buf, kind === 'music' || kind === 'ambience' ? 1 : 0);
    out[spec] = m;
    const cv = el('canvas', { className: 'sg', width: 1240, height: h });
    drawSpectrogram(cv, buf);
    const info = el('div', { id: 'summary' });
    info.style.margin = '4px 0 2px';
    info.innerHTML = `<b>${spec}</b> · ${buf.duration.toFixed(2)} s · peak ${m.peakDb} · loud ${m.loudDb} · rms ${m.rmsDb} dB · punch ${m.punchDb} dB · centroid ${m.spectralCentroidHz} Hz · bands ${m.bands.join(' / ')} · stereo ${m.stereo} — 40 Hz (bottom) … 16 kHz (top), log`;
    s.append(info, cv);
  }
  W.__detail = out;
}

async function main(): Promise<void> {
  if (q.has('calibrate') || q.has('detail') || q.has('report')) {
    stat.textContent = 'pre-rendering samples and ensemble loops…';
    const e = await prepare();
    W.__prerendered = { samples: e.samples.bakedCount, megabytes: Math.round((e.samples.bakedBytes + e.res.waves.bytes) / 1e5) / 10, waves: e.res.waves.size, milliseconds: prepareMs };
  }
  if (q.has('calibrate')) {
    W.__calibration = await calibrate({
      only: list('only') ?? ['sfx', 'music', 'stinger', 'ambience'], ids: list('ids'), secs: Number(q.get('secs') ?? 8),
      passes: Number(q.get('passes') ?? 4), onProgress: (t) => { stat.textContent = t; },
    });
    stat.textContent = 'calibration done';
  } else if (q.has('detail')) {
    await detail(q.get('detail') as string);
    stat.textContent = 'detail rendered';
  } else if (q.has('report')) {
    const rows = await buildReport({
      only: list('only') ?? ['chain', 'sfx', 'loop', 'music', 'ambience', 'stinger', 'scene', 'mix', 'exact', 'perf'],
      ids: list('ids'), secs: Number(q.get('secs') ?? 8), cold: !q.has('nocold'),
      onProgress: (t) => { stat.textContent = t; }, keep: (k, b) => void buffers.set(k, b),
    });
    W.__audioReport = rows;
    W.__flagged = rows.filter((r) => r.flags.length).map((r) => `${r.kind}:${r.id} ${r.flags.join(' ')}`);
    showReport(rows);
    stat.textContent = `report: ${rows.length} rows, ${(W.__flagged as string[]).length} flagged`;
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
