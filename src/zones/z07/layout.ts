/**
 * Z07 — the space (plan coordinates: origin at the south-west corner, x east, n north). A 34 × 22 m
 * capture-control gallery below grade (authored at local 0): white-gold walls, a black ceiling, gold channels in a
 * black mirror floor; dim and technical, lit by its glass and its own strips.
 *
 *   north   a 7 m GLASS WALL the whole length of the room — it looks OUT of the terminal. Beyond it, ~120 m out
 *           and in two directions, the two containment cages float in vacuum: the Crownwatch resonator dead ahead
 *           of the fire-control station's sighting ring, the Reformation extraction drone's cold-field envelope
 *           to the north-east. Below them the terminal's own converging structure falls away. Nobody walks to a
 *           cage.
 *   at the glass   the external FIRE-CONTROL STATION (centre-west, operator on its south side, the shot laid
 *           through its sighting ring), the fixed AUXILIARY DESK with the interoperability display over it (west,
 *           beside the pylon Lyric sits against).
 *   south   the RECOVERY PANEL (facing south: stretcher bay west, walker bay east), a little west of the exit
 *           door to Z08 (south wall, white point) so it never hides the door. The two auxiliary survivor routes
 *           leave through the west and east walls (n 4.5): the stretcher cases wait by the west one, the walking
 *           wounded by the east one; falling plating constricts both mouths in `choice`.
 *   west    the entry from Z06 (n 13), and the O3 side console by the glass (a Reformation console with the
 *           contamination record over it), a few steps from where Lyric sits.
 */
import * as THREE from 'three';
import type { ZoneBuilder } from '@/core/api';
import { LOOKS } from '@/render/looks';
import { AMBER, BLUE, FACE, GOLD, IVORY, VIOLET } from '../shared';
import { textPanel } from './display';
import { S, type CageRig } from './state';

// =====================================================================================================================
// Constants
// =====================================================================================================================

/** playable envelope (plan §Z07: 34 × 22 m, at −3 — authored at local 0) */
export const W = 34;
export const D = 22;
/** wall height (the glass runs floor to ceiling) */
const WALL_H = 7;
/** entry (west wall) from Z06; exit (south wall) to Z08 */
const ENTRY_N = 13;
export const EXIT_X = 17;
/** the two auxiliary survivor routes leave through the west and east walls at this n */
const ROUTE_N = 4.5;
/** corridor length beyond each route opening */
const ROUTE_LEN = 6;
/** glass pylons (x) along the north wall: a clear window in front of the station */
const PYLONS = [4.4, 10, 24, 29.6] as const;
const PYLON_N = 21.15;
/** the external fire-control station (operator south of it) and the auxiliary desk */
const STATION: [number, number] = [14, 19.75];
const DESK: [number, number] = [7.4, 19.55];
/** the recovery panel (faces south) and the O3 console (west wall, by the glass) */
const PANEL: [number, number] = [12.6, 7.6];
const O3: [number, number] = [0.95, 17.4];
/** the cages: plan position, height, scale (≈ 24 m across, ~120 m out), and the bearing they face (the gallery) */
const CAGE_DOM = { x: 5, n: 140, h: -2.5, scale: 3.5, yawDeg: 176 } as const; // dead ahead of the sighting ring
const CAGE_REF = { x: 78, n: 128, h: -9, scale: 3.5, yawDeg: 208 } as const;
/** the cages' field / core height above their own origin at scale 1 (the Dominion core sits higher) */
const CORE_H = { dominion: 3.6, reformation: 3.2 } as const;

// =====================================================================================================================
// Build
// =====================================================================================================================

