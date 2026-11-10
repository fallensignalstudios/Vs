/**
 * Debug / test harness: `window.__aurelion`. Contract: src/core/api/debug.ts.
 * Used by tools/shot.cjs, tests/smoke.cjs, the autoplay bot and zone authors (plan views, physics overlay,
 * jumping between beats, headless full runs).
 */
import * as THREE from 'three';
import type {
  CamPose, CheckpointId, DebugApi, DebugGotoOpts, DebugSnapshot, Game, PlanViewOpts, QualityLevel, RunToResult, Vec3Like, ZoneId,
} from '@/core/api';
import { reportError } from '@/core/events';
import { isStub } from '@/core/stub';
import { orderedZones } from '@/mission/checkpoints';
import { AutoplayBot } from './autoplay';
import type { BotOptions } from './autoplay';
import { DebugOverlay } from './overlay';
import { runTo } from './runto';
import type { RunToOptions } from './runto';

const n = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const s = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const errorList = (): string[] => ((globalThis as { __aurelionErrors?: string[] }).__aurelionErrors ??= []);
/** plan view: the section plane sits this far above the floor the lead stands on (doors are 3.5 m, rooms taller) */
export const PLAN_CUT_HEIGHT = 2.8;

class DebugApiImpl implements DebugApi {
  ready = false;
  readonly autoplay: DebugApi['autoplay'];
  private readonly bot: AutoplayBot;
  private readonly overlayView: DebugOverlay;
  private physicsView: THREE.Object3D | null = null;
  /** the plan view's section plane while it is applied to the renderer */
  private planClip: THREE.Plane | null = null;
  /** the scene fog a plan view took away (a 40 m overhead camera otherwise looks through a wall of haze) */
  private planFog: THREE.Fog | THREE.FogExp2 | null = null;
  private running: Promise<RunToResult> | null = null;

  constructor(private readonly game: Game) {
    const bot = (this.bot = new AutoplayBot(game));
    this.autoplay = {
      start: (opts?: BotOptions) => {
        this.enterPlay();
        bot.start(opts);
      },
      stop: () => bot.stop(),
      get running() {
        return bot.running;
      },
      get log() {
        return bot.log;
      },
      get status() {
        return bot.status;
      },
      get teleports() {
        return bot.teleports;
      },
    };
    this.overlayView = new DebugOverlay(game, this, () => (bot.running ? bot.status : ''));

    // The bot must act before the frame's input update and the overlay after the frame: wrap the tick.
    const inner = game.tick.bind(game);
    (game as { tick: Game['tick'] }).tick = (dt: number, render?: boolean) => {
      try {
        bot.update(dt);
      } catch (err) {
        reportError('debug:autoplay', err);
        bot.stop();
      }
      inner(dt, render);
      this.overlayView.update(dt);
    };

    if (game.flags.debug) {
      // headless captures (`manual`) start with a clean frame; F1 / overlay(true) brings the readout up
      this.overlayView.show(!game.flags.manual);
      this.overlayView.bindKeys();
    }
  }

  get errors(): string[] {
    return errorList();
  }
  set errors(_v: string[]) {
    /* mirrors globalThis.__aurelionErrors; not assignable */
  }

  snapshot(): DebugSnapshot {
    const g = this.game;
    const { mission, player, actors, ai, render, camera } = g;
    const actor = isStub(player) ? null : player.actor;
    const live = actor && !isStub(actor) ? actor : null;
    const hostiles: DebugSnapshot['hostiles'] = [];
    if (live && !isStub(actors)) {
      for (const h of actors.hostilesOf(live)) {
        hostiles.push({ id: h.id, archetype: String(h.archetype), hp: n(h.hp), x: n(h.pos.x), y: n(h.pos.y), z: n(h.pos.z) });
      }
    }
    const encounters: DebugSnapshot['encounters'] = [];
    if (!isStub(ai)) {
      for (const e of ai.encounters) {
        encounters.push({ id: s(e.id), state: s(e.state), alive: n(e.aliveCount), spawned: n(e.spawned), total: n(e.total) });
      }
    }
    const m = isStub(mission) ? null : mission;
    const stats = render.stats;
    const marker = m ? m.objectiveMarker : null;
    const cam = camera.camera;
    const audio = isStub(g.audio) ? null : g.audio.debugInfo();
    return {
      phase: g.phase,
      zone: m && m.currentZone ? m.currentZone.id : null,
      beat: m ? m.currentBeat : null,
      checkpoint: m ? m.state.checkpoint : '',
      loading: m ? m.loading : false,
      cinematic: m ? m.cinematicActive : false,
      objective: m ? m.objectiveText : null,
      protagonist: isStub(player) ? '' : s(player.protagonist),
      player: live
        ? { x: n(live.pos.x), y: n(live.pos.y), z: n(live.pos.z), hp: n(live.hp), echo: n(player.echo), alive: live.alive === true }
        : { x: 0, y: 0, z: 0, hp: 0, echo: 0, alive: false },
      hostiles,
      encounters,
      rescuePriority: m ? m.state.rescuePriority : 'pending',
      flags: m ? { ...m.state.flags } : {},
      time: n(g.time.now),
      errors: errorList().slice(),
      stats: { fps: n(stats.fps), drawCalls: n(stats.drawCalls), triangles: n(stats.triangles) },
      scene: { drawCalls: n(stats.sceneDrawCalls), triangles: n(stats.sceneTriangles) },
      interactables: m
        ? m.interactables.map((i) => ({
          id: i.id, enabled: i.enabled, required: i.required !== false, x: n(i.pos.x), y: n(i.pos.y), z: n(i.pos.z), progress: n(i.progress),
        }))
        : [],
      objectiveMarker: marker ? { x: marker.x, y: marker.y, z: marker.z } : null,
      choice: m && m.activeChoice ? m.activeChoice.id : null,
      camera: { mode: s(camera.mode), x: n(cam?.position?.x), y: n(cam?.position?.y), z: n(cam?.position?.z) },
      bot: this.bot.running ? this.bot.status : '',
      audio: audio && !isStub(audio) ? { music: s(audio.music), ambience: s(audio.ambience), intensity: n(audio.intensity) } : undefined,
    };
  }

