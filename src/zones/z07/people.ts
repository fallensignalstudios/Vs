/**
 * Z07 — the people the choice is about: two medics with two stretcher cases on Reformation grav litters by the
 * west route, three walking wounded by the east route. Mixed uniforms in both groups. A litter is a low sled that
 * rides ahead of the medic guiding it; its passenger is a posed figure owned by the zone.
 *
 * After the commit only the ORDER changes: the chosen group moves into its route first; the other waits. Both
 * routes stay passable (Tharne says so; nobody is left behind).
 */
import * as THREE from 'three';
import type { CharacterVisual, HumanoidArchetype, RescuePriority, ZoneRuntime } from '@/core/api';
import { isHumanoidVisual } from '@/core/api';
import { BLUE, walkTo } from '../shared';

/** height of a litter's bed above the floor and how far ahead of its escort it rides */
const BED_H = 0.66;
const LEAD = 1.55;

interface Litter {
  group: THREE.Group;
  passenger: CharacterVisual | null;
  /** cast name of the medic guiding it (null = resting) */
  escort: string | null;
}

let litters: Litter[] = [];

/** forget the per-load litters (ZoneDef.dispose; their objects are disposed with the zone) */
export function resetPeople(): void {
  litters = [];
}

function makeLitter(z: ZoneRuntime, at: string, passenger: HumanoidArchetype, seed: number): Litter {
  const game = z.game;
  const mats = game.mats;
  const g = new THREE.Group();
  g.name = 'z07-litter';
  const geos: THREE.BufferGeometry[] = [];
  const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, zz: number): void => {
    const geo = new THREE.BoxGeometry(w, h, d);
    geos.push(geo);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, zz);
    m.castShadow = true;
    g.add(m);
  };
  // slate sled, cloth bed, steel rails, two cold lift pads and a status strip on each side
  box(2.05, 0.12, 0.66, mats.get('refSlate'), 0, BED_H - 0.1, 0);
  box(1.9, 0.06, 0.56, mats.get('refCloth'), 0, BED_H - 0.01, 0);
  for (const s of [-1, 1]) {
    box(2.0, 0.035, 0.035, mats.get('refSteel'), 0, BED_H + 0.06, s * 0.33);
    box(1.2, 0.025, 0.012, mats.emissive(BLUE, 2.2), 0.1, BED_H - 0.1, s * 0.336);
    box(0.42, 0.05, 0.46, mats.get('refNavy'), s * 0.62, BED_H - 0.2, 0);
    box(0.32, 0.012, 0.36, mats.emissive(BLUE, 3), s * 0.62, BED_H - 0.232, 0);
  }
  g.position.copy(z.m(at));
  g.rotation.y = z.myaw(at) + Math.PI / 2;
  z.builder.add(g);
  const figure = game.chars.create(passenger, { seed });
  const hold = new THREE.Group();
  hold.position.set(0.05, BED_H + 0.02, 0);
  hold.rotation.set(0, -Math.PI / 2, 0);
  hold.add(figure.root);
  g.add(hold);
  figure.play('lieInjured', { loop: true });
  if (isHumanoidVisual(figure)) figure.teleported();
  z.onDispose(() => {
    figure.dispose();
    for (const geo of geos) geo.dispose();
  });
  const l: Litter = { group: g, passenger: figure, escort: null };
  litters.push(l);
  return l;
}

/**
 * Spawn both groups as the given state finds them: waiting at their routes (`pending`), or — after the commit —
 * with the chosen group already inside its route.
 */
export function spawnPeople(z: ZoneRuntime, priority: RescuePriority): void {
  const westGone = priority === 'WestStretchers';
  const eastGone = priority === 'EastWalkers';
  // west: two medics (mixed) and the two stretcher cases they tend
  const medA = z.npc('medic', westGone ? 'westEscortA' : 'medicA', westGone ? undefined : 'kneelTend', 'medicA');
  const medB = z.npc('medic', westGone ? 'westEscortB' : 'medicB', westGone ? undefined : 'kneelTend', 'medicB');
  const la = makeLitter(z, 'litterW1', 'dominionSoldier', 711);
  const lb = makeLitter(z, 'litterW2', 'reformationMarine', 712);
  if (westGone) {
    la.escort = 'medicA';
    lb.escort = 'medicB';
    placeAhead(la, medA.actor.pos, medA.actor.yaw);
    placeAhead(lb, medB.actor.pos, medB.actor.yaw);
  }
  // east: walking wounded, mixed uniforms
  const walkers: Array<[HumanoidArchetype, string, string, string]> = [
    ['reformationSoldier', 'walkerA', 'eastDeep', 'sitInjured'],
    ['dominionSoldier', 'walkerB', 'eastDeep2', 'limp'],
    ['survivor', 'walkerC', 'eastDeep3', 'sitInjured'],
  ];
  for (const [who, at, deep, pose] of walkers) z.npc(who, eastGone ? deep : at, eastGone ? undefined : pose, at);
  for (const name of ['medicA', 'medicB', 'walkerA', 'walkerB', 'walkerC']) {
    const c = z.cast(name);
    if (c) c.actor.protectedNpc = true;
  }
}

/** after the commit: the chosen group moves into its route (skip-safe: `walkTo` teleports while skipping) */
export function moveChosenGroup(z: ZoneRuntime, priority: Exclude<RescuePriority, 'pending'>): void {
  if (priority === 'WestStretchers') {
    for (const [name, i, to] of [['medicA', 0, 'westEscortA'], ['medicB', 1, 'westEscortB']] as const) {
      const c = z.cast(name);
      const l = litters[i];
      if (!c || !l) continue;
      c.stopAction();
      // step behind the litter first, then guide it in
      c.teleport(z.m(i === 0 ? 'escortA' : 'escortB'), z.myaw('escortA'));
      l.escort = name;
      walkTo(z, c, to);
    }
  } else {
    for (const [name, to] of [['walkerA', 'eastDeep'], ['walkerB', 'eastDeep2'], ['walkerC', 'eastDeep3']] as const) {
      const c = z.cast(name);
      if (!c) continue;
      c.stopAction();
      walkTo(z, c, to);
    }
  }
}

/** put a litter where it rides: `LEAD` metres ahead of its escort, across his path */
function placeAhead(l: Litter, pos: THREE.Vector3, yaw: number): void {
  l.group.position.set(pos.x - Math.sin(yaw) * LEAD, pos.y, pos.z - Math.cos(yaw) * LEAD);
  l.group.rotation.y = yaw + Math.PI / 2;
}

/** ZoneDef.update: a guided litter rides ahead of its medic (snapping while skipping); resting ones bob slightly */
export function updatePeople(z: ZoneRuntime, dt: number): void {
  for (const l of litters) {
    l.passenger?.update(dt);
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
      l.group.position.y = Math.sin(z.time * 1.3 + l.group.id) * 0.015;
    }
  }
}
