/**
 * Audio contract — OWNER: audio (src/audio/*).
 * Fully procedural WebAudio: synthesised SFX, layered adaptive music, zone ambience, mix bus with reverb.
 * No audio files. Unknown ids warn once and no-op. Must be silent-safe before unlock() and in headless tests.
 *
 * Sound by phase (from the plan):
 *  Z00–Z04 muffled pressure, intermittent fleet impacts, differentiated drone and shield cues.
 *  Z05 carrier shadow, low structural groan, a short violence peak.
 *  Z06–Z08 unnaturally identical Eclipse timing becomes irregular after a sever; successful Resonance briefly
 *          separates Frost's arrested tone from Cinder's impact.
 *  Z09 quarantine strips away war sound. Z10 fine mechanical alignment and two separate assent tones.
 *  Z11 room tone, distant stellar rumble, unhurried voices.
 */
import type { Vec3Like } from './common';

export type SfxId =
  // UI
  | 'uiMove' | 'uiSelect' | 'uiBack' | 'uiPrompt' | 'uiCheckpoint' | 'uiObjective' | 'uiChoice' | 'uiCommit'
  // movement
  | 'footStone' | 'footMetal' | 'footIce' | 'footGrate' | 'dodge' | 'cloth' | 'armorRattle'
  // Tarrik
  | 'swingHeavy' | 'swingLight' | 'bladeHitFlesh' | 'bladeHitMetal' | 'bladeHitShield' | 'guardBlock' | 'guardPerfect'
  | 'cinderIgnite' | 'cinderSlam' | 'cinderlineShot' | 'stickyThrow' | 'stickyArm' | 'stickyBlast'
  // Selene
  | 'verityWhirl' | 'verityHit' | 'deflect' | 'axiomShot' | 'axiomReload' | 'stasisThrow' | 'stasisField'
  | 'dispatch' | 'frostArrest' | 'frostShatter' | 'scanPulse'
  // enemies
  | 'droneHum' | 'droneCharge' | 'droneVolley' | 'droneBolt' | 'droneDeath' | 'droneAlert'
  | 'shieldUp' | 'shieldHit' | 'shieldBreak' | 'enforcerStep' | 'batonZap'
  | 'eclipseBreath' | 'eclipseLunge' | 'eclipseDeath' | 'wallrunnerSkitter' | 'wallrunnerPounce'
  | 'weaverChant' | 'linkHum' | 'linkSever' | 'elitePulse' | 'eliteRoar' | 'eliteSlam' | 'eliteRegen' | 'eliteExpose'
  // devices / world
  | 'emitterHum' | 'emitterBreak' | 'relayHum' | 'relayDown' | 'scanSweep' | 'scanDetect' | 'networkDown'
  | 'doorOpen' | 'doorClose' | 'doorLocked' | 'barrierUp' | 'barrierDown' | 'quarantineSeal'
  | 'apertureOpen' | 'breachCrack' | 'debrisFall' | 'explosionSmall' | 'explosionLarge' | 'fleetImpact'
  | 'structuralGroan' | 'carrierPass' | 'carrierClip' | 'screamsBelow' | 'plateLift'
  | 'fireControlCharge' | 'fireControlFire' | 'cageDestroy' | 'panelCommit'
  // pickups / feedback
  | 'healPickup' | 'ammoPickup' | 'echoGain' | 'echoFull' | 'playerHit' | 'playerLow' | 'playerDeath'
  | 'hitConfirm' | 'weakPointHit' | 'staggerBreak'
  // story
  | 'resonanceWindow' | 'thermalFracture' | 'recognitionTone' | 'assentToneTarrik' | 'assentToneSelene'
  | 'meridianAlign' | 'meridianComplete' | 'boundaryClose' | 'grammarPropagate' | 'witnessEnter' | 'witnessSunder'
  | 'liftMove' | 'chairSettle' | 'evidenceExchange' | 'engineSpool' | 'shipDepart'
  | (string & {});

export type MusicState =
  | 'silence' | 'title' | 'context'
  | 'approachTarrik' | 'combatTarrik'
  | 'approachSelene' | 'stealth' | 'combatSelene'
  | 'atrium' | 'duel' | 'carrier'
  | 'breach' | 'combatEclipse' | 'decision' | 'elite' | 'resonance'
  | 'quarantine' | 'recognition' | 'core' | 'witness' | 'consequence'
  | 'observation' | 'departure' | 'credits';

export type AmbienceId =
  | 'none' | 'crash' | 'pressureHall' | 'survivorBend' | 'frozenCorridor' | 'relayOverlook'
  | 'atrium' | 'breach' | 'gallery' | 'crucible' | 'woundGallery' | 'coreChamber' | 'observation' | 'hangar';

export interface SfxOpts {
  /** world position → panned + distance attenuated. Omit for non-positional. */
  pos?: Vec3Like;
  volume?: number;
  /** playback pitch multiplier / detune variation is applied automatically; this biases it */
  pitch?: number;
  delay?: number;
}

export interface LoopHandle {
  setPosition(p: Vec3Like): void;
  setVolume(v: number, fadeSeconds?: number): void;
  setPitch(p: number): void;
  stop(fadeSeconds?: number): void;
}

export interface AudioSystem {
  /** Create/resume the AudioContext after a user gesture. Safe to call repeatedly. */
  unlock(): void;
  readonly unlocked: boolean;

  play(id: SfxId, opts?: SfxOpts): void;
  /** sustained positional loop (drone hum, link hum, emitter) */
  loop(id: SfxId, opts?: SfxOpts): LoopHandle;

  setMusic(state: MusicState, fadeSeconds?: number): void;
  readonly music: MusicState;
  setAmbience(id: AmbienceId, fadeSeconds?: number): void;
  /** 0..1 — combat layers of the current music state follow this */
  setIntensity(n: number): void;
  /** musical stinger over the current state */
  stinger(kind: 'checkpoint' | 'encounterStart' | 'encounterClear' | 'sever' | 'resonance' | 'revelation' | 'choice' | 'death'): void;

  /** short per-speaker comm tick when a subtitle line starts (no VO in this build) */
  speak(speaker: string, channel?: 'voice' | 'radio' | 'system' | 'narration'): void;
  /** temporarily lower music/ambience under dialogue */
  duck(amount: number, seconds: number): void;
  /** 0..1 low-pass "muffled pressure" on the world bus (also used for the quarantine strip and slow-mo) */
  setMuffle(amount: number, fadeSeconds?: number): void;
  /** Eclipse cadence clock so identical timing can be heard: call on each beat */
  cadenceTick(pos?: Vec3Like, irregular?: boolean): void;

  setListener(pos: Vec3Like, forward: Vec3Like): void;
  /** apply volume settings */
  applySettings(): void;
  update(dt: number): void;
  /** stop all loops (zone unload) */
  clear(): void;
}
