/**
 * VFX sandbox — a dark reflective floor, a 1.8 m reference pillar and every effect on demand.
 *
 *   /sandbox/vfx/                     gallery of all families, looping
 *   /sandbox/vfx/?fx=cinderSlam       one effect, looping
 *   /sandbox/vfx/?gallery=frost       one family in a row
 *   /sandbox/vfx/?atlas=1             the procedural sprite atlas
 *   &manual=1                         no RAF loop: drive with the globals below (tools/shot.cjs)
 *   &soft=1                           depth pre-pass → soft particles;  &bright=1  white-gold floor;  &reduce=1  reduceFlash
 *
 * Globals: __fx(id, opts?)  __step(t)  __gallery(family?)  __beams()  __tracers()  __telegraphs(seconds?)
 *          __trail()  __swing(t)  __ambient(kind)  __decals()  __scan(alert?)  __clear()  __stats()  __vfx
 */
import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import type { AmbientKind, BeamStyle, PhysicsWorld, VfxHandle, VfxOpts, VfxSystem } from '@/core/api';
import { VFX_NOTES } from '@/core/api';
import { createVfxSystem } from '@/vfx';
import { createAtlasTexture } from '@/vfx/atlas';
import { EFFECT_FAMILIES } from '@/vfx/library';
import { createHarness, miniGame, withStubs } from '../harness';

const h = createHarness({ bloom: true, env: 'dark', background: 0x05060a, lights: true });
const q = h.params;
const bright = q.has('bright');

// ---------------------------------------------------------------------------------------------- stage
// polished black stone: a dim planar mirror under a glossy lit slab, with thin gold channels every 2 m
const mirror = new Reflector(new THREE.PlaneGeometry(120, 120), { textureWidth: 640, textureHeight: 360, color: bright ? 0x8a8478 : 0x3a3c44 });
mirror.rotation.x = -Math.PI / 2;
mirror.position.y = -0.004;
h.scene.add(mirror);
const slab = new THREE.Mesh(
  new THREE.PlaneGeometry(120, 120),
  new THREE.MeshStandardMaterial({ color: bright ? 0xb9b2a2 : 0x0b0c10, roughness: bright ? 0.35 : 0.16, metalness: 0.0, transparent: true, opacity: bright ? 0.8 : 0.72 }),
);
slab.rotation.x = -Math.PI / 2;
slab.receiveShadow = true;
h.scene.add(slab);
const channelMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffc56b, emissiveIntensity: 1.1 });
const channels = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.004, 0.02), channelMat, 62);
{
  const m = new THREE.Matrix4();
  let i = 0;
  for (let k = -15; k <= 15; k++) {
    m.makeScale(60, 1, 1).setPosition(0, 0.002, k * 2 + 1);
    channels.setMatrixAt(i++, m);
    m.makeRotationY(Math.PI / 2).scale(new THREE.Vector3(60, 1, 1)).setPosition(k * 2 + 1, 0.002, 0);
    channels.setMatrixAt(i++, m);
  }
}
h.scene.add(channels);

// 1.8 m reference pillar (human height) with a white-gold cap line
const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.8, 0.5), new THREE.MeshStandardMaterial({ color: 0x8f8a80, roughness: 0.55, metalness: 0.2 }));
pillar.position.set(-1.4, 0.9, 0);
pillar.castShadow = true;
h.scene.add(pillar);
const cap = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.02, 0.52), new THREE.MeshStandardMaterial({ color: 0, emissive: 0xffe2a8, emissiveIntensity: 2 }));
cap.position.set(-1.4, 1.8, 0);
h.scene.add(cap);

// ---------------------------------------------------------------------------------------------- vfx
const physics = withStubs<PhysicsWorld>('physics', {
  groundAt: (_x: number, _z: number, yRef: number) => (yRef >= -0.5 ? ({ y: 0, surface: null } as unknown as ReturnType<PhysicsWorld['groundAt']>) : null),
} as Partial<PhysicsWorld>);
const game = miniGame(h, { physics });
if (q.has('reduce')) game.settings.set('reduceFlash', true);
const vfx: VfxSystem = createVfxSystem(game);
h.onUpdate((dt) => vfx.update(dt));

