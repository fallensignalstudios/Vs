/**
 * Uniforms shared by reference between the dome, the battle layer, the carrier and every scenic material, so a
 * preset change (haze colour, remnant directions, key light) reaches all far-field shaders at once.
 */
import * as THREE from 'three';
import type { SkyState } from './presets';

export interface SharedUniforms {
  [name: string]: THREE.IUniform;
  uTime: { value: number };
  uHaze: { value: THREE.Color };
  uHazeRed: { value: THREE.Color };
  uHazeWhite: { value: THREE.Color };
  uRedDir: { value: THREE.Vector3 };
  uWhiteDir: { value: THREE.Vector3 };
  uWoundDir: { value: THREE.Vector3 };
  /** scenic lighting: direction TOWARD the key light, colour pre-multiplied by intensity */
  uKeyDir: { value: THREE.Vector3 };
  uKeyColor: { value: THREE.Color };
  uFillDir: { value: THREE.Vector3 };
  uFillColor: { value: THREE.Color };
  uAmbient: { value: number };
  /** haze extinction per metre for megastructure */
  uHazeDensity: { value: number };
  /** horizon haze band: strength at the horizon and falloff with elevation (dome, fleet) */
  uHazeAmt: { value: number };
  uHazeFall: { value: number };
  /** drawing-buffer size of the pass being rendered (kept current by ViewportTracker) */
  uViewport: { value: THREE.Vector2 };
  /** NDC depth of the far plane for the active renderer: 1, or 0 with a reversed depth buffer */
  uFarZ: { value: number };
}

export function createSharedUniforms(): SharedUniforms {
  return {
    uTime: { value: 0 },
    uHaze: { value: new THREE.Color(0x0b0b12) },
    uHazeRed: { value: new THREE.Color(0) },
    uHazeWhite: { value: new THREE.Color(0) },
    uRedDir: { value: new THREE.Vector3(-0.6, 0.3, -0.75).normalize() },
    uWhiteDir: { value: new THREE.Vector3(0.55, 0.25, -0.8).normalize() },
    uWoundDir: { value: new THREE.Vector3(0, 0.2, -1).normalize() },
    uKeyDir: { value: new THREE.Vector3(0.4, 0.6, 0.5).normalize() },
    uKeyColor: { value: new THREE.Color(1, 1, 1) },
    uFillDir: { value: new THREE.Vector3(-0.5, 0.4, 0.5).normalize() },
    uFillColor: { value: new THREE.Color(0.3, 0.1, 0.08) },
    uAmbient: { value: 0.5 },
    uHazeDensity: { value: 0.0005 },
    uHazeAmt: { value: 0 },
    uHazeFall: { value: 9 },
    uViewport: { value: new THREE.Vector2(1280, 720) },
    uFarZ: { value: 1 },
  };
}

/** Push the blended sky state into the shared uniforms. */
export function applySharedState(u: SharedUniforms, s: SkyState): void {
  u.uHaze.value.copy(s.haze);
  u.uHazeRed.value.copy(s.hazeRed).multiplyScalar(s.redVis);
  u.uHazeWhite.value.copy(s.hazeWhite).multiplyScalar(s.whiteVis);
  u.uRedDir.value.copy(s.redDir);
  u.uWhiteDir.value.copy(s.whiteDir);
  u.uWoundDir.value.copy(s.woundDir);
  u.uKeyDir.value.copy(s.keyDir);
  u.uKeyColor.value.copy(s.keyColor).multiplyScalar(s.keyIntensity);
  u.uFillDir.value.copy(s.fillDir);
  u.uFillColor.value.copy(s.fillColor).multiplyScalar(s.fillIntensity);
  u.uAmbient.value = s.scenicAmbient;
  u.uHazeDensity.value = s.scenicHaze;
  u.uHazeAmt.value = s.hazeAmt;
  u.uHazeFall.value = s.hazeFall;
}

const _size = new THREE.Vector2();

/**
 * Returns an `onBeforeRender` hook that records the size of the target being drawn into `uViewport`, so
 * pixel-footprint clamps (minimum sprite size) stay correct in the main pass, reflections and PMREM faces alike,
 * and which way the depth buffer runs (`uFarZ`).
 */
export function viewportTracker(u: SharedUniforms): THREE.Object3D['onBeforeRender'] {
  return (renderer) => {
    const rt = renderer.getRenderTarget();
    if (rt) u.uViewport.value.set(rt.width, rt.height);
    else u.uViewport.value.copy(renderer.getDrawingBufferSize(_size));
    u.uFarZ.value = renderer.capabilities.reversedDepthBuffer ? 0 : 1;
  };
}

/**
 * Draw order of the far field inside the OPAQUE list (so it also shows through transmissive glass): after all
 * ordinary opaque geometry (early-z hides it for free), dome → fleet → battle light → scenic light cards.
 */
export const SKY_ORDER = { dome: 1000, fleet: 1001, battleFx: 1002, lightCards: 1010 } as const;
