/** ScenicFactory — builds the non-colliding megastructure backdrop pieces (see src/core/api/sky.ts). */
import * as THREE from 'three';
import type { Game, ScenicFactory } from '@/core/api';
import type { SharedUniforms } from '../shared';
import { buildAtriumShell } from './atriumShell';
import type { ClipTipSlot } from './clipTower';
import { buildCrownmarkArm } from './crownmarkArm';
import { buildMegaRibs } from './megaRibs';
import { ShipMaterials, buildShip, buildWreck } from './ships';
import { buildTerminalVista } from './terminalVista';

export interface ScenicRuntime extends ScenicFactory {
  /** animate time-dependent scenic materials (failing wreck lights) */
  update(time: number): void;
  dispose(): void;
}

const SHIP_KINDS = ['dominionShuttle', 'reformationTransport', 'dominionCapital', 'reformationCapital'] as const;
const warned = new Set<string>();

/** Bad input never throws: warn once and hand back an empty group so zone code keeps running. */
function guarded(what: string, build: () => THREE.Object3D): THREE.Object3D {
  try {
    return build();
  } catch (err) {
    if (!warned.has(what)) {
      warned.add(what);
      console.warn(`[sky] scenic.${what} failed — returning an empty group`, err);
    }
    const g = new THREE.Group();
    g.name = `scenic:${what}:empty`;
    return g;
  }
}

export function createScenicFactory(game: Game, shared: SharedUniforms, tips: ClipTipSlot): ScenicRuntime {
  const shipMats = new ShipMaterials(game);
  return {
    terminalVista: (opts) => guarded('terminalVista', () => buildTerminalVista(shared, opts)),
    atriumShell: (opts) => guarded('atriumShell', () => buildAtriumShell(shared, tips, opts)),
    crownmarkArm: (opts) => guarded('crownmarkArm', () => buildCrownmarkArm(shared, opts)),
    megaRibs: (opts) => guarded('megaRibs', () => buildMegaRibs(shared, opts)),
    ship: (kind, opts) => guarded('ship', () => {
      let k = kind;
      if (!SHIP_KINDS.includes(k)) {
        if (!warned.has(`ship:${String(kind)}`)) {
          warned.add(`ship:${String(kind)}`);
          console.warn(`[sky] unknown ship kind "${String(kind)}" — using dominionShuttle`);
        }
        k = 'dominionShuttle';
      }
      return buildShip(shared, shipMats, k, opts?.scale);
    }),
    wreck: (kind, opts) => guarded('wreck', () => buildWreck(shipMats, game, kind === 'reformation' ? 'reformation' : 'dominion', opts?.scale, opts?.seed)),
    update(time) { shipMats.update(time); },
    dispose() { shipMats.dispose(); },
  };
}
