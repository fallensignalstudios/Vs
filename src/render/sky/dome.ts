/** The sky dome mesh: one inside-out box pinned to the far plane (depth-tested, never written). */
import * as THREE from 'three';
import { DOME_FRAGMENT, DOME_VERTEX } from './domeShader';
import type { SkyState } from './presets';
import { SKY_ORDER, viewportTracker, type SharedUniforms } from './shared';

export interface SkyDome {
  readonly mesh: THREE.Mesh;
  /** push the blended state + animated scalars into the shader */
  apply(state: SkyState, activity: number, closed: number): void;
  dispose(): void;
}

export function createSkyDome(shared: SharedUniforms): SkyDome {
  const uniforms = {
    uTime: shared.uTime, uFarZ: shared.uFarZ, uDetail: shared.uDetail,
    uCamRight: { value: new THREE.Vector3(1, 0, 0) }, uCamUp: { value: new THREE.Vector3(0, 1, 0) },
    uHaze: shared.uHaze, uHazeRed: shared.uHazeRed, uHazeWhite: shared.uHazeWhite,
    uRedDir: shared.uRedDir, uWhiteDir: shared.uWhiteDir, uWoundDir: shared.uWoundDir,
    uWoundR: { value: 0.1 }, uWoundVis: { value: 0 }, uWoundLens: { value: 0.55 }, uWoundDebris: { value: 1 },
    uWoundHalo: { value: 1 }, uActivity: { value: 0.3 }, uClosed: { value: 0 },
    uRedR: { value: 0.07 }, uRedVis: { value: 0 }, uWhiteR: { value: 0.003 }, uWhiteVis: { value: 0 },
    uStars: { value: 1 }, uNebula: { value: 0.6 },
    uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() },
    uHazeAmt: shared.uHazeAmt, uHazeFall: shared.uHazeFall, uGround: { value: 0 }, uGain: { value: 1 },
  };
  const material = new THREE.ShaderMaterial({
    name: 'SkyDome',
    uniforms,
    vertexShader: DOME_VERTEX,
    fragmentShader: DOME_FRAGMENT,
    side: THREE.DoubleSide,
    depthTest: true,
    depthWrite: false,
    fog: false,
  });
  const geometry = new THREE.BoxGeometry(2, 2, 2);
  const mesh = new THREE.Mesh(geometry, material);
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
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
