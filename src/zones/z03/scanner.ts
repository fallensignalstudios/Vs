/**
 * Z03 — the scan (SCRIPT_SOURCE Z03 `scan`; plan: two moving scan planes, cover occludes, one physical source).
 *
 * One Reformation projector on the service deck drives both planes (`ai.devices.scanPlane`, `source` = its lens):
 * a plane sees the lead only while she is inside its slab AND in clear sight of the lens, so solid cover between
 * her and the projector hides her. The projector is a real device actor (tagged device / objective / source):
 * the tactical read marks it, an Axiom shot or any blow destroys it, a close interaction powers it down — either
 * way both planes go dark. A detection fails nothing: the first one sets `z03Detected` (Z04 reads it) and speeds
 * the local pattern up; later ones only add tension.
 *
 * The trace — a directional line from a plane back to the lens — shows during the tactical read, and once
 * Tharne has named the source, whenever the lead has a valid angle on it (clear sight, close enough; the service
 * path gives that angle). The lesson: a good angle plus an interpretable trace, not scanning every wall.
 */
import * as THREE from 'three';
import type { Actor, Routine, ZoneRuntime } from '@/core/api';
import { asDevice, asScanHead } from '@/core/api';
import { wrapAngle, yawTo } from '@/core/mathx';
import { onZoneEvent, tutorialHint } from '../shared';
import {
  DETECTED_RATE, HINT_DELAY, PAST_X, PLANE_A, PLANE_B, PROGRESS_STEP, SOURCE_LENS, TRACE_RANGE_HIGH,
  TRACE_RANGE_LOW, type PlaneSpec,
} from './layout';
import { S, type PlaneState } from './state';

const SOURCE_ID = 'z03-source';
/** the projector's own numbers (a scan head: 60 hp, 20 poise) */
const SOURCE_HP = 60;
/** a sweep caption at most this often per plane, and only while the lead is near its stretch */
const CAPTION_GAP = 7;

const _lens = new THREE.Vector3();
const _chest = new THREE.Vector3();
const _c = new THREE.Vector3();
const _top = new THREE.Vector3();

/** world position of the projector's lens (the planes' source, the trace's end) */
export function lensPos(z: ZoneRuntime, out = new THREE.Vector3()): THREE.Vector3 {
  return out.copy(z.m('source')).setY(z.m('source').y + SOURCE_LENS);
}

/**
 * Spawn the projector and both planes (idempotent). `z03Detected` restores the faster pattern, `z03SourceDown`
 * the powered-down projector with dark planes — a checkpoint or debug entry lands in the state play left.
 */
export function setupScanner(z: ZoneRuntime): void {
  if (S.planes.length) return;
  const game = z.game;
  const lens = lensPos(z);
  const fast = z.flag('z03Detected') === true;
  const visual = game.chars.create('scanHead');
  const actor = game.actors.spawn({
    archetype: 'scanHead', name: 'Scan projector', team: 'reformation', // NEW (tactical-read label)
    pos: z.m('source'), yaw: z.myaw('source'), hp: SOURCE_HP, poise: 20, radius: 0.45, height: 2,
    visual, fixed: true, corpseSeconds: Infinity, dissolveOnDeath: false, material: 'metal',
    tags: ['device', 'objective', 'source', 'z03Source'],
  });
  S.source = actor;
  z.onDispose(() => {
    if (S.source === actor) S.source = null;
  });
  for (const spec of [PLANE_A, PLANE_B]) S.planes.push(makePlane(z, spec, lens, fast));
  onZoneEvent(z, 'actor:died', ({ actor: a, killer }) => {
    if (a === S.source) takeDownSource(z, killer, true);
  });
  S.sourceIx = z.interact({
    id: SOURCE_ID, at: z.m('source'), prompt: 'Power down the projector', hold: 1.2, radius: 2.3, markerRange: 6, // NEW
    enabled: () => !S.sourceDown,
    onDone: () => takeDownSource(z, game.player.actor, false),
  });
  if (z.flag('z03SourceDown') === true) quietDown(z);
}

function makePlane(z: ZoneRuntime, spec: PlaneSpec, lens: THREE.Vector3, fast: boolean): PlaneState {
  const st: PlaneState = { spec, handle: null, phase: spec.phase, rate: fast ? DETECTED_RATE : 1, trace: null, dir: 0, captionAt: -Infinity };
  st.handle = z.game.ai.devices.scanPlane({
    id: spec.id, from: z.P(spec.x0, spec.n, 0), to: z.P(spec.x1, spec.n, 0), width: spec.width, height: spec.height,
    period: spec.period, phase: spec.phase, source: lens.clone(), onDetect: () => onDetected(z),
  });
  if (fast) st.handle.setRate(DETECTED_RATE);
  return st;
}

