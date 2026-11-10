/**
 * Z01 — the fixed beat on the right rib (SCRIPT_SOURCE Z01 `e1`, the author's ruling 2): the first synchronised
 * volley throws the soldier against the only Eclipse growth in Z00–Z01, the tissue closes on his gauntlet and the
 * plate splits along a violet-lit line. Split out of z01.ts to keep each module small — the pattern for a zone
 * helper folder (`src/zones/zNN/`). `ribX` is the plan x of the reinforcement rib; its sheltered face is the
 * west one, 0.65 m short of it.
 */
import * as THREE from 'three';
import type { CineCtx, Encounter, Routine, ZoneRuntime } from '@/core/api';
import { VIOLET, atPost, waitOr, walkTo } from '../shared';

/** the soldier is nameless until Z02 */
const MALIK = 'Soldier';

interface GauntletState {
  /** the tissue that closes on the gauntlet during the insert (scaled by `grip`) */
  tissue: THREE.Object3D | null;
  grip: number;
  gripTarget: number;
  /** the violet-lit crack on the soldier's gauntlet */
  crack: THREE.Object3D | null;
}
let G: GauntletState = blank();
function blank(): GauntletState {
  return { tissue: null, grip: 0, gripTarget: 0, crack: null };
}

/** forget the per-load objects (ZoneDef.dispose) */
export function resetGauntlet(): void {
  G = blank();
}

/** ZoneDef.update: the tissue's grip eases toward its target on the sim clock (a skip snaps it) */
export function updateGauntlet(z: ZoneRuntime, dt: number): void {
  if (!G.tissue) return;
  G.grip = z.skipping ? G.gripTarget : G.grip + (G.gripTarget - G.grip) * Math.min(1, dt * 3.2);
  G.tissue.scale.setScalar(Math.max(0.001, G.grip));
}

/**
 * The cracked gauntlet: a split in the plate lit violet from inside, a thread of black in it. It rides on the
 * soldier's left hand from the insert onward (Z02 picks the story up).
 */
export function attachCrack(z: ZoneRuntime, viewer?: THREE.Vector3): void {
  if (G.crack) return;
  const malik = z.cast('malik');
  const visual = malik?.actor.visual;
  if (!visual) return;
  const mats = z.game.mats;
  const g = new THREE.Group();
  g.name = 'gauntlet-crack';
  const lit = mats.emissive(VIOLET, 3.2);
  const tissue = mats.get('eclipseTissue');
  // the split runs along the back of the hand in three short angular segments
  const segs: Array<[number, number, number, number]> = [[-0.018, 0, 0.5, 0.026], [0.002, 0.006, -0.35, 0.024], [0.02, 0.001, 0.3, 0.02]];
  for (const [x, zz, rot, len] of segs) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(len, 0.004, 0.005), lit);
    m.position.set(x, 0, zz);
    m.rotation.y = rot;
    g.add(m);
  }
  const thread = new THREE.Mesh(new THREE.SphereGeometry(0.016, 8, 6), tissue);
  thread.scale.set(1.2, 0.4, 0.6);
  thread.position.set(0.002, 0, 0.004);
  g.add(thread);
  // the socket's own axes differ per figure: seat the split on the side of the plate that faces the viewer as
  // the hand lies NOW (default: its top), taken into the socket's frame; it rides the hand afterwards
  const socket = visual.socket('handL');
  socket.updateWorldMatrix(true, false);
  const centre = socket.getWorldPosition(new THREE.Vector3());
  const out = viewer ? viewer.clone().sub(centre).normalize() : new THREE.Vector3(0, 1, 0);
  g.position.copy(socket.worldToLocal(centre.clone().addScaledVector(out, 0.04)));
  const face = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), out);
  g.quaternion.copy(socket.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(face));
  socket.add(g);
  G.crack = g;
  z.onDispose(() => {
    g.removeFromParent();
    for (const c of g.children) (c as THREE.Mesh).geometry.dispose();
  });
}

/**
 * The tissue that closes on the gauntlet for the two-second insert: thin black tendrils that leave the growth at
 * the rib's base and wrap over the back of the hand, a few small nodules where they root. The group's origin is
 * the root on the rib face, so the insert's `grip` (its scale) grows the tendrils out of the growth onto the
 * hand — and draws them back to a stub when he tears the hand free.
 */
