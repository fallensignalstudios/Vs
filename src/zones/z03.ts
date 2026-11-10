/**
 * Z03 · Frozen sensor access — lead: Selene; Tharne and Lyric follow (Lyric carries the sealed case).
 *
 *   layout (./z03/layout.ts) → build (./z03/space.ts) → cast → beats → ZoneDef
 *
 * SPACE (plan coordinates, origin at the south-west corner, x east, n north): a 48 × 22 m corridor of translucent
 * frozen atmosphere under an enclosed white-gold vault, 0 → +3 m. The Reformation dropship lies lodged among
 * ribs in the west bay; the three step out of its rear hatch at x ≈ 3. Two scan planes sweep the corridor at
 * offset intervals (A: the lower floor, x 8 ↔ 20; B: the full width and the deck, x 19 ↔ 31). The upper service
 * path along the south wall (ramp x 6 → 18, deck to x 36, ramp down to x 46) is the angle on the one physical
 * source both planes come from — a projector on the deck at x 33.6. Past the planes: the deployed Reformation
 * sensor installation (terminal, reconstruction hologram) and the exit in the east wall, to Z04.
 *
 * SCRIPT: SCRIPT_SOURCE.md § Z03 (the author's ruling 21: the hatch plays exactly as the book writes it). The
 * author's lines are exact (curly apostrophes are the book's); every line and UI string written for the game is
 * tagged `// NEW`. A scan failure sets `z03Detected` (Z04 reads it); nothing here fails the mission.
 *
 * FILES: ./z03/layout.ts (numbers), ./z03/space.ts (build), ./z03/scanner.ts (planes, projector, trace, the
 * scan's play), ./z03/scenes.ts (the three scenes and per-frame animation), ./z03/state.ts (per-load state).
 */
import type { Beat, Routine, ZoneBuilder, ZoneDef, ZoneRuntime } from '@/core/api';
import { setDoor, standardExit, waitOr } from './shared';
import { PAST_X, TERMINAL } from './z03/layout';
import { scanPlay, setupScanner, updateScanner } from './z03/scanner';
import { LYRIC_MARKS, arrivalScene, arrivedState, placeAtStart, scanScene, terminalScene, updateScenes } from './z03/scenes';
import { buildSpace } from './z03/space';
import { S, resetState } from './z03/state';

// =====================================================================================================================
// Build
// =====================================================================================================================

function build(b: ZoneBuilder): void {
  resetState();
  buildSpace(b);
  b.finalize();
}

// =====================================================================================================================
// Cast
// =====================================================================================================================

type Stage = 'arrival' | 'scan' | 'terminal' | 'read';

/**
 * Spawn the lead and the two who follow her as the given stage finds them. Called from every beat's `enter` —
 * the world a checkpoint reload or a debug jump lands in must equal the one the earlier beats leave behind.
 */
function spawnCast(z: ZoneRuntime, stage: Stage): void {
  const at: Record<Stage, [string, string, string]> = {
    arrival: ['seleneHatch', 'tharneHatch', 'lyricHatch'],
    scan: ['start', 'tharneStart', 'lyricStart'],
    terminal: ['terminalStart', 'tharneT0', 'lyricT0'],
    read: ['terminal', 'tharneTerm', 'lyricTerm'],
  };
  const [s, t, l] = at[stage];
  z.spawnPlayer('selene', s);
  const tharne = z.companion('tharne', t, stage === 'arrival' ? 'scripted' : 'follow');
  const lyric = z.companion('lyric', l, stage === 'arrival' ? 'scripted' : 'follow');
  // they are never scanned and never targeted
  for (const c of [tharne, lyric]) c.actor.protectedNpc = true;
  lyric.actor.visual?.setCorruption(LYRIC_MARKS.arrive);
  setupScanner(z);
  if (stage !== 'arrival') arrivedState();
}

// =====================================================================================================================
// Beats
// =====================================================================================================================

/** `arrival` → CP2. The hatch scene; then into the corridor (Tharne remarks on the frost, nothing more). */
function* arrival(z: ZoneRuntime): Routine {
  const tharne = z.cast('tharne');
  yield* arrivalScene(z);
  z.objective('Cross the frozen corridor', 'scanStart'); // NEW
  const start = z.m('start');
  yield waitOr(z, () => Math.hypot(z.player.pos.x - start.x, z.player.pos.z - start.z) > 1.4, 5);
  z.bark('Tharne', 'Residual atmosphere. Crystallized long before we arrived.', { actor: tharne }); // NEW
  yield z.until(() => z.player.pos.x >= z.m('scanStart').x - 0.4);
}

/** `scan`. The planes announce themselves; pass them on timing, or find the angle on their source. */
function* scan(z: ZoneRuntime): Routine {
  setupScanner(z);
  if (z.player.pos.x < PAST_X) yield* scanScene(z);
  yield* scanPlay(z);
}

/** `terminalRead` (≈ 2 min). Read the deployed sensor terminal; Sol on the channel; then on to Z04. */
function* terminalRead(z: ZoneRuntime): Routine {
  const game = z.game;
  setupScanner(z);
  if (z.flag('z03TerminalRead') !== true) {
    z.objective('Read the terminal', 'terminal'); // NEW
    const ix = z.interact({
      id: 'z03-terminal', at: z.P(TERMINAL[0] - 0.7, TERMINAL[1], 0), prompt: 'Read the terminal', hold: 0.6, // NEW
      radius: 2.4, required: true,
    });
    S.terminalIx = ix;
    yield z.untilInteract(ix);
    z.objective(null);
    yield* terminalScene(z);
    game.audio.setMusic('approachSelene', 3);
  } else {
    setDoor(S.exit, false, 'ready');
  }
  yield* standardExit(z, S.exit, 'Z04', { at: 'exit' });
}

const beats: Beat[] = [
  { id: 'arrival', checkpoint: 'CP2', enter: (z) => spawnCast(z, 'arrival'), run: arrival },
  {
    id: 'scan',
    enter: (z) => {
      spawnCast(z, 'scan');
      placeAtStart(z, z.cast('tharne'), z.cast('lyric'));
    },
    run: scan,
  },
  { id: 'terminalRead', enter: (z) => spawnCast(z, z.flag('z03TerminalRead') === true ? 'read' : 'terminal'), run: terminalRead },
];

// =====================================================================================================================
// Zone definition
// =====================================================================================================================

const Z03_DEF: ZoneDef = {
  id: 'Z03',
  title: 'Frozen Sensor Access',
  art: 'relay-route',
  cast: ['scanHead', 'tharne', 'lyric'],
  build,
  beats,
  /** per-frame zone animation on the sim clock: the planes' traces and captions, the hatch, the tether, the stir */
  update(z: ZoneRuntime, dt: number): void {
    updateScanner(z, dt);
    updateScenes(z, dt);
  },
  dispose() {
    resetState();
  },
};

export default Z03_DEF;
