/**
 * Creatures sandbox.
 *
 *   ?who=elite&action=sweep&t=0.7        one creature, optional action advanced to t seconds
 *   ?view=lineup                         every creature + a 1.8 m human silhouette
 *   ?view=sheet&who=elite&action=sweep&times=0.4,0.75,1.2    contact sheet of one action
 *   ?view=joint                          elite joint closed / exposed / frozen / fractured
 *   ?view=drones                         security drone vs contaminated variant
 *   ?view=devices                        every device live (front row) and disabled / destroyed (back rows)
 *   ?view=states&who=weaver              shader states: base, flash, frozen, corrupted, dissolving, telegraph
 *   &stage=pale|dark  &variant=1  &seed=3  &manual=1
 *
 * Globals for tools/shot.cjs: __c (visuals), __play(action, i?), __seek(action, t, i?), __call(method, ...args),
 * __cam(preset | [pos], [look]), __info().
 */
import * as THREE from 'three';
import type { CharacterVisual, CreatureArchetype, DeviceArchetype } from '@/core/api';
import { asDevice, asDrone, asElite, asWallrunner, asWeaver, CREATURE_ACTIONS } from '@/core/api/creatures';
import { createCreature } from '@/chars/creatures';
import { createHarness, miniGame } from '../harness';

type Arch = CreatureArchetype | DeviceArchetype;

const q = new URLSearchParams(location.search);
const view = q.get('view') ?? 'single';
const stage = q.get('stage') ?? 'pale';
const h = createHarness({ bloom: true, env: 'dark', background: stage === 'dark' ? 0x05060a : 0x14161b, lights: false, exposure: 1 });
h.scene.environmentIntensity = stage === 'dark' ? 0.3 : 0.55;
const game = miniGame(h);

// ---------------------------------------------------------------------------------------------- stage
function buildStage(): void {
  const dark = stage === 'dark';
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), new THREE.MeshStandardMaterial({ color: 0x101116, roughness: 0.78, metalness: 0.0, envMapIntensity: 0.5 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  h.scene.add(floor);
  h.scene.add(new THREE.HemisphereLight(0xcfd8ff, 0x1a1410, dark ? 0.12 : 0.35));
  const key = new THREE.DirectionalLight(0xfff1dc, dark ? 0.9 : 1.9);
  key.position.set(5, 11, -7);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  const sc = key.shadow.camera;
  sc.left = -16; sc.right = 16; sc.top = 14; sc.bottom = -14; sc.far = 50;
  key.shadow.bias = -0.0006;
  key.shadow.normalBias = 0.02;
  h.scene.add(key);
  const fill = new THREE.DirectionalLight(0x8fa8ff, dark ? 0.25 : 0.45);
  fill.position.set(-7, 4, -5);
  h.scene.add(fill);
  const rim = new THREE.DirectionalLight(dark ? 0xb9c8ff : 0xffe7c0, dark ? 0.8 : 0.6);
  rim.position.set(-4, 16, 7);
  h.scene.add(rim);
  if (dark) return;
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x8f8a7e, roughness: 0.6, metalness: 0.1 });
  const goldMat = new THREE.MeshStandardMaterial({ color: 0xc9a45c, roughness: 0.35, metalness: 1 });
  const lightMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffe2a8, emissiveIntensity: 1.6 });
  const wall = new THREE.Group();
  for (let i = -7; i <= 7; i++) {
    const zz = 10 + (Math.abs(i) % 2) * 0.8;
    const rib = new THREE.Mesh(new THREE.BoxGeometry(2.6, 16, 1.2), wallMat);
    rib.position.set(i * 4, 8, zz);
    rib.receiveShadow = true;
    wall.add(rib);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(0.12, 16, 0.1), goldMat);
    trim.position.set(i * 4 + 1.1, 8, zz - 0.62);
    wall.add(trim);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 10, 0.06), lightMat);
    strip.position.set(i * 4 + 2, 6.5, 10.9);
    wall.add(strip);
  }
  const back = new THREE.Mesh(new THREE.BoxGeometry(70, 16, 0.5), wallMat);
  back.position.set(0, 8, 11.6);
  wall.add(back);
  h.scene.add(wall);
}
buildStage();

