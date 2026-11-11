/**
 * speak(): there is no recorded VO in this build, so each subtitle line opens with a very short comm tone that
 * says *who* by faction timbre and per-speaker pitch — Dominion warm and low, Reformation clean and high,
 * King-era/terminal a pure bell. `radio` wraps it in squelch; `narration` is barely a breath.
 * The ticks are ordinary UI-bus recipes, so they share the voice budget, rate limits and calibration.
 */
import { hashString } from '@/core/mathx';
import type { Kit } from './synth/kit';
import { sfx, type RecipeTable } from './sfx/recipe';
import { brass, pure } from './sfx/parts';

export type SpeakChannel = 'voice' | 'radio' | 'system' | 'narration';
export type Faction = 'dominion' | 'reformation' | 'king' | 'civil';

const FACTION: Readonly<Record<string, Faction>> = {
  tarrik: 'dominion', lyessa: 'dominion', malik: 'dominion', cross: 'dominion', marine: 'dominion', soldier: 'dominion',
  'dominion command': 'dominion', darek: 'dominion',
  selene: 'reformation', tharne: 'reformation', lyric: 'reformation', sol: 'reformation', 'reformation command': 'reformation',
  terminal: 'king', king: 'king', witness: 'king', system: 'king',
  medic: 'civil', survivor: 'civil', narrator: 'civil',
};

/** Semitone offsets a speaker's tick may sit on — all inside the score's D world. */
const DEGREES = [0, 2, 5, 7, 9, 12];

/** Faction and a stable pitch offset for a speaker name. Unknown names get the neutral tick. */
export function speakerVoice(speaker: string): { faction: Faction; semis: number } {
  const key = String(speaker ?? '').trim().toLowerCase();
  const faction = FACTION[key] ?? 'civil';
  // the protagonists sit on their assent pitches (Tarrik D, Selene A); everyone else spreads by name
  const semis = key === 'tarrik' ? 0 : key === 'selene' ? 7 : DEGREES[hashString(key) % DEGREES.length];
  return { faction, semis };
}

/** Which recipe and pitch `speak(speaker, channel)` plays. */
export function speakCue(speaker: string, channel: SpeakChannel): { id: string; pitch: number } {
  const { faction, semis } = speakerVoice(speaker);
  const pitch = Math.pow(2, semis / 12);
  if (channel === 'narration') return { id: 'speakNarration', pitch: 1 };
  if (channel === 'system' || faction === 'king') return { id: 'speakKing', pitch };
  const base = faction === 'dominion' ? 'speakDominion' : faction === 'reformation' ? 'speakReformation' : 'speakCivil';
  return { id: channel === 'radio' ? `${base}Radio` : base, pitch };
}

const TICK = { bus: 'ui', vary: 0, gap: 0.12, max: 2, prio: 2, send: 0.15 } as const;

/** Radio treatment: band-limit the tone and bracket it with squelch. Returns the destination and tone offset. */
function radio(k: Kit, on: boolean): { to: AudioNode | undefined; at: number } {
  if (!on) return { to: undefined, at: 0 };
  k.noise('white', { a: 0.002, d: 0.045, g: 0.45 }, { bp: 2600, q: 1.2, fixed: true });
  k.noise('white', { a: 0.002, d: 0.06, g: 0.35 }, { at: 0.26, bp: 2600, q: 1.2, fixed: true });
  return { to: k.filter('bandpass', 1700, 1.1, { fixed: true }), at: 0.055 };
}

const dominion = (isRadio: boolean) => (k: Kit): void => {
  // warm, low, a little brass: two notes falling
  const { to, at } = radio(k, isRadio);
  brass(k, 196, { a: 0.008, h: 0.03, d: 0.07, g: 0.8 }, 5, { at, to });
  brass(k, 146.8, { a: 0.008, h: 0.04, d: 0.1, g: 0.7 }, 4, { at: at + 0.075, to });
};

const reformation = (isRadio: boolean) => (k: Kit): void => {
  // clean, high, exact: two notes rising
  const { to, at } = radio(k, isRadio);
  k.fm(784, 2, 0.4, { a: 0.003, h: 0.025, d: 0.05, g: 0.8 }, { at, to });
  k.fm(1046.5, 2, 0.4, { a: 0.003, h: 0.03, d: 0.08, g: 0.7 }, { at: at + 0.06, to });
};

const civil = (isRadio: boolean) => (k: Kit): void => {
  const { to, at } = radio(k, isRadio);
  k.osc('triangle', 392, { a: 0.005, h: 0.03, d: 0.09, g: 0.8 }, { at, to });
  k.osc('sine', 784, { a: 0.005, d: 0.06, g: 0.15 }, { at, to });
};

export const SPEAK_SFX: RecipeTable = {
  speakDominion: sfx(-27, TICK, dominion(false)),
  speakDominionRadio: sfx(-26, TICK, dominion(true)),
  speakReformation: sfx(-28, TICK, reformation(false)),
  speakReformationRadio: sfx(-27, TICK, reformation(true)),
  speakCivil: sfx(-29, TICK, civil(false)),
  speakCivilRadio: sfx(-28, TICK, civil(true)),
  speakKing: sfx(-26, { ...TICK, send: 0.4 }, (k) => {
    pure(k, 587.33, { a: 0.004, d: 0.5, g: 0.9 });
    pure(k, 880, { a: 0.004, d: 0.4, g: 0.4 }, { at: 0.05 });
  }),
  // a recorded comm line is bracketed by the radio's squelch alone: the key-up as it starts, the release after
  commOpen: sfx(-31, { ...TICK, send: 0.1 }, (k) => {
    k.noise('white', { a: 0.002, d: 0.05, g: 0.5 }, { bp: 2600, q: 1.2, fixed: true });
    k.osc('square', 1250, { a: 0.001, h: 0.012, d: 0.02, g: 0.12 }, { at: 0.004 });
  }),
  commClose: sfx(-32, { ...TICK, send: 0.1 }, (k) => {
    k.noise('white', { a: 0.002, d: 0.075, g: 0.45 }, { bp: 2300, q: 1.1, fixed: true });
    k.osc('square', [[0, 1050], [0.03, 820]], { a: 0.001, h: 0.01, d: 0.025, g: 0.1 }, { at: 0.01 });
  }),
  speakNarration: sfx(-32, { ...TICK, send: 0.4 }, (k) => {
    k.osc('sine', 146.83, { a: 0.08, d: 0.5, g: 0.8 });
    k.noise('pink', { a: 0.1, d: 0.4, g: 0.15 }, { bp: 900, q: 1 });
  }),
};
