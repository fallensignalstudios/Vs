/**
 * UI + pickup + combat-feedback cues. Restrained and elegant: the UI speaks in the King-era gold-tone family
 * (pure harmonic partials) so menus feel like part of the ancient structure, never arcade.
 */
import { sfx, type RecipeTable } from './recipe';
import { crack, pure, struck, thump } from './parts';

const UI = { bus: 'ui', send: 0.12, vary: 8, prio: 2 } as const;

export const UI_SFX: RecipeTable = {
  uiMove: sfx(-25, { ...UI, gap: 0.03 }, (k) => {
    k.osc('sine', [1760, 1560], { a: 0.002, d: 0.045, g: 1 });
    k.osc('sine', 3520, { a: 0.001, d: 0.02, g: 0.2 });
  }),
  uiSelect: sfx(-19, UI, (k) => {
    pure(k, 880, { a: 0.003, d: 0.28, g: 1 });
    pure(k, 1320, { a: 0.003, d: 0.34, g: 0.6 }, { at: 0.045 });
  }),
  uiBack: sfx(-21, UI, (k) => {
    pure(k, 660, { a: 0.003, d: 0.2, g: 1 });
    pure(k, 495, { a: 0.003, d: 0.26, g: 0.7 }, { at: 0.05 });
  }),
  uiPrompt: sfx(-21, { ...UI, gap: 0.2 }, (k) => {
    pure(k, 659.3, { a: 0.004, d: 0.16, g: 0.8 });
    pure(k, 987.8, { a: 0.004, d: 0.3, g: 1 }, { at: 0.09 });
  }),
  uiCheckpoint: sfx(-15, { ...UI, send: 0.35, gap: 1 }, (k) => {
    pure(k, 293.7, { a: 0.02, d: 1.6, g: 0.9 }, { pan: -0.2 });
    pure(k, 440, { a: 0.02, d: 1.8, g: 1 }, { at: 0.12, pan: 0.2 });
    pure(k, 880, { a: 0.03, d: 1.4, g: 0.35 }, { at: 0.26 });
    k.noise('white', { a: 0.25, d: 0.9, g: 0.04 }, { hp: 7000 });
  }),
  uiObjective: sfx(-18, { ...UI, send: 0.25, gap: 0.5 }, (k) => {
    [440, 587.3, 659.3].forEach((f, i) => pure(k, f, { a: 0.004, d: 0.3 + i * 0.12, g: 0.7 + i * 0.15 }, { at: i * 0.1, pan: -0.25 + i * 0.25 }));
  }),
  uiChoice: sfx(-16, { ...UI, send: 0.4, gap: 0.5 }, (k) => {
    // suspended dyad that leans both ways and settles on neither
    pure(k, 293.7, { a: 0.18, h: 0.2, d: 1.0, g: 0.9 }, { pan: -0.5 });
    pure(k, 329.6, { a: 0.18, h: 0.2, d: 1.0, g: 0.7 }, { pan: 0.5 });
    pure(k, 440, { a: 0.25, h: 0.1, d: 0.9, g: 0.6 });
  }),
  uiCommit: sfx(-14, { ...UI, send: 0.3, gap: 0.3 }, (k) => {
    thump(k, 120, 62, 0.22, 0.9);
    crack(k, 0.25, 0, 2500, 0.006);
    pure(k, 293.7, { a: 0.004, d: 0.7, g: 0.7 });
    pure(k, 440, { a: 0.004, d: 0.9, g: 0.6 }, { at: 0.03 });
  }),
};

