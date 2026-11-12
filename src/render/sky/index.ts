/**
 * Sky + scenic system — the far field: dome (stars, nebula, remnants, the Wound), fleet battle, the carrier
 * and the ScenicFactory. See src/core/api/sky.ts for the contract.
 */
import * as THREE from 'three';
import type { Game, SkyLight, SkyPreset, SkySystem, Vec3Like } from '@/core/api';
import { isStub } from '@/core/stub';
import { EASE, clamp01, damp } from '@/core/mathx';
import { createFleetBattle, type FleetBattle } from './battle';
import { createCarrier, type Carrier } from './carrier';
import { createSkyDome, type SkyDome } from './dome';
import { createScenicFactory, type ScenicRuntime } from './scenic';
import { ClipTipSlot } from './scenic/clipTower';
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

/**
 * ADDED (fix & ship): a zone's own white balance for the far field, multiplied over whatever preset is showing (and
 * through its crossfades) until the next `sky.reset()` — every zone load resets the sky, so it never leaks. Lets a zone
 * whose grade differs from the one a shared preset was authored against keep the same night: Z09's neutral stone grade
 * would otherwise turn the woundVista night (authored under Z11 / Z12's cool grades) olive. sRGB hex, white = neutral.
 * `tint`: everything in space (sky, remnants, the Wound); `skyTint`: the empty sky alone; `matterTint`: the Wound's
 * smoke, crust and dust; `haze`: the horizon haze (and every scenic piece that dissolves into it).
 */
export interface SkyBalance {
  tint?: SkyBalanceColor;
  skyTint?: SkyBalanceColor;
  matterTint?: SkyBalanceColor;
  haze?: SkyBalanceColor;
}
/** an sRGB hex (≤ white), or linear RGB multipliers (may exceed 1, each clamped to 0…4) */
export type SkyBalanceColor = number | readonly [number, number, number];
const BALANCE_KEYS = ['tint', 'skyTint', 'matterTint', 'haze'] as const;

