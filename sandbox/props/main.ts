/**
 * Hero-prop sandbox — one prop on a stage built with the real kit, rendered by the REAL render system with the
 * real material library and sky (so emissive levels are judged against the shipping post chain).
 *
 * URL:  ?p=<prop>   crownmarkFive | nestedRings | assentInterface | stabilizer | recognitionThreshold |
 *                   containmentCage | fallenPlate | observationSet | departureShip | hologram | chamber (trio)
 *       &kind=…     assent side / cage kind / ship kind / hologram kind
 *       &radius=…   nestedRings outer radius
 *       &<param>=v  initial value of any prop parameter (applied instantly)
 *       &stage=black|white   &q=low|medium|high|ultra (default high)   &nopost=1   &manual=1   &nofig=1
 * Console / tools/shot.cjs --eval:
 *   __set(param, value)   __snap()   __step(seconds)   __text(str)   __stats()
 *   __h.setCam([x,y,z],[lx,ly,lz],fov?)
 */
import * as THREE from 'three';
import type { AudioSystem, Game, HeroProp, HologramKind, QualityLevel } from '@/core/api';
import { createRenderSystem } from '@/render';
import { LOOKS } from '@/render/looks';
import { createSkySystem } from '@/render/sky';
import { createZoneBuilder } from '@/world/kit';
import { createMaterialLibrary } from '@/world/materials';
import { createPhysicsWorld } from '@/world/physics';
import { createHeroProps } from '@/world/props';
import { createCanvasOnly, miniGame, withStubs } from '../harness';

type AnyProp = HeroProp<Record<string, number>> & { setText?: (s: string) => void; socketNames?: () => string[] };

const h = createCanvasOnly();
const q = h.params;
const levels: QualityLevel[] = ['low', 'medium', 'high', 'ultra'];
const quality = levels.includes(q.get('q') as QualityLevel) ? (q.get('q') as QualityLevel) : 'high';
const which = q.get('p') ?? 'crownmarkFive';
const kind = q.get('kind') ?? '';

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 6000);
const target = new THREE.Vector3();
const physics = createPhysicsWorld(null);
const game = miniGame(null, {
  canvas: h.canvas, scene, physics,
  audio: withStubs<AudioSystem>('audio', {}),
  flags: { zone: null, beat: null, checkpoint: null, debug: true, autoplay: false, mute: true, nopost: q.has('nopost'), quality, manual: q.has('manual'), seed: 7283 },
  camera: withStubs<Game['camera']>('camera', { camera }),
});
const put = <K extends keyof Game>(key: K, value: Game[K]): void => { (game as unknown as Record<string, unknown>)[key] = value; };
const render = createRenderSystem(game);
put('render', render);
const mats = createMaterialLibrary(game);
put('mats', mats);
const sky = createSkySystem(game);
put('sky', sky);
if (!sky.root.parent) scene.add(sky.root);

const w = window as unknown as Record<string, unknown>;
const setCam = (pos: [number, number, number], look: [number, number, number], fov?: number): void => {
  camera.position.set(pos[0], pos[1], pos[2]);
  target.set(look[0], look[1], look[2]);
  camera.lookAt(target);
  if (fov) { camera.fov = fov; camera.updateProjectionMatrix(); }
};
w.__h = { setCam };

/** 1.8 m mannequin for scale */
function figure(): THREE.Group {
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color: 0x6a6f7a, roughness: 0.6, metalness: 0.2 });
  const add = (geo: THREE.BufferGeometry, y: number): void => {
    const p = new THREE.Mesh(geo, m);
    p.position.y = y;
    p.castShadow = true;
    g.add(p);
  };
  add(new THREE.CapsuleGeometry(0.24, 0.62, 6, 12), 1.14);
  add(new THREE.CapsuleGeometry(0.19, 0.5, 4, 10), 0.44);
  add(new THREE.SphereGeometry(0.115, 12, 10), 1.69);
  return g;
}

