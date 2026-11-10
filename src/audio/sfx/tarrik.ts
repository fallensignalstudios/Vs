/**
 * Tarrik — Velkorran greatsword, guard/counter, Cinder (roar + crackle), Cinderline sidearm, sticky grenade.
 * Weight first: every swing and impact carries a low body under its transient.
 */
import { sfx, type RecipeTable } from './recipe';
import { blast, crack, debris, embers, roar, struck, thump, whoosh } from './parts';

export const TARRIK_SFX: RecipeTable = {
  swingHeavy: sfx(-10, { gap: 0.12, max: 2, prio: 2, send: 0.3, vary: 45, tail: 0.4, bake: 3 }, (k) => {
    // a metre and a half of steel moving air: slow build, peak late, low body throughout
    whoosh(k, [[0, 220], [0.24, 1300], [0.42, 320]], { a: 0.2, h: 0.04, d: 0.24, g: 1 }, 1.1);
    k.noise('brown', { a: 0.16, h: 0.05, d: 0.26, g: 0.55 }, { lp: [200, 420, 0.25] });
    k.osc('sine', [62, 84, 0.24], { a: 0.18, d: 0.26, g: 0.3 });
    // the edge: a bright sliver right at the apex
    k.noise('white', { a: 0.05, d: 0.09, g: 0.36 }, { at: 0.18, bp: [3200, 5200, 0.1], q: 2 });
    k.fm([190, 240, 0.3], 1.41, 0.4, { a: 0.2, d: 0.2, g: 0.07 });
  }),
  swingLight: sfx(-13, { gap: 0.09, max: 2, prio: 2, send: 0.25, vary: 60, tail: 0.3, bake: 3 }, (k) => {
    whoosh(k, [[0, 380], [0.13, 1900], [0.27, 520]], { a: 0.11, h: 0.02, d: 0.15, g: 1 }, 1.3);
    k.noise('brown', { a: 0.09, d: 0.17, g: 0.4 }, { lp: [260, 480, 0.14] });
    k.osc('sine', [74, 96, 0.13], { a: 0.1, d: 0.15, g: 0.2 });
    k.noise('white', { a: 0.03, d: 0.06, g: 0.3 }, { at: 0.1, bp: 4400, q: 2 });
  }),
  bladeHitFlesh: sfx(-8, { gap: 0.06, max: 3, prio: 2, send: 0.2, tail: 0.2, bake: 3 }, (k) => {
    crack(k, 0.8, 0, 900, 0.014);
    thump(k, 150, 52, 0.17, 0.9);
    k.noise('pink', { a: 0.002, d: 0.13, g: 0.9 }, { lp: [3600, 500] });
    // wet tear
    k.noise('pink', { a: 0.01, d: 0.1, g: 0.6 }, { at: 0.015, bp: [1400, 450], q: 2.2 });
    k.noise('crackle', { a: 0.004, d: 0.08, g: 0.5 }, { at: 0.01, bp: 1100, q: 1, rate: 0.5 });
  }),
  bladeHitMetal: sfx(-7, { gap: 0.06, max: 3, prio: 2, send: 0.4, tail: 0.3, bake: 3 }, (k) => {
    crack(k, 1, 0, 2400, 0.01);
    thump(k, 125, 60, 0.12, 0.8);
    struck(k, 'bar', k.rr(480, 560), 0.55, 0.55);
    struck(k, 'blade', k.rr(1250, 1500), 0.3, 0.3);
    k.noise('white', { a: 0.001, d: 0.045, g: 0.5 }, { hp: 3200 });
    k.noise('crackle', { a: 0.002, d: 0.12, g: 0.25 }, { hp: 4000 }); // sparks
  }),
  bladeHitShield: sfx(-7, { gap: 0.06, max: 3, prio: 2, send: 0.45, ref: 5, tail: 0.35, bake: 3 }, (k) => {
    crack(k, 0.9, 0, 1400, 0.014);
    thump(k, 95, 44, 0.24, 1);
    // tower shield: big dull plate + its powered field complaining
    struck(k, 'plate', k.rr(195, 225), 0.75, 0.6, { tilt: 0.6 });
    struck(k, 'plate', k.rr(610, 680), 0.3, 0.3, { tilt: 0.7 });
    k.noise('white', { a: 0.001, d: 0.05, g: 0.5 }, { hp: 2200 });
    const body = k.comb(108, 0.82, { damp: 1800, g: 0.25, ring: 0.6 });
    k.noise('white', { a: 0.001, d: 0.03, g: 0.9 }, { to: body, lp: 2500 });
    k.noise('crackle', { a: 0.004, d: 0.16, g: 0.5 }, { hp: 2800 });
    k.osc('sawtooth', [96, 84], { a: 0.004, d: 0.18, g: 0.18 }, { hp: 900 });
  }),
  guardBlock: sfx(-8, { gap: 0.07, max: 2, prio: 2, send: 0.3, tail: 0.25, bake: 3 }, (k) => {
    crack(k, 0.7, 0, 1600, 0.01);
    thump(k, 135, 58, 0.15, 1);
    struck(k, 'bar', k.rr(290, 330), 0.2, 0.5, { tilt: 1.6 });
    k.noise('brown', { a: 0.002, d: 0.09, g: 0.7 }, { lp: [1600, 500] });
  }),
  guardPerfect: sfx(-6, { gap: 0.1, max: 2, prio: 3, send: 0.55, vary: 20, tail: 0.7 }, (k) => {
    // the counter: a clean bright ring, a rising glint and one cinder spark — unmistakably different from a block
    crack(k, 0.9, 0, 3000, 0.008);
    thump(k, 160, 70, 0.1, 0.6);
    struck(k, 'blade', 1245, 1.0, 0.7);
    struck(k, 'bar', 830, 0.7, 0.4);
    k.osc('sine', [1660, 3320, 0.09], { a: 0.004, d: 0.22, g: 0.3 });
    embers(k, 0.3, 0.35, 0.02, 3000);
    k.noise('white', { a: 0.06, d: 0.3, g: 0.05 }, { at: 0.03, hp: 7000 });
  }),
  cinderIgnite: sfx(-10, { gap: 0.2, max: 2, prio: 2, send: 0.3 }, (k) => {
    // whoomph: air pulled in, then flame
    k.noise('pink', { a: 0.13, d: 0.3, g: 1 }, { lp: [260, 2600, 0.14], q: 1.2 });
    thump(k, 80, 48, 0.3, 0.6, 0.1);
    roar(k, { a: 0.12, h: 0.1, d: 0.5, g: 0.7 }, 420, 0.08);
    embers(k, 0.7, 0.9, 0.14);
  }),
  cinderSlam: sfx(-4.5, { gap: 0.4, max: 1, prio: 3, send: 0.5, ref: 9, vary: 25, bake: 2 }, (k) => {
    crack(k, 1, 0, 700, 0.03);
    thump(k, 150, 58, 0.55, 0.8);
    k.osc('sine', 44, { a: 0.03, d: 0.6, g: 0.35 }, { at: 0.02 });
    roar(k, { a: 0.01, h: 0.08, d: 1.0, g: 1 }, 520);
    k.noise('white', { a: 0.003, d: 0.26, g: 0.8 }, { bp: [2800, 700], q: 0.7 });
    // stone giving way: a distorted low-mid crunch that reads on any speaker
    k.osc('square', [130, 55, 0.3], { a: 0.003, d: 0.4, g: 0.4 }, { to: k.shaper('hard', 3), lp: 1800 });
    embers(k, 1.2, 0.6, 0.06);
    debris(k, 7, 0.9, 0.35, 0.18);
  }),
  cinderlineShot: sfx(-6, { gap: 0.12, max: 2, prio: 2, send: 0.45, ref: 6, tail: 0.5, bake: 2 }, (k) => {
    // heavy sidearm: a bark with a chest thump, then heat hissing off the barrel
    crack(k, 1, 0, 1100, 0.014);
    thump(k, 180, 62, 0.13, 0.6);
    k.osc('square', [230, 82, 0.06], { a: 0.001, d: 0.09, g: 0.6 }, { to: k.shaper('hard', 2.5), lp: 2800 });
    k.noise('white', { a: 0.001, d: 0.1, g: 1.5 }, { bp: [2400, 800], q: 0.8 });
    k.noise('white', { a: 0.001, d: 0.06, g: 1.1 }, { bp: [4200, 1600], q: 1 });
    k.noise('pink', { a: 0.02, d: 0.3, g: 0.2 }, { at: 0.04, bp: 3200, q: 1.2 });
    embers(k, 0.28, 0.22, 0.05, 3200);
    crack(k, 0.3, 0.11, 2600, 0.005); // action cycling
    struck(k, 'bar', 760, 0.05, 0.14, { at: 0.11 });
  }),
  stickyThrow: sfx(-17, { gap: 0.2, max: 2, prio: 1, send: 0.2 }, (k) => {
    struck(k, 'bar', 1900, 0.06, 0.6); // spoon
    crack(k, 0.5, 0, 2600, 0.005);
    whoosh(k, [[0, 500], [0.11, 1700], [0.27, 800]], { a: 0.08, d: 0.2, g: 0.8 }, 1.6, { at: 0.03 });
  }),
  stickyArm: sfx(-15, { gap: 0.2, max: 2, prio: 2, send: 0.2, vary: 10 }, (k) => {
    // latches on, then three amber warning blips that tighten
    thump(k, 190, 90, 0.06, 0.9);
    struck(k, 'bar', 620, 0.08, 0.5);
    [0.14, 0.33, 0.47].forEach((at, i) => {
      k.osc('square', 1180 + i * 150, { a: 0.003, h: 0.035, d: 0.03, g: 0.4 }, { at, lp: 3200 });
      k.osc('sawtooth', (1180 + i * 150) / 2, { a: 0.003, h: 0.035, d: 0.03, g: 0.25 }, { at, lp: 2000 });
    });
  }),
  stickyBlast: sfx(-4.5, { gap: 0.25, max: 2, prio: 3, send: 0.55, ref: 10, bake: 2 }, (k) => {
    blast(k, 1.1, 1);
    roar(k, { a: 0.02, d: 0.7, g: 0.5 }, 420, 0.03);
    embers(k, 0.9, 0.5, 0.08);
    debris(k, 5, 0.7, 0.25, 0.2);
  }),
};
