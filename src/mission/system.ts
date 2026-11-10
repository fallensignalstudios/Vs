/**
 * MissionSystemImpl — zone registry, the asynchronous load pipeline, the beat runner, checkpoints and saves.
 * See the notes on `MissionSystem` in src/core/api/mission.ts for the behaviour callers can rely on.
 */
import * as THREE from 'three';
import type {
  ActiveChoice, Archetype, Beat, BeatLogEntry, CheckpointId, CheckpointInfo, Difficulty, Game, Interactable,
  MissionState, MissionSystem, Routine, ZoneBuilder, ZoneDef, ZoneId, ZoneRuntime,
} from '@/core/api';
import { reportError } from '@/core/events';
import { hashString } from '@/core/mathx';
import { isStub } from '@/core/stub';
import { deriveCheckpoints, firstZone } from './checkpoints';
import { createFallbackBuilder } from './fallbackBuilder';
import type { BuilderExtras } from './fallbackBuilder';
import { guarded } from './guard';
import { ZoneRuntimeImpl } from './runtime';
import type { RuntimeHost } from './runtime';
import { assignState, cloneState, createMissionState, SaveStore } from './save';
import type { StorageLike } from './save';

type LoadReason = 'entry' | 'checkpoint' | 'debug';
type FadeColor = 'black' | 'white' | 'gold';

const BEAT_LOG_MAX = 512;
const JOURNAL_MAX = 300;
const FADE_IN_SECONDS = 0.9;
/** longest real-time wait for the game loop to draw the loading screen before a build starts */
const BREATHE_MS = 120;
/** models every zone may show: both leads and the companions that travel with them */
const COMMON_CAST: readonly Archetype[] = ['tarrik', 'selene', 'lyessa', 'tharne', 'lyric'];
const NO_INTERACTABLES: readonly Interactable[] = Object.freeze([]);

interface Preloader {
  preload?: (archetypes: Archetype[]) => Promise<void> | void;
}

/** Index of the beat a snapshot taken during `beatId` should resume at: that beat, or the nearest earlier one with `enter`. */
export function resumeBeatIndex(beats: readonly Beat[], beatId: string): number {
  let i = beats.findIndex((b) => b.id === beatId);
  if (i < 0) return 0;
  while (i > 0 && typeof beats[i].enter !== 'function') i--;
  return i;
}

export class MissionSystemImpl implements MissionSystem, RuntimeHost {
  readonly state: MissionState = createMissionState();
  readonly beatLog: BeatLogEntry[] = [];
  readonly journal: string[] = [];

  private readonly zoneMap = new Map<ZoneId, ZoneDef>();
  private table: CheckpointInfo[] | null = null;
  private readonly store: SaveStore;
  private rt: ZoneRuntimeImpl | null = null;
  private builder: ZoneBuilder | null = null;
  private root: THREE.Group | null = null;
  private beat: string | null = null;
  private pending = 0;
  private chain: Promise<void> = Promise.resolve();
  private readonly warned = new Set<string>();

  constructor(
    private readonly game: Game,
    storage?: StorageLike | null,
  ) {
    this.store = new SaveStore(storage);
    game.events.on('player:died', () => {
      this.state.stats.deaths++;
    });
  }

  // ---------------------------------------------------------------------------------------------
  // read-only surface
  // ---------------------------------------------------------------------------------------------

  get zones(): ReadonlyMap<ZoneId, ZoneDef> {
    return this.zoneMap;
  }
  get currentZone(): ZoneDef | null {
    return this.rt ? this.rt.zone : null;
  }
  get runtime(): ZoneRuntime | null {
    return this.rt;
  }
  get currentBeat(): string | null {
    return this.beat;
  }
  get loading(): boolean {
    return this.pending > 0;
  }
  get cinematicActive(): boolean {
    return this.rt !== null && this.rt.cinematicActive;
  }
  get cinematicSkippable(): boolean {
    return this.rt !== null && this.rt.cinematicSkippable;
  }
  get objectiveText(): string | null {
    return this.rt ? this.rt.guidance.text : null;
  }
  get objectiveMarker(): THREE.Vector3 | null {
    return this.rt ? this.rt.guidance.marker : null;
  }
  get interactables(): readonly Interactable[] {
    return this.rt ? this.rt.interactions.required : NO_INTERACTABLES;
  }
  get activeChoice(): ActiveChoice | null {
    return this.rt ? this.rt.activeChoice : null;
  }
  get checkpoints(): readonly CheckpointInfo[] {
    return (this.table ??= deriveCheckpoints(this.zoneMap));
  }