interface Stage { stage: 'black' | 'white'; sky: Parameters<typeof sky.setPreset>[0]; look: keyof typeof LOOKS; cam: [[number, number, number], [number, number, number]]; fig: [number, number] | null }
const STAGES: Record<string, Stage> = {
  crownmarkFive: { stage: 'black', sky: 'coreChamber', look: 'core', cam: [[2.6, 1.7, -5.2], [0, 1.45, 0]], fig: [2.3, -0.4] },
  nestedRings: { stage: 'black', sky: 'coreChamber', look: 'core', cam: [[0, 1.7, -30], [0, 18, 20]], fig: [0, -8] },
  assentInterface: { stage: 'black', sky: 'coreChamber', look: 'core', cam: [[1.5, 1.7, -2.3], [0, 0.95, 0]], fig: [-1.1, 0.2] },
  stabilizer: { stage: 'white', sky: 'battleCeiling', look: 'atrium', cam: [[4.5, 2.4, -7], [0, 1.9, 0]], fig: [2.2, 0.3] },
  recognitionThreshold: { stage: 'black', sky: 'woundVista', look: 'woundGallery', cam: [[2.5, 3.2, -6.5], [0, 0, 0.6]], fig: [3.3, -1.5] },
  containmentCage: { stage: 'black', sky: 'breachDeep', look: 'gallery', cam: [[9, 4.5, -19], [0, 3.4, 0]], fig: [4.6, -1] },
  fallenPlate: { stage: 'white', sky: 'breachDeep', look: 'breach', cam: [[4.6, 2.5, -6.6], [0, 0.7, 0]], fig: [-0.6, -2.5] },
  observationSet: { stage: 'black', sky: 'observation', look: 'observation', cam: [[3.6, 2.3, -4.8], [0, 0.7, 0]], fig: [2.7, 0.4] },
  departureShip: { stage: 'white', sky: 'hangar', look: 'hangar', cam: [[7, 3, -17], [0, 2.2, 0]], fig: [2.6, -5.5] },
  hologram: { stage: 'black', sky: 'coreChamber', look: 'gallery', cam: [[0.9, 1.6, -3.4], [0, 1.45, 0]], fig: [1.7, 0.2] },
  chamber: { stage: 'black', sky: 'coreChamber', look: 'core', cam: [[0, 1.75, -11.5], [0, 3.4, 0]], fig: null },
};

