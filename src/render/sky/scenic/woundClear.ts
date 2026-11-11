/**
 * The Wound-clear rule for scenic pieces that share the `woundVista` sky (terminalVista, crownmarkArm): the void
 * must read as an absence, so nothing may SHINE inside it (a lone light there reads as a star in the Wound) and
 * nothing may stand in it (a spire cutting the opening breaks its silhouette).
 * The cone is the VOID's (its faintest fringe, fully swollen), not the whole Wound's: the crust and the smoke of its
 * lower funnel are matter in front of space and may sink behind the city, as in the overlook painting, where the
 * spires rise in front of the funnel and the opening floats above them.
 * Inside the cone's azimuths, structures are capped just under the void's lower arc and carry no lights there;
 * they remain dark, key-lit silhouettes against the funnel.
 */
import type * as THREE from 'three';
import { woundScale } from '../dome';
import { woundVoidReach } from '../domeShader';
import { SKY_PRESETS, dirFromAzEl } from '../presets';

const DEG = Math.PI / 180;
/** eye height the rule is evaluated from */
export const EYE = 1.7;
/** lights are tolerated this far above the horizon inside the cone (the city's own glow line) */
const GLOW_LINE = 1.1 * DEG;
/** the furthest the void reaches straight down, fully swollen (Wound radii): its lowest point */
export const VOID_DOWN = woundVoidReach(0, -1) * woundScale(1);
/** clear sky kept between a capped structure's top and the void's lowest fringe */
const MARGIN = 0.4 * DEG;
/** a structure's own angular half-width, allowed for when its cap is read off the void's arc */
const PAD = 1.5 * DEG;

export interface WoundCone { dir: THREE.Vector3; radius: number }

/** The cone the woundVista preset's void occupies (to its lowest fringe), as seen from the overlook. */
export function woundCone(): WoundCone {
  const w = SKY_PRESETS.woundVista.wound;
  return { dir: dirFromAzEl(w.at[0], w.at[1]), radius: w.radius * DEG * VOID_DOWN };
}

/** Does a piece-local point project inside the void's cone (above the glow line)? */
export function insideWound(cone: WoundCone, x: number, y: number, z: number, margin = 1.04): boolean {
  const dy = y - EYE;
  const l = Math.hypot(x, dy, z);
  if (l < 1e-6) return false;
  if (Math.asin(dy / l) < GLOW_LINE) return false;
  const c = (x * cone.dir.x + dy * cone.dir.y + z * cone.dir.z) / l;
  return Math.acos(Math.max(-1, Math.min(1, c))) < cone.radius * margin;
}

/**
 * The elevation (radians) under which a structure standing `daz` radians of azimuth off the cone's centre stays
 * clear of the void: just under the cone's lower arc at that azimuth (allowing for the structure's own width), or
 * null where the cone does not reach down over that azimuth at all.
 */
export function woundCap(cone: WoundCone, daz: number): number | null {
  const el = Math.asin(Math.max(-1, Math.min(1, cone.dir.y)));
  const d = Math.max(Math.abs(daz) - PAD, 0);
  const r = cone.radius * 1.04;
  if (d >= r) return null;
  return el - Math.sqrt(r * r - d * d) - MARGIN;
}

/**
 * Tallest a structure at (x, z) may stand (`top` = wanted top height) and whether it may carry lights. Anything
 * standing under the void (seen from the overlook) is capped under its lower arc: a spire whose top would rise past
 * it would otherwise cut the opening on the way up.
 */
export function woundLimit(cone: WoundCone | null, x: number, z: number, top: number): { top: number; lit: boolean } {
  if (!cone) return { top, lit: true };
  const hd = Math.hypot(x, z);
  const ch = Math.hypot(cone.dir.x, cone.dir.z);
  if (hd < 1e-6 || ch < 1e-6) return { top, lit: !insideWound(cone, x, top, z, 1.1) };
  const daz = Math.acos(Math.max(-1, Math.min(1, (x * cone.dir.x + z * cone.dir.z) / (hd * ch))));
  const cap = woundCap(cone, daz);
  const capTop = cap === null ? Number.POSITIVE_INFINITY : EYE + Math.tan(Math.max(cap, 1.5 * DEG)) * hd;
  if (top <= capTop) return { top, lit: !insideWound(cone, x, top, z, 1.1) };
  return { top: capTop, lit: !insideWound(cone, x, capTop, z, 1.1) };
}
