/**
 * The renders the sandbox measures: one-shots, loops, score states, ambience beds, stingers and scripted
 * scenes — all through the real engine, all warm (see render.ts).
 */
import { AudioEngine, type NormTables } from '@/audio/engine';
import { SFX } from '@/audio/sfx';
import { MUSIC } from '@/audio/music/defs';
import type { AmbienceId, LoopHandle, MusicState } from '@/core/api';
import { render, renderFull, type RenderOpts, type Rendered } from './render';

export const LOOP_IDS = Object.keys(SFX).filter((id) => SFX[id].loop);
export const ADAPTIVE = (Object.keys(MUSIC) as Exclude<MusicState, 'silence'>[]).filter((s) => MUSIC[s].fixedIntensity === undefined);
/** states whose job is rhythm: they must have punch and top end */
export const COMBAT: readonly string[] = ['combatTarrik', 'combatSelene', 'combatEclipse', 'elite', 'duel', 'carrier'];

const lengthCache = new Map<string, number>();
/** scheduled (dry) length of a one-shot, found by building it on a throwaway context */
export function sfxLength(id: string): number {
  let v = lengthCache.get(id);
  if (v === undefined) {
    const e = new AudioEngine(new OfflineAudioContext(2, 128, 44100), { seed: 7283, samples: false });
    v = e.play(id);
    e.dispose();
    lengthCache.set(id, v);
  }
  return v;
}

type Extra = Partial<Pick<RenderOpts, 'baked' | 'cold' | 'norm'>>;

export const renderSfx = (id: string, extra: Extra = {}, tail = 2.6): Promise<AudioBuffer> =>
  render({ seconds: Math.min(14, sfxLength(id) + tail), setup: (e) => void e.play(id), ...extra });

/** Start a loop, hold it, stop it at `seconds − 1.7` with a 0.4 s fade. */
export const renderLoop = (id: string, extra: Extra = {}, seconds = 4.5): Promise<AudioBuffer> => {
  let h: LoopHandle | null = null;
  return render({
    seconds, stepped: true,
    setup: (e) => { h = e.loop(id); },
    tick: (_e, t) => { if (t >= seconds - 1.7 && h) { h.stop(0.4); h = null; } },
    ...extra,
  });
};

export const musicOpts = (state: MusicState, seconds: number, intensity: number, extra: Partial<RenderOpts> = {}): RenderOpts => ({
  seconds, stepped: true, setup: (e) => { e.setIntensity(intensity, true); e.setMusic(state, 0.1); }, ...extra,
});

export const renderMusic = (state: MusicState, seconds: number, intensity: number, extra: Partial<RenderOpts> = {}): Promise<AudioBuffer> =>
  render(musicOpts(state, seconds, intensity, extra));

export const renderMusicFull = (state: MusicState, seconds: number, intensity: number, extra: Partial<RenderOpts> = {}): Promise<Rendered> =>
  renderFull(musicOpts(state, seconds, intensity, extra));

/** `events` false = bed only (what the loudness target and calibration refer to). */
export const renderAmbience = (id: AmbienceId, seconds: number, norm?: Partial<NormTables>, events = false): Promise<AudioBuffer> =>
  render({ seconds, norm, stepped: true, setup: (e) => { e.ambience.eventsEnabled = events; e.setAmbience(id, 0.1); } });

export const renderStinger = (kind: string, norm?: Partial<NormTables>): Promise<AudioBuffer> =>
  render({ seconds: 7, norm, stepped: true, setup: (e) => e.stinger(kind as never) });

const near = (t: number, at: number): boolean => Math.abs(t - at) < 0.024;

/** The steady stream of cues the perf / headroom scenes fire: an E4-style encounter. */
export const BARRAGE = ['footStone', 'swingHeavy', 'bladeHitFlesh', 'droneBolt', 'droneVolley', 'shieldHit', 'cinderSlam', 'axiomShot', 'verityHit', 'hitConfirm', 'eclipseLunge', 'debrisFall', 'explosionSmall', 'guardBlock', 'enforcerStep', 'playerHit'] as const;
export const ENCOUNTER_LOOPS = ['eliteRegen', 'weaverChant', 'linkHum', 'linkHum', 'eclipseBreath', 'eclipseBreath', 'eclipseBreath'] as const;

/** Scripted scenes: the dynamic behaviour (cross-fades, sever, resolution, voice limiting) under measurement. */
export const SCENES: Record<string, { seconds: number; fps?: number; run(e: AudioEngine, t: number): void; setup(e: AudioEngine): void }> = {
  // approach → combat on a bar line while intensity climbs: the first combat downbeat must be at full level
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
  // a Verity four-hit combo in the atrium (the vast space): the hits must stay four hits
  combo: {
    seconds: 4,
    setup: (e) => { e.ambience.eventsEnabled = false; e.setAmbience('atrium', 0.1); },
    run: (e, t) => {
      [1, 1.22, 1.44, 1.7].forEach((at, i) => { if (near(t, at)) { e.play('verityWhirl'); e.play('verityHit', { delay: 0.06 }); if (i === 3) e.play('bladeHitFlesh', { delay: 0.07 }); } });
    },
  },
  // a full fight at default sliders: the elite score flat out, the crucible bed, seven loops, ~12 cues a second
  fight: {
    seconds: 12, fps: 60,
    setup: (e) => {
      e.setIntensity(1, true); e.setMusic('elite', 0.1); e.setAmbience('crucible', 0.1);
      for (const id of ENCOUNTER_LOOPS) e.loop(id, { pos: { x: 3, y: 1, z: -5 } });
    },
    run: (e, t) => {
      const n = Math.round(t * 60);
      if (n % 5 === 0) { const i = n / 5; e.play(BARRAGE[i % BARRAGE.length], { pos: { x: (i % 7) - 3, y: 1, z: -4 - (i % 5) } }); }
    },
  },
};

export const renderScene = (id: string, extra: Partial<RenderOpts> = {}): Promise<Rendered> => {
  const s = SCENES[id];
  return renderFull({ seconds: s.seconds, fps: s.fps, stepped: true, setup: s.setup, tick: s.run, ...extra });
};
