/**
 * Z09 · Wound gallery — lead: Tarrik; Selene walks with him. No combat, no one else (SCRIPT_SOURCE Z09).
 *
 *   constants → build (space, far field, flow lines) → cast → beats → ZoneDef
 *
 * SPACE (plan coordinates, origin at the south-west corner, x east, n north; detail in ./z09/space.ts): a 55 × 16 m
 * shallow descending curve. A sealed white-gold corridor runs east, bends 15° north down a 12 m ramp into black
 * stone (h 0 → −3), and only after the bend opens north onto a circular overlook behind a stone parapet: one arm of
 * a city-scale Crownmark runs out beneath it toward the Wound, which fills half the horizon (red remnant left,
 * white remnant right). The route goes on east to the five-depression threshold and a seamless door in the east
 * wall, framed by the white point. Exit → Z10.
 *
 * BEATS: `descent` → CP6 (silent: the war is far away; the gold lines ignite and flow down the passage),
 * `overlook` (the reveal, three lines), `recognition` (the terminal's three lines, the “Contrary.” exchange, both
 * relics rise, the door opens by itself; she goes through first).
 *
 * SCRIPT: SCRIPT_SOURCE.md § Z09. The author's lines are exact; lines marked *(ext — trimmed)* are not played.
 * HUD (Z09): nothing is taught; the objective is the white point at the door — no hint, prompt or caption names the
 * Wound or says what the door will do. Every new UI string carries `// NEW`.
 */
import type { Beat, Look, Routine, ZoneBuilder, ZoneDef, ZoneRuntime } from '@/core/api';
import { LOOKS } from '@/render/looks';
import { setDoor, standardExit, walkTo } from './shared';
import { blankRelics, disposeRelics, ensureRelics, overlookScene, recognitionScene, updateRelics, type Relics } from './z09/scenes';
import { OVERLOOK, buildFlow, buildScenic, buildSpace, updateFlow, wetFloors, type FlowLines, type Z09Space } from './z09/space';

// =====================================================================================================================
// Constants
// =====================================================================================================================

/** the gold lines ignite from the sealed door forward at this speed (m/s) */
const FLOW_SPEED = 7;
/** seconds between the tremors that pass through the structure (the first comes sooner) */
const TREMOR_EVERY = 11;
/**
 * The gallery's grade: LOOKS.woundGallery without its blue cast (polish 4) — the wound-overlook painting's stone is a
 * neutral dark grey with warm gold highlights; the cold belongs to the sky, not to the floor and the walls.
 */
const Z09_LOOK: Look = {
  ...LOOKS.woundGallery,
  grade: { ...LOOKS.woundGallery.grade, tint: 0xf3f2f1, shadowsTint: 0xc2c5cf },
  ambient: { ...LOOKS.woundGallery.ambient, sky: 0x4c4d56, intensity: 0.34 },
};
/** the overlook scene starts when the lead steps onto the apron past the bend */
const OVERLOOK_TRIGGER = { x: OVERLOOK.x - 4, n: 7, w: 9, d: 12 } as const;

// =====================================================================================================================
// Per-load state
// =====================================================================================================================

interface Z09 {
  space: Z09Space | null;
  flow: FlowLines | null;
  /** metres of the route the gold lines have reached */
  front: number;
  relics: Relics;
  recognized: boolean;
}
let S: Z09 = blank();
function blank(): Z09 {
  return { space: null, flow: null, front: 0, relics: blankRelics(), recognized: false };
}

// =====================================================================================================================
// Build
// =====================================================================================================================

function build(b: ZoneBuilder): void {
  S = blank();
  b.game.sky.reset();
  b.game.sky.setHeading(0); // the overlook faces north: the Wound over the rail, red left, white right
  b.setEnv({
    sky: 'woundVista', look: Z09_LOOK, ambience: 'woundGallery', music: 'quarantine',
    // steep, from the white remnant's side (north-east): the mirror floor keeps the glint out of the usual view
    key: { dirFrom: [26, 30, 46], intensity: 1.35, color: 0xe6ecff },
  });
  S.space = buildSpace(b);
  S.flow = buildFlow(b);
  buildScenic(b);
  b.finalize();
  // polish 4: the black walk mirrors like the painting's wet marble
  wetFloors(b, 3, 0.08);
}

// =====================================================================================================================
// Cast
// =====================================================================================================================

type Stage = 'start' | 'overlook' | 'recognition';

