/**
 * Sky + scenic sandbox.
 *   /sandbox/sky/?preset=woundVista&scenic=terminalVista,crownmarkArm&manual=1
 * Params: preset, scenic (comma list: terminalVista|atriumShell|crownmarkArm|megaRibs|dominionShuttle|
 *         reformationTransport|dominionCapital|reformationCapital|wreckDominion|wreckReformation),
 *         heading (deg), battle (0..1), activity (0..1), closed (1), carrier (progress 0..1), stab (0..1),
 *         ref=0 (hide the 1.8 m reference figure), deck=0 (hide the foreground slab), exposure.
 * Eval helpers: __sky, __look(azDeg, elDeg, fov?, [x,y,z]?), __preset(id, blendSeconds?), __scenic(list), __stats().
 */
import * as THREE from 'three';
import type { SkyPreset } from '@/core/api';
import { createSkySystem } from '@/render/sky';
import { createHarness, miniGame } from '../harness';

const h = createHarness({ bloom: true, env: 'dark', background: 0x000000, lights: false });
const p = h.params;
h.renderer.toneMappingExposure = Number(p.get('exposure') ?? 1);
const game = miniGame(h);
const sky = createSkySystem(game);
if (!sky.root.parent) h.scene.add(sky.root);

// Zone-ish lighting for near-field (PBR) scenic pieces: follows the sky's suggested key / fill.
const key = new THREE.DirectionalLight(0xffffff, 1);
const fill = new THREE.DirectionalLight(0xffffff, 0);
const hemi = new THREE.HemisphereLight(0x8a94b8, 0x15120f, 0.35);
h.scene.add(key, key.target, fill, fill.target, hemi);
function syncLights(): void {
  key.position.copy(sky.keyLight.dir).multiplyScalar(80);
  key.color.setHex(sky.keyLight.color);
  key.intensity = sky.keyLight.intensity;
  fill.position.copy(sky.fillLight.dir).multiplyScalar(80);
  fill.color.setHex(sky.fillLight.color);
  fill.intensity = sky.fillLight.intensity;
}

// Foreground: the lip of an overlook floor with a low parapet, and a 1.8 m human-scale reference figure.
const foreground = new THREE.Group();
const stone = new THREE.MeshStandardMaterial({ color: 0x0b0c10, roughness: 1, metalness: 0 });
const slab = new THREE.Mesh(new THREE.BoxGeometry(18, 0.6, 9), stone);
slab.position.set(0, -0.3, -0.5);
const rail = new THREE.Mesh(new THREE.BoxGeometry(18, 0.9, 0.3), stone);
rail.position.set(0, 0.45, -4.85);
const strip = new THREE.Mesh(new THREE.BoxGeometry(18, 0.02, 0.04), new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffc56b, emissiveIntensity: 1.6 }));
strip.position.set(0, 0.01, -4.4);
if (p.get('deck') !== '0') foreground.add(slab, rail, strip);
const ref = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.8, 0.3), new THREE.MeshStandardMaterial({ color: 0xb8442e, roughness: 0.8 }));
ref.position.set(2.4, 0.9, -3.9);
if (p.get('ref') !== '0') foreground.add(ref);
h.scene.add(foreground);

