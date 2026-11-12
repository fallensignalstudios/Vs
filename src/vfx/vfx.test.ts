import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Game, VfxId } from '@/core/api';
import { VFX_NOTES } from '@/core/api';
import { nullObject } from '@/core/stub';
import { buildAtlasPixels, SPRITES } from './atlas';
import type { ShapeDef } from './defs';
import { EffectRuntime } from './effects';
import type { FxServices } from './effects';
import { GroundMarks, TELEGRAPH_HOLD } from './ground';
import { createVfxSystem } from './index';
import { EFFECT_LIBRARY } from './library';
import { FlashLights, MAX_FLASHES } from './lights';
import { LAYER_CAP, ParticleCore } from './particles';

/** every id in the VfxId union (api/vfx.ts) */
const ALL_IDS: VfxId[] = [
  'sparkHit', 'sparkHeavy', 'metalChip', 'stoneChip', 'dustPuff', 'footDust',
  'cinderBurst', 'cinderSlam', 'cinderEmbers', 'cinderStickyArm', 'cinderStickyBlast',
  'frostBurst', 'frostShatter', 'frostArrest', 'stasisField', 'dispatchStreak',
  'violetBurst', 'violetWisp', 'linkSever', 'eclipseDissolve', 'eclipseSpawn', 'pressurePulse',
  'muzzleWarm', 'muzzleCold', 'droneCharge', 'droneBoltHit', 'shieldHit', 'shieldBreak', 'deflect',
  'explosionSmall', 'explosionLarge', 'deviceBreak', 'debrisFall', 'cageDestroy',
  'healPickup', 'healBurst', 'echoGain', 'checkpointPulse', 'interactPing',
  'thermalFracture', 'resonanceRing', 'quarantineSeal', 'goldRecognition',
  'assentTarrik', 'assentSelene', 'meridianComplete', 'boundaryClose', 'grammarPropagate',
  'carrierShadowDust', 'coherentPlane', 'witnessMote',
];

const DT = 1 / 60;

function fakeAtlas(): THREE.Texture {
  return new THREE.DataTexture(new Uint8Array(4), 1, 1);
}

interface Recorder { flashes: number; shocks: number; decals: string[]; shapes: ShapeDef[]; released: number }

function makeRuntime(scale = 1): { rt: EffectRuntime; core: ParticleCore; rec: Recorder } {
  const core = new ParticleCore(fakeAtlas());
  const rec: Recorder = { flashes: 0, shocks: 0, decals: [], shapes: [], released: 0 };
  const services: FxServices = {
    particles: core,
    particleScale: () => scale,
    floorAt: () => 0,
    flash: () => { rec.flashes++; },
    shock: () => { rec.shocks++; },
    decal: (kind) => { rec.decals.push(kind); },
    shape: (def) => {
      rec.shapes.push(def);
      let alive = true;
      return { get alive() { return alive; }, release() { alive = false; rec.released++; }, setPosition() {} };
    },
  };
  const rt = new EffectRuntime(services);
  for (const id of Object.keys(EFFECT_LIBRARY)) rt.register(id, EFFECT_LIBRARY[id]);
  return { rt, core, rec };
}

function run(rt: EffectRuntime, core: ParticleCore, seconds: number, each?: () => void): void {
  for (let t = 0; t < seconds; t += DT) {
    rt.update(DT);
    core.update(DT);
    each?.();
  }
}

afterEach(() => vi.restoreAllMocks());

describe('sprite atlas', () => {
  it('fills every cell and keeps cell borders transparent (no mip bleed)', () => {
    const { data, width, height } = buildAtlasPixels();
    const cell = width / 8;
    expect(height).toBe(cell * 4);
    for (let s = 0; s < SPRITES.length; s++) {
      const cx = (s % 8) * cell, cy = Math.floor(s / 8) * cell;
      let sum = 0, edge = 0;
      for (let y = 0; y < cell; y++) {
        for (let x = 0; x < cell; x++) {
          const a = data[((cy + y) * width + cx + x) * 4 + 3];
          sum += a;
          if (x === 0 || y === 0 || x === cell - 1 || y === cell - 1) edge += a;
        }
      }
      expect(sum, `sprite ${SPRITES[s]} is empty`).toBeGreaterThan(2000);
      expect(edge, `sprite ${SPRITES[s]} touches its cell border`).toBe(0);
    }
  });
});