async function boot(): Promise<void> {
  await mats.init();
  const st = STAGES[which] ?? STAGES.crownmarkFive;
  const stage = (q.get('stage') as 'black' | 'white' | null) ?? st.stage;
  const root = new THREE.Group();
  root.name = 'zone:props';
  scene.add(root);
  const b = createZoneBuilder(game, root, 4242);
  b.setEnv({ sky: st.sky, look: LOOKS[st.look], key: { dirFrom: [6, 16, 9], intensity: stage === 'black' ? 0.9 : 1.6, color: 0xfff1dc } });
  if (stage === 'black') b.disc({ x: 0, n: 0, r: 46, mat: 'blackStoneFloor', reflective: true, inlay: 'none' });
  else b.floor({ x: 0, n: 0, w: 80, d: 80, mat: 'whiteGoldFloor', inlay: 'none' });
  // a zone-like rig: cool fill from the front left, warm fill from the front right, a steep key spot
  b.point({ x: -6, n: 5, h: 5, color: 0xbfd0ff, intensity: 70, distance: 30 });
  b.point({ x: 7, n: 7, h: 4, color: 0xffe2b8, intensity: 60, distance: 30 });
  b.spot({ x: 3, n: 8, h: 11, target: [0, 0, 1.2], color: 0xfff0dc, intensity: 900, angleDeg: 30, penumbra: 0.7, distance: 44 });
  b.spot({ x: -7, n: 6, h: 8, target: [0, 0, 1.5], color: 0xcfe0ff, intensity: 500, angleDeg: 36, penumbra: 0.8, distance: 40 });
  b.finalize();

  const hero = createHeroProps(game);
  const props: AnyProp[] = [];
  const place = (p: AnyProp, x: number, z: number, yaw = 0): AnyProp => {
    p.object.position.set(x, 0, z);
    p.object.rotation.y = yaw;
    root.add(p.object);
    props.push(p);
    return p;
  };
  let main: AnyProp;
  switch (which) {
    case 'nestedRings': main = place(hero.nestedRings({ radius: q.has('radius') ? Number(q.get('radius')) : undefined }) as AnyProp, 0, 0); break;
    case 'assentInterface': main = place(hero.assentInterface(kind === 'selene' ? 'selene' : 'tarrik') as AnyProp, 0, 0); break;
    case 'stabilizer': main = place(hero.stabilizer() as AnyProp, 0, 0); break;
    case 'recognitionThreshold': main = place(hero.recognitionThreshold() as AnyProp, 0, 0); break;
    case 'containmentCage': main = place(hero.containmentCage(kind === 'reformation' ? 'reformation' : 'dominion') as AnyProp, 0, 0); break;
    case 'fallenPlate': main = place(hero.fallenPlate() as AnyProp, 0, 0); break;
    case 'observationSet': main = place(hero.observationSet() as AnyProp, 0, 0); break;
    case 'departureShip': main = place(hero.departureShip(kind === 'reformationTransport' ? 'reformationTransport' : 'dominionShuttle') as AnyProp, 0, 0); break;
    case 'hologram': main = place(hero.hologram((kind || 'trajectory') as HologramKind) as AnyProp, 0, 0); break;
    case 'chamber': {
      main = place(hero.crownmarkFive() as AnyProp, 0, 0);
      place(hero.nestedRings({ radius: 60 }) as AnyProp, 0, 0);
      place(hero.assentInterface('tarrik') as AnyProp, 2.6, -1.5, -0.5);
      place(hero.assentInterface('selene') as AnyProp, -2.6, -1.5, 0.5);
      for (const [x, z] of [[3.05, -2.1], [-3.05, -2.1]]) { const f = figure(); f.position.set(x, 0, z); root.add(f); }
      break;
    }
    default: main = place(hero.crownmarkFive() as AnyProp, 0, 0);
  }
  // any URL parameter named like a prop parameter sets its initial value
  for (const p of props) for (const key of Object.keys(p.params)) if (q.has(key)) p.params[key] = Number(q.get(key));
  if (q.has('text')) main.setText?.(q.get('text') ?? '');
  if (st.fig && !q.has('nofig')) { const f = figure(); f.position.set(st.fig[0], 0, st.fig[1]); root.add(f); }
  setCam(st.cam[0], st.cam[1]);

  let pending = 0;
  h.onUpdate((dt, t) => {
    pending += dt;
    const time = game.time as { now: number; dt: number; frame: number };
    time.now = t; time.dt = dt; time.frame++;
    game.scripts.update(dt);
    for (const p of props) p.update(dt, t);
    mats.update(dt, t);
    sky.update(dt, camera);
  });
  h.setRender(() => { render.render(pending > 0 ? pending : 1 / 60); pending = 0; });
  addEventListener('resize', () => render.resize());

  w.__set = (name: string, value: number) => { for (const p of props) if (name in p.params) p.params[name] = value; };
  w.__snap = () => { for (const p of props) p.snap(); };
  w.__text = (s: string) => main.setText?.(s);
  w.__props = props;
  w.__stats = () => props.map((p) => {
    let draws = 0, tris = 0;
    p.object.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.visible) return;
      draws++;
      const g = m.geometry, n = g.index ? g.index.count : g.attributes.position?.count ?? 0;
      tris += (n / 3) * ((o as THREE.InstancedMesh).isInstancedMesh ? (o as THREE.InstancedMesh).count : 1);
    });
    return { name: p.object.name, draws, tris: Math.round(tris), sockets: p.socketNames?.() ?? [], colliders: p.colliders?.length ?? 0, sceneDrawCalls: render.stats.sceneDrawCalls };
  });

  await render.init();
  h.ready();
}

boot().catch((err) => {
  console.error('[sandbox] boot failed', err);
  ((window as unknown as { __aurelionErrors?: string[] }).__aurelionErrors ??= []).push(String(err?.stack ?? err));
});
