/** The shared context every AI module receives (implemented by AiSystemImpl in index.ts). */
import type { Actor, AiStats, Game } from '@/core/api';
import type { Brain } from './brain';
import type { DeviceSystemImpl } from './devices';
import type { EncounterImpl } from './encounter';
import type { LinkSystemImpl } from './links';
import type { Projectiles } from './projectiles';

export interface AiCore {
  readonly game: Game;
  readonly links: LinkSystemImpl;
  readonly devices: DeviceSystemImpl;
  readonly projectiles: Projectiles;
  readonly stats: AiStats;
  readonly ceasefire: boolean;
  /** the brain driving `actor`, when it is one of ours */
  brainOf(actor: Actor | null | undefined): Brain | null;
  memberOf(actor: Actor): EncounterImpl | null;
  /** an attack was launched: feeds the combat intensity */
  noteAttack(weight?: number): void;
  /** record a telegraph of `seconds` in the stats */
  noteTelegraph(seconds: number): void;
}

export function emptyStats(): AiStats {
  return {
    spawned: 0, volleys: 0, syncVolleys: 0, boltsFired: 0, meleeAttacks: 0, telegraphs: 0, minTelegraph: Infinity,
    linksCreated: 0, linksSevered: 0, pounces: 0, detections: 0, jointExposures: 0, pressurePulses: 0,
  };
}

export function resetStats(s: AiStats): void {
  Object.assign(s, emptyStats());
}