  // ---------------------------------------------------------------------------------------------
  // registry + saves
  // ---------------------------------------------------------------------------------------------

  registerZone(def: ZoneDef): void {
    if (!def || typeof def.id !== 'string' || !Array.isArray(def.beats) || def.beats.length === 0 || typeof def.build !== 'function') {
      this.warnOnce(`register:${String(def?.id)}`, `registerZone: "${String(def?.id)}" is not a usable ZoneDef (needs id, build and at least one beat) — ignored`);
      return;
    }
    if (this.zoneMap.has(def.id)) this.warnOnce(`register:dup:${def.id}`, `zone ${def.id} registered twice — the later definition wins`);
    this.zoneMap.set(def.id, def);
    this.table = null;
  }

  hasZone(zone: string): boolean {
    return this.zoneMap.has(zone as ZoneId);
  }

  hasSave(): boolean {
    return this.store.read() !== null;
  }

  clearSave(): void {
    this.store.clear();
  }

  saveCheckpoint(id: CheckpointId): void {
    this.commitSave(id, false);
  }

  newGame(difficulty?: Difficulty): Promise<void> {
    const first = firstZone(this.zoneMap);
    const diff = difficulty ?? this.game.settings.get('difficulty');
    return this.enqueue(async () => {
      this.store.clear();
      assignState(this.state, createMissionState(diff, first ? first.id : 'Z00', first ? first.beats[0].id : ''));
      if (!first) {
        this.warnOnce('newgame:nozones', 'newGame: no zones are registered — nothing to load');
        return;
      }
      await this.load(first.id, undefined, 'entry');
    });
  }

  continueGame(): Promise<boolean> {
    let ok = false;
    return this.enqueue(async () => {
      const file = this.store.read();
      const snap = file ? file.snapshots[file.current] : undefined;
      if (!snap || !this.zoneMap.has(snap.zone)) {
        this.note('continue: no usable save — starting a new game');
        const first = firstZone(this.zoneMap);
        assignState(this.state, createMissionState(this.game.settings.get('difficulty'), first ? first.id : 'Z00'));
        if (first) await this.load(first.id, undefined, 'entry');
        return;
      }
      assignState(this.state, snap);
      ok = true;
      await this.load(snap.zone, snap.beat, 'checkpoint');
    }).then(() => ok);
  }

  loadCheckpoint(id: CheckpointId): Promise<void> {
    return this.enqueue(async () => {
      const snap = this.store.read()?.snapshots[id];
      if (snap && this.zoneMap.has(snap.zone)) {
        this.restore(snap);
        await this.load(snap.zone, snap.beat, 'checkpoint');
        return;
      }
      const info = this.checkpoints.find((c) => c.id === id);
      if (!info) {
        this.warnOnce(`cp:${String(id)}`, `loadCheckpoint: no registered beat declares "${String(id)}" and no save holds it — ignored`);
        return;
      }
      // never saved in this profile: start that beat with the state as it stands (debug jump)
      this.state.checkpoint = info.id;
      await this.load(info.zone, info.beat, 'checkpoint');
    });
  }

  reloadCheckpoint(): Promise<void> {
    return this.enqueue(async () => {
      const file = this.store.read();
      const snap = file ? file.snapshots[file.current] : undefined;
      if (snap && this.zoneMap.has(snap.zone)) {
        const retries = this.state.stats.retries;
        retries[snap.checkpoint] = (retries[snap.checkpoint] ?? 0) + 1;
        this.restore(snap);
        this.store.put(snap.checkpoint, this.state); // keep the counters with the save
        await this.load(snap.zone, snap.beat, 'checkpoint');
        return;
      }
      // nothing saved yet: restart the zone that is loaded (or the first one)
      const zone = this.rt ? this.rt.zone : firstZone(this.zoneMap);
      if (!zone) {
        this.warnOnce('reload:nozones', 'reloadCheckpoint: no zones are registered — nothing to load');
        return;
      }
      await this.load(zone.id, undefined, 'checkpoint');
    });
  }

