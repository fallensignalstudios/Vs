/**
 * Sky + scenic system — the far field: dome (stars, nebula, remnants, the Wound), fleet battle, the carrier
 * and the ScenicFactory. See src/core/api/sky.ts for the contract.
 */
import * as THREE from 'three';
import type { Game, ScenicFactory, SkyLight, SkyPreset, SkySystem, Vec3Like } from '@/core/api';
import { isStub } from '@/core/stub';
import { EASE, clamp01, damp } from '@/core/mathx';
import { createFleetBattle, type FleetBattle } from './battle';
import { createCarrier, type Carrier } from './carrier';
import { createSkyDome, type SkyDome } from './dome';
import { SKY_PRESETS, SkyState, blendSkyStates, rotateSkyState } from './presets';
import { applySharedState, createSharedUniforms, type SharedUniforms } from './shared';

export { SKY_PRESETS, SKY_PRESET_IDS } from './presets';

const warned = new Set<string>();
function warnOnce(msg: string): void {
  if (warned.has(msg)) return;
  warned.add(msg);
  console.warn(`[sky] ${msg}`);
}

const finite = (v: number, fallback: number): number => (Number.isFinite(v) ? v : fallback);

class SkySystemImpl implements SkySystem {
  readonly root = new THREE.Group();
  preset: SkyPreset = 'void';
  readonly woundDir = new THREE.Vector3();
  readonly redRemnantDir = new THREE.Vector3();
  readonly whiteRemnantDir = new THREE.Vector3();
  readonly keyLight: SkyLight = { dir: new THREE.Vector3(0, 1, 0), color: 0xffffff, intensity: 1 };
  readonly fillLight: SkyLight = { dir: new THREE.Vector3(0, 1, 0), color: 0xff5a3c, intensity: 0 };
  readonly battleGlow = new THREE.Color(0, 0, 0);
  readonly hazeColor = new THREE.Color(0, 0, 0);
  readonly carrier: Carrier;
  scenic!: ScenicFactory;

  private readonly shared: SharedUniforms = createSharedUniforms();
  private readonly dome: SkyDome;
  private readonly battle: FleetBattle;
  private readonly impactDir = new THREE.Vector3();
  private readonly from = new SkyState();
  private readonly to = new SkyState();
  private readonly cur = new SkyState();
  private readonly view = new SkyState();
  private readonly target = new SkyState();
  private blendT = 1;
  private blendDur = 0;
  private yaw = 0;
  private battleTarget = 0;
  private battleNow = 0;
  private activityTarget = 0.3;
  private activityNow = 0.3;
  private closedTarget = 0;
  private closedNow = 0;
  private closedRate = 1 / 3;

  constructor(private readonly game: Game) {
    this.root.name = 'sky';
    this.dome = createSkyDome(this.shared);
    this.root.add(this.dome.mesh);
    this.battle = createFleetBattle(this.shared, game.flags?.seed ?? 7283);
    this.root.add(this.battle.object);
    this.carrier = createCarrier(this.shared, game.flags?.seed ?? 7283);
    this.root.add(this.carrier.object, this.carrier.sparks);
    this.to.setFromDef(SKY_PRESETS.void);
    this.from.copy(this.to);
    this.cur.copy(this.to);
    this.publishTargets();
    this.pushUniforms();
    const scene = game.scene;
    if (scene && !isStub(scene) && (scene as THREE.Object3D).isObject3D) scene.add(this.root);
  }

  get heading(): number { return this.yaw; }
  get battleIntensity(): number { return this.battleNow; }
  get woundActivity(): number { return this.activityNow; }
  get boundaryClosed(): number { return this.closedNow; }

