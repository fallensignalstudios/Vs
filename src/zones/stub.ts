/**
 * Pass-through STUB zones. Until a zone author replaces `zNN.ts`, each zone is a small kit-built room that keeps
 * the fixed cross-zone contract (tasks/ZONES.md): the right lead and cast on entry, the beat ids, the checkpoints
 * on the right beats, the authored handoffs, both recorded choices and the fixed story flags — so the mission is
 * traversable end to end, saves resume correctly, and `__aurelion.runTo()` reaches CP9.
 *
 * A stub beat does nothing but apply its state and pass on; the last beat asks the player to walk to the lit
 * doorway. No dialogue is played here: the script belongs to the real zones.
 */
import type {
  Beat, CheckpointId, ChoiceOpts, CompanionMode, HumanoidArchetype, ProtagonistId, Routine, StoryFlag, ZoneBuilder,
  ZoneDef, ZoneEnvOpts, ZoneId, ZoneRuntime,
} from '@/core/api';
import { hallShell, standardExit, type HallShell } from './shared';

export interface StubBeat {
  id: string;
  checkpoint?: CheckpointId;
  /** authored handoff performed inside this beat */
  handoffTo?: ProtagonistId;
  /** fixed story flags this beat sets */
  story?: StoryFlag[];
  /** recorded choice presented in this beat: 'priority' (Z07) or 'officer' (Z08) */
  choice?: 'priority' | 'officer';
}

export interface StubZoneCfg {
  id: ZoneId;
  title: string;
  /** who the zone is entered as */
  lead: ProtagonistId;
  /** companions present on entry (the other lead included where the table lists them) */
  cast: Array<{ who: HumanoidArchetype; mode?: CompanionMode }>;
  beats: StubBeat[];
  /** next zone; null = the mission ends here (Z12) */
  next: ZoneId | null;
  env: ZoneEnvOpts;
  art?: ZoneDef['art'];
  /** lower-terminal black stone room */
  blackStone?: boolean;
}

/** stub room: 12 m wide (x) × 16 m long (n), walked south → north */
const ROOM_W = 12;
const ROOM_D = 16;
/** companions fan out around the lead: [east, north] offsets from the start marker */
const CAST_SLOTS: ReadonlyArray<[number, number]> = [
  [-1.6, 0.4], [1.6, 0.4], [-3, 1.2], [3, 1.2], [-1.2, 2.2], [1.2, 2.2], [-4.2, 2.4], [4.2, 2.4], [-2.6, 3.4], [2.6, 3.4],
];

/** The Z07 local priority (plan wording; the real Z07 owns the final text). */
export const PRIORITY_CHOICE: ChoiceOpts = {
  id: 'rescuePriority',
  title: 'Local priority',
  prompt: 'One recess can be held first.',
  options: [
    { id: 'WestStretchers', tag: 'WEST', label: 'Stretcher cases first', detail: 'The west recess is held first.' },
    { id: 'EastWalkers', tag: 'EAST', label: 'Walking wounded first', detail: 'The east recess is held first.' },
  ],
  note: 'This choice is explicit and untimed.',
};

/** The Z08 officer (author's ruling 9; the real Z08 owns the final text). */
export const OFFICER_CHOICE: ChoiceOpts = {
  id: 'officerFate',
  title: 'The officer',
  prompt: '“Kill me.”',
  options: [
    { id: 'killed', tag: 'KILL', label: 'Do as he asks', detail: 'End it now.' },
    { id: 'spared', tag: 'SPARE', label: 'Do not', detail: 'Leave him held as he is.' },
  ],
  note: 'This choice is explicit and untimed.',
};

/** who leads at the START of beat `index` (handoffs of earlier beats applied) */
function leadAt(cfg: StubZoneCfg, index: number): ProtagonistId {
  let lead = cfg.lead;
  for (let i = 0; i < index; i++) lead = cfg.beats[i].handoffTo ?? lead;
  return lead;
}

