/**
 * Z04 — Encounter E2: four Dominion Enforcers holding an overlapping shield angle and two contaminated Reformation
 * drones coordinated by relay receivers A and B. The two groups are hostile to each other (default matrix:
 * contaminated ⟷ everyone) and, once the encounter starts, both to the lead.
 *
 * THE LEAD STARTS UNSEEN (unless Z03 detected her): her body is untargetable, so the two groups fight each other
 * while she works the room. She is noticed when the scan head S sweeps her, when she strikes anything in the
 * encounter (a shot at a receiver included — a close-interaction disable is silent), or when she comes within a
 * few metres. A Z03 detection (`z.flag('z03Detected')`) skips the window: the drones hold forward posts toward
 * the entry, turn on her together in the overlook, and S sweeps faster.
 *
 * Release: both receivers disabled (shot, or by hand — no ammunition needed) AND the encounter cleared (a downed
 * network makes its drones self-disable; the Enforcers' shield front is a separate problem).
 */
import type { Actor, DeviceHandle, Encounter, Interactable, Routine, SayOpts, ZoneRuntime } from '@/core/api';
import { angleDelta, smoothstep, yawTo } from '@/core/mathx';
import { barker, onZoneEvent, sustainDrops, tutorialHint, waitOr } from '../shared';
import {
  E2_CAP, NET, NETWORK_FINDS, NOTICE_DRONE, NOTICE_ENFORCER, RX_HOLD, SCAN_ARC, SCAN_FAST, SCAN_PERIOD, SCAN_RANGE,
} from './layout';
import { S } from './state';

const RX_A_ID = 'z04-receiverA';
const RX_B_ID = 'z04-receiverB';
const RADIO: SayOpts = { channel: 'radio' };

/** Z03's scan failure: the drones start alerted and the scan head runs faster */
export function detected(z: ZoneRuntime): boolean {
  return z.flag('z03Detected') === true;
}

const down = (d: DeviceHandle | null): boolean => !d || d.disabled;

/** both receivers are out (shot or disabled by hand) */
export function receiversDown(): boolean {
  return down(S.rxA) && down(S.rxB);
}

/** the release condition (plan): both receivers disabled and the local hostiles cleared */
export function e2Done(): boolean {
  return receiversDown() && (!S.enc || S.enc.cleared);
}

/**
 * Devices and the encounter, once per zone load (idempotent). Every member spawns at its post and starts at
 * once — the crossfire is under way when the lead comes through the door.
 */
export function setupE2(z: ZoneRuntime): Encounter {
  if (S.enc) return S.enc;
  const game = z.game;
  const alerted = detected(z);
  const devices = game.ai.devices;
  S.rxA = devices.relayReceiver({ id: RX_A_ID, pos: z.m('receiverA'), network: NET });
  S.rxB = devices.relayReceiver({ id: RX_B_ID, pos: z.m('receiverB'), network: NET });
  S.rxA.actor.yaw = z.myaw('receiverA');
  S.rxB.actor.yaw = z.myaw('receiverB');
  S.scan = devices.scanHead({
    id: 'z04-scanS', pos: z.m('scanHead'), yaw: z.myaw('scanHead'), arcDeg: SCAN_ARC, range: SCAN_RANGE,
    period: SCAN_PERIOD, onDetect: () => notice(z, 'scan'),
  });
  if (alerted) S.scan.setRate(SCAN_FAST);

  const drone = (name: 'A' | 'B') => ({
    role: 'contamDrone' as const, at: `drone${name}`,
    opts: {
      yaw: z.myaw(`drone${name}`), network: NET, tags: ['e2', 'contaminated'],
      // alerted drones hold forward posts toward the entry; otherwise they work the shield line from the receivers
      post: z.m(alerted ? `drone${name}Fwd` : `drone${name}`),
    },
  });
  const enc = z.encounter({
    id: 'E2',
    maxActive: E2_CAP,
    waves: [{
      spawns: [
        ...[0, 1, 2, 3].map((i) => ({
          role: 'enforcer' as const, at: `enf${i}`, opts: { yaw: z.myaw(`enf${i}`), post: z.m(`enf${i}`), tags: ['e2', 'shieldFront'] },
        })),
        drone('A'),
        drone('B'),
      ],
    }],
  });
  S.enc = enc;
  S.unseen = true;
  // striking anything in the encounter (or one of its devices) gives the lead away
  onZoneEvent(z, 'actor:hit', ({ target, hit }) => {
    if (!S.unseen || hit.attacker !== z.player) return;
    if (enc.has?.(target) || target === S.rxA?.actor || target === S.rxB?.actor || target === S.scan?.actor) notice(z, 'struck');
  });
  enc.start();
  return enc;
}