// optional depth pre-pass feeding soft particles
if (q.has('soft')) {
  const size = h.renderer.getDrawingBufferSize(new THREE.Vector2());
  const depthRT = new THREE.WebGLRenderTarget(size.x, size.y, { depthTexture: new THREE.DepthTexture(size.x, size.y), depthBuffer: true });
  const vfxRoot = h.scene.getObjectByName('vfx');
  const baseRender = h.render.bind(h);
  h.render = () => {
    if (vfxRoot) vfxRoot.visible = false;
    mirror.visible = false;
    h.renderer.setRenderTarget(depthRT);
    h.renderer.render(h.scene, h.camera);
    h.renderer.setRenderTarget(null);
    mirror.visible = true;
    if (vfxRoot) vfxRoot.visible = true;
    vfx.setSoftDepth(depthRT.depthTexture, size.x, size.y, h.camera.near, h.camera.far);
    baseRender();
  };
}

/** sensible stage placement per effect: position, axis, scale */
const STAGE: Record<string, VfxOpts & { pos?: [number, number, number]; cam?: [[number, number, number], [number, number, number]] }> = {
  sparkHit: { pos: [-1.14, 1.2, 0.1], dir: { x: 1, y: 0.15, z: 0.3 } },
  sparkHeavy: { pos: [-1.14, 1.2, 0.1], dir: { x: 1, y: 0.15, z: 0.3 } },
  metalChip: { pos: [-1.14, 1.2, 0.1], dir: { x: 1, y: 0.2, z: 0.3 } },
  stoneChip: { pos: [-1.14, 1.0, 0.1], dir: { x: 1, y: 0.2, z: 0.3 } },
  dustPuff: { pos: [0, 0.05, 0] },
  cinderBurst: { pos: [0, 1.2, 0], dir: { x: 0.4, y: 0.8, z: 0.3 } },
  cinderEmbers: { pos: [0, 1.2, 0] },
  cinderStickyArm: { pos: [-1.14, 1.3, 0.1] },
  cinderStickyBlast: { pos: [0, 1.0, 0] },
  frostBurst: { pos: [0, 1.2, 0], dir: { x: 0.5, y: 0.6, z: 0.5 } },
  frostShatter: { pos: [0, 1.1, 0] },
  frostArrest: { pos: [0, 1.1, 0] },
  dispatchStreak: { pos: [-2.4, 1.2, 0.6], dir: { x: 1, y: 0, z: 0 }, scale: 1.1 },
  violetBurst: { pos: [0, 1.2, 0], dir: { x: 0.4, y: 0.6, z: 0.6 } },
  linkSever: { pos: [0, 1.3, 0], dir: { x: 1, y: 0, z: 0 } },
  eclipseDissolve: { pos: [0, 0.95, 0] },
  muzzleWarm: { pos: [-0.6, 1.4, 0.4], dir: { x: 1, y: 0, z: 0 } },
  muzzleCold: { pos: [-0.6, 1.4, 0.4], dir: { x: 1, y: 0, z: 0 } },
  droneCharge: { pos: [0, 1.8, 0] },
  droneBoltHit: { pos: [-1.14, 1.3, 0.1], dir: { x: 1, y: 0, z: 0.3 } },
  shieldHit: { pos: [0, 1.2, 0], dir: { x: 0.35, y: 0, z: 1 }, scale: 1 },
  shieldBreak: { pos: [0, 1.2, 0], dir: { x: 0.35, y: 0, z: 1 } },
  deflect: { pos: [0, 1.3, 0.2], dir: { x: 0.3, y: 0.3, z: 1 } },
  explosionSmall: { pos: [0, 0.4, 0] },
  explosionLarge: { pos: [0, 0.2, 0], cam: [[6, 3, 9], [0, 1.8, 0]] },
  deviceBreak: { pos: [0, 1.0, 0] },
  debrisFall: { pos: [0, 5, 0], cam: [[4.5, 2.4, 6.5], [0, 2.2, 0]] },
  echoGain: { pos: [0, 1.2, 0] },
  interactPing: { pos: [0, 1.1, 0] },
  thermalFracture: { pos: [0, 1.7, 0], cam: [[5, 2.4, 7.5], [0, 1.6, 0]] },
  resonanceRing: { pos: [0, 1.7, 0] },
  quarantineSeal: { pos: [0, 0, -1], dir: { x: 0.25, y: 0, z: 1 }, scale: 0.75, cam: [[5, 2.4, 7.5], [0, 1.7, 0]] },
  meridianComplete: { pos: [0, 0, 0], scale: 0.7, cam: [[7, 4.5, 10], [0, 1.5, 0]] },
  boundaryClose: { pos: [0, 3.4, -5], dir: { x: 0, y: 0, z: 1 }, scale: 0.5, cam: [[2, 2.2, 8], [0, 3, -5]] },
  grammarPropagate: { pos: [0, 0, 0], cam: [[6, 5, 9], [0, 0, 0]] },
  carrierShadowDust: { pos: [0, 0, 0], scale: 0.6, cam: [[6, 2.2, 9], [0, 2.2, 0]] },
  coherentPlane: { pos: [0, 1.3, 0], scale: 0.6 },
  witnessMote: { pos: [0, 1.4, 0] },
  pressurePulse: { pos: [0, 0, 0], scale: 0.6, cam: [[6, 3.5, 9], [0, 0.6, 0]] },
  cinderSlam: { pos: [0, 0, 0], cam: [[4.5, 2.6, 6.5], [0, 0.7, 0]] },
  stasisField: { pos: [0, 0, 0], scale: 0.7, cam: [[5, 2.6, 7.5], [0, 1.1, 0]] },
};

