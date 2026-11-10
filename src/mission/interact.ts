/**
 * World interactions: proximity + facing prompt, press or hold (hold→toggle accessibility through
 * `input.engaged`), damage interruption, 'interact' world markers, programmatic completion for bots / skip.
 */
import * as THREE from 'three';
import type { ButtonAction, Game, Interactable, InteractOpts } from '@/core/api';
import { reportError } from '@/core/events';
import { forwardX, forwardZ } from '@/core/mathx';
import { isStub } from '@/core/stub';

const DEFAULT_RADIUS = 2.2;
const DEFAULT_MARKER_RANGE = 14;
/** closer than this the facing test is waived (standing on top of the thing) */
const FACING_WAIVE_DIST = 0.9;
/** cos of the half-angle within which the player counts as "roughly facing" */
const FACING_COS = -0.15;
/** hold progress drains at this multiple of the fill rate after a release */
const DRAIN_RATE = 2.5;

class InteractableImpl implements Interactable {
  done = false;
  progress = 0;
  holding = false;
  markerShown = false;
  removed = false;
  private manualEnabled = true;

  constructor(
    readonly opts: InteractOpts,
    readonly pos: THREE.Vector3,
    private readonly owner: InteractionSet,
  ) {}

  get id(): string {
    return this.opts.id;
  }

  get enabled(): boolean {
    if (!this.manualEnabled || this.done || this.removed) return false;
    const fn = this.opts.enabled;
    if (!fn) return true;
    try {
      return !!fn();
    } catch (err) {
      reportError(`interact:${this.id}:enabled`, err);
      return false;
    }
  }

  set enabled(v: boolean) {
    this.manualEnabled = !!v;
  }

  get radius(): number {
    return this.opts.radius && this.opts.radius > 0 ? this.opts.radius : DEFAULT_RADIUS;
  }

  get button(): ButtonAction {
    return this.opts.button ?? 'interact';
  }

  complete(): void {
    this.owner.finish(this);
  }

  remove(): void {
    this.owner.remove(this);
  }
}

export class InteractionSet {
  private readonly items: InteractableImpl[] = [];
  private focus: InteractableImpl | null = null;
  private promptKey = '';
  private readonly offDamage: () => void;
  private readonly fwd = new THREE.Vector3();

  constructor(private readonly game: Game) {
    this.offDamage = game.events.on('player:damaged', () => this.interrupt());
  }

  /** required interactions still to do (nav assist + autoplay) */
  get required(): Interactable[] {
    return this.items.filter((i) => i.opts.required === true && !i.done);
  }

  get all(): readonly Interactable[] {
    return this.items;
  }

  add(opts: InteractOpts, pos: THREE.Vector3): Interactable {
    const existing = this.items.find((i) => i.id === opts.id);
    if (existing) {
      console.warn(`[mission] interact "${opts.id}" registered twice — replacing the first`);
      this.remove(existing);
    }
    const it = new InteractableImpl(opts, pos.clone(), this);
    this.items.push(it);
    return it;
  }

  finish(it: InteractableImpl): void {
    if (it.done || it.removed) return;
    const { input, events, vfx, ui } = this.game;
    it.done = true;
    it.progress = 1;
    if (it.holding) {
      it.holding = false;
      input.disengage(it.button);
    }
    this.hideMarker(it);
    if (this.focus === it) this.setFocus(null);
    ui.prompt(null);
    this.promptKey = '';
    vfx.spawn('interactPing', it.pos);
    this.call(it, 'onDone');
    events.emit('interact:done', { id: it.id });
  }

  remove(it: InteractableImpl): void {
    if (it.removed) return;
    it.removed = true;
    if (it.holding) this.cancelHold(it);
    this.hideMarker(it);
    if (this.focus === it) this.setFocus(null);
    const i = this.items.indexOf(it);
    if (i >= 0) this.items.splice(i, 1);
  }