describe('particle core', () => {
  it('expires particles, keeps slot counters exact and never exceeds the layer cap', () => {
    const core = new ParticleCore(fakeAtlas());
    const p = core.register({ layer: 'add', sprite: 'dot', life: 0.5, size: 0.1, color: [[0xffffff, 1]] });
    const slot = core.allocSlot(0, 0, 0, 0);
    for (let i = 0; i < LAYER_CAP.add + 500; i++) core.spawn(p, slot, 0, 1, 0, 1, 0, 0, 1);
    expect(core.liveIn('add')).toBe(LAYER_CAP.add);
    expect(core.slotLive[slot]).toBe(LAYER_CAP.add);
    for (let t = 0; t < 0.4; t += DT) core.update(DT);
    expect(core.liveCount).toBe(LAYER_CAP.add);
    for (let t = 0; t < 0.2; t += DT) core.update(DT);
    expect(core.liveCount).toBe(0);
    expect(core.slotLive[slot]).toBe(0);
  });

  it('swap-remove keeps the survivors intact', () => {
    const core = new ParticleCore(fakeAtlas());
    const short = core.register({ layer: 'alpha', sprite: 'dot', life: 0.1, size: 0.1, color: [[0xffffff, 1]] });
    const long = core.register({ layer: 'alpha', sprite: 'dot', life: 5, size: 0.1, color: [[0xffffff, 1]], gravity: 0 });
    const a = core.allocSlot(0, 0, 0, null), b = core.allocSlot(0, 0, 0, null);
    for (let i = 0; i < 50; i++) {
      core.spawn(short, a, 0, 0, 0, 0, 0, 0, 1);
      core.spawn(long, b, i, 0, 0, 0, 0, 0, 1);
    }
    for (let t = 0; t < 0.3; t += DT) core.update(DT);
    expect(core.slotLive[a]).toBe(0);
    expect(core.slotLive[b]).toBe(50);
    expect(core.liveIn('alpha')).toBe(50);
  });

  it('integrates gravity and bounces on the slot floor', () => {
    const core = new ParticleCore(fakeAtlas());
    const p = core.register({ layer: 'alpha', sprite: 'chip0', life: 3, size: 0.1, color: [[0xffffff, 1]], gravity: 9.8, bounce: 0.4 });
    const slot = core.allocSlot(0, 2, 0, 0);
    core.spawn(p, slot, 0, 2, 0, 0, 0, 0, 1);
    let minY = Infinity;
    // read the instance buffer position back through the mesh attribute
    const mesh = core.group.children.find((m) => m.name === 'vfx-particles-alpha') as THREE.Mesh;
    const attr = mesh.geometry.getAttribute('iPosSize') as THREE.InterleavedBufferAttribute;
    for (let t = 0; t < 2.5; t += DT) {
      core.update(DT);
      minY = Math.min(minY, attr.getY(0));
    }
    expect(minY).toBeGreaterThanOrEqual(0);
    expect(minY).toBeLessThan(0.1);
    expect(attr.getY(0)).toBeLessThan(0.3); // came to rest near the floor
  });

  it('writes finite instance data', () => {
    const { rt, core } = makeRuntime();
    rt.spawn('thermalFracture', { x: 0, y: 1.5, z: 0 });
    run(rt, core, 1.2);
    for (const m of core.group.children) {
      const mesh = m as THREE.Mesh;
      const geo = mesh.geometry as THREE.InstancedBufferGeometry;
      const arr = (geo.getAttribute('iPosSize') as THREE.InterleavedBufferAttribute).data.array as Float32Array;
      for (let i = 0; i < geo.instanceCount * 16; i++) expect(Number.isFinite(arr[i])).toBe(true);
    }
  });
});

