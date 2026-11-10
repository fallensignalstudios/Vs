/**
 * Z07 `cages` — the fixed story acts (SCRIPT_SOURCE Z07 `cages`). Lyric names the danger from the floor; the
 * Eclipse uses both containment fields; Tarrik refuses Cross and fires a Dominion lance battery through the
 * external fire-control station (one confirm), `z.handoff('selene')`, Selene refuses Sol and fires the Accord's
 * remote drone artillery (two volleys). Selene's display prints `UNAUTHORIZED FRIENDLY FIRE` and, at the same
 * moment, Tarrik's prints «UNSANCTIONED COMBAT PERCEIVED» (the author's ruling 13). Each destroys their own side's
 * cage; neither is a choice. Both cages are outside the terminal: the shots come from the fleets, the camera's
 * close views of each cage stand for the station's feed.
 *
 * The author's lines are exact (curly apostrophes are the book's); new strings carry `// NEW`. Every state change
 * is applied whether a scene is watched or skipped.
 */
import * as THREE from 'three';
import type { CamPose, CineCtx, Interactable, Routine, SayOpts, Vec3Like, ZoneRuntime } from '@/core/api';
import { AMBER, BLUE, tutorialHint, waitOr, walkTo } from '../shared';
import { S, type CageRig } from './state';

const RADIO: SayOpts = { offscreen: true, channel: 'radio' };
const SYSTEM: SayOpts = { channel: 'system' };
const _a = new THREE.Vector3();

// ---------------------------------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------------------------------

/** compass bearing (plan degrees, 0 = north, 90 = east) from a to b, both world positions */
export function bearing(a: Vec3Like, b: Vec3Like): number {
  return THREE.MathUtils.radToDeg(Math.atan2(b.x - a.x, -(b.z - a.z)));
}

/** engine yaw that faces from a toward b */
export function yawToward(a: Vec3Like, b: Vec3Like): number {
  return Math.atan2(-(b.x - a.x), -(b.z - a.z));
}

/** feet of a cast member, or of the lead when it is not spawned */
function feet(z: ZoneRuntime, name: string): THREE.Vector3 {
  const c = z.cast(name);
  return (c ? c.actor.pos : z.player.pos).clone();
}

/**
 * The station's feed: a close view of a cage out in the void, from the gallery's side of it. `side` moves the
 * camera to the right (+) or left (−) of the line from the cage toward the gallery.
 */
export function feed(z: ZoneRuntime, rig: CageRig, dist: number, side: number, up: number, fov = 34): CamPose {
  const toward = z.P(17, 20).sub(rig.base).setY(0).normalize();
  const right = _a.set(-toward.z, 0, toward.x);
  const pos = rig.core.clone().addScaledVector(toward, dist).addScaledVector(right, side);
  pos.y += up;
  return { pos, look: rig.core.clone(), fov };
}

/** a cage in its end state: the wreck at rest, its light out (`snap` for restores and skips) */
export function cageGone(rig: CageRig | null, snap: boolean): void {
  if (!rig) return;
  rig.prop.params.destroyed = 1;
  rig.prop.params.charge = 0;
  rig.spreadTarget = 0;
  rig.litTarget = 0;
  rig.wisp?.stop();
  rig.wisp = null;
  if (snap) {
    rig.prop.snap();
    rig.spread = 0;
    rig.lit = 0;
  }
}

/** a personal display: a strip of light in the air in front of its owner, turned toward the camera */
export function lightStrip(z: ZoneRuntime, strip: typeof S.stripSelene, owner: Vec3Like, cam: Vec3Like, text: string): void {
  if (!strip) return;
  strip.setLines([text]);
  const dir = _a.set(cam.x - owner.x, 0, cam.z - owner.z).normalize();
  strip.object.position.set(owner.x + dir.x * 0.5, owner.y + 1.32, owner.z + dir.z * 0.5);
  strip.object.rotation.y = Math.atan2(dir.x, dir.z);
  strip.show(1, 0.2);
  if (z.skipping) strip.update(0, true);
}