export function build(b: ZoneBuilder): void {
  const sky = b.game.sky;
  sky.setHeading(0);
  b.setEnv({
    sky: 'breachDeep',
    // the gallery look, with the haze thinned a little: the room looks out into vacuum. Integration wave (quarantine
    // painting): a little more cool fill so the figures read against the walls, the gold staying the only warmth
    look: {
      ...LOOKS.gallery, exposure: 1.18, envIntensity: 1.15, fog: { color: 0x101820, density: 0.012 },
      // polish 4: more fill now that the strips no longer light the room (the slots and their fixtures do)
      ambient: { sky: 0x7a8294, ground: 0x1c1813, intensity: 0.68 },
    },
    ambience: 'gallery', music: 'breach',
    // cold exterior light falling steeply through the glass (steep: the mirror floor would glint otherwise)
    key: { dirFrom: [5, 12, 30], intensity: 1.15, color: 0xc8d6f2 },
  });
  sky.setBattleIntensity(0.7);
  buildShell(b);
  buildRoutes(b);
  buildStations(b);
  buildDressing(b);
  buildLight(b);
  buildMarkers(b);
  buildCages(b);
  buildDisplays(b);
  buildScenic(b);
  b.finalize();
}

/**
 * floor, walls, the glass, ceiling, entry and exit. Integration wave (quarantine painting, which sets the look of
 * the Z06–Z08 interiors): white-gold walls (silver stone) and pylons over the black mirror floor, under a black
 * ceiling — the lower terminal's black stone starts with the Z09 descent (plan p. 12).
 */
function buildShell(b: ZoneBuilder): void {
  b.floor({ x: W / 2, n: D / 2, w: W, d: D, mat: 'blackStoneFloor', reflective: true, inlay: 'channels' });
  // west: entry from Z06 and the west survivor route
  // (polish 4: gold-framed recessed panels and marble slabs — the painting's walls; the colliders are the plain walls')
  b.wall({
    from: [0, 0], to: [0, D], height: WALL_H, style: 'framed',
    doors: [{ at: ROUTE_N, width: 3, height: 3.5 }, { at: ENTRY_N, width: 3, height: 3.5 }],
  });
  b.door({ x: 0, n: ENTRY_N, yawDeg: FACE.east, style: 'threshold' }).setState('sealed');
  // east: the east survivor route
  b.wall({ from: [W, 0], to: [W, D], height: WALL_H, style: 'framed', doors: [{ at: ROUTE_N, width: 3, height: 3.5 }] });
  // south: the exit to Z08
  b.wall({ from: [0, 0], to: [W, 0], height: WALL_H, style: 'slab', doors: [{ at: EXIT_X, width: 3, height: 3.5 }] });
  // north: the glass, floor to ceiling, on white-gold pylons
  b.wall({ from: [0, D], to: [W, D], height: WALL_H, mat: 'blackStone', style: 'glass' });
  // white-gold pylons (silver stone, the painting's pale pillars) frame the glass; polish 4: fine gold, no strips
  for (const x of PYLONS) b.column({ x, n: PYLON_N, r: 0.5, height: WALL_H, style: 'pylon' });
  // (polish 4: its light troughs kept soft — they read as neon bars at full glow)
  b.ceiling({ x: W / 2, n: D / 2, w: W, d: D, h: WALL_H, mat: 'blackStone', style: 'flat', glow: 0.4 });

  // exit: door, a short lit vestibule beyond it (the way down), the white point above
  S.exit = b.door({ x: EXIT_X, n: 0, style: 'threshold' });
  S.exit.setState('locked');
  b.floor({ x: EXIT_X, n: -2.6, w: 4.4, d: 5.2, mat: 'blackStoneFloor', inlay: 'none' });
  b.wall({ from: [EXIT_X - 2.2, 0], to: [EXIT_X - 2.2, -5.2], height: 4.2 });
  b.wall({ from: [EXIT_X + 2.2, 0], to: [EXIT_X + 2.2, -5.2], height: 4.2 });
  b.wall({ from: [EXIT_X - 2.2, -5.2], to: [EXIT_X + 2.2, -5.2], height: 4.2, style: 'panelled' });
  b.ceiling({ x: EXIT_X, n: -2.6, w: 4.4, d: 5.2, h: 4.2, mat: 'blackStone', style: 'flat' });
  b.panelLight({ x: EXIT_X, n: -4.8, w: 2.4, d: 2.6, h: 0.9, facing: 'north', intensity: 2.0 });
  b.whitePoint({ x: EXIT_X, n: 0.9, h: 5.2, intensity: 1.8 });
  b.column({ x: EXIT_X - 3.2, n: 0.7, height: 6.2, style: 'pylon' });
  b.column({ x: EXIT_X + 3.2, n: 0.7, height: 6.2, style: 'pylon' });
  // gold route light from the panel to the door
  b.channel([[PANEL[0], 6.0], [PANEL[0] + 1.2, 4.6], [EXIT_X, 4.6], [EXIT_X, 1.2]], { width: 0.07 });
}

