/**
 * Devices and world: Reformation emitters/relays/scanners (clean), King-era doors/barriers/apertures (stone
 * mass + pure gold tones), destruction, and the far-off war (fleet impacts, the carrier).
 */
import type { Kit } from '../synth/kit';
import { sfx, type RecipeTable } from './recipe';
import { blast, brass, breath, crack, debris, embers, pure, roar, servo, struck, thump, whoosh, zap } from './parts';

/** Heavy stone-on-stone travel: the body of every ancient door, plate and barrier. */
function stoneSlide(k: Kit, len: number, g: number, at = 0): void {
  const body = k.comb(62, 0.6, { damp: 900, g: 0.5 });
  k.noise('brown', { a: 0.12, h: len - 0.3, d: 0.2, g }, { at, to: body, lp: 420 });
  k.noise('brown', { a: 0.1, h: len - 0.3, d: 0.2, g: g * 0.7 }, { at, lp: 240 });
  k.noise('pink', { a: 0.15, h: len - 0.35, d: 0.2, g: g * 0.25 }, { at, bp: [420, 640, len], q: 2.5 });
}

function seat(k: Kit, at: number, g: number): void {
  thump(k, 84, 36, 0.4, g, at);
  crack(k, g * 0.4, at, 600, 0.03);
  k.noise('brown', { a: 0.004, d: 0.35, g: g * 0.7 }, { at, lp: [1000, 160, 0.3] });
}

