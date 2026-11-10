/**
 * Development overlay (ui.debugText) and the F-key bindings, active with `?debug=1`.
 *   F1 overlay · F2 god mode · F3 kill all hostiles · F4 skip cinematic · F6 / F7 previous / next zone ·
 *   F8 physics + nav wireframes
 */
import type { DebugApi, Game } from '@/core/api';
import { isStub } from '@/core/stub';

const REFRESH_SECONDS = 0.25;

export class DebugOverlay {
  visible = false;
  private timer = 0;
  private god = false;
  private physicsOn = false;

  constructor(
    private readonly game: Game,
    private readonly api: DebugApi,
    private readonly botStatus: () => string,
  ) {}

  show(visible: boolean): void {
    this.visible = visible;
    this.timer = 0;
    if (!visible) this.game.ui.debugText(null);
  }

  /** Bind the F-keys (browser only). Returns an unbind function. */
  bindKeys(): () => void {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return () => {};
    const onKey = (e: KeyboardEvent): void => {
      if (!this.handleKey(e.code)) return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }

  handleKey(code: string): boolean {
    const { api, game } = this;
    switch (code) {
      case 'F1':
        this.show(!this.visible);
        return true;
      case 'F2':
        this.god = !(game.player.godMode === true);
        api.god(this.god);
        game.ui.toast(`God mode ${this.god ? 'on' : 'off'}`, 'info');
        return true;
      case 'F3':
        api.killAll();
        return true;
      case 'F4':
        api.skipCinematic();
        return true;
      case 'F6':
      case 'F7': {
        const ids = api.zones();
        if (ids.length === 0) return true;
        const cur = game.mission.currentZone ? ids.indexOf(game.mission.currentZone.id) : -1;
        const next = code === 'F7' ? Math.min(ids.length - 1, cur + 1) : Math.max(0, cur - 1);
        if (next !== cur) void api.goto(ids[next] as Parameters<DebugApi['goto']>[0]);
        return true;
      }
      case 'F8':
        this.physicsOn = !this.physicsOn;
        api.physics(this.physicsOn);
        return true;
      default:
        return false;
    }
  }

  update(dt: number): void {
    if (!this.visible) return;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = REFRESH_SECONDS;
    this.game.ui.debugText(this.text());
  }

  private text(): string {
    const g = this.game;
    const s = this.api.snapshot();
    const q = g.render.quality;
    const enc = s.encounters.map((e) => `${e.id}:${e.state} ${e.alive}/${e.total}`).join('  ');
    const p = s.player;
    const lines = [
      `${s.zone ?? '—'} · ${s.beat ?? '—'}   ${s.checkpoint}   t ${s.time.toFixed(1)}s${s.loading ? '   LOADING' : ''}${s.cinematic ? '   CINEMATIC' : ''}`,
      `fps ${s.stats.fps.toFixed(0)}   draws ${s.stats.drawCalls} (scene ${s.scene?.drawCalls ?? 0})   tris ${(s.stats.triangles / 1000).toFixed(0)}k   q:${isStub(q) ? '?' : q.level}`,
      `hostiles ${s.hostiles.length}${enc ? `   ${enc}` : ''}`,
      `${s.protagonist} hp ${Math.round(p.hp)} echo ${Math.round(p.echo)}   pos ${p.x.toFixed(1)} ${p.y.toFixed(1)} ${p.z.toFixed(1)}${g.player.godMode === true ? '   GOD' : ''}`,
    ];
    if (s.objective) lines.push(`objective: ${s.objective}`);
    const bot = this.botStatus();
    if (bot) lines.push(`bot: ${bot}`);
    if (s.errors.length) lines.push(`errors: ${s.errors.length} — ${s.errors[s.errors.length - 1].split('\n')[0].slice(0, 90)}`);
    return lines.join('\n');
  }
}
