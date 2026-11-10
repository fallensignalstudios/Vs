/**
 * Enemy cues — three families that must never be confused by ear:
 *   Reformation drones: clean, tonal, servo. Exact pitches, tidy envelopes.
 *   Dominion Enforcers: heavy, brassy, electric. Plate + mains buzz + low brass.
 *   Eclipse: breathy and wrong, and *unnaturally identical* — `vary: 0`, no random anywhere, so every body
 *   makes exactly the same sound (the tell the plan asks for before any purple effect).
 */
import { sfx, type RecipeTable } from './recipe';
import { blast, brass, breath, crack, debris, servo, struck, thump, whoosh, wrong, zap } from './parts';

const ECLIPSE = { vary: 0, send: 0.45 } as const;

function bolt(k: Parameters<typeof crack>[0], at: number, g: number): void {
  k.osc('sine', [2300, 520, 0.06], { a: 0.001, d: 0.09, g }, { at });
  k.fm([1150, 300, 0.06], 2, [3, 0.4], { a: 0.001, d: 0.07, g: g * 0.4 }, { at });
  k.noise('white', { a: 0.001, d: 0.03, g: g * 0.4 }, { at, bp: 5200, q: 1.5 });
  k.osc('sine', [240, 110, 0.04], { a: 0.001, d: 0.05, g: g * 0.5 }, { at });
}

export const DRONE_SFX: RecipeTable = {
  droneHum: sfx(-20, { loop: true, max: 6, prio: 0, send: 0.2, vary: 70, ref: 5 }, (k) => {
    const e = { a: 0.3, h: Infinity, d: 0.5 };
    k.osc('triangle', 196, { ...e, g: 0.6 });
    k.osc('sine', 294.4, { ...e, g: 0.4 }); // a slightly wide fifth: slow, clean beating
    k.fm(1176, 2, 0.5, { ...e, g: 0.05 });
    const wash = k.gain(0.7);
    k.lfo(38, 0.3, wash.gain);
    k.noise('pink', { ...e, g: 0.4 }, { to: wash, bp: 820, q: 0.8 });
  }),
  droneCharge: sfx(-13, { gap: 0.12, max: 4, prio: 2, send: 0.3, vary: 15 }, (k) => {
    // the 0.8 s lane telegraph: a clean rising tone whose tremolo tightens toward the volley
    const trem = k.gain(0.7);
    k.lfo(9, 0.3, trem.gain, { dur: 0.45 });
    k.lfo(22, 0.3, trem.gain, { at: 0.45, dur: 0.4 });
    k.osc('triangle', [392, 1568, 0.8], { a: 0.08, h: 0.66, d: 0.06, g: 0.7 }, { to: trem });
    k.fm([784, 3136, 0.8], 2, [0.3, 2.2], { a: 0.2, h: 0.54, d: 0.06, g: 0.25 }, { to: trem });
    k.noise('white', { a: 0.6, h: 0.16, d: 0.05, g: 0.12 }, { bp: [2000, 7000, 0.8], q: 4 });
  }),
  droneVolley: sfx(-10, { gap: 0.2, max: 3, prio: 2, send: 0.4, ref: 5, vary: 15 }, (k) => {
    bolt(k, 0, 1);
    bolt(k, 0.1, 0.92);
    bolt(k, 0.2, 0.96);
    servo(k, 520, 430, 0.12, 0.15, 0.3); // recoil servo settling
  }),
  droneBolt: sfx(-11, { gap: 0.045, max: 5, prio: 1, send: 0.4, ref: 5, vary: 30 }, (k) => bolt(k, 0, 1)),
  droneDeath: sfx(-8, { gap: 0.15, max: 3, prio: 2, send: 0.5, ref: 6 }, (k) => {
    crack(k, 0.9, 0, 1500, 0.015);
    // rotors spin down, the tone stutters, then a small clean pop
    const st = k.gain(0.6);
    k.lfo(17, 0.4, st.gain, { type: 'square' });
    k.osc('sawtooth', [880, 70, 0.6], { a: 0.004, d: 0.7, g: 0.9 }, { to: st, lp: [3600, 400, 0.6] });
    k.osc('triangle', [294, 60, 0.6], { a: 0.004, d: 0.65, g: 0.6 });
    k.noise('crackle', { a: 0.002, d: 0.5, g: 0.9 }, { hp: 3000 });
    blast(k, 0.55, 0.6, 0.38);
    debris(k, 4, 0.5, 0.25, 0.45, 600, 2400);
  }),
  droneAlert: sfx(-13, { gap: 0.5, max: 2, prio: 2, send: 0.35, vary: 5 }, (k) => {
    k.fm(880, 2, 0.5, { a: 0.004, h: 0.09, d: 0.05, g: 0.8 });
    k.fm(1174.7, 2, 0.5, { a: 0.004, h: 0.14, d: 0.1, g: 0.9 }, { at: 0.13 });
    k.osc('sine', 2349, { a: 0.004, d: 0.1, g: 0.12 }, { at: 0.13 });
  }),
};

