/**
 * Recorded score + voice-over sandbox.
 *   /sandbox/audioassets/             audition page: a button per music state (grouped by the recording that
 *                                     carries it), intensity, volumes, duck/pause, the voice-over test line
 *   /sandbox/audioassets/?report=1    offline verification → window.__assetAudioReport (see report.ts)
 *   /sandbox/audioassets/?live=1      drives the real AudioSystem on a live AudioContext through a short
 *                                     script (states, intensity, voice) → window.__assetLive
 * The voice-over test needs `public/audio/vo/<voLineId('_test_', 'Audio assets check. One, two, three.')>.mp3`
 * and a manifest listing it; without them the voice rows report "no recording" (which is itself the fallback).
 * The page sets window.__ready when the requested work is finished.
 */
import { createAudioSystem } from '@/audio';
import { MUSIC_STATES } from '@/audio/music/defs';
import { SCORE_PLAN, TRACKS, TRACK_NAMES } from '@/audio/assets/mapping';
import { voLineId } from '@/audio/assets/voiceId';
import type { AudioDebugInfo, MusicState } from '@/core/api';
import { miniGame } from '../harness';
import { drawSpectrogram } from '../audio/analyze';
import { TEST_LINE, buildAssetReport, type AssetReport } from './report';

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
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------------------------------------
// audition page
// ---------------------------------------------------------------------------------------------------------

