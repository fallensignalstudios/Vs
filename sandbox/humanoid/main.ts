/**
 * Humanoid sandbox.
 *   ?who=<archetype>&action=<a>&t=<seconds>&speed=<m/s>&yaw=<deg>&seed=<n>
 *   ?lineup=1                      every archetype in a row
 *   ?sheet=<action>&n=6&who=...    contact sheet: one figure posed at N times through an action
 *   ?env=dark                      dim stage for emissive / rim work;  ?travel=1 moves the figure for real
 * Globals for tools/shot.cjs: __fig (current figure), __figs, __play(a, opts), __loco(speed, yawDeg, flags),
 * __spawn(who, x, z, yawDeg, opts), __clear(), __sheet(who, action, n), __turn(deg), __stats().
 */
import * as THREE from 'three';
import { createHarness } from '../harness';
import { createHumanoid } from '@/chars/humanoid';
import { listActions, listArchetypes } from '@/chars/humanoid/debug';
import type { HumanoidArchetype, HumanoidVisual } from '@/core/api';

const q = new URLSearchParams(location.search);
const dark = q.get('env') === 'dark';
const h = createHarness({ bloom: true, env: dark ? 'dark' : 'studio', ground: false, background: dark ? 0x050608 : 0x20252e, exposure: 1 });
h.camera.fov = 35; h.camera.updateProjectionMatrix();

