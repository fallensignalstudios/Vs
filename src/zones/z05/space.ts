/**
 * Z05 — build(): the platform-and-bridge network, the gates, the exit down to the lower corridor, the shaft
 * and its lift plate, the control ring, faction clutter, light, markers and the scenic atrium. Layout numbers
 * live in ./layout.ts. Only build-time code here.
 */
import * as THREE from 'three';
import type { ZoneBuilder } from '@/core/api';
import { LOOKS } from '@/render/looks';
import { AMBER, BLUE, GOLD, IVORY } from '../shared';
import {
  BRIDGE_W, CN, CX, EXIT_DROP, MARKS, RING, RING_FACE, R_LIFT, R_PARAPET, R_PLAT, R_RAMP0, R_RAMP1, R_SHAFT, R_VOID,
  at, pol, step,
} from './layout';
import { S } from './state';

/** half-angle (deg) of a 6 m bridge's gap in the platform rim */
const RIM_GAP = 5.4;

export function buildSpace(b: ZoneBuilder): void {
  const game = b.game;
  // sky state persists between zone loads (and a reload of this zone): start the atrium from a clean sky
  game.sky.reset();
  b.setEnv({ sky: 'battleCeiling', look: LOOKS.atrium, ambience: 'atrium', music: 'atrium' });
  S.centre.copy(b.P(CX, CN, 0));
  S.key = b.keyLight;
  S.keyBase = b.keyLight ? b.keyLight.intensity : 2;

  buildPlatform(b);
  buildShaft(b);
  buildBridges(b);
  buildExit(b);
  buildDressing(b);
  buildRing(b);
  buildLight(b);
  buildMarkers(b);
  buildScenic(b);
  b.finalize();
}

/** the Ø72 disc with the Ø18 shaft opening, its rim, the keel under it, and the pylon ring */
function buildPlatform(b: ZoneBuilder): void {
  b.disc({
    x: CX, n: CN, r: R_PLAT, inner: R_SHAFT, inlay: 'radial', reflective: true, thickness: 0.8, mat: 'blackStoneFloor',
    rim: { gapsDeg: [[-RIM_GAP, RIM_GAP], [90 - RIM_GAP, 90 + RIM_GAP], [180 - RIM_GAP, 180 + RIM_GAP], [270 - RIM_GAP, 270 + RIM_GAP]] },
  });
  // eight lit King-era pylons stand round the platform, off the bridge bearings
  for (let i = 0; i < 8; i++) {
    const [x, n] = pol(30.5, 22.5 + i * 45);
    b.column({ x, n, r: 0.75, height: 13, style: 'pylon', lit: true });
  }
  // a gold channel ring halfway out: route light round the shaft
  const ring: Array<[number, number]> = [];
  for (let i = 0; i <= 48; i++) ring.push(pol(21, (i / 48) * 360));
  b.channel(ring, { width: 0.08, intensity: 1.6 });
  b.add(keel());
}

/** the parapet round the shaft, the walkway on its west lip and the lift plate in its middle (the way below) */
function buildShaft(b: ZoneBuilder): void {
  const gap = (Math.asin(1.7 / R_PARAPET) * 180) / Math.PI;
  b.ringWall({ x: CX, n: CN, r: R_PARAPET, height: 1.1, thickness: 0.4, style: 'plain', mat: 'blackStone', gapsDeg: [[270 - gap, 270 + gap]], segments: 40 });
  const [wx0, wn] = at(-R_SHAFT - 0.3, 0);
  const [wx1] = at(-R_LIFT + 0.2, 0);
  b.bridge({ from: [wx0, wn], to: [wx1, wn], width: 3 });
  b.disc({ x: CX, n: CN, r: R_LIFT, inlay: 'crownmark', thickness: 1.2, mat: 'blackStoneFloor', rim: { gapsDeg: [[250, 290]] } });
  // nobody goes below: the walkway is closed to the player (the script never sends anyone onto it)
  const [gx, gn] = at(-R_PARAPET - 0.7, 0);
  b.blocker({ x: gx, n: gn, w: 0.6, d: 3.6, height: 2.2 });
  // white-gold darkness: the liner falls away in light rings
  b.add(shaftLiner(b.P(CX, CN, 0)));
}

