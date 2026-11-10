/**
 * Physics / nav sandbox — debug view of a fixture zone with live queries drawn on top:
 *   gold ribbons   nav paths (string-pulled)           white capsule   an agent walking path 0 through moveCharacter
 *   warm tiles     nav cells visible from an eye       violet / red    lineOfFire probes (clear / blocked)
 *
 *   /sandbox/physics/?fixture=z04|z08|z05&view=top|iso&manual=1
 *   __phys.view('top' | 'iso')   __phys.path(i, from, to)   __phys.eye(x, y, z)   __phys.door(open)   __step(s)
 */
import * as THREE from 'three';
import '@fontsource/barlow-condensed/500.css';
import '@fontsource/barlow-condensed/600.css';
import type { ColliderHandle, NavPath, PhysicsWorld, Vec3Like } from '@/core/api';
import { RAY_SHOT, RAY_SIGHT } from '@/core/api/physics';
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
}

function setup(): Demo {
  if (fixtureName === 'z08') {
    const f = buildZ08(world);
    for (const b of f.courtBarriers) b.enabled = true;
    return {
      title: 'Z08 QUARANTINE CRUCIBLE — 70 × 48 m · isolation barriers raised',
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
  };
}

const demo = setup();
const tBuild0 = performance.now();
world.nav.rebuild();
const buildMs = performance.now() - tBuild0;

// ---- scene dressing ---------------------------------------------------------------------------------------
const debug = world.debugObject() as THREE.Group;
h.scene.add(debug);

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

function label(text: string, at: Vec3Like, color = '#9fb2c8', size = 1): THREE.Sprite {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  const font = '600 44px "Barlow Condensed", "Arial Narrow", sans-serif';
  ctx.font = font;
  c.width = Math.ceil(ctx.measureText(text).width) + 24;
  c.height = 60;
  ctx.font = font;
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 8;
  ctx.fillStyle = color;
  ctx.fillText(text, 12, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, toneMapped: false }));
  const hgt = 1.5 * size * (demo.frame.span / 54);
  s.scale.set((hgt * c.width) / c.height, hgt, 1);
  s.position.set(at.x, at.y + 0.6, at.z);
  s.renderOrder = 990;
  return s;
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
  const nodes = (debug.getObjectByName('nav') as THREE.Points).geometry.getAttribute('position');
  const half = world.nav.cellSize * 0.5;
  const pos: number[] = [];
  const target = { x: 0, y: 0, z: 0 };
  const t0 = performance.now();
  sightCount = nodes ? nodes.count : 0;
  for (let i = 0; i < sightCount; i++) {
    const x = nodes.getX(i), y = nodes.getY(i), z = nodes.getZ(i);
    target.x = x; target.y = y + 1.6; target.z = z;
    if (!world.lineOfSight(eye, target)) continue;
    const yy = y + 0.02;
    pos.push(x - half, yy, z - half, x - half, yy, z + half, x + half, yy, z + half);
    pos.push(x - half, yy, z - half, x + half, yy, z + half, x + half, yy, z - half);
  }
  sightMs = performance.now() - t0;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
    color: 0xffe2a8, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false, toneMapped: false,
  }));
  m.renderOrder = 899;
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
  overlay.add(sightMap(demo.eye));
  overlay.add(disc({ x: demo.eye.x, y: Math.max(0, demo.eye.y - 1.5), z: demo.eye.z }, 0.5 * scale, 0xffe2a8, true));
  for (const [a, b] of demo.probes) overlay.add(probe(a, b, scale));
  paths.length = 0;
  for (const [a, b] of demo.paths) paths.push(world.nav.findPath(a, b));
  const t0 = performance.now();
  for (let k = 0; k < 20; k++) for (const [a, b] of demo.paths) world.nav.findPath(a, b);
  pathMs = (performance.now() - t0) / (20 * Math.max(1, demo.paths.length));
  paths.forEach((p, i) => {
    const col = PATH_COLORS[i % PATH_COLORS.length];
    const [a, b] = demo.paths[i];
    overlay.add(disc(a, 0.55 * scale, col, true));
    overlay.add(disc(b, 0.55 * scale, p ? col : 0xff5a5a, true));
    if (!p) return;
    overlay.add(ribbon(p.points, 0.3 * scale, col, 0.1));
    for (let k = 1; k < p.points.length - 1; k++) overlay.add(disc(p.points[k], 0.32 * scale, col));
  });
  for (const l of demo.labels) overlay.add(label(l.text, l.at, l.color, l.size));
  hud();
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

