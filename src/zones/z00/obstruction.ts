/**
 * Z00 — the damaged maintenance obstruction that teaches guard and heavy attack without a tutorial arena
 * (SCRIPT_SOURCE Z00 `landing`, HUD and hints).
 *
 *  ARM    a King-era maintenance manipulator hangs from a gantry over the one gap in the collapsed bulkhead.
 *         Its servo has failed into a loop: it retracts and swings back east, winds up (servo whine, sparks:
 *         ≥ 0.6 s of warning), then strikes west across the gap at chest height. The strike goes through the
 *         combat resolver (`actors.applyHit`) with a real attacker, so a held guard blocks it and a timed
 *         press counts as a perfect guard. A guarded strike stalls the motor for good; so does the lead
 *         getting past it. An unguarded strike costs a little health (never below 45 %) and shoves the lead
 *         back — it never blocks the way.
 *  PLATE  a buckled blast shutter jammed across the lit rib doorway. It is an `objective` actor: light blows
 *         clang off it, a heavy attack (or a blast) throws it into the vestibule. If the lead stands at it for
 *         a while without managing, a "Heavy attack" context prompt offers the same blow (accessibility; it is
 *         also what the autoplay bot answers).
 *
 * Per-load state lives in `O` (reset by `resetObstruction`, called from build() and the zone's dispose()).
 * Animation runs from `updateObstruction` (ZoneDef.update, sim clock).
 */
import * as THREE from 'three';
import type { Actor, ColliderHandle, HitInfo, ZoneBuilder, ZoneRuntime } from '@/core/api';
import { IVORY } from '../shared';

/** arm timing (seconds within one cycle) */
const CYCLE = 3.4;
const RETURN_END = 1.5;
const WIND_END = 2.15;
const STRIKE_END = 2.6;
/** swing half-angle (rad) and the boom length retracted / extended */
const SWING = THREE.MathUtils.degToRad(56);
const L_IN = 1.5;
const L_OUT = 2.95;
/** the head must be lower than this to strike a standing figure (m above the floor) */
const STRIKE_HEIGHT = 1.95;
const DAMAGE = 7;

interface ObstructionState {
  // arm
  pivot: THREE.Vector3;
  gapHalf: number;
  arm: THREE.Group | null;
  boom: THREE.Object3D | null;
  head: THREE.Object3D | null;
  lamp: THREE.MeshStandardMaterial | null;
  angle: number;
  length: number;
  cycleT: number;
  seized: boolean;
  seizeAngle: number;
  struckThisCycle: boolean;
  headX: number;
  armActor: Actor | null;
  pastFor: number;
  /** strikes that reached the lead / were guarded (bookkeeping for hints and barks) */
  hits: number;
  blocks: number;
  // plate
  plate: THREE.Group | null;
  plateAt: THREE.Vector3;
  plateYaw: number;
  plateCollider: ColliderHandle | null;
  plateActor: Actor | null;
  broken: boolean;
  breakT: number;
  pendingBreak: number;
  nearPlate: number;
  assistOpen: boolean;
  /** 0..1 rocking of the jammed plate after a light blow */
  nudge: number;
  /** runtime hooks installed (armObstruction is idempotent) */
  armed: boolean;
  vestibuleLight: THREE.Object3D | null;
}

function blank(): ObstructionState {
  return {
    pivot: new THREE.Vector3(), gapHalf: 1.4, arm: null, boom: null, head: null, lamp: null, angle: -SWING, length: L_IN,
    cycleT: 0, seized: false, seizeAngle: 0, struckThisCycle: false, headX: 0, armActor: null, pastFor: 0, hits: 0, blocks: 0,
    plate: null, plateAt: new THREE.Vector3(), plateYaw: 0, plateCollider: null, plateActor: null, broken: false, breakT: 0,
    pendingBreak: -1, nearPlate: 0, assistOpen: false, nudge: 0, armed: false, vestibuleLight: null,
  };
}
let O: ObstructionState = blank();

export function resetObstruction(): void {
  O = blank();
}

/** read-only view for the zone script */
export const obstruction = {
  get armSeized(): boolean { return O.seized; },
  get plateBroken(): boolean { return O.broken; },
  get armHits(): number { return O.hits; },
  get armBlocks(): number { return O.blocks; },
  get platePos(): THREE.Vector3 { return O.plateAt; },
  get armPos(): THREE.Vector3 { return O.pivot; },
};