  gotoZone(zone: ZoneId, beat?: string): Promise<void> {
    return this.enqueue(() => this.load(zone, beat, 'debug'));
  }

  requestGoto(zone: ZoneId, fade: FadeColor = 'black'): void {
    void this.enqueue(() => this.load(zone, undefined, 'entry', fade));
  }

  skipCinematic(): void {
    this.rt?.skipCinematic();
  }

  note(msg: string): void {
    this.journal.push(`${this.game.time.now.toFixed(1)} ${msg}`);
    if (this.journal.length > JOURNAL_MAX) this.journal.splice(0, this.journal.length - JOURNAL_MAX);
    if (this.game.flags.debug) console.debug(`[mission] ${msg}`);
  }

  update(dt: number): void {
    const s = this.state.stats;
    s.playSeconds += dt;
    const rt = this.rt;
    if (!rt) return;
    const zone = rt.zone.id;
    s.zoneSeconds[zone] = (s.zoneSeconds[zone] ?? 0) + dt;
    if (this.beat) {
      const key = `${zone}/${this.beat}`;
      s.zoneSeconds[key] = (s.zoneSeconds[key] ?? 0) + dt;
    }
    rt.update(dt);
  }

  // ---------------------------------------------------------------------------------------------
  // loading
  // ---------------------------------------------------------------------------------------------

  /** Loads run strictly one after another; `loading` covers the whole queue. */
  private enqueue(job: () => Promise<void>): Promise<void> {
    this.pending++;
    const run = this.chain.then(job).catch((err) => {
      reportError('mission:load', err);
      this.reveal();
    });
    this.chain = run.then(() => {
      this.pending = Math.max(0, this.pending - 1);
    });
    return this.chain;
  }

  private async load(zoneId: ZoneId, beatId: string | undefined, reason: LoadReason, fade: FadeColor = 'black'): Promise<void> {
    const game = this.game;
    const { ui, events } = game;
    const def = this.zoneMap.get(zoneId);
    if (!def) {
      this.warnOnce(`goto:${String(zoneId)}`, `gotoZone: zone "${String(zoneId)}" is not registered — ignored`);
      this.reveal();
      return;
    }
    let index = 0;
    if (beatId) {
      const found = def.beats.findIndex((b) => b.id === beatId);
      if (found < 0) this.warnOnce(`beat:${zoneId}:${beatId}`, `zone ${zoneId} has no beat "${beatId}" — starting at its first beat`);
      else index = reason === 'checkpoint' ? resumeBeatIndex(def.beats, beatId) : found;
    }
    const title = `${def.id} · ${def.title}`;
    const progress = (p: number) => ui.showLoading(true, { title, subtitle: def.subtitle, art: def.art, progress: p });

    const frameAtStart = game.time.frame;
    ui.fade(1, 0, fade);
    events.emit('zone:loading', { zone: def.id });
    progress(0.05);
    // let the frame with the loading screen out, and let the routine that asked for the exit finish its tick
    await this.breathe(2);

    this.unload();
    progress(0.15);

    const root = new THREE.Group();
    root.name = `zone:${def.id}`;
    game.scene.add(root);
    const seed = (hashString(def.id) ^ game.flags.seed) >>> 0;
    let builder: ZoneBuilder | null = null;
    try {
      builder = game.createZoneBuilder(root, seed);
    } catch (err) {
      reportError(`zone:${def.id}:builder`, err);
    }
    if (!builder || isStub(builder)) builder = createFallbackBuilder(game, root, seed);
    this.root = root;
    this.builder = builder;

    try {
      await def.build(builder, this.state);
    } catch (err) {
      reportError(`zone:${def.id}:build`, err);
    }
    progress(0.6);
    await this.breathe();

    try {
      const chars = game.chars as unknown as Preloader;
      if (!isStub(game.chars) && typeof chars.preload === 'function') {
        await chars.preload([...new Set<Archetype>([...COMMON_CAST, ...(Array.isArray(def.cast) ? def.cast : [])])]);
      }
    } catch (err) {
      reportError(`zone:${def.id}:preload`, err);
    }
    try {
      await game.render.compile();
    } catch (err) {
      reportError(`zone:${def.id}:compile`, err);
    }
    progress(0.9);

    const rt = new ZoneRuntimeImpl(game, def, this.state, builder, this);
    this.rt = rt;
    const beat = def.beats[index];
    this.state.zone = def.id;
    this.state.beat = beat.id;
    this.beat = beat.id;
    game.player.enabled = true;
    if (game.input.context === 'cinematic') game.input.setContext('game');
    if (typeof beat.enter === 'function') {
      try {
        beat.enter(rt);
      } catch (err) {
        reportError(`zone:${def.id}:${beat.id}:enter`, err);
      }
    } else if (index > 0) {
      this.warnOnce(`enter:${def.id}:${beat.id}`, `beat ${def.id}/${beat.id} has no enter() — the world may be missing its cast`);
    }
    this.ensurePlayer(rt);
    if (reason === 'checkpoint') game.player.restoreForCheckpoint();
    ui.setHudVisible(true);

    game.scripts.start(this.runBeats(rt, index, reason), { name: `beats:${def.id}`, group: rt.group });
    progress(1);
    events.emit('zone:ready', { zone: def.id });
    this.note(`zone ${def.id} ready at beat "${beat.id}" (${reason})`);
    // Headless / manual stepping: no frame ran while loading, and a loading screen that was never updated
    // cannot fade out again (it would keep covering the HUD) — give it one animation step first.
    if (game.time.frame === frameAtStart) ui.update(1 / 30);
    ui.showLoading(false);
    ui.fade(0, FADE_IN_SECONDS);
    if (index === 0) rt.titleCard();
  }

