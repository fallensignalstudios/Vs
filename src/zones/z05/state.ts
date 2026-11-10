/**
 * Z05 per-load state and the zone's per-frame animation (ZoneDef.update): carried body moves for the duel, the
 * carrier's pass (the sky takes it down after the clip), the stabilizer's plane, the key light under the hull's shadow and the battle light
 * through the ceiling. Scripts only set TARGETS here; a cinematic skip snaps every target (skip = fast-forward).
 */
import * as THREE from 'three';
import type {
  Actor, BeamHandle, DoorHandle, HeroProp, HologramProp, VfxHandle, ZoneRuntime,
} from '@/core/api';

/** a carried move of one body (lunge, dodge, throw): displacement the feet do not walk */
interface Glide {
  actor: Actor;
  to: THREE.Vector3;
  speed: number;
}

export interface Z05State {
  /** world position of the platform centre (the shell's and the carrier's anchor) */
  centre: THREE.Vector3;
  entry: DoorHandle | null;
  north: DoorHandle | null;
  exit: DoorHandle | null;
  key: THREE.DirectionalLight | null;
  keyBase: number;
  /** soft light that follows the fleet battle through the ceiling (sky.battleGlow) */
  battle: THREE.DirectionalLight | null;
  stab: HeroProp<{ active: number; plane: number }> | null;
  holo: HologramProp | null;
  /** true while the overlay shows a message the impact clock must not overwrite */
  holoHold: boolean;
  glides: Glide[];
  /** carrier pass: progress target and the rate it is approached at (per second) */
  carrierTarget: number;
  carrierRate: number;
  /** stabilised jets (Tharne's push) */
  jetsTarget: number;
  /** presentation handles (cosmetic; never state) */
  embers: VfxHandle | null;
  plane: VfxHandle | null;
  tether: BeamHandle | null;
  dust: VfxHandle | null;
}

export let S: Z05State = blank();

export function blank(): Z05State {
  return {
    centre: new THREE.Vector3(), entry: null, north: null, exit: null, key: null, keyBase: 2, battle: null,
    stab: null, holo: null, holoHold: false, glides: [], carrierTarget: 0, carrierRate: 0.02, jetsTarget: 0,
    embers: null, plane: null, tether: null, dust: null,
  };
}

/** a fresh state for a new load (build) */
export function freshState(): void {
  S = blank();
}

/** release the hero props and forget every per-load object (ZoneDef.dispose) */
export function disposeState(): void {
  S.stab?.dispose();
  S.holo?.dispose();
  S = blank();
}

/**
 * Carry `actor` to `to` over `seconds` (a lunge, a dodge, a throw — the feet do not walk it). Skipping: the body
 * is simply put there. Physics still applies (walls, ledges), so a carried move never leaves the platform.
 */
export function glide(z: ZoneRuntime, actor: Actor | null | undefined, to: THREE.Vector3, seconds: number): void {
  if (!actor) return;
  S.glides = S.glides.filter((g) => g.actor !== actor);
  if (z.skipping || seconds <= 0) {
    place(z, actor, to);
    return;
  }
  const d = Math.hypot(to.x - actor.pos.x, to.z - actor.pos.z);
  S.glides.push({ actor, to: to.clone(), speed: Math.max(0.5, d / seconds) });
}

/** put a body somewhere at once (the player through the controller, so camera and cloth follow) */
export function place(z: ZoneRuntime, actor: Actor | null | undefined, to: THREE.Vector3, yaw?: number): void {
  if (!actor) return;
  S.glides = S.glides.filter((g) => g.actor !== actor);
  if (actor === z.game.player.actor) z.game.player.teleport(to, yaw ?? actor.yaw);
  else {
    const c = z.game.ai.companions.find((k) => k.actor === actor);
    if (c) c.teleport(to, yaw ?? actor.yaw);
    else actor.pos.copy(to);
  }
}

/** ZoneDef.update — sim-clock animation; a skip snaps every target */
export function updateZone(z: ZoneRuntime, dt: number): void {
  const game = z.game;
  // carried moves
  if (S.glides.length) {
    S.glides = S.glides.filter((g) => {
      const a = g.actor;
      const dx = g.to.x - a.pos.x;
      const dz = g.to.z - a.pos.z;
      const d = Math.hypot(dx, dz);
      if (!a.alive || d < 0.06 || z.skipping) {
        if (z.skipping) place(z, a, g.to);
        return false;
      }
      const v = Math.min(g.speed, d / Math.max(dt, 1e-3));
      if (a.carryVel) {
        a.carryVel.x += (dx / d) * v;
        a.carryVel.z += (dz / d) * v;
      } else {
        a.pos.x += (dx / d) * v * dt;
        a.pos.z += (dz / d) * v * dt;
      }
      return true;
    });
  }

  // the carrier: progress eases toward its target (≤ 0.05 per tick, so the clip is PLAYED); past the clip the sky's
  // own pass takes it down into the distortion
  const carrier = game.sky.carrier;
  if (carrier && carrier.visible) {
    const p = carrier.progress;
    const next = z.skipping ? S.carrierTarget : p + Math.sign(S.carrierTarget - p) * Math.min(Math.abs(S.carrierTarget - p), Math.min(0.04, S.carrierRate * dt));
    if (next !== p) carrier.setProgress(next);
    const jets = carrier.stabilized;
    const jn = z.skipping ? S.jetsTarget : jets + (S.jetsTarget - jets) * Math.min(1, dt * 1.6);
    if (Math.abs(jn - jets) > 1e-4) carrier.setStabilized(jn);
  }

  // the key light dims under the hull (its threat is its shadow); the battle light flickers through the ceiling
  const shadow = carrier && carrier.visible ? carrier.shadow : 0;
  if (S.key) S.key.intensity = S.keyBase * (1 - 0.82 * shadow);
  if (S.battle) {
    const glow = game.sky.battleGlow;
    S.battle.color.setRGB(0.42 + glow.r * 0.5, 0.48 + glow.g * 0.5, 0.66 + glow.b * 0.5);
    S.battle.intensity = (0.34 + Math.min(1.6, (glow.r + glow.g + glow.b) * 0.45)) * (1 - 0.7 * shadow);
  }

  // the stabilizer: a skip lands every eased parameter at once
  if (z.skipping) {
    S.stab?.snap();
    S.holo?.snap();
  }
}
