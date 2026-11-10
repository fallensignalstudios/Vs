/**
 * Game — constructs every subsystem in contract order and runs the tick.
 * FOUNDATION FILE: subsystem agents do not edit this; they implement the factories it imports.
 */
import * as THREE from 'three';
import type {
  ActorManager, AiSystem, AudioSystem, CameraRig, CharacterFactory, DebugApi, Game, GameEvents, GamePhase,
  GameTime, HeroProps, InputSystem, MaterialLibrary, MissionSystem, PhysicsWorld, PlayerController,
  QualityLevel, RenderSystem, SkySystem, UiSystem, UrlFlags, VfxSystem, ZoneBuilder,
} from './api';
import { Emitter, reportError } from './events';
import { SettingsStoreImpl } from './settings';
import { ScriptRunnerImpl } from './script';
import { nullObject } from './stub';
import { clamp, mulberry32 } from './mathx';

import { createRenderSystem } from '@/render';
import { createMaterialLibrary } from '@/world/materials';
import { createSkySystem } from '@/render/sky';
import { createPhysicsWorld } from '@/world/physics';
import { createInputSystem } from '@/core/input';
import { createCameraRig } from '@/render/camera';
import { createVfxSystem } from '@/vfx';
import { createAudioSystem } from '@/audio';
import { createUiSystem } from '@/ui';
import { createCharacterFactory } from '@/chars';
import { createActorManager, createPlayerController } from '@/combat';
import { createAiSystem } from '@/ai';
import { createZoneBuilder } from '@/world/kit';
import { createHeroProps } from '@/world/props';
import { createMissionSystem } from '@/mission';
import { createDebugApi } from '@/debug';
import { registerZones } from '@/zones';

export function parseUrlFlags(search: string): UrlFlags {
  const q = new URLSearchParams(search);
  const b = (k: string) => q.has(k) && q.get(k) !== '0' && q.get(k) !== 'false';
  const quality = q.get('quality') as QualityLevel | null;
  return {
    zone: q.get('zone'),
    beat: q.get('beat'),
    checkpoint: q.get('checkpoint') ?? q.get('cp'),
    debug: b('debug'),
    autoplay: b('autoplay'),
    mute: b('mute'),
    nopost: b('nopost'),
    quality: quality && ['low', 'medium', 'high', 'ultra'].includes(quality) ? quality : null,
    manual: b('manual'),
    seed: Number(q.get('seed') ?? 7283) || 7283,
  };
}

const SIM_PHASES: ReadonlySet<GamePhase> = new Set<GamePhase>(['playing', 'dead', 'complete']);
/** largest sim step; longer frames are split */
const MAX_STEP = 1 / 45;
const MAX_FRAME = 0.1;

class TimeImpl implements GameTime {
  now = 0;
  dt = 0;
  unscaledDt = 0;
  scale = 1;
  frame = 0;
  hitStopLeft = 0;
  private slowTarget = 1;
  private slowLeft = 0;

  hitStop(seconds: number): void {
    this.hitStopLeft = Math.max(this.hitStopLeft, clamp(seconds, 0, 0.25));
  }

  slowMo(scale: number, seconds: number): void {
    this.slowTarget = clamp(scale, 0.05, 1);
    this.slowLeft = Math.max(0, seconds);
  }

  /** advance slow-mo envelope with real dt */
  stepEnvelope(realDt: number): void {
    if (this.slowLeft > 0) {
      this.slowLeft -= realDt;
      this.scale += (this.slowTarget - this.scale) * Math.min(1, realDt * 14);
    } else if (this.scale !== 1) {
      this.scale += (1 - this.scale) * Math.min(1, realDt * 6);
      if (Math.abs(1 - this.scale) < 0.01) this.scale = 1;
    }
  }
}

export class GameImpl implements Game {
  readonly events = new Emitter<GameEvents>();
  readonly settings: SettingsStoreImpl;
  readonly time = new TimeImpl();
  readonly scripts = new ScriptRunnerImpl();
  readonly scene = new THREE.Scene();

  render!: RenderSystem;
  mats!: MaterialLibrary;
  sky!: SkySystem;
  physics!: PhysicsWorld;
  input!: InputSystem;
  camera!: CameraRig;
  vfx!: VfxSystem;
  audio!: AudioSystem;
  ui!: UiSystem;
  chars!: CharacterFactory;
  actors!: ActorManager;
  player!: PlayerController;
  ai!: AiSystem;
  props!: HeroProps;
  mission!: MissionSystem;
  debug!: DebugApi;