/** a plane has seen the lead: the first time sets the flag Z04 reads and accelerates the local pattern */
function onDetected(z: ZoneRuntime): void {
  S.detections++;
  S.tension = 0.6;
  if (z.flag('z03Detected') === true) return;
  z.setFlag('z03Detected', true);
  for (const p of S.planes) {
    p.rate = DETECTED_RATE;
    p.handle?.setRate(DETECTED_RATE);
  }
}

/**
 * The projector goes down — destroyed (shot / struck) or powered down by hand. Both planes go dark and stay
 * dark; `device:disabled` pays the lead's Echo as any device does.
 */
export function takeDownSource(z: ZoneRuntime, by: Actor | null, destroyed: boolean): void {
  if (S.sourceDown) return;
  const game = z.game;
  const lens = lensPos(z, _lens);
  quietDown(z, destroyed);
  game.vfx.spawn('deviceBreak', lens, destroyed ? undefined : { scale: 0.6 });
  game.audio.play('emitterBreak', { pos: lens });
  game.events.emit('caption', { text: 'Scan projector down', kind: 'scan', pos: lens }); // NEW
  game.events.emit('device:disabled', { id: SOURCE_ID, kind: 'scanHead', by });
}

/** the end state of a takedown without presentation (restores, and the core of takeDownSource) */
function quietDown(z: ZoneRuntime, destroyed = false): void {
  S.sourceDown = true;
  z.setFlag('z03SourceDown', true);
  for (const p of S.planes) {
    p.handle?.setActive(false);
    p.trace?.setIntensity(0);
  }
  const a = S.source;
  if (a && !destroyed) {
    asDevice(a.visual)?.setDisabled(true);
    a.targetable = false;
    a.tags.delete('objective');
  }
  if (S.sourceIx) S.sourceIx.enabled = false;
  z.game.ui.marker(SOURCE_ID, null);
}

/** is a plane's stretch near the lead (for sweep captions)? */
function nearStretch(spec: PlaneSpec, x: number): boolean {
  return x > Math.min(spec.x0, spec.x1) - 7 && x < Math.max(spec.x0, spec.x1) + 4;
}

/**
 * ZoneDef.update: the zone's copy of each plane's phase (captions on a new pass, the trace's start), trace
 * visibility, and the projector's head following the plane nearest the lead. Allocation-free.
 */
export function updateScanner(z: ZoneRuntime, dt: number): void {
  if (!S.planes.length) return;
  const game = z.game;
  const player = game.player.actor;
  if (!player) return;
  const lens = lensPos(z, _lens);
  player.aimPoint(_chest);
  const dist = _chest.distanceTo(lens);
  const high = player.pos.y >= 1.2;
  const angle = (high ? dist <= TRACE_RANGE_HIGH : dist <= TRACE_RANGE_LOW) && game.physics.lineOfSight(_chest, lens) === true;
  const show = !S.sourceDown && (game.player.scanning === true || z.time < S.forceTraceUntil || (S.identified && angle));
  // further detections only add tension: the score lifts and settles again
  if (S.tension > 0) {
    S.tension = Math.max(0, S.tension - dt * 0.06);
    game.audio.setIntensity(S.tension);
  }
  let aim: PlaneState | null = null;
  let aimD = Infinity;
  for (const p of S.planes) {
    const active = !S.sourceDown && p.handle?.active === true;
    if (active) p.phase += (dt * p.rate) / p.spec.period;
    const centre = planeCentre(z, p, _c);
    // a new pass: the sweep announces itself (sound + caption) while the lead is near its stretch
    const dir = Math.sin(p.phase * Math.PI * 2) >= 0 ? 1 : -1;
    if (active && dir !== p.dir) {
      p.dir = dir;
      if (!z.skipping && nearStretch(p.spec, z.player.pos.x) && z.player.pos.x < PAST_X && z.time - p.captionAt >= CAPTION_GAP) {
        p.captionAt = z.time;
        game.audio.play('scanSweep', { pos: centre, volume: 0.55 });
        game.events.emit('caption', { text: 'Scan plane sweeping', kind: 'scan', pos: centre }); // NEW
      }
    }
    // the trace: from the plane's upper edge back to the lens
    _top.copy(centre).setY(centre.y + Math.min(p.spec.height, 3.2) * 0.8);
    if (show && active) {
      if (!p.trace || !p.trace.alive) p.trace = game.vfx.beam(_top.clone(), lens.clone(), 'trace');
      p.trace.setEnds(_top, lens);
      p.trace.setIntensity(1);
    } else if (p.trace?.alive) {
      p.trace.setIntensity(0);
    }
    if (active) {
      const d = Math.abs(centre.x - z.player.pos.x);
      if (d < aimD) {
        aimD = d;
        aim = p;
      }
    }
  }
  // the head follows the plane nearest the lead (a physical link the player can read without any overlay)
  const head = asScanHead(S.source?.visual);
  if (head && aim && S.source?.alive) {
    const c = planeCentre(z, aim, _c);
    head.setSweep(Math.max(-1.1, Math.min(1.1, wrapAngle(yawTo(lens.x, lens.z, c.x, c.z) - S.source.yaw))));
  }
}

