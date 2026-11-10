/**
 * Flash lights — a fixed pool of four shadowless point lights that are ALWAYS in the scene (intensity 0 when
 * idle) so the renderer never recompiles materials when a flash fires. Also feeds the lit particle layer and
 * probes the scene's key/ambient light so smoke is shaded like its surroundings.
 */
import * as THREE from 'three';

export const MAX_FLASHES = 4;
/** candela per unit of API intensity (1 ≈ muzzle flash, 3 ≈ explosion, 6+ ≈ hero beat) */
const CANDELA = 26;

interface Flash {
  readonly light: THREE.PointLight;
  age: number;
  seconds: number;
  peak: number;
  live: boolean;
  /** accessibility variant: swell in instead of popping */
  soft: boolean;
}

const _c = new THREE.Color();
const _v = new THREE.Vector3();

export class FlashLights {
  readonly group = new THREE.Group();
  private readonly flashes: Flash[] = [];

  /**
   * @param flashPos   shared uniform array (xyz, range) × 4 for the lit particle layer
   * @param flashColor shared uniform array rgb × 4 (already attenuation-ready, i.e. divided by π)
   */
  constructor(private readonly flashPos: Float32Array, private readonly flashColor: Float32Array) {
    this.group.name = 'vfx-flashes';
    for (let i = 0; i < MAX_FLASHES; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 10, 2);
      light.name = `vfx-flash-${i}`;
      light.castShadow = false;
      this.group.add(light);
      this.flashes.push({ light, age: 0, seconds: 0.2, peak: 0, live: false, soft: false });
    }
  }

  get liveCount(): number {
    let n = 0;
    for (let i = 0; i < MAX_FLASHES; i++) if (this.flashes[i].live) n++;
    return n;
  }

  /**
   * Fire a flash. When all four are busy the dimmest one is replaced (only if the new flash is brighter).
   * `reduce` (accessibility: reduceFlash) lowers the peak and removes the hard onset.
   */
  flash(x: number, y: number, z: number, color: number, intensity: number, seconds: number, reduce: boolean): void {
    if (!(intensity > 0) || !Number.isFinite(x + y + z)) return;
    const peak = Math.min(intensity, 12) * CANDELA * (reduce ? 0.3 : 1);
    let pick: Flash | null = null;
    let dimmest = Infinity;
    for (let i = 0; i < MAX_FLASHES; i++) {
      const f = this.flashes[i];
      if (!f.live) { pick = f; break; }
      if (f.light.intensity < dimmest) { dimmest = f.light.intensity; pick = f; }
    }
    if (!pick || (pick.live && dimmest > peak)) return;
    pick.live = true;
    pick.age = 0;
    pick.seconds = Math.max(0.04, seconds) * (reduce ? 1.6 : 1);
    pick.peak = peak;
    pick.light.color.setHex(color);
    pick.light.position.set(x, y, z);
    pick.light.distance = 5 + 5 * Math.sqrt(Math.min(intensity, 12));
    pick.light.intensity = reduce ? 0 : peak;
    pick.soft = reduce;
  }

  update(dt: number): void {
    for (let i = 0; i < MAX_FLASHES; i++) {
      const f = this.flashes[i];
      const o = i * 4, c = i * 3;
      if (f.live) {
        f.age += dt;
        const t = f.age / f.seconds;
        if (t >= 1) {
          f.live = false;
          f.light.intensity = 0;
        } else {
          // sharp attack, exponential-looking tail; reduced flashes swell in instead of popping
          const env = f.soft ? Math.sin(Math.PI * t) : (1 - t) * (1 - t);
          f.light.intensity = f.peak * env;
        }
      }
      const I = f.light.intensity / Math.PI;
      this.flashPos[o] = f.light.position.x; this.flashPos[o + 1] = f.light.position.y; this.flashPos[o + 2] = f.light.position.z;
      this.flashPos[o + 3] = f.light.distance;
      this.flashColor[c] = f.light.color.r * I; this.flashColor[c + 1] = f.light.color.g * I; this.flashColor[c + 2] = f.light.color.b * I;
    }
  }

  /**
   * Find the strongest directional light and sum hemisphere/ambient light of a scene (cheap; called ~1 Hz).
   * Outputs are divided by π to match three's Lambert term.
   */
  static probe(scene: THREE.Scene, ambient: THREE.Vector3, keyDir: THREE.Vector3, keyColor: THREE.Vector3): void {
    let best = 0;
    ambient.set(0, 0, 0);
    keyColor.set(0, 0, 0);
    scene.traverseVisible((o) => {
      const l = o as THREE.Light;
      if (!l.isLight) return;
      if ((l as THREE.DirectionalLight).isDirectionalLight) {
        const d = l as THREE.DirectionalLight;
        const power = d.intensity * (d.color.r + d.color.g + d.color.b);
        if (power > best) {
          best = power;
          d.getWorldPosition(keyDir);
          d.target.getWorldPosition(_v);
          keyDir.sub(_v).normalize();
          keyColor.set(d.color.r, d.color.g, d.color.b).multiplyScalar(d.intensity / Math.PI);
        }
      } else if ((l as THREE.HemisphereLight).isHemisphereLight) {
        const h = l as THREE.HemisphereLight;
        _c.copy(h.color).lerp(h.groundColor, 0.4);
        ambient.x += _c.r * h.intensity / Math.PI; ambient.y += _c.g * h.intensity / Math.PI; ambient.z += _c.b * h.intensity / Math.PI;
      } else if ((l as THREE.AmbientLight).isAmbientLight) {
        ambient.x += l.color.r * l.intensity / Math.PI; ambient.y += l.color.g * l.intensity / Math.PI; ambient.z += l.color.b * l.intensity / Math.PI;
      }
    });
    // image-based light is invisible to this probe: keep a floor so smoke never renders pitch black
    ambient.x = Math.max(ambient.x, 0.035); ambient.y = Math.max(ambient.y, 0.035); ambient.z = Math.max(ambient.z, 0.04);
    if (best === 0) keyDir.set(0.3, 0.9, 0.3).normalize();
  }

  clear(): void {
    for (const f of this.flashes) { f.live = false; f.light.intensity = 0; }
  }
}
