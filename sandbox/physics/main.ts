/**
 * Physics / nav sandbox — the debug view of a fixture zone (floors tinted by level, solids, nav strips,
 * triggers, validate() pins) with live queries drawn on top:
 *   gold / cyan ribbons   nav paths, waypoints numbered     white capsule   an agent walking path 0 (moveCharacter)
 *   violet / red          lineOfFire probes (clear / blocked)   amber tiles  sight map: nav cells seen from the eye (off by default)
 *
 *   /sandbox/physics/?fixture=z04|z08|z05&view=top|iso&manual=1&sight=1&hide=nav,solids
 *   live: click anywhere to send the walker · keys 1–7 toggle surfaces / solids / nav / triggers / issues / sight / queries
 *   __phys.view('top' | 'iso')   __phys.layer(name, on)   __phys.path(i, from, to)   __phys.eye(x, y, z)
 *   __phys.door(open)   __phys.barriers(up)   __phys.many(n, seed, radius?, height?)   __step(seconds)
 */
import * as THREE from 'three';
import '@fontsource/barlow-condensed/500.css';
import '@fontsource/barlow-condensed/600.css';
import type { ColliderHandle, NavPath, PhysicsWorld, TriggerHandle, Vec3Like } from '@/core/api';
import { RAY_GROUND, RAY_SHOT } from '@/core/api/physics';
import { createPhysicsWorld } from '@/world/physics';
import { buildZ04, buildZ05, buildZ08, planPos } from '@/world/physics/fixtures';
import { createHarness } from '../harness';

const h = createHarness({ bloom: false, env: 'none', lights: false, background: 0x090c11 });
const fixtureName = (h.params.get('fixture') ?? 'z04').toLowerCase();
const world: PhysicsWorld = createPhysicsWorld(null);

interface Demo {
  title: string;
  /** plan-view framing: centre x, z and the world height to fit */
  frame: { x: number; z: number; span: number };
  paths: Array<[Vec3Like, Vec3Like]>;
  eye: Vec3Like;
  probes: Array<[Vec3Like, Vec3Like]>;
  labels: Array<{ text: string; at: Vec3Like; color?: string; size?: number }>;
  doors: ColliderHandle[];
  /** toggleable isolation barriers (Z08 court) */
  barriers: ColliderHandle[];
}

function setup(): Demo {
  if (fixtureName === 'z08') {
    const f = buildZ08(world);
    for (const b of f.courtBarriers) b.enabled = true;
    return {
      title: 'Z08 QUARANTINE CRUCIBLE — 70 × 48 m · east balcony +3 m',
      frame: { x: 35, z: -24, span: 66 },
      paths: [[f.marks.entry, f.marks.northOfCourt], [f.marks.westLoop, f.marks.balcony]],
      eye: { ...f.marks.staging, y: 1.6 },
      probes: [[{ ...f.marks.balcony, y: 4.6 }, { ...f.marks.courtMid, y: 1.8 }], [{ ...f.marks.staging, y: 1.6 }, { ...f.marks.roomW, y: 1.2 }]],
      labels: [
        { text: 'SOUTH ENTRY / CP5', at: planPos(35, -4.6) }, { text: 'ONE-WAY EXIT', at: planPos(35, 52.6) },
        { text: 'ELITE COURT 18 × 14', at: planPos(35, 24), color: '#ffc56b' }, { text: 'EAST +3 m', at: planPos(58.5, 23, 3) },
        { text: 'W', at: planPos(9, 40), size: 1.6 }, { text: 'E', at: planPos(65.5, 40), size: 1.6 },
      ],
      doors: [f.exitDoor, f.doorW, f.doorE],
      barriers: f.courtBarriers,
    };
  }
  if (fixtureName === 'z05') {
    const f = buildZ05(world);
    return {
      title: 'Z05 MEETING ATRIUM — Ø72 m platform · Ø18 m shaft · 6 m bridges',
      frame: { x: 0, z: 0, span: 122 },
      paths: [[f.marks.southApproach, f.marks.northApproach], [f.marks.ringEast, f.marks.ringWest]],
      eye: { x: 14, y: 1.6, z: 12 },
      probes: [[{ x: 14, y: 1.6, z: 12 }, { x: -24, y: 1.6, z: -18 }]],
      labels: [
        { text: 'FROM Z04', at: { x: 0, y: 0, z: 58.5 } }, { text: 'TO Z06', at: { x: 0, y: 0, z: -58.5 } },
        { text: 'SHAFT Ø18', at: { x: -5.8, y: 0, z: 0 }, color: '#ff8a8a' }, { text: 'BROKEN SPAN', at: { x: 42, y: 0, z: -4.6 } },
      ],
      doors: [],
      barriers: [],
    };
  }
  const f = buildZ04(world);
  const eye = { x: f.marks.overlook.x, y: 4.6, z: f.marks.overlook.z };
  return {
    title: 'Z04 RELAY OVERLOOK — 62 × 38 m · balcony +3 m',
    frame: { x: 31, z: -19, span: 54 },
    paths: [[f.marks.entry, f.marks.overlook], [planPos(21, 12), planPos(17.4, 27)]],
    eye: planPos(9.2, 11, 1.6), // the fixed scan head S: what it can see at standing eye height
    probes: [[eye, f.marks.receiverB], [eye, f.marks.receiverA], [planPos(23, 8, 1.6), f.marks.receiverA]],
    labels: [
      { text: 'FROM Z03', at: planPos(31, -7.2) }, { text: 'TO Z05', at: planPos(31, 45.2) },
      { text: 'HIGH ROUTE +3 m', at: planPos(52.5, 31.6, 3) }, { text: 'POCKET', at: planPos(39.5, 36, 3) },
      { text: 'A', at: planPos(35, 18, 2.4), color: '#ffa033', size: 1.5 }, { text: 'B', at: planPos(16, 27, 2.4), color: '#ffa033', size: 1.5 },
      { text: 'S', at: planPos(8, 11, 2.8), color: '#c5ccd4', size: 1.5 }, { text: 'LOW ROUTE', at: planPos(13, 5.5) },
    ],
    doors: [f.door],
    barriers: [],
  };
}

