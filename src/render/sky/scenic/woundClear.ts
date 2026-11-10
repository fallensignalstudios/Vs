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
/**
 * Structure tops inside the cone stay below this elevation: a little under the disc's lower limb, so no spire
 * ever cuts into the Wound's silhouette (the accretion swirl beyond the rim may sink behind them).
 */
const CAP = Math.max(SKY_PRESETS.woundVista.wound.at[1] - SKY_PRESETS.woundVista.wound.radius * 1.12, 1.5) * DEG;

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

/**
 * Tallest a structure at (x, z) may stand (`top` = wanted top height) and whether it may carry lights. Anything
 * standing in the disc's azimuth band (seen from the overlook) is capped under the lower limb — a spire whose top
 * would rise past the disc would otherwise cut its silhouette on the way up.
 */
export function woundLimit(cone: WoundCone | null, x: number, z: number, top: number): { top: number; lit: boolean } {
  if (!cone) return { top, lit: true };
  const hd = Math.hypot(x, z);
  const ch = Math.hypot(cone.dir.x, cone.dir.z);
  if (hd < 1e-6 || ch < 1e-6) return { top, lit: !insideWound(cone, x, top, z, 1.1) };
  const daz = Math.acos(Math.max(-1, Math.min(1, (x * cone.dir.x + z * cone.dir.z) / (hd * ch))));
  const inBand = daz * ch < cone.radius * 1.15;
  const capTop = EYE + Math.tan(CAP) * hd;
  if (!inBand || top <= capTop) return { top, lit: !insideWound(cone, x, top, z, 1.1) };
  return { top: capTop, lit: !insideWound(cone, x, capTop, z, 1.1) };
}