function resetWalker(): void {
  const p = paths[0];
  walker.pos = p ? { ...p.points[0] } : { ...demo.paths[0][0] };
  walker.leg = 1; walker.blocked = 0; walker.done = !p;
  trail.length = 0;
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
  if (trailMesh) { h.scene.remove(trailMesh); trailMesh.geometry.dispose(); trailMesh = null; }
  if (trail.length > 1) {
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
panel.style.cssText = `position:fixed;left:0;top:0;bottom:0;width:${HUD_W}px;box-sizing:border-box;padding:22px 20px;`
  + 'font:500 15px/1.55 "Barlow Condensed","Arial Narrow",sans-serif;letter-spacing:.07em;color:#8fa1b6;pointer-events:none;'
  + 'background:linear-gradient(90deg,rgba(9,12,17,.96) 78%,rgba(9,12,17,0));';
document.body.appendChild(panel);

function hud(): void {
  const row = (k: string, v: string): string =>
    `<div style="display:flex;justify-content:space-between;max-width:226px"><span>${k}</span><span style="color:#dfe6ee">${v}</span></div>`;
  const chip = (c: string, t: string, round = false): string =>
    `<div><span style="display:inline-block;width:11px;height:11px;background:${c};margin-right:9px;border-radius:${round ? 6 : 2}px"></span>${t}</div>`;
  const head = (t: string): string =>
    `<div style="margin:16px 0 4px;font-size:12px;letter-spacing:.22em;color:#5d6c80;border-bottom:1px solid #1c2532;max-width:226px">${t}</div>`;
  const [zone, ...rest] = demo.title.split(' — ');
  const pathRows = paths.map((q, i) => row(
    `<span style="color:${i === 0 ? '#ffc56b' : '#7fe0ff'}">path ${i}</span>`,
    q ? `${q.length.toFixed(1)} m · ${q.points.length} pts` : 'unreachable',
  )).join('');
  panel.innerHTML = '<div style="font-size:12px;letter-spacing:.28em;color:#c9a45c">PHYSICS · NAV DEBUG</div>'
    + `<div style="font:600 27px/1.1 'Barlow Condensed','Arial Narrow',sans-serif;color:#eef2f7;letter-spacing:.08em;margin-top:4px">${zone}</div>`
    + `<div style="max-width:226px">${rest.join(' — ')}</div>`
    + head('WORLD')
    + row('surfaces', String(world.counts.surfaces)) + row('solids', String(world.counts.colliders))
    + row('nav nodes', `${world.nav.nodeCount} @ ${world.nav.cellSize} m`)
    + row('nav rebuild', `${buildMs.toFixed(1)} ms`) + row('findPath', `${pathMs.toFixed(2)} ms`)
    + row(`lineOfSight × ${sightCount}`, `${sightMs.toFixed(1)} ms`)
    + head('QUERIES') + pathRows
    + row('walker', walker.done ? `arrived · ${walker.blocked} blocked` : 'walking')
    + head('LEGEND')
    + chip('#2fd27a', 'walkable surface') + chip('#9af2c0', 'ramp') + chip('#ff4b4b', 'solid')
    + chip('#7cc4ff', 'low cover 1.2 m') + chip('#2f6dff', 'high cover 2.2 m') + chip('#ffa033', 'see-through solid')
    + chip('#4a505c', 'disabled') + chip('#8fe6ff', 'nav node', true) + chip('#ffc56b', 'nav path')
    + chip('#ffe2a8', 'seen from the eye') + chip('#b48cff', 'clear line of fire') + chip('#ff5a5a', 'blocked line of fire');
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
  h.render();
}

const api = {
  world, demo, paths, walker,
  view,
  /** replace demo path i */
  path(i: number, from: Vec3Like, to: Vec3Like): string {
    demo.paths[i] = [from, to];
    rebuildOverlay();
    if (i === 0) resetWalker();
    h.render();
    const p = paths[i];
    return p ? `${p.length.toFixed(2)} m, ${p.points.length} pts` : 'unreachable';
  },
  eye(x: number, y: number, z: number): void { demo.eye = { x, y, z }; rebuildOverlay(); h.render(); },
  /** open / close the fixture doors and rebuild nav incrementally */
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

async function start(): Promise<void> {
  try { await Promise.all([document.fonts.load('600 44px "Barlow Condensed"'), document.fonts.load('500 15px "Barlow Condensed"')]); } catch { /* fallback font */ }
  rebuildOverlay();
  resetWalker();
  view(h.params.get('view') ?? 'top');
  h.ready();
}
void start();
