/**
 * Generated-character sandbox — the GLB bodies driven by the procedural animator, through the REAL render system
 * (post chain, looks, bloom), so emissive masks and state effects are judged as the game shows them.
 *
 *   ?who=<archetype>&action=<a>&t=<seconds>&speed=<m/s>&yaw=<deg>&seed=<n>
 *   &look=<LookName> (default relay; try core / breach for dark)   &q=low|medium|high   &nopost=1
 *   &proc=1 also spawns the procedural figure beside it            &manual=1 for tools/shot.cjs
 *
 * Globals (tools/shot.cjs --eval):
 *   __spawn(who, x, z, yawDeg, opts)  __clear()  __play(a, opts, i)  __loco(speed, yawDeg, flags, i)  __travel(on, i)
 *   __loadout(opts, i)  __state(name, value, color, i)  __turn(deg, i)  __look(name)  __cam([x,y,z],[lx,ly,lz],fov)
 *   __lineup(list?, spacing)      every (or the listed) archetype side by side
 *   __sheet(who, action, times|n, spacing, yawDeg, opts)   one figure per time through an action
 *   __gait(who, speed, n, spacing, yawDeg, flags)          one figure per phase of a walk / run cycle
 *   __poses(who, [actions], spacing, yawDeg, hold)         one figure per held pose
 *   __ramp(who, state, [amounts], spacing, yawDeg)         one figure per amount of a state effect
 *   __pair(who, action, t)        generated body and its procedural driver side by side
 *   __slide(who, speed, seconds)  measured planted-foot drift of the generated skeleton (metres)
 *   __info(i)                     what was measured from the mesh        __stats()
 */
import * as THREE from 'three';
import type { Archetype, CharacterVisual, Game, HumanoidArchetype, HumanoidVisual, LookName, QualityLevel } from '@/core/api';
import { createRenderSystem, LOOKS } from '@/render';
import { createCharacterFactory } from '@/chars';
import { createHumanoid } from '@/chars/humanoid';
import { GLB_ARCHETYPES, GlbHumanoidVisual } from '@/chars/glb';
import { createCanvasOnly, miniGame, withStubs } from '../harness';

const h = createCanvasOnly();
const q = h.params;
const levels: QualityLevel[] = ['low', 'medium', 'high', 'ultra'];
const quality = (levels.includes(q.get('q') as QualityLevel) ? q.get('q') : 'medium') as QualityLevel;
const lookName = (q.get('look') && (q.get('look') as string) in LOOKS ? q.get('look') : 'relay') as LookName;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.1, 400);
const target = new THREE.Vector3(0, 1, 0);
camera.position.set(1.6, 1.5, -5.2);
camera.lookAt(target);

const game = miniGame(null, {
  canvas: h.canvas,
  scene,
  flags: { zone: null, beat: null, checkpoint: null, debug: true, autoplay: false, mute: true, nopost: q.has('nopost'), quality, manual: q.has('manual'), seed: 7283 },
  camera: withStubs<Game['camera']>('camera', { camera }),
});
const render = createRenderSystem(game);
(game as { render: Game['render'] }).render = render;
const chars = createCharacterFactory(game);

