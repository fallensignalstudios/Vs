/**
 * ZoneRuntime — the scripting surface handed to a zone's beats. One instance per loaded zone.
 * Everything here is defensive: unknown markers, missing cast, stub subsystems and throwing callbacks degrade
 * to a warning and a sensible fallback, never an exception inside a beat.
 */
import * as THREE from 'three';
import type {
  ActiveChoice, Actor, ButtonAction, CheckpointId, ChoiceOpts, CineCtx, Companion, CompanionMode, DoorHandle,
  Encounter, EncounterDef, Game, HumanoidArchetype, InteractOpts, Interactable, MissionState, ProtagonistId,
  RescuePriority, Routine, SayOpts, ScriptHandle, SpeakerId, StoryFlag, Vec3Like, Wait, ZoneBuilder, ZoneDef,
  ZoneId, ZoneRuntime,
} from '@/core/api';
import { STORY_FLAGS } from '@/core/api';
import { reportError } from '@/core/events';
import { clamp, DEG } from '@/core/mathx';
import { isStub } from '@/core/stub';
import { CineCtxImpl, pullIn, shotPose } from './cinematic';
import { DialogueDirector } from './dialogue';
import type { BuilderExtras } from './fallbackBuilder';
import { guarded } from './guard';
import { Guidance } from './guidance';
import { InteractionSet } from './interact';
import { Pickups } from './pickups';

/** seconds `skip` must be held to skip a cinematic */
export const SKIP_HOLD_SECONDS = 0.8;
/** the skip hint is shown this long at the start of every skippable cinematic */
const SKIP_HINT_INTRO = 3;

const LEADS: Record<ProtagonistId, { name: string; faction: string }> = {
  tarrik: { name: 'Tarrik', faction: 'Dominion' },
  selene: { name: 'Selene', faction: 'Reformation' },
};

/** What the runtime needs from the mission system. */
export interface RuntimeHost {
  saveCheckpoint(id: CheckpointId): void;
  /** queue a zone load (asynchronous) */
  requestGoto(zone: ZoneId, fade?: 'black' | 'white' | 'gold'): void;
  hasZone(zone: string): boolean;
  note(msg: string): void;
}

interface ActiveCine {
  id: string;
  skippable: boolean;
  handle: ScriptHandle;
  ctx: CineCtxImpl;
  skipped: boolean;
  elapsed: number;
  hint: number;
}

export class ZoneRuntimeImpl implements ZoneRuntime {
  readonly group: string;
  time = 0;
  playerSpawned = false;
  disposed = false;
  activeChoice: ActiveChoice | null = null;

  readonly dialogue: DialogueDirector;
  readonly interactions: InteractionSet;
  readonly guidance: Guidance;
  private readonly pickups: Pickups;
  private readonly castMap = new Map<string, Companion>();
  private readonly disposers: Array<() => void> = [];
  private readonly warned = new Set<string>();
  private cine: ActiveCine | null = null;
  private ceasefires = 0;

  constructor(
    readonly game: Game,
    readonly zone: ZoneDef,
    readonly state: MissionState,
    readonly builder: ZoneBuilder,
    private readonly host: RuntimeHost,
  ) {
    this.group = `zone:${zone.id}`;
    this.dialogue = new DialogueDirector(game, () => this.skipping);
    this.interactions = new InteractionSet(game);
    this.guidance = new Guidance(game);
    this.pickups = new Pickups(game, builder.root);
  }

  // ---------------------------------------------------------------------------------------------
  // space
  // ---------------------------------------------------------------------------------------------

  P(x: number, n: number, h = 0): THREE.Vector3 {
    return new THREE.Vector3(x, h, -n);
  }

  m(name: string): THREE.Vector3 {
    const b = this.builder;
    if (b.hasMarker(name) === true) return b.getMarker(name).pos.clone();
    this.warnOnce(`marker:${name}`, `unknown marker "${name}" in ${this.zone.id} — using the player's position`);
    const actor = this.livePlayer();
    return actor ? actor.pos.clone() : new THREE.Vector3();
  }

  myaw(name: string): number {
    const b = this.builder;
    if (b.hasMarker(name) === true) return Number(b.getMarker(name).yaw) || 0;
    this.warnOnce(`marker:${name}`, `unknown marker "${name}" in ${this.zone.id} — using the player's position`);
    return this.livePlayer()?.yaw ?? 0;
  }