const V = (p: [number, number, number], off = new THREE.Vector3()): THREE.Vector3 => new THREE.Vector3(p[0], p[1], p[2]).add(off);

function fx(id: string, opts: VfxOpts = {}, offset = new THREE.Vector3()): VfxHandle {
  const st = STAGE[id] ?? {};
  return vfx.spawn(id, V(st.pos ?? [0, 0, 0], offset), { dir: st.dir, scale: st.scale, ...opts });
}

// ---------------------------------------------------------------------------------------------- labels
const labelRoot = document.createElement('div');
labelRoot.style.cssText = 'position:fixed;inset:0;pointer-events:none;font:600 12px/1.2 system-ui,sans-serif;color:#d9d2c0;letter-spacing:.06em;text-transform:uppercase';
document.body.appendChild(labelRoot);
const labels: Array<{ el: HTMLElement; p: THREE.Vector3 }> = [];
function label(text: string, p: THREE.Vector3): void {
  const el = document.createElement('div');
  el.textContent = text;
  el.style.cssText = 'position:absolute;transform:translate(-50%,0);white-space:nowrap;text-shadow:0 1px 3px #000;opacity:.85';
  labelRoot.appendChild(el);
  labels.push({ el, p });
}
function clearLabels(): void {
  for (const l of labels) l.el.remove();
  labels.length = 0;
}
const _proj = new THREE.Vector3();
function placeLabels(): void {
  for (const l of labels) {
    _proj.copy(l.p).project(h.camera);
    const vis = _proj.z < 1 && Math.abs(_proj.x) < 1.1 && Math.abs(_proj.y) < 1.1;
    l.el.style.display = vis ? 'block' : 'none';
    l.el.style.left = `${(_proj.x * 0.5 + 0.5) * innerWidth}px`;
    l.el.style.top = `${(-_proj.y * 0.5 + 0.5) * innerHeight}px`;
  }
}
{
  const base = h.render.bind(h);
  h.render = () => { base(); placeLabels(); };
}

// ---------------------------------------------------------------------------------------------- scenes
const SPACING = 6;
const galleryIds = (family?: string): string[] => (family && EFFECT_FAMILIES[family] ? [...EFFECT_FAMILIES[family]] : Object.values(EFFECT_FAMILIES).flat());