export const DEVICE_SFX: RecipeTable = {
  emitterHum: sfx(-19, { loop: true, max: 2, prio: 1, send: 0.3, vary: 0, ref: 5 }, (k) => {
    // command emitter: a clean chord with an exact sync pulse — the thing the drones are listening to
    const e = { a: 0.3, h: Infinity, d: 0.5 };
    const sync = k.gain(0.6);
    k.lfo(3, 0.35, sync.gain, { type: 'square' });
    k.osc('sine', 330, { ...e, g: 0.5 }, { to: sync });
    k.osc('sine', 495, { ...e, g: 0.35 }, { to: sync });
    k.fm(660, 2, 0.7, { ...e, g: 0.2 }, { to: sync });
    k.osc('triangle', 110, { ...e, g: 0.4 });
    k.noise('white', { ...e, g: 0.04 }, { bp: 5280, q: 14 });
  }),
  emitterBreak: sfx(-8, { gap: 0.3, max: 1, prio: 3, send: 0.5, ref: 7 }, (k) => {
    crack(k, 1, 0, 2200, 0.012);
    k.noise('crackle', { a: 0.002, d: 0.5, g: 0.8 }, { hp: 3000 });
    // the sync tone loses its footing: stuttered downward steps
    const st = k.gain(0.6);
    k.lfo(13, 0.4, st.gain, { type: 'square' });
    k.fm([[0, 660], [0.1, 660], [0.12, 440], [0.25, 440], [0.27, 220], [0.5, 110]], 2, 1.2, { a: 0.003, d: 0.6, g: 0.9 }, { to: st });
    blast(k, 0.6, 0.7, 0.05);
    struck(k, 'glass', 2400, 0.4, 0.25, { at: 0.03 });
  }),
  relayHum: sfx(-19, { loop: true, max: 3, prio: 1, send: 0.3, vary: 0, ref: 5 }, (k) => {
    // contaminated relay: a clean carrier with something riding it a few hertz off
    const e = { a: 0.3, h: Infinity, d: 0.5 };
    k.osc('triangle', 140, { ...e, g: 0.6 });
    k.osc('sine', 280, { ...e, g: 0.3 });
    k.osc('sawtooth', 148.3, { ...e, g: 0.2 }, { lp: 700 });
    k.fm(840, 1.5, 1.4, { ...e, g: 0.07 });
    const tick = k.gain(0);
    k.lfo(5.5, 0.5, tick.gain, { type: 'square' });
    k.noise('white', { ...e, g: 0.06 }, { to: tick, bp: 3300, q: 8 });
  }),
  relayDown: sfx(-10, { gap: 0.3, max: 2, prio: 3, send: 0.5, ref: 6 }, (k) => {
    crack(k, 0.8, 0, 1800, 0.012);
    thump(k, 150, 60, 0.12, 0.7);
    k.osc('triangle', [560, 58, 0.8], { a: 0.004, d: 0.9, g: 0.7 });
    k.osc('sawtooth', [593, 61, 0.8], { a: 0.004, d: 0.8, g: 0.25 }, { lp: [2600, 200, 0.8] });
    k.noise('white', { a: 0.004, d: 0.6, g: 0.3 }, { bp: [4200, 700, 0.6], q: 2 });
    struck(k, 'bar', 420, 0.15, 0.5, { at: 0.82 }); // contactor drops out
    thump(k, 120, 70, 0.08, 0.5, 0.82);
  }),
  scanSweep: sfx(-17, { loop: true, gap: 0.2, max: 3, prio: 1, send: 0.35, vary: 0, ref: 6 }, (k) => {
    const e = { a: 0.25, h: Infinity, d: 0.5 };
    const sw = k.filter('bandpass', 2400, 9);
    k.lfo(0.45, 1100, sw.frequency);
    k.noise('white', { ...e, g: 1 }, { to: sw });
    const tone = k.osc('sine', 1760, { ...e, g: 0.1 });
    k.lfo(0.45, 420, tone.frequency);
    k.osc('sine', 220, { ...e, g: 0.12 });
  }),
  scanDetect: sfx(-10, { gap: 0.4, max: 2, prio: 3, send: 0.4, vary: 0 }, (k) => {
    for (const at of [0, 0.14]) {
      k.fm(1480, 2, 1.1, { a: 0.003, h: 0.06, d: 0.05, g: 0.8 }, { at });
      k.osc('square', 740, { a: 0.003, h: 0.06, d: 0.05, g: 0.15 }, { at, lp: 2600 });
    }
    k.osc('sine', [110, 80], { a: 0.004, d: 0.3, g: 0.5 });
    k.noise('white', { a: 0.01, d: 0.35, g: 0.08 }, { at: 0.14, bp: [3000, 6000], q: 3 });
  }),
  networkDown: sfx(-8, { gap: 1, max: 1, prio: 3, send: 0.6, ref: 12, vary: 0 }, (k) => {
    // a whole system letting go: every voice of the chord falls at its own rate, then the floor drops
    [[660, 0.9], [495, 1.15], [330, 1.3], [220, 1.45]].forEach(([f, t], i) => {
      k.osc('triangle', [f, f * 0.12, t], { a: 0.004, d: t + 0.2, g: 0.5 }, { pan: -0.6 + i * 0.4 });
    });
    k.noise('white', { a: 0.01, d: 1.1, g: 0.3 }, { bp: [6000, 400, 1.1], q: 1.5 });
    k.noise('crackle', { a: 0.01, d: 0.9, g: 0.5 }, { hp: 2500 });
    thump(k, 90, 30, 0.7, 1, 1.25);
    k.noise('brown', { a: 0.01, d: 0.8, g: 0.6 }, { at: 1.25, lp: 300 });
  }),
  fireControlCharge: sfx(-11, { gap: 0.5, max: 1, prio: 2, send: 0.4, ref: 8, vary: 0 }, (k) => {
    brass(k, 55, { a: 1.3, h: 0.1, d: 0.12, g: 0.7 }, 14);
    k.osc('sawtooth', [80, 320, 1.4], { a: 1.2, h: 0.2, d: 0.08, g: 0.3 }, { lp: [300, 3400, 1.4] });
    k.noise('white', { a: 1.3, h: 0.1, d: 0.06, g: 0.2 }, { bp: [800, 6000, 1.4], q: 2 });
    for (let i = 0; i < 9; i++) {
      const at = 1.4 * (1 - Math.pow(1 - i / 9, 1.8));
      crack(k, 0.25 + i * 0.03, at, 2600, 0.005);
    }
  }),
  fireControlFire: sfx(-4.5, { gap: 0.6, max: 1, prio: 3, send: 0.65, ref: 16 }, (k) => {
    crack(k, 1, 0, 800, 0.03);
    thump(k, 150, 54, 0.7, 0.85);
    brass(k, 73.4, { a: 0.005, h: 0.05, d: 0.7, g: 0.8 }, 22);
    roar(k, { a: 0.005, h: 0.1, d: 1.1, g: 0.9 }, 520);
    k.noise('white', { a: 0.002, d: 0.25, g: 0.6 }, { bp: [3000, 700], q: 0.7 });
    k.osc('sine', 42, { a: 0.02, d: 0.7, g: 0.3 }, { at: 0.03 });
    zap(k, 0.4, 0.35, 0.02, 70);
    embers(k, 1.0, 0.3, 0.1);
  }),
  cageDestroy: sfx(-5.5, { gap: 0.6, max: 1, prio: 3, send: 0.6, ref: 12 }, (k) => {
    blast(k, 1.2, 1);
    // the containment field collapses in falling steps while the frame rings itself apart
    [[880, 0.5], [622, 0.7], [440, 0.9]].forEach(([f, t], i) => {
      k.fm([f, f * 0.2, t], 1.41, [4, 0.6], { a: 0.004, d: t + 0.2, g: 0.3 }, { at: 0.04 * i, pan: -0.5 + i * 0.5 });
    });
    struck(k, 'plate', 260, 1.2, 0.5, { at: 0.02 });
    struck(k, 'bar', 610, 0.9, 0.3, { at: 0.07 });
    k.noise('crackle', { a: 0.004, d: 1.0, g: 0.6 }, { hp: 2800 });
    debris(k, 10, 1.3, 0.35, 0.2, 400, 2600);
  }),
  panelCommit: sfx(-15, { gap: 0.3, max: 2, prio: 2, send: 0.25, vary: 8 }, (k) => {
    thump(k, 130, 70, 0.1, 1);
    crack(k, 0.5, 0, 1800, 0.008);
    struck(k, 'bar', 540, 0.06, 0.3);
    pure(k, 440, { a: 0.01, d: 0.6, g: 0.5 }, { at: 0.07 });
    pure(k, 660, { a: 0.01, d: 0.7, g: 0.4 }, { at: 0.13 });
  }),
};