// ------------------------------------------------------------------------------------------------ build

/**
 * The gantry and the arm over the gap (plan x, centre n of the gap, gap width, pivot height). The arm swings
 * in the vertical east–west plane; its head is a crossbar as wide as the gap.
 */
export function buildArm(b: ZoneBuilder, x: number, n: number, gap: number, h: number): void {
  const mats = b.mats;
  O.pivot.copy(b.P(x, n, h));
  O.gapHalf = gap / 2;
  // gantry beam across the gap, seated on the bulkhead stubs
  b.wall({ from: [x, n - gap / 2 - 0.9], to: [x, n + gap / 2 + 0.9], h: h + 0.15, height: 0.55, thickness: 0.7, style: 'panelled', noCollider: true });
  const arm = new THREE.Group();
  arm.name = 'z00-arm';
  arm.position.copy(O.pivot);
  const housing = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 1.0, 18), mats.get('goldDark'));
  housing.rotation.x = Math.PI / 2;
  arm.add(housing);
  const swing = new THREE.Group();
  arm.add(swing);
  // outer sleeve (fixed length) and the telescoping boom inside it
  const sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.34, 1.2, 0.34), mats.get('goldDark'));
  sleeve.position.y = -0.6;
  swing.add(sleeve);
  const boom = new THREE.Group();
  swing.add(boom);
  // the rod reaches 1 m above and below the boom origin; the head hangs at its lower end
  const rod = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2, 0.18), mats.get('goldTrim'));
  boom.add(rod);
  const head = new THREE.Group();
  boom.add(head);
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.42, gap - 0.1), mats.get('goldDark'));
  head.add(bar);
  for (const s of [-1, 1]) {
    const claw = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.5, 0.16), mats.get('goldDark'));
    claw.position.set(0.05, -0.32, s * (gap / 2 - 0.35));
    claw.rotation.z = 0.25;
    head.add(claw);
  }
  // the fault lamp on the head: a warm King-era status light that stutters with the servo
  const lamp = mats.emissive(IVORY, 2.4);
  const lampMesh = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.05, gap * 0.6), lamp);
  lampMesh.position.y = 0.18;
  head.add(lampMesh);
  O.arm = swing;
  O.boom = boom;
  O.head = head;
  O.lamp = lamp;
  b.add(arm);
  b.keep(arm);
  poseArm();
}

/**
 * The buckled shutter jammed in the doorway: two bent leaves and a torn edge, leaning into the room, with the
 * vestibule light spilling over the top. `x, n` = doorway centre on the wall line; the plate leans west.
 */
export function buildPlate(b: ZoneBuilder, x: number, n: number, width: number): void {
  const mats = b.mats;
  const g = new THREE.Group();
  g.name = 'z00-plate';
  O.plateAt.copy(b.P(x - 0.55, n, 1.2));
  O.plateYaw = b.yaw(90);
  g.position.copy(b.P(x - 0.25, n, 0));
  g.rotation.y = b.yaw(90);
  // dark leaves against the lit doorway: the jam reads as a silhouette with a bright torn seam
  const leaf = mats.get('goldDark');
  const frame = mats.get('whiteGold');
  // lower leaf: stands nearly upright, bowed outward
  const low = new THREE.Mesh(new THREE.BoxGeometry(width + 0.3, 1.7, 0.16), leaf);
  low.position.set(0, 0.85, -0.18);
  low.rotation.x = 0.1;
  low.rotation.z = 0.09;
  g.add(low);
  // upper leaf: folded back toward the room at the buckle line
  const up = new THREE.Mesh(new THREE.BoxGeometry(width + 0.1, 1.0, 0.16), leaf);
  up.position.set(0.1, 2.15, -0.05);
  up.rotation.x = -0.5;
  up.rotation.z = -0.12;
  g.add(up);
  // stiffening ribs on the leaves and a torn corner
  for (const yy of [0.35, 1.15]) {
    const r = new THREE.Mesh(new THREE.BoxGeometry(width + 0.32, 0.12, 0.2), frame);
    r.position.set(0, yy, -0.24 - yy * 0.06);
    g.add(r);
  }
  const rib2 = new THREE.Mesh(new THREE.BoxGeometry(width + 0.1, 0.12, 0.2), frame);
  rib2.position.set(0.1, 2.35, 0.08);
  rib2.rotation.x = -0.5;
  g.add(rib2);
  // the torn fold between the leaves, lit from the vestibule behind
  const seam = new THREE.Mesh(new THREE.BoxGeometry(width * 0.85, 0.035, 0.04), mats.emissive(0xffd9a0, 3.4));
  seam.position.set(0.02, 1.72, -0.16);
  seam.rotation.z = 0.06;
  g.add(seam);
  b.add(g);
  b.keep(g);
  O.plate = g;
  // the shutter blocks movement and shots across the whole opening (cover reads 'high')
  const c = O.plateAt;
  O.plateCollider = b.collider({ shape: { kind: 'box', hx: 0.45, hy: 1.4, hz: width / 2 + 0.1 }, x: c.x, y: 1.4, z: c.z, yaw: 0 });
}