const demo = setup();
const tBuild0 = performance.now();
world.nav.rebuild();
const buildMs = performance.now() - tBuild0;

// ---- scene dressing ---------------------------------------------------------------------------------------
const debug = world.debugObject() as THREE.Group;
h.scene.add(debug);
const debugApi = debug.userData as {
  layer(name: string, visible: boolean): boolean; refresh(): void; issues: Array<{ kind: string; message: string }>; navNodes(): number[];
};

/** What is drawn: the five layers of the debug group, plus the two overlays this page adds. */
const LAYERS = ['surfaces', 'solids', 'nav', 'triggers', 'issues', 'sight', 'queries'] as const;
type LayerName = typeof LAYERS[number];
const shown: Record<LayerName, boolean> = { surfaces: true, solids: true, nav: true, triggers: true, issues: true, sight: h.params.has('sight'), queries: true };
for (const name of (h.params.get('hide') ?? '').split(',')) if ((LAYERS as readonly string[]).includes(name)) shown[name as LayerName] = false;
for (const name of LAYERS) debugApi.layer(name, shown[name]);

/** 10 m plan grid under everything (matches the tactical-plan drawings). */
function planGrid(): THREE.LineSegments {
  const pos: number[] = [];
  const { x, z, span } = demo.frame;
  const half = span * 1.3;
  const x0 = Math.floor((x - half) / 10) * 10, x1 = Math.ceil((x + half) / 10) * 10;
  const z0 = Math.floor((z - half) / 10) * 10, z1 = Math.ceil((z + half) / 10) * 10;
  for (let gx = x0; gx <= x1; gx += 10) pos.push(gx, -0.02, z0, gx, -0.02, z1);
  for (let gz = z0; gz <= z1; gz += 10) pos.push(x0, -0.02, gz, x1, -0.02, gz);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x1c2532, toneMapped: false }));
}
h.scene.add(planGrid());

/** Labels are kept apart on screen: each records its anchor and world size, see declutter(). */
interface Tag { sprite: THREE.Sprite; height: number; aspect: number }
const tags: Tag[] = [];

