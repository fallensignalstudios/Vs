/**
 * Z06 — per-load state (rebuilt by build(), cleared by ZoneDef.dispose()). Nothing here survives a zone load:
 * every beat's `enter` rebuilds the world it needs from the markers and the mission flags.
 */
import type * as THREE from 'three';
import type { Actor, DeviceHandle, DoorHandle, Encounter, HeroProp, Interactable } from '@/core/api';

export interface Z06State {
  /** east exit to Z07 and the west entry the party comes through */
  exit: DoorHandle | null;
  entry: DoorHandle | null;
  /** the fallen plate pinning the marine (hero prop) and its lift target while the hold runs */
  plate: HeroProp<{ lift: number }> | null;
  /** the hold interaction on the plate's protected side */
  lift: Interactable | null;
  /** the elevated seam on the west face of the north pier: its emissive line and the seam's current glow */
  seamMat: THREE.MeshStandardMaterial | null;
  seamGlow: number;
  /** seconds of the pre-telegraph flicker left (something is moving inside the seam) */
  seamFlicker: number;
  /** the lead is holding the plate right now (hands pinned to its grips) */
  lifting: boolean;
  /** the second breach: the growth that plugs it until it bursts, and its violet light */
  plug: THREE.Object3D | null;
  plugLight: THREE.PointLight | null;
  /** E3 */
  enc: Encounter | null;
  anchor: DeviceHandle | null;
  wallrunner: Actor | null;
  weaver: Actor | null;
  /** the first body: «King?», and the light on the human half of its face (dark outside the close-up) */
  king: Actor | null;
  kingLight: THREE.PointLight | null;
  /** the fight's forked routines and subscriptions have been started this load */
  fightLive: boolean;
  /** materials the zone made itself (the crystal growth): released with the state */
  owned: THREE.Material[];
  /** the plate ring's gold channel material (the kit's), reused for the walls' gold inlay; not owned */
  inlayGold: THREE.Material | null;
}

export let S: Z06State = blank();

function blank(): Z06State {
  return {
    exit: null, entry: null, plate: null, lift: null, seamMat: null, seamGlow: 0, seamFlicker: 0, lifting: false,
    plug: null, plugLight: null,
    enc: null, anchor: null, wallrunner: null, weaver: null, king: null, kingLight: null, fightLive: false, owned: [], inlayGold: null,
  };
}

/** release the plate (its materials are not under the zone root) and the seam material, then forget everything */
export function resetState(): void {
  S.plate?.dispose();
  S.seamMat?.dispose();
  for (const m of S.owned) m.dispose();
  S = blank();
}