describe('effect library', () => {
  it('registers every VfxId and documents only real ids', () => {
    for (const id of ALL_IDS) expect(EFFECT_LIBRARY[id], `missing effect "${id}"`).toBeDefined();
    for (const id of Object.keys(VFX_NOTES)) expect(EFFECT_LIBRARY[id], `VFX_NOTES documents unknown id "${id}"`).toBeDefined();
  });

  it('unknown ids warn once and return an inert handle', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { rt } = makeRuntime();
    const h1 = rt.spawn('noSuchEffect', { x: 0, y: 0, z: 0 });
    const h2 = rt.spawn('noSuchEffect', { x: 0, y: 0, z: 0 });
    expect(h1.alive).toBe(false);
    expect(() => { h1.stop(); h1.setPosition({ x: 1, y: 2, z: 3 }); h2.stop(); }).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('rejects non-finite positions without throwing', () => {
    const { rt } = makeRuntime();
    expect(rt.spawn('sparkHit', { x: NaN, y: 0, z: 0 }).alive).toBe(false);
    expect(rt.spawn('sparkHit', null as unknown as { x: number; y: number; z: number }).alive).toBe(false);
  });

  it('every effect emits something visible, stays inside the particle budget and ends', () => {
    for (const id of ALL_IDS) {
      const { rt, core, rec } = makeRuntime();
      const h = rt.spawn(id, { x: 0, y: 1, z: 0 }, { duration: 1.5 });
      expect(h.alive, id).toBe(true);
      let peak = 0;
      run(rt, core, 1.4, () => { peak = Math.max(peak, core.liveCount); });
      expect(peak + rec.shapes.length + rec.shocks + rec.decals.length, `${id} produced nothing`).toBeGreaterThan(0);
      expect(peak, `${id} peaks at ${peak} particles`).toBeLessThan(700);
      h.stop();
      run(rt, core, 6.5);
      expect(h.alive, `${id} never finished`).toBe(false);
      expect(core.liveCount, id).toBe(0);
      expect(rt.liveCount, id).toBe(0);
    }
  });

  it('one-shots finish on their own; sustained effects honour opts.duration', () => {
    const { rt, core } = makeRuntime();
    const hit = rt.spawn('sparkHit', { x: 0, y: 1, z: 0 });
    const field = rt.spawn('stasisField', { x: 0, y: 0, z: 0 }, { duration: 0.5 });
    run(rt, core, 0.45);
    expect(field.alive).toBe(true);
    run(rt, core, 3.5);
    expect(hit.alive).toBe(false);
    expect(field.alive).toBe(false);
  });

  it('stages thermalFracture: frost arrest first, cinder strike later', () => {
    const { rt, core, rec } = makeRuntime();
    rt.spawn('thermalFracture', { x: 0, y: 1.6, z: 0 });
    run(rt, core, 0.6);
    expect(rec.shapes.map((s) => s.kind)).toEqual(['halo', 'sphere']);
    expect(rec.decals).toEqual([]);
    run(rt, core, 0.6);
    expect(rec.decals).toEqual(expect.arrayContaining(['crack', 'scorch', 'frost']));
    expect(rec.shocks).toBe(3);
  });

  it('scales particle counts with the quality multiplier', () => {
    const count = (scale: number): number => {
      const { rt, core } = makeRuntime(scale);
      rt.spawn('sparkHeavy', { x: 0, y: 1, z: 0 });
      return core.liveCount;
    };
    expect(count(0.5)).toBeLessThan(count(1) * 0.7);
  });

  it('cinderStickyArm pulses faster toward the end of its fuse', () => {
    const { rt, core, rec } = makeRuntime();
    rt.spawn('cinderStickyArm', { x: 0, y: 1, z: 0 }, { duration: 2 });
    run(rt, core, 1);
    const firstHalf = rec.flashes;
    run(rt, core, 0.98);
    expect(rec.flashes - firstHalf).toBeGreaterThan(firstHalf * 1.5);
  });
});

describe('telegraphs', () => {
  it('fills linearly and completes exactly at the announced time', () => {
    const g = new GroundMarks();
    const t = g.telegraph({ kind: 'circle', pos: { x: 0, y: 0, z: 0 }, r: 2 }, 1.2, 0xff5a2a);
    for (let i = 0; i < 36; i++) g.update(DT); // 0.6 s
    expect(t.fill).toBeCloseTo(0.5, 5);
    for (let i = 0; i < 35; i++) g.update(DT);
    expect(t.fill).toBeLessThan(1);
    g.update(DT); // 1.2 s
    expect(t.fill).toBe(1);
    expect(t.alive).toBe(true);
    for (let t2 = 0; t2 < TELEGRAPH_HOLD + 2 * DT; t2 += DT) g.update(DT);
    expect(t.alive).toBe(false);
    expect(g.counts.telegraphs).toBe(0);
  });

  it('stop() cancels a telegraph early', () => {
    const g = new GroundMarks();
    const t = g.telegraph({ kind: 'cone', pos: { x: 0, y: 0, z: 0 }, yaw: 0.5, arc: 1.2, r: 3 }, 5, 0xffffff);
    g.update(DT);
    t.stop();
    for (let i = 0; i < 20; i++) g.update(DT);
    expect(t.alive).toBe(false);
  });

  it('orients line and cone marks along the engine conventions', () => {
    const g = new GroundMarks();
    const line = g.telegraph({ kind: 'line', from: { x: 0, y: 0, z: 0 }, to: { x: 4, y: 0, z: 0 }, width: 1 }, 1, 0xffffff) as unknown as { m: THREE.Matrix4 };
    // the fill axis (local +Z) must point from → to (+X)
    const z = new THREE.Vector3(0, 0, 1).transformDirection(line.m);
    expect(z.x).toBeCloseTo(1, 5);
    const cone = g.telegraph({ kind: 'cone', pos: { x: 0, y: 0, z: 0 }, yaw: 0, arc: 1, r: 2 }, 1, 0xffffff) as unknown as { m: THREE.Matrix4 };
    // yaw 0 faces -Z
    const f = new THREE.Vector3(0, 0, 1).transformDirection(cone.m);
    expect(f.z).toBeCloseTo(-1, 5);
  });
});

describe('flash lights', () => {
  it('never lights more than four and honours reduceFlash', () => {
    const pos = new Float32Array(16), col = new Float32Array(12);
    const lights = new FlashLights(pos, col);
    for (let i = 0; i < 9; i++) lights.flash(i, 1, 0, 0xffffff, 1 + i, 0.3, false);
    expect(lights.liveCount).toBe(MAX_FLASHES);
    const peak = Math.max(...lights.group.children.map((l) => (l as THREE.PointLight).intensity));
    lights.clear();
    lights.flash(0, 1, 0, 0xffffff, 9, 0.3, true);
    lights.update(0.15 * 1.6);
    const reduced = Math.max(...lights.group.children.map((l) => (l as THREE.PointLight).intensity));
    expect(reduced).toBeGreaterThan(0);
    expect(reduced).toBeLessThan(peak * 0.5);
    for (let t = 0; t < 1; t += DT) lights.update(DT);
    expect(lights.liveCount).toBe(0);
  });
});

describe('vfx system on a stub game', () => {
  const makeGame = (): Game => {
    const game = nullObject<Game>('game') as unknown as Record<string, unknown>;
    return new Proxy(game, {
      get(t, p) { return p === 'scene' ? scene : (t as Record<string | symbol, unknown>)[p]; },
    }) as unknown as Game;
  };
  const scene = new THREE.Scene();

  it('constructs, updates and clears with every other subsystem stubbed', () => {
    const vfx = createVfxSystem(makeGame());
    expect(scene.getObjectByName('vfx')).toBeDefined();
    for (const id of ALL_IDS) expect(vfx.has(id)).toBe(true);
    vfx.spawn('cinderSlam', { x: 0, y: 0, z: 0 });
    vfx.beam({ x: 0, y: 1, z: 0 }, new THREE.Object3D(), 'link');
    vfx.tracer({ x: 0, y: 1, z: 0 }, { x: 5, y: 1, z: 0 }, 'cold');
    vfx.telegraph({ kind: 'circle', pos: { x: 0, y: 0, z: 0 }, r: 2 }, 1);
    vfx.decal('scorch', { x: 0, y: 0, z: 0 });
    vfx.shockwave({ x: 0, y: 0, z: 0 }, 3, 0xffffff);
    vfx.flash({ x: 0, y: 1, z: 0 }, 0xffffff, 2);
    vfx.ambient('embers', { x: 0, y: 2, z: 0 }, { x: 10, y: 4, z: 10 });
    const plane = vfx.scanPlane();
    plane.setPose({ x: 0, y: 1, z: 0 }, 0.3, 4, 2);
    plane.setAlert(1);
    const trail = vfx.trail(new THREE.Object3D(), new THREE.Object3D());
    trail.setActive(true);
    for (let i = 0; i < 30; i++) vfx.update(DT);
    const s = vfx.stats;
    expect(s.particles).toBeGreaterThan(50);
    expect(s.beams).toBe(1);
    expect(s.telegraphs).toBe(1);
    expect(s.decals).toBeGreaterThanOrEqual(1);
    expect(s.ambients).toBe(1);
    vfx.clear();
    vfx.update(DT);
    const c = vfx.stats;
    expect(c.particles + c.effects + c.beams + c.tracers + c.decals + c.telegraphs + c.shapes + c.flashes + c.ambients).toBe(0);
  });

  it('never throws on bad input', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const vfx = createVfxSystem(makeGame());
    const bad = undefined as unknown as { x: number; y: number; z: number };
    expect(() => {
      vfx.spawn('nope', bad);
      vfx.spawn('sparkHit', { x: 0, y: 0, z: 0 }, { dir: { x: 0, y: 0, z: 0 }, scale: -3, color: NaN, duration: -1 });
      vfx.beam(bad, bad, 'link');
      vfx.beam({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 'plasma' as never).remove(0);
      vfx.tracer(bad, bad, 'warm');
      vfx.tracer({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 'laser' as never);
      vfx.trail(bad as never, bad as never).setActive(true);
      vfx.ambient('fog' as never, { x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }).stop();
      vfx.decal('blood' as never, { x: 0, y: 0, z: 0 });
      vfx.decal('scorch', bad);
      vfx.shockwave(bad, 1, 0);
      vfx.shockwave({ x: 0, y: 0, z: 0 }, -1, 0);
      vfx.flash(bad, 0, 1);
      vfx.telegraph({ kind: 'star' } as never, 1).stop();
      vfx.telegraph({ kind: 'circle', pos: { x: 0, y: 0, z: 0 }, r: 1 }, NaN);
      vfx.update(NaN);
      vfx.update(-1);
      vfx.update(10);
      vfx.clear();
    }).not.toThrow();
    expect(warn).toHaveBeenCalled();
  });
});

describe('(fix & ship) soft round motes', () => {
  it('packs a particle near-fade distance for the vertex shader (0 when unset)', async () => {
    const core = new ParticleCore(fakeAtlas());
    const faded = core.register({ layer: 'add', sprite: 'dot', life: 2, size: 0.03, color: [[0xffffff, 1]], nearFade: 2.6 });
    const plain = core.register({ layer: 'add', sprite: 'dot', life: 2, size: 0.03, color: [[0xffffff, 1]] });
    const slot = core.allocSlot(0, 0, 0, null);
    core.spawn(faded, slot, 0, 1, 0, 0, 0, 0, 1);
    core.spawn(plain, slot, 0, 1, 0, 0, 0, 0, 1);
    core.update(DT);
    const mesh = core.group.children.find((m) => m.name === 'vfx-particles-add') as THREE.Mesh;
    const vel = mesh.geometry.getAttribute('iVel') as THREE.InterleavedBufferAttribute;
    const ys = [vel.getY(0), vel.getY(1)].sort();
    expect(ys[0]).toBe(0);
    expect(ys[1]).toBeCloseTo(2.6, 5);
    const { PARTICLE_VERT } = await import('./shaders');
    expect(PARTICLE_VERT).toMatch(/nearA = smoothstep\(iVel\.y \* 0\.35, iVel\.y, viewDepth\)/);
  });

  it('witnessMote draws soft round motes only, fading near the lens', () => {
    const def = EFFECT_LIBRARY.witnessMote;
    const motes = def.emitters?.[0]?.p;
    expect(motes?.sprite).toBe('dot');
    expect(motes?.nearFade).toBeGreaterThan(1.5);
    for (const e of def.emitters ?? []) expect([e.p.sprite].flat()).not.toContain('diamond');
  });

  it('goldMotes are soft round dots, smaller and sparser, gone close to the camera', async () => {
    const { AmbientVolumes } = await import('./ambient');
    const { spriteIndex } = await import('./atlas');
    const amb = new AmbientVolumes(fakeAtlas());
    const h = amb.create('goldMotes', { x: 0, y: 0, z: 0 }, { x: 18, y: 10, z: 18 }, 1, 1) as unknown as { uniforms: Record<string, THREE.IUniform>; mesh: THREE.Mesh };
    expect(h.uniforms.uFrame.value).toBe(spriteIndex('dot'));
    expect((h.uniforms.uLook.value as THREE.Vector3).x).toBeLessThanOrEqual(0.05);
    expect((h.uniforms.uNear.value as THREE.Vector2).y).toBeGreaterThan(3);
    expect((h.mesh.geometry as THREE.InstancedBufferGeometry).instanceCount).toBeLessThanOrEqual(320);
    amb.clear();
  });
});
