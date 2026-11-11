/**
 * Z05 `carrier` and `aftermath` (SCRIPT_SOURCE Z05; the author's ruling 1): the carrier is lost with all hands.
 * Selene's plane and Tharne's jets change the miss distance and nothing else — the terminal is not hit, the
 * ship goes down into the distortion. The command strip shows «IMPACT 01:30» → «MISS DISTANCE» → «CARRIER
 * SIGNAL LOST» (new UI, tagged), never a rescue. The readout is not a fail timer: delay changes pressure, never
 * the outcome. After it, no dialogue: the screams below, his turn away from the shaft, the handoff.
 */
import * as THREE from 'three';
import type { CineCtx, Interactable, Routine, ZoneRuntime } from '@/core/api';
import { clamp01 } from '@/core/mathx';
import { FROST, standardExit, waitOr } from '../shared';
import { SOLDIERS, coolBlade } from './cast';
import { CN, CX, RING, RING_FACE, step } from './layout';
import { say } from './stage';
import { S, place } from './state';

/** the readout's countdown starts here (the book: “Impact in ninety seconds.”) and never shows less than CLAMP */
const IMPACT_SECONDS = 90;
const CLAMP = 10;
/**
 * The pass (sky.carrier): at 0.52 the hull is in the ceiling view, low in the west-south-west; it comes on to 0.7
 * (high overhead) while the clock runs, then — once the plane holds — crosses overhead (its shadow peaks
 * 0.72–0.88), shears the tower at 0.8 in the east-north-east, and goes down into the distortion.
 */
const CARRIER_START = 0.52;
const CARRIER_HOLD = 0.7;

const clock = (s: number): string => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
/** «MISS DISTANCE» over a rising bar — no invented figure */
const bar = (k: number): string => {
  const n = Math.round(clamp01(k) * 10);
  return '▮'.repeat(n) + '▯'.repeat(10 - n);
};

// ---------------------------------------------------------------------------------------------------------
// `carrier`
// ---------------------------------------------------------------------------------------------------------

export function* carrierBeat(z: ZoneRuntime): Routine {
  const game = z.game;
  yield* alarmScene(z);
  z.fork(impactClock(z), 'impactClock');

  // she runs for the ancient control ring; he follows two steps, then stops — and is behind her at the ring
  z.objective('Reach the control ring', 'ringEntry'); // NEW (SCRIPT_SOURCE wording)
  const tarrik = z.cast('tarrik');
  if (tarrik) {
    tarrik.face(null);
    const from = tarrik.actor.pos;
    const ring = z.m('ring');
    const d = Math.max(1e-3, Math.hypot(ring.x - from.x, ring.z - from.z));
    tarrik.moveTo(from.clone().set(from.x + ((ring.x - from.x) / d) * 1.5, from.y, from.z + ((ring.z - from.z) / d) * 1.5));
    tarrik.play('guard', { loop: true });
    z.fork((function* (): Routine {
      yield waitOr(z, () => Math.hypot(z.player.pos.x - ring.x, z.player.pos.z - ring.z) < 5, 60);
      tarrik.moveTo(z.m('tarrikBehind'), { yaw: z.myaw('tarrikBehind') });
      tarrik.play('guard', { loop: true });
    })(), 'tarrikFollows');
  }
  const engage = z.interact({ id: 'z05-ring', at: 'ring', prompt: 'Use the control ring', required: true, radius: 2.6 }); // NEW
  yield z.untilInteract(engage);
  z.objective(null);
  yield* ringScene(z);
  yield* holdPlane(z);

  // the plane holds: for a moment the strip itself says what changed — the miss distance, not the ship
  game.ui.readout({ label: 'MISS DISTANCE', value: bar(0.3), tone: 'cold' }); // NEW
  S.holo?.setText('MISS DISTANCE'); // NEW
  yield 1.2;
  game.ui.readout({ label: 'MISS DISTANCE', value: bar(0.6), tone: 'cold' }); // NEW
  yield 1.2;
  yield* passScene(z);

  // «CARRIER SIGNAL LOST» is the last thing on her strip; then the strip goes dark
  game.ui.readout({ label: 'CARRIER SIGNAL LOST', value: '--:--', tone: 'cold' }); // NEW
  yield 2.8;
  game.ui.readout(null);
  if (S.holo) S.holo.params.visible = 0;
  game.player.setMovementLocked(false);
}