/** the two of them, as the given stage finds them; the door and the threshold as the earlier beats leave them */
function spawnCast(z: ZoneRuntime, stage: Stage): void {
  const at = stage === 'start' ? 'start' : stage === 'overlook' ? 'overlookEnter' : 'recogEnter';
  const sel = stage === 'start' ? 'seleneStart' : stage === 'overlook' ? 'seleneOverlookEnter' : 'seleneRecogEnter';
  z.spawnPlayer('tarrik', at);
  const selene = z.companion('selene', sel, 'follow');
  // “Her weapon collapsed in her hand, inactive but ready.” — nothing drawn (the loadout), and Verity's hilt held low
  // at her hip with the blades in: a scripted hold (polish 4) that her follow mode, the scenes' stopAction() and her
  // lines keep; set on every entry (skip-safe)
  selene.actor.visual?.setLoadout({ melee: false, ranged: false });
  selene.play('verityCollapsed', { persist: true });
  setDoor(S.space?.entry ?? null, false, 'sealed');
  setDoor(S.space?.door ?? null, false, 'locked');
  // the lines have already run their length when a later beat is entered directly
  S.front = stage === 'start' ? 0 : 1e4;
  ensureRelics(z, S.relics);
  z.game.audio.setMuffle(0.15, 0.5);
  // after the reveal the overlook's score carries on (`recognition` switches it when the terminal answers)
  if (stage !== 'start') z.game.audio.setMusic('woundVista', 0.5);
}

// =====================================================================================================================
// Beats
// =====================================================================================================================

/** `descent` → CP6. No dialogue. “The sound of war vanishes.” The two walk down into black stone. */
function* descent(z: ZoneRuntime): Routine {
  z.objective('Reach the lit doorway', 'thresholdApproach'); // NEW (Z01's wording)
  z.fork(tremors(z), 'tremors');
  const r = OVERLOOK_TRIGGER;
  yield z.untilInRect(r.x, r.n, r.w, r.d);
}

/** “Every few seconds, a tremor passes through the ancient structure” — a low groan and a faint shake */
function* tremors(z: ZoneRuntime): Routine {
  yield 6;
  for (;;) {
    if (!z.skipping && !z.game.mission.cinematicActive) {
      z.game.camera.shake(0.16, 1.1);
      z.game.audio.play('structuralGroan', { volume: 0.5 });
    }
    yield TREMOR_EVERY;
  }
}

/** `overlook`. The reveal, three lines, then the white point at the far end. */
function* overlook(z: ZoneRuntime): Routine {
  yield* overlookScene(z);
  z.objective('Reach the lit doorway', 'thresholdApproach'); // NEW
  yield z.untilNear('thresholdApproach', 2.4);
}

/** `recognition`. The terminal recognises them as contrary witnesses; the door opens by itself; she goes first. */
function* recognition(z: ZoneRuntime): Routine {
  z.objective(null);
  ensureRelics(z, S.relics);
  yield* recognitionScene(z, {
    relics: S.relics,
    recognize: () => {
      S.recognized = true;
      if (S.space?.threshold) S.space.threshold.params.recognized = 1;
    },
    openDoor: () => {
      const door = S.space?.door ?? null;
      door?.setState('open');
      if (door) z.openDoor(door, true);
    },
  });
  // end state of the scene (also when it was skipped): threshold lit, door open
  if (S.space?.threshold) {
    S.space.threshold.params.recognized = 1;
    S.space.threshold.snap();
  }
  // she has gone through first; she keeps going and the lead follows her
  walkTo(z, z.cast('selene'), 'seleneBeyond');
  yield* standardExit(z, S.space?.door ?? null, 'Z10', { at: 'exit', objective: 'Follow Selene', radius: 1.8 }); // NEW
}

// =====================================================================================================================
// Zone definition
// =====================================================================================================================

const beats: Beat[] = [
  { id: 'descent', checkpoint: 'CP6', enter: (z) => spawnCast(z, 'start'), run: descent },
  { id: 'overlook', enter: (z) => spawnCast(z, 'overlook'), run: overlook },
  {
    id: 'recognition',
    enter: (z) => {
      spawnCast(z, 'recognition');
    },
    run: recognition,
  },
];

const Z09_DEF: ZoneDef = {
  id: 'Z09',
  title: 'Wound Gallery',
  art: 'wound-overlook',
  build,
  beats,
  /** the gold lines and the relics, on the sim clock (a skip snaps them) */
  update(z: ZoneRuntime, dt: number) {
    if (S.flow) {
      S.front = Math.min(S.flow.length + 3, S.front + dt * FLOW_SPEED);
      updateFlow(S.flow, S.front, z.time);
    }
    updateRelics(z, S.relics, dt);
  },
  dispose() {
    disposeRelics(S.relics);
    S.flow?.mesh.geometry.dispose();
    S.flow?.material.dispose();
    S = blank();
  },
};

export default Z09_DEF;