export const WORLD_SFX: RecipeTable = {
  doorOpen: sfx(-11, { gap: 0.4, max: 2, prio: 2, send: 0.55, ref: 8, vary: 20 }, (k) => {
    // the seam recognises you (gold tone), then tonnes of stone move
    pure(k, 220, { a: 0.1, h: 0.5, d: 0.9, g: 0.35 });
    pure(k, 330, { a: 0.14, h: 0.4, d: 0.9, g: 0.25 }, { at: 0.06 });
    crack(k, 0.3, 0.1, 500, 0.03);
    stoneSlide(k, 1.15, 0.9, 0.12);
    seat(k, 1.3, 0.8);
  }),
  doorClose: sfx(-10, { gap: 0.4, max: 2, prio: 2, send: 0.55, ref: 8, vary: 20 }, (k) => {
    stoneSlide(k, 1.0, 0.85);
    seat(k, 1.0, 1);
    struck(k, 'plate', 96, 0.8, 0.25, { at: 1.0, tilt: 1.5 });
    pure(k, 165, { a: 0.02, d: 0.8, g: 0.2 }, { at: 1.02 });
  }),
  doorLocked: sfx(-15, { gap: 0.4, max: 1, prio: 2, send: 0.4, vary: 10 }, (k) => {
    thump(k, 110, 60, 0.12, 1);
    thump(k, 100, 55, 0.14, 0.7, 0.13);
    k.noise('brown', { a: 0.003, d: 0.1, g: 0.5 }, { lp: 600 });
    // a pure tone that declines — refusal without a buzzer
    k.osc('sine', [196, 174.6, 0.3], { a: 0.02, d: 0.5, g: 0.5 }, { at: 0.05 });
    k.osc('sine', [392, 349.2, 0.3], { a: 0.02, d: 0.35, g: 0.1 }, { at: 0.05 });
  }),
  barrierUp: sfx(-10, { gap: 0.3, max: 2, prio: 2, send: 0.6, ref: 9, vary: 6 }, (k) => {
    // white-gold isolation barrier: stacked fifths rising into place
    [110, 165, 220, 330, 440].forEach((f, i) => pure(k, f, { a: 0.25 + i * 0.03, h: 0.25, d: 0.8, g: 0.6 - i * 0.07 }, { at: i * 0.09, pan: (i % 2 ? 0.35 : -0.35) }));
    k.noise('white', { a: 0.5, d: 0.5, g: 0.08 }, { bp: [1500, 7000, 0.9], q: 2.5 });
    seat(k, 0.85, 0.6);
  }),
  barrierDown: sfx(-12, { gap: 0.3, max: 2, prio: 2, send: 0.6, ref: 9, vary: 6 }, (k) => {
    [440, 330, 220, 165, 110].forEach((f, i) => pure(k, f, { a: 0.05, h: 0.1, d: 0.7, g: 0.35 + i * 0.06 }, { at: i * 0.08, pan: (i % 2 ? 0.35 : -0.35) }));
    k.noise('white', { a: 0.05, d: 0.7, g: 0.08 }, { bp: [6000, 900, 0.7], q: 2.5 });
    thump(k, 70, 40, 0.3, 0.4, 0.42);
  }),
  quarantineSeal: sfx(-5.5, { gap: 2, max: 1, prio: 3, send: 0.7, ref: 30, vary: 0 }, (k) => {
    // the war is shut outside: one enormous seat, pressure bleeding off, and a single tone left behind
    seat(k, 0, 1.2);
    struck(k, 'plate', 62, 2.2, 0.5, { tilt: 1.2, exact: true });
    k.osc('sine', [48, 30, 1.2], { a: 0.02, d: 2.2, g: 0.8 }, { at: 0.02 });
    k.noise('white', { a: 0.04, d: 1.8, g: 0.4 }, { at: 0.06, hp: [900, 6500, 1.6] });
    k.noise('pink', { a: 0.04, d: 1.3, g: 0.5 }, { at: 0.06, lp: [5000, 250, 1.2] });
    pure(k, 220, { a: 0.6, h: 0.6, d: 2.2, g: 0.22 }, { at: 0.4 });
  }),
  apertureOpen: sfx(-11, { gap: 0.3, max: 3, prio: 2, send: 0.5, ref: 7, vary: 15 }, (k) => {
    // iris: segments release in an accelerating run, then air and light
    for (let i = 0; i < 7; i++) {
      const at = 0.5 * (1 - Math.pow(1 - i / 7, 2));
      crack(k, 0.45, at, 1600, 0.006);
      struck(k, 'bar', 700 + i * 90, 0.07, 0.3, { at, pan: -0.6 + i * 0.2 });
    }
    whoosh(k, [[0, 300], [0.5, 1800]], { a: 0.35, d: 0.45, g: 0.6 }, 1.2, { at: 0.25 });
    thump(k, 90, 50, 0.25, 0.6, 0.52);
    pure(k, 330, { a: 0.1, d: 0.8, g: 0.2 }, { at: 0.5 });
  }),
  breachCrack: sfx(-5.5, { gap: 0.4, max: 2, prio: 3, send: 0.6, ref: 14 }, (k) => {
    crack(k, 1, 0, 1400, 0.02);
    k.noise('white', { a: 0.001, d: 0.09, g: 0.7 }, { bp: 2600, q: 1.2 });
    // metal tearing
    const tear = k.shaper('hard', 2);
    k.fm([[0, 300], [0.15, 900], [0.42, 420]], 1.37, [5, 9, 0.4], { a: 0.01, h: 0.2, d: 0.25, g: 0.4 }, { to: tear, at: 0.03 });
    k.noise('pink', { a: 0.02, h: 0.2, d: 0.25, g: 0.4 }, { at: 0.03, bp: [900, 2200, 0.4], q: 4 });
    thump(k, 90, 30, 0.7, 1, 0.06);
    k.noise('brown', { a: 0.01, d: 0.9, g: 0.8 }, { at: 0.06, lp: [1800, 140, 0.8] });
    debris(k, 8, 1.0, 0.35, 0.3);
  }),
  debrisFall: sfx(-11, { gap: 0.25, max: 2, prio: 1, send: 0.5, ref: 7 }, (k) => {
    debris(k, 11, 1.2, 1, 0, 180, 1200);
    k.noise('pink', { a: 0.2, d: 1.2, g: 0.18 }, { at: 0.2, hp: 3500 }); // dust
    thump(k, 80, 44, 0.2, 0.6, k.rr(0.1, 0.3));
  }),
  explosionSmall: sfx(-6, { gap: 0.12, max: 3, prio: 2, send: 0.55, ref: 9 }, (k) => {
    blast(k, 0.8, 1);
    k.noise('crackle', { a: 0.005, d: 0.4, g: 0.3 }, { at: 0.05, hp: 2500 });
  }),
  explosionLarge: sfx(-4, { gap: 0.3, max: 2, prio: 3, send: 0.7, ref: 18 }, (k) => {
    blast(k, 1.9, 1);
    roar(k, { a: 0.02, h: 0.1, d: 1.3, g: 0.6 }, 300, 0.04);
    debris(k, 10, 1.6, 0.3, 0.3);
    k.noise('brown', { a: 0.5, d: 1.8, g: 0.35 }, { at: 0.3, lp: 160 }); // the room keeps shaking
  }),
  fleetImpact: sfx(-11, { gap: 0.8, max: 2, prio: 1, send: 0.75, ref: 60, vary: 120 }, (k) => {
    // kilometres away, through the hull: no highs survive, and the second arrival comes through the structure
    k.noise('brown', { a: 0.04, d: 1.7, g: 1 }, { lp: [700, 180, 1.2], q: 0.9 });
    k.osc('sine', [66, 38, 0.5], { a: 0.03, d: 1.5, g: 0.6 });
    k.noise('brown', { a: 0.2, d: 1.6, g: 0.5 }, { at: k.rr(0.32, 0.5), lp: 240 });
    k.osc('sine', [52, 34, 0.6], { a: 0.1, d: 1.4, g: 0.35 }, { at: 0.4 });
    struck(k, 'plate', k.rr(48, 60), 1.6, 0.14, { at: 0.45, tilt: 2 });
  }),
  structuralGroan: sfx(-13, { gap: 1.5, max: 1, prio: 1, send: 0.75, ref: 40, vary: 160 }, (k) => {
    // a span the size of a city block taking load
    const sh = k.shaper('soft', 2);
    const res = k.filter('bandpass', [[0, 210], [0.9, 420], [1.8, 260], [2.6, 520]], 9, { to: sh });
    k.fm([[0, 55], [0.8, 49], [1.7, 62], [2.6, 51]], 0.503, [3, 6, 2.6], { a: 0.5, h: 1.4, d: 0.9, g: 1 }, { to: res, type: 'sawtooth' });
    k.noise('brown', { a: 0.6, h: 1.2, d: 0.9, g: 0.6 }, { lp: 130 });
    for (let i = 0; i < 4; i++) struck(k, 'bar', k.rr(160, 420), 0.18, k.rr(0.1, 0.25), { at: k.rr(0.4, 2.4), pan: k.jit(0.7) });
  }),
  carrierPass: sfx(-8, { gap: 3, max: 1, prio: 3, send: 0.6, ref: 80, vary: 0 }, (k) => {
    // seven million tonnes overhead: the sound arrives before the shadow and falls in pitch as it goes
    const e = { a: 2.6, h: 1.2, d: 3.2, lin: true };
    const sh = k.shaper('soft', 1.8);
    const body = k.comb(47, 0.7, { to: sh, damp: 700, g: 0.5 });
    k.osc('sawtooth', [[0, 62], [3, 58], [7, 44]], { ...e, g: 0.5 }, { to: body, lp: [[0, 260], [3.2, 620], [7, 200]] });
    k.osc('sawtooth', [[0, 93.4], [3, 87.4], [7, 66.3]], { ...e, g: 0.3 }, { to: body, lp: 420 });
    k.noise('brown', { ...e, g: 1 }, { to: sh, lp: [[0, 120], [3.2, 520], [7, 110]] });
    k.osc('sine', [[0, 36], [3, 34], [7, 26]], { ...e, g: 0.8 });
    const flut = k.gain(0.5);
    k.lfo(11, 0.3, flut.gain);
    k.noise('pink', { ...e, g: 0.7 }, { to: flut, bp: [[0, 500], [3.2, 1500], [7, 380]], q: 0.9 });
  }),
  carrierClip: sfx(-5.5, { gap: 3, max: 1, prio: 3, send: 0.8, ref: 90, vary: 0 }, (k) => {
    // hull meets tower, a long way up: the scream of the scrape, then the boom arrives late
    const tear = k.shaper('hard', 1.6);
    k.fm([[0, 240], [0.5, 520], [1.4, 180]], 1.37, [4, 10, 1.2], { a: 0.08, h: 0.8, d: 0.7, g: 0.5 }, { to: tear, lp: 2600 });
    k.noise('pink', { a: 0.08, h: 0.8, d: 0.8, g: 0.5 }, { bp: [[0, 700], [0.6, 1900], [1.5, 500]], q: 3.5 });
    thump(k, 70, 24, 1.3, 1.1, 0.55);
    k.noise('brown', { a: 0.02, d: 2.0, g: 1 }, { at: 0.55, lp: [900, 100, 1.6] });
    k.osc('sine', 33, { a: 0.1, d: 2.2, g: 0.7 }, { at: 0.6 });
    debris(k, 9, 1.8, 0.2, 0.9, 150, 900);
  }),
  screamsBelow: sfx(-17, { gap: 3, max: 1, prio: 3, send: 0.9, ref: 40, vary: 0 }, (k) => {
    // far below, many voices at once — carried up the shaft as one smeared cry
    const far = k.filter('lowpass', 2400, 0.7);
    const mouth = k.bank([760, 1180, 2700], 7, { to: far, gains: [1, 0.8, 0.35], g: 2.4, fixed: true });
    for (let i = 0; i < 7; i++) {
      const at = k.rr(0, 1.3);
      const f = k.rr(330, 640);
      const len = k.rr(0.7, 1.5);
      const v = k.osc('sawtooth', [[0, f * 0.85], [len * 0.3, f * k.rr(1.1, 1.35)], [len, f * k.rr(0.6, 0.85)]], { a: len * 0.3, h: len * 0.2, d: len * 0.5, g: k.rr(0.3, 0.6) }, { at, to: mouth, pan: k.jit(0.8), fixed: true });
      k.lfo(k.rr(5, 7), f * 0.025, v.frequency, { at, dur: len + 0.1 });
    }
    k.noise('pink', { a: 0.6, h: 0.8, d: 1.2, g: 0.3 }, { to: mouth });
  }),
  plateLift: sfx(-10, { gap: 0.6, max: 1, prio: 2, send: 0.45, ref: 6 }, (k) => {
    // Tarrik takes the weight: strain, scrape, and the plate coming free
    const sh = k.shaper('soft', 2);
    k.fm([[0, 70], [0.7, 96], [1.4, 82]], 0.5, [2, 5, 1.4], { a: 0.25, h: 0.8, d: 0.4, g: 0.6 }, { to: sh, type: 'sawtooth', lp: 900 });
    k.noise('brown', { a: 0.2, h: 0.9, d: 0.35, g: 0.9 }, { bp: [260, 420, 1.4], q: 3 });
    k.noise('pink', { a: 0.3, h: 0.7, d: 0.3, g: 0.25 }, { bp: [1200, 2400, 1.4], q: 5 });
    debris(k, 4, 0.8, 0.3, 0.5);
    seat(k, 1.5, 0.8);
  }),
  liftMove: sfx(-15, { loop: true, max: 1, prio: 1, send: 0.4, vary: 0, ref: 8 }, (k) => {
    const e = { a: 0.5, h: Infinity, d: 0.8 };
    k.osc('sine', 60, { ...e, g: 0.3 });
    k.osc('triangle', 120.4, { ...e, g: 0.4 });
    pure(k, 220, { ...e, g: 0.1 });
    k.noise('pink', { ...e, g: 0.7 }, { bp: 380, q: 1.5 });
    const rail = k.gain(0);
    k.lfo(1.6, 0.6, rail.gain, { type: 'square' });
    k.noise('white', { ...e, g: 0.07 }, { to: rail, bp: 2100, q: 7 });
  }),
  chairSettle: sfx(-24, { gap: 0.3, max: 2, prio: 1, send: 0.15, vary: 80 }, (k) => {
    k.fm([190, 150, 0.12], 0.51, 4, { a: 0.02, d: 0.14, g: 0.4 }, { lp: 1200 }); // creak
    k.noise('pink', { a: 0.03, d: 0.14, g: 0.5 }, { bp: [1300, 2200], q: 0.9 }); // cloth
    thump(k, 95, 60, 0.08, 0.7, 0.12);
    k.noise('brown', { a: 0.003, d: 0.06, g: 0.4 }, { at: 0.12, lp: 600 });
  }),
  engineSpool: sfx(-10, { gap: 2, max: 2, prio: 2, send: 0.5, ref: 25, vary: 10 }, (k) => {
    const e = { a: 3.2, h: 0.5, d: 0.9, lin: true };
    const sh = k.shaper('soft', 1.6);
    k.osc('sawtooth', [40, 160, 3.6], { ...e, g: 0.5 }, { to: sh, lp: [200, 1500, 3.6] });
    k.osc('sawtooth', [60.3, 241, 3.6], { ...e, g: 0.3 }, { to: sh, lp: [200, 1500, 3.6] });
    k.fm([800, 3200, 3.6], 2, 0.8, { ...e, g: 0.1 }); // turbine whine
    k.noise('pink', { ...e, g: 0.6 }, { hp: [300, 2400, 3.6] });
    k.osc('sine', [30, 52, 3.6], { ...e, g: 0.6 });
    servo(k, 400, 700, 0.3, 0.12, 0.1);
  }),
  shipDepart: sfx(-8, { gap: 3, max: 2, prio: 3, send: 0.65, ref: 50, vary: 10 }, (k) => {
    const e = { a: 0.9, h: 0.8, d: 3.6, lin: true };
    const sh = k.shaper('soft', 2);
    k.osc('sawtooth', [[0, 150], [1.2, 170], [5.3, 70]], { ...e, g: 0.4 }, { to: sh, lp: [[0, 900], [1.2, 2200], [5.3, 300]] });
    k.osc('sawtooth', [[0, 100.4], [1.2, 113.6], [5.3, 46.8]], { ...e, g: 0.4 }, { to: sh, lp: 900 });
    k.noise('brown', { ...e, g: 1 }, { to: sh, lp: [[0, 400], [1.2, 1400], [5.3, 160]] });
    k.noise('pink', { ...e, g: 0.4 }, { bp: [[0, 1500], [1.2, 3200], [5.3, 500]], q: 0.8 });
    k.osc('sine', [[0, 48], [1.2, 55], [5.3, 30]], { ...e, g: 0.7 });
    k.fm([[0, 2400], [1.2, 3000], [5.3, 900]], 2, 0.6, { ...e, g: 0.04 });
  }),
  // breath of pressure escaping — used by ambience events and scripted vents
  ventHiss: sfx(-18, { gap: 0.3, max: 2, prio: 0, send: 0.5, ref: 6, vary: 200 }, (k) => {
    k.noise('white', { a: 0.03, h: k.rr(0.1, 0.5), d: 0.5, g: 1 }, { bp: [k.rr(3000, 5000), k.rr(1800, 2600)], q: 1.4 });
    breath(k, { a: 0.05, d: 0.6, g: 0.3 }, 0.9);
  }),
};
