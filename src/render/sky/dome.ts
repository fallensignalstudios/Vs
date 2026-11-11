/** The sky dome mesh: one inside-out box pinned to the far plane (depth-tested, never written). */
import * as THREE from 'three';
import { DOME_FRAGMENT, DOME_VERTEX } from './domeShader';
import type { SkyState } from './presets';
import { SKY_ORDER, viewportTracker, type SharedUniforms } from './shared';

/**
 * The Wound breathes with its activity: drawn back (activity → 0) it contracts to 80 % of its authored radius,
 * at the default 0.3 it is exactly the authored size, and at full activity it swells by 3 %.
 */
export function woundScale(activity: number): number {
  const a = Math.min(Math.max(Number.isFinite(activity) ? activity : 0.3, 0), 1);
  const s1 = (t: number): number => t * t * (3 - 2 * t);
  return WOUND_SCALE_MIN + (1 - WOUND_SCALE_MIN) * s1(Math.min(a / 0.3, 1)) + 0.03 * s1(Math.max(0, (a - 0.3) / 0.7));
}
/** how far the Wound contracts when its activity is drawn right back to 0 */
export const WOUND_SCALE_MIN = 0.8;

export interface SkyDome {
  readonly mesh: THREE.Mesh;
  /** push the blended state + animated scalars into the shader */
  apply(state: SkyState, activity: number, closed: number): void;
  /** quality tier 0 low · 1 medium · 2 high: swaps to the fragment program compiled for it (built on first use) */
  setDetail(level: number): void;
  readonly detail: number;
  dispose(): void;
}

export function createSkyDome(shared: SharedUniforms): SkyDome {
  const uniforms = {
    uTime: shared.uTime, uFarZ: shared.uFarZ, uLite: shared.uLite,
    uCamRight: { value: new THREE.Vector3(1, 0, 0) }, uCamUp: { value: new THREE.Vector3(0, 1, 0) },
    uHaze: shared.uHaze, uHazeRed: shared.uHazeRed, uHazeWhite: shared.uHazeWhite,
    uRedDir: shared.uRedDir, uWhiteDir: shared.uWhiteDir, uWoundDir: shared.uWoundDir,
    uWoundR: { value: 0.1 }, uWoundVis: { value: 0 }, uWoundLens: { value: 0.55 }, uWoundDebris: { value: 1 },
    uWoundHalo: { value: 1 }, uWoundThroat: { value: 0 }, uActivity: { value: 0.3 }, uClosed: { value: 0 },
    uRedR: { value: 0.07 }, uRedVis: { value: 0 }, uWhiteR: { value: 0.003 }, uWhiteVis: { value: 0 },
    uStars: { value: 1 }, uNebula: { value: 0.6 },
    uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() },
    uHazeAmt: shared.uHazeAmt, uHazeFall: shared.uHazeFall, uGround: { value: 0 }, uGain: { value: 1 },
    uSat: { value: 1 }, uNebTint: { value: new THREE.Color(1, 1, 1) }, uStarDens: { value: 1 }, uRedGain: { value: 1 },
    uEnclose: { value: 0 }, uEncCol: { value: new THREE.Color() }, uVeil: { value: 0 }, uWoundScale: { value: 1 }, uSwirl: { value: 1 }, uWoundCore: { value: 1 }, uCoreTint: { value: new THREE.Color(1, 1, 1) }, uMatterTint: { value: new THREE.Color(1, 1, 1) }, uTint: { value: new THREE.Color(1, 1, 1) }, uSkyTint: { value: new THREE.Color(1, 1, 1) },
  };
  // one program per quality tier, sharing every uniform; variants are created the first time they are needed
  const variants: Array<THREE.ShaderMaterial | null> = [null, null, null];
  const variant = (level: number): THREE.ShaderMaterial => {
    let m = variants[level];
    if (!m) {
      m = new THREE.ShaderMaterial({
        name: `SkyDome:${['low', 'medium', 'high'][level]}`,
        uniforms,
        defines: { SKY_DETAIL: level },
        vertexShader: DOME_VERTEX,
        fragmentShader: DOME_FRAGMENT,
        side: THREE.DoubleSide,
        depthTest: true,
        depthWrite: false,
        fog: false,
      });
      variants[level] = m;
    }
    return m;
  };
  let detail = 2;
  const geometry = new THREE.BoxGeometry(2, 2, 2);
  const mesh = new THREE.Mesh(geometry, variant(detail));
  mesh.name = 'sky:dome';
  mesh.frustumCulled = false;
  mesh.renderOrder = SKY_ORDER.dome;
  const track = viewportTracker(shared);
  mesh.onBeforeRender = (renderer, scene, camera, geo, mat, group) => {
    track.call(mesh, renderer, scene, camera, geo, mat, group);
    // screen axes of the pass being drawn: the white remnant's streak stays level however the camera pitches
    const e = camera.matrixWorld.elements;
    uniforms.uCamRight.value.set(e[0], e[1], e[2]).normalize();
    uniforms.uCamUp.value.set(e[4], e[5], e[6]).normalize();
  };
  mesh.matrixAutoUpdate = false;

  return {
    mesh,
    apply(s, activity, closed) {
      uniforms.uWoundR.value = Math.max(s.woundRadius, 1e-3);
      uniforms.uWoundVis.value = s.woundVis;
      uniforms.uWoundLens.value = s.woundLens;
      uniforms.uWoundDebris.value = s.woundDebris;
      uniforms.uWoundHalo.value = s.woundHalo;
      uniforms.uWoundThroat.value = s.woundThroat;
      uniforms.uActivity.value = activity;
      uniforms.uClosed.value = closed;
      uniforms.uRedR.value = Math.max(s.redRadius, 1e-3);
      uniforms.uRedVis.value = s.redVis;
      uniforms.uWhiteR.value = Math.max(s.whiteRadius, 1e-4);
      uniforms.uWhiteVis.value = s.whiteVis;
      uniforms.uStars.value = s.stars;
      uniforms.uNebula.value = s.nebula;
      uniforms.uZenith.value.copy(s.zenith);
      uniforms.uHorizon.value.copy(s.horizon);
      uniforms.uGround.value = s.ground;
      uniforms.uGain.value = s.gain;
      uniforms.uSat.value = s.sat;
      uniforms.uNebTint.value.copy(s.nebulaTint);
      uniforms.uStarDens.value = s.starDensity;
      uniforms.uRedGain.value = s.redGain;
      uniforms.uEnclose.value = s.enclosure;
      uniforms.uEncCol.value.copy(s.enclosureColor);
      uniforms.uVeil.value = s.veil;
      uniforms.uSwirl.value = s.swirl;
      uniforms.uWoundCore.value = s.woundCore;
      uniforms.uCoreTint.value.copy(s.coreTint);
      uniforms.uMatterTint.value.copy(s.matterTint);
      uniforms.uTint.value.copy(s.tint);
      uniforms.uSkyTint.value.copy(s.skyTint);
      uniforms.uWoundScale.value = woundScale(activity);
    },
    get detail() { return detail; },
    setDetail(level) {
      const next = level <= 0 ? 0 : level >= 2 ? 2 : 1;
      if (next === detail) return;
      detail = next;
      mesh.material = variant(next);
    },
    dispose() {
      geometry.dispose();
      for (const m of variants) m?.dispose();
    },
  };
}