function label(text: string, at: Vec3Like, color = '#d3dde9', size = 1): THREE.Sprite {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  const font = '600 44px "Barlow Condensed", "Arial Narrow", sans-serif';
  ctx.font = font;
  c.width = Math.ceil(ctx.measureText(text).width) + 24;
  c.height = 60;
  ctx.font = font;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(6,9,13,0.92)'; ctx.lineWidth = 9;
  ctx.strokeText(text, 12, 32);
  ctx.fillStyle = color;
  ctx.fillText(text, 12, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, toneMapped: false }));
  const hgt = 1.5 * size * (demo.frame.span / 54);
  s.scale.set((hgt * c.width) / c.height, hgt, 1);
  s.position.set(at.x, at.y + 0.6, at.z);
  s.renderOrder = 990;
  tags.push({ sprite: s, height: hgt, aspect: c.width / c.height });
  return s;
}

const projected = new THREE.Vector3();
/** Screen rectangle [x0, y0, x1, y1] in pixels of a world-space box of the given height centred on `at`. */
function screenRect(at: THREE.Vector3, height: number, aspect: number, lift: number): [number, number, number, number] {
  projected.copy(at).project(h.camera);
  const depth = Math.max(0.1, at.clone().sub(h.camera.position).dot(h.camera.getWorldDirection(new THREE.Vector3())));
  const ph = (height / (2 * depth * Math.tan((h.camera.fov * Math.PI) / 360))) * innerHeight;
  const cx = (projected.x * 0.5 + 0.5) * innerWidth, cy = (-projected.y * 0.5 + 0.5) * innerHeight - lift * ph;
  return [cx - (ph * aspect) / 2, cy - ph / 2, cx + (ph * aspect) / 2, cy + ph / 2];
}

/**
 * Keep labels legible from any camera: in creation order (zone labels first, waypoint numbers last) each one
 * that would overlap the walker or an earlier label is raised by whole label heights until it is clear.
 */
function declutter(): void {
  h.camera.updateMatrixWorld();
  const taken: Array<[number, number, number, number]> = [screenRect(agent.position, 2.2, 0.5, 0)];
  for (const t of tags) {
    let lift = 0, r = screenRect(t.sprite.position, t.height, t.aspect, 0);
    for (let k = 0; k < 6 && taken.some((o) => r[0] < o[2] && r[2] > o[0] && r[1] < o[3] && r[3] > o[1]); k++) {
      lift += 1.05;
      r = screenRect(t.sprite.position, t.height, t.aspect, lift);
    }
    t.sprite.center.set(0.5, 0.5 - lift);
    taken.push(r);
  }
}

// ---- live query overlays ----------------------------------------------------------------------------------
const overlay = new THREE.Group();
h.scene.add(overlay);
const PATH_COLORS = [0xffc56b, 0x7fe0ff];
const paths: Array<NavPath | null> = [];
let pathMs = 0;

/** Flat ribbon along a polyline, lifted slightly off the ground. */
function ribbon(points: Vec3Like[], width: number, color: number, lift: number): THREE.Mesh {
  const pos: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    const nx = (-dz / len) * width * 0.5, nz = (dx / len) * width * 0.5;
    const ay = a.y + lift, by = b.y + lift;
    pos.push(a.x - nx, ay, a.z - nz, a.x + nx, ay, a.z + nz, b.x + nx, by, b.z + nz);
    pos.push(a.x - nx, ay, a.z - nz, b.x + nx, by, b.z + nz, b.x - nx, by, b.z - nz);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, toneMapped: false, depthTest: false }));
  m.renderOrder = 950;
  return m;
}

function disc(at: Vec3Like, r: number, color: number, ring = false): THREE.Mesh {
  const g = ring ? new THREE.RingGeometry(r * 0.72, r, 32) : new THREE.CircleGeometry(r, 24);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, toneMapped: false, depthTest: false }));
  m.rotation.x = -Math.PI / 2;
  m.position.set(at.x, at.y + 0.12, at.z);
  m.renderOrder = 960;
  return m;
}

/**
 * Sight map: every nav cell on which a standing character (head at +1.6 m) is visible from the eye — one
 * lineOfSight query per nav node, drawn as a warm tile. Cover shadows, the balcony lip and closed rooms read
 * directly; this is exactly the test scanners and AI perception run.
 */