// stage: figures face +Z by default (yaw 180) toward the harness key light; a cool rim comes from behind
const floor = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), new THREE.MeshStandardMaterial({ color: dark ? 0x0b0c10 : 0x2b2f36, roughness: dark ? 0.25 : 0.55, metalness: 0.1 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
h.scene.add(floor);
h.scene.environmentIntensity = dark ? 0.22 : 0.5;
const rim = new THREE.DirectionalLight(0xbcd4ff, dark ? 1.6 : 1.2);
rim.position.set(-5, 6, -8);
h.scene.add(rim);

interface Entry { fig: HumanoidVisual; speed: number; yaw: number; travel: boolean }
const figs: Entry[] = [];

function spawn(who: string, x = 0, z = 0, yawDeg = 0, opts: { seed?: number; variant?: number; corruption?: number } = {}): HumanoidVisual {
  const fig = createHumanoid(null, who as HumanoidArchetype, opts);
  fig.root.position.set(x, 0, z);
  fig.root.rotation.y = (yawDeg * Math.PI) / 180;
  h.scene.add(fig.root);
  figs.push({ fig, speed: 0, yaw: 0, travel: false });
  return fig;
}
function clear(): void { for (const e of figs) e.fig.dispose(); figs.length = 0; }

/** over-shoulder game camera (dist 3.4, height 1.55, shoulder 0.55, FOV 62) following figure `follow` */
let follow = -1;
function placeGameCam(): void {
  const e = figs[follow];
  if (!e) return;
  const p = e.fig.root.position, a = e.fig.root.rotation.y;
  const fx = -Math.sin(a), fz = -Math.cos(a), rx = Math.cos(a), rz = -Math.sin(a);
  h.setCam([p.x + rx * 0.55 - fx * 3.4, 1.55, p.z + rz * 0.55 - fz * 3.4], [p.x + rx * 0.55 + fx * 6, 1.25, p.z + rz * 0.55 + fz * 6], 62);
}

h.onUpdate((dt) => {
  for (const e of figs) {
    if (e.travel && e.speed > 0) {
      const a = e.fig.root.rotation.y + e.yaw;
      e.fig.root.position.x += -Math.sin(a) * e.speed * dt;
      e.fig.root.position.z += -Math.cos(a) * e.speed * dt;
    }
    e.fig.update(dt);
  }
  if (follow >= 0) placeGameCam();
});

const W = window as unknown as Record<string, unknown>;
W.__figs = figs;
W.__spawn = spawn;
W.__clear = clear;
W.__play = (a: string, opts?: Record<string, unknown>, i = 0) => figs[i]?.fig.play(a, opts);
W.__loco = (speed: number, yawDeg = 0, flags?: Record<string, boolean>, i = 0) => {
  const e = figs[i]; if (!e) return;
  e.speed = speed; e.yaw = (yawDeg * Math.PI) / 180;
  e.fig.setLocomotion(speed, e.yaw, flags);
};
W.__travel = (on: boolean, i = 0) => { if (figs[i]) figs[i].travel = on; };
W.__gamecam = (i = 0) => { follow = i; placeGameCam(); };
W.__turn = (deg: number, i = 0) => { if (figs[i]) figs[i].fig.root.rotation.y = (deg * Math.PI) / 180; };
W.__actions = (who: string) => listActions(who as HumanoidArchetype);
W.__stats = () => ({ calls: h.renderer.info.render.calls, tris: h.renderer.info.render.triangles, figs: figs.map((e) => [e.fig.archetype, e.fig.triangles]) });
/** contact sheet: n copies posed at evenly spaced times through an action */
W.__sheet = (who: string, action: string, n = 6, spacing = 1.5, yawDeg = 0, opts: Record<string, unknown> = {}) => {
  clear();
  const times: number[] = [];
  for (let i = 0; i < n; i++) {
    const fig = spawn(who, (i - (n - 1) / 2) * spacing, 0, yawDeg, opts);
    const info = fig.play(action);
    const dur = Number.isFinite(info.duration) && info.duration > 0 ? info.duration : 1;
    const t = (dur * (i + 0.5)) / n;
    times.push(+t.toFixed(3));
    for (let k = 0, steps = Math.round(t * 120); k < steps; k++) fig.update(1 / 120);
    fig.setFrozen(0);
    figs[figs.length - 1].fig.play('frozen');
  }
  h.render();
  return times;
};
/** pose board: one figure per action, each advanced `t` seconds (or to the action's end) */
W.__poses = (who: string, actions: string[], t = -1, spacing = 1.5, yawDeg = 150, loadout?: Record<string, unknown>) => {
  clear();
  actions.forEach((a, i) => {
    const f = spawn(who, (i - (actions.length - 1) / 2) * spacing, 0, yawDeg);
    if (loadout) f.setLoadout(loadout);
    const info = f.play(a);
    const dur = t >= 0 ? t : Number.isFinite(info.duration) && !info.loop ? info.duration + 0.4 : 1.6;
    for (let k = 0, n = Math.round(dur * 60); k < n; k++) f.update(1 / 60);
  });
  h.render();
};
W.__state = (name: string, amount: number, color?: number, i = 0) => {
  const f = figs[i]?.fig; if (!f) return;
  if (name === 'frozen') f.setFrozen(amount);
  else if (name === 'corruption') f.setCorruption(amount);
  else if (name === 'dissolve') f.setDissolve(amount, color);
  else if (name === 'rim') f.setRim(amount, color);
  else if (name === 'telegraph') f.setTelegraph(amount, color);
  else if (name === 'glow') f.setGlow(amount);
  else if (name === 'flash') f.flash(color ?? 0xffffff, amount);
  else if (name === 'exposed') f.setExposed('chest', amount);
};
W.__loadout = (lo: Record<string, unknown>, i = 0) => figs[i]?.fig.setLoadout(lo);
/** turnaround: front, three-quarter, side, back */
W.__turnaround = (who: string, opts: Record<string, unknown> = {}, spacing = 1.7) => {
  clear();
  [180, 135, 90, 0].forEach((yaw, i) => { const f = spawn(who, (i - 1.5) * spacing, 0, yaw, opts); for (let k = 0; k < 40; k++) f.update(1 / 60); });
  h.setCam([0, 1.15, 7.4], [0, 0.98, 0], 35);
  h.render();
};
/** run-cycle sheet: n copies at evenly spaced stride phases */
W.__gait = (who: string, speed: number, n = 4, spacing = 1.5, yawDeg = 90, moveYawDeg = 0, flags?: Record<string, boolean>) => {
  clear();
  for (let i = 0; i < n; i++) {
    const fig = spawn(who, (i - (n - 1) / 2) * spacing, 0, yawDeg);
    fig.setLocomotion(speed, (moveYawDeg * Math.PI) / 180, flags);
    const T = 1.2 + (i / n) * 0.7;
    for (let k = 0, steps = Math.round(T * 120); k < steps; k++) fig.update(1 / 120);
    fig.play('frozen');
  }
  h.render();
};

const who = q.get('who') ?? 'tarrik';
if (q.has('lineup')) {
  const all = listArchetypes();
  all.forEach((a, i) => spawn(a, (i - (all.length - 1) / 2) * 1.25, 0, 180));
  h.setCam([0, 1.5, 13], [0, 1.0, 0], 35);
} else if (q.has('sheet')) {
  (W.__sheet as (w: string, a: string, n: number) => void)(who, q.get('sheet') ?? 'attackLight1', Number(q.get('n') ?? 6));
  h.setCam([0, 1.3, 9], [0, 1.0, 0], 35);
} else {
  const fig = spawn(who, 0, 0, Number(q.get('yaw') ?? 180), { seed: Number(q.get('seed') ?? 0) });
  W.__fig = fig;
  const speed = Number(q.get('speed') ?? 0);
  if (speed > 0) { figs[0].speed = speed; figs[0].travel = q.has('travel'); fig.setLocomotion(speed, 0); }
  const action = q.get('action');
  if (action) fig.play(action);
  const t = Number(q.get('t') ?? 0);
  if (t > 0) for (let k = 0, steps = Math.round(t * 120); k < steps; k++) fig.update(1 / 120);
  h.setCam([0, 1.25, 4.6], [0, 0.98, 0], 35);
}
h.ready();