/** “Then the ceiling turns blue-white.” Tharne's shout; the strip; Tarrik between her and the shaft */
function* alarmScene(z: ZoneRuntime): Routine {
  const game = z.game;
  const sky = game.sky;
  const carrier = sky.carrier;
  yield* z.cinematic('z05-alarm', function* (c: CineCtx): Routine {
    const sel = game.player.actor;
    const tarrik = z.cast('tarrik');
    const tharne = z.cast('tharne');
    game.player.cancelAction?.();
    sel.visual?.stop();
    tarrik?.stopAction();
    tarrik?.play('guard', { loop: true });
    // the crippled carrier is already in the ceiling when the lance takes its engines
    carrier.visible = true;
    carrier.setProgress(CARRIER_START);
    S.carrierTarget = CARRIER_START;
    S.carrierRate = 0.01;
    game.audio.setMusic('carrier', 0.4);
    const up = carrier.position.clone().sub(sel.pos).normalize();
    // low, beside her (Tarrik is on her other side), looking up through the ceiling at the hull
    c.cut({ pos: z.P(0, 0).set(sel.pos.x + 1.1, sel.pos.y + 0.8, sel.pos.z + 1.9), look: carrier.position.clone(), fov: 60 });
    if (!z.skipping) {
      sky.impact({ dir: up, color: 0xd8ecff, strength: 1 });
      game.audio.play('fleetImpact', { volume: 1 });
      game.audio.play('explosionLarge', { volume: 0.5, delay: 0.6 });
      game.camera.shake(0.3, 0.6);
    }
    yield 2.6;
    // THARNE, from the far side of the chamber
    if (tharne) {
      c.shot(tharne.actor.pos, { yawDeg: 300, distance: 3.4, height: 1.6, fov: 34 });
      tharne.stopAction();
      tharne.face(sel.pos.clone());
    }
    yield* z.say('Tharne', 'Selene!', { actor: tharne });
    tharne?.face(null);
    tharne?.play('holdConsole', { loop: true });
    // her command strip (narrated in the book): the readout and the trajectory through the complex
    c.shot(sel.pos, { yawDeg: 200, distance: 1.6, height: 1.45, lookHeight: 1.3, fov: 30 });
    yield* z.say('Command strip', 'Seven thousand people. Impact in ninety seconds.', { channel: 'system' }); // speaker label NEW
    // “Tarrik still stands between Selene and Crownmark Five. Every tactical instinct tells her not to turn her back.”
    if (tarrik) c.twoShot(tarrik.actor.pos, sel.pos, { side: -1, distance: 1.8, fov: 34 });
    yield 2.4;
    // end state
    carrier.visible = true;
    S.holoHold = false;
    if (S.holo) {
      S.holo.setText(`IMPACT ${clock(IMPACT_SECONDS)}`); // NEW
      S.holo.params.visible = 1;
      S.holo.params.progress = 0;
    }
    tarrik?.play('guard', { loop: true });
    z.setFlag('z05Alarm', true);
  });
}

/**
 * The strip counts down — for this event only. It is not a fail timer: below CLAMP seconds it holds (pressure
 * builds instead), and the ship's approach waits for the plane, so a delay never lets the terminal be hit.
 */
function* impactClock(z: ZoneRuntime): Routine {
  const game = z.game;
  let left = IMPACT_SECONDS;
  let groan = 0;
  while (z.flag('z05Held') !== true) {
    const shown = Math.max(CLAMP, Math.ceil(left));
    game.ui.readout({ label: 'IMPACT', value: clock(shown), tone: 'cold' }); // NEW
    if (S.holo && !S.holoHold) S.holo.setText(`IMPACT ${clock(shown)}`); // NEW
    const k = clamp01((IMPACT_SECONDS - left) / (IMPACT_SECONDS - CLAMP));
    S.carrierTarget = CARRIER_START + (CARRIER_HOLD - CARRIER_START) * k;
    S.carrierRate = 0.02;
    if (S.holo) S.holo.params.progress = 0.8 * k;
    // pressure: the structure groans more often as the hull comes on
    if (z.time - groan > (shown < 30 ? 5 : 11)) {
      groan = z.time;
      game.audio.play('structuralGroan', { volume: 0.5 + 0.5 * k });
      if (shown < 30) game.camera.shake(0.18, 0.5);
    }
    yield 0.25;
    // the strip runs on play time: a scene (watched or skipped) leaves the same pressure behind it
    if (!game.mission.cinematicActive) left -= 0.25;
  }
}

