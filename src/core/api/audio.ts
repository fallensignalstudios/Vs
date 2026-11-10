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
 *
 * WHAT THE AUDIO SYSTEM DOES BY ITSELF (do not duplicate these in gameplay code — harmless if you do, the
 * calls are rate-limited, but unnecessary):
 *  - `settings:changed` (master/music/sfx volume) → applySettings()
 *  - `game:paused` → world bus gated, music dropped back; UI sounds stay audible
 *  - `game:phase` dead → heavy muffle until the phase leaves `dead`; title → loops cleared, muffle 0
 *  - `zone:loading` → clear() (all loops stop)
 *  - `zone:ready` → setMeridianResolved(mission.state.flags.meridianComplete)
 *  - `dialogue:line` → speak(line.speaker, line.channel) + duck() for the line's duration
 *  - `checkpoint:saved` → stinger('checkpoint');  `encounter:started` / `encounter:cleared` → the matching stinger
 *  - `link:severed` → stinger('sever') (Eclipse cadence turns irregular);  `link:created` → cadence re-locks
 *  - `player:protagonist` / `handoff` → encounter stingers take the current lead's instrumentation
 *  - every update(): music intensity = max(setIntensity value, game.ai.intensity)
 *  - play('meridianComplete') → setMeridianResolved(true)
 *  - the first pointer/key press anywhere calls unlock()
 * Everything else — swings, hits, footsteps, device hums, story cues — is played by whoever owns the moment.
 *
 * LOOPS: ids designed to sustain under loop(): droneHum, eclipseBreath, weaverChant, linkHum, eliteRegen,
 * emitterHum, relayHum, scanSweep, liftMove, stasisField. play() on those gives a ~1.5 s excerpt. Any other id
 * passed to loop() is re-triggered end to end.
 *
 * MUSIC IDENTITIES (so zone authors can pick states by meaning): Dominion/Tarrik = D minor, brass + taiko
 * (context, approachTarrik, combatTarrik). Reformation/Selene = A suspended, glass + precise clicks
 * (approachSelene, stealth, combatSelene). Eclipse = C♯, a cadence tick that is too regular until a sever
 * (breach, combatEclipse, elite). King/Meridian = open fifths + bells on D with the third withheld until
 * `meridianComplete` (title, atrium, recognition, core, witness, consequence). duel / carrier / decision /
 * resonance / departure / credits set the two protagonist identities against each other. quarantine = one
 * held tone. observation = sparse warm keyboard.
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
  // small world details (also scheduled automatically by the ambience beds)
  | 'ventHiss' | 'ambMetalTick' | 'ambEmberPop' | 'ambDust' | 'ambServoFar' | 'ambMurmur' | 'ambDrip' | 'ambMedBeep'
  | 'ambIceTick' | 'ambIceCreak' | 'ambCommBlip' | 'ambWhisper' | 'ambRelayClick' | 'ambZapFar' | 'ambChain'
  | 'ambVoid' | 'ambAlignClick' | 'ambGoldPing' | 'ambConsoleTick' | 'ambStellar' | 'ambPA'
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

  /**
   * Play a one-shot. Every id has a per-id rate limit and instance cap, and there is a global budget of 28
   * voices with priority stealing — calling this as often as gameplay likes is safe; excess plays are dropped.
   */
  play(id: SfxId, opts?: SfxOpts): void;
  /**
   * sustained positional loop (drone hum, link hum, emitter). Safe to call before audio is unlocked: the handle
   * remembers position/volume/pitch and the voice starts when audio becomes available. clear() stops them all.
   */
  loop(id: SfxId, opts?: SfxOpts): LoopHandle;

  /**
   * Cross-fade to a music state. The change lands on the next bar line of the current state (next beat when
   * `fadeSeconds` < 0.35; never more than ~2.4 s away): the outgoing rhythm stops there and its tails fade
   * under the incoming state over `fadeSeconds` (default 2). `'silence'` fades out.
   */
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
  /**
   * 0..1 low-pass "muffled pressure" on the world bus (also used for the quarantine strip and slow-mo).
   * Affects SFX, ambience and reverb tails — never music or UI. Useful values: 0.2–0.35 pressure-muffled halls
   * (Z00–Z04), ~0.6 slow-mo / stunned, 1 sealed (≈ 280 Hz).
   */
  setMuffle(amount: number, fadeSeconds?: number): void;
  /**
   * Eclipse cadence clock so identical timing can be heard: call on each beat (once per beat is enough; calls
   * from several bodies on the same beat are merged). Plays the positional tick AND, while an Eclipse music
   * state is active (breach / combatEclipse / elite), sounds the score's own cadence layer on that beat — the
   * score stops ticking on its internal grid while gameplay supplies beats, so there is only ever one clock.
   * `irregular` = a severed body's stumbling beat.
   */
  cadenceTick(pos?: Vec3Like, irregular?: boolean): void;

  setListener(pos: Vec3Like, forward: Vec3Like): void;
  /** apply volume settings */
  applySettings(): void;
  update(dt: number): void;
  /** stop all loops (zone unload) */
  clear(): void;

  // --- additions by the audio subsystem ---------------------------------------------------------
  /** ambience bed currently requested */
  readonly ambience: AmbienceId;
  /** 0..1 music intensity as currently heard (smoothed: quick to rise, slow to settle) */
  readonly intensity: number;
  /** 0..1 muffle amount last requested with setMuffle */
  readonly muffle: number;
  /**
   * The King/Meridian identity (title, recognition, core, witness, consequence) withholds the third until the
   * Meridian is complete. `play('meridianComplete')` sets this automatically and `zone:ready` restores it from
   * `mission.state.flags.meridianComplete`; call it directly only for bespoke sequencing.
   */
  setMeridianResolved(resolved: boolean): void;
  /**
   * Eclipse cadence in the score: 0 = stamped-out identical beats, 1 = stumbling. `stinger('sever')` sets 1 and
   * a new link resets 0 automatically; use this to hold a state by hand (e.g. keep it irregular after the last
   * Weaver dies).
   */
  setCadenceIrregular(amount: number): void;
  /** live state for debug overlays / smoke tests */
  debugInfo(): AudioDebugInfo;
}

export interface AudioDebugInfo {
  /** an AudioContext exists and is running */
  unlocked: boolean;
  /** 'running' | 'suspended' | 'closed' | 'none' */
  contextState: string;
  /** live SFX voices (budget 28) */
  voices: number;
  music: MusicState;
  ambience: AmbienceId;
  intensity: number;
  muffle: number;
  meridianResolved: boolean;
}