/** the vestibule light that floods through once the plate is down (its intensity rises on the break) */
export function setVestibuleLight(o: THREE.Object3D): void {
  O.vestibuleLight = o;
}

// ------------------------------------------------------------------------------------------------ runtime

/** Spawn the invisible attacker and the plate's target body (call from the landing beat; idempotent). */
export function armObstruction(z: ZoneRuntime): void {
  if (O.armed) return;
  O.armed = true;
  const actors = z.game.actors;
  if (!O.armActor) {
    O.armActor = actors.spawn({
      archetype: 'maintenanceArm', name: 'Maintenance arm', team: 'neutral', pos: O.pivot.clone().setY(0), hp: 1,
      targetable: false, invulnerable: true, fixed: true, visual: null, tags: ['z00-arm'], material: 'metal',
    });
  }
  if (!O.plateActor && !O.broken) {
    O.plateActor = actors.spawn({
      archetype: 'buckledPlate', name: 'Buckled plate', team: 'neutral', pos: O.plateAt.clone().setY(0), yaw: O.plateYaw,
      hp: 100000, radius: 0.9, height: 2.6, targetable: true, fixed: true, visual: null, tags: ['objective', 'z00-plate'],
      material: 'metal', corpseSeconds: 0,
    });
  }
  const plate = O.plateActor;
  z.onDispose(z.game.events.on('actor:hit', ({ target, hit }) => {
    if (!plate || target !== plate || O.broken) return;
    if (isBreaking(hit)) breakPlate(z, false);
    else if (!z.skipping) {
      z.game.audio.play('bladeHitShield', { pos: O.plateAt, volume: 0.8 });
      O.nudge = 1;
    }
  }));
}

/** only a heavy blow (or a blast) moves the shutter */
function isBreaking(hit: HitInfo): boolean {
  return hit.heavy === true || hit.kind === 'explosion' || hit.tag === 'cinderSlam';
}

/** Restore states without animation (checkpoint / debug entry after the scene). */
export function restoreObstruction(seized: boolean, broken: boolean): void {
  if (seized) seize(null, -0.1, true);
  if (broken) breakPlate(null, true);
}

function seize(z: ZoneRuntime | null, angle: number, silent: boolean): void {
  if (O.seized) return;
  O.seized = true;
  O.seizeAngle = angle;
  if (O.lamp) O.lamp.emissiveIntensity = 0.25;
  if (!z || silent || z.skipping) return;
  const game = z.game;
  const head = headWorld(new THREE.Vector3());
  game.vfx.spawn('sparkHeavy', O.pivot, { dir: { x: 0, y: -1, z: 0 } });
  game.vfx.spawn('sparkHit', head, { dir: { x: -1, y: 0.3, z: 0 } });
  game.audio.play('structuralGroan', { pos: O.pivot, volume: 0.6, pitch: 1.4 });
  game.audio.play('emitterBreak', { pos: O.pivot, volume: 0.5 });
}