/**
 * The two auxiliary survivor routes: a short corridor beyond each side wall, falling away toward Z08. Falling
 * plating (hidden until the `choice` beat drops it) constricts each mouth without closing it.
 */
function buildRoutes(b: ZoneBuilder): void {
  for (const side of [-1, 1] as const) {
    const x0 = side < 0 ? 0 : W;
    const x1 = x0 + side * ROUTE_LEN;
    const cx = (x0 + x1) / 2;
    b.floor({ x: cx, n: ROUTE_N, w: ROUTE_LEN, d: 3.4, mat: 'blackStoneFloor', inlay: 'none' });
    b.wall({ from: [x0, ROUTE_N - 1.7], to: [x1, ROUTE_N - 1.7], height: 4 });
    b.wall({ from: [x0, ROUTE_N + 1.7], to: [x1, ROUTE_N + 1.7], height: 4 });
    b.wall({ from: [x1, ROUTE_N - 1.7], to: [x1, ROUTE_N + 1.7], height: 4, doors: [{ at: 1.7, width: 2.6, height: 3 }] });
    b.door({ x: x1, n: ROUTE_N, yawDeg: FACE.east, width: 2.6, height: 3, style: 'service' }).setState('ready');
    b.ceiling({ x: cx, n: ROUTE_N, w: ROUTE_LEN, d: 3.4, h: 4, mat: 'blackStone', style: 'flat' });
    b.panelLight({ x: x1 - side * 0.4, n: ROUTE_N, w: 1.6, d: 1.4, h: 2.9, facing: side < 0 ? 'east' : 'west', intensity: 2.2 });
    // the plating that falls across the mouth: a ceiling panel wedged diagonally across the opening, its light
    // strip still lit, a plate and rubble under it — the south side stays passable
    const beam = b.keep(b.add(fallenPanel(b, x0 - side * 0.35, side)));
    const plate = b.keep(b.prop('fallenPlate', { x: x0 - side * 1.0, n: ROUTE_N + 1.1, yawDeg: side < 0 ? 80 : 280, scale: 0.55, collider: false }));
    const rubble = b.keep(b.prop('rubblePile', { x: x0 - side * 1.3, n: ROUTE_N + 1.5, yawDeg: 30, scale: 0.7, collider: false }));
    for (const o of [beam, plate, rubble]) {
      o.visible = false;
      S.plating.push(o);
    }
  }
  // the medics' field cache, staged inside the west route once the stretcher cases go first
  S.cacheWest = b.keep(b.prop('domFieldCache', { x: -3.6, n: ROUTE_N - 0.9, yawDeg: 0, collider: false }));
  S.cacheWest.visible = false;
}

/**
 * A fallen ceiling panel wedged across a route mouth (the wall plane at plan x = `x`): it runs from high on the
 * south jamb down to the floor on the north side; the light strip on its room-facing edge is still lit.
 * `side` −1 = west route (the room is to the east), +1 = east route.
 */
function fallenPanel(b: ZoneBuilder, x: number, side: -1 | 1): THREE.Group {
  const g = new THREE.Group();
  g.name = 'z07-plating';
  const top = b.P(x, ROUTE_N - 1.35, 3.25);
  const foot = b.P(x, ROUTE_N + 1.5, 0.08);
  const dir = foot.clone().sub(top);
  const len = dir.length();
  dir.normalize();
  const slab = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.18, len), b.mats.get('blackStone'));
  const strip = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.07, len * 0.86), b.mats.emissive(IVORY, 3));
  strip.position.x = -side * 0.51; // the edge that faces the room
  slab.castShadow = true;
  g.add(slab, strip);
  g.position.copy(top).add(foot).multiplyScalar(0.5);
  g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
  return g;
}