function makeTissue(z: ZoneRuntime, hand: THREE.Vector3, ribX: number): void {
  if (G.tissue) return;
  const mats = z.game.mats;
  const tissue = mats.get('eclipseTissue');
  const vein = mats.get('eclipseVein');
  const g = new THREE.Group();
  g.name = 'gauntlet-tissue';
  // root: on the rib's sheltered face, low, level with the hand
  const root = z.P(ribX - 0.66, 0, 0).setY(Math.max(0.12, hand.y - 0.05)).setZ(hand.z);
  const to = hand.clone().sub(root);
  /** [sideways offset along the rib (world z), arch height, radius, vein?] per tendril */
  const strands: Array<[number, number, number, boolean]> = [
    [-0.05, 0.035, 0.007, false], [-0.022, 0.05, 0.009, false], [0.0, 0.06, 0.008, false],
    [0.026, 0.045, 0.008, false], [0.05, 0.03, 0.006, false], [0.012, 0.04, 0.0035, true],
  ];
  for (const [side, arch, r, lit] of strands) {
    const pts = [
      new THREE.Vector3(0, 0, side * 1.5),
      new THREE.Vector3(to.x * 0.45, to.y * 0.45 + arch * 0.5, to.z * 0.45 + side * 1.1),
      new THREE.Vector3(to.x * 0.9, to.y + arch, to.z + side * 0.6),
      // over the back of the hand and down its far side — it ends on the plate, never past it
      new THREE.Vector3(to.x * 1.0, to.y + arch * 0.45, to.z + side * 0.35),
      new THREE.Vector3(to.x * 1.04, to.y - 0.012, to.z + side * 0.25),
    ];
    const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, r, 6, false);
    g.add(new THREE.Mesh(geo, lit ? vein : tissue));
  }
  // nodules where the strands root in the growth, two small ones on the plate
  const nodules: Array<[number, number, number, number]> = [
    [0, 0, -0.05, 0.04], [0.02, 0.025, 0.045, 0.032], [0.04, -0.01, 0.0, 0.028],
    [to.x * 0.97, to.y + 0.03, to.z - 0.015, 0.016], [to.x * 1.02, to.y + 0.02, to.z + 0.025, 0.013],
  ];
  for (const [x, y, zz, rad] of nodules) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(rad, 10, 8), tissue);
    m.position.set(x, y, zz);
    m.scale.set(1.3, 0.62, 1.1);
    g.add(m);
  }
  g.position.copy(root);
  g.scale.setScalar(0.001);
  z.builder.add(g);
  G.tissue = g;
  G.grip = 0;
  G.gripTarget = 0;
}

/**
 * The fixed beat (SCRIPT_SOURCE Z01, the author's ruling 2). The soldier on the right advances along the rib;
 * the first synchronised volley takes him on the guard and the chest plate — sparks, no wound — and throws him
 * against the rib's base, where his gauntlet hand goes into the growth. A two-second insert: the tissue closes
 * on the gauntlet and the plate splits along a line lit violet from inside. He tears the hand free and two
 * soldiers pull him behind cover. No character sees what touched him.
 * Every state change is applied whether the scene is watched or skipped.
 */