/** “Come on.” — the ring answers; too much mass and too little power; Tharne */
function* ringScene(z: ZoneRuntime): Routine {
  const game = z.game;
  yield* z.cinematic('z05-ring', function* (c: CineCtx): Routine {
    const sel = game.player.actor;
    const tarrik = z.cast('tarrik');
    const tharne = z.cast('tharne');
    game.player.cancelAction?.();
    place(z, sel, z.m('ring'), z.myaw('ring'));
    if (tarrik) {
      tarrik.teleport(z.m('tarrikBehind'), z.myaw('tarrikBehind'));
      tarrik.face(sel.pos.clone());
      tarrik.play('guard', { loop: true });
    }
    if (S.stab) {
      S.stab.params.active = 1;
      S.stab.params.plane = 0.2;
    }
    game.player.playScripted('holdConsole');
    sel.visual?.setGlow(1.8);
    const ring = z.m('ring');
    if (!z.skipping) {
      game.vfx.spawn('goldRecognition', ring);
      game.audio.play('recognitionTone', { pos: ring });
      game.audio.play('ambAlignClick', { pos: ring });
    }
    c.shot(ring, { yawDeg: (z.myaw('ring') * -180) / Math.PI, distance: 2.4, height: 1.55, lookHeight: 1.4, fov: 38 });
    yield 0.9;
    yield* say(z, 'Selene', 'Come on.', sel);
    // the machinery answers from three systems: too much mass and too little power
    S.holoHold = true;
    S.holo?.setText('TOO LITTLE POWER'); // NEW (from the book's "too little power")
    if (!z.skipping) game.audio.play('structuralGroan', { pos: ring, volume: 0.8 });
    c.cut({ pos: z.P(0, 0).copy(ring).add(new THREE.Vector3(2.8, 1.2, 2.6)), look: z.m('planeCenter'), fov: 50 });
    yield 2.2;
    S.holoHold = false;
    // she links her command strip to the Accord's guidance net; Tharne answers across the chamber
    c.shot(ring, { yawDeg: ((-z.myaw('ring')) * 180) / Math.PI + 30, distance: 1.7, height: 1.6, lookHeight: 1.5, fov: 32 });
    yield* say(z, 'Selene', 'Tharne.', sel);
    if (tharne) c.shot(tharne.actor.pos, { yawDeg: 250, distance: 2.6, height: 1.55, fov: 32 });
    yield* say(z, 'Tharne', 'I’m here.', tharne, { channel: 'radio', offscreen: true, keepFacing: true });
    c.shot(ring, { yawDeg: ((-z.myaw('ring')) * 180) / Math.PI - 25, distance: 1.8, height: 1.6, lookHeight: 1.5, fov: 32 });
    yield* say(z, 'Selene', 'Give me the carrier’s remaining thrust.', sel);
    yield* z.say('Tharne', 'It has no primary engines.', { channel: 'radio', offscreen: true });
    // he has the angle to kill her: two steps behind her, blade still raised
    if (tarrik) c.twoShot(sel.pos, tarrik.actor.pos, { side: 1, distance: 1.6, fov: 34 });
    yield* say(z, 'Selene', 'Maneuvering jets.', sel);
    yield* z.say('Tharne', 'They cannot move seven million tons.', { channel: 'radio', offscreen: true });
    c.shot(ring, { yawDeg: ((-z.myaw('ring')) * 180) / Math.PI + 15, distance: 1.5, height: 1.62, lookHeight: 1.55, fov: 30 });
    yield* say(z, 'Selene', 'They do not need to. Change the miss distance.', sel);
    if (tharne) c.shot(tharne.actor.pos, { yawDeg: 280, distance: 2.0, height: 1.6, fov: 30 });
    yield* say(z, 'Tharne', 'Yes.', tharne, { channel: 'radio', offscreen: true, keepFacing: true });
    // end state
    place(z, sel, z.m('ring'), z.myaw('ring'));
    sel.visual?.setGlow(1);
    if (S.stab) {
      S.stab.params.active = 1;
      S.stab.params.plane = 0.2;
    }
    z.setFlag('z05Ring', true);
  });
}

/** the generous hold (or toggle): her stillness holds the old machinery coherent while Tharne fires the jets */
function* holdPlane(z: ZoneRuntime): Routine {
  const game = z.game;
  const player = game.player;
  z.objective('Hold the plane', 'ring'); // NEW (SCRIPT_SOURCE wording)
  const hold = z.interact({
    id: 'z05-plane', at: 'ring', prompt: 'Hold the plane', hold: 5, radius: 1.9, required: true, // NEW
    onStart: () => {
      player.setMovementLocked(true);
      player.playScripted('holdPlane');
    },
    onCancel: () => {
      player.actor.visual?.stop('holdPlane');
      player.setMovementLocked(false);
    },
  });
  z.fork(planeFollows(z, hold), 'plane');
  yield z.untilInteract(hold);
  z.objective(null);
  player.setMovementLocked(true);
  player.playScripted('holdPlane');
  if (S.stab) S.stab.params.plane = 1;
  S.jetsTarget = 1;
  z.setFlag('z05Held', true);
}