export const FEEDBACK_SFX: RecipeTable = {
  healPickup: sfx(-15, { send: 0.3, gap: 0.2, prio: 2, vary: 10 }, (k) => {
    [392, 493.9, 587.3].forEach((f, i) => pure(k, f, { a: 0.03, d: 0.5 + i * 0.15, g: 0.8 }, { at: i * 0.07 }));
    k.noise('white', { a: 0.12, d: 0.5, g: 0.05 }, { hp: 6000 });
  }),
  ammoPickup: sfx(-17, { gap: 0.15, prio: 2 }, (k) => {
    crack(k, 0.8, 0, 1500, 0.008);
    struck(k, 'bar', 1400, 0.07, 0.5);
    crack(k, 0.6, 0.085, 2200, 0.006);
    struck(k, 'bar', 900, 0.09, 0.6, { at: 0.085 });
    thump(k, 160, 110, 0.05, 0.4, 0.085);
  }),
  echoGain: sfx(-23, { gap: 0.08, max: 2, prio: 1, send: 0.2, vary: 60 }, (k) => {
    k.fm([1320, 1760, 0.06], 2, [1.2, 0.2], { a: 0.003, d: 0.16, g: 1 });
    k.osc('sine', 2640, { a: 0.002, d: 0.07, g: 0.2 });
  }),
  echoFull: sfx(-14, { gap: 1, prio: 2, send: 0.4, vary: 5 }, (k) => {
    [293.7, 440, 587.3, 880].forEach((f, i) => pure(k, f, { a: 0.02 + i * 0.01, d: 0.9, g: 0.8 - i * 0.12 }, { at: i * 0.05, pan: (i % 2 ? 0.3 : -0.3) }));
    k.fm(1760, 3.5, [3, 0.3], { a: 0.002, d: 0.6, g: 0.3 }, { at: 0.2 });
  }),
  playerHit: sfx(-8, { gap: 0.09, max: 2, prio: 3, send: 0.15 }, (k) => {
    thump(k, 150, 58, 0.16, 0.9);
    crack(k, 0.8, 0, 700, 0.02);
    k.noise('pink', { a: 0.002, d: 0.12, g: 0.8 }, { lp: [3200, 500] });
    // a thin ring left in the ear
    k.osc('sine', 3150, { a: 0.01, d: 0.45, g: 0.05 }, { fixed: true });
  }),
  playerLow: sfx(-15, { gap: 0.7, max: 1, prio: 2, send: 0.05, vary: 5 }, (k) => {
    // lub-dub, with enough second harmonic to survive small speakers
    thump(k, 96, 58, 0.16, 1);
    thump(k, 84, 52, 0.2, 0.75, 0.24);
    k.osc('triangle', [190, 116, 0.06], { a: 0.004, d: 0.1, g: 0.3 });
    k.osc('triangle', [168, 104, 0.06], { a: 0.004, d: 0.12, g: 0.22 }, { at: 0.24 });
    k.noise('brown', { a: 0.005, d: 0.1, g: 0.3 }, { lp: 260 });
    k.noise('brown', { a: 0.005, d: 0.1, g: 0.2 }, { at: 0.24, lp: 220 });
  }),
  playerDeath: sfx(-8, { gap: 2, max: 1, prio: 3, send: 0.5, vary: 0 }, (k) => {
    k.osc('sine', [220, 55, 1.4], { a: 0.01, d: 1.8, g: 0.8 });
    k.osc('triangle', [330, 82, 1.4], { a: 0.01, d: 1.5, g: 0.25 });
    thump(k, 90, 30, 0.9, 1, 0.05);
    k.noise('brown', { a: 0.3, d: 1.6, g: 0.5 }, { lp: [900, 120, 1.6] });
  }),
  hitConfirm: sfx(-20, { gap: 0.05, max: 2, prio: 1, send: 0.05 }, (k) => {
    k.noise('white', { a: 0.0006, d: 0.016, g: 1 }, { bp: 2600, q: 2.5 });
    k.osc('sine', [1500, 1100], { a: 0.001, d: 0.03, g: 0.5 });
  }),
  weakPointHit: sfx(-12, { gap: 0.06, max: 2, prio: 2, send: 0.3 }, (k) => {
    crack(k, 0.7, 0, 3000, 0.008);
    struck(k, 'glass', 1760, 0.32, 0.9);
    k.osc('sine', [2640, 3520, 0.05], { a: 0.002, d: 0.14, g: 0.3 });
    thump(k, 220, 120, 0.05, 0.4);
  }),
  staggerBreak: sfx(-8, { gap: 0.15, max: 2, prio: 2, send: 0.35 }, (k) => {
    crack(k, 1, 0, 1200, 0.025);
    thump(k, 120, 42, 0.32, 1);
    k.noise('crackle', { a: 0.002, d: 0.2, g: 0.9 }, { bp: 1800, q: 0.9 });
    struck(k, 'plate', 420, 0.45, 0.4, { tilt: 1.3 });
    k.osc('sawtooth', [300, 90, 0.25], { a: 0.004, d: 0.3, g: 0.25 }, { lp: 1200 });
  }),
};