function breakPlate(z: ZoneRuntime | null, silent: boolean): void {
  if (O.broken) return;
  O.broken = true;
  O.breakT = silent ? 1 : 0;
  if (O.plateCollider) O.plateCollider.enabled = false;
  if (O.vestibuleLight) O.vestibuleLight.visible = true;
  if (z) {
    const game = z.game;
    if (O.assistOpen) {
      game.player.setContextAction(null);
      O.assistOpen = false;
    }
    if (O.plateActor) {
      game.actors.despawn(O.plateActor);
      O.plateActor = null;
    }
    z.setFlag('z00PlateBroken', true);
    if (!silent && !z.skipping) {
      const p = O.plateAt;
      game.vfx.spawn('sparkHeavy', p, { dir: { x: -1, y: 0.2, z: 0 }, scale: 1.4 });
      game.vfx.spawn('metalChip', p, { dir: { x: 1, y: 0.4, z: 0 } });
      game.vfx.spawn('dustPuff', p.clone().setY(0.2), { scale: 2.2 });
      game.vfx.spawn('debrisFall', p.clone().setY(3.2));
      game.audio.play('debrisFall', { pos: p });
      game.audio.play('bladeHitMetal', { pos: p, pitch: 0.6 });
      game.camera.shake(0.3, 0.35);
    }
  }
  if (silent) posePlate();
}

function headWorld(out: THREE.Vector3): THREE.Vector3 {
  return out.set(Math.sin(O.angle) * O.length, -Math.cos(O.angle) * O.length, 0).add(O.pivot);
}

function poseArm(): void {
  if (!O.arm || !O.boom || !O.head) return;
  O.arm.rotation.z = O.angle;
  O.boom.position.y = -(O.length - 1);
  O.head.position.y = -1;
}

function posePlate(): void {
  const g = O.plate;
  if (!g) return;
  const t = Math.min(1, O.breakT);
  const k = t * t * (3 - 2 * t);
  const base = O.plateAt;
  // thrown east into the vestibule, falling flat
  g.position.set(base.x + 0.3 + k * 2.6, k * 0.02, base.z);
  g.rotation.set(0, O.plateYaw, 0);
  g.rotateX(-k * (Math.PI / 2 - 0.08));
  if (t >= 1) return;
  if (O.nudge > 0) g.rotateZ(Math.sin(O.nudge * 18) * 0.02 * O.nudge);
}

const _v = new THREE.Vector3();
const _dir = { x: -1, y: 0, z: 0 };

/** ZoneDef.update: the arm's loop, the strike test, the plate's fall and the context-prompt assist */
export function updateObstruction(z: ZoneRuntime, dt: number): void {
  if (!O.arm) return;
  const game = z.game;
  const player = z.player;
  const live = !!player && player.alive;

  // ---- arm ----
  if (O.seized) {
    // the dead motor lets the boom sag to the vertical, the head hanging just above head height
    const k = z.skipping ? 1 : Math.min(1, dt * 1.4);
    O.angle += (O.seizeAngle * 0.15 - O.angle) * k;
    O.length += (1.75 - O.length) * k;
  } else {
    const prevX = O.headX;
    const t0 = O.cycleT;
    O.cycleT = (O.cycleT + dt) % CYCLE;
    const t = O.cycleT;
    if (t < t0) O.struckThisCycle = false;
    if (t < RETURN_END) {
      const u = t / RETURN_END;
      O.angle = -SWING + 2 * SWING * (u * u * (3 - 2 * u));
      O.length = L_IN;
    } else if (t < WIND_END) {
      const u = (t - RETURN_END) / (WIND_END - RETURN_END);
      O.angle = SWING + Math.sin(u * 40) * 0.015;
      O.length = L_IN + (L_OUT - L_IN) * Math.min(1, u * 1.6);
      if (t0 < RETURN_END && !z.skipping) {
        game.audio.play('ambServoFar', { pos: O.pivot, volume: 1.2, pitch: 1.6 });
        game.vfx.spawn('sparkHit', O.pivot, { dir: { x: 1, y: -0.4, z: 0 } });
      }
    } else if (t < STRIKE_END) {
      const u = (t - WIND_END) / (STRIKE_END - WIND_END);
      O.angle = SWING - 2 * SWING * (u * u);
      O.length = L_OUT;
      if (t0 < WIND_END && !z.skipping) game.audio.play('swingHeavy', { pos: O.pivot, pitch: 0.7 });
    } else {
      const u = (t - STRIKE_END) / (CYCLE - STRIKE_END);
      O.angle = -SWING;
      O.length = L_OUT + (L_IN - L_OUT) * Math.min(1, u * 1.4);
    }
    if (O.lamp) O.lamp.emissiveIntensity = t >= RETURN_END && t < STRIKE_END ? 4.5 : 1.2 + (Math.sin(z.time * 23) > 0.6 ? 1.4 : 0);
    headWorld(_v);
    O.headX = _v.x;
    // strike test: the head sweeps west across the lead's line, low enough to hit a standing figure
    if (live && t >= WIND_END && t < STRIKE_END && !O.struckThisCycle && _v.y < STRIKE_HEIGHT && !game.mission.cinematicActive) {
      const p = player.pos;
      const inGap = Math.abs(p.z - O.pivot.z) < O.gapHalf + 0.3 && Math.abs(p.x - O.pivot.x) < L_OUT;
      const crossed = prevX >= p.x - 0.45 && _v.x <= p.x + 0.45;
      if (inGap && crossed && prevX > _v.x) {
        O.struckThisCycle = true;
        strike(z, player, _v);
      }
    }
    // past the arm: on its next stroke it jams against its own housing
    if (live && player.pos.x > O.pivot.x + 2.4) O.pastFor += dt;
    if (O.pastFor > 1.5 && t >= STRIKE_END) seize(z, -SWING, false);
  }
  poseArm();

  // ---- plate ----
  if (O.broken && O.breakT < 1) {
    O.breakT = z.skipping ? 1 : Math.min(1, O.breakT + dt * 1.8);
    posePlate();
  } else if (!O.broken && O.nudge > 0) {
    O.nudge = Math.max(0, O.nudge - dt * 3);
    posePlate();
  }
  if (O.pendingBreak >= 0 && z.time >= O.pendingBreak) {
    O.pendingBreak = -1;
    breakPlate(z, false);
  }
  updateAssist(z, dt);
}