export const ENFORCER_SFX: RecipeTable = {
  shieldUp: sfx(-11, { gap: 0.15, max: 4, prio: 2, send: 0.4, ref: 5 }, (k) => {
    thump(k, 100, 48, 0.2, 1);
    struck(k, 'plate', 150, 0.4, 0.5, { tilt: 0.9 });
    crack(k, 0.5, 0, 1200, 0.012);
    brass(k, 110, { a: 0.22, h: 0.05, d: 0.25, g: 0.4 }, 7, { at: 0.03 });
    zap(k, 0.25, 0.25, 0.06, 88);
  }),
  shieldHit: sfx(-8, { gap: 0.06, max: 4, prio: 1, send: 0.45, ref: 5 }, (k) => {
    crack(k, 0.9, 0, 1500, 0.014);
    thump(k, 115, 56, 0.16, 0.8);
    struck(k, 'plate', k.rr(170, 200), 0.45, 0.6, { tilt: 0.7 });
    struck(k, 'bar', k.rr(880, 1040), 0.12, 0.3); // the rim rings where the blow landed
    zap(k, 0.18, 0.7, 0.005, 96);
  }),
  shieldBreak: sfx(-5.5, { gap: 0.3, max: 2, prio: 3, send: 0.55, ref: 8 }, (k) => {
    crack(k, 1, 0, 900, 0.03);
    thump(k, 110, 34, 0.5, 1);
    struck(k, 'plate', 172, 0.9, 0.5, { tilt: 0.7 });
    struck(k, 'plate', 243, 0.7, 0.4, { tilt: 0.7, at: 0.03 });
    brass(k, 147, { a: 0.01, d: 0.6, g: 0.5 }, 9); // the field dies with a low blat…
    k.osc('sawtooth', [220, 55, 0.5], { a: 0.01, d: 0.55, g: 0.3 }, { lp: [2400, 300, 0.5] });
    zap(k, 0.55, 0.6, 0.02, 80); // …and discharges
    debris(k, 6, 0.7, 0.3, 0.15, 500, 2200);
  }),
  enforcerStep: sfx(-15, { gap: 0.12, max: 4, prio: 0, send: 0.35, ref: 5, vary: 60 }, (k) => {
    thump(k, 92, 46, 0.16, 0.8);
    k.noise('pink', { a: 0.002, d: 0.09, g: 0.8 }, { lp: [1800, 400] });
    struck(k, 'plate', k.rr(240, 290), 0.14, 0.5, { tilt: 1.1 });
    struck(k, 'bar', k.rr(1700, 2300), 0.05, 0.3, { at: 0.03 });
  }),
  batonZap: sfx(-10, { gap: 0.15, max: 3, prio: 2, send: 0.3, ref: 5 }, (k) => {
    crack(k, 0.9, 0, 2600, 0.008);
    zap(k, 0.32, 1, 0, 92);
    thump(k, 140, 70, 0.08, 0.5);
    k.osc('sine', [3200, 2400], { a: 0.004, d: 0.2, g: 0.06 });
  }),
};