  /** Stop and dispose the loaded zone (script group first, so `finally` blocks run while the world still exists). */
  private unload(): void {
    const game = this.game;
    const rt = this.rt;
    if (rt) {
      game.scripts.stopGroup(rt.group);
      rt.dispose();
    }
    this.rt = null;
    this.beat = null;
    this.guardStep('ai.clear', () => game.ai.clear());
    this.guardStep('actors.clear', () => game.actors.clear());
    this.guardStep('vfx.clear', () => game.vfx.clear());
    this.guardStep('audio.clear', () => game.audio.clear());
    this.guardStep('physics.clear', () => game.physics.clear());
    this.guardStep('render.reset', () => {
      game.render.clearReflectiveFloors();
      game.render.setDof(null);
      game.render.setCorruption(0);
      game.render.setLook(game.render.looks.neutral, 0);
    });
    this.guardStep('audio.reset', () => game.audio.setMuffle(0, 0.3));
    this.guardStep('sky.reset', () => game.sky.reset());
    this.guardStep('player.reset', () => {
      game.player.setContextAction(null);
      game.player.lockTarget = null;
      game.player.threat = 0;
    });
    const root = this.root;
    if (root) {
      const extras = this.builder as unknown as BuilderExtras | null;
      if (extras && !isStub(extras) && typeof extras.dispose === 'function') this.guardStep('builder.dispose', () => extras.dispose!());
      root.removeFromParent();
    }
    this.root = null;
    this.builder = null;
  }

  /** Never leave the player behind an opaque fade or a loading screen. */
  private reveal(): void {
    const ui = this.game.ui;
    ui.update(1 / 30);
    ui.showLoading(false);
    ui.fade(0, 0.4);
  }

  private ensurePlayer(rt: ZoneRuntimeImpl): void {
    if (rt.playerSpawned) return;
    const { player, physics } = this.game;
    if (isStub(player)) return;
    this.warnOnce(`spawn:${rt.zone.id}:${this.state.beat}`, `beat ${rt.zone.id}/${this.state.beat} did not spawn the player — placing the lead at the nearest standable point`);
    const b = rt.builder;
    const name = ['start', 'spawn', 'entry', 'player'].find((n) => b.hasMarker(n) === true);
    const at = name ? b.getMarker(name).pos.clone() : new THREE.Vector3();
    const spot = physics.nearestStandable(at.x, at.y, at.z, 0.4, 40);
    if (spot && !isStub(spot) && Number.isFinite(spot.x)) at.set(spot.x, spot.y, spot.z);
    const lead = player.protagonist === 'selene' ? 'selene' : 'tarrik';
    rt.spawnPlayer(lead, at, name ? rt.myaw(name) : 0);
  }