/** centre of a plane on the floor: the AI's own value when it exposes one, else the zone's copy of its phase */
function planeCentre(z: ZoneRuntime, p: PlaneState, out: THREE.Vector3): THREE.Vector3 {
  const own = (p.handle as unknown as { center?: unknown } | null)?.center;
  if (own instanceof THREE.Vector3) return out.copy(own);
  const t = 0.5 - 0.5 * Math.cos(p.phase * Math.PI * 2);
  const s = p.spec;
  return out.copy(z.P(s.x0 + (s.x1 - s.x0) * t, s.n, 0));
}

/** distance band for Tharne's report (the line is fixed text: one of four) */
function reportLine(dist: number): string {
  if (dist < 15) return 'One projector drives both. East, service deck, ten meters.'; // NEW
  if (dist < 25) return 'One projector drives both. East, service deck, twenty meters.'; // NEW
  if (dist < 35) return 'One projector drives both. East, service deck, thirty meters.'; // NEW
  return 'One projector drives both. East, service deck, forty meters.'; // NEW
}

/**
 * The play of the `scan` beat (after its establishing scene): objective, hints in plan order, Tharne's reports.
 * Returns once the lead is past both planes. Every line here is information the player can use.
 */
export function* scanPlay(z: ZoneRuntime): Routine {
  const game = z.game;
  const tharne = z.cast('tharne');
  setupScanner(z);
  if (S.sourceDown) z.objective('Reach the sensor terminal', 'terminal'); // NEW
  else z.objective('Pass the scan planes', 'past'); // NEW
  game.audio.setMusic('stealth', 2.5);
  tutorialHint(z, 'z03Sweep', 'A scan plane sees you only along a clear line from its source. Stand behind tall cover as one passes.', undefined, 9); // NEW
  let best = z.player.pos.x;
  let lastProgress = z.time;
  let firstSeenAt = -1;
  let reported = false;
  let downCalled = S.sourceDown;
  while (z.player.pos.x < PAST_X) {
    if (z.player.pos.x > best + PROGRESS_STEP) {
      best = z.player.pos.x;
      lastProgress = z.time;
    }
    if (S.detections > 0 && firstSeenAt < 0) firstSeenAt = z.time;
    if (!reported && S.detections > 0) {
      // first detection: what changed — nothing has failed
      reported = true;
      z.bark('Tharne', 'Sweep interval down. Two units ahead are tracking us now.', { actor: tharne }); // NEW
    }
    if (!downCalled && S.sourceDown) {
      downCalled = true;
      z.bark('Tharne', 'Source down.', { actor: tharne }); // NEW
      z.objective('Reach the sensor terminal', 'terminal'); // NEW
    }
    // the assisted hint: ~25 s without progress, or shortly after the first detection
    const stalled = z.time - lastProgress >= HINT_DELAY;
    const afterSeen = firstSeenAt >= 0 && z.time - firstSeenAt >= 3.5;
    if (!S.identified && !S.sourceDown && (stalled || afterSeen)) {
      S.identified = true;
      z.fork(identify(z), 'z03-identify');
    }
    yield 0.2;
  }
  if (!downCalled && S.sourceDown) z.bark('Tharne', 'Source down.', { actor: tharne }); // NEW
}

/** Tharne names the source: bearing and distance; the trace shows (briefly forced, as on his viewmaker) */
function* identify(z: ZoneRuntime): Routine {
  const game = z.game;
  const tharne = z.cast('tharne');
  const lyric = z.cast('lyric');
  const lens = lensPos(z, new THREE.Vector3());
  yield* z.say('Tharne', reportLine(z.player.aimPoint(_chest).distanceTo(lens)), { actor: tharne });
  yield* z.say('Selene', 'Show me.', { actor: z.player }); // NEW (one of her two-word replies)
  if (S.sourceDown) return;
  // he marks it on his viewmaker: the traces show for a few seconds wherever she stands
  S.forceTraceUntil = z.time + 4.5;
  game.ui.marker(SOURCE_ID, lens, { label: 'Source', kind: 'threat', hideWithin: 3 }); // NEW
  tutorialHint(z, 'z03Trace', 'The trace runs from a plane back to its source. A clear angle shows it; so does the tactical read.', 'scan', 9); // NEW
  z.bark('Lyric', 'You could simply have said it was over there.', { actor: lyric }); // NEW (she needles him once)
  yield 9;
  if (!S.sourceDown && z.player.pos.x < PAST_X) {
    tutorialHint(z, 'z03Disable', 'Disable the source by hand or with a shot — or pass on timing.', 'interact', 9); // NEW
  }
}