  step(seconds: number, dt = 1 / 60): void {
    const h = dt > 0 && dt <= 0.1 ? dt : 1 / 60;
    const count = Math.max(1, Math.round(n(seconds) / h));
    for (let i = 0; i < count; i++) this.game.tick(h, false);
  }

  render(): void {
    const g = this.game;
    try {
      g.ui.update(0);
      g.render.render(1 / 60);
    } catch (err) {
      reportError('debug:render', err);
    }
  }

  settle(seconds = 1): void {
    const frames = 3;
    const per = Math.max(1 / 60, n(seconds, 1) / frames);
    for (let i = 0; i < frames; i++) {
      this.step(per - 1 / 60);
      this.game.tick(1 / 60, true);
    }
  }

  goto(zone: ZoneId, beat?: string, opts?: DebugGotoOpts): Promise<void> {
    this.enterPlay();
    this.resetView();
    return this.game.mission.gotoZone(zone, beat, {
      fresh: opts?.keepState !== true,
      flags: opts?.flags,
      rescuePriority: opts?.rescuePriority,
    });
  }

  loadCheckpoint(id: CheckpointId): Promise<void> {
    this.enterPlay();
    this.resetView();
    return this.game.mission.loadCheckpoint(id);
  }

  newGame(): Promise<void> {
    this.enterPlay();
    this.resetView();
    return this.game.mission.newGame(this.game.settings.get('difficulty'));
  }

