/**
 * Selene — Verity (double blade), deflect, Axiom precision weapon, Stasis, Dispatch, Frost.
 * Precise, cool, fast. Frost is glassy, held and quiet: it reads by stillness, not by volume.
 */
import { sfx, type RecipeTable } from './recipe';
import { crack, glass, servo, struck, thump, whoosh } from './parts';

export const SELENE_SFX: RecipeTable = {
  verityWhirl: sfx(-14, { gap: 0.07, max: 3, prio: 2, send: 0.25, vary: 50, tail: 0.25, bake: 3 }, (k) => {
    // two opposed blades: one whoosh that flutters twice per turn, with a faint sung edge
    const flut = k.gain(0.6);
    k.lfo(k.rr(20, 25), 0.4, flut.gain);
    whoosh(k, [[0, 900], [0.1, 2700], [0.22, 1300]], { a: 0.07, h: 0.02, d: 0.14, g: 1 }, 3.2, { to: flut });
    k.noise('pink', { a: 0.06, d: 0.14, g: 0.55 }, { bp: [500, 1100], q: 1 });
    k.fm([1900, 2500, 0.12], 2.01, 0.5, { a: 0.07, d: 0.12, g: 0.07 });
  }),
  verityHit: sfx(-9, { gap: 0.05, max: 3, prio: 2, send: 0.3, tail: 0.2, bake: 3 }, (k) => {
    crack(k, 1, 0, 3200, 0.007);
    k.noise('white', { a: 0.001, d: 0.04, g: 0.55 }, { hp: 4200 }); // the slice
    struck(k, 'blade', k.rr(1600, 1900), 0.18, 0.5);
    thump(k, 210, 110, 0.05, 0.55);
    k.noise('pink', { a: 0.002, d: 0.05, g: 0.3 }, { bp: 900, q: 1.5 });
  }),
  deflect: sfx(-7, { gap: 0.08, max: 2, prio: 3, send: 0.55, vary: 20, tail: 0.6 }, (k) => {
    // crystalline ping with the projectile's pitch bending away — colder and higher than Tarrik's counter
    crack(k, 0.8, 0, 3500, 0.005);
    glass(k, 1568, { a: 0.002, d: 0.7, g: 0.8 });
    glass(k, 2349.3, { a: 0.002, d: 0.5, g: 0.4 }, { at: 0.012 });
    k.fm([2600, 900, 0.09], 1.5, [3, 0.3], { a: 0.002, d: 0.14, g: 0.5 });
    thump(k, 240, 130, 0.05, 0.35);
    k.noise('white', { a: 0.03, d: 0.25, g: 0.05 }, { hp: 8000 });
  }),
  axiomShot: sfx(-7, { gap: 0.1, max: 2, prio: 2, send: 0.5, ref: 6, vary: 25, tail: 0.5, bake: 2 }, (k) => {
    // precision weapon: tight snap, a clean pitched discharge and a cold resonant tail. No bark.
    crack(k, 0.6, 0, 2600, 0.009);
    thump(k, 190, 64, 0.08, 0.85);
    k.osc('sine', [1500, 290, 0.045], { a: 0.001, d: 0.07, g: 0.6 });
    k.noise('white', { a: 0.001, d: 0.03, g: 0.6 }, { bp: 4600, q: 1.3 });
    glass(k, 2637, { a: 0.003, d: 0.22, g: 0.14 }, { at: 0.02 });
    k.noise('pink', { a: 0.01, d: 0.22, g: 0.12 }, { at: 0.03, bp: [5200, 2400], q: 2 });
    k.osc('sine', 62, { a: 0.004, d: 0.12, g: 0.4 });
  }),
  axiomReload: sfx(-17, { gap: 0.4, max: 1, prio: 1, send: 0.15, vary: 15 }, (k) => {
    crack(k, 0.7, 0, 2000, 0.006); // cell out
    struck(k, 'bar', 1300, 0.05, 0.4);
    servo(k, 620, 930, 0.16, 0.35, 0.2);
    crack(k, 0.9, 0.48, 1800, 0.007); // cell seats
    thump(k, 180, 110, 0.05, 0.6, 0.48);
    struck(k, 'bar', 980, 0.07, 0.4, { at: 0.48 });
    crack(k, 0.5, 0.58, 2600, 0.005);
    k.osc('sine', 1568, { a: 0.004, d: 0.14, g: 0.22 }, { at: 0.7 }); // ready
  }),
  stasisThrow: sfx(-17, { gap: 0.2, max: 2, prio: 1, send: 0.25 }, (k) => {
    whoosh(k, [[0, 700], [0.12, 2200], [0.28, 1200]], { a: 0.07, d: 0.2, g: 0.8 }, 2);
    k.osc('sine', [1200, 2400, 0.3], { a: 0.05, d: 0.26, g: 0.2 });
    crack(k, 0.4, 0, 3000, 0.004);
  }),
  stasisField: sfx(-13, { gap: 0.2, max: 2, prio: 2, send: 0.6, vary: 8, loop: true }, (k) => {
    // everything inside stops: air drawn in, then a held cluster that barely moves
    k.noise('white', { a: 0.01, d: 0.4, g: 0.5 }, { hp: [9000, 1400, 0.35] });
    thump(k, 110, 60, 0.18, 0.5, 0.02);
    const hold = { a: 0.08, h: Infinity, d: 1.6 };
    glass(k, 1244.5, { ...hold, g: 0.5 }, { pan: -0.4 });
    glass(k, 1661.2, { ...hold, g: 0.4 }, { pan: 0.4 });
    glass(k, 2489, { ...hold, g: 0.16 });
    k.noise('white', { ...hold, g: 0.035 }, { bp: 6200, q: 6 });
  }),
  dispatch: sfx(-8, { gap: 0.15, max: 2, prio: 3, send: 0.45, vary: 20 }, (k) => {
    // blink-strike: space folds (reverse swell), then the cut arrives all at once
    k.noise('pink', { a: 0.13, d: 0.02, g: 0.8 }, { bp: [400, 5200, 0.13], q: 2 });
    k.osc('sine', [300, 1800, 0.13], { a: 0.12, d: 0.02, g: 0.2 });
    crack(k, 1, 0.14, 2800, 0.008);
    thump(k, 140, 52, 0.14, 0.9, 0.14);
    k.noise('white', { a: 0.001, d: 0.06, g: 0.6 }, { at: 0.14, hp: 3800 });
    struck(k, 'blade', 1700, 0.35, 0.4, { at: 0.14 });
    glass(k, 2349, { a: 0.004, d: 0.5, g: 0.15 }, { at: 0.16 });
  }),
  frostArrest: sfx(-15, { gap: 0.15, max: 2, prio: 3, send: 0.6, vary: 6 }, (k) => {
    // the arrested tone: an ice tick, then a perfectly still chord that simply holds
    crack(k, 0.6, 0, 5000, 0.004);
    k.noise('crackle', { a: 0.001, d: 0.12, g: 0.5 }, { hp: 4500 });
    const hold = { a: 0.015, h: 0.9, d: 0.7 };
    glass(k, 1568, { ...hold, g: 0.7 }, { pan: -0.3 });
    glass(k, 2349.3, { ...hold, g: 0.45 }, { pan: 0.3 });
    glass(k, 3136, { ...hold, g: 0.15 });
    k.osc('sine', 196, { a: 0.05, h: 0.6, d: 0.6, g: 0.12 });
  }),
  frostShatter: sfx(-8, { gap: 0.1, max: 2, prio: 2, send: 0.5, bake: 2 }, (k) => {
    crack(k, 1, 0, 1800, 0.012);
    k.noise('crackle', { a: 0.001, d: 0.35, g: 0.8 }, { hp: 3200 });
    k.noise('crackle', { a: 0.001, d: 0.25, g: 0.8 }, { bp: 1500, q: 0.8, rate: 0.6 }); // the thick pieces
    k.noise('white', { a: 0.001, d: 0.1, g: 0.5 }, { bp: [7000, 3500], q: 1.2 });
    for (let i = 0; i < 8; i++) {
      struck(k, 'glass', k.rr(700, 4200), k.rr(0.08, 0.3), k.rr(0.15, 0.4), { at: k.rr(0, 0.16), pan: k.jit(0.7) });
    }
    thump(k, 150, 76, 0.1, 0.6);
  }),
  scanPulse: sfx(-15, { gap: 0.3, max: 1, prio: 2, send: 0.5, vary: 6 }, (k) => {
    // tactical read: one clean outward ping and the room answering
    const e = k.echo(0.19, 0.42, 0.35);
    k.osc('sine', [523.3, 1046.5, 0.22], { a: 0.02, d: 0.4, g: 0.8 }, { to: e });
    k.osc('sine', 1568, { a: 0.01, d: 0.3, g: 0.2 }, { at: 0.2, to: e });
    k.noise('white', { a: 0.15, d: 0.5, g: 0.1 }, { bp: [1800, 6500, 0.6], q: 3 });
    k.osc('sine', 68, { a: 0.02, d: 0.3, g: 0.35 });
    k.hold(1.1);
  }),
};