  private _phase: GamePhase = 'boot';
  private _paused = false;
  private rng: () => number;
  private tmpForward = new THREE.Vector3();
  private initialized = false;

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly uiRoot: HTMLElement,
    readonly flags: UrlFlags,
  ) {
    this.settings = new SettingsStoreImpl(this.events);
    this.rng = mulberry32(flags.seed);

    const make = <T>(name: string, fn: () => T): T => {
      try {
        const v = fn();
        if (v == null) throw new Error(`${name} factory returned ${v}`);
        return v;
      } catch (err) {
        reportError(`construct:${name}`, err);
        return nullObject<T>(name);
      }
    };

    // Contract construction order.
    this.render = make('render', () => createRenderSystem(this));
    this.mats = make('mats', () => createMaterialLibrary(this));
    this.sky = make('sky', () => createSkySystem(this));
    this.physics = make('physics', () => createPhysicsWorld(this));
    this.input = make('input', () => createInputSystem(this));
    this.camera = make('camera', () => createCameraRig(this));
    this.vfx = make('vfx', () => createVfxSystem(this));
    this.audio = make('audio', () => createAudioSystem(this));
    this.ui = make('ui', () => createUiSystem(this));
    this.chars = make('chars', () => createCharacterFactory(this));
    this.actors = make('actors', () => createActorManager(this));
    this.player = make('player', () => createPlayerController(this));
    this.ai = make('ai', () => createAiSystem(this));
    this.props = make('props', () => createHeroProps(this));
    this.mission = make('mission', () => createMissionSystem(this));
    try {
      registerZones(this);
    } catch (err) {
      reportError('registerZones', err);
    }
    this.debug = make('debug', () => createDebugApi(this));
  }

  createZoneBuilder(root: THREE.Group, seed: number): ZoneBuilder {
    return createZoneBuilder(this, root, seed);
  }

  /** Async warm-up: textures, shaders, fonts. */
  async init(): Promise<void> {
    if (this.initialized) return;
    const step = async (name: string, fn: () => unknown) => {
      try {
        await fn();
      } catch (err) {
        reportError(`init:${name}`, err);
      }
    };
    await step('render', () => this.render.init());
    await step('mats', () => this.mats.init());
    await step('ui', () => this.ui.init());
    if (this.flags.quality) this.render.setQuality(this.flags.quality);
    this.initialized = true;
  }

  get phase(): GamePhase {
    return this._phase;
  }

  setPhase(phase: GamePhase): void {
    if (phase === this._phase) return;
    const prev = this._phase;
    this._phase = phase;
    this.events.emit('game:phase', { phase, prev });
  }

  get paused(): boolean {
    return this._paused;
  }

  setPaused(paused: boolean): void {
    if (paused === this._paused) return;
    this._paused = paused;
    this.events.emit('game:paused', { paused });
  }

  random(): number {
    return this.rng();
  }

  private guard(name: string, fn: () => void): void {
    try {
      fn();
    } catch (err) {
      reportError(`tick:${name}`, err);
    }
  }

  /** One simulation step (scaled dt). */
  private simulate(dt: number): void {
    const t = this.time;
    t.dt = dt;
    t.now += dt;
    this.guard('scripts', () => this.scripts.update(dt));
    this.guard('mission', () => this.mission.update(dt));
    this.guard('player', () => this.player.update(dt));
    this.guard('ai', () => this.ai.update(dt));
    this.guard('actors', () => this.actors.update(dt));
    this.guard('triggers', () => {
      const a = this.player.actor;
      this.physics.updateTriggers(a && a.alive ? a.pos : null);
    });
    this.guard('vfx', () => this.vfx.update(dt));
  }

  tick(realDt: number, render = true): void {
    const t = this.time;
    const frameDt = clamp(realDt, 0, MAX_FRAME);
    t.unscaledDt = frameDt;
    t.frame++;

    this.guard('input', () => this.input.update(frameDt));

    const simulating = SIM_PHASES.has(this._phase) && !this._paused && !this.mission.loading;
    if (simulating) {
      t.stepEnvelope(frameDt);
      if (t.hitStopLeft > 0) {
        t.hitStopLeft -= frameDt;
        t.dt = 0;
      } else {
        const simDt = frameDt * t.scale;
        const steps = Math.max(1, Math.ceil(simDt / MAX_STEP));
        const h = simDt / steps;
        for (let i = 0; i < steps; i++) this.simulate(h);
      }
    } else {
      t.dt = 0;
    }

    this.guard('mats', () => this.mats.update(simulating ? t.dt : 0, t.now));
    this.guard('sky', () => this.sky.update(simulating ? t.dt : 0, this.camera.camera));
    this.guard('camera', () => this.camera.update(frameDt));
    this.guard('audio', () => {
      const cam = this.camera.camera;
      if (cam && (cam as any).isCamera) {
        cam.getWorldDirection(this.tmpForward);
        this.audio.setListener(cam.position, this.tmpForward);
      }
      this.audio.update(frameDt);
    });
    this.guard('ui', () => this.ui.update(frameDt));
    if (render) this.guard('render', () => this.render.render(frameDt));
  }
}