/** The fight begins: an unseen lead has until the relay network's scanning finds her. */
export function startNetworkClock(z: ZoneRuntime): void {
  if (S.unseen && S.seenAt === Infinity) S.seenAt = z.time + NETWORK_FINDS;
}

/** The lead is noticed: from now on she is a target like anyone else. */
export function notice(z: ZoneRuntime, why: 'scan' | 'struck' | 'close' | 'network' | 'z03'): void {
  if (!S.unseen) return;
  S.unseen = false;
  z.player.targetable = true;
  z.log(`E2: the lead is noticed (${why})`);
}

/**
 * ZoneDef.update: keep an unseen lead untargetable, notice her when she walks up close, and run the drones'
 * authored turn (a skip snaps it).
 */
export function updateE2(z: ZoneRuntime, dt: number): void {
  if (S.turn) stepTurn(z.skipping ? Infinity : dt);
  const enc = S.enc;
  if (!enc || !S.unseen) return;
  const p = z.player;
  if (!p || !p.alive) return;
  p.targetable = false;
  if (z.time >= S.seenAt) {
    notice(z, 'network');
    return;
  }
  for (const a of enc.alive) {
    const lim = String(a.archetype) === 'enforcer' ? NOTICE_ENFORCER : NOTICE_DRONE;
    if (Math.hypot(a.pos.x - p.pos.x, a.pos.z - p.pos.z) < lim) {
      notice(z, 'close');
      return;
    }
  }
}

/** Begin the drones' turn toward `at`: both start and finish on the same tick (book: “at exactly the same moment”). */
export function startTurn(drones: Actor[], at: { x: number; z: number }, seconds = 0.7): void {
  S.turn = {
    drones, len: seconds, t: 0,
    from: drones.map((d) => d.yaw),
    to: drones.map((d) => yawTo(d.pos.x, d.pos.z, at.x, at.z)),
  };
}

/** advance (or with Infinity, finish) the authored turn */
export function stepTurn(dt: number): void {
  const t = S.turn;
  if (!t) return;
  t.t = Math.min(t.len, t.t + dt);
  const k = smoothstep(0, 1, t.t / t.len);
  t.drones.forEach((d, i) => {
    if (d.alive) d.yaw = (t.from[i] ?? d.yaw) + angleDelta(t.from[i] ?? d.yaw, t.to[i] ?? d.yaw) * k;
  });
  if (t.t >= t.len) S.turn = null;
}

// ---------------------------------------------------------------------------------------------------------------------
// The fight beat's pieces
// ---------------------------------------------------------------------------------------------------------------------