let sightMs = 0, sightCount = 0;
function sightMap(eye: Vec3Like): THREE.Mesh {
  const nodes = debugApi.navNodes();
  const half = world.nav.cellSize * 0.5;
  const pos: number[] = [];
  const target = { x: 0, y: 0, z: 0 };
  const t0 = performance.now();
  sightCount = nodes.length / 3;
  for (let i = 0; i < nodes.length; i += 3) {
    const x = nodes[i], y = nodes[i + 1], z = nodes[i + 2];
    target.x = x; target.y = y + 1.6; target.z = z;
    if (!world.lineOfSight(eye, target)) continue;
    const yy = y + 0.09;
    pos.push(x - half, yy, z - half, x - half, yy, z + half, x + half, yy, z + half);
    pos.push(x - half, yy, z - half, x + half, yy, z + half, x + half, yy, z - half);
  }
  sightMs = performance.now() - t0;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
    color: 0xffa033, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false, toneMapped: false,
  }));
  m.renderOrder = 915;
  return m;
}

/** lineOfFire probe: violet when clear; red up to the blocking hit (marked) and faint beyond it. */
function probe(a: Vec3Like, b: Vec3Like, scale: number): THREE.Object3D {
  const g = new THREE.Group();
  if (world.lineOfFire(a, b)) {
    g.add(ribbon([a, b], 0.16 * scale, 0xb48cff, 0));
    return g;
  }
  const d = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const len = Math.hypot(d.x, d.y, d.z);
  const hit = world.raycast(a, d, len, RAY_SHOT);
  const t = hit ? hit.distance / len : 1;
  const mid = { x: a.x + d.x * t, y: a.y + d.y * t, z: a.z + d.z * t };
  g.add(ribbon([a, mid], 0.16 * scale, 0xff5a5a, 0));
  const rest = ribbon([mid, b], 0.1 * scale, 0xff5a5a, 0);
  (rest.material as THREE.MeshBasicMaterial).transparent = true;
  (rest.material as THREE.MeshBasicMaterial).opacity = 0.3;
  g.add(rest, disc({ x: mid.x, y: mid.y - 0.12, z: mid.z }, 0.32 * scale, 0xff5a5a));
  return g;
}

function rebuildOverlay(): void {
  for (const c of [...overlay.children]) {
    overlay.remove(c);
    c.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
  }
  const scale = demo.frame.span / 54;
  tags.length = 0;
  for (const l of demo.labels) overlay.add(label(l.text, l.at, l.color, l.size));
  paths.length = 0;
  for (const [a, b] of demo.paths) paths.push(world.nav.findPath(a, b));
  const t0 = performance.now();
  for (let k = 0; k < 20; k++) for (const [a, b] of demo.paths) world.nav.findPath(a, b);
  pathMs = (performance.now() - t0) / (20 * Math.max(1, demo.paths.length));
  if (shown.sight) {
    overlay.add(sightMap(demo.eye));
    overlay.add(disc({ x: demo.eye.x, y: Math.max(0, demo.eye.y - 1.5), z: demo.eye.z }, 0.5 * scale, 0xffa033, true));
  }
  if (shown.queries) {
    for (const [a, b] of demo.probes) overlay.add(probe(a, b, scale));
    paths.forEach((p, i) => {
      const col = PATH_COLORS[i % PATH_COLORS.length];
      const css = `#${col.toString(16).padStart(6, '0')}`;
      const [a, b] = demo.paths[i];
      overlay.add(disc(a, 0.55 * scale, col, true));
      overlay.add(disc(b, 0.55 * scale, p ? col : 0xff5a5a, true));
      if (!p) return;
      overlay.add(ribbon(p.points, 0.3 * scale, col, 0.1));
      // waypoints in walking order
      for (let k = 1; k < p.points.length; k++) {
        if (k < p.points.length - 1) overlay.add(disc(p.points[k], 0.32 * scale, col));
        overlay.add(label(String(k), { x: p.points[k].x + 0.9 * scale, y: p.points[k].y + 0.5 * scale, z: p.points[k].z - 0.9 * scale }, css, 0.9));
      }
    });
  }
  hud();
}

function setLayer(name: LayerName, on: boolean): void {
  shown[name] = on;
  if (!debugApi.layer(name, on)) rebuildOverlay();
  hud();
  declutter();
  h.render();
}

// ---- agent walking path 0 with the real movement solver ----------------------------------------------------
const agent = new THREE.Mesh(
  new THREE.CapsuleGeometry(0.4, 1.0, 6, 16),
  new THREE.MeshBasicMaterial({ color: 0xf4f7ff, toneMapped: false }),
);
agent.renderOrder = 980;
h.scene.add(agent);
const trail: Vec3Like[] = [];
let trailMesh: THREE.Mesh | null = null;
const walker = { pos: { x: 0, y: 0, z: 0 }, leg: 1, blocked: 0, done: false };