function strike(z: ZoneRuntime, player: Actor, head: THREE.Vector3): void {
  const game = z.game;
  const attacker = O.armActor;
  if (!attacker) return;
  // never a threat to the mission: an unguarded blow stops at 45 % health
  const room = Math.max(0, player.hp - player.maxHp * 0.45);
  const res = game.actors.applyHit(player, {
    attacker, damage: Math.min(DAMAGE, room), poise: 24, kind: 'melee', element: 'kinetic', dir: _dir,
    point: { x: player.pos.x + 0.3, y: Math.min(1.5, head.y + 0.1), z: player.pos.z }, knockback: 3.2, tag: 'z00Arm',
  });
  if (res.blocked || res.perfect) {
    O.blocks++;
    seize(z, O.angle, false);
  } else if (!res.immune) {
    O.hits++;
    if (!z.skipping) game.vfx.spawn('sparkHit', head, { dir: { x: 1, y: 0.2, z: 0 } });
  }
}

/** a stuck lead at the plate gets the heavy blow as a context prompt (also what the autoplay bot answers) */
function updateAssist(z: ZoneRuntime, dt: number): void {
  if (O.broken || O.pendingBreak >= 0) return;
  const game = z.game;
  const player = z.player;
  if (!player || !player.alive) return;
  const d = Math.hypot(player.pos.x - O.plateAt.x, player.pos.z - O.plateAt.z);
  if (d < 2.7 && !game.mission.cinematicActive) O.nearPlate += dt;
  else O.nearPlate = Math.max(0, O.nearPlate - dt * 0.5);
  if (!O.assistOpen && O.nearPlate > 6) {
    O.assistOpen = true;
    const at = O.plateAt.clone();
    game.player.setContextAction({
      id: 'z00-plate', prompt: 'Heavy attack', button: 'heavy', window: Infinity, autoConfirmable: true, // NEW
      onConfirm: () => {
        O.assistOpen = false;
        game.player.playScripted('attackHeavy', { faceTo: at });
        O.pendingBreak = z.time + 0.5;
      },
    });
  } else if (O.assistOpen && d > 3.6) {
    O.assistOpen = false;
    O.nearPlate = 0;
    if (game.player.contextAction?.id === 'z00-plate') game.player.setContextAction(null);
  }
}
