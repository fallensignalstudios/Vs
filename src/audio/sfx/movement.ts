/** Movement foley: footsteps per surface, dodge, cloth, armour. Small, dry, frequent — low priority voices. */
import { sfx, type RecipeTable } from './recipe';
import { crack, struck, thump, whoosh } from './parts';

const STEP = { gap: 0.07, max: 3, prio: 0, send: 0.22, vary: 90, tail: 0.12, bake: 4 } as const;

export const MOVEMENT_SFX: RecipeTable = {
  footStone: sfx(-23, STEP, (k) => {
    // heel: dull knock on polished stone; sole: a short scuff
    thump(k, k.rr(100, 125), 68, 0.07, 0.5);
    k.noise('pink', { a: 0.001, d: 0.05, g: 1 }, { lp: [2400, 600], q: 0.8 });
    crack(k, 0.5, 0, 2400, 0.004);
    k.noise('pink', { a: 0.01, d: 0.06, g: 0.4 }, { at: 0.03, bp: k.rr(1800, 2600), q: 1.5 });
  }),
  footMetal: sfx(-22, STEP, (k) => {
    thump(k, 110, 70, 0.06, 0.8);
    k.noise('brown', { a: 0.001, d: 0.04, g: 0.7 }, { lp: 900 });
    struck(k, 'plate', k.rr(380, 470), 0.11, 0.42, { tilt: 1.2 });
    crack(k, 0.3, 0, 3000, 0.004);
  }),
  footIce: sfx(-23, STEP, (k) => {
    thump(k, 105, 70, 0.05, 0.25);
    k.noise('crackle', { a: 0.001, d: 0.07, g: 1 }, { hp: 2600 });
    k.noise('pink', { a: 0.001, d: 0.04, g: 0.5 }, { bp: 1500, q: 1.2 });
    k.noise('white', { a: 0.002, d: 0.05, g: 0.3 }, { bp: k.rr(4200, 5600), q: 3 });
    k.osc('sine', k.rr(3000, 3800), { a: 0.001, d: 0.035, g: 0.14 });
  }),
  footGrate: sfx(-22, STEP, (k) => {
    thump(k, 105, 72, 0.045, 0.6);
    k.noise('white', { a: 0.001, d: 0.04, g: 0.7 }, { bp: k.rr(1500, 2100), q: 2.4 });
    struck(k, 'bar', k.rr(880, 1080), 0.14, 0.4);
    // the loose panel settles a beat later
    struck(k, 'bar', k.rr(1300, 1650), 0.07, 0.2, { at: k.rr(0.03, 0.05) });
  }),
  dodge: sfx(-15, { gap: 0.15, max: 2, prio: 2, send: 0.2, vary: 50, tail: 0.3, bake: 2 }, (k) => {
    whoosh(k, [[0, 420], [0.09, 2300], [0.26, 700]], { a: 0.05, h: 0.03, d: 0.2, g: 1 }, 1.3);
    k.noise('pink', { a: 0.03, d: 0.16, g: 0.2 }, { lp: [900, 300] });
    thump(k, 100, 62, 0.08, 0.22, 0.2); // plant
    k.noise('pink', { a: 0.004, d: 0.06, g: 0.3 }, { at: 0.2, lp: 1400 });
  }),
  cloth: sfx(-28, { gap: 0.12, max: 2, prio: 0, send: 0.1, vary: 120, tail: 0.1, bake: 3 }, (k) => {
    k.noise('pink', { a: 0.03, d: 0.09, g: 1 }, { bp: [k.rr(1100, 1500), k.rr(2000, 2800)], q: 0.9 });
    k.noise('pink', { a: 0.025, d: 0.11, g: 0.7 }, { at: k.rr(0.07, 0.11), bp: [2400, 1300], q: 0.9 });
  }),
  armorRattle: sfx(-25, { gap: 0.1, max: 2, prio: 0, send: 0.15, vary: 100, tail: 0.1, bake: 3 }, (k) => {
    const n = 3 + Math.floor(k.rnd() * 2);
    for (let i = 0; i < n; i++) {
      const at = i * k.rr(0.022, 0.045);
      struck(k, 'bar', k.rr(1400, 3100), k.rr(0.03, 0.07), k.rr(0.35, 0.8), { at, pan: k.jit(0.3) });
    }
    k.noise('brown', { a: 0.01, d: 0.1, g: 0.5 }, { bp: 520, q: 1.5 }); // leather
  }),
};