/** the four 6 m bridges on the cardinals: south gate (entry), north gate (the Dominion side), east broken */
function buildBridges(b: ZoneBuilder): void {
  const r0 = R_PLAT - 0.4;
  b.bridge({ from: pol(r0, 180), to: pol(R_VOID + 0.4, 180), width: BRIDGE_W });
  b.bridge({ from: pol(r0, 0), to: pol(R_VOID + 0.4, 0), width: BRIDGE_W });
  b.bridge({ from: pol(r0, 90), to: pol(56, 90), width: BRIDGE_W, broken: 'far' });
  S.entry = gate(b, 180);
  S.entry.setState('sealed');
  S.north = gate(b, 0);
  S.north.setOpen(true, { instant: true, silent: true });
  S.north.setState('open');
}

/**
 * A gatehouse on the scenic ring floor at the end of a bridge: a panelled front with a 5 × 5 m door and a lit
 * vestibule behind it. Visual only beyond the door (nobody walks there).
 */
function gate(b: ZoneBuilder, bearingDeg: number): ReturnType<ZoneBuilder['door']> {
  const r = R_VOID + 0.6;
  const a = (bearingDeg * Math.PI) / 180;
  const tx = Math.cos(a);
  const tn = -Math.sin(a); // tangent (to the right, looking outward)
  const [cx, cn] = pol(r, bearingDeg);
  const half = 5;
  b.wall({ from: [cx - tx * half, cn - tn * half], to: [cx + tx * half, cn + tn * half], height: 7.5, style: 'ribbed', doors: [{ at: half, width: 5, height: 5 }] });
  for (const s of [-1, 1]) b.column({ x: cx + tx * (half + 0.9) * s, n: cn + tn * (half + 0.9) * s, r: 0.6, height: 9.5, style: 'pylon', lit: true });
  const [bx, bn] = pol(r + 6.5, bearingDeg);
  for (const s of [-1, 1]) {
    const [sx, sn] = [cx + tx * 3.4 * s, cn + tn * 3.4 * s];
    b.wall({ from: [sx, sn], to: [sx + (bx - cx), sn + (bn - cn)], height: 6.2, style: 'plain', noCollider: true });
  }
  b.wall({ from: [bx - tx * 3.6, bn - tn * 3.6], to: [bx + tx * 3.6, bn + tn * 3.6], height: 6.2, style: 'panelled', noCollider: true });
  const [mx, mn] = pol(r + 3.25, bearingDeg);
  b.ceiling({ x: mx, n: mn, w: 6.8, d: 6.5, h: 6.2, yawDeg: bearingDeg, style: 'flat' });
  b.panelLight({ x: mx, n: mn, w: 2.4, d: 3, h: 6.1, facing: 'down', intensity: 1.6 });
  return b.door({ x: cx, n: cn, yawDeg: bearingDeg, width: 5, height: 5 });
}