function* planeFollows(z: ZoneRuntime, hold: Interactable): Routine {
  const game = z.game;
  while (!hold.done) {
    if (S.stab) S.stab.params.plane = 0.2 + 0.8 * hold.progress;
    S.jetsTarget = 0.9 * hold.progress;
    if (hold.progress > 0.04 && !S.plane && !z.skipping) {
      S.plane = game.vfx.spawn('coherentPlane', z.m('planeCenter'), { dir: { x: 0, y: 1, z: 0 }, scale: 1.0, color: FROST });
      game.audio.play('stasisField', { pos: z.m('planeCenter'), volume: 0.6 });
    }
    yield;
  }
}

/**
 * The pass: the hull darkens the chamber, scrapes a white-gold tower and goes down into the distortion. The
 * overlay's path lifts clear of the complex — the miss distance — and then the signal is lost.
 */
function* passScene(z: ZoneRuntime): Routine {
  const game = z.game;
  const carrier = game.sky.carrier;
  yield* z.cinematic('z05-pass', function* (c: CineCtx): Routine {
    const sel = game.player.actor;
    const tarrik = z.cast('tarrik');
    S.carrierTarget = 1;
    S.carrierRate = 0.03;
    S.jetsTarget = 1;
    if (S.holo) S.holo.params.progress = 1;
    carrier.onClip = (point) => {
      if (z.skipping) return;
      game.audio.play('carrierClip', { pos: point, volume: 1 });
      game.audio.play('debrisFall', { volume: 0.7, delay: 1.2 });
      game.camera.shake(0.45, 1.4);
    };
    if (!z.skipping) {
      game.audio.play('carrierPass', { volume: 1 });
      game.vfx.spawn('carrierShadowDust', z.m('centre'), { duration: 9, scale: 1.6 });
    }
    // the hull overhead, through the ceiling (from the shaft's south lip: the plane stays out of the lens)
    const look = (): THREE.Vector3 => carrier.position.clone();
    const cam = game.camera.cine;
    c.cut({ pos: z.P(CX - 4, CN - 10, 1.0), look: look(), fov: 68 });
    cam.track(look);
    yield 3.4;
    // “For several seconds the chamber darkens beneath the shadow of seven million tons of dying ship.”
    cam.track(null);
    c.cut({ pos: z.P(CX - 5.5, CN - 6.5, 1.7), look: z.m('ring').setY(1.6), fov: 46 });
    c.moveAsync({ pos: z.P(CX - 6.5, CN - 7.2, 1.5), look: z.m('ring').setY(1.9), fov: 44 }, 4, 'inOut');
    yield waitOr(z, () => z.skipping || carrier.progress >= 0.785, 8);
    // it scrapes across a white-gold tower, breaking it in a shower of pale debris
    c.cut({ pos: z.P(CX - 22, CN - 2, 1.7), look: carrier.clipPoint.clone(), fov: 36 });
    yield waitOr(z, () => z.skipping || carrier.progress >= 0.88, 6);
    // … then continues past the complex and falls into the distortion below (the sky's pass descends after the
    // clip): a locked frame on the rim of the ceiling the hull goes down through and does not come back over
    const eye = z.P(CX - 22, CN - 2, 1.7);
    const dir = carrier.position.clone().sub(eye).setY(0).normalize();
    c.cut({ pos: eye, look: eye.clone().addScaledVector(dir, 100).setY(eye.y + 72), fov: 56 });
    yield 4.8;
    // the trajectory ends on «CARRIER SIGNAL LOST» — the overlay now holds the full 19 characters (polish 3), so
    // the over-shoulder frame below reads it in the scene, not only on the strip after; she lets the plane go
    S.holoHold = true;
    if (S.holo) {
      S.holo.setText('CARRIER SIGNAL LOST'); // NEW (the strip's words, SCRIPT_SOURCE Z05 carrier)
      S.holo.params.progress = 1;
      S.holo.params.visible = 1;
    }
    if (S.stab) S.stab.params.plane = 0.15;
    releasePlane();
    sel.visual?.stop();
    // over her shoulder from the side Tarrik is not standing on, to the overlay in front of her
    const [bx, bn] = step(RING[0], RING[1], 2.9, RING_FACE + 52);
    const [hx, hn] = step(RING[0], RING[1], 3.6, RING_FACE + 180);
    c.cut({ pos: z.P(CX + bx, CN + bn, 2.0), look: z.P(CX + hx, CN + hn, 1.2), fov: 46 });
    if (tarrik) tarrik.face(sel.pos.clone());
    yield 2.4;

    // end state — identical watched or skipped: the terminal stands, the ship is gone
    game.camera.cine.track(null);
    carrier.onClip = null;
    carrier.setProgress(1);
    S.carrierTarget = 1;
    carrier.visible = false;
    if (S.stab) {
      S.stab.params.plane = 0;
      S.stab.params.active = 0.25;
    }
    releasePlane();
    game.player.actor.visual?.stop('holdPlane');
    game.audio.setMusic('silence', 3);
    z.story('carrierLost');
  });
}

