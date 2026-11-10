/**
 * Mission state + persistence. Pure data helpers (no Game dependency) so they can be unit-tested in node.
 *
 * Storage layout (`localStorage['aurelion.save.v1']`):
 *   { v: 1, current: 'CP4', snapshots: { CP0: MissionState, CP1: MissionState, … } }
 * Every checkpoint keeps the snapshot that was taken when it was saved, so reloading restores exactly that
 * state (a retry can neither duplicate records nor flip the committed choice). Anything that fails validation
 * is discarded — a corrupt save can never reach gameplay code.
 */
import type { CheckpointId, Difficulty, MissionState, RescuePriority, ZoneId } from '@/core/api';

export const SAVE_KEY = 'aurelion.save.v1';
export const SAVE_VERSION = 1;

export const CHECKPOINT_ORDER: readonly CheckpointId[] = [
  'CP0', 'CP1', 'CP2', 'CP2b', 'CP3', 'CP4', 'CP4b', 'CP5', 'CP5b', 'CP6', 'CP7', 'CP8', 'CP9',
];
const DIFFICULTIES: readonly Difficulty[] = ['story', 'standard', 'hard'];
const PRIORITIES: readonly RescuePriority[] = ['pending', 'WestStretchers', 'EastWalkers'];
const OPTIONAL_IDS = ['O1', 'O2', 'O3', 'O4'] as const;

export interface SaveFile {
  v: number;
  current: CheckpointId;
  snapshots: Partial<Record<CheckpointId, MissionState>>;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Fresh campaign state. */
export function createMissionState(difficulty: Difficulty = 'standard', zone: ZoneId = 'Z00', beat = ''): MissionState {
  return {
    version: SAVE_VERSION,
    checkpoint: 'CP0',
    zone,
    beat,
    difficulty: DIFFICULTIES.includes(difficulty) ? difficulty : 'standard',
    rescuePriority: 'pending',
    flags: {},
    optional: { O1: false, O2: false, O3: false, O4: false },
    stats: { playSeconds: 0, deaths: 0, zoneSeconds: {}, retries: {} },
  };
}

/** Deep copy (the state is plain JSON-safe data). */
export function cloneState(s: MissionState): MissionState {
  return {
    version: s.version,
    checkpoint: s.checkpoint,
    zone: s.zone,
    beat: s.beat,
    difficulty: s.difficulty,
    rescuePriority: s.rescuePriority,
    flags: { ...s.flags },
    optional: { ...s.optional },
    stats: {
      playSeconds: s.stats.playSeconds,
      deaths: s.stats.deaths,
      zoneSeconds: { ...s.stats.zoneSeconds },
      retries: { ...s.stats.retries },
    },
  };
}

/** Copy `src` into `target` in place — the live `mission.state` object keeps its identity for its whole life. */
export function assignState(target: MissionState, src: MissionState): MissionState {
  const c = cloneState(src);
  target.version = c.version;
  target.checkpoint = c.checkpoint;
  target.zone = c.zone;
  target.beat = c.beat;
  target.difficulty = c.difficulty;
  target.rescuePriority = c.rescuePriority;
  target.flags = c.flags;
  target.optional = c.optional;
  target.stats = c.stats;
  return target;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

function numberRecord(v: unknown): Record<string, number> | null {
  if (!isObj(v)) return null;
  const out: Record<string, number> = {};
  for (const [k, raw] of Object.entries(v)) {
    const n = num(raw);
    if (n !== null) out[k] = n;
  }
  return out;
}

/**
 * Validate + sanitise untrusted data into a MissionState. Returns null when the structure is not a state of
 * this version (wrong types, unknown checkpoint, bad enum values); unknown extra keys are dropped and flag
 * values that are not primitives are removed.
 */
export function validateState(raw: unknown): MissionState | null {
  if (!isObj(raw)) return null;
  if (raw.version !== SAVE_VERSION) return null;
  if (typeof raw.checkpoint !== 'string' || !CHECKPOINT_ORDER.includes(raw.checkpoint as CheckpointId)) return null;
  if (typeof raw.zone !== 'string' || raw.zone.length === 0 || raw.zone.length > 16) return null;
  if (typeof raw.beat !== 'string' || raw.beat.length > 64) return null;
  if (typeof raw.difficulty !== 'string' || !DIFFICULTIES.includes(raw.difficulty as Difficulty)) return null;
  if (typeof raw.rescuePriority !== 'string' || !PRIORITIES.includes(raw.rescuePriority as RescuePriority)) return null;
  if (!isObj(raw.flags) || !isObj(raw.optional) || !isObj(raw.stats)) return null;

  const flags: MissionState['flags'] = {};
  for (const [k, v] of Object.entries(raw.flags)) {
    if (typeof v === 'boolean' || typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v))) flags[k] = v;
  }
  const optional = { O1: false, O2: false, O3: false, O4: false };
  for (const id of OPTIONAL_IDS) {
    if (typeof raw.optional[id] !== 'boolean') return null;
    optional[id] = raw.optional[id] as boolean;
  }
  const playSeconds = num(raw.stats.playSeconds);
  const deaths = num(raw.stats.deaths);
  const zoneSeconds = numberRecord(raw.stats.zoneSeconds);
  const retries = numberRecord(raw.stats.retries);
  if (playSeconds === null || deaths === null || !zoneSeconds || !retries) return null;

