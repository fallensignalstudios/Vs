/**
 * `z.pickup(kind, at)`: sustain / ammunition / Echo drops. The combat module owns the real pickup
 * (`spawnPickup(game, kind, pos)`); when it is not available yet a plain proximity pickup with the BRIEF values
 * stands in, so zone scripts behave the same either way.
 */
import * as THREE from 'three';
import * as combat from '@/combat';
import type { Game, Vec3Like, VfxHandle } from '@/core/api';
import { reportError } from '@/core/events';
import { isStub } from '@/core/stub';

export type PickupKind = 'sustain' | 'ammo' | 'echo';

const COLLECT_RADIUS = 1.3;
const HEAL = 35;
const ECHO = 20;
const COLORS: Record<PickupKind, number> = { sustain: 0x8dffb0, ammo: 0xffc56b, echo: 0xcfeeff };

interface FallbackPickup {
  kind: PickupKind;
  pos: THREE.Vector3;
  mesh: THREE.Mesh;
  marker: VfxHandle | null;
}

type SpawnPickup = (game: Game, kind: PickupKind, pos: Vec3Like) => unknown;

export class Pickups {
  private readonly items: FallbackPickup[] = [];
  private readonly geo = new THREE.OctahedronGeometry(0.16, 0);

  constructor(
    private readonly game: Game,
    private readonly root: THREE.Object3D,
  ) {}

  spawn(kind: PickupKind, pos: THREE.Vector3): void {
    if (kind !== 'sustain' && kind !== 'ammo' && kind !== 'echo') {
      console.warn(`[mission] unknown pickup kind "${String(kind)}" — ignored`);
      return;
    }
    const real = (combat as unknown as { spawnPickup?: SpawnPickup }).spawnPickup;
    if (typeof real === 'function') {
      try {
        real(this.game, kind, pos);
        return;
      } catch (err) {
        reportError('pickup:spawn', err);
      }
    }
    const mat = new THREE.MeshStandardMaterial({ color: 0x101216, emissive: COLORS[kind], emissiveIntensity: 2.6, roughness: 0.3, metalness: 0.4 });
    const mesh = new THREE.Mesh(this.geo, mat);
    mesh.position.set(pos.x, pos.y + 0.9, pos.z);
    this.root.add(mesh);
    const marker = kind === 'sustain' ? this.game.vfx.spawn('healPickup', mesh.position) : null;
    this.items.push({ kind, pos: pos.clone(), mesh, marker: marker && !isStub(marker) ? marker : null });
  }

  update(dt: number, time: number): void {
    if (this.items.length === 0) return;
    const { player } = this.game;
    const actor = isStub(player) ? null : player.actor;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.mesh.rotation.y += dt * 1.6;
      it.mesh.position.y = it.pos.y + 0.9 + Math.sin(time * 2 + i) * 0.06;
      if (!actor || isStub(actor) || actor.alive === false) continue;
      if (Math.hypot(actor.pos.x - it.pos.x, actor.pos.z - it.pos.z) > COLLECT_RADIUS || Math.abs(actor.pos.y - it.pos.y) > 2) continue;
      this.collect(it);
      this.items.splice(i, 1);
    }
  }

  dispose(): void {
    for (const it of this.items) this.release(it);
    this.items.length = 0;
    this.geo.dispose();
  }

  private collect(it: FallbackPickup): void {
    const { player, audio, vfx, events } = this.game;
    if (it.kind === 'sustain') {
      player.heal(HEAL);
      audio.play('healPickup', { pos: it.pos });
      vfx.spawn('healBurst', it.pos);
    } else if (it.kind === 'echo') {
      player.addEcho(ECHO, 'pickup');
      audio.play('echoGain', { pos: it.pos });
    } else {
      const hud = player.getHudState();
      const mag = Number(hud?.magSize) || 6;
      player.setAmmo(mag, (Number(hud?.reserve) || 0) + mag * 2);
      audio.play('ammoPickup', { pos: it.pos });
    }
    events.emit('player:pickup', { kind: it.kind });
    this.release(it);
  }

  private release(it: FallbackPickup): void {
    it.marker?.stop();
    it.mesh.removeFromParent();
    (it.mesh.material as THREE.Material).dispose();
  }
}