// a trigger volume at the goal of path 0, evaluated against the walker exactly as Game does for the player
const goalTrigger = { handle: null as TriggerHandle | null, enters: 0, exits: 0 };
function placeGoalTrigger(): void {
  goalTrigger.handle?.remove();
  const g = demo.paths[0][1];
  goalTrigger.enters = 0; goalTrigger.exits = 0;
  goalTrigger.handle = world.addTrigger(
    { kind: 'circle', x: g.x, z: g.z, r: 2.5, yMin: g.y - 0.5, yMax: g.y + 2.2 },
    () => { goalTrigger.enters++; hud(); },
    () => { goalTrigger.exits++; hud(); },
  );
}

function resetWalker(): void {
  const p = paths[0];
  walker.pos = p ? { ...p.points[0] } : { ...demo.paths[0][0] };
  walker.leg = 1; walker.blocked = 0; walker.done = !p;
  trail.length = 0;
  agent.position.set(walker.pos.x, walker.pos.y + 0.9, walker.pos.z);
  hud();
}

h.onUpdate((dt) => {
  const p = paths[0];
  if (p && !walker.done) {
    let budget = 5.2 * dt; // run speed
    while (budget > 1e-6 && walker.leg < p.points.length) {
      const tgt = p.points[walker.leg];
      const dx = tgt.x - walker.pos.x, dz = tgt.z - walker.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.02) { walker.leg++; continue; }
      const step = Math.min(d, budget);
      const m = world.moveCharacter(walker.pos, 0.4, (dx / d) * step, (dz / d) * step);
      if (m.blocked) walker.blocked++;
      walker.pos = { x: m.x, y: m.y, z: m.z };
      budget -= step;
    }
    if (walker.leg >= p.points.length) { walker.done = true; hud(); }
    const last = trail[trail.length - 1];
    if (!last || Math.hypot(last.x - walker.pos.x, last.z - walker.pos.z) > 0.25) trail.push({ ...walker.pos });
  }
  agent.position.set(walker.pos.x, walker.pos.y + 0.9, walker.pos.z);
  world.updateTriggers(walker.pos);
  declutter();
  if (trailMesh) { h.scene.remove(trailMesh); trailMesh.geometry.dispose(); trailMesh = null; }
  if (shown.queries && trail.length > 1) {
    trailMesh = ribbon(trail, 0.8 * (demo.frame.span / 54), 0xffffff, 0.14);
    (trailMesh.material as THREE.MeshBasicMaterial).transparent = true;
    (trailMesh.material as THREE.MeshBasicMaterial).opacity = 0.22;
    trailMesh.renderOrder = 955;
    h.scene.add(trailMesh);
  }
});

// ---- HUD ----------------------------------------------------------------------------------------------------
const HUD_W = 292;
const panel = document.createElement('div');
panel.style.cssText = `position:fixed;left:0;top:0;bottom:0;width:${HUD_W}px;box-sizing:border-box;padding:18px 20px;`
  + 'font:500 14.5px/1.42 "Barlow Condensed","Arial Narrow",sans-serif;letter-spacing:.07em;color:#8fa1b6;pointer-events:none;'
  + 'background:linear-gradient(90deg,rgba(9,12,17,.96) 78%,rgba(9,12,17,0));';
document.body.appendChild(panel);