  setPreset(preset: SkyPreset, opts?: { blendSeconds?: number }): void {
    let id = preset;
    if (!Object.prototype.hasOwnProperty.call(SKY_PRESETS, id)) {
      warnOnce(`unknown preset "${String(preset)}" — using "void"`);
      id = 'void';
    }
    const seconds = Math.max(0, finite(opts?.blendSeconds ?? 0, 0));
    this.preset = id;
    this.from.copy(this.cur);
    this.to.setFromDef(SKY_PRESETS[id]);
    this.blendDur = seconds;
    this.blendT = seconds > 0 ? 0 : 1;
    this.battleTarget = this.to.battleIntensity;
    this.activityTarget = this.to.woundActivity;
    if (seconds <= 0) {
      this.cur.copy(this.to);
      this.battleNow = this.battleTarget;
      this.activityNow = this.activityTarget;
      this.pushUniforms();
    }
    this.publishTargets();
  }

  setBattleIntensity(n: number): void { this.battleTarget = clamp01(finite(n, 0)); }
  setWoundActivity(n: number): void { this.activityTarget = clamp01(finite(n, 0)); }

  setBoundaryClosed(closed: boolean, seconds = 3): void {
    this.closedTarget = closed ? 1 : 0;
    const s = finite(seconds, 3);
    if (s <= 0) this.closedNow = this.closedTarget;
    else this.closedRate = 1 / s;
  }

  setHeading(yaw: number): void {
    this.yaw = finite(yaw, 0);
    this.publishTargets();
    this.pushUniforms();
  }

  impact(opts?: { dir?: Vec3Like; color?: number; strength?: number }): void {
    const d = opts?.dir;
    const hasDir = !!d && Number.isFinite(d.x + d.y + d.z) && Math.abs(d.x) + Math.abs(d.y) + Math.abs(d.z) > 1e-6;
    if (hasDir) this.impactDir.set(d.x, d.y, d.z).normalize();
    this.battle.impact(hasDir ? this.impactDir : null, opts?.color ?? null, finite(opts?.strength ?? 0.7, 0.7));
  }

  update(dt: number, _camera: THREE.Camera): void {
    const step = dt > 0 && Number.isFinite(dt) ? Math.min(dt, 0.25) : 0;
    this.shared.uTime.value += step;
    if (this.blendT < 1) {
      this.blendT = this.blendDur > 0 ? Math.min(1, this.blendT + step / this.blendDur) : 1;
      blendSkyStates(this.from, this.to, EASE.inOut(this.blendT), this.cur);
    }
    this.battleNow = damp(this.battleNow, this.battleTarget, 1.6, step);
    this.activityNow = damp(this.activityNow, this.activityTarget, 1.2, step);
    if (this.closedNow !== this.closedTarget) {
      const d = this.closedTarget - this.closedNow;
      const m = this.closedRate * step;
      this.closedNow = Math.abs(d) <= m ? this.closedTarget : this.closedNow + Math.sign(d) * m;
    }
    this.pushUniforms();
    this.battle.update(step, this.view, this.battleNow, this.reduceFlash());
    this.battleGlow.copy(this.battle.glow);
    this.carrier.update(step, this.view.keyDir);
  }

  dispose(): void {
    this.dome.dispose();
    this.battle.dispose();
    this.carrier.dispose();
    this.root.removeFromParent();
  }

  private reduceFlash(): boolean {
    try {
      return this.game.settings.get('reduceFlash') === true;
    } catch {
      return false;
    }
  }

  /** woundDir / remnant dirs / lights report the TARGET preset (rotated by heading). */
  private publishTargets(): void {
    const t = rotateSkyState(this.to, this.yaw, this.target);
    this.woundDir.copy(t.woundDir);
    this.redRemnantDir.copy(t.redDir);
    this.whiteRemnantDir.copy(t.whiteDir);
    this.keyLight.dir.copy(t.keyDir);
    this.keyLight.color = t.keyColor.getHex();
    this.keyLight.intensity = t.keyIntensity;
    this.fillLight.dir.copy(t.fillDir);
    this.fillLight.color = t.fillColor.getHex();
    this.fillLight.intensity = t.fillIntensity * t.redVis;
  }

  private pushUniforms(): void {
    const v = rotateSkyState(this.cur, this.yaw, this.view);
    applySharedState(this.shared, v);
    this.dome.apply(v, this.activityNow, EASE.inOut(this.closedNow));
    this.hazeColor.copy(v.haze);
  }
}

export function createSkySystem(game: Game): SkySystem {
  return new SkySystemImpl(game);
}