function controls(): { audio: ReturnType<typeof createAudioSystem>; game: ReturnType<typeof miniGame> } {
  const game = miniGame(null);
  const audio = createAudioSystem(game);
  let last = performance.now();
  const frame = (): void => {
    const now = performance.now();
    audio.update(Math.min(0.1, (now - last) / 1000));
    last = now;
    const d = audio.debugInfo();
    stat.innerHTML = `context <b>${d.contextState}</b> · state <b>${d.music}</b> · carried by <b>${d.recordedTrack ?? 'generative score'}</b> · intensity <b>${d.intensity.toFixed(2)}</b> · voice <b>${d.voiceLine ?? '—'}</b>`;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // --- music states, grouped by what carries them ---
  const stateButtons = new Map<string, HTMLButtonElement>();
  let fade = 2;
  const setState = (s: MusicState): void => {
    audio.unlock();
    audio.setMusic(s, fade);
    stateButtons.forEach((b, k) => b.classList.toggle('on', k === s));
  };
  const group = (label: string, states: MusicState[], generative = false): HTMLElement => {
    const g = el('div', { className: `group${generative ? ' gen' : ''}` }, el('span', { textContent: label }));
    for (const s of states) {
      const p = SCORE_PLAN[s];
      const b = el('button', { textContent: s, onclick: () => setState(s) });
      b.title = p.track
        ? `${p.track}${p.region === 'whole' ? '' : ` · ${p.region}`} · ${p.gain[0]}…${p.gain[1]} dB · low-pass ${p.tone[0]}…${p.tone[1]} Hz${p.generativeLayers.length ? ` · generative: ${p.generativeLayers.join(', ')}` : ''}`
        : `generative score${p.generativeDb ? ` (${p.generativeDb} dB)` : ''}${p.warm ? ` · warms ${p.warm}` : ''}`;
      stateButtons.set(s, b);
      g.append(b);
    }
    return g;
  };
  const rows = el('div', { className: 'row' });
  for (const t of TRACK_NAMES) rows.append(group(`${t}${TRACKS[t].tune ? ` (+${TRACKS[t].tune} st)` : ''}`, MUSIC_STATES.filter((s) => SCORE_PLAN[s].track === t)));
  rows.append(group('generative', MUSIC_STATES.filter((s) => !SCORE_PLAN[s].track), true));
  const slider = (label: string, value: number, on: (v: number) => void, max = 1): HTMLElement => {
    const out = el('output', { textContent: value.toFixed(2) });
    const input = el('input', { type: 'range', min: '0', max: String(max), step: '0.01', value: String(value) });
    input.oninput = () => {
      out.textContent = Number(input.value).toFixed(2);
      on(Number(input.value));
    };
    return el('label', {}, label, input, out);
  };
  section('Music state → recording', rows, el('div', { className: 'row' },
    slider('intensity', 0, (v) => audio.setIntensity(v)),
    slider('fade s', fade, (v) => { fade = v; }, 8),
    el('button', { textContent: 'stinger: encounterStart', onclick: () => audio.stinger('encounterStart') }),
    el('button', { textContent: 'stinger: revelation', onclick: () => audio.stinger('revelation') }),
    el('button', { textContent: 'meridianComplete', onclick: () => audio.play('meridianComplete') }),
    el('button', { textContent: 'meridian unresolved', onclick: () => audio.setMeridianResolved(false) }),
  ));

  // --- voice-over ---
  const id = voLineId(TEST_LINE[0], TEST_LINE[1]);
  const result = el('span', { textContent: `line id ${id}` });
  result.style.color = 'var(--dim)';
  const say = (label: string, opts: Parameters<typeof audio.voice>[2]): HTMLButtonElement => el('button', {
    textContent: label,
    onclick: () => {
      audio.unlock();
      const seconds = audio.voice(TEST_LINE[0], TEST_LINE[1], opts);
      result.textContent = seconds > 0 ? `voice() → ${seconds.toFixed(2)} s (${id})` : `voice() → 0: no recording for ${id} (callers fall back to speak())`;
    },
  });
  audio.setListener({ x: 0, y: 1.6, z: 0 }, { x: 0, y: 0, z: -1 });
  section('Voice-over', el('div', { className: 'row' },
    say('voice', { channel: 'voice' }), say('voice · 6 m left', { channel: 'voice', pos: { x: -6, y: 1.6, z: 0 } }), say('voice · 6 m right', { channel: 'voice', pos: { x: 6, y: 1.6, z: 0 } }),
    say('voice · 40 m ahead', { channel: 'voice', pos: { x: 0, y: 1.6, z: -40 } }), say('radio', { channel: 'radio' }), say('system', { channel: 'system' }), say('narration', { channel: 'narration' }),
    el('button', { textContent: 'stopVoice(0.15)', onclick: () => audio.stopVoice(0.15) }),
    el('button', { textContent: 'preloadVoices', onclick: () => void audio.preloadVoices([[TEST_LINE[0], TEST_LINE[1]], ['Tarrik', 'A line with no recording.']]).then(() => { result.textContent = 'preloadVoices resolved'; }) }),
    el('button', { textContent: 'dialogue:line (recorded)', onclick: () => { audio.unlock(); game.events.emit('dialogue:line', { line: { speaker: TEST_LINE[0], text: TEST_LINE[1], channel: 'radio' } }); } }),
    el('button', { textContent: 'dialogue:line (no recording → tick)', onclick: () => { audio.unlock(); game.events.emit('dialogue:line', { line: { speaker: 'Lyessa', text: 'Three lanes. They are not guessing.', channel: 'radio' } }); } }),
  ), el('div', { className: 'row' }, result));

  // --- mix ---
  let paused = false;
  section('Mix', el('div', { className: 'row' },
    slider('master', game.settings.get('masterVolume'), (v) => game.settings.set('masterVolume', v)),
    slider('music', game.settings.get('musicVolume'), (v) => game.settings.set('musicVolume', v)),
    slider('sfx + voice', game.settings.get('sfxVolume'), (v) => game.settings.set('sfxVolume', v)),
    el('button', { textContent: 'duck(0.6, 3)', onclick: () => audio.duck(0.6, 3) }),
    el('button', { textContent: 'pause', onclick: (e) => { paused = !paused; game.events.emit('game:paused', { paused }); (e.target as HTMLElement).classList.toggle('on', paused); } }),
    el('button', { textContent: 'swingHeavy (sidechain)', onclick: () => audio.play('swingHeavy') }),
  ));
  const table = el('pre');
  table.innerHTML = MUSIC_STATES.map((s) => {
    const p = SCORE_PLAN[s];
    return `<b>${s.padEnd(15)}</b> ${p.track ? `${p.track}${p.region === 'whole' ? '' : ` [${p.region}]`}  ${p.gain[0]}…${p.gain[1]} dB${p.generativeLayers.length ? `  + generative ${p.generativeLayers.join(', ')}` : ''}` : `generative${p.generativeDb ? ` ${p.generativeDb} dB` : ''}${p.warm ? `  (warms ${p.warm})` : ''}`}`;
  }).join('\n');
  section('The table (src/audio/assets/mapping.ts)', table);
  return { audio, game };
}

// ---------------------------------------------------------------------------------------------------------
// offline report
// ---------------------------------------------------------------------------------------------------------

function showReport(r: AssetReport, buffers: Map<string, { buf: AudioBuffer; seamAt?: number; fade?: number }>): void {
  const summary = el('div', { id: 'summary' });
  summary.innerHTML = `music manifest <b>${r.manifest}</b> · <b>${r.tracks.filter((t) => t.decoded).length}/${r.tracks.length}</b> recordings decoded · voice test clip <b>${r.voice.found ? 'found' : 'missing'}</b> · <b class="${r.flagged.length ? 'bad' : 'ok'}">${r.flagged.length} flagged</b>${r.flagged.length ? ` — ${r.flagged.join('; ')}` : ''}`;
  const tiles = el('div', { className: 'tiles' });
  for (const [key, v] of buffers) {
    const cv = el('canvas', { className: 'sg', width: 300, height: 84 });
    drawSpectrogram(cv, v.buf);
    if (v.seamAt !== undefined && v.fade !== undefined) {
      const g = cv.getContext('2d') as CanvasRenderingContext2D;
      const x0 = (v.seamAt / v.buf.duration) * cv.width;
      const x1 = ((v.seamAt + v.fade) / v.buf.duration) * cv.width;
      g.fillStyle = 'rgba(255,197,107,0.16)';
      g.fillRect(x0, 0, x1 - x0, cv.height);
      g.fillStyle = '#ffc56b';
      g.fillRect(x0, 0, 1, cv.height);
      g.fillRect(x1, 0, 1, cv.height);
    }
    const row = r.tracks.find((t) => `${t.track}:${t.region}` === key);
    const cap = el('div', { className: 'cap' });
    cap.innerHTML = row
      ? `<b>${key}</b> peak ${row.peakDb} · ${row.beforeDb} / ${row.seamDb} / ${row.afterDb} dB${row.flags.length ? ` · <span class="bad">${row.flags.join(' ')}</span>` : ''}`
      : `<b>${key}</b>`;
    tiles.append(el('div', { className: 'tile' }, cv, cap));
  }
  section('Loop seams (12 s through the mix chain; gold band = the 2 s cross-fade) and the voice chains', summary, tiles);

  const t = el('table');
  t.innerHTML = `<tr><th>recording</th><th>states</th><th>file s</th><th>decoded s</th><th>loop from → to</th><th>rate</th><th>period</th><th>bars</th><th>next pass at</th><th>peak dBFS</th><th>before / seam / after dB</th><th>gap dB</th><th>click ×</th><th>flags</th></tr>${
    r.tracks.map((x) => `<tr class="${x.flags.length ? 'flag' : ''}"><td class="id">${x.track}${x.region === 'whole' ? '' : ` [${x.region}]`}</td><td class="l">${x.states.join(', ')}</td><td>${x.manifestSeconds}</td><td>${x.decodedSeconds}</td><td>${x.loop.from} → ${x.loop.to}</td><td>${x.loop.rate}</td><td>${x.loop.periodHeard}</td><td>${x.loop.bars}</td><td>${x.schedule[1] ? `${x.schedule[1].startAt.toFixed(3)} = ${x.schedule[0].handoverAt.toFixed(3)}` : '—'}</td><td>${x.peakDb}</td><td>${x.beforeDb} / ${x.seamDb} / ${x.afterDb}</td><td>${x.gapDb}</td><td>${x.clickRatio}</td><td class="flags">${x.flags.join(' ')}</td></tr>`).join('')}`;
  section('Recordings', t);

  const v = el('table');
  v.innerHTML = `<tr><th>voice channel</th><th>clip s</th><th>voice() returned</th><th>peak dBFS</th><th>rms dB</th><th>loudness dB</th><th>centroid Hz</th><th>&lt;80 / 80–250 / 250–2k / 2k–8k / &gt;8k</th><th>R−L dB</th><th>flags</th></tr>${
    r.voice.rows.map((x) => `<tr class="${x.flags.length ? 'flag' : ''}"><td class="id">${x.channel}</td><td>${x.seconds}</td><td>${x.returned}</td><td>${x.peakDb}</td><td>${x.rmsDb}</td><td>${x.loudDb}</td><td>${x.centroidHz}</td><td>${x.bands.map((b) => b.toFixed(2)).join(' / ')}</td><td>${x.panDb}</td><td class="flags">${x.flags.join(' ')}</td></tr>`).join('')}`;
  section(`Voice-over test line (${r.voice.id}) — speaker placed 6 m to the listener's right`, v);

  const m = el('pre');
  m.innerHTML = Object.entries(r.mapping).map(([s, d]) => `<b>${s.padEnd(15)}</b> ${d}`).join('\n');
  section('State → recording', m);
}

// ---------------------------------------------------------------------------------------------------------
// live script: the real façade on a real AudioContext
// ---------------------------------------------------------------------------------------------------------

async function live(): Promise<void> {
  const { audio } = controls();
  const log: Array<{ step: string } & Partial<AudioDebugInfo> & Record<string, unknown>> = [];
  const snap = (step: string, extra: Record<string, unknown> = {}): void => {
    const d = audio.debugInfo();
    log.push({ step, contextState: d.contextState, music: d.music, recordedTrack: d.recordedTrack, intensity: Math.round(d.intensity * 100) / 100, voiceLine: d.voiceLine, ...extra });
  };
  /** wait until `cond` holds (or `ms` pass) and say how long it took */
  const until = async (cond: () => boolean, ms: number): Promise<number> => {
    const t0 = performance.now();
    while (!cond() && performance.now() - t0 < ms) await sleep(50);
    return Math.round(performance.now() - t0);
  };
  audio.setMusic('title', 1);
  await sleep(600); // the title theme is fetched and decoded before any gesture
  audio.unlock();
  snap('unlocked', { ms: await until(() => audio.debugInfo().recordedTrack === 'main_theme', 8000) });
  audio.setMusic('approachTarrik', 1);
  await sleep(500);
  snap('approachTarrik (generative; warms dominion_combat)');
  audio.setMusic('combatTarrik', 1);
  snap('combatTarrik', { ms: await until(() => audio.debugInfo().recordedTrack === 'dominion_combat', 8000) });
  audio.setIntensity(1);
  await sleep(1200);
  snap('intensity 1');
  const preload0 = performance.now();
  await audio.preloadVoices([[TEST_LINE[0], TEST_LINE[1]], ['Tarrik', 'A line with no recording.']]);
  const returned = audio.voice(TEST_LINE[0], TEST_LINE[1], { channel: 'radio' });
  const again = audio.voice(TEST_LINE[0], TEST_LINE[1]);
  snap('voice (recorded line)', { returned, again, preloadMs: Math.round(performance.now() - preload0) });
  await sleep(700);
  audio.stopVoice(0.15);
  snap('stopVoice', { noRecording: audio.voice('Tarrik', 'A line with no recording.') });
  audio.setMusic('carrier', 1);
  snap('carrier', { ms: await until(() => audio.debugInfo().recordedTrack === 'atrium_carrier', 8000) });
  audio.setMusic('quarantine', 0.5);
  await sleep(300);
  snap('quarantine (generative)');
  audio.setMusic('witness', 1);
  snap('witness', { ms: await until(() => audio.debugInfo().recordedTrack === 'core_witness', 8000) });
  audio.setMusic('silence', 0.3);
  await sleep(600);
  snap('silence');
  W.__assetLive = log;
  const out = el('pre');
  out.textContent = log.map((l) => JSON.stringify(l)).join('\n');
  app.prepend(el('section', {}, el('h2', { textContent: 'Live script (real AudioContext)' }), out));
}

async function main(): Promise<void> {
  if (q.has('report')) {
    const buffers = new Map<string, { buf: AudioBuffer; seamAt?: number; fade?: number }>();
    const report = await buildAssetReport({
      onProgress: (t) => { stat.textContent = t; },
      keep: (key, buf, seamAt, fade) => void buffers.set(key, { buf, seamAt, fade }),
    });
    W.__assetAudioReport = report;
    showReport(report, buffers);
    stat.innerHTML = `report: <b>${report.tracks.length}</b> recordings, <b>${report.voice.rows.length}</b> voice chains, <b class="${report.flagged.length ? 'bad' : 'ok'}">${report.flagged.length} flagged</b>`;
  } else if (q.has('live')) {
    await live();
  } else {
    controls();
  }
  W.__ready = true;
}

main().catch((err) => {
  ((W.__aurelionErrors ??= []) as string[]).push(String(err?.stack ?? err));
  stat.textContent = `error: ${String(err)}`;
  console.error(err);
  W.__ready = true;
});