  return {
    version: SAVE_VERSION,
    checkpoint: raw.checkpoint as CheckpointId,
    zone: raw.zone as ZoneId,
    beat: raw.beat,
    difficulty: raw.difficulty as Difficulty,
    rescuePriority: raw.rescuePriority as RescuePriority,
    flags,
    optional,
    stats: { playSeconds, deaths: Math.floor(deaths), zoneSeconds, retries },
  };
}

/** Validate a whole save file; null when unusable. Invalid individual snapshots are dropped. */
export function validateSaveFile(raw: unknown): SaveFile | null {
  if (!isObj(raw) || raw.v !== SAVE_VERSION) return null;
  if (typeof raw.current !== 'string' || !CHECKPOINT_ORDER.includes(raw.current as CheckpointId)) return null;
  if (!isObj(raw.snapshots)) return null;
  const snapshots: SaveFile['snapshots'] = {};
  for (const id of CHECKPOINT_ORDER) {
    const s = validateState(raw.snapshots[id]);
    if (s && s.checkpoint === id) snapshots[id] = s;
  }
  const current = raw.current as CheckpointId;
  if (!snapshots[current]) return null;
  return { v: SAVE_VERSION, current, snapshots };
}

function defaultStorage(): StorageLike | null {
  try {
    const s = (globalThis as { localStorage?: StorageLike }).localStorage;
    return s && typeof s.getItem === 'function' ? s : null;
  } catch {
    return null;
  }
}

/**
 * Save file access. Keeps a validated in-memory copy as the source of truth for the session, so checkpoint
 * reloads keep working when storage is unavailable (sandboxed frame, quota, private mode).
 */
export class SaveStore {
  private readonly storage: StorageLike | null;
  private memory: SaveFile | null = null;
  private loaded = false;

  constructor(storage?: StorageLike | null) {
    this.storage = storage === undefined ? defaultStorage() : storage;
  }

  /** The current save, or null. Corrupt stored data is removed. */
  read(): SaveFile | null {
    if (this.loaded) return this.memory;
    this.loaded = true;
    if (!this.storage) return this.memory;
    try {
      const text = this.storage.getItem(SAVE_KEY);
      if (!text) return null;
      const file = validateSaveFile(JSON.parse(text));
      if (!file) {
        console.warn('[mission] save data failed validation — discarded');
        this.storage.removeItem(SAVE_KEY);
        return null;
      }
      this.memory = file;
    } catch {
      console.warn('[mission] save data unreadable — discarded');
      try {
        this.storage.removeItem(SAVE_KEY);
      } catch {
        /* storage unavailable */
      }
    }
    return this.memory;
  }

  /** Store `state` as the snapshot of checkpoint `id` and make it current. Returns false if persisting failed. */
  put(id: CheckpointId, state: MissionState): boolean {
    const file = this.read() ?? { v: SAVE_VERSION, current: id, snapshots: {} };
    file.current = id;
    file.snapshots[id] = cloneState(state);
    this.memory = file;
    return this.persist();
  }

  private persist(): boolean {
    if (!this.storage || !this.memory) return false;
    try {
      this.storage.setItem(SAVE_KEY, JSON.stringify(this.memory));
      return true;
    } catch {
      return false;
    }
  }

  clear(): void {
    this.memory = null;
    this.loaded = true;
    try {
      this.storage?.removeItem(SAVE_KEY);
    } catch {
      /* storage unavailable */
    }
  }
}