  /** marker name or position → a fresh world vector */
  resolve(at: string | Vec3Like): THREE.Vector3 {
    if (typeof at === 'string') return this.m(at);
    if (at && Number.isFinite(at.x) && Number.isFinite(at.y) && Number.isFinite(at.z)) return new THREE.Vector3(at.x, at.y, at.z);
    this.warnOnce('pos:bad', `invalid position passed to the zone runtime in ${this.zone.id}`);
    return this.livePlayer()?.pos.clone() ?? new THREE.Vector3();
  }

  // ---------------------------------------------------------------------------------------------
  // waits
  // ---------------------------------------------------------------------------------------------

  until(pred: () => boolean): Wait {
    return pred;
  }

  untilNear(at: string | Vec3Like, radius = 3): Wait {
    const target = this.resolve(at);
    return () => {
      const a = this.livePlayer();
      return !!a && Math.hypot(a.pos.x - target.x, a.pos.z - target.z) <= radius && Math.abs(a.pos.y - target.y) < 3;
    };
  }

  untilInRect(x: number, n: number, w: number, d: number): Wait {
    return () => {
      const a = this.livePlayer();
      return !!a && Math.abs(a.pos.x - x) <= w / 2 && Math.abs(-a.pos.z - n) <= d / 2;
    };
  }

  fork(routine: Routine<unknown>, name = 'fork'): ScriptHandle {
    return this.game.scripts.start(guarded(routine, `zone:${this.zone.id}:${name}`), { name: `${this.zone.id}:${name}`, group: this.group });
  }

  // ---------------------------------------------------------------------------------------------
  // cast
  // ---------------------------------------------------------------------------------------------

  spawnPlayer(who: ProtagonistId, marker: string | Vec3Like, yaw?: number): Actor {
    const { player, camera } = this.game;
    const id: ProtagonistId = who === 'selene' ? 'selene' : 'tarrik';
    const pos = this.resolve(marker);
    const y = yaw ?? (typeof marker === 'string' ? this.myaw(marker) : 0);
    player.setProtagonist(id, { pos, yaw: y });
    camera.snapBehind(y);
    this.playerSpawned = true;
    return player.actor;
  }

  get player(): Actor {
    return this.game.player.actor;
  }

  companion(who: HumanoidArchetype, marker: string | Vec3Like, mode: CompanionMode = 'follow', name?: string): Companion {
    const pos = this.resolve(marker);
    const yaw = typeof marker === 'string' ? this.myaw(marker) : 0;
    const c = this.game.ai.spawnCompanion(who, { pos, yaw, mode, name });
    this.castMap.set(name ?? who, c);
    return c;
  }

  npc(who: HumanoidArchetype, marker: string | Vec3Like, pose?: string, name?: string): Companion {
    const pos = this.resolve(marker);
    const yaw = typeof marker === 'string' ? this.myaw(marker) : 0;
    const c = this.game.ai.spawnNpc(who, { pos, yaw, pose, name });
    this.castMap.set(name ?? who, c);
    return c;
  }

  cast(name: string): Companion | null {
    const direct = this.castMap.get(name);
    if (direct) return direct;
    const lower = String(name).toLowerCase();
    for (const [k, v] of this.castMap) if (k.toLowerCase() === lower) return v;
    return null;
  }

  // ---------------------------------------------------------------------------------------------
  // dialogue
  // ---------------------------------------------------------------------------------------------

  say(speaker: SpeakerId, text: string, opts?: SayOpts): Routine {
    return this.dialogue.say(speaker, text, opts);
  }

  bark(speaker: SpeakerId, text: string, opts?: SayOpts): void {
    this.dialogue.bark(speaker, text, opts);
  }