// Near-field (PBR) pieces are shown on open ground instead of behind the overlook parapet.
const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), new THREE.MeshStandardMaterial({ color: 0x2a2c31, roughness: 0.9, metalness: 0 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
ground.visible = false;
const viewFill = new THREE.DirectionalLight(0xdfe6ff, 0);
viewFill.position.set(-14, 16, 24);
h.scene.add(ground, viewFill);
const NEAR = ['dominionShuttle', 'reformationTransport', 'wreckDominion', 'wreckReformation'];

let scenicRoot = new THREE.Group();
h.scene.add(scenicRoot);

function buildScenic(list: string): void {
  h.scene.remove(scenicRoot);
  scenicRoot.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); });
  scenicRoot = new THREE.Group();
  scenicRoot.rotation.y = sky.heading;
  h.scene.add(scenicRoot);
  const near = NEAR.some((n) => list.includes(n));
  ground.visible = near;
  viewFill.intensity = near ? 1.4 : 0;
  slab.visible = rail.visible = strip.visible = !near;
  ref.position.set(near ? 7.5 : 2.4, 0.9, near ? -17 : -3.9);
  for (const name of list.split(',').map((s) => s.trim()).filter(Boolean)) {
    const f = sky.scenic;
    if (!f) continue;
    let o: THREE.Object3D | null = null;
    if (name === 'terminalVista') o = f.terminalVista({ corridor: list.includes('crownmarkArm') ? 640 : 0 });
    else if (name === 'atriumShell') o = f.atriumShell();
    else if (name === 'crownmarkArm') o = f.crownmarkArm();
    else if (name === 'megaRibs') o = f.megaRibs();
    else if (name === 'dominionShuttle' || name === 'reformationTransport') { o = f.ship(name); o.position.set(-3, 0, -30); o.rotation.y = -0.95; }
    else if (name === 'dominionCapital' || name === 'reformationCapital') { o = f.ship(name); o.position.set(0, 260, -1400); o.rotation.y = 1.1; }
    else if (name === 'wreckDominion' || name === 'wreckReformation') { o = f.wreck(name === 'wreckDominion' ? 'dominion' : 'reformation'); o.position.set(-1, 0, -19); o.rotation.y = 0.75; }
    else console.warn(`[sandbox] unknown scenic "${name}"`);
    if (o) scenicRoot.add(o);
  }
}

function look(az: number, el: number, fov?: number, from: [number, number, number] = [0, 1.7, 0]): void {
  const a = (az * Math.PI) / 180 + 0, e = (el * Math.PI) / 180;
  const d = new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e));
  h.setCam(from, [from[0] + d.x, from[1] + d.y, from[2] + d.z], fov);
}

sky.setHeading(((Number(p.get('heading') ?? 0)) * Math.PI) / 180);
sky.setPreset((p.get('preset') ?? 'woundVista') as SkyPreset);
if (p.has('battle')) sky.setBattleIntensity(Number(p.get('battle')));
if (p.has('activity')) sky.setWoundActivity(Number(p.get('activity')));
if (p.get('closed') === '1') sky.setBoundaryClosed(true, 0);
if (p.has('carrier') && sky.carrier) {
  sky.carrier.visible = true;
  sky.carrier.setProgress(Number(p.get('carrier')));
  sky.carrier.setStabilized(Number(p.get('stab') ?? 0));
}
buildScenic(p.get('scenic') ?? '');
syncLights();
h.camera.far = 6000;
h.camera.near = 0.1;
h.camera.fov = 62;
h.camera.updateProjectionMatrix();
look(0, 6);

h.onUpdate((dt) => { sky.update(dt, h.camera); });

Object.assign(window, {
  __sky: sky,
  __look: look,
  /** look from eye height (or `from`) at a world point */
  __lookAt: (to: [number, number, number], fov?: number, from: [number, number, number] = [0, 1.7, 0]) => h.setCam(from, to, fov),
  /** show the carrier at a progress / stabilisation and aim the camera at it */
  __carrier: (progress: number, stab = 0, fov = 62, track = true) => {
    sky.carrier.visible = true;
    sky.carrier.setStabilized(stab);
    sky.carrier.setProgress(progress);
    const c = sky.carrier.position;
    if (track) h.setCam([0, 1.7, 0], [c.x, c.y, c.z], fov);
    return { pos: c.toArray().map((v) => Math.round(v)), shadow: sky.carrier.shadow };
  },
  __preset: (id: SkyPreset, blend = 0) => { sky.setPreset(id, { blendSeconds: blend }); syncLights(); },
  __scenic: (list: string) => buildScenic(list),
  /** draw calls / triangles of one direct scene render (no post passes) */
  __stats: () => {
    const i = h.renderer.info;
    i.autoReset = false;
    i.reset();
    h.renderer.render(h.scene, h.camera);
    const out = { calls: i.render.calls, triangles: i.render.triangles };
    i.autoReset = true;
    return out;
  },
});
h.step(2);
h.ready();