function hud(): void {
  const row = (k: string, v: string): string =>
    `<div style="display:flex;justify-content:space-between;max-width:226px"><span>${k}</span><span style="color:#dfe6ee">${v}</span></div>`;
  const chip = (c: string, t: string, round = false): string =>
    `<div><span style="display:inline-block;width:11px;height:11px;background:${c};margin-right:9px;border-radius:${round ? 6 : 2}px"></span>${t}</div>`;
  const head = (t: string): string =>
    `<div style="margin:10px 0 3px;font-size:12px;letter-spacing:.22em;color:#5d6c80;border-bottom:1px solid #1c2532;max-width:226px">${t}</div>`;
  const [zone, ...rest] = demo.title.split(' — ');
  const pathRows = paths.map((q, i) => row(
    `<span style="color:${i === 0 ? '#ffc56b' : '#7fe0ff'}">path ${i}</span>`,
    q ? `${q.length.toFixed(1)} m · ${q.points.length} pts` : 'unreachable',
  )).join('');
  panel.innerHTML = '<div style="font-size:12px;letter-spacing:.28em;color:#c9a45c">PHYSICS · NAV DEBUG</div>'
    + `<div style="font:600 25px/1.1 'Barlow Condensed','Arial Narrow',sans-serif;color:#eef2f7;letter-spacing:.07em;margin-top:4px;max-width:250px">${zone}</div>`
    + `<div style="max-width:226px">${rest.join(' — ')}</div>`
    + head('WORLD')
    + row('surfaces', String(world.counts.surfaces)) + row('solids', String(world.counts.colliders))
    + row('nav nodes', `${world.nav.nodeCount} @ ${world.nav.cellSize} m`)
    + row('nav rebuild', `${buildMs.toFixed(1)} ms`) + row('findPath', `${pathMs.toFixed(2)} ms`)
    + (shown.sight ? row(`lineOfSight × ${sightCount}`, `${sightMs.toFixed(1)} ms`) : '')
    + head('QUERIES') + pathRows
    + row('walker', walker.done ? `arrived · ${walker.blocked} blocked` : 'walking')
    + row('goal trigger', `${goalTrigger.handle?.inside ? 'inside' : 'outside'} · ${goalTrigger.enters} in / ${goalTrigger.exits} out`)
    + (demo.barriers.length ? row('isolation barriers', demo.barriers[0].enabled ? 'raised' : 'lowered') : '')
    + (demo.doors.length ? row('doors', demo.doors.some((d) => d.enabled) ? 'closed' : 'open') : '')
    + row('validate()', debugApi.issues.length ? `<span style="color:#ff3df0">${debugApi.issues.length} issue${debugApi.issues.length > 1 ? 's' : ''}</span>` : 'clean')
    + head('LAYERS · KEYS 1–7')
    + `<div style="max-width:236px">${LAYERS.map((n, i) => `<span style="white-space:nowrap;color:${shown[n] ? '#dfe6ee' : '#4a5668'}">${i + 1} ${n}</span>`).join(' · ')}</div>`
    + head('LEGEND')
    + `<div><span style="display:inline-block;width:46px;height:11px;margin-right:9px;border-radius:2px;background:linear-gradient(90deg,#c8cf30,#30cf6e,#30a9cf,#3058cf)"></span>floor · nav, by level −6…+6 m</div>`
    + '<div style="display:grid;grid-template-columns:1fr 1fr;max-width:250px">'
    + chip('#ff4b4b', 'solid') + chip('#4a505c', 'disabled')
    + chip('#7cc4ff', 'low cover') + chip('#2f6dff', 'high cover')
    + chip('#ffa033', 'see-through') + chip('#c070ff', 'walk-through')
    + chip('#ffd84a', 'trigger') + chip('#ff3df0', 'validate() issue')
    + chip('#b48cff', 'fire: clear') + chip('#ff5a5a', 'fire: blocked')
    + chip('#ffc56b', 'nav path') + (shown.sight ? chip('#ffa033', 'seen from eye') : '')
    + '</div>';
}

// ---- views + console API --------------------------------------------------------------------------------------
function view(name: string): void {
  const { x, z, span } = demo.frame;
  // keep the zone clear of the HUD column: shift the look-at left by half the column, in world units
  const aspect = innerWidth / innerHeight;
  if (name === 'iso') {
    const shift = span * 0.2;
    h.setCam([x - span * 0.5 - shift, span * 0.95, z + span * 0.8], [x + span * 0.04 - shift, 0, z + span * 0.02], 34);
  } else {
    const fov = 24;
    const fit = Math.max(span, (span * 1.18) / Math.max(0.1, aspect - HUD_W / innerHeight));
    const dist = (fit * 0.5) / Math.tan((fov * Math.PI) / 360);
    const shift = (HUD_W / innerHeight) * fit * 0.5;
    h.setCam([x - shift, dist, z + 0.02], [x - shift, 0, z], fov);
  }
  declutter();
  h.render();
}