/** lay a family (or everything) out on a grid, spawn each once, frame the camera */
function gallery(family?: string): string[] {
  clearLabels();
  const ids = galleryIds(family);
  const cols = family ? ids.length : 9;
  const rows = Math.ceil(ids.length / cols);
  ids.forEach((id, i) => {
    const off = new THREE.Vector3(((i % cols) - (cols - 1) / 2) * SPACING, 0, (Math.floor(i / cols) - (rows - 1) / 2) * SPACING);
    fx(id, {}, off);
    label(id, off.clone().add(new THREE.Vector3(0, -0.15, 1.8)));
  });
  const w = cols * SPACING, d = rows * SPACING;
  h.setCam([0, 3.2 + d * 0.45, w * 0.42 + d * 0.75 + 3], [0, 0.9, 0], 50);
  return ids;
}

function beams(): void {
  clearLabels();
  const styles: BeamStyle[] = ['link', 'laser', 'scan', 'tether', 'command', 'relay', 'trace', 'gold'];
  styles.forEach((s, i) => {
    const z = (i - (styles.length - 1) / 2) * 0.9;
    vfx.beam({ x: -3, y: 1.3, z }, { x: 3, y: s === 'link' ? 1.0 : 1.3, z }, s);
    label(s, new THREE.Vector3(-3.5, 1.4, z));
  });
  h.setCam([0.6, 4.2, 5.6], [0, 1.0, 0], 46);
}

function tracers(): void {
  clearLabels();
  (['warm', 'cold', 'drone', 'violet', 'rifle'] as const).forEach((s, i) => {
    const z = (i - 2) * 0.9;
    vfx.tracer({ x: -5, y: 1.3, z }, { x: 5, y: 1.3, z }, s, { speed: 14 });
    label(s, new THREE.Vector3(-5.4, 1.4, z));
  });
  h.setCam([0.5, 3.4, 6.4], [0, 1.1, 0], 46);
}

function telegraphs(seconds = 2): void {
  clearLabels();
  vfx.telegraph({ kind: 'circle', pos: { x: -4, y: 0, z: 0 }, r: 1.8 }, seconds);
  vfx.telegraph({ kind: 'line', from: { x: -1.2, y: 0, z: 2 }, to: { x: 0.8, y: 0, z: -3 }, width: 1.2 }, seconds);
  vfx.telegraph({ kind: 'cone', pos: { x: 4, y: 0, z: 1.5 }, yaw: 0.3, arc: Math.PI * 0.55, r: 3.6 }, seconds, 0x8a4cff);
  label('circle', new THREE.Vector3(-4, 0, 2.2));
  label('line', new THREE.Vector3(-1.2, 0, 2.5));
  label('cone', new THREE.Vector3(4, 0, 2.2));
  h.setCam([0, 6.5, 8], [0, 0, -0.3], 46);
}

// a simulated sword swing: two sockets on a rotating arm
const arm = new THREE.Group();
arm.position.set(0.4, 1.25, 0.6);
const socketBase = new THREE.Object3D();
socketBase.position.set(0, 0, 0.45);
const socketTip = new THREE.Object3D();
socketTip.position.set(0, 0, 1.75);
const blade = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.09, 1.3), new THREE.MeshStandardMaterial({ color: 0x3a3c44, metalness: 0.9, roughness: 0.25, emissive: 0xff6a1a, emissiveIntensity: 0.6 }));
blade.position.set(0, 0, 1.1);
arm.add(socketBase, socketTip, blade);
arm.visible = false;
h.scene.add(arm);
let swingT = -1;
let trailHandle: ReturnType<VfxSystem['trail']> | null = null;
function poseArm(t: number): void {
  // wind-up → fast horizontal arc with a slight dip → follow-through
  const u = Math.min(1, Math.max(0, t / 0.34));
  const e = u * u * (3 - 2 * u);
  arm.rotation.set(0.5 - 0.75 * Math.sin(e * Math.PI), 2.0 - e * 4.1, 0.25 * Math.sin(e * Math.PI), 'YXZ');
  arm.updateMatrixWorld(true);
}
h.onUpdate((dt) => {
  if (swingT < 0) return;
  swingT += dt;
  poseArm(swingT);
  trailHandle?.setActive(swingT > 0.02 && swingT < 0.36);
});
function trail(color = 0xff8a3a): void {
  clearLabels();
  arm.visible = true;
  trailHandle ??= vfx.trail(socketBase, socketTip, { color });
  trailHandle.setColor(color);
  swingT = 0;
  poseArm(0);
  h.setCam([1.6, 2.5, 4.4], [0.4, 1.1, 0.6], 50);
}

