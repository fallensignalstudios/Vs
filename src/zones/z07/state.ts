/**
 * Z07 — per-load state (rebuilt by build(), cleared by ZoneDef.dispose()). Nothing here survives a zone load:
 * every beat's `enter` rebuilds the world it needs from the markers, the mission flags and `z.state`.
 */
import type * as THREE from 'three';
import type { DoorHandle, HeroProp, HologramProp } from '@/core/api';
import type { TextPanel } from './display';

/** a containment cage beyond the glass, and the zone light that rims it (faction colour → violet as it spreads) */
export interface CageRig {
  prop: HeroProp<{ charge: number; destroyed: number }>;
  /** the cage's own origin (world) and the point the fire lands on (its core, world) */
  base: THREE.Vector3;
  core: THREE.Vector3;
  light: THREE.PointLight;
  /** faction colour of the rim light */
  tint: THREE.Color;
  /** 0…1 how far the Eclipse has spread along the containment geometry (eased toward `spreadTarget`) */
  spread: number;
  spreadTarget: number;
  /** 0…1 overall rim light level (eased toward `litTarget`; 0 once the cage is gone) */
  lit: number;
  litTarget: number;
}

export interface Z07State {
  /** exit to Z08 (south wall) */
  exit: DoorHandle | null;
  /** the two cages, outside the terminal at scenic distance */
  dom: CageRig | null;
  ref: CageRig | null;
  /** the interoperability display over the auxiliary desk, and its three label lines */
  streams: HologramProp | null;
  streamLabels: TextPanel[];
  /** the contamination record over the O3 side console, and its text block */
  record: HologramProp | null;
  recordText: TextPanel | null;
  /** the two personal displays: Selene's command strip (cold) and Tarrik's (amber) */
  stripSelene: TextPanel | null;
  stripTarrik: TextPanel | null;
  /** Reformation equipment lights in the gallery (they flicker while the Eclipse uses the field) */
  refLights: THREE.PointLight[];
  refLightBase: number[];
  /** seconds of flicker left */
  flicker: number;
  /** the fallen plating that constricts the two survivor routes (hidden until it falls) */
  plating: THREE.Object3D[];
  /** the field cache staged in the west route once the stretcher cases go first */
  cacheWest: THREE.Object3D | null;
}

export let S: Z07State = blank();

function blank(): Z07State {
  return {
    exit: null, dom: null, ref: null, streams: null, streamLabels: [], record: null, recordText: null,
    stripSelene: null, stripTarrik: null, refLights: [], refLightBase: [], flicker: 0, plating: [], cacheWest: null,
  };
}

/** release the hero props and text panels (their materials are not under the zone root), then forget everything */
export function resetState(): void {
  S.dom?.prop.dispose();
  S.ref?.prop.dispose();
  S.streams?.dispose();
  S.record?.dispose();
  for (const p of [...S.streamLabels, S.recordText, S.stripSelene, S.stripTarrik]) p?.dispose();
  S = blank();
}
