/**
 * Scripted headless check of the whole combat loop in the sandbox arena: drives the real input system's
 * virtual device through the real tick and asserts outcomes (damage amounts, Echo, ammo, pickups, death).
 * `window.__combatReport()` runs it and returns { ok, checks }.
 */
import type { Actor } from '@/core/api';
import type { CombatSandbox } from './main';

export interface CombatCheck {
  name: string;
  pass: boolean;
  got: unknown;
  want: unknown;
}
export interface CombatReport {
  ok: boolean;
  passed: number;
  failed: number;
  checks: CombatCheck[];
}

const near = (a: number, b: number, eps = 0.01): boolean => Math.abs(a - b) <= eps;

export function runReport(c: CombatSandbox): CombatReport {
  const checks: CombatCheck[] = [];
  const check = (name: string, got: unknown, want: unknown, pass?: boolean): void => {
    checks.push({ name, got, want, pass: pass ?? JSON.stringify(got) === JSON.stringify(want) });
  };
  const T = c.TUNING;
  const p = c.player;
  /** stand `dist` metres south of a dummy, facing it */
  const approach = (t: Actor, dist: number): void => {
    c.place(t.pos.x, t.pos.z + dist, 0);
    c.run(0.05);
  };
  const tap = (a: Parameters<CombatSandbox['press']>[0], wait: number): void => {
    c.press(a);
    c.run(wait);
  };

  // ------------------------------------------------------------------------------------------ Tarrik
  c.reset('tarrik');
  c.ai(false);
  let d = c.dummies;
  check('tarrik kit', [p.actor.maxHp, p.actor.maxPoise, p.getHudState().magSize], [140, 60, 6]);

  approach(d.passive, 1.9);
  let hp = d.passive.hp;
  const drops: number[] = [];
  for (let i = 0; i < 3; i++) {
    tap('attack', 0.95);
    drops.push(Math.round(hp - d.passive.hp));
    hp = d.passive.hp;
  }
  check('tarrik light combo 22/24/34', drops, [22, 24, 34]);
  check('lights give Tarrik no Echo', p.echo, 0);
  c.run(1);
  approach(d.passive, 1.9);
  hp = d.passive.hp;
  tap('heavy', 1.4);
  check('tarrik heavy 55', Math.round(hp - d.passive.hp), 55);
  check('heavy hit +6 Echo', p.echo, 6);
  check('melee hits issued hit-stop', c.time.hitStops >= 4, true);

  // charged heavy
  approach(d.passive, 1.9);
  hp = d.passive.hp;
  c.hold('heavy', true);
  c.run(1.6);
  const charging = p.action;
  c.hold('heavy', false);
  c.run(1.2);
  check('held heavy enters charge', charging, 'charge');
  check('charged heavy ×1.5', hp - d.passive.hp, 55 * T.melee.chargeScale, near(hp - d.passive.hp, 55 * T.melee.chargeScale));

  // guard: block, then a timed press → perfect → counter
  c.echo(0);
  approach(d.swinger, 2.0);
  c.hold('guard', true);
  c.run(0.5);
  let wait = c.swing();
  hp = p.actor.hp;
  c.run(wait + 0.2);
  check('guard blocks the blow', [p.actor.hp, p.echo], [hp, 4]);
  c.hold('guard', false);
  c.run(1.2);
  approach(d.swinger, 2.0);
  wait = c.swing();
  c.run(wait - 0.12);
  c.hold('guard', true);
  c.run(0.3);
  check('perfect guard: no damage, attacker staggered, +22', [p.actor.hp, d.swinger.staggered, p.echo], [hp, true, 26]);
  check('counter prompt on the HUD', p.getHudState().context?.id ?? null, 'counter');
  c.hold('guard', false);
  const foeHp = d.swinger.hp;
  tap('attack', 1.0);
  check('counter riposte lands', foeHp - d.swinger.hp >= T.guard.counterDamage, true);

  // an unguarded blow hurts, and the pickup heals 35
  c.run(2);
  approach(d.swinger, 2.0);
  hp = p.actor.hp;
  wait = c.swing();
  c.run(wait + 0.3);
  check('unguarded blow deals 16', Math.round(hp - p.actor.hp), 16);
  c.spawnPickup(c.game, 'sustain', p.actor.pos);
  c.run(0.2);
  check('sustain pickup heals to full (capped)', p.actor.hp, 140);
  c.hp(60);
  c.spawnPickup(c.game, 'sustain', p.actor.pos);
  c.run(0.2);
  check('sustain pickup +35', p.actor.hp, 95);

  // dodge distance
  c.place(0, 14, 0);
  c.run(0.1);
  const z0 = p.actor.pos.z;
  c.move(0, 1);
  c.run(0.02);
  c.press('dodge');
  c.run(0.05);
  c.move(0, 0);
  c.run(0.9);
  // 0.02 s of running start before the roll is included; the roll itself is 4.5 m
  check('dodge travels ≈ 4.5 m', Math.round((z0 - p.actor.pos.z) * 10) / 10, 4.5, Math.abs(z0 - p.actor.pos.z - 4.5) < 0.35);

  // ranged: two shots at the passive dummy
  c.place(d.passive.pos.x, d.passive.pos.z + 9, 0);
  c.face('passive');
  c.hold('aim', true);
  c.run(0.6);
  c.face('passive');
  c.run(0.1);
  hp = d.passive.hp;
  tap('attack', 0.8);
  tap('attack', 0.8);
  check('Cinderline: ammo 6 → 4, 26 per shot', [p.getHudState().ammo, Math.round(hp - d.passive.hp)], [4, 52]);
  c.hold('aim', false);
  c.run(0.3);

  // Cinder Slam
  c.echo(100);
  approach(d.passive, 2.5);
  hp = d.passive.hp;
  tap('ability1', 1.3);
  check('Cinder Slam: 40 damage, 35 Echo', [Math.round(hp - d.passive.hp), p.echo], [40, 65 + 0]);
  // sticky grenade onto the shield-bearer: unblockable blast
  c.place(d.shield.pos.x, d.shield.pos.z + 8, 0);
  c.face('shield');
  c.run(0.2);
  hp = d.shield.hp;
  tap('ability2', 3.2);
  check('Sticky Grenade blast 60', Math.round(hp - d.shield.hp), 60);

  // ------------------------------------------------------------------------------------------ Selene
  c.reset('selene');
  c.ai(false);
  d = c.dummies;
  check('selene kit', [p.actor.maxHp, p.actor.maxPoise, p.getHudState().magSize], [100, 35, 8]);
  approach(d.passive, 1.6);
  hp = d.passive.hp;
  for (let i = 0; i < 4; i++) tap('attack', 0.42);
  c.run(0.6);
  check('selene combo 14+14+16+22', Math.round(hp - d.passive.hp), 66);
  check('four hits → +8 Echo', p.echo, 8);

  // deflect a bolt back at the drone
  c.echo(0);
  c.place(d.shooter.pos.x, d.shooter.pos.z + 8, 0);
  c.face('shooter');
  c.run(0.3);
  hp = d.shooter.hp;
  const own = p.actor.hp;
  wait = c.shoot();
  c.run(Math.max(0, wait - 0.15));
  c.press('guard');
  c.run(0.6);
  check('deflect returns the bolt', [Math.round(hp - d.shooter.hp), p.actor.hp === own, p.echo >= 15], [18, true, true]);

  // Axiom: weak-point shot on the drone's vent needs the angle; a body shot is 34
  c.place(d.passive.pos.x, d.passive.pos.z + 9, 0);
  c.face('passive');
  c.hold('aim', true);
  c.run(0.6);
  c.face('passive');
  c.run(0.1);
  hp = d.passive.hp;
  tap('attack', 0.6);
  check('Axiom body shot 34, ammo 8 → 7', [Math.round(hp - d.passive.hp), p.getHudState().ammo], [34, 7]);
  c.hold('aim', false);
  c.run(0.3);

  // Stasis, then Dispatch into the arrested target
  c.echo(100);
  c.place(d.passive.pos.x, d.passive.pos.z + 8, 0);
  c.face('passive');
  c.run(0.2);
  tap('ability1', 1.6);
  check('Stasis Grenade freezes', d.passive.frozen, true);
  hp = d.passive.hp;
  c.face('passive');
  tap('ability2', 1.0);
  check('Dispatch vs frozen ×2 = 110', Math.round(hp - d.passive.hp), 110);
  check('Dispatch lands next to the target', p.actor.distanceTo(d.passive) < 2.2, true);
  check('abilities cost 35 + 30 (+2 for the hit)', p.echo, 37);

  // death and checkpoint-style recovery
  let died = 0;
  const off = c.game.events.on('player:died', () => died++);
  c.actors.applyHit(p.actor, { attacker: d.swinger, damage: 999, poise: 0, kind: 'melee', dir: { x: 0, y: 0, z: 1 }, point: p.actor.pos.clone() });
  c.run(0.5);
  check('death', [died, p.actor.alive, p.action], [1, false, 'dead']);
  off();
  p.setProtagonist('selene', { pos: { x: 0, y: 0, z: 7 }, yaw: 0 });
  p.restoreForCheckpoint({ echo: 20 });
  c.run(0.2);
  check('reusable after reload', [p.actor.alive, p.actor.hp, p.echo, p.action], [true, 100, 20, 'free']);

  const failed = checks.filter((x) => !x.pass).length;
  return { ok: failed === 0, passed: checks.length - failed, failed, checks };
}

