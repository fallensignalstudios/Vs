/**
 * Floating pickups: sustain (+35 hp), ammo (magazine + reserve refilled), Echo (+20). Collected by walking
 * into them when they are useful. One registry per Game, ticked by the player controller.
 */
import * as THREE from 'three';
import type { Game, PickupHandle, PickupKind, Vec3Like, VfxHandle } from '@/core/api';
import { TUNING } from '../tuning';
import { fin, live, warnOnce } from '../safe';

interface Pickup extends PickupHandle {
  kind: PickupKind;
  collected: boolean;
  group: THREE.Group;
  core: THREE.Mesh;
  ring: THREE.Mesh;
  fx: VfxHandle | null;
  base: THREE.Vector3;
  phase: number;
  alive: boolean;
}

const COLORS: Record<PickupKind, number> = { sustain: 0xffe2a8, ammo: 0xffa033, echo: 0xff6a1a };

export interface PickupHost {
  readonly game: Game;
  /** is a pickup of this kind useful right now? */
  wants(kind: PickupKind): boolean;
  /** apply it */
  collect(kind: PickupKind): void;
  /** feet of the living protagonist, or null */
  feet(): Vec3Like | null;
}

export class PickupRegistry {
  private readonly items: Pickup[] = [];
  private coreGeo: THREE.OctahedronGeometry | null = null;
  private ringGeo: THREE.TorusGeometry | null = null;
  private readonly mats = new Map<number, THREE.MeshStandardMaterial>();
  private host: PickupHost | null = null;

  constructor(private readonly game: Game) {
    game.events.on('zone:loading', () => this.clear());
  }

  bind(host: PickupHost): void {
    this.host = host;
  }

  private mat(color: number): THREE.MeshStandardMaterial {
    let m = this.mats.get(color);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color: 0x14110d, roughness: 0.35, metalness: 0.7, emissive: color, emissiveIntensity: 2.6 });
      this.mats.set(color, m);
    }
    return m;
  }

  spawn(kind: PickupKind, pos: Vec3Like): PickupHandle {
    const k: PickupKind = kind === 'sustain' || kind === 'ammo' || kind === 'echo' ? kind : 'sustain';
    if (k !== kind) warnOnce(`pickup:${String(kind)}`, `unknown pickup kind "${String(kind)}" — using sustain`);
    const game = this.game;
    const color = k === 'echo' && this.host ? this.host.game.player.protagonist === 'selene' ? 0xcfeeff : 0xff6a1a : COLORS[k];
    this.coreGeo ??= new THREE.OctahedronGeometry(0.13, 0);
    this.ringGeo ??= new THREE.TorusGeometry(0.24, 0.012, 6, 28);
    const group = new THREE.Group();
    group.name = `pickup:${k}`;
    const core = new THREE.Mesh(this.coreGeo, this.mat(color));
    if (k === 'ammo') core.scale.set(0.8, 1.25, 0.8);
    const ring = new THREE.Mesh(this.ringGeo, this.mat(color));
    ring.rotation.x = Math.PI / 2;
    group.add(core, ring);
    const base = new THREE.Vector3(fin(pos?.x), fin(pos?.y), fin(pos?.z));
    const physics = game.physics;
    if (live(physics)) {
      const g = physics.groundAt(base.x, base.z, base.y + 0.5);
      if (g && Number.isFinite(g.y)) base.y = g.y;
    }
    group.position.set(base.x, base.y + 0.9, base.z);
    if (live(game.scene)) game.scene.add(group);
    let fx: VfxHandle | null = k === 'sustain' ? game.vfx.spawn('healPickup', base) : null;
    if (!live(fx)) fx = null;
    const self = this;
    const item: Pickup = {
      kind: k, collected: false, group, core, ring, fx, base, phase: this.items.length * 1.3, alive: true,
      remove() {
        self.retire(item);
      },
    };
    this.items.push(item);
    return item;
  }

  private retire(item: Pickup): void {
    if (!item.alive) return;
    item.alive = false;
    item.group.removeFromParent();
    if (item.fx) item.fx.stop();
    item.fx = null;
    const i = this.items.indexOf(item);
    if (i >= 0) this.items.splice(i, 1);
  }

  clear(): void {
    for (const it of this.items.slice()) this.retire(it);
  }

  update(dt: number): void {
    if (!this.items.length) return;
    const host = this.host;
    const feet = host ? host.feet() : null;
    const R = TUNING.pickups.radius;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i] as Pickup;
      it.phase += dt;
      it.group.position.y = it.base.y + 0.9 + Math.sin(it.phase * 1.8) * 0.07;
      it.core.rotation.y += dt * 1.6;
      it.ring.rotation.z += dt * 0.7;
      if (!feet || !host) continue;
      const dx = feet.x - it.base.x;
      const dz = feet.z - it.base.z;
      if (dx * dx + dz * dz > R * R || Math.abs(feet.y - it.base.y) > 2 || !host.wants(it.kind)) continue;
      it.collected = true;
      host.collect(it.kind);
      this.retire(it);
    }
  }
}

const registries = new WeakMap<Game, PickupRegistry>();

/** the registry of a game (created on first use) */
export function pickupsOf(game: Game): PickupRegistry {
  let r = registries.get(game);
  if (!r) {
    r = new PickupRegistry(game);
    registries.set(game, r);
  }
  return r;
}