export function stripsOff(z: ZoneRuntime): void {
  S.stripSelene?.show(0, 0.6);
  S.stripTarrik?.show(0, 0.6);
  if (z.skipping) {
    S.stripSelene?.update(0, true);
    S.stripTarrik?.update(0, true);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// The opening: what they see, “Kill them.”, Cross
// ---------------------------------------------------------------------------------------------------------------------

export function* cagesScene(z: ZoneRuntime): Routine {
  const game = z.game;
  const selene = z.cast('selene');
  const lyric = z.cast('lyric');
  const tharne = z.cast('tharne');
  const dom = S.dom;
  const ref = S.ref;
  yield 0.4;

  yield* z.cinematic('z07-cages', function* (c: CineCtx): Routine {
    const T = z.player.pos.clone();
    const Se = feet(z, 'selene');
    const L = feet(z, 'lyric');
    const Th = feet(z, 'tharne');
    // (1) the gallery: the long glass, the people small in it, the void beyond
    c.cut({ pos: z.P(1.6, 9.2, 2.3), look: z.P(17.5, 21.6, 2.6), fov: 54 });
    c.moveAsync({ pos: z.P(3.4, 11.4, 2.0), look: z.P(16.5, 22, 2.8), fov: 50 }, 6.5, 'inOut');
    yield 3;
    // (2) an uncrewed Crownwatch containment platform closes amber resonator rings around a wounded organism
    if (dom) {
      dom.prop.params.charge = 0.9;
      c.cut(feed(z, dom, 46, -12, 8));
      c.moveAsync(feed(z, dom, 38, -7, 5), 3.2, 'out');
      if (!z.skipping) game.audio.play('fireControlCharge', { volume: 0.35, pitch: 0.7 });
    }
    yield 2.8;
    // (3) in another sector, a Reformation extraction drone deploys a cold-field envelope around a fragment
    if (ref) {
      ref.prop.params.charge = 0.8;
      c.cut(feed(z, ref, 44, 11, 7));
      c.moveAsync(feed(z, ref, 36, 7, 4), 3.2, 'out');
    }
    yield 2.8;

    // (4) he looks toward her: she stands at the glass with both of them out there beyond it
    z.player.yaw = yawToward(T, Se);
    c.twoShot(Se, T, { side: -1, distance: 1.7, fov: 34 });
    yield* z.say('Tarrik', 'Yours?', { actor: z.player, gesture: false });
    // she turns to him, then indicates the Dominion resonator
    selene?.face(T);
    c.shot(Se, { yawDeg: bearing(Se, T) - 28, distance: 2.3, height: 1.62, lookHeight: 1.56, fov: 36 });
    yield 0.7;
    // one utterance (the book breaks it with a tag): she indicates the Dominion resonator on the second half
    if (dom) selene?.face(dom.core);
    selene?.play('point');
    c.cut({ pos: z.P(18.6, 18.2, 1.75), look: z.P(13.9, 26.6, 1.5), fov: 42 });
    yield* z.say('Selene', 'One of them. And yours.');
    // from the floor, where Tharne set her down
    c.shot(L, { yawDeg: 212, distance: 2.0, height: 0.95, lookHeight: 0.82, fov: 38 });
    yield* z.say('Lyric', 'Kill them.', { actor: lyric });
    selene?.face(L);
    c.shot(Se, { yawDeg: 245, distance: 2.4, height: 1.62, lookHeight: 1.56, fov: 36 });
    yield* z.say('Selene', 'The specimens?', { actor: selene });
    c.shot(L, { yawDeg: 222, distance: 1.6, height: 0.9, lookHeight: 0.84, fov: 34 });
    yield* z.say('Lyric', 'The cages.', { actor: lyric });

    // black tissue spreads along the boundary rather than through it; violet veins trace the containment
    // geometry; every Reformation system in range flickers
    if (ref) {
      ref.spreadTarget = 1;
      c.cut(feed(z, ref, 30, -6, 3, 30));
      c.moveAsync(feed(z, ref, 26, -4, 2, 28), 2.6, 'out');
      if (!z.skipping) ref.wisp = game.vfx.spawn('violetWisp', ref.core, { scale: 4, duration: 240 });
    }
    yield 2.4;
    if (dom) {
      dom.spreadTarget = 1;
      c.cut(feed(z, dom, 32, 6, 3, 30));
      if (!z.skipping) dom.wisp = game.vfx.spawn('violetWisp', dom.core, { scale: 4, duration: 240 });
    }
    yield 1.8;
    S.flicker = 5;
    c.cut({ pos: z.P(9.6, 15.2, 2.1), look: z.P(4.6, 20.4, 1.0), fov: 44 });
    if (!z.skipping) game.audio.play('ambCommBlip', { volume: 0.7, pitch: 0.8 });
    yield 1.6;
    c.shot(Th, { yawDeg: bearing(Th, T) + 22, distance: 2.0, height: 1.2, lookHeight: 1.0, fov: 36 });
    yield* z.say('Tharne', 'It’s learning the field.', { actor: tharne });
    c.shot(L, { yawDeg: 205, distance: 1.5, height: 0.88, lookHeight: 0.84, fov: 32 });
    yield* z.say('Lyric', 'No. It’s using it.', { actor: lyric });

    // the Crownwatch command channel
    if (dom) z.player.yaw = yawToward(T, dom.core);
    const close = (): void => c.shot(T, { yawDeg: 152, distance: 2.2, height: 1.66, lookHeight: 1.6, fov: 34 });
    const wide = (): void => {
      if (dom) c.twoShot(dom.core, T, { side: 1, distance: 1.5, fov: 44 });
    };
    close();
    yield* z.say('Tarrik', 'Destroy the specimen.', { gesture: false });
    yield* z.say('Cross', 'Negative.', RADIO);
    wide();
    yield* z.say('Tarrik', 'It is compromising the resonator.', { gesture: false });
    yield* z.say('Cross', 'We can isolate the feedback.', RADIO);
    close();
    yield* z.say('Tarrik', 'You cannot.', { gesture: false });
    yield* z.say('Cross', 'Tarrik.', RADIO);
    yield* z.say('Tarrik', 'Destroy it.', { gesture: false });
    if (dom) c.cut(feed(z, dom, 28, 5, 2, 30));
    yield* z.say('Cross', 'We have the first intact living Eclipse specimen recovered since the war.', RADIO);
    close();
    yield* z.say('Tarrik', 'Exactly.', { gesture: false });
    // end state — identical watched or skipped
    selene?.stopAction();
    if (dom) {
      dom.prop.params.charge = 0.9;
      dom.spreadTarget = 1;
    }
    if (ref) {
      ref.prop.params.charge = 0.8;
      ref.spreadTarget = 1;
    }
    z.setFlag('z07CagesSeen', true);
  }, { blendOut: 0.5 });
}

// ---------------------------------------------------------------------------------------------------------------------
// Tarrik: the fire-control node, the lance battery, the handoff
// ---------------------------------------------------------------------------------------------------------------------

export function* tarrikFires(z: ZoneRuntime): Routine {
  const game = z.game;
  z.objective('Take the fire-control station', 'station'); // NEW
  let objected = false;
  const fire: Interactable = z.interact({
    id: 'z07-fire-dominion', at: 'station', prompt: 'Confirm fire', hold: 1.4, radius: 1.8, required: true, // NEW
    // he seizes the nearest external fire-control node; Cross objects as the command transfers
    onStart: () => {
      if (objected) return;
      objected = true;
      z.bark('Cross', 'Do not.', RADIO);
      if (!z.skipping) game.audio.play('fireControlCharge', { volume: 0.9 });
    },
  });
  z.fork((function* (): Routine {
    yield waitOr(z, () => fire.done || z.player.pos.distanceTo(z.m('station')) < 4, 30);
    if (!fire.done) tutorialHint(z, 'z07Fire', 'Hold at the station to confirm the fire order.', 'interact', 6); // NEW
  })(), 'hintFire');
  yield z.untilInteract(fire);
  z.objective(null);
  if (!objected) z.bark('Cross', 'Do not.', RADIO);

  const dom = S.dom;
  yield* z.cinematic('z07-lance', function* (c: CineCtx): Routine {
    const ring = z.m('stationRing');
    // the shot is laid through the sighting ring: the camera behind it, on the line to the cage
    if (dom) {
      const back = ring.clone().sub(dom.core).normalize();
      c.cut({ pos: ring.clone().addScaledVector(back, 1.7).setY(ring.y + 0.06), look: dom.core, fov: 30 });
      c.moveAsync({ pos: ring.clone().addScaledVector(back, 1.15).setY(ring.y + 0.02), look: dom.core, fov: 26 }, 1.6, 'in');
    }
    if (!z.skipping) game.audio.play('fireControlCharge', { volume: 1 });
    yield 1.3;
    // a Dominion lance battery vaporizes its own containment platform
    if (dom) {
      c.cut(feed(z, dom, 52, -14, 9, 38));
      c.moveAsync(feed(z, dom, 47, -12, 8, 36), 3, 'out');
      const from = dom.core.clone().add(_a.set(-0.32, 1, 0.22).normalize().multiplyScalar(520));
      const beam = z.skipping ? null : game.vfx.beam(from, dom.core, 'laser', { color: AMBER, width: 1.8 });
      if (!z.skipping) {
        game.audio.play('fireControlFire', { volume: 1.1 });
        game.sky.impact({ dir: dom.core.clone().sub(z.P(17, 20, 1.6)).normalize(), color: AMBER, strength: 0.55 });
      }
      yield 0.3;
      // amber light consumes both the biomass and its compromised control systems
      dom.prop.params.destroyed = 1;
      dom.spreadTarget = 0;
      dom.litTarget = 0;
      dom.lit = 3;
      if (!z.skipping) {
        game.vfx.spawn('cageDestroy', dom.base, { scale: 3 });
        game.vfx.spawn('explosionLarge', dom.core, { scale: 5, color: AMBER });
        game.audio.play('cageDestroy', { volume: 1 });
        game.audio.play('fleetImpact', { volume: 0.7, delay: 0.5 });
      }
      yield 1.2;
      beam?.remove(0.6);
      yield 1.6;
    }
    z.story('cageDominionDestroyed');
    // the glow of it on his face through the glass
    c.shot(z.player.pos, { yawDeg: 20, distance: 2.0, height: 1.66, lookHeight: 1.6, fov: 34 });
    if (!z.skipping) game.camera.shake(0.12, 0.6);
    yield 1.6;
    cageGone(dom, z.skipping);
  }, { blendOut: 0.3 });
  cageGone(dom, false);

  // the camera hands over: Selene, at the glass
  yield* z.handoff('selene', { partnerMode: 'scripted', seconds: 3 });
  const tarrik = z.cast('tarrik');
  if (tarrik) {
    tarrik.mode = 'scripted';
    walkTo(z, tarrik, 'tarrikAside');
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Selene: Sol, two volleys, the two displays
// ---------------------------------------------------------------------------------------------------------------------

export function* seleneFires(z: ZoneRuntime): Routine {
  const game = z.game;
  const lyric = z.cast('lyric');
  const tarrik = z.cast('tarrik');
  const ref = S.ref;

  yield* z.cinematic('z07-sol', function* (c: CineCtx): Routine {
    const Se = z.player.pos.clone();
    if (ref) z.player.yaw = yawToward(Se, ref.core);
    walkTo(z, tarrik, 'tarrikAside');
    c.shot(Se, { yawDeg: 200, distance: 2.3, height: 1.62, lookHeight: 1.56, fov: 36 });
    yield* z.say('Sol', 'Keeper, stand down.', RADIO);
    yield* z.say('Selene', 'The extraction field is transmitting contamination into fleet systems.', { gesture: false });
    yield* z.say('Sol', 'We can sever it.', RADIO);
    if (ref) c.twoShot(ref.core, Se, { side: -1, distance: 1.5, fov: 44 });
    yield* z.say('Selene', 'You should have done that before putting the Eclipse inside it.', { gesture: false });
    yield* z.say('Sol', 'Veyne.', RADIO);
    // whispering, from the floor
    const L = feet(z, 'lyric');
    c.shot(L, { yawDeg: 215, distance: 1.45, height: 0.86, lookHeight: 0.84, fov: 30 });
    yield* z.say('Lyric', 'Do it.', { actor: lyric });
    // end state: Tarrik has stepped aside, the station is hers
    if (z.skipping) tarrik?.teleport(z.m('tarrikAside'), z.myaw('tarrikAside'));
  }, { blendOut: 0.4 });

  // two volleys: the field generator, then what it held
  z.objective('Confirm the volleys at the station', 'station'); // NEW
  tutorialHint(z, 'z07Volleys', 'Two volleys. Confirm each one at the station.', 'interact', 6); // NEW
  const first = z.interact({ id: 'z07-volley-1', at: 'station', prompt: 'Confirm first volley', radius: 1.8, required: true }); // NEW
  yield z.untilInteract(first);
  yield* z.cinematic('z07-volley-1', function* (c: CineCtx): Routine {
    if (!ref) return;
    c.cut(feed(z, ref, 50, 13, 8, 38));
    c.moveAsync(feed(z, ref, 45, 11, 7, 36), 3, 'out');
    yield* missiles(z, ref, 0);
    // blue-white missiles destroy the field generator: the envelope collapses
    ref.prop.params.charge = 0;
    ref.spreadTarget = 0.6;
    yield 1.4;
  }, { blendOut: 0.3 });
  const second = z.interact({ id: 'z07-volley-2', at: 'station', prompt: 'Confirm second volley', radius: 1.8, required: true }); // NEW
  yield z.untilInteract(second);
  z.objective(null);

  yield* z.cinematic('z07-volley-2', function* (c: CineCtx): Routine {
    if (ref) {
      c.cut(feed(z, ref, 40, -9, 6, 36));
      c.moveAsync(feed(z, ref, 36, -8, 5, 34), 3, 'out');
      yield* missiles(z, ref, 1);
      // a second volley erases the biomass
      ref.prop.params.destroyed = 1;
      ref.spreadTarget = 0;
      ref.litTarget = 0;
      ref.lit = 3;
      if (!z.skipping) {
        game.vfx.spawn('cageDestroy', ref.base, { scale: 3 });
        game.audio.play('cageDestroy', { volume: 1 });
      }
      yield 2.4;
    }
    z.story('cageReformationDestroyed');
    cageGone(ref, z.skipping);
    // the two displays, at the same moment: hers, and the Dominion equivalent on his
    const Se = z.player.pos.clone();
    const T = tarrik ? tarrik.actor.pos.clone() : z.m('tarrikAside');
    z.player.yaw = yawToward(Se, T);
    tarrik?.face(Se);
    const mid = Se.clone().add(T).multiplyScalar(0.5);
    const cam = z.P(0, 0).set(mid.x + 0.6, 1.55, mid.z + 3.3);
    c.cut({ pos: cam, look: mid.clone().setY(1.35), fov: 40 });
    lightStrip(z, S.stripSelene, Se, cam, 'UNAUTHORIZED FRIENDLY FIRE');
    lightStrip(z, S.stripTarrik, T, cam, 'UNSANCTIONED COMBAT PERCEIVED'); // NEW (author's wording, ruling 13)
    if (!z.skipping) game.audio.play('ambCommBlip', { volume: 0.8 });
    yield* z.say('Command strip', 'UNAUTHORIZED FRIENDLY FIRE', { ...SYSTEM, duration: 2.4 }); // NEW (speaker label)
    yield* z.say('Crownwatch display', 'UNSANCTIONED COMBAT PERCEIVED', { ...SYSTEM, duration: 2.4 }); // NEW (author's wording, ruling 13; speaker label)
    // they look at one another, and for one perfect second no translation is required
    stripsOff(z);
    c.twoShot(T, Se, { side: 1, distance: 1.6, fov: 36 });
    yield 1.6;
    c.twoShot(Se, T, { side: -1, distance: 1.6, fov: 36 });
    yield 1.4;
    // then both commands begin issuing orders; neither of them listens (sound only, no words)
    if (!z.skipping) {
      game.audio.play('ambPA', { volume: 0.8 });
      game.audio.play('ambCommBlip', { volume: 0.9, delay: 0.3 });
      game.audio.play('ambCommBlip', { volume: 0.7, delay: 0.9, pitch: 1.2 });
    }
    yield 1.4;
    stripsOff(z);
  }, { blendOut: 0.5 });
  game.events.emit('caption', { text: 'Crownwatch and Reformation command, both at once', kind: 'ambient' }); // NEW
}

/** one volley of the Accord's remote drone artillery: blue-white missiles out of the dark onto the cage */
function* missiles(z: ZoneRuntime, rig: CageRig, volley: 0 | 1): Routine {
  const game = z.game;
  const sky = rig.core.clone().add(_a.set(0.45, 0.8, -0.3).normalize().multiplyScalar(260));
  const hits: THREE.Vector3[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + volley;
    const r = volley === 0 ? 5.2 : 1.6;
    hits.push(rig.core.clone().add(_a.set(Math.cos(a) * r, (volley === 0 ? -4 : 0) + (i % 3) * 1.1, Math.sin(a) * r)));
  }
  if (!z.skipping) {
    game.audio.play('fireControlFire', { volume: 0.9, pitch: 1.25 });
    hits.forEach((h, i) => game.vfx.tracer(sky.clone().add(_a.set((i - 2.5) * 6, i * 3, 0)), h, 'cold', { speed: 420 }));
  }
  yield 0.62;
  if (!z.skipping) {
    hits.forEach((h, i) => game.vfx.spawn(i % 2 ? 'explosionLarge' : 'deviceBreak', h, { scale: 2.6, color: BLUE }));
    game.audio.play('explosionLarge', { volume: 0.8 });
    game.sky.impact({ dir: rig.core.clone().sub(z.P(17, 20, 1.6)).normalize(), color: 0xbfe6ff, strength: 0.4 });
  }
}

/** the cage ending used by restores (and by watched scenes once they end) */
export function bothCagesGone(z: ZoneRuntime, snap: boolean): void {
  cageGone(S.dom, snap);
  cageGone(S.ref, snap);
  z.story('cageDominionDestroyed');
  z.story('cageReformationDestroyed');
}