/** the fire-control station, the auxiliary desk, the recovery panel and the O3 console */
function buildStations(b: ZoneBuilder): void {
  b.prop('fireControlStation', { x: STATION[0], n: STATION[1] });
  b.prop('ancientConsole', { x: DESK[0], n: DESK[1], yawDeg: FACE.south });
  b.prop('recoveryPanel', { x: PANEL[0], n: PANEL[1], yawDeg: FACE.south });
  b.prop('refConsole', { x: O3[0], n: O3[1], yawDeg: FACE.east });
  // a gold thread from the desk to the station: the two places the room works from
  b.channel([[DESK[0] + 0.8, 18.4], [STATION[0] - 1.8, 18.4]], { width: 0.05, intensity: 1.6 });
}

/** the people's corners: Reformation kit by the east route, Dominion medical kit by the west route */
function buildDressing(b: ZoneBuilder): void {
  // west: the stretcher cases' corner
  b.prop('domCrate', { x: 1.4, n: 9.6, yawDeg: 90, variant: 1 });
  b.prop('medKit', { x: 6.0, n: 6.4, yawDeg: 20 });
  b.prop('domAmmoCase', { x: 1.3, n: 11.2, yawDeg: 80 });
  // east: the walking wounded
  b.prop('refCrate', { x: 32.6, n: 9.0, yawDeg: -6, variant: 0 });
  b.prop('refCrate', { x: 32.4, n: 1.4, yawDeg: 12, variant: 2 });
  b.prop('medKit', { x: 29.4, n: 2.0, yawDeg: 140 });
  b.prop('refSensorMast', { x: 32.9, n: 17.6, yawDeg: FACE.west });
  // the gallery's own furniture and wreckage
  b.prop('ancientBench', { x: 24.5, n: 13.5, yawDeg: FACE.north });
  b.prop('debrisSmall', { x: 21.5, n: 4.2, yawDeg: 40 });
  b.prop('debrisSmall', { x: 11.2, n: 12.6, yawDeg: 110 });
  b.prop('cableBundle', { x: 10.8, n: 17.2, yawDeg: 15 });
  // polish 4: tall soft-lit slots in the south and east walls (the painting's lit slots; the room's soft light now
  // that the strips are gone), two of them with a weak fixture light
  // (on the slab-clad south wall the slot stands on the cladding, 6 cm proud of the wall face)
  for (const x of [5.6, 11.2, 22.8, 28.4]) b.slot({ x, n: 0.37, h: 0.7, yawDeg: FACE.north, width: 0.6, height: 5.4, intensity: 1.15, color: 0xffe4bc, light: x === 11.2 || x === 22.8 });
  for (const n of [10.2, 15.2]) b.slot({ x: W - 0.3, n, h: 0.7, yawDeg: FACE.west, width: 0.6, height: 5.4, intensity: 1.15, color: 0xffe4bc });
  // polish 4: paired service pipes with brackets along the side walls (they were lit conduits)
  b.pipes([[0.3, 15, 5.6], [0.3, 21.2, 5.6]], { facing: 90, count: 2, r: 0.07, bracket: 1.6 });
  b.pipes([[33.7, 1, 0.3], [33.7, 1, 5.6], [33.7, 21.2, 5.6]], { facing: 270, count: 2, r: 0.07, bracket: 1.6, boxes: [1] });
}

/**
 * Lights: the key through the glass, a steep cold shaft on the station (the second shadow caster), faction
 * accents (amber by the medics, cold blue by the Reformation equipment — those flicker while the Eclipse uses
 * the field), a little gold fill. The props add their own small lights.
 */
function buildLight(b: ZoneBuilder): void {
  b.spot({ x: STATION[0] + 0.6, n: STATION[1] - 2.6, h: WALL_H - 0.3, target: [STATION[0], STATION[1] - 0.6, 0], angleDeg: 26, intensity: 260, shaft: true, shadow: true, color: 0xdfe8ff });
  b.point({ x: 3.0, n: 8.8, h: 2.6, color: AMBER, intensity: 18, distance: 9 });
  b.point({ x: EXIT_X, n: 11, h: 5.6, color: GOLD, intensity: 30, distance: 16 });
  // polish 4: a warm wash on the pale pylons at the glass from the room side, so the white-gold reads against the
  // vacuum outside (it replaces the light their strips gave)
  b.point({ x: 17, n: 16.5, h: 6.2, color: 0xffe0b4, intensity: 26, distance: 14 });
  // Reformation systems (flicker targets): Lyric's corner, the east route, the O3 console
  const ref = [
    b.point({ x: 5.6, n: 18.4, h: 2.4, color: BLUE, intensity: 14, distance: 8 }),
    b.point({ x: 31.4, n: 6.8, h: 2.8, color: BLUE, intensity: 20, distance: 10 }),
    b.point({ x: 2.2, n: 16.2, h: 2.6, color: BLUE, intensity: 10, distance: 7 }),
  ];
  S.refLights = ref;
  S.refLightBase = ref.map((l) => l.intensity);
}

