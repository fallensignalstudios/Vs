/** Team hostility matrix (symmetric). Encounters flip pairs; `reset()` restores the defaults. */
import type { Team } from '@/core/api';

export const TEAMS: readonly Team[] = ['player', 'dominion', 'reformation', 'contaminated', 'eclipse', 'neutral'];

export class HostilityMatrix {
  private readonly m = new Uint8Array(TEAMS.length * TEAMS.length);

  constructor() {
    this.reset();
  }

  private index(t: Team): number {
    return TEAMS.indexOf(t);
  }

  /** eclipse and contaminated are hostile to every other team except neutral; nothing else is hostile */
  reset(): void {
    this.m.fill(0);
    for (const a of ['eclipse', 'contaminated'] as const) {
      for (const b of TEAMS) if (b !== a && b !== 'neutral') this.set(a, b, true);
    }
  }

  set(a: Team, b: Team, hostile: boolean): void {
    const i = this.index(a);
    const j = this.index(b);
    if (i < 0 || j < 0 || i === j) return;
    const n = TEAMS.length;
    this.m[i * n + j] = this.m[j * n + i] = hostile ? 1 : 0;
  }

  get(a: Team, b: Team): boolean {
    const i = this.index(a);
    const j = this.index(b);
    return i >= 0 && j >= 0 && this.m[i * TEAMS.length + j] === 1;
  }
}