/** the west bridge, the ramp down to the corridor below, the landing, the exit door, the white point */
function buildExit(b: ZoneBuilder): void {
  b.bridge({ from: pol(R_PLAT - 0.4, 270), to: pol(R_RAMP0, 270), width: BRIDGE_W });
  const run = R_RAMP1 - R_RAMP0;
  const [rx, rn] = pol((R_RAMP0 + R_RAMP1) / 2, 270);
  b.ramp({ x: rx, n: rn, w: BRIDGE_W, d: run, h0: -EXIT_DROP, h1: 0, yawDeg: 90, rails: true });
  const land = 3.9;
  const [lx, ln] = pol(R_RAMP1 + land / 2, 270);
  b.deck({ x: lx, n: ln, w: land, d: BRIDGE_W + 2, h: -EXIT_DROP, thickness: 0.7, rails: ['n', 's'], inlay: 'channels', supports: false });
  // the door in the shaft wall, under the lip of the scenic ring floor
  const wx = CX - (R_RAMP1 + land);
  b.wall({ from: [wx, CN - 7], to: [wx, CN + 7], h: -EXIT_DROP, height: EXIT_DROP + 0.4, style: 'panelled', doors: [{ at: 7, width: 3, height: 3.5 }] });
  S.exit = b.door({ x: wx, n: CN, h: -EXIT_DROP, yawDeg: 270 });
  S.exit.setState('locked');
  // the lower corridor beyond: lit, empty, short
  const vx = wx - 3;
  b.floor({ x: vx, n: CN, w: 6, d: 4.4, h: -EXIT_DROP, inlay: 'none' });
  b.wall({ from: [wx, CN - 2.2], to: [wx - 6, CN - 2.2], h: -EXIT_DROP, height: 3.7 });
  b.wall({ from: [wx, CN + 2.2], to: [wx - 6, CN + 2.2], h: -EXIT_DROP, height: 3.7 });
  b.wall({ from: [wx - 6, CN - 2.2], to: [wx - 6, CN + 2.2], h: -EXIT_DROP, height: 3.7, style: 'panelled' });
  b.ceiling({ x: vx, n: CN, w: 6, d: 4.4, h: -EXIT_DROP + 3.7, style: 'flat' });
  b.panelLight({ x: wx - 5.6, n: CN, w: 2.2, d: 2.6, h: -EXIT_DROP + 0.9, facing: 'east', intensity: 2.2 });
  // the white point sits just above platform level, so it reads from the meeting ground as the way out
  b.whitePoint({ x: wx + 0.5, n: CN, h: -EXIT_DROP + 5.1, intensity: 1.8 });
  for (const s of [-1, 1]) b.column({ x: wx + 0.9, n: CN + s * 3.5, h: -EXIT_DROP, height: 7.2, style: 'pylon', lit: true });
  b.channel([pol(R_PLAT - 6, 270), pol(R_RAMP0, 270)], { width: 0.07, intensity: 1.4 });
}

/** faction gear is temporary clutter at each bridge head; ancient wreckage east of the shaft */
function buildDressing(b: ZoneBuilder): void {
  const p = (dx: number, dn: number) => at(dx, dn);
  // Reformation: Selene's people came in from the south
  b.prop('refSensorMast', { x: p(5.2, -28)[0], n: p(5.2, -28)[1], yawDeg: 20 });
  b.prop('refCrate', { x: p(6.8, -30.4)[0], n: p(6.8, -30.4)[1], yawDeg: 12, variant: 1 });
  b.prop('refCrate', { x: p(4.1, -31.8)[0], n: p(4.1, -31.8)[1], yawDeg: -20, variant: 0 });
  b.prop('refLamp', { x: p(7.8, -27.6)[0], n: p(7.8, -27.6)[1], yawDeg: 300 });
  b.prop('refAmmoCase', { x: p(-5.6, -31.2)[0], n: p(-5.6, -31.2)[1], yawDeg: 70 });
  // Dominion: the squad's kit at the north bridge head
  b.prop('domCrate', { x: p(5.4, 29.4)[0], n: p(5.4, 29.4)[1], yawDeg: 18 });
  b.prop('domCrate', { x: p(7.1, 31)[0], n: p(7.1, 31)[1], yawDeg: -12, variant: 1 });
  b.prop('domLamp', { x: p(4.3, 32.4)[0], n: p(4.3, 32.4)[1], yawDeg: 160 });
  b.prop('domFieldCache', { x: p(-6.2, 31.6)[0], n: p(-6.2, 31.6)[1], yawDeg: 200 });
  // ancient furniture and wreckage, kept off the meeting ground
  b.prop('fallenPlate', { x: p(16.5, -11)[0], n: p(16.5, -11)[1], yawDeg: 35 });
  b.prop('rubblePile', { x: p(18.5, 7.5)[0], n: p(18.5, 7.5)[1] });
  b.prop('debrisSmall', { x: p(14.2, 2.6)[0], n: p(14.2, 2.6)[1], yawDeg: 120 });
  b.prop('debrisSmall', { x: p(-24.5, 13.5)[0], n: p(-24.5, 13.5)[1], yawDeg: 40 });
  b.prop('debrisSmall', { x: p(22, -20)[0], n: p(22, -20)[1], yawDeg: 210 });
  b.prop('ancientPedestal', { x: p(13.5, 13.5)[0], n: p(13.5, 13.5)[1], yawDeg: 225 });
  b.prop('ancientPedestal', { x: p(13.5, -13.5)[0], n: p(13.5, -13.5)[1], yawDeg: 315 });
  b.prop('ancientConsole', { x: p(-6.4, 18.5)[0], n: p(-6.4, 18.5)[1], yawDeg: 160 });
  b.coverLow({ x: p(24, -3)[0], n: p(24, -3)[1], yawDeg: 90, style: 'ancient' });
  b.coverLow({ x: p(-3, 24)[0], n: p(-3, 24)[1], yawDeg: 0, style: 'debris' });
}

