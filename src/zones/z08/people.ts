/**
 * Z08 — the people behind the fight: the medics and the stretcher cases of the west recess, the walking wounded
 * of the east recess (both present in both priority states), and the Reformation grav litters the stretcher
 * cases lie on. A litter is a low sled that rides in front of the one person guiding it, so a single escort can
 * move a casualty; its passenger is a posed figure owned by the zone.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { CharacterVisual, Companion, HumanoidArchetype, Routine, ZoneRuntime } from '@/core/api';
import { isHumanoidVisual } from '@/core/api';
import { BLUE, walkTo } from '../shared';
import { S, type Litter } from './state';

/** height of the litter's bed above the floor, and how far ahead of its escort it rides */
const BED_H = 0.66;
const LEAD = 1.55;

// ---------------------------------------------------------------------------------------------------------------------
// Litters
// ---------------------------------------------------------------------------------------------------------------------

/** build one grav litter at a marker (empty when `passenger` is null) */
export function makeLitter(z: ZoneRuntime, id: string, at: string, passenger: HumanoidArchetype | null, seed: number): Litter {
  const game = z.game;
  const mats = game.mats;
  const g = new THREE.Group();
  g.name = `litter-${id}`;
  // polish 4 (draw calls — Z08 has the least headroom): the sled's boxes are merged into one mesh per material, and
  // the two light strips share one emissive (each litter: 5 meshes, 4 shadow casters, where it was 10 and 10)
  const parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, zz: number): void => {
    const list = parts.get(mat) ?? [];
    list.push(new THREE.BoxGeometry(w, h, d).translate(x, y, zz));
    parts.set(mat, list);
  };
  const glow = mats.emissive(BLUE, 2.6);
  // slate sled, cloth bed, steel side rails, two cold lift pads underneath and a status strip on each side
  box(2.05, 0.12, 0.66, mats.get('refSlate'), 0, BED_H - 0.1, 0);
  box(1.9, 0.06, 0.56, mats.get('refCloth'), 0, BED_H - 0.01, 0);
  for (const s of [-1, 1]) {
    box(2.0, 0.035, 0.035, mats.get('refSteel'), 0, BED_H + 0.06, s * 0.33);
    box(1.2, 0.025, 0.012, glow, 0.1, BED_H - 0.1, s * 0.336);
    box(0.42, 0.05, 0.46, mats.get('refNavy'), s * 0.62, BED_H - 0.2, 0);
    box(0.32, 0.012, 0.36, glow, s * 0.62, BED_H - 0.232, 0);
  }
  const geos: THREE.BufferGeometry[] = [];
  for (const [mat, list] of parts) {
    const geo = list.length > 1 ? mergeGeometries(list, false) : list[0];
    if (list.length > 1) for (const l of list) l.dispose();
    if (!geo) continue;
    geos.push(geo);
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = mat !== glow;
    g.add(m);
  }
  g.position.copy(z.m(at));
  g.rotation.y = z.myaw(at) + Math.PI / 2;
  z.builder.add(g);

  let figure: CharacterVisual | null = null;
  if (passenger) {
    figure = game.chars.create(passenger, { seed });
    seatOnLitter(g, figure);
  }
  z.onDispose(() => {
    figure?.dispose();
    for (const geo of geos) geo.dispose();
  });
  const litter: Litter = { id, group: g, passenger: figure, escort: null };
  S.litters.push(litter);
  return litter;
}

/** lay a figure on a litter bed (head toward the litter's −X end); the figure's own root is never moved */
export function seatOnLitter(g: THREE.Group, figure: CharacterVisual): void {
  const hold = new THREE.Group();
  hold.position.set(0.05, BED_H + 0.02, 0);
  hold.rotation.set(0, -Math.PI / 2, 0);
  hold.add(figure.root);
  g.add(hold);
  figure.play('lieInjured', { loop: true });
  if (isHumanoidVisual(figure)) figure.teleported();
}

export function litter(id: string): Litter | null {
  return S.litters.find((l) => l.id === id) ?? null;
}

/**
 * ZoneDef.update: each guided litter rides ahead of its escort (snapping while a scene is skipped); resting ones
 * hover with a slow bob. Passengers are animated here.
 */