/** stop the coherent-plane effect (cosmetic) */
function releasePlane(): void {
  const p = S.plane;
  S.plane = null;
  p?.stop();
}

// ---------------------------------------------------------------------------------------------------------
// `aftermath` (handoff → Tarrik). No dialogue: the silence is canon.
// ---------------------------------------------------------------------------------------------------------

export function* aftermath(z: ZoneRuntime): Routine {
  const game = z.game;
  game.ui.readout(null);
  game.player.setMovementLocked(false);
  yield* z.cinematic('z05-aftermath', function* (c: CineCtx): Routine {
    const sel = game.player.actor;
    const tarrik = z.cast('tarrik');
    const tharne = z.cast('tharne');
    const lyric = z.cast('lyric');
    game.player.cancelAction?.();
    sel.visual?.stop('holdPlane');
    if (S.holo) S.holo.params.visible = 0;
    // “Selene exhales and turns.” — a breath, not a victory
    c.shot(sel.pos, { yawDeg: ((-z.myaw('ring')) * 180) / Math.PI, distance: 2.2, height: 1.6, lookHeight: 1.55, fov: 34 });
    yield 1.8;
    if (tarrik) {
      place(z, sel, z.m('ring'), Math.atan2(-(tarrik.actor.pos.x - sel.pos.x), -(tarrik.actor.pos.z - sel.pos.z)));
      tarrik.stopAction();
      tarrik.face(sel.pos.clone());
    }
    // “Tarrik is still behind her. He had the kill and did not take it.” Their eyes meet; neither speaks.
    if (tarrik) c.twoShot(tarrik.actor.pos, sel.pos, { side: 1, distance: 1.7, fov: 32 });
    yield 2.6;
    tarrik?.play('lowerWeapon');
    if (tarrik) c.twoShot(sel.pos, tarrik.actor.pos, { side: -1, distance: 1.7, fov: 32 });
    yield 2.4;
    // screaming rises from a lower corridor, Dominion and Reformation voices tangled together
    if (!z.skipping) game.audio.play('screamsBelow', { pos: z.m('screams'), volume: 1 });
    // Crownmark Five waits below — he looks at the shaft, then turns away from it toward the screaming
    if (tarrik) {
      const t = tarrik.actor.pos;
      const shaft = z.m('shaftLook');
      tarrik.face(shaft);
      c.cut({ pos: t.clone().add(new THREE.Vector3((t.x - shaft.x) * 0.12, 1.75, (t.z - shaft.z) * 0.12)), look: shaft.clone().setY(shaft.y - 2), fov: 40 });
    }
    yield 2.4;
    coolBlade();
    if (tarrik) {
      const exit = z.m('exit');
      tarrik.face(null);
      tarrik.actor.yaw = Math.atan2(-(exit.x - tarrik.actor.pos.x), -(exit.z - tarrik.actor.pos.z));
      tarrik.play('turnAway');
    }
    yield 0.5;
    // hand control to Tarrik on that turn
    yield* z.handoff('tarrik', { partnerMode: 'follow', seconds: 2.6 });
    // after one glance at Tharne and Lyric, Selene follows
    const selene = z.cast('selene');
    if (selene) {
      selene.face(tharne ? tharne.actor.pos.clone() : null);
      c.shot(selene.actor.pos, { yawDeg: 300, distance: 2.4, height: 1.6, fov: 36 });
      yield 1.5;
      selene.face(null);
    }
    // end state — everyone with the leads; the squad's soldiers hold the platform
    for (const k of [tharne, lyric, z.cast('lyessa')]) {
      if (!k) continue;
      k.stopAction();
      k.mode = 'follow';
    }
    for (const s of SOLDIERS) z.cast(s)?.stopAction();
    if (selene) selene.mode = 'follow';
    z.setFlag('z05Turned', true);
  });
  yield* standardExit(z, S.exit, 'Z06', { at: 'exit', objective: 'Reach the lower corridor' }); // NEW
}