export const ECLIPSE_SFX: RecipeTable = {
  eclipseBreath: sfx(-19, { ...ECLIPSE, loop: true, max: 5, prio: 0 }, (k) => {
    const e = { a: 0.5, h: Infinity, d: 0.8 };
    const am = k.gain(0.5);
    k.lfo(0.42, 0.45, am.gain); // every body breathes at exactly this rate
    breath(k, { ...e, g: 1 }, 0.35, { to: am });
    wrong(k, 92.5, { ...e, g: 0.16 }, { to: am, rate: 0.84 });
  }),
  eclipseLunge: sfx(-10, { ...ECLIPSE, gap: 0.1, max: 4, prio: 2 }, (k) => {
    // a hard intake cut off dead, a wrong chord, and the body landing
    breath(k, { a: 0.2, d: 0.012, g: 1 }, 0.9);
    k.noise('pink', { a: 0.2, d: 0.012, g: 0.5 }, { bp: [300, 2600, 0.2], q: 2.5 });
    wrong(k, 185, { a: 0.004, d: 0.22, g: 0.8 }, { at: 0.2, rate: 47 });
    thump(k, 120, 50, 0.16, 0.9, 0.22);
    k.noise('brown', { a: 0.003, d: 0.1, g: 0.5 }, { at: 0.22, lp: 800 });
  }),
  eclipseDeath: sfx(-10, { ...ECLIPSE, gap: 0.12, max: 3, prio: 2 }, (k) => {
    breath(k, { a: 0.02, d: 0.9, g: 1 }, 0.2);
    k.noise('pink', { a: 0.02, d: 0.85, g: 0.5 }, { bp: [2100, 180, 0.8], q: 2 });
    wrong(k, 138.6, { a: 0.01, d: 0.8, g: 0.4 }, { rate: 23 });
    k.osc('sine', [277.2, 69.3, 0.8], { a: 0.01, d: 0.8, g: 0.3 }, { fixed: true });
    thump(k, 90, 40, 0.25, 0.6, 0.55);
  }),
  wallrunnerSkitter: sfx(-15, { ...ECLIPSE, gap: 0.2, max: 2, prio: 1 }, (k) => {
    // nine contacts, spaced exactly evenly — no living thing moves like that
    for (let i = 0; i < 9; i++) {
      const at = i * 0.047;
      k.noise('white', { a: 0.0008, d: 0.014, g: 0.9 }, { at, bp: 3600, q: 3.5 });
      k.osc('sine', 1480, { a: 0.0008, d: 0.012, g: 0.25 }, { at, fixed: true });
    }
    k.noise('pink', { a: 0.05, h: 0.3, d: 0.1, g: 0.16 }, { bp: 5200, q: 2 }); // dragging
  }),
  wallrunnerPounce: sfx(-9, { ...ECLIPSE, gap: 0.3, max: 2, prio: 3 }, (k) => {
    // telegraph first (the seam sings), then the drop
    k.fm([620, 2900, 0.36], 1.37, [1, 7, 0.36], { a: 0.1, h: 0.24, d: 0.03, g: 0.5 });
    k.noise('white', { a: 0.3, d: 0.05, g: 0.2 }, { bp: [1500, 6500, 0.36], q: 3 });
    whoosh(k, [[0, 2400], [0.16, 500]], { a: 0.02, d: 0.18, g: 0.9 }, 1.6, { at: 0.38 });
    thump(k, 130, 46, 0.2, 1, 0.52);
    crack(k, 0.6, 0.52, 1200, 0.015);
  }),
  weaverChant: sfx(-17, { ...ECLIPSE, loop: true, max: 2, prio: 1, send: 0.6 }, (k) => {
    // two voices a tritone apart through one mouth, pulsing on an exact cadence
    const e = { a: 0.4, h: Infinity, d: 0.9 };
    const pulse = k.gain(0.55);
    k.lfo(2, 0.4, pulse.gain);
    const mouth = k.bank([420, 980, 2500], 9, { to: pulse, gains: [1, 0.7, 0.3], g: 2.6, fixed: true });
    k.osc('sawtooth', 110, { ...e, g: 0.5 }, { to: mouth, fixed: true });
    k.osc('sawtooth', 155.56, { ...e, g: 0.5 }, { to: mouth, fixed: true });
    k.noise('pink', { ...e, g: 0.25 }, { to: mouth });
  }),
  linkHum: sfx(-20, { ...ECLIPSE, loop: true, max: 4, prio: 0, send: 0.3 }, (k) => {
    const e = { a: 0.25, h: Infinity, d: 0.4 };
    wrong(k, 233.1, { ...e, g: 0.7 }, { rate: 7 });
    k.osc('sine', 1864.7, { ...e, g: 0.08 }, { fixed: true });
    k.noise('white', { ...e, g: 0.05 }, { bp: 3730, q: 12 });
  }),
  linkSever: sfx(-7, { gap: 0.15, max: 2, prio: 3, send: 0.6, vary: 12 }, (k) => {
    // a taut line parting: snap, a pitch that falls away, and breath let go
    crack(k, 1, 0, 1600, 0.012);
    k.fm([1250, 140, 0.16], 1.5, [3.5, 0.4], { a: 0.001, d: 0.3, g: 0.9 });
    k.osc('sine', [2500, 280, 0.16], { a: 0.001, d: 0.22, g: 0.25 });
    thump(k, 160, 64, 0.14, 0.85);
    breath(k, { a: 0.06, d: 0.7, g: 0.5 }, 0.8, { at: 0.08 });
    struck(k, 'glass', 2093, 0.6, 0.18, { at: 0.1 });
  }),
  elitePulse: sfx(-7, { ...ECLIPSE, gap: 1, max: 1, prio: 3, send: 0.6, ref: 14 }, (k) => {
    // the announced pressure pulse: it gathers for most of a second so the player can act, then lets go
    k.osc('sine', [36, 62, 0.85], { a: 0.8, d: 0.2, g: 0.5 }, { fixed: true });
    k.noise('brown', { a: 0.8, d: 0.1, g: 0.7 }, { lp: [180, 900, 0.85] });
    breath(k, { a: 0.8, d: 0.1, g: 0.7 }, 0.7);
    wrong(k, 69.3, { a: 0.75, d: 0.15, g: 0.5 }, { rate: 11 });
    thump(k, 120, 46, 0.6, 0.9, 0.9);
    k.noise('brown', { a: 0.01, d: 0.8, g: 0.9 }, { at: 0.9, lp: [1800, 240, 0.7] });
    wrong(k, 138.6, { a: 0.01, d: 0.5, g: 0.3 }, { at: 0.9, rate: 31 });
  }),
  eliteRoar: sfx(-4.5, { ...ECLIPSE, gap: 1.2, max: 1, prio: 3, send: 0.65, ref: 16 }, (k) => {
    const sh = k.shaper('asym', 3);
    const throat = k.bank([330, 880, 2300], 4.5, { to: sh, gains: [1, 0.7, 0.3], g: 2.2, fixed: true });
    const e = { a: 0.12, h: 0.7, d: 0.9 };
    k.osc('sawtooth', [[0, 52], [0.3, 78], [1.1, 61], [1.7, 44]], { ...e, g: 0.6 }, { to: throat, fixed: true });
    k.osc('sawtooth', [[0, 55.1], [0.3, 82.6], [1.1, 64.6], [1.7, 46.6]], { ...e, g: 0.6 }, { to: throat, fixed: true });
    k.noise('pink', { ...e, g: 0.7 }, { to: throat });
    k.noise('brown', { ...e, g: 0.8 }, { to: sh, lp: 420 });
    k.osc('sine', [[0, 44], [0.3, 60], [1.7, 36]], { ...e, g: 0.35 }, { fixed: true });
  }),
  eliteSlam: sfx(-4, { ...ECLIPSE, gap: 0.6, max: 1, prio: 3, send: 0.6, ref: 16 }, (k) => {
    crack(k, 1, 0, 500, 0.04);
    thump(k, 130, 48, 0.8, 0.85);
    k.osc('sine', 40, { a: 0.03, d: 0.7, g: 0.35 }, { at: 0.03, fixed: true });
    k.noise('brown', { a: 0.005, d: 1.1, g: 1 }, { to: k.shaper('soft', 2.4), lp: [2600, 300, 0.9] });
    k.noise('white', { a: 0.003, d: 0.3, g: 0.6 }, { bp: [2400, 600], q: 0.7 });
    k.osc('square', [120, 48, 0.35], { a: 0.003, d: 0.5, g: 0.4 }, { to: k.shaper('hard', 3), lp: 1600, fixed: true });
    // shockwave travelling outward
    whoosh(k, [[0, 300], [0.5, 1500]], { a: 0.3, d: 0.5, g: 0.3 }, 1, { at: 0.08 });
    debris(k, 9, 1.1, 0.35, 0.25);
  }),
  eliteRegen: sfx(-15, { ...ECLIPSE, loop: true, max: 1, prio: 1, send: 0.4, ref: 10 }, (k) => {
    const e = { a: 0.4, h: Infinity, d: 0.8 };
    const pulse = k.gain(0.5);
    k.lfo(3, 0.5, pulse.gain);
    k.noise('brown', { ...e, g: 1 }, { to: pulse, lp: 340, q: 3 });
    k.noise('crackle', { ...e, g: 0.4 }, { to: pulse, bp: 700, q: 1.5, rate: 0.45 }); // wet knitting
    wrong(k, 103.8, { ...e, g: 0.2 }, { to: pulse, rate: 3 });
  }),
  eliteExpose: sfx(-9, { ...ECLIPSE, gap: 0.5, max: 1, prio: 3, send: 0.55, ref: 10 }, (k) => {
    // the joint opens: wet crack, air escaping downward, and a bright exposed note inviting the hit
    crack(k, 0.9, 0, 800, 0.03);
    k.noise('crackle', { a: 0.002, d: 0.3, g: 0.7 }, { bp: 900, q: 1, rate: 0.5 });
    breath(k, { a: 0.03, d: 0.7, g: 0.6 }, 0.9);
    thump(k, 110, 44, 0.25, 0.7);
    k.fm(1108.7, 2.76, [3, 0.4], { a: 0.01, h: 0.5, d: 0.9, g: 0.4 }, { at: 0.12, fixed: true });
    k.osc('sine', 1661.2, { a: 0.01, h: 0.5, d: 0.8, g: 0.18 }, { at: 0.22, fixed: true });
  }),
  // Eclipse cadence clock (AudioSystem.cadenceTick): the regular one is stamped out, the irregular one stumbles
  cadenceTick: sfx(-18, { ...ECLIPSE, gap: 0.08, max: 3, prio: 1 }, (k) => {
    k.noise('white', { a: 0.001, d: 0.035, g: 0.6 }, { bp: 1400, q: 6 });
    k.osc('sine', 207.65, { a: 0.002, d: 0.09, g: 0.5 }, { fixed: true });
    breath(k, { a: 0.004, d: 0.07, g: 0.6 }, 0.2);
  }),
  cadenceTickOff: sfx(-21, { gap: 0.08, max: 3, prio: 1, send: 0.45, vary: 260 }, (k) => {
    k.noise('white', { a: 0.001, d: k.rr(0.02, 0.05), g: 0.8 }, { bp: k.rr(1000, 1900), q: 4 });
    k.osc('sine', [k.rr(180, 240), k.rr(150, 200)], { a: 0.002, d: 0.08, g: 0.5 });
    breath(k, { a: 0.01, d: k.rr(0.06, 0.14), g: 0.5 }, k.rr(0.1, 0.6));
  }),
};
