/**
 * Z03 — the per-load state shared by the zone's modules (z03.ts and ./*.ts). Rebuilt by `build()` and cleared by
 * `ZoneDef.dispose()`: nothing here survives a zone load.
 */
import type * as THREE from 'three';
import type { Actor, BeamHandle, DoorHandle, HologramProp, Interactable, ScanPlaneHandle } from '@/core/api';
import type { PlaneSpec } from './layout';

/** one scan plane and what the zone tracks about it */
export interface PlaneState {
  spec: PlaneSpec;
  handle: ScanPlaneHandle | null;
  /** the zone's own copy of the plane's phase (same clock and rate as the AI's) — the trace and the captions use it */
  phase: number;
  rate: number;
  /** the trace from the plane back to the projector (made once, dimmed when not shown) */
  trace: BeamHandle | null;
  /** last direction of travel (+1 toward x1, −1 back), for the per-sweep caption */
  dir: number;
  /** zone time of the last sweep caption */
  captionAt: number;
}

export interface Z03State {
  // --- built ---
  exit: DoorHandle | null;
  /** the dropship's rear hatch (pivots at its hinge) and the light inside the hull */
  hatch: THREE.Object3D | null;
  hatchLight: THREE.PointLight | null;
  /** 0 closed … 1 lowered: target and current value (ZoneDef.update eases it; a skip snaps) */
  hatchTarget: number;
  hatchOpen: number;
  /** the anchor tether from the hull to the rib: 0 slack in the hull … 1 taut */
  tether: THREE.Object3D | null;
  tetherTarget: number;
  tetherLen: number;
  /** the tissue behind the ice by the terminal (it stirs in `terminalRead`) */
  stir: THREE.Object3D | null;
  stirTarget: number;
  stirLevel: number;
  /** the sensor reconstruction over the terminal */
  holo: HologramProp | null;
  holoVisible: number;
  holoProgress: number;
  // --- the scanner ---
  planes: PlaneState[];
  /** the projector on the service deck: a physical, destructible device actor */
  source: Actor | null;
  sourceDown: boolean;
  sourceIx: Interactable | null;
  /** Tharne has named the source (traces may now show from a valid angle) */
  identified: boolean;
  /** detections seen this load (the first one sets `z03Detected`) */
  detections: number;
  /** music tension after a detection (decays) */
  tension: number;
  /** traces forced visible until this zone time (Tharne marks the source on his viewmaker) */
  forceTraceUntil: number;
  /** Lyric's trembling hand on the rib (arrival): world target, or null */
  tremble: THREE.Vector3 | null;
  /** Tharne holds Lyric up (arrival): both figures' hands are driven by IK while true */
  catching: boolean;
  /** some IK hand was driven last frame (so it is released once, not every frame) */
  handsHeld: boolean;
  /** terminal interaction */
  terminalIx: Interactable | null;
}

export let S: Z03State = blank();

function blank(): Z03State {
  return {
    exit: null, hatch: null, hatchLight: null, hatchTarget: 0, hatchOpen: 0,
    tether: null, tetherTarget: 0, tetherLen: 1, stir: null, stirTarget: 0, stirLevel: 0,
    holo: null, holoVisible: 0, holoProgress: 0,
    planes: [], source: null, sourceDown: false, sourceIx: null, identified: false, detections: 0, tension: 0, forceTraceUntil: -Infinity,
    tremble: null, catching: false, handsHeld: false, terminalIx: null,
  };
}

/** forget every per-load object (build() and ZoneDef.dispose()) */
export function resetState(): void {
  S = blank();
}