// ---------------------------------------------------------------------------------------------- helpers
const visuals: CharacterVisual[] = [];
const frozenClock = new Set<CharacterVisual>();

function spawn(who: Arch, x: number, z: number, opts: { y?: number; yaw?: number; variant?: number; seed?: number } = {}): CharacterVisual {
  const v = createCreature(game, who, { variant: opts.variant ?? Number(q.get('variant') ?? 0), seed: opts.seed ?? Number(q.get('seed') ?? 1) });
  const isDrone = who === 'secDrone' || who === 'contamDrone';
  v.root.position.set(x, opts.y ?? (isDrone ? 1.8 : 0), z);
  v.root.rotation.y = opts.yaw ?? 0;
  h.scene.add(v.root);
  visuals.push(v);
  v.update(0);
  return v;
}

/** play an action on one visual and advance only that visual to t seconds, then hold its clock */
function seek(v: CharacterVisual, action: string, t: number): void {
  frozenClock.delete(v);
  const sp = Number(q.get('speed') ?? 0);
  if (sp > 0) v.setLocomotion(sp, Number(q.get('moveYaw') ?? 0));
  if (action && action !== 'idle') v.play(action);
  const n = Math.max(1, Math.round(t * 60));
  for (let i = 0; i < n; i++) v.update(1 / 60);
  frozenClock.add(v);
}

function human(x: number, z: number): THREE.Group {
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color: 0x3a4250, roughness: 0.8 });
  const add = (geo: THREE.BufferGeometry, px: number, py: number, pz = 0): void => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(px, py, pz);
    mesh.castShadow = true;
    g.add(mesh);
  };
  add(new THREE.SphereGeometry(0.115, 12, 10), 0, 1.69);
  add(new THREE.CapsuleGeometry(0.19, 0.42, 4, 10), 0, 1.24);
  add(new THREE.CapsuleGeometry(0.085, 0.72, 4, 8), -0.1, 0.46);
  add(new THREE.CapsuleGeometry(0.085, 0.72, 4, 8), 0.1, 0.46);
  add(new THREE.CapsuleGeometry(0.06, 0.6, 4, 8), -0.28, 1.15);
  add(new THREE.CapsuleGeometry(0.06, 0.6, 4, 8), 0.28, 1.15);
  g.position.set(x, 0, z);
  h.scene.add(g);
  return g;
}

const labels: { el: HTMLDivElement; pos: THREE.Vector3 }[] = [];
function label(text: string, x: number, y: number, z: number): void {
  const el = document.createElement('div');
  el.textContent = text;
  el.style.cssText = 'position:fixed;transform:translate(-50%,0);font:600 12px/1.2 system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#e8dcc0;text-shadow:0 1px 3px #000,0 0 8px #000;white-space:nowrap;pointer-events:none';
  document.body.appendChild(el);
  labels.push({ el, pos: new THREE.Vector3(x, y, z) });
}
const _p = new THREE.Vector3();
function placeLabels(): void {
  h.camera.updateMatrixWorld();
  for (const l of labels) {
    _p.copy(l.pos).project(h.camera);
    l.el.style.left = ((_p.x * 0.5 + 0.5) * innerWidth).toFixed(1) + 'px';
    l.el.style.top = ((-_p.y * 0.5 + 0.5) * innerHeight).toFixed(1) + 'px';
    l.el.style.display = _p.z < 1 ? 'block' : 'none';
  }
}

const CREATURES: Arch[] = ['secDrone', 'contamDrone', 'wallrunner', 'weaver', 'elite'];
const DEVICES: Arch[] = ['commandEmitter', 'relayReceiver', 'scanHead', 'weaverAnchor', 'frostAnchor'];
const isArch = (s: string | null): s is Arch => !!s && ([...CREATURES, ...DEVICES] as string[]).includes(s);