function ambient(kind: AmbientKind): void {
  vfx.ambient(kind, { x: 0, y: 3, z: 0 }, { x: 40, y: 6, z: 40 });
  h.setCam([3.2, 1.7, 5.2], [0, 1.4, 0], 55);
}

function decals(): void {
  clearLabels();
  (['scorch', 'frost', 'violet', 'crack', 'goldRing'] as const).forEach((k, i) => {
    const x = (i - 2) * 3.2;
    vfx.decal(k, { x, y: 0, z: 0 }, { size: 2.6, life: 30 });
    label(k, new THREE.Vector3(x, 0, 1.7));
  });
  vfx.decal('scorch', { x: -1.14, y: 1.0, z: 0 }, { normal: { x: 1, y: 0, z: 0 }, size: 0.5, life: 30 });
  h.setCam([0, 6.5, 6.5], [0, 0, 0], 50);
}

let scanA: ReturnType<VfxSystem['scanPlane']> | null = null;
function scan(alert = 0): void {
  scanA ??= vfx.scanPlane();
  scanA.setPose({ x: 0.6, y: 1.5, z: 0 }, 0.5, 6, 3);
  scanA.setAlert(alert);
  h.setCam([3.6, 2.0, 5.6], [0.3, 1.3, 0], 50);
}

function showAtlas(): void {
  const tex = createAtlasTexture();
  const m = new THREE.Mesh(new THREE.PlaneGeometry(8, 4), new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false }));
  m.position.set(0, 2.4, 0);
  h.scene.add(m);
  pillar.visible = cap.visible = false;
  h.setCam([0, 2.4, 6.2], [0, 2.4, 0], 50);
}

function stats(): Record<string, number> {
  const info = h.renderer.info;
  return { ...vfx.stats, drawCalls: info.render.calls, triangles: info.render.triangles };
}

// ---------------------------------------------------------------------------------------------- boot
const one = q.get('fx');
const fam = q.get('gallery');
if (q.has('atlas')) showAtlas();
else if (one) {
  const st = STAGE[one];
  if (st?.cam) h.setCam(st.cam[0], st.cam[1], 50);
  else h.setCam([3.4, 2.0, 5.0], [0, 1.0, 0], 50);
  label(`${one} — ${VFX_NOTES[one] ?? 'one-shot at pos'}`, new THREE.Vector3(0, -0.1, 2.4));
  if (!q.has('manual')) {
    let handle = fx(one);
    let wait = 0;
    h.onUpdate((dt) => {
      if (handle.alive) return;
      wait += dt;
      if (wait > 0.8) { wait = 0; handle = fx(one); }
    });
  }
} else if (!q.has('manual') || fam) {
  let ids = gallery(fam ?? undefined);
  if (!q.has('manual')) {
    let t = 0;
    h.onUpdate((dt) => {
      t += dt;
      if (t > 4.5) { t = 0; vfx.clear(); ids = gallery(fam ?? undefined); }
    });
  }
  void ids;
} else {
  h.setCam([3.4, 2.0, 5.0], [0, 1.0, 0], 50);
}

Object.assign(window as unknown as Record<string, unknown>, {
  __vfx: vfx,
  __fx: (id: string, opts?: VfxOpts) => { const st = STAGE[id]; if (st?.cam && !q.has('keepcam')) h.setCam(st.cam[0], st.cam[1], 50); fx(id, opts); },
  __gallery: (family?: string) => gallery(family),
  __beams: beams, __tracers: tracers, __telegraphs: telegraphs, __trail: trail,
  __swing: (t: number) => { swingT = t; poseArm(t); },
  __ambient: ambient, __decals: decals, __scan: scan,
  __clear: () => { vfx.clear(); clearLabels(); arm.visible = false; swingT = -1; },
  __stats: stats,
});

h.ready();
