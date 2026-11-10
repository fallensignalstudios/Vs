/**
 * Kit sandbox — showcase rooms built through the public ZoneBuilder, rendered by the REAL render system with the
 * real material library, physics world, sky and vfx.
 *
 * URL:  ?room=hall|gallery|z04|props   &q=low|medium|high|ultra (default high)   &nopost=1   &manual=1
 * Console / tools/shot.cjs --eval:
 *   __h.setCam([x,y,z],[lx,ly,lz],fov?)  world coords        __cam(x,n,h, lx,ln,lh, fov?)  plan coords
 *   __step(seconds)     __debug(true|false, ['surfaces','solids','nav'])     __stats()
 *   __door(i, open)     __barrier(i, active)     __figures(false)
 *   __walk([[x,n,h], …])  walks the capsule along nav paths with physics.moveCharacter → trace + result
 *   __follow(dist?, height?)  third-person camera behind the walker
 */
import * as THREE from 'three';
import type { AudioSystem, Game, QualityLevel, ZoneBuilder } from '@/core/api';
import { createRenderSystem } from '@/render';
import { createSkySystem } from '@/render/sky';
import { createVfxSystem } from '@/vfx';
import { createZoneBuilder } from '@/world/kit';
import { createMaterialLibrary } from '@/world/materials';
import { createPhysicsWorld } from '@/world/physics';
import { createCanvasOnly, miniGame, withStubs } from '../harness';
import { ROOMS, type Room, type RoomName } from './rooms';

const h = createCanvasOnly();
const q = h.params;
const levels: QualityLevel[] = ['low', 'medium', 'high', 'ultra'];
const quality = levels.includes(q.get('q') as QualityLevel) ? (q.get('q') as QualityLevel) : 'high';
const roomName = (q.get('room') && q.get('room')! in ROOMS ? q.get('room') : 'hall') as RoomName;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 6000);
const target = new THREE.Vector3();

const played: string[] = [];
const audio = withStubs<AudioSystem>('audio', { play: (id: string) => { played.push(id); } } as Partial<AudioSystem>);
const physics = createPhysicsWorld(null);
const game = miniGame(null, {
  canvas: h.canvas, scene, physics, audio,
  flags: { zone: null, beat: null, checkpoint: null, debug: true, autoplay: false, mute: true, nopost: q.has('nopost'), quality, manual: q.has('manual'), seed: 7283 },
  camera: withStubs<Game['camera']>('camera', { camera }),
});
const set = <K extends keyof Game>(key: K, value: Game[K]): void => { (game as unknown as Record<string, unknown>)[key] = value; };
const render = createRenderSystem(game);
set('render', render);
const mats = createMaterialLibrary(game);
set('mats', mats);
const sky = createSkySystem(game);
set('sky', sky);
if (!sky.root.parent) scene.add(sky.root);
const vfx = createVfxSystem(game);
set('vfx', vfx);

const w = window as unknown as Record<string, unknown>;
const setCam = (pos: [number, number, number], look: [number, number, number], fov?: number): void => {
  camera.position.set(pos[0], pos[1], pos[2]);
  target.set(look[0], look[1], look[2]);
  camera.lookAt(target);
  if (fov) { camera.fov = fov; camera.updateProjectionMatrix(); }
};
w.__h = { setCam };
w.__cam = (x: number, n: number, hh: number, lx: number, ln: number, lh: number, fov?: number) => setCam([x, hh, -n], [lx, lh, -ln], fov);

/** 1.85 m mannequin for scale */
function figure(color = 0x30343c): THREE.Group {
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.2 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.95, 6, 12), m);
  body.position.y = 1.05;
  const legs = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.5, 4, 10), m);
  legs.position.y = 0.45;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), m);
  head.position.y = 1.72;
  for (const p of [body, legs, head]) { p.castShadow = true; g.add(p); }
  return g;
}