  *talk(lines: Array<[SpeakerId, string] | [SpeakerId, string, SayOpts]>): Routine {
    if (!Array.isArray(lines)) return;
    for (const l of lines) {
      if (!Array.isArray(l)) continue;
      yield* this.dialogue.say(l[0], l[1], l[2]);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // objectives / interaction
  // ---------------------------------------------------------------------------------------------

  objective(text: string | null, at?: string | Vec3Like | null): void {
    this.guidance.setObjective(text, at == null ? null : this.resolve(at));
  }

  optionalMarker(id: string, at: string | Vec3Like | null, label?: string): void {
    this.guidance.setOptional(id, at == null ? null : this.resolve(at), label);
  }

  interact(opts: InteractOpts): Interactable {
    return this.interactions.add(opts, this.resolve(opts.at));
  }

  untilInteract(i: Interactable): Wait {
    return () => !i || i.done === true;
  }

  hint(text: string | null, button?: ButtonAction, seconds?: number): void {
    const { ui, input } = this.game;
    if (!text) {
      ui.hint(null);
      return;
    }
    ui.hint({ text, glyph: button ? String(input.glyph(button)) : undefined, seconds });
  }

  // ---------------------------------------------------------------------------------------------
  // combat
  // ---------------------------------------------------------------------------------------------

  encounter(def: EncounterDef): Encounter {
    return this.game.ai.createEncounter({ ...def, resolve: def.resolve ?? ((marker: string) => this.m(marker)) });
  }

  // ---------------------------------------------------------------------------------------------
  // cinematics / flow
  // ---------------------------------------------------------------------------------------------

  get skipping(): boolean {
    return this.cine !== null && this.cine.handle.fastForward === true;
  }

  get cinematicActive(): boolean {
    return this.cine !== null;
  }

  get cinematicSkippable(): boolean {
    return this.cine !== null && this.cine.skippable && !this.cine.handle.fastForward;
  }

  *cinematic(
    id: string,
    body: (c: CineCtx) => Routine,
    opts?: { skippable?: boolean; keepHud?: boolean; blendOut?: number; ceasefire?: boolean; letterbox?: boolean },
  ): Routine {
    if (this.cine) {
      // a scene inside a scene (a handoff inside a cinematic) shares the outer scene's setup and skip
      yield* body(this.cine.ctx);
      return;
    }
    const g = this.game;
    const { player, input, ui, camera } = g;
    const actor = this.livePlayer();
    const prev = {
      enabled: player.enabled !== false,
      context: input.context,
      hud: ui.hudVisible !== false,
      invulnerable: actor ? actor.invulnerable === true : false,
    };
    const useCeasefire = opts?.ceasefire !== false;
    const ctx = new CineCtxImpl(g, () => this.skipping);
    let routine: Routine;
    try {
      routine = body(ctx);
    } catch (err) {
      reportError(`cinematic:${id}`, err);
      return;
    }
    const handle = g.scripts.start(guarded(routine, `cinematic:${id}`), { name: `cine:${id}`, group: this.group });
    const cine: ActiveCine = { id, skippable: opts?.skippable !== false, handle, ctx, skipped: false, elapsed: 0, hint: -1 };
    this.cine = cine;
    g.events.emit('cinematic:start', { id, skippable: cine.skippable });
    try {
      player.enabled = false;
      player.setContextAction(null);
      if (actor) actor.invulnerable = true;
      input.setContext('cinematic');
      if (opts?.keepHud !== true) ui.setHudVisible(false);
      if (opts?.letterbox !== false) ui.letterbox(true);
      if (useCeasefire) this.ceasefire(true);
      yield () => handle.done;
    } finally {
      if (!handle.done) handle.stop();
      this.cine = null;
      ui.skipHint(false);
      ui.letterbox(false);
      g.render.setDof(null);
      if (useCeasefire) this.ceasefire(false);
      // the lead may have changed inside the scene (handoff): restore the flag on both bodies
      if (actor && !prev.invulnerable) actor.invulnerable = false;
      const now = this.livePlayer();
      if (now && now !== actor) now.invulnerable = false;
      if (opts?.keepHud !== true) ui.setHudVisible(prev.hud);
      if (input.context === 'cinematic') input.setContext(prev.context === 'cinematic' ? 'game' : prev.context);
      player.enabled = prev.enabled;
      camera.cine.finish();
      camera.release(this.disposed ? 0 : opts?.blendOut ?? 0.6);
      g.events.emit('cinematic:end', { id, skipped: cine.skipped });
    }
  }

  /** Fast-forward the active skippable cinematic (identical state, zero waits). */
  skipCinematic(): void {
    const c = this.cine;
    if (!c || !c.skippable || c.handle.fastForward || c.handle.done) return;
    c.handle.fastForward = true;
    c.skipped = true;
    this.dialogue.interrupt();
    this.game.camera.cine.finish();
    this.game.ui.skipHint(false);
    this.host.note(`cinematic "${c.id}" skipped at ${c.elapsed.toFixed(1)} s`);
  }

  *handoff(to: ProtagonistId, opts?: { partnerMode?: CompanionMode; seconds?: number; line?: [SpeakerId, string] }): Routine {
    const g = this.game;
    const from = g.player.protagonist;
    if (to !== 'tarrik' && to !== 'selene') {
      this.warnOnce(`handoff:${String(to)}`, `handoff to unknown protagonist "${String(to)}" ignored`);
      return;
    }
    if (from === to) {
      this.log(`handoff to ${to} ignored — already the lead`);
      return;
    }
    const total = clamp(opts?.seconds ?? 3.4, 1.2, 12);
    const self = this;
    yield* this.cinematic(
      `handoff:${from}>${to}`,
      function* (c): Routine {
        const old = self.livePlayer();
        const oldPos = old ? old.pos.clone() : new THREE.Vector3();
        const oldYaw = old ? old.yaw : 0;
        const partner = self.cast(to);
        const partnerActor = partner && !isStub(partner) && !isStub(partner.actor) ? partner.actor : null;
        const newPos = partnerActor ? partnerActor.pos.clone() : self.besideFor(oldPos, oldYaw);
        const newYaw = partnerActor ? partnerActor.yaw : oldYaw;
        if (!partnerActor) self.warnOnce(`handoff:nobody:${to}`, `handoff to ${to}: no companion body of that name in ${self.zone.id} — spawning beside the lead`);

        // The swap rides on the cut: the same frame the camera cuts to the outgoing lead, both bodies change hands.
        const onOld = pullIn(g, shotPose(oldPos, { yawDeg: -oldYaw / DEG + 28, distance: 3.1, height: 1.5, fov: 40 }));
        c.cut(onOld);
        if (partner) {
          partner.remove();
          self.uncast(partner);
        }
        g.player.setProtagonist(to, { pos: newPos, yaw: newYaw });
        self.playerSpawned = true;
        const fromWho: HumanoidArchetype = from === 'selene' ? 'selene' : 'tarrik';
        const body = g.ai.spawnCompanion(fromWho, { pos: oldPos, yaw: oldYaw, mode: opts?.partnerMode ?? 'follow' });
        self.castMap.set(fromWho, body);
        g.events.emit('handoff', { from, to });

        yield total * 0.16;
        const onNew = pullIn(g, shotPose(newPos, { yawDeg: -newYaw / DEG - 24, distance: 2.7, height: 1.55, fov: 38 }));
        yield* c.move(onNew, total * 0.5, 'inOutCubic');
        if (!c.skipping) g.ui.zoneCard(`Now playing · ${LEADS[to].name}`, LEADS[to].faction);
        if (opts?.line) yield* self.say(opts.line[0], opts.line[1], { actor: self.livePlayer() });
        yield total * 0.34;
        g.camera.snapBehind(newYaw);
      },
      { blendOut: 0.9 },
    );
  }

  *choice(opts: ChoiceOpts): Routine<string> {
    const g = this.game;
    const options = Array.isArray(opts?.options) ? opts.options.map((o) => o.id) : [];
    if (!opts || typeof opts.id !== 'string' || options.length === 0) {
      this.warnOnce('choice:empty', 'choice without an id or options ignored');
      return '';
    }
    const key = `choice:${opts.id}`;
    const prior = this.state.flags[key];
    if (typeof prior === 'string' && options.includes(prior)) {
      this.log(`choice "${opts.id}" already made (${prior}) — not asked again`);
      return prior;
    }
    const { player, ui } = g;
    const actor = this.livePlayer();
    const prevEnabled = player.enabled !== false;
    const prevInvulnerable = actor ? actor.invulnerable === true : false;
    let picked = options[0];
    try {
      player.enabled = false;
      if (actor) actor.invulnerable = true;
      this.ceasefire(true);
      const handle = ui.choice(opts);
      if (isStub(handle)) {
        this.log(`choice "${opts.id}": no UI available — first option taken`);
      } else {
        this.activeChoice = { id: opts.id, options, select: (o: string) => handle.select(o) };
        yield () => typeof handle.selected === 'string';
        if (typeof handle.selected === 'string' && options.includes(handle.selected)) picked = handle.selected;
      }
    } finally {
      this.activeChoice = null;
      this.ceasefire(false);
      if (actor && !prevInvulnerable) actor.invulnerable = false;
      player.enabled = prevEnabled;
    }
    this.state.flags[key] = picked;
    g.audio.stinger('choice');
    g.events.emit('choice:made', { id: opts.id, option: picked });
    this.log(`choice "${opts.id}" → ${picked}`);
    return picked;
  }

  commitRescuePriority(p: Exclude<RescuePriority, 'pending'>): void {
    if (p !== 'WestStretchers' && p !== 'EastWalkers') {
      this.warnOnce(`priority:${String(p)}`, `commitRescuePriority("${String(p)}") is not a valid priority — ignored`);
      return;
    }
    if (this.state.rescuePriority !== 'pending') {
      if (this.state.rescuePriority !== p) {
        console.warn(`[mission] rescue priority is already committed as ${this.state.rescuePriority}; "${p}" ignored`);
      }
      return;
    }
    this.state.rescuePriority = p;
    this.log(`rescue priority committed: ${p}`);
    this.host.saveCheckpoint(this.state.checkpoint);
  }

  story(flag: StoryFlag, value = true): void {
    if (!(STORY_FLAGS as readonly string[]).includes(flag)) {
      this.warnOnce(`story:${String(flag)}`, `"${String(flag)}" is not a story flag — use setFlag for zone-local state`);
      return;
    }
    this.state.flags[flag] = value !== false;
  }

  flag(key: string): boolean | number | string | undefined {
    return this.state.flags[key];
  }

  setFlag(key: string, value: boolean | number | string): void {
    if (typeof key !== 'string' || key.length === 0) return;
    if ((STORY_FLAGS as readonly string[]).includes(key)) {
      this.story(key as StoryFlag, value !== false);
      return;
    }
    if (key.startsWith('choice:')) {
      this.warnOnce(`flag:${key}`, `flag "${key}" is reserved for recorded choices — ignored`);
      return;
    }
    if (typeof value === 'boolean' || typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) {
      this.state.flags[key] = value;
    }
  }

  optionalDone(id: 'O1' | 'O2' | 'O3' | 'O4'): void {
    if (!(id in this.state.optional)) {
      this.warnOnce(`optional:${String(id)}`, `unknown optional pocket "${String(id)}"`);
      return;
    }
    if (this.state.optional[id]) return;
    this.state.optional[id] = true;
    this.guidance.setOptional(id, null);
    const done = Object.values(this.state.optional).filter(Boolean).length;
    this.game.ui.toast(`Optional record ${done} / 4`, 'record');
  }

  checkpoint(id: CheckpointId): void {
    this.host.saveCheckpoint(id);
  }

  titleCard(): void {
    this.game.ui.zoneCard(`${this.zone.id} · ${this.zone.title}`, this.zone.subtitle);
  }

  *fadeOut(seconds = 0.8, color: 'black' | 'white' | 'gold' = 'black'): Routine {
    const ui = this.game.ui;
    if (this.skipping || !(seconds > 0)) {
      ui.fade(1, 0, color);
      return;
    }
    ui.fade(1, seconds, color);
    yield seconds;
  }

  *fadeIn(seconds = 0.8): Routine {
    const ui = this.game.ui;
    if (this.skipping || !(seconds > 0)) {
      ui.fade(0, 0);
      return;
    }
    ui.fade(0, seconds);
    yield seconds;
  }

  *exit(to: ZoneId, opts?: { fade?: 'white' | 'black' | 'gold'; seconds?: number }): Routine {
    if (!this.host.hasZone(to)) {
      this.warnOnce(`exit:${String(to)}`, `exit to "${String(to)}": zone is not registered — staying in ${this.zone.id}`);
      this.log(`exit to ${String(to)} failed: not registered`);
      return;
    }
    const color = opts?.fade ?? 'black';
    this.game.events.emit('zone:exit', { zone: this.zone.id, to });
    yield* this.fadeOut(opts?.seconds ?? 0.9, color);
    this.host.requestGoto(to, color);
    yield () => false;
  }

  *completeMission(): Routine {
    this.story('departed');
    this.host.saveCheckpoint('CP9');
    this.game.events.emit('zone:exit', { zone: this.zone.id, to: null });
    yield* this.fadeOut(1.6, 'black');
    this.game.events.emit('mission:complete', { state: this.state });
    yield () => false;
  }

  openDoor(door: DoorHandle, open = true): void {
    if (!door || isStub(door)) return;
    door.setOpen(open);
    this.game.physics.nav.rebuild();
  }

  pickup(kind: 'sustain' | 'ammo' | 'echo', at: string | Vec3Like): void {
    this.pickups.spawn(kind, this.resolve(at));
  }

  onDispose(fn: () => void): void {
    if (typeof fn === 'function') this.disposers.push(fn);
  }

  log(msg: string): void {
    this.host.note(`[${this.zone.id}/${this.state.beat}] ${msg}`);
  }

  // ---------------------------------------------------------------------------------------------
  // lifecycle (mission system only)
  // ---------------------------------------------------------------------------------------------

  update(dt: number): void {
    if (this.disposed) return;
    this.time += dt;
    const g = this.game;
    if (this.zone.update) {
      try {
        this.zone.update(this, dt);
      } catch (err) {
        this.reportOnce('zone:update', err);
      }
    }
    const extras = this.builder as unknown as BuilderExtras;
    if (!isStub(this.builder) && typeof extras.update === 'function') {
      try {
        extras.update(dt, this.time);
      } catch (err) {
        this.reportOnce('builder:update', err);
      }
    }
    this.dialogue.update(dt);
    this.interactions.update(dt);
    this.guidance.update(dt);
    this.pickups.update(dt, this.time);

    const c = this.cine;
    if (c) {
      c.elapsed += dt;
      if (c.skippable && !c.handle.fastForward) {
        const held = Number(g.input.heldTime('skip')) || 0;
        const p = clamp(held / SKIP_HOLD_SECONDS, 0, 1);
        const show = held > 0.12 || c.elapsed < SKIP_HINT_INTRO;
        const key = show ? Math.round(p * 50) : -1;
        if (key !== c.hint) {
          c.hint = key;
          g.ui.skipHint(show, p);
        }
        if (p >= 1) this.skipCinematic();
      }
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.zone.dispose) {
      try {
        this.zone.dispose(this);
      } catch (err) {
        reportError(`zone:${this.zone.id}:dispose`, err);
      }
    }
    for (const fn of this.disposers.splice(0)) {
      try {
        fn();
      } catch (err) {
        reportError(`zone:${this.zone.id}:onDispose`, err);
      }
    }
    this.dialogue.clear();
    this.interactions.dispose();
    this.guidance.dispose();
    this.pickups.dispose();
    this.castMap.clear();
    this.activeChoice = null;
    if (this.ceasefires > 0) {
      this.ceasefires = 0;
      this.game.ai.setCeasefire(false);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // internals
  // ---------------------------------------------------------------------------------------------

  private livePlayer(): Actor | null {
    const p = this.game.player;
    if (isStub(p)) return null;
    const a = p.actor;
    return a && !isStub(a) ? a : null;
  }

  private uncast(c: Companion): void {
    for (const [k, v] of this.castMap) if (v === c) this.castMap.delete(k);
  }

  /** a standable spot about 1.6 m to the right of a body (new lead without a companion body) */
  private besideFor(pos: THREE.Vector3, yaw: number): THREE.Vector3 {
    const x = pos.x + Math.cos(yaw) * 1.6;
    const z = pos.z - Math.sin(yaw) * 1.6;
    const spot = this.game.physics.nearestStandable(x, pos.y, z, 0.4, 3);
    if (spot && !isStub(spot) && Number.isFinite(spot.x)) return new THREE.Vector3(spot.x, spot.y, spot.z);
    return new THREE.Vector3(x, pos.y, z);
  }

  private ceasefire(on: boolean): void {
    this.ceasefires = Math.max(0, this.ceasefires + (on ? 1 : -1));
    this.game.ai.setCeasefire(this.ceasefires > 0);
  }

  private warnOnce(key: string, msg: string): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    console.warn(`[mission] ${msg}`);
  }

  private reportOnce(key: string, err: unknown): void {
    if (this.warned.has(`err:${key}`)) return;
    this.warned.add(`err:${key}`);
    reportError(`zone:${this.zone.id}:${key}`, err);
  }
}