export interface SoakReport {
  seconds: number;
  frames: number;
  deaths: number;
  resets: number;
  /** frames with a non-finite or out-of-arena position */
  badFrames: number;
  /** distinct player actions seen */
  actions: string[];
  hitStops: number;
  maxSpeed: number;
  warnings: string[];
  errors: string[];
}

/**
 * Soak: random virtual input (movement, every button, holds, look) against the live dummies for `seconds` of
 * frames, with protagonist swaps and respawns. Finds exceptions, NaNs, escapes from the arena and stuck states.
 */
export function runSoak(c: CombatSandbox, seconds = 60, seed = 1): SoakReport {
  let a = seed >>> 0;
  const rnd = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const warnings: string[] = [];
  const errors: string[] = [];
  const cw = console.warn;
  const ce = console.error;
  console.warn = (...args: unknown[]) => { if (warnings.length < 12) warnings.push(args.map(String).join(' ').slice(0, 200)); };
  console.error = (...args: unknown[]) => { if (errors.length < 12) errors.push(args.map(String).join(' ').slice(0, 300)); };
  const presses = ['attack', 'attack', 'attack', 'heavy', 'dodge', 'dodge', 'guard', 'ability1', 'ability2', 'lockOn', 'scan', 'reload'] as const;
  const holds = ['guard', 'aim', 'sprint', 'heavy'] as const;
  const p = c.player;
  const out: SoakReport = { seconds, frames: 0, deaths: 0, resets: 0, badFrames: 0, actions: [], hitStops: 0, maxSpeed: 0, warnings, errors };
  const seen = new Set<string>();
  const stops0 = c.time.hitStops;
  try {
    c.reset('tarrik');
    c.ai(true);
    let next = 0;
    let swapAt = 15;
    const frames = Math.round(seconds * 60);
    for (let f = 0; f < frames; f++) {
      const t = f / 60;
      if (t >= next) {
        next = t + 0.12 + rnd() * 0.5;
        const r = rnd();
        if (r < 0.22) {
          // close on one of the dummies so the fight actually happens
          const all = c.dummies.all();
          const t = all[Math.floor(rnd() * all.length)]!;
          const dx = t.pos.x - p.actor.pos.x;
          const dz = t.pos.z - p.actor.pos.z;
          const l = Math.hypot(dx, dz) || 1;
          c.input.virtual.setMoveWorld(l > 1.6 ? { x: dx / l, z: dz / l } : null);
          if (l <= 1.6) c.move(0, 0);
        } else if (r < 0.3) {
          const ang = rnd() * Math.PI * 2;
          c.input.virtual.setMoveWorld(null);
          c.move(Math.cos(ang), Math.sin(ang));
        } else if (r < 0.36) {
          c.input.virtual.setMoveWorld(null);
          c.move(0, 0);
        }
        else if (r < 0.8) c.press(presses[Math.floor(rnd() * presses.length)]!);
        else {
          const h = holds[Math.floor(rnd() * holds.length)]!;
          c.hold(h, rnd() < 0.55);
        }
        if (rnd() < 0.3) c.input.virtual.addLook((rnd() - 0.5) * 0.6, (rnd() - 0.5) * 0.2);
        if (rnd() < 0.15) c.echo(100);
      }
      c.run(1 / 60);
      out.frames++;
      const act = p.actor;
      seen.add(p.action);
      const sp = Math.hypot(act.vel.x, act.vel.z);
      if (sp > out.maxSpeed && sp < 1000) out.maxSpeed = Math.round(sp * 10) / 10;
      const ok = Number.isFinite(act.pos.x + act.pos.y + act.pos.z + act.yaw) && Math.abs(act.pos.x) <= 22.01 && Math.abs(act.pos.z) <= 22.01 && Math.abs(act.pos.y) < 0.01;
      if (!ok) out.badFrames++;
      for (const d of c.dummies.all()) {
        if (!Number.isFinite(d.pos.x + d.pos.y + d.pos.z) || Math.abs(d.pos.x) > 22.5 || Math.abs(d.pos.z) > 22.5) out.badFrames++;
      }
      if (!act.alive) {
        out.deaths++;
        c.run(0.5);
        p.setProtagonist(p.protagonist, { pos: { x: 0, y: 0, z: 7 }, yaw: 0 });
        p.restoreForCheckpoint({ echo: 50 });
      }
      if (t >= swapAt) {
        swapAt = t + 15;
        c.who(p.protagonist === 'tarrik' ? 'selene' : 'tarrik');
      }
      const d = c.dummies;
      if (!d.passive.alive || !d.swinger.alive || !d.shield.alive || !d.shooter.alive) {
        out.resets++;
        c.reset();
        c.ai(true);
      }
    }
  } catch (err) {
    errors.push(`soak threw: ${err instanceof Error ? err.stack ?? err.message : String(err)}`.slice(0, 600));
  } finally {
    console.warn = cw;
    console.error = ce;
    c.input.virtual.clear();
  }
  out.actions = [...seen].sort();
  out.hitStops = c.time.hitStops - stops0;
  const g = globalThis as { __aurelionErrors?: string[] };
  if (g.__aurelionErrors?.length) for (const e of g.__aurelionErrors.slice(0, 6)) errors.push(String(e).slice(0, 300));
  return out;
}