/** close-interaction disables (no ammunition needed) and world markers for both receivers — once per load */
export function armReceivers(z: ZoneRuntime): void {
  if (S.ixA || S.ixB) return;
  const game = z.game;
  const arm = (dev: DeviceHandle | null, id: string, marker: string, prompt: string, label: string): Interactable | null => {
    if (!dev || dev.disabled) return null;
    game.ui.marker(id, dev.pos, { label, kind: 'objective', hideWithin: 3.5 });
    z.onDispose(() => game.ui.marker(id, null));
    return z.interact({
      id, at: marker, prompt, hold: RX_HOLD, radius: 2.3, required: true, interruptible: true,
      enabled: () => !dev.disabled,
      onDone: () => dev.disable(z.player),
    });
  };
  S.ixA = arm(S.rxA, 'z04-ixA', 'receiverA', 'Disable receiver A', 'Receiver A'); // NEW (prompt, label)
  S.ixB = arm(S.rxB, 'z04-ixB', 'receiverB', 'Disable receiver B', 'Receiver B'); // NEW (prompt, label)
  onZoneEvent(z, 'device:disabled', ({ id }) => {
    if (id === RX_A_ID) {
      S.ixA?.remove();
      game.ui.marker('z04-ixA', null);
    } else if (id === RX_B_ID) {
      S.ixB?.remove();
      game.ui.marker('z04-ixB', null);
    }
    // the network is the sensor installation: when it goes down the scan head goes dark with it, and its scanning
    // no longer hunts an unseen lead; one receiver down interrupts the search and it starts over
    if (receiversDown()) {
      if (S.scan && !S.scan.disabled) S.scan.disable(null);
      S.seenAt = Infinity;
    } else if (S.unseen && (id === RX_A_ID || id === RX_B_ID)) {
      S.seenAt = z.time + NETWORK_FINDS;
    }
  });
}

/** the objective follows what is left: the receivers first, then the shield front */
export function* e2Objective(z: ZoneRuntime, enc: Encounter): Routine {
  let last = '';
  while (!e2Done()) {
    const next = !down(S.rxA) ? 'A' : !down(S.rxB) ? 'B' : enc.cleared ? '' : 'front';
    if (next !== last) {
      last = next;
      if (next === 'A') z.objective('Disable both receivers', 'receiverA'); // NEW
      else if (next === 'B') z.objective('Disable both receivers', 'receiverB'); // NEW
      else if (next === 'front') z.objective('Break the shield front'); // NEW
    }
    yield 0.3;
  }
}

/**
 * Barks: Tharne reports on the comm (receiver states, scanning, the network, the shield front); Selene answers
 * once with one word; the Enforcers call their drill. Information only — nobody cheers, no kill-quips.
 */
export function* e2Barks(z: ZoneRuntime, enc: Encounter): Routine {
  const game = z.game;
  const say = barker(z, 3.5);
  const net = game.ai.devices.network(NET);
  let networkDownAt = -1;
  let interrupted = false;
  onZoneEvent(z, 'device:disabled', ({ id }) => {
    if (id !== RX_A_ID && id !== RX_B_ID) return;
    const pos = id === RX_A_ID ? S.rxA?.pos : S.rxB?.pos;
    if (receiversDown()) {
      game.events.emit('caption', { text: 'NETWORK DOWN', kind: 'alert', pos }); // NEW
      z.bark('Tharne', 'Both receivers down. The network is down.', RADIO); // NEW
      z.bark('Selene', 'Understood.'); // NEW
      networkDownAt = z.time;
    } else if (id === RX_A_ID) {
      game.events.emit('caption', { text: 'Receiver A disabled', kind: 'scan', pos }); // NEW
      z.bark('Tharne', 'Receiver A down. Scanning interrupted.', RADIO); // NEW
    } else {
      game.events.emit('caption', { text: 'Receiver B disabled', kind: 'scan', pos }); // NEW
      z.bark('Tharne', 'Receiver B down. Scanning interrupted.', RADIO); // NEW
    }
  });
  let lostOne = false;
  onZoneEvent(z, 'actor:died', ({ actor }) => {
    if (!enc.has?.(actor) || lostOne || String(actor.archetype) !== 'enforcer' || enc.cleared) return;
    lostOne = true;
    say('close', 'Enforcer', 'Close the line!'); // NEW (Dominion drill call)
  });
  let calledNotice = S.unseen === false;
  for (;;) {
    if (e2Done()) return;
    const now = game.time.now;
    if (!calledNotice && !S.unseen) {
      calledNotice = true;
      z.bark('Tharne', 'They have you.', RADIO); // NEW
      say('contact', 'Enforcer', 'Contact! Shields together!'); // NEW (Dominion drill call)
    }
    // the interruption ends while one receiver still stands: scanning is back
    if (!net.down && net.interruptedUntil > 0) {
      if (now < net.interruptedUntil) interrupted = true;
      else if (interrupted) {
        interrupted = false;
        z.bark('Tharne', 'Scanning resumed.', RADIO); // NEW
      }
    }
    const shields = enc.alive.filter((a) => String(a.archetype) === 'enforcer').length;
    if (networkDownAt >= 0 && z.time > networkDownAt + 5 && shields > 0) say('front', 'Tharne', 'Shield front still holding.', RADIO); // NEW
    if (!S.unseen && shields > 0 && z.player.pos.y > 2) say('high', 'Enforcer', 'High right! Turn the wall!'); // NEW (drill call)
    yield 0.25;
  }
}