  update(dt: number): void {
    const { player, ui, input } = this.game;
    const actor = isStub(player) ? null : player.actor;
    const live = !!actor && !isStub(actor) && actor.alive !== false && player.enabled !== false && ui.modalOpen !== true;
    if (!live) {
      if (this.focus) this.setFocus(null);
      for (const it of this.items) this.hideMarker(it);
      return;
    }

    this.fwd.set(forwardX(actor.yaw), 0, forwardZ(actor.yaw));
    let best: InteractableImpl | null = null;
    let bestDist = Infinity;
    for (const it of this.items) {
      if (!it.enabled) {
        this.hideMarker(it);
        if (it.holding) this.cancelHold(it);
        it.progress = 0;
        continue;
      }
      const dx = it.pos.x - actor.pos.x;
      const dz = it.pos.z - actor.pos.z;
      const dist = Math.hypot(dx, dz);
      const dy = Math.abs(it.pos.y - actor.pos.y);
      const range = it.opts.markerRange ?? DEFAULT_MARKER_RANGE;
      if (dist <= range && dist > it.radius * 0.6) this.showMarker(it);
      else this.hideMarker(it);
      if (dist > it.radius || dy > 2.4) continue;
      const facing = dist < FACING_WAIVE_DIST || (dx * this.fwd.x + dz * this.fwd.z) / dist >= FACING_COS;
      if (facing && dist < bestDist) {
        best = it;
        bestDist = dist;
      }
    }
    if (best !== this.focus) this.setFocus(best);

    // hold progress drains on everything that is not being held right now
    for (const it of this.items) {
      if (it !== this.focus && it.progress > 0 && !it.done) it.progress = Math.max(0, it.progress - (dt * DRAIN_RATE) / Math.max(0.1, it.opts.hold ?? 0.1));
    }

    const it = this.focus;
    if (!it) return;
    const hold = it.opts.hold && it.opts.hold > 0 ? it.opts.hold : 0;
    if (hold > 0) {
      const down = input.engaged(it.button) === true;
      if (down) {
        if (!it.holding) {
          it.holding = true;
          this.call(it, 'onStart');
        }
        it.progress = Math.min(1, it.progress + dt / hold);
        if (it.progress >= 1) {
          this.finish(it);
          return;
        }
      } else {
        if (it.holding) this.cancelHold(it);
        it.progress = Math.max(0, it.progress - (dt * DRAIN_RATE) / hold);
      }
    } else if (input.take(it.button) === true) {
      this.call(it, 'onStart');
      this.finish(it);
      return;
    }
    this.drawPrompt(it, hold > 0);
  }

  dispose(): void {
    this.offDamage();
    for (const it of this.items.slice()) this.remove(it);
    this.game.ui.prompt(null);
    this.promptKey = '';
  }

  /** taking damage cancels an interruptible hold safely (progress is lost, the prompt stays) */
  private interrupt(): void {
    const it = this.focus;
    if (!it || !it.holding || it.opts.interruptible !== true) return;
    this.cancelHold(it);
    it.progress = 0;
  }

  private cancelHold(it: InteractableImpl): void {
    it.holding = false;
    this.game.input.disengage(it.button);
    this.call(it, 'onCancel');
  }

  private setFocus(it: InteractableImpl | null): void {
    const prev = this.focus;
    if (prev && prev.holding) this.cancelHold(prev);
    this.focus = it;
    if (!it) {
      this.game.ui.prompt(null);
      this.promptKey = '';
    }
  }

  private drawPrompt(it: InteractableImpl, hold: boolean): void {
    const { ui, input } = this.game;
    const glyph = String(input.glyph(it.button) ?? '');
    const progress = hold ? Math.round(it.progress * 100) / 100 : undefined;
    const key = `${it.id}|${glyph}|${progress ?? ''}`;
    if (key === this.promptKey) return;
    this.promptKey = key;
    ui.prompt({ text: it.opts.prompt, glyph, progress, hold });
  }

  private showMarker(it: InteractableImpl): void {
    if (it.markerShown) return;
    it.markerShown = true;
    this.game.ui.marker(`interact:${it.id}`, it.pos, { kind: 'interact', hideWithin: it.radius * 0.6 });
  }

  private hideMarker(it: InteractableImpl): void {
    if (!it.markerShown) return;
    it.markerShown = false;
    this.game.ui.marker(`interact:${it.id}`, null);
  }

  private call(it: InteractableImpl, hook: 'onStart' | 'onCancel' | 'onDone'): void {
    const fn = it.opts[hook];
    if (!fn) return;
    try {
      fn();
    } catch (err) {
      reportError(`interact:${it.id}:${hook}`, err);
    }
  }
}