// ---------------------------------------------------------------------------------------------- views
const who: Arch = isArch(q.get('who')) ? (q.get('who') as Arch) : 'elite';
const action = q.get('action') ?? '';
const tParam = Number(q.get('t') ?? 0);

function camFor(a: Arch): [[number, number, number], [number, number, number]] {
  switch (a) {
    case 'elite': return [[4.2, 2.2, -7.5], [0, 1.9, 0]];
    case 'weaver': return [[2.6, 1.6, -4.6], [0, 1.25, 0]];
    case 'wallrunner': return [[2.2, 1.0, -3.0], [0, 0.45, 0]];
    case 'secDrone': case 'contamDrone': return [[1.3, 2.15, -1.9], [0, 1.78, 0]];
    case 'frostAnchor': return [[1.8, 1.5, -2.6], [0, 0.2, 0]];
    case 'weaverAnchor': return [[1.7, 1.1, -2.6], [0, 0.5, 0]];
    default: return [[2.3, 1.6, -3.6], [0, 1.1, 0]];
  }
}

if (view === 'lineup') {
  const xs: [Arch, number, number?][] = [['secDrone', -7.2], ['contamDrone', -5.6], ['wallrunner', -3.4], ['weaver', 0.2], ['elite', 4.2]];
  human(-1.6, 0);
  label('1.8 m', -1.6, -0.08, 0);
  for (const [a, x] of xs) { spawn(a, x, 0, { yaw: 0.35 }); label(a, x, -0.08, 0); }
  h.setCam([-1.5, 2.1, -13.5], [-1.2, 1.7, 0], 34);
} else if (view === 'sheet') {
  const times = (q.get('times') ?? '0.3,0.7,1.2').split(',').map(Number).filter((n) => Number.isFinite(n));
  const span = Number(q.get('gap') ?? (who === 'elite' ? 6.2 : who === 'weaver' ? 3.4 : 2.6));
  times.forEach((t, i) => {
    const x = (i - (times.length - 1) / 2) * span;
    const v = spawn(who, x, 0, { yaw: Number(q.get('yaw') ?? 0.5) });
    seek(v, action || 'idle', t);
    label(`${action || 'idle'}  ${t.toFixed(2)} s`, x, -0.08, 0);
  });
  const [pos, look] = camFor(who);
  const d = Math.max(1, (times.length * span) / 5.2);
  h.setCam([0.6, look[1] + 0.5, pos[2] * d * 1.25], [0, look[1], 0], 36);
} else if (view === 'joint') {
  const states = ['closed', 'exposed', 'frozen', 'fractured'];
  states.forEach((s, i) => {
    const x = (i - 1.5) * 5.4;
    const v = spawn('elite', x, 0, { yaw: -0.75 });
    if (s === 'exposed') { v.setExposed('joint', 1); seek(v, 'exposeJoint', 1.6); }
    else if (s === 'frozen') { v.setExposed('joint', 1); seek(v, 'exposeJoint', 1.6); v.setFrozen(0.38); v.update(0); }
    else if (s === 'fractured') { seek(v, 'fracture', 2.6); }
    else seek(v, 'idle', 0.5);
    label(s, x, -0.08, 0);
  });
  h.setCam([0, 3.0, -15.5], [0, 2.1, 0], 36);
} else if (view === 'drones') {
  spawn('secDrone', -0.85, 0, { yaw: 0.6 });
  spawn('contamDrone', 0.85, 0, { yaw: 0.6 });
  label('secDrone', -0.85, 1.25, 0);
  label('contamDrone', 0.85, 1.25, 0);
  h.setCam([0.9, 2.15, -3.1], [0, 1.75, 0], 40);
} else if (view === 'devices') {
  const order: [Arch, number][] = [['commandEmitter', 0], ['relayReceiver', 0], ['relayReceiver', 1], ['scanHead', 0], ['weaverAnchor', 0], ['frostAnchor', 0]];
  order.forEach(([a, variant], i) => {
    const x = (i - (order.length - 1) / 2) * 2.5;
    spawn(a, x, 0, { variant, yaw: 0.45 });
    const d = spawn(a, x, 3.6, { variant, yaw: 0.45 });
    asDevice(d)?.setDisabled(true);
    for (let k = 0; k < 90; k++) d.update(1 / 60);
    label(a + (a === 'relayReceiver' ? (variant ? ' B' : ' A') : ''), x, -0.08, 0);
  });
  label('live', -8.4, 1.2, 0);
  label('disabled', -8.4, 1.2, 3.6);
  h.setCam([1.5, 4.6, -11.5], [0, 0.9, 1.6], 38);
} else if (view === 'states') {
  const states = ['base', 'flash', 'frozen', 'corrupt', 'dissolve', 'telegraph', 'rim'];
  const span = who === 'elite' ? 4.6 : 2.4;
  states.forEach((s, i) => {
    const x = (i - (states.length - 1) / 2) * span;
    const v = spawn(who, x, 0, { yaw: 0.4 });
    v.update(0.3);
    if (s === 'flash') v.flash(0xffffff, 10);
    if (s === 'frozen') v.setFrozen(1);
    if (s === 'corrupt') v.setCorruption(1);
    if (s === 'dissolve') v.setDissolve(0.5);
    if (s === 'telegraph') v.setTelegraph(1, 0xff3b2a);
    if (s === 'rim') v.setRim(1, 0xa8d8ff);
    v.update(1 / 60);
    label(s, x, -0.08, 0);
  });
  const [pos, look] = camFor(who);
  h.setCam([0, look[1] + 0.6, pos[2] * (states.length * span) / 4.4], [0, look[1], 0], 34);
} else {
  const v = spawn(who, 0, 0, { yaw: Number(q.get('yaw') ?? 0) });
  if (action) {
    if (tParam > 0) seek(v, action, tParam);
    else v.play(action);
  }
  const [pos, look] = camFor(who);
  h.setCam(pos, look, 40);
}

