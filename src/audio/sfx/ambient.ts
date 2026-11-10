/**
 * Small ambience details: the randomly scheduled life of each zone bed (ice ticks, alignment clicks, drips,
 * far servos, murmurs). They are ordinary SFX ids (`amb…`) so zone scripts can also place them by hand.
 */
import { sfx, type RecipeTable } from './recipe';
import { breath, crack, glass, pure, servo, struck, thump, wrong } from './parts';

const AMB = { prio: 0, max: 2, gap: 0.2, send: 0.6, vary: 220 } as const;

export const AMBIENT_SFX: RecipeTable = {
  ambMetalTick: sfx(-24, { ...AMB, bake: 3 }, (k) => {
    // hot metal cooling
    struck(k, 'bar', k.rr(900, 2600), k.rr(0.05, 0.16), 1);
    crack(k, 0.3, 0, 3000, 0.004);
    if (k.rnd() < 0.4) struck(k, 'bar', k.rr(1200, 3000), 0.06, 0.5, { at: k.rr(0.08, 0.22) });
  }),
  ambEmberPop: sfx(-24, { ...AMB, bake: 3 }, (k) => {
    k.noise('crackle', { a: 0.002, d: k.rr(0.08, 0.3), g: 0.7 }, { hp: 1800 });
    k.noise('pink', { a: 0.002, d: 0.06, g: 0.4 }, { bp: k.rr(900, 1500), q: 1 }); // the puff of the pop itself
    thump(k, 180, 90, 0.04, k.rnd() < 0.5 ? 0.45 : 0.15);
  }),
  ambDust: sfx(-27, { ...AMB, ref: 5 }, (k) => {
    k.noise('pink', { a: 0.3, h: k.rr(0.2, 0.8), d: 0.8, g: 1 }, { hp: [5000, 2600] });
    k.noise('crackle', { a: 0.2, d: 1.0, g: 0.5 }, { bp: 2400, q: 1 });
  }),
  ambServoFar: sfx(-26, { ...AMB, ref: 8, vary: 300 }, (k) => {
    servo(k, k.rr(380, 620), k.rr(420, 760), k.rr(0.3, 0.7), 1);
  }),
  ambMurmur: sfx(-28, { ...AMB, ref: 5, vary: 300 }, (k) => {
    // someone speaking low behind a partition: a few vowel shapes, no words
    const n = 2 + Math.floor(k.rnd() * 3);
    for (let i = 0; i < n; i++) {
      const at = i * k.rr(0.16, 0.3);
      const f = k.rr(95, 150);
      const mouth = k.bank([k.rr(400, 700), k.rr(900, 1400), 2500], 6, { gains: [1, 0.6, 0.2], g: 2.5, fixed: true });
      k.osc('sawtooth', [f * 1.06, f * 0.94], { a: 0.04, h: 0.05, d: 0.12, g: 0.6 }, { at, to: mouth });
      k.noise('pink', { a: 0.03, d: 0.12, g: 0.2 }, { at, to: mouth });
    }
  }),
  ambDrip: sfx(-26, { ...AMB, vary: 400, bake: 3 }, (k) => {
    const e = k.echo(0.11, 0.3, 0.3);
    k.osc('sine', [k.rr(900, 1400), k.rr(1800, 2600), 0.03], { a: 0.001, d: 0.06, g: 1 }, { to: e });
    crack(k, 0.2, 0, 3500, 0.003);
    k.hold(0.6);
  }),
  ambMedBeep: sfx(-30, { ...AMB, vary: 0, gap: 0.5 }, (k) => {
    k.osc('sine', 1046.5, { a: 0.004, h: 0.07, d: 0.05, g: 1 });
    k.osc('sine', 2093, { a: 0.004, h: 0.07, d: 0.04, g: 0.1 });
  }),
  ambIceTick: sfx(-25, { ...AMB, gap: 0.1, max: 3, vary: 500, bake: 4 }, (k) => {
    k.noise('crackle', { a: 0.0008, d: k.rr(0.015, 0.06), g: 1 }, { hp: 4000 });
    k.osc('sine', k.rr(3200, 6400), { a: 0.0008, d: k.rr(0.02, 0.08), g: 0.4 });
    if (k.rnd() < 0.3) k.osc('sine', k.rr(4000, 7000), { a: 0.0008, d: 0.03, g: 0.3 }, { at: k.rr(0.03, 0.09) });
  }),
  ambIceCreak: sfx(-24, { ...AMB, ref: 6, vary: 300 }, (k) => {
    // a sheet of ice taking strain: a rising squeak that lets go
    k.fm([[0, 420], [0.5, 760], [0.62, 300]], 1.47, [3, 7, 0.6], { a: 0.08, h: 0.4, d: 0.15, g: 0.6 }, { bp: 1400, q: 2.5 });
    k.noise('crackle', { a: 0.05, h: 0.4, d: 0.2, g: 0.7 }, { hp: 3000 });
    glass(k, k.rr(2200, 3200), { a: 0.002, d: 0.4, g: 0.25 }, { at: 0.6 });
  }),
  ambCommBlip: sfx(-28, { ...AMB, vary: 300, ref: 6 }, (k) => {
    // someone else's radio: squelch, two tones, squelch
    k.noise('white', { a: 0.003, d: 0.04, g: 0.6 }, { bp: 2400, q: 1.5 });
    k.osc('square', k.rr(700, 1100), { a: 0.003, h: 0.05, d: 0.03, g: 0.4 }, { at: 0.05, bp: 1600, q: 2 });
    k.osc('square', k.rr(900, 1400), { a: 0.003, h: 0.07, d: 0.03, g: 0.4 }, { at: 0.14, bp: 1600, q: 2 });
    k.noise('white', { a: 0.003, d: 0.06, g: 0.5 }, { at: 0.26, bp: 2400, q: 1.5 });
  }),
  ambWhisper: sfx(-27, { ...AMB, vary: 0, send: 0.8, ref: 6, exact: true, bake: 1 }, (k) => {
    // not words. The same four breaths, every time, exactly evenly spaced
    for (let i = 0; i < 4; i++) breath(k, { a: 0.06, d: 0.2, g: 1 - i * 0.12 }, 0.75, { at: i * 0.31, pan: i % 2 ? 0.5 : -0.5 });
    wrong(k, 277.2, { a: 0.3, h: 0.6, d: 0.5, g: 0.1 }, { rate: 3.2 });
  }),
  ambRelayClick: sfx(-27, { ...AMB, gap: 0.3, vary: 150, bake: 3 }, (k) => {
    crack(k, 0.45, 0, 1800, 0.008);
    struck(k, 'bar', k.rr(500, 800), 0.09, 0.9);
    k.noise('pink', { a: 0.001, d: 0.03, g: 0.4 }, { bp: 1500, q: 1.5 });
    if (k.rnd() < 0.6) crack(k, 0.3, k.rr(0.05, 0.12), 2200, 0.006);
  }),
  ambZapFar: sfx(-27, { ...AMB, ref: 6 }, (k) => {
    // the buzz carries it; the crackle is a few sparks on top (alone it is all needle and no sound)
    const body = k.filter('bandpass', 2400, 0.9);
    const d = k.rr(0.1, 0.35);
    k.osc('sawtooth', [k.rr(80, 110), 70], { a: 0.003, d, g: 1 }, { to: body, hp: 800 });
    k.noise('white', { a: 0.004, d: d * 0.8, g: 0.3 }, { bp: 3200, q: 1.2 });
    k.noise('crackle', { a: 0.003, d: 0.3, g: 0.4 }, { hp: 2500 });
  }),
  ambChain: sfx(-26, { ...AMB, vary: 300 }, (k) => {
    const n = 2 + Math.floor(k.rnd() * 4);
    for (let i = 0; i < n; i++) struck(k, 'bar', k.rr(700, 1900), k.rr(0.08, 0.25), k.rr(0.4, 1), { at: i * k.rr(0.07, 0.19), pan: k.jit(0.5) });
  }),
  ambVoid: sfx(-30, { ...AMB, vary: 0, send: 0.9, ref: 20, gap: 4, max: 1 }, (k) => {
    // the Wound: an inharmonic shimmer that swells from nowhere and is simply gone
    const e = { a: 2.4, h: 0.6, d: 2.6, lin: true };
    [1, 1.414, 2.236, 3.162].forEach((r, i) => k.osc('sine', 138.6 * r, { ...e, g: 0.5 / (i + 1) }, { pan: i % 2 ? 0.6 : -0.6, fixed: true }));
    k.noise('pink', { ...e, g: 0.25 }, { bp: [300, 900, 5], q: 5 });
  }),
  ambAlignClick: sfx(-26, { ...AMB, gap: 0.15, max: 3, vary: 60, bake: 3 }, (k) => {
    // a mechanism the size of a cathedral moving by a hair
    const n = k.rnd() < 0.35 ? 3 : 1;
    for (let i = 0; i < n; i++) {
      const at = i * 0.085;
      crack(k, 0.4, at, 3500, 0.005);
      struck(k, 'bar', 2900, 0.04, 0.5, { at, exact: true });
      k.osc('sine', 880, { a: 0.002, d: 0.12, g: 0.12 }, { at });
    }
  }),
  ambGoldPing: sfx(-27, { ...AMB, vary: 0, send: 0.8, ref: 8, gap: 1 }, (k) => {
    const f = [293.66, 440, 587.33, 659.25, 880][Math.floor(k.rnd() * 5)];
    pure(k, f, { a: 0.02, d: 2.4, g: 1 });
  }),
  ambConsoleTick: sfx(-31, { ...AMB, vary: 80, send: 0.2, bake: 2 }, (k) => {
    crack(k, 0.8, 0, 2600, 0.004);
    k.osc('sine', k.rr(1300, 1700), { a: 0.002, d: 0.05, g: 0.3 });
  }),
  ambStellar: sfx(-22, { ...AMB, vary: 100, send: 0.5, ref: 60, gap: 5, max: 1 }, (k) => {
    // the star beyond the glass: a roll too low to locate
    const e = { a: 2.2, h: 0.5, d: 3.4, lin: true };
    k.noise('brown', { ...e, g: 1 }, { lp: [110, 220, 3] });
    k.osc('sine', [55, 46, 6], { ...e, g: 0.4 });
  }),
  ambPA: sfx(-28, { ...AMB, vary: 100, send: 0.9, ref: 12, gap: 3, max: 1 }, (k) => {
    // a hangar announcement nobody can make out: chime, then band-limited vowel shapes
    k.fm(659.3, 2, 0.5, { a: 0.004, d: 0.35, g: 0.6 });
    k.fm(523.3, 2, 0.5, { a: 0.004, d: 0.5, g: 0.6 }, { at: 0.22 });
    const horn = k.filter('bandpass', 1300, 2.2);
    for (let i = 0; i < 5; i++) {
      const at = 0.7 + i * k.rr(0.2, 0.3);
      const f = k.rr(110, 160);
      const mouth = k.bank([k.rr(450, 750), k.rr(1000, 1500)], 5, { to: horn, g: 2, fixed: true });
      k.osc('sawtooth', [f * 1.05, f * 0.95], { a: 0.04, h: 0.08, d: 0.1, g: 0.5 }, { at, to: mouth });
    }
  }),
};
