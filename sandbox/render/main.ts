/**
 * Render-core sandbox — the showcase scene rendered through the real RenderSystem (own renderer, own composer).
 *
 * URL:  ?look=<LookName>  &q=low|medium|high|ultra (default high)  &nopost=1  &tm=aces|agx|agxPunchy|neutral
 *       &refl=0 (do not register reflective floors)  &strength=<n>  &env=sky (skip the scene probe)  &manual=1
 * Console / tools/shot.cjs --eval:
 *   __h.setCam([x,y,z],[lx,ly,lz],fov?)   __step(seconds)   __look('frozen', 2)   __pulse('hit', 1)
 *   __corrupt(0.5)   __dof(8, 0.8) / __dof(null)   __tm('agx')   __quality('medium')   __stats()   __r (the system)
 */
import * as THREE from 'three';
import type { Game, LookName, QualityLevel, ScreenPulse } from '@/core/api';
import { createRenderSystem, LOOKS } from '@/render';
import type { RenderSystemImpl } from '@/render/system';
import type { ToneMapOperator } from '@/render/effects/grade';
import { createCanvasOnly, miniGame, withStubs } from '../harness';
import { buildShowcase } from './scene';

const h = createCanvasOnly();
const q = h.params;
const levels: QualityLevel[] = ['low', 'medium', 'high', 'ultra'];
const quality = (levels.includes(q.get('q') as QualityLevel) ? q.get('q') : 'high') as QualityLevel;
const lookName = (q.get('look') && q.get('look')! in LOOKS ? q.get('look') : 'core') as LookName;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 4000);
const target = new THREE.Vector3(0, 2.2, -22);
camera.position.set(0.6, 1.7, 10.5);
camera.lookAt(target);

const game = miniGame(null, {
  canvas: h.canvas,
  scene,
  flags: {
    zone: null, beat: null, checkpoint: null, debug: true, autoplay: false, mute: true,
    nopost: q.has('nopost'), quality, manual: q.has('manual'), seed: 7283,
  },
  camera: withStubs<Game['camera']>('camera', { camera }),
});
const render = createRenderSystem(game) as RenderSystemImpl;
(game as { render: Game['render'] }).render = render;

const showcase = buildShowcase(scene, render, { reflect: q.get('refl') !== '0', strength: Number(q.get('strength') ?? 1) || 1 });
render.setLook(LOOKS[lookName]);
if (q.get('tm')) render.setToneMapOperator(q.get('tm') as ToneMapOperator);
const probe = { x: 0, y: 1.7, z: -4 };
render.refreshEnvironment(q.get('env') === 'sky' ? {} : { scene: true, position: probe });

let pending = 0;
h.onUpdate((dt, t) => {
  pending += dt;
  showcase.update(dt, t);
});
h.setRender(() => {
  render.render(pending > 0 ? pending : 1 / 60);
  pending = 0;
});
addEventListener('resize', () => render.resize());

const w = window as unknown as Record<string, unknown>;
w.__r = render;
w.__h = {
  setCam(pos: [number, number, number], look: [number, number, number], fov?: number): void {
    camera.position.set(pos[0], pos[1], pos[2]);
    target.set(look[0], look[1], look[2]);
    camera.lookAt(target);
    if (fov) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  },
};
w.__look = (name: LookName, seconds = 0) => render.setLook(LOOKS[name] ?? LOOKS.neutral, seconds);
w.__pulse = (kind: ScreenPulse, strength = 1) => render.pulse(kind, strength);
w.__corrupt = (amount: number) => render.setCorruption(amount);
w.__dof = (focusDistance: number | null, strength = 0.8) => render.setDof(focusDistance === null ? null : { focusDistance, strength });
w.__tm = (op: ToneMapOperator) => render.setToneMapOperator(op);
w.__quality = (level: QualityLevel) => render.setQuality(level);
w.__stats = () => ({ ...render.stats, level: render.quality.level });
w.__env = (sceneProbe: boolean) => render.refreshEnvironment(sceneProbe ? { scene: true, position: probe } : {});
w.__refl = (on: boolean) => {
  if (on) {
    render.registerReflectiveFloor(showcase.floor);
    render.registerReflectiveFloor(showcase.upper);
  } else {
    render.clearReflectiveFloors();
  }
};

render.init().then(() => h.ready());