  teleport(pos: Vec3Like, yaw?: number): void {
    const { player, camera } = this.game;
    if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y) || !Number.isFinite(pos.z)) {
      console.warn('[debug] teleport ignored: position needs finite x, y, z');
      return;
    }
    player.teleport(pos, yaw);
    camera.snapBehind(yaw);
  }

  god(on: boolean): void {
    this.game.player.godMode = !!on;
  }

  killAll(): void {
    const { player, actors } = this.game;
    if (isStub(player) || isStub(actors)) return;
    const actor = player.actor;
    if (!actor || isStub(actor)) return;
    for (const h of actors.hostilesOf(actor).slice()) actors.kill(h, actor);
  }

  skipCinematic(): void {
    this.game.mission.skipCinematic();
  }

  setQuality(q: QualityLevel): void {
    this.game.render.setQuality(q);
  }

  cam(pose: CamPose | null): void {
    this.setPlanClip(null);
    this.setPlanFog(true);
    this.game.camera.setFree(pose);
  }

  planView(height?: number, opts?: PlanViewOpts): void {
    const g = this.game;
    const box = this.playBounds();
    // section cut: everything above a plane a few metres over the lead's floor is not drawn (ceilings, vaults,
    // upper shells), so the plan reads like a drawing
    const cutAt = opts?.cut === false ? null : typeof opts?.cut === 'number' && Number.isFinite(opts.cut) && opts.cut > 0 ? opts.cut : PLAN_CUT_HEIGHT;
    const lead = isStub(g.player) ? null : g.player.actor;
    const floor = lead && !isStub(lead) && Number.isFinite(lead.pos.y) ? lead.pos.y : box.min.y;
    const clipY = cutAt === null ? null : floor + cutAt;
    const cx = (box.min.x + box.max.x) / 2;
    const cz = (box.min.z + box.max.z) / 2;
    const fov = 40;
    const aspect = g.canvas && g.canvas.clientHeight > 0 ? g.canvas.clientWidth / g.canvas.clientHeight : 16 / 9;
    const halfTan = Math.tan((fov * Math.PI) / 360);
    const fitZ = (box.max.z - box.min.z + 6) / (2 * halfTan);
    const fitX = (box.max.x - box.min.x + 6) / (2 * halfTan * aspect);
    const h = height && height > 0 ? height : Math.max(12, fitX, fitZ);
    const top = clipY === null ? box.max.y : Math.min(box.max.y, clipY);
    // a hair south of the centre so that north (−Z) is up on screen
    g.camera.setFree({ pos: { x: cx, y: top + h, z: cz + h * 0.002 }, look: { x: cx, y: top, z: cz }, fov });
    this.setPlanClip(clipY);
    this.setPlanFog(opts?.fog === true);
  }

  hud(visible: boolean): void {
    const ui = this.game.ui;
    ui.setHudVisible(!!visible);
    // a clean frame: zone card, toasts, subtitles, captions, prompts and the skip hint go too
    if (typeof ui.setCleanFrame === 'function') ui.setCleanFrame(!visible);
  }

  physics(visible: boolean): void {
    const g = this.game;
    if (isStub(g.physics)) return;
    if (!this.physicsView) {
      const obj = g.physics.debugObject() as THREE.Object3D | null;
      if (!obj || isStub(obj) || !(obj as THREE.Object3D).isObject3D) return;
      this.physicsView = obj;
    }
    const view = this.physicsView;
    if (visible) {
      g.scene.add(view);
      view.visible = true;
      const refresh = (view.userData as { refresh?: () => void }).refresh;
      if (typeof refresh === 'function') refresh();
    } else {
      view.removeFromParent();
    }
  }

  runTo(opts?: RunToOptions): Promise<RunToResult> {
    // one run at a time: a second call waits for the first and then starts its own
    const prev = this.running ?? Promise.resolve(null);
    const next = prev.catch(() => null).then(() => runTo(this.game, this.bot, opts));
    this.running = next;
    return next;
  }

  overlay(visible: boolean): void {
    this.overlayView.show(!!visible);
  }

  zones(): string[] {
    const m = this.game.mission;
    return isStub(m) ? [] : orderedZones(m.zones).map((z) => z.id);
  }

  /** A jump starts from the gameplay camera: drop a free camera / plan view left over from earlier captures. */
  private resetView(): void {
    this.setPlanClip(null);
    this.setPlanFog(true);
    const cam = this.game.camera;
    if (!isStub(cam) && cam.mode === 'free') cam.setFree(null);
  }

  /** plan view without (false) or with (true, the normal state) the scene's fog */
  private setPlanFog(on: boolean): void {
    const scene = this.game.scene;
    if (!scene || isStub(scene)) return;
    if (!on) {
      if (!this.planFog && scene.fog) {
        this.planFog = scene.fog;
        scene.fog = null;
      }
      return;
    }
    if (this.planFog) {
      if (!scene.fog) scene.fog = this.planFog;
      this.planFog = null;
    }
  }

  /** apply (y) or remove (null) the plan view's horizontal section plane on the renderer */
  private setPlanClip(y: number | null): void {
    const r = this.game.render.renderer as THREE.WebGLRenderer | undefined;
    if (!r || isStub(r) || !Array.isArray(r.clippingPlanes)) return;
    if (y === null) {
      if (!this.planClip) return;
      r.clippingPlanes = r.clippingPlanes.filter((p) => p !== this.planClip);
      this.planClip = null;
      return;
    }
    // keep fragments with y <= cut: normal (0, −1, 0), constant = cut
    const plane = this.planClip ?? new THREE.Plane(new THREE.Vector3(0, -1, 0), y);
    plane.constant = y;
    if (!this.planClip) {
      this.planClip = plane;
      r.clippingPlanes = [...r.clippingPlanes, plane];
    }
  }

  /** Leave the title / boot state so the simulation runs (debug jumps, autoplay, headless runs). */
  private enterPlay(): void {
    const g = this.game;
    if (g.phase === 'playing') return;
    g.ui.hideTitle();
    g.ui.hideDeath();
    g.setPaused(false);
    g.setPhase('playing');
    g.input.setContext('game');
  }

  /** Bounds of the walkable area (nav nodes), else of the zone geometry near the player. */
  private playBounds(): THREE.Box3 {
    const g = this.game;
    const box = new THREE.Box3();
    if (!isStub(g.physics)) {
      g.physics.nav.rebuild();
      const view = g.physics.debugObject() as THREE.Object3D | null;
      const navNodes = view && !isStub(view) ? (view.userData as { navNodes?: () => ArrayLike<number> }).navNodes : undefined;
      if (typeof navNodes === 'function') {
        const pts = navNodes();
        const p = new THREE.Vector3();
        for (let i = 0; i + 2 < pts.length; i += 3) box.expandByPoint(p.set(pts[i], pts[i + 1], pts[i + 2]));
      }
    }
    if (box.isEmpty()) {
      const a = isStub(g.player) ? null : g.player.actor;
      const c = a && !isStub(a) ? a.pos : new THREE.Vector3();
      box.setFromCenterAndSize(c, new THREE.Vector3(40, 4, 40));
    }
    return box;
  }
}

export function createDebugApi(game: Game): DebugApi {
  const api = new DebugApiImpl(game);
  (globalThis as { __aurelion?: DebugApi }).__aurelion = api;
  return api;
}

export { AutoplayBot } from './autoplay';
