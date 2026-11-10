import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { CamPose, Routine, ZoneRuntime } from '@/core/api';
import { createTestWorld, idle, spawnAtStart, zoneOf } from '@/mission/testkit';
import { PLAN_CUT_HEIGHT, createDebugApi } from './index';

/** a test world with a recording free camera, a renderer that takes clipping planes and a UI with a clean frame */
function debugWorld() {
  const poses: Array<CamPose | null> = [];
  let mode: 'follow' | 'free' = 'follow';
  const camera = {
    get mode() { return mode; },
    camera: { position: new THREE.Vector3() },
    setFree(p: CamPose | null) { poses.push(p); mode = p ? 'free' : 'follow'; },
    snapBehind() {},
  };
  const renderer = { clippingPlanes: [] as THREE.Plane[] };
  const render = { renderer, stats: { fps: 60, drawCalls: 0, triangles: 0 } };
  const zones = ['Z00', 'Z01'].map((id) => zoneOf(id, [{ id: 'a', enter: spawnAtStart, *run(z: ZoneRuntime): Routine { z.setFlag(`${id}seen`, true); yield* idle(); } }]));
  const w = createTestWorld({ zones, overrides: { camera, render } });
  const clean: boolean[] = [];
  (w.game.ui as unknown as { setCleanFrame(on: boolean): void }).setCleanFrame = (on: boolean) => { clean.push(on); };
  const api = createDebugApi(w.game);
  return { w, api, poses, renderer, clean, mode: () => mode };
}

describe('debug harness (polish 3)', () => {
  it('hud(false) is a clean frame: the HUD and the notices go; hud(true) brings both back', () => {
    const { w, api, clean } = debugWorld();
    api.hud(false);
    expect(w.ui.hud).toBe(false);
    expect(clean).toEqual([true]);
    api.hud(true);
    expect(w.ui.hud).toBe(true);
    expect(clean).toEqual([true, false]);
  });

  it('planView cuts everything above a section plane over the lead’s floor; cam() removes the cut', async () => {
    const { w, api, renderer, poses } = debugWorld();
    await api.goto('Z00');
    w.player.actor!.pos.y = 4;
    api.planView();
    expect(renderer.clippingPlanes).toHaveLength(1);
    const plane = renderer.clippingPlanes[0]!;
    expect(plane.constant).toBeCloseTo(4 + PLAN_CUT_HEIGHT, 6);
    // kept: below the cut; clipped (negative distance): above it
    expect(plane.distanceToPoint(new THREE.Vector3(0, 4.5, 0))).toBeGreaterThan(0);
    expect(plane.distanceToPoint(new THREE.Vector3(0, 9, 0))).toBeLessThan(0);
    expect(poses.at(-1)!.pos.y).toBeGreaterThan(4 + PLAN_CUT_HEIGHT);
    api.planView(30, { cut: 1.5 });
    expect(renderer.clippingPlanes).toHaveLength(1);
    expect(renderer.clippingPlanes[0]!.constant).toBeCloseTo(5.5, 6);
    api.planView(30, { cut: false });
    expect(renderer.clippingPlanes).toHaveLength(0);
    api.planView();
    api.cam(null);
    expect(renderer.clippingPlanes).toHaveLength(0);
  });

  it('goto drops a free camera / plan view and starts from a fresh state unless asked to keep it', async () => {
    const { w, api, renderer, mode } = debugWorld();
    await api.goto('Z00');
    w.tick(0.2);
    expect(w.mission.state.flags.Z00seen).toBe(true);
    api.cam({ pos: { x: 0, y: 30, z: 0 }, look: { x: 0, y: 0, z: -1 } });
    api.planView();
    expect(mode()).toBe('free');
    await api.goto('Z01');
    w.tick(0.2);
    expect(mode()).toBe('follow');
    expect(renderer.clippingPlanes).toHaveLength(0);
    expect(w.mission.state.flags).toEqual({ Z01seen: true });
    await api.goto('Z00', undefined, { keepState: true });
    w.tick(0.2);
    expect(w.mission.state.flags).toEqual({ Z01seen: true, Z00seen: true });
    await api.goto('Z01', undefined, { flags: { z03Detected: true }, rescuePriority: 'EastWalkers' });
    w.tick(0.2);
    expect(w.mission.state.flags).toEqual({ z03Detected: true, Z01seen: true });
    expect(w.mission.state.rescuePriority).toBe('EastWalkers');
  });

  it('the snapshot lists optional interactions with required: false', async () => {
    const { w, api } = debugWorld();
    const z = zoneOf('Z02', [{
      id: 'a',
      enter: spawnAtStart,
      *run(rt: ZoneRuntime): Routine {
        rt.interact({ id: 'panel', at: rt.P(2, 0), prompt: 'Use', required: true });
        rt.interact({ id: 'record', at: rt.P(-2, 0), prompt: 'Read' });
        yield* idle();
      },
    }]);
    w.mission.registerZone(z);
    await api.goto('Z02');
    w.tick(0.1);
    expect(api.snapshot().interactables!.map((i) => `${i.id}:${String(i.required)}`)).toEqual(['panel:true', 'record:false']);
  });
});

describe('plan view fog', () => {
  it('takes the scene fog away for the plan and gives it back on cam()', async () => {
    const { w, api } = debugWorld();
    const fog = new THREE.FogExp2(0x334455, 0.03);
    w.game.scene.fog = fog;
    await api.goto('Z00');
    api.planView();
    expect(w.game.scene.fog).toBeNull();
    api.planView(); // a second plan view keeps the original fog in hand
    api.cam(null);
    expect(w.game.scene.fog).toBe(fog);
    api.planView(undefined, { fog: true });
    expect(w.game.scene.fog).toBe(fog);
  });
});
