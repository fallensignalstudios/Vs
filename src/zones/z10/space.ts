/**
 * Z10 · Fifth Crownmark chamber — the space (plan coordinates, origin at the south-west corner, x east, n north).
 *
 * A Ø 54 m disc of mirror-black stone with radial gold channels, suspended in a far larger dark volume, around a
 * Ø 10 m dais. Crownmark Five sits in its mechanism at the centre, facing the entry (south); the nested rings
 * (Ø 120 m) fill the volume above. The two assent interfaces stand one each side in front of it, independent,
 * sunk in the dais until the protocol raises them. A glass rail rings the disc; beyond it the dark shut view
 * boundary (sky `coreChamber`), immense pylons and the terminal's far structure. Entry: a walkway from the south.
 * Exit: the return lift on the north edge.
 */
import * as THREE from 'three';
import type { HeroProp, ZoneBuilder } from '@/core/api';
import { FACE, GOLD, IVORY } from '../shared';
import { C, DAIS_H, DAIS_R, FLOOR_R, LIFT, PAD, PAD_SUNK, S, STEP_H, STEP_R, type PadState } from './state';

/** Selene's console (off the axis, so the Crownmark stands clear from the entry) */
const CONSOLE = { x: C.x + 4.4, n: C.n - 7.3 } as const;
/** entry walkway (south) */
const WALK = { x0: C.x - 2.6, x1: C.x + 2.6, n0: -8 } as const;

export function buildSpace(b: ZoneBuilder): void {
  buildFloor(b);
  buildEntry(b);
  buildLift(b);
  buildHeroProps(b);
  buildLight(b);
  buildMarkers(b);
}

function buildFloor(b: ZoneBuilder): void {
  b.disc({ x: C.x, n: C.n, r: FLOOR_R, mat: 'blackStoneFloor', inlay: 'radial', reflective: true, thickness: 1.2 });
  b.disc({ x: C.x, n: C.n, r: STEP_R, h: STEP_H - 0.02, mat: 'blackStoneFloor', inlay: 'none', reflective: true });
  b.disc({ x: C.x, n: C.n, r: DAIS_R, h: DAIS_H - 0.02, mat: 'blackStoneFloor', inlay: 'crownmark', reflective: true });
  // concentric gold rings in the floor (the painting's circles), drawn as channels
  for (const r of [9.5, 16.5, 23.5]) {
    const pts: Array<[number, number]> = [];
    for (let i = 0; i <= 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      pts.push([C.x + Math.sin(a) * r, C.n + Math.cos(a) * r]);
    }
    b.channel(pts, { width: r < 10 ? 0.06 : 0.045, intensity: r < 10 ? 2.4 : 1.6 });
  }
  // the glass rail round the edge, open at the entry (south) and the lift (north)
  const R = FLOOR_R - 0.35;
  const seg = 40;
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * 360;
    const a1 = ((i + 1) / seg) * 360;
    const mid = (a0 + a1) / 2;
    if (Math.abs(mid - 180) < 8 || mid < 6 || mid > 354) continue;
    const p = (a: number): [number, number] => [C.x + Math.sin((a * Math.PI) / 180) * R, C.n + Math.cos((a * Math.PI) / 180) * R];
    b.rail({ from: p(a0), to: p(a1), height: 1.1, style: 'glass' });
  }
  // rail lamps: short lit posts every 30° (the painting's lanterns)
  for (let a = 15; a < 360; a += 30) {
    const t = (a * Math.PI) / 180;
    b.column({ x: C.x + Math.sin(t) * (R + 0.1), n: C.n + Math.cos(t) * (R + 0.1), r: 0.22, height: 1.6, style: 'pylon', mat: 'blackStone', lit: true });
  }
  // immense pylons rising out of the dark round the platform: a hard scale cue for the tiny figures
  for (let i = 0; i < 10; i++) {
    const t = ((i + 0.5) / 10) * Math.PI * 2;
    b.column({ x: C.x + Math.sin(t) * 38, n: C.n + Math.cos(t) * 38, h: -60, r: 2.6, height: 150, style: 'pylon', mat: 'blackStone', lit: true });
  }
}

