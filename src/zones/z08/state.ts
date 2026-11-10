/**
 * Z08 — the per-load state shared by the zone's modules (z08.ts and ./*.ts). Rebuilt by `build()` and cleared by
 * `ZoneDef.dispose()`: nothing here survives a zone load.
 */
import type * as THREE from 'three';
import type {
  Actor, BarrierHandle, CharacterVisual, DeviceHandle, DoorHandle, EliteController, Encounter,
} from '@/core/api';

/** where the fight is: phase A (Selene), phase B (Tarrik), the authored finish, over */
export type FightStage = 'A' | 'B' | 'finish' | 'done';

/** a Reformation grav litter: a sled that rides one escort, with a lying figure on it */
export interface Litter {
  readonly id: string;
  readonly group: THREE.Group;
  /** the figure on the sled (owned by the zone, updated by the zone) */
  passenger: CharacterVisual | null;
  /** cast name of the escort the litter rides in front of; null = resting where it stands */
  escort: string | null;
}

export interface Z08State {
  // --- built ---
  entry: DoorHandle | null;
  exit: DoorHandle | null;
  /** the two manual shutters that gate the east deck route (south and north ramp feet) */
  gateS: DoorHandle | null;
  gateN: DoorHandle | null;
  /** isolation barriers: west (Lyessa), south (Tharne and Lyric), east (beyond), the exit seal */
  barrierW: BarrierHandle | null;
  barrierS: BarrierHandle | null;
  barrierE: BarrierHandle | null;
  barrierExit: BarrierHandle | null;
  /** the pale floor lines the barriers rise from (brightened when the floor divides) */
  seams: THREE.Object3D[];
  // --- encounter ---
  enc: Encounter | null;
  elite: Actor | null;
  ctl: EliteController | null;
  weaver: Actor | null;
  anchor: DeviceHandle | null;
  frost: DeviceHandle | null;
  stage: FightStage;
  /** the joint Resonance happened (Thermal Fracture) */
  fractured: boolean;
  /** the elite has reached its last health: the authored finish is due */
  finishDue: boolean;
  /** a scripted vignette is playing (the fracture strike) — the finish waits for it */
  vignette: boolean;
  /** the Z07 consequence has been announced in phase A */
  announced: boolean;
  /** the east deck route is open */
  flankOpen: boolean;
  /** pressure field edge detection */
  pressureWas: boolean;
  // --- people ---
  litters: Litter[];
  /** the officer inside the organism (finish) and what is left of him afterwards */
  officer: CharacterVisual | null;
  officerRig: THREE.Group | null;
}

export let S: Z08State = blank();

export function blank(): Z08State {
  return {
    entry: null, exit: null, gateS: null, gateN: null,
    barrierW: null, barrierS: null, barrierE: null, barrierExit: null, seams: [],
    enc: null, elite: null, ctl: null, weaver: null, anchor: null, frost: null,
    stage: 'A', fractured: false, finishDue: false, vignette: false, announced: false, flankOpen: false, pressureWas: false,
    litters: [], officer: null, officerRig: null,
  };
}

/** forget every per-load object (build() and ZoneDef.dispose()) */
export function resetState(): void {
  S = blank();
}