function buildMarkers(b: ZoneBuilder): void {
  // --- entry ---
  b.marker('start', 2.4, ENTRY_N, 0, FACE.east);
  b.marker('tarrikEnter', 11.2, 16.6, 0, 50); // inside, a few steps from the station
  b.marker('lyessaStart', 8.4, 14.6, 0, 40);
  // --- the glass ---
  b.marker('station', STATION[0], STATION[1] - 1.2, 0, FACE.north); // the operator's place
  b.marker('stationRing', STATION[0], STATION[1] + 0.8, 1.86);
  b.marker('tarrikAside', 11.5, 18.4, 0, 70);
  b.marker('seleneGlass', 16.8, 20.35, 0, FACE.north);
  b.marker('lyric', PYLONS[0], PYLON_N - 0.92, 0, FACE.south); // sits against the pylon
  b.marker('tharne', PYLONS[0] + 1.15, PYLON_N - 1.45, 0, 290);
  b.marker('tharneDesk', DESK[0] + 0.15, DESK[1] - 1.05, 0, 20);
  b.marker('streams', DESK[0] + 0.3, DESK[1] + 0.55, 0.62, 125);
  // --- the decision ---
  b.marker('panel', PANEL[0], PANEL[1], 1.4, FACE.south);
  b.marker('panelUse', PANEL[0], PANEL[1] - 1.7, 0, FACE.north); // clear of the panel's own lamp
  b.marker('lyessaPanel', PANEL[0] + 1.6, PANEL[1] + 1.8, 0, 200);
  b.marker('lyessaWest', 2.2, 6.6, 0, 240);
  b.marker('lyessaEast', 31.6, 6.6, 0, 120);
  b.marker('westDeep', -ROUTE_LEN + 1.2, ROUTE_N - 0.4, 0, FACE.west);
  b.marker('eastDeep', W + ROUTE_LEN - 1.2, ROUTE_N - 0.5, 0, FACE.east);
  b.marker('eastDeep2', W + ROUTE_LEN - 2.2, ROUTE_N + 0.6, 0, FACE.east);
  b.marker('eastDeep3', W + ROUTE_LEN - 3.2, ROUTE_N - 0.6, 0, FACE.east);
  // --- the people: stretcher cases (west) and walking wounded (east), mixed uniforms ---
  b.marker('litterW1', 4.6, 7.2, 0, FACE.west);
  b.marker('litterW2', 4.9, 9.7, 0, FACE.west);
  b.marker('medicA', 4.5, 6.35, 0, FACE.north);
  b.marker('medicB', 4.8, 10.55, 0, FACE.south);
  b.marker('escortA', 6.4, 7.2, 0, FACE.west);
  b.marker('escortB', 6.7, 9.7, 0, FACE.west);
  b.marker('westEscortA', -2.9, ROUTE_N - 0.75, 0, FACE.west);
  b.marker('westEscortB', -2.9, ROUTE_N + 0.75, 0, FACE.west);
  b.marker('walkerA', 30.4, 7.7, 0, 240);
  b.marker('walkerB', 29.0, 5.6, 0, 300);
  b.marker('walkerC', 31.4, 2.6, 0, 320);
  // --- O3 and the exit ---
  b.marker('o3Use', O3[0] + 1.6, O3[1], 0, FACE.west);
  b.marker('o3Record', O3[0] - 0.4, O3[1] + 1.45, 0.55, FACE.east); // beside the console, not behind it
  b.marker('o3Tharne', O3[0] + 1.95, O3[1] + 2.6, 0, 225);
  b.marker('exit', EXIT_X, 1.6, 0, FACE.south);
}

