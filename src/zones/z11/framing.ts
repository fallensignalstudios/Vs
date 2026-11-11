/**
 * Z11 / Z12 — standing coverage that does not depend on which way a body happens to be turned: a close single
 * framed from the listener's side of the line (`toward`), and a helper that stows the leads' weapons for scenes
 * with nobody to fight.
 */
import * as THREE from 'three';
import { isHumanoidVisual, type Actor, type CamPose, type CineCtx, type Companion } from '@/core/api';

type Body = Actor | Companion | THREE.Vector3 | null | undefined;

function feetOf(b: Body, fallback: THREE.Vector3): THREE.Vector3 {
  if (!b) return fallback.clone();
  if (b instanceof THREE.Vector3) return b.clone();
  const a = (b as Companion).actor ?? (b as Actor);
  return a.pos.clone();
}

/**
 * A single of `subject` speaking to `listener`: the camera stands `dist` metres from the subject, `offDeg` off
 * the subject→listener line (positive = clockwise seen from above), just below head height `h`, looking up at
 * the face.
 * Because it is built on the line between the two, the subject is always seen from the front.
 */
export function towardPose(subject: Body, listener: Body, offDeg: number, dist: number, fov: number, h = 1.62): CamPose {
  const s = feetOf(subject, new THREE.Vector3());
  const l = feetOf(listener, s.clone().add(new THREE.Vector3(0, 0, -1)));
  const dir = l.clone().sub(s).setY(0);
  if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
  dir.normalize();
  // rotate clockwise (seen from above) by offDeg: world yaw rotation of −offDeg about +Y
  dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), -THREE.MathUtils.degToRad(offDeg));
  // a little below the eyes, looking up: a lowered head still shows its face
  return { pos: s.clone().addScaledVector(dir, dist).setY(s.y + h - 0.2), look: s.clone().setY(s.y + h - 0.02), fov };
}

export function toward(c: CineCtx, subject: Body, listener: Body, offDeg: number, dist: number, fov: number, h = 1.62): void {
  c.cut(towardPose(subject, listener, offDeg, dist, fov, h));
}

/**
 * Lyric's infection as Z06 leaves it and Z07 / Z08 carry it (face-only, 0.45): violet in the irises, dark veins
 * at the temples and down the neck — “It isn’t reversing.” Nothing else on the figure changes (polish 3, chars).
 */
export const LYRIC_CORRUPTION = 0.45;
export function lyricFace(lyric: Actor | Companion | null | undefined): void {
  if (!lyric) return;
  const a = (lyric as Companion).actor ?? (lyric as Actor);
  a.visual?.setCorruption(LYRIC_CORRUPTION, { mode: 'face' });
}

/** stow the leads' weapons (the player's kit draws its melee weapon on spawn and on a checkpoint restore) */
export function sheathe(...who: Array<Actor | Companion | null | undefined>): void {
  for (const b of who) {
    if (!b) continue;
    const a = (b as Companion).actor ?? (b as Actor);
    const v = a.visual;
    if (v && isHumanoidVisual(v)) v.setLoadout({ melee: false, ranged: false });
  }
}