function buildRoom(b: ZoneBuilder, cfg: StubZoneCfg): HallShell {
  b.setEnv(cfg.env);
  const shell = hallShell(b, {
    w: ROOM_W, d: ROOM_D, axis: 'n', height: 7, ribHeight: 9, ribs: 2, entryAt: ROOM_W / 2,
    exitAt: cfg.next ? ROOM_W / 2 : undefined, mat: cfg.blackStone ? 'blackStone' : undefined, ceiling: 'flat',
    inlay: 'channels', reflective: false,
  });
  b.point({ x: ROOM_W / 2, n: ROOM_D / 2, h: 5, color: 0xffe2a8, intensity: cfg.blackStone ? 60 : 30, distance: 22 });
  b.marker('start', ROOM_W / 2, 2.6, 0, 0);
  b.marker('exit', ROOM_W / 2, ROOM_D - 1.8, 0, 0);
  CAST_SLOTS.forEach(([dx, dn], i) => b.marker(`cast${i}`, ROOM_W / 2 + dx, 2.6 + dn, 0, 0));
  b.finalize();
  return shell;
}

function enter(z: ZoneRuntime, cfg: StubZoneCfg, index: number): void {
  const lead = leadAt(cfg, index);
  z.spawnPlayer(lead, 'start');
  const seen = new Map<string, number>();
  cfg.cast.forEach((c, slot) => {
    // after a handoff the new lead's companion body has become the player: the old lead stands in its place
    const who = c.who === lead ? cfg.lead : c.who;
    const n = seen.get(who) ?? 0;
    seen.set(who, n + 1);
    // the first of each archetype keeps its plain cast name (`z.cast('selene')`, which `z.handoff` looks up)
    z.companion(who, `cast${slot % CAST_SLOTS.length}`, c.mode ?? 'follow', n === 0 ? undefined : `${who}${n + 1}`);
  });
  // fixed story flags of the beats before this one
  for (let i = 0; i < index; i++) for (const f of cfg.beats[i].story ?? []) z.story(f);
}

function* runBeat(z: ZoneRuntime, cfg: StubZoneCfg, shell: () => HallShell | null, index: number): Routine {
  const beat = cfg.beats[index];
  yield 0.5;
  if (beat.handoffTo) yield* z.handoff(beat.handoffTo, { seconds: 2 });
  for (const f of beat.story ?? []) z.story(f);
  if (beat.choice === 'priority') {
    const pick = yield* z.choice(PRIORITY_CHOICE);
    z.commitRescuePriority(pick === 'EastWalkers' ? 'EastWalkers' : 'WestStretchers');
  } else if (beat.choice === 'officer') {
    const pick = yield* z.choice(OFFICER_CHOICE);
    z.setFlag('officerFate', pick === 'spared' ? 'spared' : 'killed');
    if (beat.checkpoint) z.checkpoint(beat.checkpoint); // saved again after the commit
  }
  if (index < cfg.beats.length - 1) return;
  if (cfg.next) {
    yield* standardExit(z, shell()?.exit ?? null, cfg.next, { at: 'exit' });
  } else {
    z.objective('Board', 'exit'); // NEW (stub text)
    yield z.untilNear('exit', 2.4);
    yield* z.completeMission();
  }
}

/** Build a pass-through ZoneDef from the contract table. */
export function stubZone(cfg: StubZoneCfg): ZoneDef {
  let shell: HallShell | null = null;
  const beats: Beat[] = cfg.beats.map((sb, i) => ({
    id: sb.id,
    checkpoint: sb.checkpoint,
    // every beat can be entered directly (checkpoint resume, debug goto)
    enter: (z: ZoneRuntime) => enter(z, cfg, i),
    run: (z: ZoneRuntime) => runBeat(z, cfg, () => shell, i),
  }));
  return {
    id: cfg.id,
    title: cfg.title,
    art: cfg.art,
    cast: cfg.cast.map((c) => c.who),
    build(b) {
      shell = buildRoom(b, cfg);
    },
    beats,
    dispose() {
      shell = null;
    },
  };
}