function buildEntry(b: ZoneBuilder): void {
  b.floor({ x: C.x, n: (WALK.n0 + 0.6) / 2, w: WALK.x1 - WALK.x0, d: 0.6 - WALK.n0, mat: 'blackStoneFloor', inlay: 'channels', reflective: true });
  b.wall({ from: [WALK.x0, WALK.n0], to: [WALK.x0, -0.4], height: 6, mat: 'blackStone', style: 'ribbed' });
  b.wall({ from: [WALK.x1, WALK.n0], to: [WALK.x1, -0.4], height: 6, mat: 'blackStone', style: 'ribbed' });
  b.wall({ from: [WALK.x0, WALK.n0], to: [WALK.x1, WALK.n0], height: 6, mat: 'blackStone', style: 'plain', doors: [{ at: (WALK.x1 - WALK.x0) / 2, width: 3.6, height: 4.6 }] });
  b.door({ x: C.x, n: WALK.n0, width: 3.6, height: 4.6, style: 'threshold' }).setState('sealed');
  b.ceiling({ x: C.x, n: (WALK.n0 - 0.4) / 2, w: WALK.x1 - WALK.x0, d: -0.4 - WALK.n0, h: 6, style: 'vaultClosed', rise: 2.2, bay: 3.8, glow: 1.2, mat: 'blackStone' });
  b.column({ x: WALK.x0 - 0.3, n: -0.2, height: 9, style: 'pylon', mat: 'blackStone', lit: true });
  b.column({ x: WALK.x1 + 0.3, n: -0.2, height: 9, style: 'pylon', mat: 'blackStone', lit: true });
}

function buildLift(b: ZoneBuilder): void {
  b.floor({ x: LIFT.x, n: LIFT.n - 0.6, w: 5, d: 5.4, mat: 'blackStoneFloor', inlay: 'none' });
  b.disc({ x: LIFT.x, n: LIFT.n, r: 1.7, h: 0.03, mat: 'whiteGoldFloor', inlay: 'radial', noSurface: true });
  b.wall({ from: [LIFT.x - 2.5, LIFT.n - 3], to: [LIFT.x - 2.5, LIFT.n + 2.2], height: 6.5, mat: 'blackStone' });
  b.wall({ from: [LIFT.x + 2.5, LIFT.n - 3], to: [LIFT.x + 2.5, LIFT.n + 2.2], height: 6.5, mat: 'blackStone' });
  b.wall({ from: [LIFT.x - 2.5, LIFT.n + 2.2], to: [LIFT.x + 2.5, LIFT.n + 2.2], height: 6.5, mat: 'blackStone', style: 'panelled' });
  b.ceiling({ x: LIFT.x, n: LIFT.n - 0.4, w: 5, d: 5.2, h: 6.5, style: 'flat', mat: 'blackStone' });
  b.whitePoint({ x: LIFT.x, n: LIFT.n + 1.7, h: 4.6, intensity: 1.8 });
  b.column({ x: LIFT.x - 3.2, n: LIFT.n - 2.6, height: 8, style: 'pylon', mat: 'blackStone', lit: true });
  b.column({ x: LIFT.x + 3.2, n: LIFT.n - 2.6, height: 8, style: 'pylon', mat: 'blackStone', lit: true });
}

/** register a hero prop's footprint colliders at its placement (formula from api/kit.ts HeroProp.colliders) */
function propColliders(b: ZoneBuilder, prop: HeroProp<Record<string, number>>): ReturnType<ZoneBuilder['collider']>[] {
  const out: ReturnType<ZoneBuilder['collider']>[] = [];
  const r = prop.object.rotation.y;
  const p = prop.object.position;
  for (const c of prop.colliders ?? []) {
    out.push(b.collider({
      shape: c.shape, x: p.x + c.offset.x * Math.cos(r) + c.offset.z * Math.sin(r), y: p.y + c.offset.y,
      z: p.z - c.offset.x * Math.sin(r) + c.offset.z * Math.cos(r), yaw: r + (c.yaw ?? 0),
    }));
  }
  return out;
}