// ---- stage: polished dark floor, warm key from the camera side, cold rim from behind -------------------------
const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshStandardMaterial({ color: 0x23262c, roughness: 0.42, metalness: 0.15 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);
const key = new THREE.DirectionalLight(0xfff0dc, 2.6);
key.position.set(4.5, 8, -6.5);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = -9; key.shadow.camera.right = 9; key.shadow.camera.top = 6; key.shadow.camera.bottom = -6;
key.shadow.bias = -0.0006; key.shadow.normalBias = 0.02;
scene.add(key, key.target);
const rim = new THREE.DirectionalLight(0xb8d0ff, 1.5);
rim.position.set(-5, 5, 7);
scene.add(rim);
const fill = new THREE.DirectionalLight(0xdfe6ff, 0.5);
fill.position.set(-4, 3, -5);
scene.add(fill);

interface Entry { fig: CharacterVisual; speed: number; yaw: number; travel: boolean }
const figs: Entry[] = [];

function spawn(who: string, x = 0, z = 0, yawDeg = 0, opts: Record<string, unknown> = {}, procedural = false): CharacterVisual {
  const fig = procedural ? createHumanoid(game, who as HumanoidArchetype, opts) : chars.create(who as Archetype, opts);
  fig.root.position.set(x, 0, z);
  fig.root.rotation.y = (yawDeg * Math.PI) / 180;
  scene.add(fig.root);
  figs.push({ fig, speed: 0, yaw: 0, travel: false });
  return fig;
}
function clear(): void { for (const e of figs) e.fig.dispose(); figs.length = 0; }
function advance(e: Entry, dt: number): void {
  if (e.travel && e.speed > 0) {
    const a = e.fig.root.rotation.y + e.yaw;
    e.fig.root.position.x += -Math.sin(a) * e.speed * dt;
    e.fig.root.position.z += -Math.cos(a) * e.speed * dt;
  }
  e.fig.update(dt);
}
function settle(e: Entry, seconds: number): void { for (let k = 0, n = Math.round(seconds * 60); k < n; k++) advance(e, 1 / 60); }
function frame(count: number, spacing: number, height = 1.9): void {
  const width = Math.max(1, count - 1) * spacing + 1.6;
  const dist = Math.max(4.2, (width / 2 / Math.tan((camera.fov * Math.PI) / 360) / camera.aspect) * 1.02, (height * 0.62) / Math.tan((camera.fov * Math.PI) / 360));
  camera.position.set(0.25 * dist, height * 0.62, -dist);
  target.set(0, height * 0.5, 0);
  camera.lookAt(target);
}

let booted = false;
/** draw the current state without advancing it (manual mode: nothing else renders between __step calls) */
function redraw(): void { if (booted) render.render(1 / 60); }

const W = window as unknown as Record<string, unknown>;
W.__r = render;
W.__redraw = redraw;
W.__figs = figs;
W.__h = {
  setCam(pos: [number, number, number], look: [number, number, number], fov?: number): void {
    camera.position.set(pos[0], pos[1], pos[2]);
    target.set(look[0], look[1], look[2]);
    camera.lookAt(target);
    if (fov) { camera.fov = fov; camera.updateProjectionMatrix(); }
    redraw();
  },
};
W.__cam = (W.__h as { setCam: unknown }).setCam;
W.__look = (name: LookName, seconds = 0) => { render.setLook(LOOKS[name] ?? LOOKS.neutral, seconds); render.refreshEnvironment({ position: { x: 0, y: 1.5, z: 0 } }); redraw(); redraw(); };
W.__spawn = (who: string, x = 0, z = 0, yawDeg = 0, opts: Record<string, unknown> = {}, procedural = false) => { spawn(who, x, z, yawDeg, opts, procedural); return figs.length - 1; };
W.__clear = clear;
W.__play = (a: string, opts?: Record<string, unknown>, i = 0) => figs[i]?.fig.play(a, opts);
W.__stop = (a?: string, i = 0) => figs[i]?.fig.stop(a);
W.__loco = (speed: number, yawDeg = 0, flags?: Record<string, boolean>, i = 0) => {
  const e = figs[i]; if (!e) return;
  e.speed = speed; e.yaw = (yawDeg * Math.PI) / 180;
  e.fig.setLocomotion(speed, e.yaw, flags);
};
W.__travel = (on: boolean, i = 0) => { if (figs[i]) figs[i].travel = on; };
W.__turn = (deg: number, i = 0) => { if (figs[i]) figs[i].fig.root.rotation.y = (deg * Math.PI) / 180; };
W.__loadout = (opts: Record<string, unknown>, i = 0) => figs[i]?.fig.setLoadout(opts as Parameters<CharacterVisual['setLoadout']>[0]);
W.__state = (name: string, value: number, color?: number, i = 0) => {
  const f = figs[i]?.fig; if (!f) return;
  if (name === 'frozen') f.setFrozen(value);
  else if (name === 'corruption') f.setCorruption(value);
  else if (name === 'dissolve') f.setDissolve(value, color);
  else if (name === 'glow') f.setGlow(value);
  else if (name === 'telegraph') f.setTelegraph(value, color);
  else if (name === 'rim') f.setRim(value, color);
  else if (name === 'flash') f.flash(color ?? 0xffffff, value);
  else if (name === 'exposed') f.setExposed('chest', value);
  else if (name === 'visible') f.setVisible(value > 0.5);
};
W.__run = (seconds: number, i = -1) => { for (const [k, e] of figs.entries()) if (i < 0 || i === k) settle(e, seconds); redraw(); };

W.__lineup = (list?: string[], spacing = 1.25, yawDeg = 0) => {
  clear();
  const names = list ?? Object.keys(GLB_ARCHETYPES);
  names.forEach((n, i) => { spawn(n, ((names.length - 1) / 2 - i) * spacing, 0, yawDeg, { seed: i }); settle(figs[i], 0.5); });
  frame(names.length, spacing, 2.1);
  redraw();
};
W.__sheet = (who: string, action: string, times: number | number[] = 5, spacing = 1.7, yawDeg = 0, opts: Record<string, unknown> = {}, loadout?: Record<string, unknown>) => {
  clear();
  const probe = spawn(who, 0, 0, 0);
  const dur = probe.info(action).duration || 1;
  clear();
  const ts = Array.isArray(times) ? times : Array.from({ length: times }, (_, i) => ((i + 0.5) / times) * dur);
  ts.forEach((t, i) => {
    const f = spawn(who, ((ts.length - 1) / 2 - i) * spacing, 0, yawDeg);
    if (loadout) f.setLoadout(loadout as Parameters<CharacterVisual['setLoadout']>[0]);
    settle(figs[i], 0.6);
    f.play(action, opts);
    settle(figs[i], t);
  });
  frame(ts.length, spacing);
  redraw();
  return { duration: dur, times: ts, hitTimes: figs[0].fig.info(action).hitTimes };
};
W.__gait = (who: string, speed: number, n = 4, spacing = 1.6, yawDeg = 90, flags?: Record<string, boolean>) => {
  clear();
  for (let i = 0; i < n; i++) {
    const f = spawn(who, ((n - 1) / 2 - i) * spacing, 0, yawDeg);
    const e = figs[i];
    e.speed = speed; e.travel = false;
    f.setLocomotion(speed, 0, flags);
    // a full second to reach the gait, then a different fraction of a stride each
    settle(e, 1.2 + (i / n) * (speed > 4 ? 0.62 : 0.95));
  }
  frame(n, spacing);
  redraw();
};
W.__poses = (who: string, actions: string[], spacing = 1.6, yawDeg = 0, hold = 1.6, loadout?: Record<string, unknown>) => {
  clear();
  actions.forEach((a, i) => {
    const f = spawn(who, ((actions.length - 1) / 2 - i) * spacing, 0, yawDeg);
    if (loadout) f.setLoadout(loadout as Parameters<CharacterVisual['setLoadout']>[0]);
    settle(figs[i], 0.4);
    if (a !== 'idle') f.play(a);
    settle(figs[i], hold);
  });
  frame(actions.length, spacing);
  redraw();
};
W.__ramp = (who: string, state: string, amounts: number[], spacing = 1.4, yawDeg = 0, color?: number) => {
  clear();
  amounts.forEach((a, i) => {
    spawn(who, ((amounts.length - 1) / 2 - i) * spacing, 0, yawDeg, { seed: i });
    settle(figs[i], 0.5);
    (W.__state as (n: string, v: number, c: number | undefined, i: number) => void)(state, a, color, i);
    settle(figs[i], 1 / 60);
  });
  frame(amounts.length, spacing);
  redraw();
};
W.__pair = (who: string, action?: string, t = 0, yawDeg = 0, loadout?: Record<string, unknown>) => {
  clear();
  spawn(who, 0.8, 0, yawDeg);
  spawn(who, -0.8, 0, yawDeg, {}, true);
  for (const e of figs) {
    if (loadout) e.fig.setLoadout(loadout as Parameters<CharacterVisual['setLoadout']>[0]);
    settle(e, 0.6);
    if (action) { e.fig.play(action); settle(e, t); }
  }
  frame(2, 1.6);
  redraw();
};
/** planted-foot drift of the generated skeleton while really travelling: max and mean metres per stance */
W.__slide = (who: string, speed: number, seconds = 4) => {
  clear();
  const f = spawn(who, 0, 0, 0) as HumanoidVisual;
  const e = figs[0];
  e.speed = speed; e.travel = true;
  f.setLocomotion(speed, 0, { sprint: speed > 6 });
  settle(e, 1.5);
  const feet = ['Foot'].flatMap((n) => ['Left' + n, 'Right' + n]).map((n) => f.root.getObjectByName(n)).filter((o): o is THREE.Object3D => !!o);
  if (feet.length < 2) return { error: 'no generated feet (procedural figure?)' };
  const p = new THREE.Vector3();
  const state = feet.map(() => ({ down: false, x: 0, z: 0, drift: 0, min: Infinity }));
  const drifts: number[] = [];
  let lowest = Infinity;
  for (let k = 0, n = Math.round(seconds * 60); k < n; k++) {
    advance(e, 1 / 60);
    feet.forEach((foot, i) => {
      foot.getWorldPosition(p);
      const s = state[i];
      s.min = Math.min(s.min, p.y);
      lowest = Math.min(lowest, p.y);
      const down = p.y < s.min + 0.012;
      if (down && !s.down) { s.x = p.x; s.z = p.z; s.drift = 0; }
      if (down) s.drift = Math.max(s.drift, Math.hypot(p.x - s.x, p.z - s.z));
      if (!down && s.down) drifts.push(s.drift);
      s.down = down;
    });
  }
  drifts.sort((a, b) => a - b);
  return { stances: drifts.length, max: +(drifts[drifts.length - 1] ?? 0).toFixed(4), median: +(drifts[Math.floor(drifts.length / 2)] ?? 0).toFixed(4), ankleMin: +lowest.toFixed(4) };
};
/** largest distance between the generated ankles and where the driver planted its own (metres), while travelling */
W.__footError = (who: string, speed: number, seconds = 3) => {
  clear();
  const f = spawn(who, 0, 0, 0) as HumanoidVisual;
  const e = figs[0];
  const pairs = [['LeftFoot', 'footL'], ['RightFoot', 'footR']].map(([a, b]) => [f.root.getObjectByName(a), f.root.getObjectByName(b)]);
  if (pairs.some(([a, b]) => !a || !b)) return { error: 'no generated feet (procedural figure?)' };
  const pa = new THREE.Vector3(), pb = new THREE.Vector3(), up = new THREE.Vector3(), qb = new THREE.Quaternion();
  // standing flat: the generated ankle is simply higher than the driver's by a constant
  settle(e, 0.4);
  (pairs[0][0] as THREE.Object3D).getWorldPosition(pa); (pairs[0][1] as THREE.Object3D).getWorldPosition(pb);
  const lift = pa.y - pb.y;
  e.speed = speed; e.travel = true;
  f.setLocomotion(speed, 0, { sprint: speed > 6 });
  let worst = 0, minY = Infinity;
  for (let k = 0, n = Math.round(seconds * 60); k < n; k++) {
    advance(e, 1 / 60);
    for (const [a, b] of pairs) {
      (a as THREE.Object3D).getWorldPosition(pa); (b as THREE.Object3D).getWorldPosition(pb);
      (b as THREE.Object3D).getWorldQuaternion(qb);
      // the ankle the retarget aims for: the driver's, raised along the foot's own up by the ankle difference
      pb.add(up.set(0, lift, 0).applyQuaternion(qb));
      worst = Math.max(worst, pa.distanceTo(pb));
      minY = Math.min(minY, pa.y);
    }
  }
  return { who, speed, ankleLift: +lift.toFixed(4), worst: +worst.toFixed(4), ankleMin: +minY.toFixed(4) };
};
W.__info = (i = 0) => {
  const f = figs[i]?.fig;
  if (!f) return null;
  const g = f instanceof GlbHumanoidVisual ? f : null;
  const sock = (n: string): number[] => f.socket(n).getWorldPosition(new THREE.Vector3()).toArray().map((v) => +v.toFixed(3));
  const r = g?.rigInfo ?? null;
  const v3 = (v: THREE.Vector3): number[] => v.toArray().map((x) => +x.toFixed(3));
  return {
    archetype: f.archetype, generated: !!g?.generated, height: f.height, radius: f.radius, triangles: (f as HumanoidVisual).triangles,
    sockets: Object.fromEntries(['hips', 'chest', 'head', 'eye', 'handR', 'handL', 'weaponBase', 'weaponTip', 'muzzle', 'back'].map((n) => [n, sock(n)])),
    rig: r && {
      spine: r.spine, metrics: r.metrics, groundY: +r.groundY.toFixed(3), height: +r.height.toFixed(3), restMatrix: r.restMatrix.elements.map((x) => +x.toFixed(5)),
      hands: (['L', 'R'] as const).map((k) => ({ ok: r.hands[k].ok, wrist: v3(r.hands[k].wrist), f: v3(r.hands[k].f), n: v3(r.hands[k].n), length: +r.hands[k].length.toFixed(3), grip: v3(r.hands[k].grip), fingers: r.hands[k].fingers })),
    },
  };
};
W.__stats = () => ({ ...render.stats, level: render.quality.level, figs: figs.map((e) => [e.fig.archetype, (e.fig as HumanoidVisual).triangles, e.fig instanceof GlbHumanoidVisual && e.fig.generated]) });

async function boot(): Promise<void> {
  render.setLook(LOOKS[lookName]);
  const who = q.get('who');
  const lineup = q.has('lineup');
  const wanted = (lineup || !who ? Object.keys(GLB_ARCHETYPES) : [who]) as Archetype[];
  await chars.preload(q.has('all') ? (Object.keys(GLB_ARCHETYPES) as Archetype[]) : wanted);
  if (who && !lineup) {
    const yaw = Number(q.get('yaw') ?? 0);
    const f = spawn(who, q.has('proc') ? 0.8 : 0, 0, yaw, { seed: Number(q.get('seed') ?? 0) });
    if (q.has('proc')) spawn(who, -0.8, 0, yaw, { seed: Number(q.get('seed') ?? 0) }, true);
    const speed = Number(q.get('speed') ?? 0);
    for (const e of figs) {
      if (speed > 0) { e.speed = speed; e.fig.setLocomotion(speed, 0); }
      settle(e, 0.6);
      const action = q.get('action');
      if (action) { e.fig.play(action); settle(e, Number(q.get('t') ?? 0)); }
    }
    frame(figs.length, 1.6, f.height);
  } else if (lineup) (W.__lineup as () => void)();
  render.refreshEnvironment({ position: { x: 0, y: 1.5, z: 0 } });

  let pending = 0;
  h.onUpdate((dt) => { pending += dt; for (const e of figs) advance(e, dt); });
  h.setRender(() => { render.render(pending > 0 ? pending : 1 / 60); pending = 0; });
  addEventListener('resize', () => render.resize());
  await render.init();
  booted = true;
  h.ready();
}
boot().catch((err) => { console.error('[sandbox] boot failed', err); ((window as unknown as { __aurelionErrors?: string[] }).__aurelionErrors ??= []).push(String(err)); h.ready(); });
