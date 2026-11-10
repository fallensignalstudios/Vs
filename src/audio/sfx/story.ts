/**
 * Story cues. The tonal plan mirrors the score: Tarrik's assent is D (low, warm), Selene's is A (high, cool) —
 * together an open fifth with no third. `meridianComplete` supplies the F♯ and the chord finally resolves.
 * Thermal Fracture keeps Frost's arrested tone and Cinder's impact audibly *separate* before they meet.
 */
import { sfx, type RecipeTable } from './recipe';
import { blast, brass, breath, crack, debris, embers, glass, pure, roar, struck, thump } from './parts';

const D2 = 73.42, A2 = 110, D3 = 146.83, FS3 = 185, A3 = 220, D4 = 293.66, E4 = 329.63, FS4 = 369.99, A4 = 440, B4 = 493.88, D5 = 587.33, E5 = 659.25, FS5 = 739.99, A5 = 880;

const STORY = { prio: 3, vary: 0, send: 0.6 } as const;

export const STORY_SFX: RecipeTable = {
  resonanceWindow: sfx(-13, { ...STORY, gap: 1, max: 1 }, (k) => {
    // the window is open: Frost holds perfectly still above, Cinder's pulse waits underneath
    const hold = { a: 0.05, h: 1.6, d: 0.9 };
    glass(k, E5 * 2, { ...hold, g: 0.5 }, { pan: 0.35 });
    glass(k, B4 * 2, { ...hold, g: 0.6 }, { pan: -0.35 });
    const pulse = k.gain(0.5);
    k.lfo(2.4, 0.5, pulse.gain, { dur: 2.7 });
    brass(k, D2, { a: 0.3, h: 1.4, d: 0.8, g: 0.6 }, 5, { to: pulse });
    k.osc('sine', D2 / 2, { a: 0.3, h: 1.4, d: 0.8, g: 0.5 }, { to: pulse });
  }),
  thermalFracture: sfx(-4, { ...STORY, gap: 2, max: 1, send: 0.7, ref: 20 }, (k) => {
    // 0.00 Frost arrests: a still, isolated chord and nothing else …
    crack(k, 0.3, 0, 5000, 0.004);
    const hold = { a: 0.01, h: 0.42, d: 0.12 };
    glass(k, 1568, { ...hold, g: 0.3 }, { pan: -0.3 });
    glass(k, 2349.3, { ...hold, g: 0.22 }, { pan: 0.3 });
    glass(k, 3136, { ...hold, g: 0.08 });
    // 0.46 … Cinder's impact lands on its own …
    const T = 0.46;
    crack(k, 1, T, 600, 0.03);
    thump(k, 100, 26, 1.0, 1.2, T);
    roar(k, { a: 0.005, h: 0.15, d: 1.4, g: 1 }, 340, T);
    k.osc('sine', 36.7, { a: 0.02, d: 1.6, g: 0.8 }, { at: T + 0.02 });
    brass(k, D2, { a: 0.01, h: 0.1, d: 1.2, g: 0.5 }, 12, { at: T });
    // 0.52 … and only then does the frozen joint let go
    k.noise('crackle', { a: 0.001, d: 0.6, g: 0.8 }, { at: T + 0.06, hp: 3000 });
    for (let i = 0; i < 9; i++) struck(k, 'glass', k.rr(1500, 5200), k.rr(0.1, 0.4), k.rr(0.1, 0.3), { at: T + 0.06 + k.rr(0, 0.25), pan: k.jit(0.8) });
    embers(k, 1.6, 0.5, T + 0.1);
    debris(k, 8, 1.2, 0.3, T + 0.25);
  }),
  recognitionTone: sfx(-12, { ...STORY, gap: 0.5, max: 2, send: 0.7 }, (k) => {
    pure(k, A3, { a: 0.06, h: 0.3, d: 3.0, g: 0.8 }, { pan: -0.2 });
    pure(k, E4, { a: 0.09, h: 0.3, d: 2.8, g: 0.6 }, { at: 0.08, pan: 0.2 });
    pure(k, A4, { a: 0.12, h: 0.2, d: 2.4, g: 0.35 }, { at: 0.18 });
    k.noise('white', { a: 0.4, d: 1.6, g: 0.03 }, { hp: 8000 });
  }),
  assentToneTarrik: sfx(-11, { ...STORY, gap: 0.5, max: 1, send: 0.7 }, (k) => {
    // D: low, warm, a trace of brass in the bloom
    pure(k, D3, { a: 0.08, h: 0.5, d: 2.6, g: 0.9 }, { pan: -0.3 });
    pure(k, D2, { a: 0.12, h: 0.5, d: 2.4, g: 0.5 }, { pan: -0.3 });
    brass(k, D3, { a: 0.4, h: 0.2, d: 1.2, g: 0.12 }, 4, { to: k.pan(-0.3) });
    thump(k, 90, 50, 0.2, 0.3);
  }),
  assentToneSelene: sfx(-11, { ...STORY, gap: 0.5, max: 1, send: 0.7 }, (k) => {
    // A: high, cool, glass in the bloom
    pure(k, A4, { a: 0.05, h: 0.5, d: 2.6, g: 0.9 }, { pan: 0.3 });
    pure(k, A5, { a: 0.08, h: 0.4, d: 2.0, g: 0.3 }, { pan: 0.3 });
    glass(k, A5 * 2, { a: 0.02, h: 0.2, d: 1.4, g: 0.1 }, { pan: 0.3 });
    crack(k, 0.12, 0, 6000, 0.004);
  }),
  meridianAlign: sfx(-14, { ...STORY, gap: 0.3, max: 2, send: 0.55, vary: 4 }, (k) => {
    // fine mechanism finding its seat: evenly decelerating clicks under a stepped search for the right note
    const steps = [D4, E4, A4, B4, D5];
    steps.forEach((f, i) => {
      const at = 0.9 * (1 - Math.pow(1 - i / steps.length, 1.6));
      crack(k, 0.4, at, 3500, 0.004);
      struck(k, 'bar', 2600 + i * 240, 0.03, 0.25, { at, exact: true });
      pure(k, f, { a: 0.006, d: 0.3 + i * 0.1, g: 0.5 }, { at, pan: -0.5 + i * 0.25 });
    });
    thump(k, 150, 90, 0.07, 0.5, 0.95);
    crack(k, 0.6, 0.95, 2000, 0.006);
    pure(k, A4, { a: 0.01, d: 1.0, g: 0.4 }, { at: 0.96 });
  }),
  meridianComplete: sfx(-8, { ...STORY, gap: 3, max: 1, send: 0.8, ref: 30 }, (k) => {
    // 5/5: the third arrives. D major blooms upward from the floor.
    const chord: Array<[number, number]> = [[D2, 0], [A2, 0.05], [D3, 0.12], [FS3, 0.3], [A3, 0.4], [D4, 0.5], [FS4, 0.62], [A4, 0.74], [D5, 0.86], [FS5, 0.98]];
    chord.forEach(([f, at], i) => pure(k, f, { a: 0.25, h: 1.2, d: 3.4 - i * 0.12, g: 0.55 - i * 0.03 }, { at, pan: (i % 2 ? 0.45 : -0.45) * (i / chord.length) }));
    [FS4, A4, D5, FS5, A5].forEach((f, i) => k.fm(f * 2, 3.5, [2.5, 0.2], { a: 0.003, d: 2.2, g: 0.16 }, { at: 0.62 + i * 0.13, pan: -0.6 + i * 0.3 }));
    k.osc('sine', D2 / 2, { a: 0.5, h: 1.2, d: 2.6, g: 0.5 });
    k.noise('white', { a: 0.9, h: 0.6, d: 2.2, g: 0.035 }, { hp: 7500 });
  }),
  boundaryClose: sfx(-10, { ...STORY, gap: 2, max: 1, send: 0.75, ref: 40 }, (k) => {
    // the seam-free boundary closing over the Wound: sound is drawn inward and stops
    k.noise('pink', { a: 1.5, d: 0.08, g: 0.7 }, { hp: [6000, 200, 1.5] });
    k.noise('brown', { a: 1.5, d: 0.08, g: 0.8 }, { lp: [1800, 90, 1.5] });
    pure(k, A3, { a: 0.6, h: 0.5, d: 0.5, g: 0.3 });
    k.osc('sine', [A2, D2, 1.5], { a: 0.5, h: 0.9, d: 0.3, g: 0.6 });
    thump(k, 64, 30, 0.6, 0.9, 1.56);
    pure(k, D3, { a: 0.02, d: 1.6, g: 0.25 }, { at: 1.6 });
  }),
  grammarPropagate: sfx(-12, { ...STORY, gap: 1, max: 1, send: 0.8, ref: 40 }, (k) => {
    // synchronisation running out along the channels: each node answers a little later and a little fainter
    const notes = [D4, A4, E4, B4, D5, A5, E5, B4 * 2, D5 * 2, A5 * 2, E5 * 2];
    notes.forEach((f, i) => {
      const at = 0.07 * i + 0.012 * i * i;
      k.fm(f, 3.5, [2, 0.2], { a: 0.003, d: 1.6, g: 0.55 * Math.pow(0.86, i) }, { at, pan: Math.sin(i * 1.9) * 0.8 });
      pure(k, f / 2, { a: 0.02, d: 1.2, g: 0.2 * Math.pow(0.88, i) }, { at, pan: Math.sin(i * 1.9) * 0.8 });
    });
    k.noise('white', { a: 0.6, d: 2.2, g: 0.04 }, { bp: [3000, 9000, 2.4], q: 2 });
  }),
  witnessEnter: sfx(-8, { ...STORY, gap: 3, max: 1, send: 0.85, ref: 40 }, (k) => {
    // Witness V: a floor of sub, one great bell, and a breath that is not hostile
    k.osc('sine', [30, 36.7, 2], { a: 1.6, h: 0.8, d: 2.2, g: 0.9 });
    struck(k, 'bell', D3, 4.2, 0.7, { at: 1.0, exact: true });
    struck(k, 'bell', A3, 3.4, 0.3, { at: 1.06, exact: true, pan: 0.3 });
    thump(k, 70, 30, 0.6, 0.6, 1.0);
    const e = { a: 1.4, h: 0.9, d: 2.2, lin: true };
    breath(k, { ...e, g: 0.5 }, 0.5);
    pure(k, D3, { ...e, g: 0.3 }, { pan: -0.4 });
    pure(k, A3, { ...e, g: 0.25 }, { pan: 0.4 });
  }),
  witnessSunder: sfx(-5.5, { ...STORY, gap: 3, max: 1, send: 0.8, ref: 40 }, (k) => {
    k.noise('pink', { a: 0.7, d: 0.03, g: 0.7 }, { bp: [300, 4500, 0.7], q: 1.5 });
    k.osc('sine', [D3, D5, 0.7], { a: 0.65, d: 0.03, g: 0.25 });
    const T = 0.74;
    crack(k, 1, T, 900, 0.03);
    blast(k, 1.7, 1, T);
    // the bells come apart: each falls away from pitch at its own rate
    [D4, A4, E5, A5].forEach((f, i) => {
      k.fm([f, f * (0.82 - i * 0.04), 2.2], 3.5, [3, 0.3], { a: 0.003, d: 2.4, g: 0.3 }, { at: T + i * 0.05, pan: -0.7 + i * 0.47 });
    });
    k.noise('crackle', { a: 0.01, d: 1.2, g: 0.4 }, { at: T, hp: 2500 });
  }),
  evidenceExchange: sfx(-15, { ...STORY, gap: 1, max: 1, send: 0.35, prio: 2 }, (k) => {
    // two systems that were never meant to talk: amber answers blue, three times, then one shared dyad
    for (let i = 0; i < 3; i++) {
      const at = i * 0.3;
      brass(k, D4, { a: 0.006, h: 0.05, d: 0.07, g: 0.4 }, 5, { at, to: k.pan(-0.5) });
      k.fm(A5, 2, 0.5, { a: 0.004, h: 0.05, d: 0.07, g: 0.5 }, { at: at + 0.14, pan: 0.5 });
    }
    pure(k, D4, { a: 0.03, d: 1.2, g: 0.6 }, { at: 0.95, pan: -0.25 });
    pure(k, A4, { a: 0.03, d: 1.2, g: 0.6 }, { at: 0.95, pan: 0.25 });
  }),
};