const api = {
  world, demo, paths, walker,
  view,
  /** show / hide one of: surfaces, solids, nav, triggers, issues, sight, queries */
  layer(name: LayerName, on: boolean): void { if (LAYERS.includes(name)) setLayer(name, on); },
  /** replace demo path i */
  path(i: number, from: Vec3Like, to: Vec3Like): string {
    demo.paths[i] = [from, to];
    if (i === 0) placeGoalTrigger();
    rebuildOverlay();
    if (i === 0) resetWalker();
    h.render();
    const p = paths[i];
    return p ? `${p.length.toFixed(2)} m, ${p.points.length} pts` : 'unreachable';
  },
  eye(x: number, y: number, z: number): void { demo.eye = { x, y, z }; rebuildOverlay(); h.render(); },
  /** draw n random nav paths (thin) to eyeball smoothing quality; returns the average query time in ms */
  many(n: number, seed = 1, radius = 0, height = 0): number {
    const c = demo.paths[0][0];
    const scale = demo.frame.span / 54;
    let ms = 0, found = 0;
    for (let i = 0; i < n; i++) {
      const a = world.nav.randomPoint(c, demo.frame.span, seed * 1000 + i * 2);
      const b = world.nav.randomPoint(c, demo.frame.span, seed * 1000 + i * 2 + 1);
      if (!a || !b) continue;
      const t0 = performance.now();
      const p = radius > 0 ? world.nav.findPathFor(a, b, radius, height) : world.nav.findPath(a, b);
      ms += performance.now() - t0;
      if (!p) continue;
      found++;
      const col = new THREE.Color().setHSL((i * 0.137) % 1, 0.75, 0.66).getHex();
      overlay.add(ribbon(p.points, Math.max(0.12, radius * 2) * scale, col, 0.12));
      if (radius > 0) {
        const m = overlay.children[overlay.children.length - 1] as THREE.Mesh;
        (m.material as THREE.MeshBasicMaterial).transparent = true;
        (m.material as THREE.MeshBasicMaterial).opacity = 0.35;
      }
      for (const q of p.points) overlay.add(disc(q, 0.16 * scale, col));
    }
    h.render();
    return found > 0 ? ms / found : 0;
  },
  /** raise / lower the isolation barriers (Z08) and rebuild nav incrementally; returns the rebuild ms */
  barriers(up: boolean): number {
    for (const b of demo.barriers) b.enabled = up;
    return api.door(!demo.doors.some((d) => d.enabled));
  },
  /** open / close the fixture doors and rebuild nav incrementally; returns the rebuild ms */
  door(open: boolean): number {
    for (const d of demo.doors) d.enabled = !open;
    const t0 = performance.now();
    world.nav.rebuild();
    const ms = performance.now() - t0;
    rebuildOverlay();
    h.render();
    return ms;
  },
  stats(): Record<string, unknown> {
    return { ...world.counts, nodes: world.nav.nodeCount, buildMs, pathMs, walker: { ...walker.pos, blocked: walker.blocked, done: walker.done } };
  },
};
(window as unknown as { __phys: typeof api }).__phys = api;

// Keys 1–7 toggle the layers in LAYERS order.
addEventListener('keydown', (e) => {
  const i = Number(e.key) - 1;
  if (Number.isInteger(i) && i >= 0 && i < LAYERS.length) setLayer(LAYERS[i], !shown[LAYERS[i]]);
});

// Click (without dragging) to send the walker there: a camera ray against floors + solids picks the goal.
let downX = 0, downY = 0;
h.renderer.domElement.addEventListener('pointerdown', (e) => { downX = e.clientX; downY = e.clientY; });
h.renderer.domElement.addEventListener('pointerup', (e) => {
  if (Math.hypot(e.clientX - downX, e.clientY - downY) > 4) return;
  const ndc = new THREE.Vector3((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1, 0.5).unproject(h.camera);
  const o = h.camera.position;
  const hit = world.raycast(o, { x: ndc.x - o.x, y: ndc.y - o.y, z: ndc.z - o.z }, 2000, RAY_GROUND | RAY_SHOT);
  if (!hit) return;
  const goal = world.nav.nearest(hit.point.x, hit.point.y, hit.point.z, 3);
  if (goal) api.path(0, { ...walker.pos }, goal);
});

async function start(): Promise<void> {
  try { await Promise.all([document.fonts.load('600 44px "Barlow Condensed"'), document.fonts.load('500 15px "Barlow Condensed"')]); } catch { /* fallback font */ }
  placeGoalTrigger();
  rebuildOverlay();
  resetWalker();
  view(h.params.get('view') ?? 'top');
  h.ready();
}
void start();