function buildHeroProps(b: ZoneBuilder): void {
  const props = b.game.props;
  // Crownmark Five, seated in its mechanism, facing the entry
  const mark = props.crownmarkFive();
  mark.object.position.copy(b.P(C.x, C.n, DAIS_H));
  mark.object.rotation.y = b.yaw(FACE.south);
  mark.params.glow = 0.55;
  b.add(mark.object);
  propColliders(b, mark);
  S.crownmark = mark;
  // the nested rings fill the volume above, from the Crownmark's own origin
  const rings = props.nestedRings({ radius: 60, clearRadius: FLOOR_R + 3, clearHeight: 7 });
  rings.object.position.copy(b.P(C.x, C.n, DAIS_H));
  rings.params.energy = 0.45;
  rings.params.spin = 1;
  b.add(rings.object);
  S.rings = rings;
  // the two assent interfaces: independent, one each side; sunk until the protocol raises them
  placePad(b, S.padT, props.assentInterface('tarrik'), C.x - PAD.dx, C.n + PAD.dn, PAD.yawT);
  placePad(b, S.padS, props.assentInterface('selene'), C.x + PAD.dx, C.n + PAD.dn, PAD.yawS);
  // the diagnostic display stands before the Crownmark; the forecast reads over Selene's console
  const diag = props.hologram('diagnostic');
  diag.object.position.copy(b.P(CONSOLE.x, CONSOLE.n + 0.2, 1.25));
  diag.object.rotation.y = b.yaw(200);
  diag.object.scale.setScalar(1.05);
  diag.params.visible = 0;
  diag.params.progress = 0;
  b.add(diag.object);
  S.diag = diag;
  const fc = props.hologram('forecast');
  fc.object.position.copy(b.P(C.x - 4.6, C.n - 7.2, 0.6));
  fc.object.rotation.y = b.yaw(195);
  fc.params.visible = 0;
  fc.setText('02:11:43');
  b.add(fc.object);
  S.forecast = fc;
  b.prop('ancientConsole', { x: CONSOLE.x, n: CONSOLE.n, yawDeg: 200 });
  for (const p of [mark, rings, diag, fc, S.padT.prop, S.padS.prop]) if (p) b.onUpdate((dt, t) => p.update(dt, t));
  // the five Meridian lights, high over the dais in the order Ianis, Caerion II, Neon Veil, Cauldron, Aurelion
  const geo = new THREE.SphereGeometry(0.42, 18, 12);
  S.lightGeo = geo;
  const mat = b.game.mats.emissive(0xfff0d0, 7);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + Math.PI;
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(b.P(C.x + Math.sin(a) * 7.5, C.n + Math.cos(a) * 7.5, 13));
    m.visible = false;
    b.add(b.keep(m));
    S.lights.push(m);
  }
  S.disposers.push(() => geo.dispose());
}

function placePad(b: ZoneBuilder, st: PadState, prop: HeroProp<{ active: number; assent: number }>, x: number, n: number, yawDeg: number): void {
  st.prop = prop;
  st.base.copy(b.P(x, n, DAIS_H));
  prop.object.position.copy(st.base);
  prop.object.rotation.y = b.yaw(yawDeg);
  b.add(prop.object);
  const cs = propColliders(b, prop);
  st.collider = cs[0] ?? null;
  for (const c of cs) c.enabled = false;
  prop.object.position.y -= PAD_SUNK;
  prop.object.visible = false;
}

function buildLight(b: ZoneBuilder): void {
  // the focal shaft on the Crownmark (the concept's vertical light), and the two interfaces
  b.spot({ x: C.x + 2, n: C.n - 7, h: 18, target: [C.x, C.n, 1.2], angleDeg: 20, intensity: 900, shaft: true, color: 0xfff0d8, shadow: true });
  b.spot({ x: C.x - 6, n: C.n - 8, h: 9, target: [C.x - PAD.dx, C.n + PAD.dn, 0.8], angleDeg: 24, intensity: 260, color: 0xffe2b8 });
  b.spot({ x: C.x + 6, n: C.n - 8, h: 9, target: [C.x + PAD.dx, C.n + PAD.dn, 0.8], angleDeg: 24, intensity: 260, color: 0xdfe8ff });
  // cool fills so the figures separate from the stone; a warm bounce off the dais
  b.point({ x: C.x - 12, n: C.n - 12, h: 5, color: 0xb0bcff, intensity: 60, distance: 30 });
  b.point({ x: C.x + 12, n: C.n - 10, h: 5, color: 0xb8c4ff, intensity: 55, distance: 30 });
  b.point({ x: C.x, n: C.n + 10, h: 4, color: IVORY, intensity: 40, distance: 24 });
  b.point({ x: C.x, n: 2.5, h: 3.5, color: GOLD, intensity: 16, distance: 12 });
}

