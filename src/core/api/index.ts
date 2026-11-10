/**
 * AURELION engine contract — barrel + the Game interface.
 * Import everything cross-subsystem from '@/core/api'.
 */
import type * as THREE from 'three';
import type { EventBus, GameEvents, GamePhase, GameTime, Difficulty } from './common';
import type { RenderSystem, QualityLevel } from './render';
import type { CameraRig, InputSystem } from './camera';
import type { SkySystem } from './sky';
import type { MaterialLibrary } from './materials';
import type { PhysicsWorld } from './physics';
import type { HeroProps, ZoneBuilder } from './kit';
import type { CharacterFactory } from './chars';
import type { ActorManager, PlayerController } from './combat';
import type { AiSystem } from './ai';
import type { VfxSystem } from './vfx';
import type { AudioSystem } from './audio';
import type { UiSystem } from './ui';
import type { MissionSystem, ScriptRunner } from './mission';
import type { DebugApi } from './debug';

export * from './common';
export * from './render';
export * from './camera';
export * from './sky';
export * from './materials';
export * from './physics';
export * from './kit';
export * from './chars';
export * from './creatures';
export * from './combat';
export * from './ai';
export * from './vfx';
export * from './audio';
export * from './ui';
export * from './mission';
export * from './debug';

export interface Settings {
  // graphics
  quality: QualityLevel | 'auto';
  dynamicResolution: boolean;
  showFps: boolean;
  // audio (0..1)
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  // controls
  mouseSensitivity: number;
  gamepadSensitivity: number;
  invertY: boolean;
  // gameplay
  difficulty: Difficulty;
  aimAssist: boolean;
  // accessibility contract
  subtitles: boolean;
  subtitleSize: 'm' | 'l' | 'xl';
  subtitleBackground: boolean;
  captions: boolean;
  reduceFlash: boolean;
  reduceShake: boolean;
  reduceDistortion: boolean;
  /** hold interactions become press-to-toggle */
  holdToToggle: boolean;
  /** duel / Resonance prompts confirm automatically */
  autoPrompts: boolean;
  /** objective + safe-return navigation assistance */
  navAssist: boolean;
}

export interface SettingsStore {
  readonly values: Readonly<Settings>;
  get<K extends keyof Settings>(key: K): Settings[K];
  set<K extends keyof Settings>(key: K, value: Settings[K]): void;
  reset(): void;
}

export interface UrlFlags {
  /** boot straight into a zone (skips title) */
  zone: string | null;
  beat: string | null;
  checkpoint: string | null;
  debug: boolean;
  autoplay: boolean;
  mute: boolean;
  /** disable post-processing (fast headless screenshots) */
  nopost: boolean;
  quality: QualityLevel | null;
  /** headless: never start the RAF loop; tests drive step()/render() */
  manual: boolean;
  seed: number;
}

/**
 * The Game object. Subsystems are constructed by Game in this order and may only touch EARLIER subsystems in
 * their factory/constructor; at runtime (update/render/event handlers) everything is available:
 *
 *   events, settings, time, scripts, flags
 *   render → mats → sky → physics → input → camera → vfx → audio → ui
 *   chars → actors → player → ai → kit(factory) → props → mission → debug
 *
 * TICK ORDER (Game.tick):
 *   input.update → [if simulating] scripts.update → mission.update → player.update → ai.update →
 *   actors.update → physics.updateTriggers → vfx.update → mats.update → sky.update →
 *   camera.update → audio.update → ui.update → render.render
 */
export interface Game {
  readonly canvas: HTMLCanvasElement;
  readonly uiRoot: HTMLElement;
  readonly events: EventBus<GameEvents>;
  readonly settings: SettingsStore;
  readonly time: GameTime;
  readonly scripts: ScriptRunner;
  readonly flags: UrlFlags;
  readonly scene: THREE.Scene;

  readonly render: RenderSystem;
  readonly mats: MaterialLibrary;
  readonly sky: SkySystem;
  readonly physics: PhysicsWorld;
  readonly input: InputSystem;
  readonly camera: CameraRig;
  readonly vfx: VfxSystem;
  readonly audio: AudioSystem;
  readonly ui: UiSystem;
  readonly chars: CharacterFactory;
  readonly actors: ActorManager;
  readonly player: PlayerController;
  readonly ai: AiSystem;
  /** create a ZoneBuilder for a fresh zone root (kit) */
  createZoneBuilder(root: THREE.Group, seed: number): ZoneBuilder;
  readonly props: HeroProps;
  readonly mission: MissionSystem;
  readonly debug: DebugApi;

  readonly phase: GamePhase;
  setPhase(phase: GamePhase): void;
  readonly paused: boolean;
  setPaused(paused: boolean): void;

  /** one full tick with real dt (seconds). `render` false = simulate only. */
  tick(dt: number, render?: boolean): void;
  /** deterministic seeded random in [0,1) for gameplay (not for visuals-only variation) */
  random(): number;
}
