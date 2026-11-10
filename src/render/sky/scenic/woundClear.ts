/**
 * The Wound-clear rule for scenic pieces that share the `woundVista` sky (terminalVista, crownmarkArm): the disc
 * must read as an absence, so nothing may SHINE inside it — a lone light there reads as a star in the Wound.
 * Inside the Wound's cone (as seen from the overlook origin) structures are capped low and carry no lights; they
 * remain as dark, key-lit silhouettes sunk in the horizon haze.
 */
import type * as THREE from 'three';
import { SKY_PRESETS, dirFromAzEl } from '../presets';

const DEG = Math.PI / 180;
/** eye height the rule is evaluated from */
export const EYE = 1.7;
/** lights are tolerated this far above the horizon inside the cone (the city's own glow line) */
const GLOW_LINE = 1.1 * DEG;
/** structure tops inside the cone stay below this elevation */
const CAP = 6 * DEG;

export interface WoundCone { dir: THREE.Vector3; radius: number }

/** The cone the woundVista preset's Wound occupies, as seen from the overlook. */
export function woundCone(): WoundCone {
  const w = SKY_PRESETS.woundVista.wound;
  return { dir: dirFromAzEl(w.at[0], w.at[1]), radius: w.radius * DEG };
}

/** Does a piece-local point project inside the visible part of the Wound's disc (above the glow line)? */
export function insideWound(cone: WoundCone, x: number, y: number, z: number, margin = 1.04): boolean {
  const dy = y - EYE;
  const l = Math.hypot(x, dy, z);
  if (l < 1e-6) return false;
  if (Math.asin(dy / l) < GLOW_LINE) return false;
  const c = (x * cone.dir.x + dy * cone.dir.y + z * cone.dir.z) / l;
  return Math.acos(Math.max(-1, Math.min(1, c))) < cone.radius * margin;
}

/** Tallest a structure at (x, z) may stand (`top` = wanted top height) and whether it may carry lights. */
export function woundLimit(cone: WoundCone | null, x: number, z: number, top: number): { top: number; lit: boolean } {
  if (!cone || !insideWound(cone, x, top, z, 1.1)) return { top, lit: true };
  const capped = Math.min(top, EYE + Math.tan(CAP) * Math.hypot(x, z));
  return { top: capped, lit: !insideWound(cone, x, capped, z, 1.1) };
}