function buildMarkers(b: ZoneBuilder): void {
  b.marker('start', C.x - 0.6, -5.4, 0, FACE.north);
  b.marker('seleneStart', C.x + 0.9, -6.4, 0, FACE.north);
  b.marker('arrive', C.x - 0.8, 3.2, 0, FACE.north);
  b.marker('seleneArrive', C.x + 1.0, 2.6, 0, FACE.north);
  b.marker('daisFront', C.x, C.n - 8.4, 0, FACE.north);
  // diagnostic: Selene works the console; Tarrik paces the ring
  b.marker('seleneConsole', CONSOLE.x - 0.45, CONSOLE.n - 1.0, 0, 20);
  b.marker('tarrikDais', C.x - 1.9, C.n - 8.2, 0, 20);
  b.marker('tarrikRing1', C.x - 10.5, C.n - 7.5, 0, 60);
  b.marker('tarrikRing2', C.x - 13, C.n + 1.5, 0, 110);
  b.marker('tarrikComm', C.x - 6.2, C.n - 9.8, 0, 70);
  b.marker('tarrikShoulder', C.x - 0.5, C.n - 7.7, 0, 10);
  b.marker('seleneShoulder', C.x + 0.55, C.n - 7.5, 0, 350);
  // the interfaces: stand points in front of each, the palm on its slanted top (from the prop sockets)
  for (const [key, st] of [['T', S.padT], ['S', S.padS]] as const) {
    const prop = st.prop;
    if (!prop) continue;
    const y0 = prop.object.position.y;
    prop.object.position.y = st.base.y;
    prop.object.updateMatrixWorld(true);
    const v = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const stand = prop.socket('stand');
    const hand = prop.socket('hand');
    if (stand) {
      stand.getWorldPosition(v);
      stand.getWorldQuaternion(q);
      const yaw = new THREE.Euler().setFromQuaternion(q, 'YXZ').y;
      b.marker(`stand${key}`, v.x, -v.z, DAIS_H, (-yaw * 180) / Math.PI);
    }
    if (hand) {
      hand.getWorldPosition(v);
      b.marker(`hand${key}`, v.x, -v.z, v.y);
    }
    b.marker(`pad${key}`, st.base.x, -st.base.z, DAIS_H);
    prop.object.position.y = y0;
  }
  b.marker('daisCenter', C.x, C.n, DAIS_H);
  b.marker('lift', LIFT.x, LIFT.n, 0, FACE.north);
  b.marker('liftApproach', LIFT.x, LIFT.n - 3.2, 0, FACE.north);
}

/** the far field: the terminal's dark structure all round, dust in the shaft */
export function buildScenic(b: ZoneBuilder): void {
  const game = b.game;
  const vista = game.sky.scenic.terminalVista({ radius: 2200, drop: 260, density: 0.7, clearWound: false });
  vista.position.copy(b.P(C.x, C.n + 140, -40));
  b.add(vista);
  const back = game.sky.scenic.megaRibs({ count: 5, span: 260, height: 300, spacing: 140 });
  back.position.copy(b.P(C.x, C.n - 120, -120));
  back.rotation.y = Math.PI;
  b.add(back);
  game.vfx.ambient('goldMotes', b.P(C.x, C.n, 4), { x: 24, y: 10, z: 24 }, 0.4);
  game.vfx.ambient('dust', b.P(C.x, C.n, 6), { x: 50, y: 12, z: 50 }, 0.3);
}