export function* gauntletBeat(z: ZoneRuntime, enc: Encounter, ribX: number): Routine {
  const game = z.game;
  const malik = z.cast('malik');
  const a = z.cast('soldierA');
  const bb = z.cast('soldierB');
  if (!malik) return;
  const fall = z.m('malikFall');
  const hand = new THREE.Vector3();

  yield* z.cinematic('z01-gauntlet', function* (c: CineCtx): Routine {
    // (1) he advances along the right rib
    malik.stopAction();
    malik.teleport(z.P(21.4, 3.3), z.myaw('malikAdvance'));
    walkTo(z, malik, 'malikAdvance', { run: true });
    c.cut({ pos: z.P(17.2, 1.5, 1.35), look: z.P(26.5, 3.6, 1.5), fov: 40 });
    c.moveAsync({ pos: z.P(18.6, 1.7, 1.4), look: z.P(26.8, 3.2, 1.3), fov: 38 }, 2.2, 'out');
    // (2) the paired drones light him up, then fire as one
    const paired = enc.alive.filter((d) => d.tags.has('lane0') || d.tags.has('lane2'));
    const chest = new THREE.Vector3();
    const beams = z.skipping ? [] : paired.map((d) => game.vfx.beam(d.aimPoint(new THREE.Vector3()), malik.actor.aimPoint(chest).clone(), 'laser'));
    if (!z.skipping) {
      game.audio.play('droneCharge', { pos: z.m('drone0') });
      game.events.emit('caption', { text: 'Volley lane locking', kind: 'alert', pos: malik.actor.pos }); // NEW
    }
    yield 1.25;
    for (const beam of beams) beam.remove(0.1);
    if (!z.skipping) {
      malik.actor.aimPoint(chest);
      for (const d of paired) {
        const from = d.aimPoint(new THREE.Vector3());
        for (let i = 0; i < 3; i++) game.vfx.tracer(from, chest, 'drone');
      }
      game.audio.play('droneVolley', { pos: z.m('drone0') });
      game.vfx.spawn('sparkHeavy', chest, { dir: { x: 1, y: 0.2, z: 0 } });
      game.vfx.spawn('droneBoltHit', chest);
      game.audio.play('guardBlock', { pos: chest });
      game.camera.shake(0.35, 0.3);
      malik.play('hitHeavy');
    }
    yield 0.28;
    // thrown down against the rib's base — the cut covers the throw
    malik.teleport(fall, z.myaw('malikFall'));
    malik.play('knockdown');
    c.cut({ pos: z.P(ribX - 3.3, 4.6, 0.75), look: z.P(ribX - 0.9, 2.5, 0.35), fov: 36 });
    if (!z.skipping) game.audio.play('armorRattle', { pos: fall });
    yield 0.75;
    // (3) the insert: tissue closes on the gauntlet; the plate splits along a violet-lit line. No impact light.
    const visual = malik.actor.visual;
    if (visual) visual.socket('handL').getWorldPosition(hand);
    else hand.copy(fall).setY(0.2);
    makeTissue(z, hand, ribX);
    G.gripTarget = 1;
    c.cut({ pos: new THREE.Vector3(hand.x - 0.62, hand.y + 0.34, hand.z + 0.5), look: hand.clone(), fov: 26 });
    const lens = new THREE.Vector3(hand.x - 0.5, hand.y + 0.28, hand.z + 0.42);
    c.moveAsync({ pos: lens, look: hand.clone(), fov: 24 }, 2, 'inOut');
    c.dof(0.75, 0.7);
    if (!z.skipping) game.audio.play('eclipseBreath', { pos: hand, volume: 0.5 });
    yield 0.95;
    attachCrack(z, lens);
    if (!z.skipping) game.audio.play('breachCrack', { pos: hand, volume: 0.35, pitch: 1.7 });
    yield 1.1;
    // (4) he tears the hand free; two of the squad take hold of him
    G.gripTarget = 0.25;
    c.dof(null);
    malik.play('getUp');
    walkTo(z, a, 'helpL', { run: true });
    walkTo(z, bb, 'helpR', { run: true });
    c.cut({ pos: z.P(ribX - 2.6, 6.4, 1.7), look: z.P(ribX - 1.1, 2.4, 0.45), fov: 44 });
    yield* z.say('Soldier', 'Got him. Pulling him back.', { duration: 1.9, actor: a }); // NEW
    // end state — identical watched or skipped
    walkTo(z, malik, 'malikCover');
    walkTo(z, a, 'soldierACover');
    walkTo(z, bb, 'soldierBCover');
    attachCrack(z);
    z.setFlag('z01GauntletCracked', true);
  }, { blendOut: 0.4 });

  // hurt, not maimed: he keeps the hand and stays in the fight from cover
  z.fork((function* (): Routine {
    for (const [c, post] of [[malik, 'malikCover'], [a, 'soldierACover'], [bb, 'soldierBCover']] as const) {
      if (!c) continue;
      yield waitOr(z, () => atPost(z, c, post), 14);
      c.stopAction();
      c.play('aimRifle', { loop: true });
    }
  })(), 'settle');
}