/** the control ring (stabilizer) and Tharne's trajectory overlay above it */
function buildRing(b: ZoneBuilder): void {
  const game = b.game;
  const [x, n] = at(RING[0], RING[1]);
  const stab = game.props.stabilizer();
  const pos = b.P(x, n, 0);
  const yaw = b.yaw(RING_FACE);
  stab.object.position.copy(pos);
  stab.object.rotation.y = yaw;
  stab.params.active = 0;
  stab.params.plane = 0;
  b.add(stab.object);
  for (const c of stab.colliders ?? []) {
    const o = c.offset;
    b.collider({
      shape: c.shape, x: pos.x + o.x * Math.cos(yaw) + o.z * Math.sin(yaw), y: pos.y + o.y,
      z: pos.z - o.x * Math.sin(yaw) + o.z * Math.cos(yaw), yaw: yaw + (c.yaw ?? 0), tag: 'prop:stabilizer',
    });
  }
  b.onUpdate((dt, t) => stab.update(dt, t));
  S.stab = stab;

  const holo = game.props.hologram('trajectory');
  const [hx, hn] = step(RING[0], RING[1], 3.6, RING_FACE + 180);
  holo.object.position.copy(b.P(CX + hx, CN + hn, 0));
  holo.object.rotation.y = b.yaw(RING_FACE);
  holo.params.visible = 0;
  holo.params.progress = 0;
  holo.setText('IMPACT 01:30'); // NEW (command-strip readout, SCRIPT_SOURCE Z05 carrier)
  b.add(holo.object);
  b.onUpdate((dt, t) => holo.update(dt, t));
  S.holo = holo;
}

/** a dozen lights at most: key (setEnv), the battle light, one shaft on the meeting ground, faction accents */
function buildLight(b: ZoneBuilder): void {
  const p = (dx: number, dn: number, h: number) => ({ x: CX + dx, n: CN + dn, h });
  // a cool pool of ceiling light on the meeting ground (no visible cone: nothing up there could hold a lamp)
  b.spot({ ...p(-14, -2, 44), target: [CX - 14, CN - 1, 0], angleDeg: 15, intensity: 9000, color: 0xdde6ff });
  b.point({ ...p(5.6, 30.6, 1.6), color: AMBER, intensity: 16, distance: 10 });
  b.point({ ...p(5.4, -29.6, 2.2), color: BLUE, intensity: 20, distance: 11 });
  // white-gold darkness below: the shaft is lit from far down
  b.point({ ...p(0, 0, -6), color: IVORY, intensity: 160, distance: 30 });
  b.point({ ...p(RING[0], RING[1], 3.6), color: IVORY, intensity: 10, distance: 9 });
  // the fleet battle through the ceiling: a soft, shadowless light that follows sky.battleGlow (state.ts)
  const battle = new THREE.DirectionalLight(0x8090c0, 0.4);
  battle.name = 'z05-battle';
  battle.position.copy(b.P(CX + 20, CN + 30, 120));
  battle.target.position.copy(b.P(CX, CN, 0));
  b.root.add(battle, battle.target);
  S.battle = battle;
}