const speedParam = Number(q.get('speed') ?? 0);
if (speedParam > 0) for (const v of visuals) v.setLocomotion(speedParam, Number(q.get('moveYaw') ?? 0));
h.onUpdate((dt) => {
  for (const v of visuals) if (!frozenClock.has(v)) v.update(dt);
  placeLabels();
});

// ---------------------------------------------------------------------------------------------- shot API
const w = window as unknown as Record<string, unknown>;
w.__c = visuals;
w.__ext = { asDevice, asDrone, asElite, asWallrunner, asWeaver };
w.__play = (a: string, i = 0) => visuals[i]?.play(a);
w.__seek = (a: string, t: number, i = 0) => { const v = visuals[i]; if (v) seek(v, a, t); h.render(); };
w.__hold = (i = 0, hold = true) => { const v = visuals[i]; if (!v) return; if (hold) frozenClock.add(v); else frozenClock.delete(v); };
w.__call = (method: string, ...args: unknown[]) => {
  for (const v of visuals) {
    const fn = (v as unknown as Record<string, unknown>)[method];
    if (typeof fn === 'function') (fn as (...a: unknown[]) => unknown).apply(v, args);
  }
  for (const v of visuals) v.update(0);
  h.render();
};
w.__cam = (pos: [number, number, number], look: [number, number, number], fov?: number) => { h.setCam(pos, look, fov); placeLabels(); h.render(); };
w.__info = () => ({
  tris: h.renderer.info.render.triangles, calls: h.renderer.info.render.calls,
  actions: CREATURE_ACTIONS[who], visuals: visuals.map((v) => ({ a: v.archetype, h: v.height, r: v.radius })),
});
placeLabels();
h.ready();