/** the two cages beyond the glass: hero props at scenic distance, each rimmed by one zone light */
function buildCages(b: ZoneBuilder): void {
  const props = b.game.props;
  const rig = (kind: 'dominion' | 'reformation', o: typeof CAGE_DOM | typeof CAGE_REF, tint: number): CageRig => {
    // far outside in vacuum, seen through the glass: no room haze on it, and the brighter far-field frame, field
    // and own light so the silhouette carries at ~120 m (hero-props `distant`)
    const prop = props.containmentCage(kind, { fog: false, distant: true });
    const base = b.P(o.x, o.n, o.h);
    prop.object.position.copy(base);
    prop.object.rotation.y = b.yaw(o.yawDeg);
    prop.object.scale.setScalar(o.scale);
    prop.params.charge = 0.35;
    b.add(prop.object);
    b.onUpdate((dt, t) => prop.update(dt, t));
    // the rim light: in front of the cage (toward the gallery) and above it
    const toward = b.P(14, 20).sub(base).setY(0).normalize();
    const lp = base.clone().addScaledVector(toward, 14 * (o.scale / 3)).setY(base.y + 16);
    const light = new THREE.PointLight(tint, 0, 90, 2);
    light.position.copy(lp);
    b.add(light);
    const core = base.clone().setY(base.y + CORE_H[kind] * o.scale);
    const veins = buildVeins(b, kind);
    prop.object.add(veins);
    return { prop, base, core, light, veins, tint: new THREE.Color(tint), spread: 0, spreadTarget: 0, lit: 1, litTarget: 1, wisp: null };
  };
  S.dom = rig('dominion', CAGE_DOM, AMBER);
  S.ref = rig('reformation', CAGE_REF, BLUE);
}

/**
 * Violet veins that trace the containment geometry (book: “Violet veins begin tracing the containment geometry.”):
 * thin lit lines climbing the field's cylinder and running round it, in the cage's own frame. The zone grows them
 * from the base (scale.y) with the Eclipse's spread and draws them back when the cage dies.
 */
function buildVeins(b: ZoneBuilder, kind: 'dominion' | 'reformation'): THREE.Object3D {
  const g = new THREE.Group();
  g.name = 'z07-veins';
  const dom = kind === 'dominion';
  const r = (dom ? 1.62 : 1.26) + 0.04;
  const y0 = dom ? 1.4 : 1.95;
  const y1 = dom ? 5.9 : 4.5;
  // its own copy: the cage is far outside, so no room haze on it (released in resetState)
  const mat = b.mats.emissive(VIOLET, 3.2).clone();
  mat.fog = false;
  const rnd = (): number => b.rand();
  const geos: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 7; k++) {
    let a = (k / 7) * Math.PI * 2 + rnd() * 0.4;
    const pts: THREE.Vector3[] = [];
    const steps = 7;
    for (let i = 0; i <= steps; i++) {
      pts.push(new THREE.Vector3(Math.cos(a) * r, y0 + ((y1 - y0) * i) / steps, Math.sin(a) * r));
      a += (rnd() - 0.5) * 0.5;
    }
    geos.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 28, 0.028, 4, false));
  }
  // and round the field where it meets its rings
  for (const y of dom ? [2.05, 3.7, 4.9] : [1.95, 4.5]) {
    geos.push(new THREE.TorusGeometry(r + 0.01, 0.022, 4, 48).rotateX(Math.PI / 2).translate(0, y, 0));
  }
  for (const geo of geos) g.add(new THREE.Mesh(geo, mat));
  g.scale.set(1, 0.001, 1);
  g.visible = false;
  return g;
}

