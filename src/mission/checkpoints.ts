/**
 * Checkpoint table + zone ordering, derived from the registered zone definitions (pure helpers).
 */
import { ZONE_ORDER } from '@/core/api';
import type { CheckpointId, CheckpointInfo, ZoneDef, ZoneId } from '@/core/api';
import { CHECKPOINT_ORDER } from './save';

/** Registered zones in mission order: ZONE_ORDER first, then any others in registration order (test zones). */
export function orderedZones(zones: ReadonlyMap<ZoneId, ZoneDef>): ZoneDef[] {
  const out: ZoneDef[] = [];
  for (const id of ZONE_ORDER) {
    const z = zones.get(id);
    if (z) out.push(z);
  }
  for (const z of zones.values()) if (!out.includes(z)) out.push(z);
  return out;
}

/** The zone a new game starts in, or null when nothing is registered. */
export function firstZone(zones: ReadonlyMap<ZoneId, ZoneDef>): ZoneDef | null {
  return orderedZones(zones)[0] ?? null;
}

/**
 * One entry per checkpoint id that a registered beat declares (`Beat.checkpoint`); the first declaration in
 * mission order wins. CP9 (mission complete) is saved by `completeMission()` rather than a beat: when no beat
 * declares it, it maps to the last beat of the last zone. Sorted by checkpoint order.
 */
export function deriveCheckpoints(zones: ReadonlyMap<ZoneId, ZoneDef>): CheckpointInfo[] {
  const found = new Map<CheckpointId, CheckpointInfo>();
  const ordered = orderedZones(zones);
  for (const z of ordered) {
    for (const b of z.beats ?? []) {
      const id = b.checkpoint;
      if (!id || found.has(id) || !CHECKPOINT_ORDER.includes(id)) continue;
      found.set(id, { id, zone: z.id, beat: b.id, label: `${z.title} — ${b.id}` });
    }
  }
  const last = ordered[ordered.length - 1];
  const lastBeat = last?.beats?.[last.beats.length - 1];
  if (!found.has('CP9') && last && lastBeat) {
    found.set('CP9', { id: 'CP9', zone: last.id, beat: lastBeat.id, label: `${last.title} — mission complete` });
  }
  return CHECKPOINT_ORDER.filter((id) => found.has(id)).map((id) => found.get(id)!);
}