function buildMarkers(b: ZoneBuilder): void {
  for (const [name, [dx, dn, h, yaw]] of Object.entries(MARKS)) b.marker(name, CX + dx, CN + dn, h, yaw);
  const back = RING_FACE + 180;
  b.marker('ring', CX + RING[0], CN + RING[1], 0, back);
  const e = step(RING[0], RING[1], 1.75, RING_FACE);
  b.marker('ringEntry', CX + e[0], CN + e[1], 0, back);
  const t = step(RING[0], RING[1], 2.6, RING_FACE);
  b.marker('tarrikBehind', CX + t[0], CN + t[1], 0, back);
  b.marker('planeCenter', CX + RING[0], CN + RING[1], 3.3, back);
  b.marker('centre', CX, CN, 0, 0);
}

/** the ~300 m atrium around the platform; the carrier's pass is anchored to the same frame */
function buildScenic(b: ZoneBuilder): void {
  const game = b.game;
  const shell = game.sky.scenic.atriumShell({ radius: 150, height: 150, shaftRadius: R_VOID, tiers: 4, seed: 505 });
  shell.position.copy(S.centre);
  b.add(shell);
  const carrier = game.sky.carrier;
  carrier.setAnchor(S.centre, 0);
  carrier.visible = false;
  carrier.setProgress(0);
  carrier.setStabilized(0);
  game.sky.setBattleIntensity(0.55);
  game.vfx.ambient('dust', b.P(CX - 10, CN, 4), { x: 60, y: 10, z: 50 }, 0.45);
  game.vfx.ambient('goldMotes', b.P(CX, CN, 2), { x: 30, y: 6, z: 30 }, 0.3);
}

// ---------------------------------------------------------------------------------------------------------
// Custom scenic geometry (shared materials, built once per module and reused across loads)
// ---------------------------------------------------------------------------------------------------------

let keelMat: THREE.MeshStandardMaterial | null = null;
let linerMat: THREE.MeshStandardMaterial | null = null;
let ringMat: THREE.MeshStandardMaterial | null = null;

/** the platform's underside: a stepped inverted bowl so the disc reads as structure hanging in the void */
function keel(): THREE.Object3D {
  keelMat ??= new THREE.MeshStandardMaterial({ color: 0x15161b, roughness: 0.3, metalness: 0.55 });
  ringMat ??= new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(GOLD), emissiveIntensity: 2.2 });
  const g = new THREE.Group();
  g.name = 'z05-keel';
  const pts = [[9.5, -46], [12, -38], [15, -27], [21, -16], [28, -8], [33, -3.4], [35.6, -1.6], [36, -0.8]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  const body = new THREE.Mesh(new THREE.LatheGeometry(pts, 72), keelMat);
  g.add(body);
  for (const [r, y] of [[33.4, -3.3], [27.6, -8.3], [20.6, -16.5]] as const) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(r, 0.12, 6, 96), ringMat);
    band.rotation.x = Math.PI / 2;
    band.position.y = y;
    g.add(band);
  }
  g.position.set(CX, 0, -CN);
  return g;
}

/** the shaft's inner wall, falling away in light rings into white-gold darkness */
function shaftLiner(centre: THREE.Vector3): THREE.Object3D {
  linerMat ??= new THREE.MeshStandardMaterial({ color: 0x3a342a, roughness: 0.42, metalness: 0.5, side: THREE.BackSide });
  const g = new THREE.Group();
  g.name = 'z05-shaft';
  const depth = 70;
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(R_SHAFT, R_SHAFT * 0.82, depth, 64, 1, true), linerMat);
  wall.position.y = -0.6 - depth / 2;
  g.add(wall);
  const glow = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: new THREE.Color(IVORY), emissiveIntensity: 2.6 });
  [-3.2, -8, -14.5, -23, -34, -48].forEach((y, i) => {
    const r = R_SHAFT * (1 - (0.18 * -y) / depth) - 0.08;
    const band = new THREE.Mesh(new THREE.TorusGeometry(r, 0.09 + i * 0.03, 6, 96), glow);
    band.rotation.x = Math.PI / 2;
    band.position.y = y;
    g.add(band);
  });
  g.position.copy(centre);
  return g;
}