/** the interoperability display over the desk (+ its label lines), the record over the O3 console, the strips */
function buildDisplays(b: ZoneBuilder): void {
  const props = b.game.props;
  const streams = props.hologram('threatStreams');
  const m = b.getMarker('streams');
  streams.object.position.copy(m.pos);
  streams.object.rotation.y = m.yaw;
  streams.params.visible = 0;
  streams.params.progress = 0;
  b.add(streams.object);
  b.onUpdate((dt, t) => streams.update(dt, t));
  S.streams = streams;
  // the plan's three limits on the display: the channel in its header (40 characters now fit), the book's stream
  // nouns as the two lane names (Dominion firing arcs above, Reformation Eclipse tracks below — hologram slots),
  // and the separation as a label under it (x: the viewer's right is the display's local −X — it reads from −Z)
  streams.setText('LOCAL INTEROPERABILITY CHANNEL'); // NEW
  // (≤ 18 characters keep the lane labels at full size)
  streams.setLabel('top', 'DOMINION ARCS'); // NEW (the book's noun: firing arcs)
  streams.setLabel('bottom', 'REFORMATION TRACKS'); // NEW (the book's noun: Eclipse tracks)
  streams.setLabel('status', 'SHARED TARGETS'); // NEW (plan limit 1: only tracks and arcs are shared)
  // polish 4 (UI world text): the two lane names drawn legibly at 720p on dark plates over the in-world labels; they
  // follow the display and hide with it (offsets verified against the hologram by the UI owner)
  const front = { x: 0, y: 0, z: -1 };
  b.game.ui.worldText?.('z07-lane-top', { at: streams.object, offset: { x: 0.81, y: 1.825, z: 0 }, faces: front, text: 'DOMINION ARCS', tone: 'amber', align: 'left', size: 0.04 });
  b.game.ui.worldText?.('z07-lane-bottom', { at: streams.object, offset: { x: 0.81, y: 1.395, z: 0 }, faces: front, text: 'REFORMATION TRACKS', tone: 'cold', align: 'left', size: 0.04 });
  const labels: Array<[string[], number, number, number, number]> = [
    [['WEAPONS AUTHORITY: NOT SHARED', 'COMMAND: NOT SHARED'], 0xf2f6ff, 1.5, 0, 1.5 - 0.72], // NEW (plan limit 2)
  ];
  for (const [lines, color, width, x, y] of labels) {
    const p = textPanel({ lines, width, color, intensity: 1.5, maxRows: lines.length, frame: lines.length > 1 });
    // the display reads from its front (local −Z): turn the quad round to face the same way
    p.object.position.set(x, y, -0.02);
    p.object.rotation.y = Math.PI;
    streams.object.add(p.object);
    S.streamLabels.push(p);
  }

  const record = props.hologram('contaminationRecord');
  const r = b.getMarker('o3Record');
  record.object.position.copy(r.pos);
  record.object.rotation.y = r.yaw;
  record.params.visible = 0.4;
  record.params.progress = 0.05;
  record.setText('REFORMATION COLD-FIELD ENVELOPE RECORD'); // NEW (O3: the Reformation cage's record; ≤ 40 characters)
  b.add(record.object);
  b.onUpdate((dt, t) => record.update(dt, t));
  S.record = record;
  const text = textPanel({ lines: [''], width: 1.5, color: BLUE, intensity: 1.5, maxRows: 4, align: 'left' });
  text.object.position.set(0, 1.5 - 0.86, -0.02);
  text.object.rotation.y = Math.PI;
  record.object.add(text.object);
  S.recordText = text;

  // the personal displays (positioned by the scene that lights them)
  S.stripSelene = textPanel({ lines: [''], width: 0.95, color: 0xbfe4ff, intensity: 1.9 });
  S.stripTarrik = textPanel({ lines: [''], width: 0.95, color: 0xffb35c, intensity: 1.9 });
  b.add(S.stripSelene.object);
  b.add(S.stripTarrik.object);
}

/** beyond the glass: the terminal's converging structure falling away below the gallery */
function buildScenic(b: ZoneBuilder): void {
  const game = b.game;
  const vista = game.sky.scenic.terminalVista({ radius: 2600, seed: 707, density: 0.9, drop: 150, clearWound: false });
  vista.position.copy(b.P(W / 2, D + 6, -2));
  b.add(vista);
  const nave = game.sky.scenic.megaRibs({ count: 5, span: 260, height: 140, spacing: 110, seed: 77 });
  nave.position.copy(b.P(W / 2 + 10, D + 210, -95));
  b.add(nave);
  // dust in the room
  game.vfx.ambient('dust', b.P(W / 2, D / 2, 3.5), { x: W, y: 6, z: D }, 0.35);
}
