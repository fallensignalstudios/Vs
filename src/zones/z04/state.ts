/**
 * Z04 — the per-load state shared by the zone's modules (z04.ts and ./*.ts). Rebuilt by `build()` and cleared by
 * `ZoneDef.dispose()`: nothing here survives a zone load.
 */
import type { Actor, DeviceHandle, DoorHandle, Encounter, HologramProp, Interactable } from '@/core/api';

/** the authored "turn as one" of the two contaminated drones (book: every unit rotates at the same moment) */
export interface UnisonTurn {
  drones: Actor[];
  from: number[];
  to: number[];
  /** seconds into the turn / its length */
  t: number;
  len: number;
}

export interface Z04State {
  // --- built ---
  entry: DoorHandle | null;
  exit: DoorHandle | null;
  /** the O2 sensor reconstruction on the elevated pocket */
  holo: HologramProp | null;
  /** target the hologram's replay eases toward (0…1); a skip snaps it */
  holoProgress: number;
  holoVisible: number;
  // --- encounter E2 ---
  enc: Encounter | null;
  rxA: DeviceHandle | null;
  rxB: DeviceHandle | null;
  scan: DeviceHandle | null;
  /** close-interaction disables of the two receivers */
  ixA: Interactable | null;
  ixB: Interactable | null;
  /**
   * The lead has not been noticed yet: neither group has her as a target (her body is untargetable) until the scan
   * head sweeps her, she strikes anything in the encounter, or she walks up close. Z03 detection skips this.
   */
  unseen: boolean;
  /** the drones' authored turn toward the lead (overlook, `z03Detected`) */
  turn: UnisonTurn | null;
}

export let S: Z04State = blank();

function blank(): Z04State {
  return {
    entry: null, exit: null, holo: null, holoProgress: 0, holoVisible: 0,
    enc: null, rxA: null, rxB: null, scan: null, ixA: null, ixB: null, unseen: false, turn: null,
  };
}

/** forget every per-load object (build() and ZoneDef.dispose()) */
export function resetState(): void {
  S = blank();
}