/** Teach through play (plan order): receivers by shot or by hand → one / both down → the shield front. HUD only. */
export function* teachE2(z: ZoneRuntime, enc: Encounter): Routine {
  yield 1.5;
  if (S.unseen) tutorialHint(z, 'z04Unseen', 'Not seen yet. A scan sweep, an attack or getting close will give you away.', undefined, 7); // NEW
  if (S.unseen) yield 7.5;
  if (!receiversDown()) tutorialHint(z, 'z04Receivers', 'Shoot a receiver, or disable it by hand at close range.', 'interact', 8); // NEW
  yield waitOr(z, () => down(S.rxA) || down(S.rxB) || e2Done(), 35);
  if (e2Done()) return;
  yield 3;
  tutorialHint(z, 'z04Network', 'One receiver down interrupts scanning briefly. Both down end the network.', 'scan', 8); // NEW
  // the shield front: the first blocked blow, or the network down with the line still standing
  let blocked = false;
  onZoneEvent(z, 'actor:hit', ({ target, hit, result }) => {
    if (result.blocked && hit.attacker === z.player && String(target.archetype) === 'enforcer') blocked = true;
  });
  yield waitOr(z, () => blocked || receiversDown() || enc.cleared, 60);
  if (enc.cleared) return;
  yield 2;
  tutorialHint(z, 'z04Shield', 'The shield front is a separate problem: flank it, stagger it, or use the heavy attack.', 'heavy', 9); // NEW
}

/** sustain on each route: the service lane, behind the low route's high cover, on the deck, the south-east alcove */
export function e2Sustain(z: ZoneRuntime): void {
  sustainDrops(z, ['sustainService', 'sustainLow', 'sustainDeck', 'sustainEast']);
}

/**
 * The world after E2 for a direct entry at `release`: the receivers stand powered down where they were, the scan
 * head is quiet, nothing is hostile.
 */
export function restoreAfterE2(z: ZoneRuntime): void {
  const devices = z.game.ai.devices;
  if (!S.rxA) S.rxA = devices.relayReceiver({ id: RX_A_ID, pos: z.m('receiverA'), network: NET });
  if (!S.rxB) S.rxB = devices.relayReceiver({ id: RX_B_ID, pos: z.m('receiverB'), network: NET });
  if (!S.scan) S.scan = devices.scanHead({ id: 'z04-scanS', pos: z.m('scanHead'), yaw: z.myaw('scanHead'), arcDeg: SCAN_ARC, range: SCAN_RANGE, period: SCAN_PERIOD });
  S.rxA.actor.yaw = z.myaw('receiverA');
  S.rxB.actor.yaw = z.myaw('receiverB');
  quietDevices();
}

/** power every Z04 device down in place (idempotent) */
export function quietDevices(): void {
  for (const d of [S.rxA, S.rxB, S.scan]) if (d && !d.disabled) d.disable(null);
}