export function updateLitters(z: ZoneRuntime, dt: number): void {
  const t = z.time;
  for (const l of S.litters) {
    l.passenger?.update(dt);
    if (!l.group.visible) continue;
    const esc = l.escort ? z.cast(l.escort) : null;
    if (esc && esc.actor.alive !== false) {
      const a = esc.actor;
      const tx = a.pos.x - Math.sin(a.yaw) * LEAD;
      const tz = a.pos.z - Math.cos(a.yaw) * LEAD;
      const k = z.skipping ? 1 : Math.min(1, dt * 7);
      l.group.position.x += (tx - l.group.position.x) * k;
      l.group.position.z += (tz - l.group.position.z) * k;
      l.group.position.y = a.pos.y;
      let dy = a.yaw + Math.PI / 2 - l.group.rotation.y;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      l.group.rotation.y += dy * k;
    } else {
      l.group.position.y = Math.sin(t * 1.3 + l.id.length) * 0.015;
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Survivors
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Two medics with the two stretcher cases (west), two walking wounded (east), as the given stage finds them.
 * `walkersOut` = the walking wounded have already reached the east manual shutter (East priority, after it opened).
 */
export function spawnSurvivors(z: ZoneRuntime, o: { walkersOut: boolean }): void {
  z.npc('medic', 'medicA', 'kneelTend', 'medicA');
  z.npc('medic', 'medicB', 'kneelTend', 'medicB');
  makeLitter(z, 'W1', 'litterW1', 'dominionSoldier', 811);
  makeLitter(z, 'W2', 'litterW2', 'reformationSoldier', 812);
  const lo = makeLitter(z, 'O', 'litterO', null, 0);
  lo.group.visible = false;
  if (o.walkersOut) {
    z.npc('survivor', 'shutterWheel', undefined, 'walker1');
    z.npc('reformationSoldier', 'walkerGate1', 'limp', 'walker2');
  } else {
    z.npc('survivor', 'walker1', 'sitInjured', 'walker1');
    z.npc('reformationSoldier', 'walker2', 'limp', 'walker2');
  }
}

/** East priority, phase A: the walking wounded reach the manual shutter and wind it open */
export function* walkersToShutter(z: ZoneRuntime): Routine {
  const w = ['walker1', 'walker2'].map((n) => z.cast(n));
  for (const c of w) c?.stopAction();
  walkTo(z, w[0], 'shutterWheel');
  walkTo(z, w[1], 'walkerGate1');
  const wheel = z.m('shutterWheel');
  const until = z.time + 14;
  yield () => z.time >= until || !w[0] || w[0].arrived || Math.hypot(w[0].actor.pos.x - wheel.x, w[0].actor.pos.z - wheel.z) < 0.9;
  w[0]?.face(S.gateN ? S.gateN.pos : wheel);
  const t = w[0]?.play('interact') ?? 0;
  yield Math.max(1.6, Math.min(3, t));
  w[1]?.play('limp', { loop: true });
}

/** who escorts what out of the court, by priority (the chosen group leaves first) */
export interface ExitPlan {
  first: Array<[string, string | null]>;
  second: Array<[string, string | null]>;
}

/**
 * The exit order (SCRIPT_SOURCE Z08 `quarantine`): West chosen — the stretcher cases first, then the walking
 * wounded; East chosen — the walking wounded first, then one of them turns back for the last stretcher. Under
 * SPARE the second medic takes the officer (`medicB` → litter 'O', sent after his line, not listed here).
 * Each entry is [escort cast name, litter id it guides or null].
 */
export function exitPlan(west: boolean, spared: boolean): ExitPlan {
  if (west) {
    return spared
      ? { first: [['medicA', 'W1']], second: [['walker1', null], ['walker2', 'W2']] }
      : { first: [['medicA', 'W1'], ['medicB', 'W2']], second: [['walker1', null], ['walker2', null]] };
  }
  return { first: [['walker1', null]], second: spared ? [['medicA', 'W1'], ['walker2', 'W2']] : [['medicA', 'W1'], ['walker2', 'W2'], ['medicB', null]] };
}

/** start one group walking to the south door (litters attach to their escorts) */
export function sendOut(z: ZoneRuntime, group: Array<[string, string | null]>): void {
  group.forEach(([who, lit], i) => {
    const c = z.cast(who);
    if (!c) return;
    c.stopAction();
    const l = lit ? litter(lit) : null;
    if (l) {
      l.escort = who;
      l.group.visible = true;
    }
    const door = z.m('southDoor');
    door.x += (i - 1) * 0.9;
    walkTo(z, c, door, { yaw: z.myaw('southDoor') });
  });
}

/** the court is clear: everyone who left is out of the room (end state of the clearing scene) */
export function survivorsGone(z: ZoneRuntime): void {
  for (const n of ['medicA', 'medicB', 'walker1', 'walker2']) z.cast(n)?.remove();
  for (const l of S.litters) {
    l.escort = null;
    l.group.visible = false;
  }
}

/** every escort is through the south door (or has nowhere left to walk) */
export function throughDoor(z: ZoneRuntime, names: string[]): boolean {
  const door = z.m('southDoor');
  return names.every((n) => {
    const c: Companion | null = z.cast(n);
    return !c || c.arrived || Math.hypot(c.actor.pos.x - door.x, c.actor.pos.z - door.z) < 2.2;
  });
}