  // ---------------------------------------------------------------------------------------------
  // beats
  // ---------------------------------------------------------------------------------------------

  private *runBeats(rt: ZoneRuntimeImpl, start: number, reason: LoadReason): Routine {
    const { events, time } = this.game;
    const beats = rt.zone.beats;
    for (let i = start; i < beats.length; i++) {
      if (rt.disposed) return;
      const beat = beats[i];
      this.state.zone = rt.zone.id;
      this.state.beat = beat.id;
      this.beat = beat.id;
      this.beatLog.push({ zone: rt.zone.id, beat: beat.id, t: time.now });
      if (this.beatLog.length > BEAT_LOG_MAX) this.beatLog.shift();
      events.emit('zone:beat', { zone: rt.zone.id, beat: beat.id });
      // resuming AT a checkpoint beat re-saves it quietly (same snapshot, no second toast / stinger)
      if (beat.checkpoint) this.commitSave(beat.checkpoint, i === start && reason === 'checkpoint');
      let routine: Routine | null = null;
      try {
        routine = beat.run(rt);
      } catch (err) {
        reportError(`zone:${rt.zone.id}:${beat.id}`, err);
      }
      if (routine) yield* guarded(routine, `zone:${rt.zone.id}:${beat.id}`, () => this.recoverBeat(rt, beat));
    }
    this.note(`zone ${rt.zone.id}: last beat finished without an exit`);
  }

  /** A beat's routine threw: put presentation back so the next beat starts from a playable state. */
  private recoverBeat(rt: ZoneRuntimeImpl, beat: Beat): void {
    const { ui, player, input } = this.game;
    this.note(`beat ${rt.zone.id}/${beat.id} failed — continuing with the next beat`);
    rt.dialogue.interrupt();
    if (Number(ui.fadeLevel) > 0) ui.fade(0, 0.5);
    ui.letterbox(false);
    if (!rt.cinematicActive) {
      player.enabled = true;
      if (input.context === 'cinematic') input.setContext('game');
    }
  }

  private commitSave(id: CheckpointId, silent: boolean): void {
    const s = this.state;
    const known = this.checkpoints.some((c) => c.id === id) || id === 'CP9';
    if (typeof id !== 'string' || (!known && !/^CP\d/.test(id))) {
      this.warnOnce(`save:${String(id)}`, `saveCheckpoint: "${String(id)}" is not a checkpoint id — ignored`);
      return;
    }
    s.checkpoint = id;
    if (this.rt) {
      s.zone = this.rt.zone.id;
      s.beat = this.beat ?? s.beat;
    }
    this.store.put(id, cloneState(s));
    if (!silent) {
      this.note(`checkpoint ${id} saved at ${s.zone}/${s.beat}`);
      this.game.events.emit('checkpoint:saved', { id });
    }
  }

  /** Restore a snapshot; what the player has lived through (deaths, retries, play time) is kept. */
  private restore(snap: MissionState): void {
    const live = this.state.stats;
    const keep = {
      playSeconds: Math.max(live.playSeconds, snap.stats.playSeconds),
      deaths: Math.max(live.deaths, snap.stats.deaths),
      zoneSeconds: { ...snap.stats.zoneSeconds, ...live.zoneSeconds },
      retries: { ...snap.stats.retries, ...live.retries },
    };
    assignState(this.state, snap);
    this.state.stats = keep;
  }

  /**
   * Yield to the event loop so the routine that asked for the load finishes its tick, and — in a live session —
   * so `frames` game frames can draw the fade and the loading screen before a long synchronous build. Bounded
   * in real time; headless (`manual`) runs yield once and move on. Loading is outside simulated time.
   */
  private async breathe(frames = 1): Promise<void> {
    const time = this.game.time;
    const start = time.frame;
    const deadline = Date.now() + (this.game.flags.manual ? 0 : BREATHE_MS);
    do {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    } while (time.frame - start < frames && Date.now() < deadline);
  }

  private guardStep(name: string, fn: () => void): void {
    try {
      fn();
    } catch (err) {
      reportError(`mission:unload:${name}`, err);
    }
  }

  private warnOnce(key: string, msg: string): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    console.warn(`[mission] ${msg}`);
  }
}