async function boot(): Promise<void> {
  await mats.init();
  const root = new THREE.Group();
  root.name = `zone:${roomName}`;
  scene.add(root);
  const t0 = performance.now();
  const b: ZoneBuilder = createZoneBuilder(game, root, 1234);
  const room: Room = ROOMS[roomName](b);
  const buildMs = performance.now() - t0;
  setCam(room.cam.pos, room.cam.look);

  const figures = new THREE.Group();
  for (const [x, n, hh] of room.figures) {
    const f = figure();
    f.position.copy(b.P(x, n, hh));
    figures.add(f);
  }
  scene.add(figures);
  const walker = figure(0x7a2c20);
  walker.visible = false;
  scene.add(walker);
  const trail = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x40ffa0, depthTest: false }));
  trail.renderOrder = 999;
  trail.frustumCulled = false;
  scene.add(trail);

  let pending = 0;
  h.onUpdate((dt, t) => {
    pending += dt;
    const time = game.time as { now: number; dt: number; frame: number };
    time.now = t; time.dt = dt; time.frame++;
    game.scripts.update(dt);
    vfx.update(dt);
    mats.update(dt, t);
    sky.update(dt, camera);
  });
  h.setRender(() => { render.render(pending > 0 ? pending : 1 / 60); pending = 0; });
  addEventListener('resize', () => render.resize());

  // ---- debug helpers -----------------------------------------------------------------------------------
  const dbg = physics.debugObject() as THREE.Group;
  dbg.visible = false;
  scene.add(dbg);
  w.__debug = (on: boolean, layers?: string[]) => {
    dbg.visible = on;
    const layer = dbg.userData.layer as ((name: string, visible: boolean) => void) | undefined;
    if (on && layer) for (const name of ['surfaces', 'solids', 'nav', 'triggers', 'issues']) layer(name, !layers || layers.includes(name));
    (dbg.userData.refresh as (() => void) | undefined)?.();
  };
  w.__figures = (on: boolean) => { figures.visible = on; };
  w.__door = (i: number, open: boolean) => room.doors[i]?.setOpen(open);
  w.__doorState = (i: number, s: 'locked' | 'ready' | 'open' | 'sealed') => room.doors[i]?.setState(s);
  w.__barrier = (i: number, active: boolean) => room.barriers[i]?.setActive(active);
  w.__stats = () => ({
    room: roomName, level: render.quality.level, buildMs: Math.round(buildMs),
    sceneDrawCalls: render.stats.sceneDrawCalls, sceneTriangles: render.stats.sceneTriangles, drawCalls: render.stats.drawCalls,
    kit: b.stats, physics: physics.counts, navNodes: physics.nav.nodeCount, issues: physics.validate().map((i) => `${i.kind}: ${i.message}`),
    audio: played.slice(-6),
  });
  w.__dispose = () => {
    b.dispose();
    return { rootChildren: root.children.length, lightsLeft: (() => { let n = 0; scene.traverse((o) => { if ((o as THREE.Light).isLight && o.name.startsWith('kit')) n++; }); return n; })() };
  };
  w.__b = b;
  w.__physics = physics;

  /** walk the capsule through plan waypoints: nav path per leg, moveCharacter along it */
  const pos = { x: 0, y: 0, z: 0 };
  let facing = 0;
  w.__walk = (points: Array<[number, number, number]>) => {
    const trace: number[] = [];
    let blocked = 0, steps = 0, ok = true;
    const start = b.P(points[0][0], points[0][1], points[0][2]);
    pos.x = start.x; pos.y = start.y; pos.z = start.z;
    for (let i = 1; i < points.length; i++) {
      const goal = b.P(points[i][0], points[i][1], points[i][2]);
      const path = physics.nav.findPath(pos, goal);
      if (!path) { ok = false; break; }
      for (const wp of path.points.slice(1)) {
        for (let guard = 0; guard < 2000; guard++) {
          const dx = wp.x - pos.x, dz = wp.z - pos.z, d = Math.hypot(dx, dz);
          if (d < 0.06) break;
          const s = Math.min(0.12, d);
          const r = physics.moveCharacter(pos, 0.4, (dx / d) * s, (dz / d) * s);
          if (r.blocked) blocked++;
          if (Math.hypot(r.x - pos.x, r.z - pos.z) > 1e-4) facing = Math.atan2(-(r.x - pos.x), -(r.z - pos.z));
          pos.x = r.x; pos.y = r.y; pos.z = r.z;
          trace.push(pos.x, pos.y + 0.08, pos.z);
          steps++;
        }
      }
    }
    walker.visible = true;
    walker.position.set(pos.x, pos.y, pos.z);
    walker.rotation.y = facing;
    trail.geometry.setAttribute('position', new THREE.Float32BufferAttribute(trace, 3));
    return { ok, steps, blocked, end: [+pos.x.toFixed(2), +pos.y.toFixed(2), +(-pos.z).toFixed(2)] };
  };
  w.__follow = (dist = 3.6, height = 1.7) => {
    const fx = -Math.sin(facing), fz = -Math.cos(facing);
    setCam([pos.x - fx * dist + fz * 0.6, pos.y + height, pos.z - fz * dist - fx * 0.6], [pos.x + fx * 6, pos.y + 1.3, pos.z + fz * 6]);
  };

  await render.init();
  h.ready();
}

boot().catch((err) => {
  console.error('[sandbox] boot failed', err);
  ((window as unknown as { __aurelionErrors?: string[] }).__aurelionErrors ??= []).push(String(err?.stack ?? err));
});