/** Set (or clear, with null) the zone's far-field white balance; false when `sky` is not the engine's sky system. */
export function setSkyBalance(sky: SkySystem, balance: SkyBalance | null): boolean {
  if (!(sky instanceof SkySystemImpl)) return false;
  sky.setBalance(balance);
  return true;
}
const DETAIL: Record<string, number> = { low: 0, medium: 1, high: 2, ultra: 2 };

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
  readonly scenic: ScenicRuntime;

  private readonly shared: SharedUniforms = createSharedUniforms();
  private readonly dome: SkyDome;
  private readonly battle: FleetBattle;
  private readonly impactDir = new THREE.Vector3();
  private readonly tips = new ClipTipSlot();
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
  /** the zone's white balance over the preset (linear multipliers), null = none */
  private balance: Record<(typeof BALANCE_KEYS)[number], THREE.Color> | null = null;

  constructor(private readonly game: Game) {
    this.root.name = 'sky';
    this.dome = createSkyDome(this.shared);
    this.root.add(this.dome.mesh);
    const seed = typeof game.flags?.seed === 'number' ? game.flags.seed : 7283;
    this.battle = createFleetBattle(this.shared, seed);
    this.root.add(this.battle.object);
    this.carrier = createCarrier(this.shared, seed, this.tips);
    this.root.add(this.carrier.object, this.carrier.effects);
    this.scenic = createScenicFactory(game, this.shared, this.tips);
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
    // the carrier belongs to the Z05 sky; no other preset may inherit it (zones need not remember to hide it)
    if (id !== 'battleCeiling') this.carrier.visible = false;
    if (seconds <= 0) {
      this.cur.copy(this.to);
      this.battleNow = this.battleTarget;
      this.activityNow = this.activityTarget;
      // a snap is a cut: nothing fired under the previous sky survives it
      this.battle.clear();
      this.battleGlow.setRGB(0, 0, 0);
      this.shared.uBattleGlow.value.setRGB(0, 0, 0);
      this.pushUniforms();
    }
    this.publishTargets();
  }

  /** see setSkyBalance(); applied in pushUniforms over the blended state */
  setBalance(balance: SkyBalance | null): void {
    if (!balance) this.balance = null;
    else {
      const b = { tint: new THREE.Color(1, 1, 1), skyTint: new THREE.Color(1, 1, 1), matterTint: new THREE.Color(1, 1, 1), haze: new THREE.Color(1, 1, 1) };
      for (const k of BALANCE_KEYS) {
        const v = balance[k];
        if (typeof v === 'number' && Number.isFinite(v)) b[k].setHex(v);
        else if (Array.isArray(v) && v.length === 3 && v.every((x) => Number.isFinite(x))) {
          const c = (x: number): number => Math.min(Math.max(x, 0), 4);
          b[k].setRGB(c(v[0]), c(v[1]), c(v[2]));
        }
      }
      this.balance = b;
    }
    this.pushUniforms();
  }

  reset(): void {
    this.balance = null;
    this.yaw = 0;
    this.closedTarget = 0;
    this.closedNow = 0;
    this.carrier.reset();
    this.setPreset('void');
  }

  setBattleIntensity(n: number): void { this.battleTarget = clamp01(finite(n, 0)); }

  setWoundActivity(n: number, opts?: { snap?: boolean }): void {
    this.activityTarget = clamp01(finite(n, 0));
    if (opts?.snap === true || this.fastForward()) {
      this.activityNow = this.activityTarget;
      this.pushUniforms();
    }
  }

  setBoundaryClosed(closed: boolean, seconds = 3, opts?: { snap?: boolean }): void {
    this.closedTarget = closed ? 1 : 0;
    const s = finite(seconds, 3);
    if (s <= 0 || opts?.snap === true || this.fastForward()) {
      this.closedNow = this.closedTarget;
      this.pushUniforms();
    } else this.closedRate = 1 / s;
  }

  /**
   * True while the mission fast-forwards (a cinematic skip) or loads a zone (beat `enter` restoring a stage):
   * the eased setters land on their target at once, so a skipped scene ends in exactly the state it would have
   * reached watched. Reads the mission defensively — the sky also runs in sandboxes without one.
   */
  private fastForward(): boolean {
    try {
      const m = this.game.mission;
      if (!m || isStub(m)) return false;
      return m.loading === true || m.runtime?.skipping === true;
    } catch {
      return false;
    }
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
    // the Wound swells slowly but contracts violently: drawing the pressure back is fast (≈ 0.4 s), building it is not
    this.activityNow = damp(this.activityNow, this.activityTarget, this.activityTarget < this.activityNow ? 2.6 : 1.2, step);
    if (this.closedNow !== this.closedTarget) {
      const d = this.closedTarget - this.closedNow;
      const m = this.closedRate * step;
      this.closedNow = Math.abs(d) <= m ? this.closedTarget : this.closedNow + Math.sign(d) * m;
    }
    this.pushUniforms();
    if (!this.carrier.requested && this.wantsCarrier()) this.carrier.prefetch();
    const soft = this.reduceFlash();
    this.dome.setDetail(this.detail());
    this.battle.update(step, this.view, this.battleNow, soft);
    this.battleGlow.copy(this.battle.glow);
    this.shared.uBattleGlow.value.copy(this.battle.glow);
    this.carrier.update(step, this.view.keyDir, soft);
    this.scenic.update(this.shared.uTime.value);
  }

  dispose(): void {
    this.dome.dispose();
    this.battle.dispose();
    this.carrier.dispose();
    this.scenic.dispose();
    this.root.removeFromParent();
  }

  /**
   * (fix & ship) The Z05 carrier's file is fetched on entering Z04 (a zone ahead, so Z05's bounded wait for it
   * normally finds it there) or Z05 itself, or whenever the battle sky is up — never at boot.
   */
  private wantsCarrier(): boolean {
    if (this.preset === 'battleCeiling') return true;
    try {
      const m = this.game.mission;
      if (!m || isStub(m)) return false;
      const id = m.currentZone?.id;
      return id === 'Z04' || id === 'Z05';
    } catch {
      return false;
    }
  }

  /** dome shading tier from the render quality profile (high when render-core is a stub) */
  private detail(): number {
    try {
      const q = this.game.render?.quality;
      const level = q && !isStub(q) ? q.level : 'high';
      return typeof level === 'string' && level in DETAIL ? DETAIL[level] : 2;
    } catch {
      return 2;
    }
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
    if (this.balance) for (const k of BALANCE_KEYS) v[k].multiply(this.balance[k]);
    applySharedState(this.shared, v);
    this.dome.apply(v, this.activityNow, EASE.inOut(this.closedNow));
    this.hazeColor.copy(v.haze);
  }
}

export function createSkySystem(game: Game): SkySystem {
  return new SkySystemImpl(game);
}
