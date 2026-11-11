import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { Game, ZoneBuilder } from '@/core/api';
import { ScriptRunnerImpl } from '@/core/script';
import { nullObject } from '@/core/stub';
import { createMaterialLibrary } from '@/world/materials';
import { createPhysicsWorld } from '@/world/physics';
import { Geo } from './geo';
import { solidArcs } from './structure';
import { createZoneBuilder, PROP_KINDS } from './index';
import { LIGHT_BUDGET } from './lights';

interface Fake { game: Game; scripts: ScriptRunnerImpl; time: { now: number; dt: number }; audio: string[] }

function fakeGame(stubAll = false): Fake {
  const scripts = new ScriptRunnerImpl();
  const time = { now: 0, dt: 0, unscaledDt: 0, scale: 1, frame: 0, hitStop() {}, slowMo() {} };
  const audio: string[] = [];
  const game = {
    physics: stubAll ? nullObject('physics') : createPhysicsWorld(null),
    mats: stubAll ? nullObject('mats') : createMaterialLibrary(null),
    scripts: stubAll ? nullObject('scripts') : scripts,
    time,
    flags: { debug: false },
    render: nullObject('render'),
    sky: nullObject('sky'),
    audio: stubAll ? nullObject('audio') : { play: (id: string) => { audio.push(id); }, setAmbience() {}, setMusic() {} },
  } as unknown as Game;
  return { game, scripts, time, audio };
}

function builder(f: Fake = fakeGame()): { b: ZoneBuilder; root: THREE.Group; f: Fake } {
  const root = new THREE.Group();
  return { b: createZoneBuilder(f.game, root, 42), root, f };
}

function tick(f: Fake, seconds: number): void {
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    f.time.dt = 1 / 60; f.time.now += 1 / 60;
    f.scripts.update(1 / 60);
  }
}

function walk(b: ZoneBuilder, from: THREE.Vector3, to: THREE.Vector3): { x: number; y: number; z: number } {
  let p = { x: from.x, y: from.y, z: from.z };
  for (let i = 0; i < 4000; i++) {
    const dx = to.x - p.x, dz = to.z - p.z, d = Math.hypot(dx, dz);
    if (d < 0.05) break;
    const s = Math.min(0.1, d);
    p = b.physics.moveCharacter(p, 0.4, (dx / d) * s, (dz / d) * s);
  }
  return p;
}

describe('Geo', () => {
  it('emits unit normals that point away from the solid', () => {
    const g = new Geo();
    g.cbox(2, 1, 1, 0.1).tbox(1, 1, 1, 0.1, 5, 0, 0).vbox(1, 2, 1, 0.1, 10, 0, 0).cyl(0.5, 0.3, 2, 12, 15, 0, 0).ball(0.5, 10, 20, 1, 0);
    const centres = [[0, 0, 0], [5, 0.5, 0], [10, 1, 0], [15, 1, 0], [20, 1, 0]];
    for (let i = 0; i < g.pos.length; i += 9) {
      const cx = (g.pos[i] + g.pos[i + 3] + g.pos[i + 6]) / 3, cy = (g.pos[i + 1] + g.pos[i + 4] + g.pos[i + 7]) / 3, cz = (g.pos[i + 2] + g.pos[i + 5] + g.pos[i + 8]) / 3;
      const c = centres[Math.round(cx / 5)];
      const n = [g.nor[i], g.nor[i + 1], g.nor[i + 2]];
      expect(Math.hypot(n[0], n[1], n[2])).toBeCloseTo(1, 4);
      // geometric winding agrees with the stored normal, and both face outward
      const ux = g.pos[i + 3] - g.pos[i], uy = g.pos[i + 4] - g.pos[i + 1], uz = g.pos[i + 5] - g.pos[i + 2];
      const vx = g.pos[i + 6] - g.pos[i], vy = g.pos[i + 7] - g.pos[i + 1], vz = g.pos[i + 8] - g.pos[i + 2];
      const gx = uy * vz - uz * vy, gy = uz * vx - ux * vz, gz = ux * vy - uy * vx;
      expect(gx * n[0] + gy * n[1] + gz * n[2]).toBeGreaterThan(0);
      expect(gx * (cx - c[0]) + gy * (cy - c[1]) + gz * (cz - c[2])).toBeGreaterThan(-1e-6);
    }
  });

  it('extrudes concave outlines and keeps prisms closed', () => {
    const g = new Geo().prismY([[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]], 0, 1, true, true);
    // L-shape: 6 sides × 2 + (4 + 4) cap triangles
    expect(g.vertexCount / 3).toBe(20);
    const geo = g.toGeometry();
    expect(geo.boundingBox!.max.y).toBeCloseTo(1);
  });

  it('solidArcs returns the complement of the gaps', () => {
    expect(solidArcs([])).toEqual([[0, 360]]);
    expect(solidArcs([[350, 10]])).toEqual([[370, 710]]);
    expect(solidArcs([[80, 100], [260, 280]])).toEqual([[100, 260], [280, 440]]);
  });
});

describe('ZoneBuilder physics', () => {
  it('maps plan coordinates and yaw', () => {
    const { b } = builder();
    expect(b.P(3, 5, 2).toArray()).toEqual([3, 2, -5]);
    expect(b.yaw(90)).toBeCloseTo(-Math.PI / 2);
    const m = b.marker('a', 1, 2, 0, 180);
    expect(b.getMarker('a')).toBe(m);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(b.getMarker('missing').pos.toArray()).toEqual([0, 0, 0]);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('floor + ramp + deck: a walker climbs the ramp onto the balcony and cannot leave through a rail', () => {
    const { b } = builder();
    b.floor({ x: 20, n: 15, w: 40, d: 30 });
    b.ramp({ x: 30, n: 11, w: 4, d: 12, h0: 0, h1: 3, rails: true });
    b.deck({ x: 30, n: 22, w: 12, d: 10, h: 3, rails: ['n', 'e', 'w', 's'], railGaps: [{ side: 's', at: 6, width: 4 }] });
    b.finalize();
    const top = walk(b, b.P(30, 3, 0), b.P(30, 22, 3));
    expect(top.y).toBeCloseTo(3, 1);
    expect(-top.z).toBeGreaterThan(21);
    // rails hold on every side
    const east = walk(b, b.P(30, 22, 3), b.P(40, 22, 3));
    expect(east.x).toBeLessThan(36);
    expect(east.y).toBeCloseTo(3, 1);
    // nobody walks through the ramp body from the side, and the deck is a real ceiling for sight
    const side = walk(b, b.P(22, 14, 0), b.P(30, 14, 0));
    expect(side.x).toBeLessThan(28.1);
    expect(b.physics.lineOfSight({ x: 30, y: 1.6, z: -22 }, { x: 30, y: 4.6, z: -22 })).toBe(false);
    // nav finds the way up
    const path = b.physics.nav.findPath({ x: 12, y: 0, z: -5 }, { x: 30, y: 3, z: -24 });
    expect(path).not.toBeNull();
    expect(b.physics.validate().filter((i) => i.kind !== 'narrow')).toEqual([]);
  });

  it('walls leave door openings; doors block, open over 0.8 s and refresh nav', () => {
    const f = fakeGame();
    const { b } = builder(f);
    b.floor({ x: 10, n: 10, w: 20, d: 20 });
    b.wall({ from: [0, 10], to: [20, 10], height: 6, doors: [{ at: 10, width: 3, height: 3.5 }], style: 'ribbed' });
    const door = b.door({ x: 10, n: 10 });
    b.finalize();
    const from = b.P(10, 4, 0), to = b.P(10, 16, 0);
    expect(-walk(b, from, to).z).toBeLessThan(10);
    expect(b.physics.nav.findPath(from, to)).toBeNull();
    expect(-walk(b, b.P(4, 4, 0), b.P(4, 16, 0)).z).toBeLessThan(10);
    door.setOpen(true);
    expect(door.isOpen).toBe(true);
    expect(f.audio).toEqual(['doorOpen']);
    expect(door.collider!.enabled).toBe(true); // still blocking while the leaves start to move
    tick(f, 0.9);
    expect(door.collider!.enabled).toBe(false);
    expect(-walk(b, from, to).z).toBeGreaterThan(15.9);
    expect(b.physics.nav.findPath(from, to)).not.toBeNull();
    door.setOpen(false);
    expect(door.collider!.enabled).toBe(true);
    expect(f.audio).toEqual(['doorOpen', 'doorClose']);
    door.setState('sealed');
    door.setState('nonsense' as 'locked');
  });

  it('barriers block movement but not sight, and drop', () => {
    const f = fakeGame();
    const { b } = builder(f);
    b.floor({ x: 10, n: 10, w: 20, d: 20 });
    b.wall({ from: [0, 10], to: [8, 10] });
    b.wall({ from: [12, 10], to: [20, 10] });
    const bar = b.barrier({ from: [8, 10], to: [12, 10] });
    b.finalize();
    const from = b.P(10, 6, 0), to = b.P(10, 14, 0);
    expect(-walk(b, from, to).z).toBeLessThan(10);
    expect(b.physics.lineOfSight({ x: 10, y: 1.6, z: -6 }, { x: 10, y: 1.6, z: -14 })).toBe(true);
    bar.setActive(false);
    tick(f, 0.7);
    expect(bar.active).toBe(false);
    expect(-walk(b, from, to).z).toBeGreaterThan(13.9);
    expect(f.audio).toEqual(['barrierDown']);
  });

  it('cover and props register tagged colliders; rails and glass let sight through', () => {
    const { b } = builder();
    b.floor({ x: 0, n: 0, w: 40, d: 40 });
    b.coverLow({ x: 0, n: 5, style: 'reformation' });
    b.coverHigh({ x: 6, n: 5, style: 'dominion' });
    b.prop('domCrate', { x: -6, n: 5, variant: 0 });
    b.rail({ from: [-10, -5], to: [10, -5] });
    b.wall({ from: [-10, -10], to: [10, -10], style: 'glass', height: 5 });
    const near = b.physics.coverNear(0, -5, 12);
    expect(near.map((c) => c.desc.cover).sort()).toEqual(['high', 'low', 'low']);
    expect(near.find((c) => c.desc.cover === 'high')!.desc.shape).toMatchObject({ hy: 1.1 });
    expect(b.physics.lineOfSight({ x: 0, y: 1.6, z: 3 }, { x: 0, y: 1.6, z: 14 })).toBe(true);
    expect(b.physics.lineOfFire({ x: 0, y: 1.6, z: 8 }, { x: 0, y: 1.6, z: 14 })).toBe(false);
    expect(-walk(b, b.P(0, 0, 0), b.P(0, -8, 0)).z).toBeGreaterThan(-5);
  });

  it('disc rims and ring walls leave their gaps open', () => {
    const { b } = builder();
    b.disc({ x: 0, n: 0, r: 12, rim: { gapsDeg: [[-15, 15]] } });
    b.floor({ x: 0, n: 16, w: 5, d: 9 });
    b.ringWall({ x: 0, n: 0, r: 8, height: 5, gapsDeg: [[170, 190]], style: 'ribbed' });
    b.finalize();
    // out through the south gap of the ring wall, round to the north gap of the rim
    expect(b.physics.nav.findPath(b.P(0, 0, 0), b.P(0, 18, 0))).not.toBeNull();
    expect(walk(b, b.P(10, 0, 0), b.P(16, 0, 0)).x).toBeLessThan(12);
    expect(walk(b, b.P(0, 0, 0), b.P(0, 7.9, 0)).z).toBeGreaterThan(-7.8);
  });
});

describe('ZoneBuilder content', () => {
  it('every prop kind builds, sits on the floor and unknown kinds fall back with one warning', () => {
    const { b, root } = builder();
    PROP_KINDS.forEach((kind, i) => {
      const obj = b.keep(b.prop(kind, { x: (i % 8) * 6, n: Math.floor(i / 8) * 6, variant: 0 }));
      const box = new THREE.Box3().setFromObject(obj);
      expect(box.isEmpty(), kind).toBe(false);
      expect(box.min.y, `${kind} sinks`).toBeGreaterThan(-0.35);
      expect(box.min.y, `${kind} floats`).toBeLessThan(0.12);
    });
    expect(PROP_KINDS.length).toBeGreaterThanOrEqual(37);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    b.prop('doesNotExist', { x: 0, n: -9 });
    b.prop('doesNotExist', { x: 3, n: -9 });
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
    expect(root.children.length).toBeGreaterThan(PROP_KINDS.length);
  });

  it('survives bad input and a fully stubbed game', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const f of [fakeGame(), fakeGame(true)]) {
      const { b, root } = builder(f);
      const bad = Number.NaN;
      expect(() => {
        b.setEnv({ sky: 'void', look: {} });
        b.floor({ x: bad, n: bad, w: bad, d: -4, inlay: 'bogus' as 'none' });
        b.disc({ x: 0, n: 0, r: bad, inlay: 'crownmark', rim: {} });
        b.ramp({ x: 0, n: 0, w: 0, d: 0, h0: 2, h1: 2 });
        b.deck({ x: 0, n: 0, w: 4, d: 4, rails: ['q' as 'n'] });
        b.bridge({ from: [0, 0], to: [0, 0], broken: 'mid' });
        b.wall({ from: [0, 0], to: [0, 0] });
        b.walls([], {});
        b.walls([[0, 0], [5, 0], [5, 5]], { closed: true, style: 'weird' as 'plain', doors: [{ at: 2, width: 99, height: 99 }] });
        b.ringWall({ x: 0, n: 0, r: 5, gapsDeg: [[0, 360]] });
        b.ceiling({ x: 0, n: 0, w: 10, d: 10, style: 'nope' as 'flat' });
        b.rib({ x: 0, n: 0, span: bad, height: bad, style: 'broken' });
        b.ribRow({ x: 0, n: 0, span: 10, height: 8, count: bad, spacing: bad });
        b.column({ x: 0, n: 0, style: 'x' as 'round' });
        b.coverLow({ x: 0, n: 0, style: 'x' as 'debris' });
        b.door({ x: 0, n: 0, style: 'x' as 'ancient' }).setOpen(true, { instant: true });
        b.barrier({ from: [0, 0], to: [0, 0] }).setActive(false, { instant: true });
        b.channel([[0, 0]]);
        b.conduit([[0, 0, 0], [0, 0, 0]]);
        b.whitePoint({ x: 0, n: 0, h: bad });
        b.frost({ x: 0, n: 0, w: bad, d: bad });
        b.corruption({ x: 0, n: 0, r: bad, onWall: true });
        b.point({ x: 0, n: 0, h: 2, flicker: 0.3 });
        b.spot({ x: 0, n: 0, h: 5, target: [0, 0, 5], shadow: true, shaft: true });
        b.spot({ x: 0, n: 0, h: 5, shadow: true });
        b.spot({ x: 0, n: 0, h: 5, shadow: true });
        b.panelLight({ x: 0, n: 0, w: 2, d: 1, h: 3, facing: 'east' });
        b.add(null as unknown as THREE.Object3D);
        b.onUpdate(() => { throw new Error('boom'); });
        b.finalize();
        b.update(0.016, 1);
        b.update(0.016, 2);
        b.dispose();
        b.dispose();
      }).not.toThrow();
      expect(root.children.length).toBe(0);
    }
    warn.mockRestore();
  });

  it('finalize merges a dressed 56 × 26 hall into well under 150 draw calls and respects the shadow budget', () => {
    const { b, root } = builder();
    b.setEnv({ sky: 'crashRib', look: {}, key: { dirFrom: [10, -6, 30], shadow: true } });
    b.floor({ x: 13, n: 28, w: 26, d: 56, inlay: 'channels', reflective: true });
    b.walls([[0, 0], [26, 0], [26, 56], [0, 56]], { closed: true, style: 'ribbed', doors: [{ at: 13, width: 3, height: 3.5 }] });
    b.ribRow({ x: 13, n: 6, span: 24, height: 14, count: 7, spacing: 7 });
    b.ceiling({ x: 13, n: 28, w: 26, d: 56, h: 15, style: 'lattice' });
    for (let i = 0; i < 12; i++) {
      b.coverLow({ x: 5 + (i % 4) * 5, n: 10 + Math.floor(i / 4) * 14, style: (['ancient', 'dominion', 'reformation', 'debris', 'plate'] as const)[i % 5] });
      b.prop(i % 2 ? 'domCrate' : 'refCrate', { x: 3 + i * 1.8, n: 50 });
      b.prop('refLamp', { x: 3 + i * 1.8, n: 4 });
    }
    b.door({ x: 13, n: 0 });
    b.spot({ x: 13, n: 20, h: 12, target: [13, 24, 0], shadow: true });
    b.spot({ x: 13, n: 40, h: 12, target: [13, 44, 0], shadow: true });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    b.finalize();
    expect(warn.mock.calls.some((c) => String(c[0]).includes('shadow-casting lights'))).toBe(true);
    warn.mockRestore();
    let draws = 0, instanced = 0;
    root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh || (o as THREE.Sprite).isSprite) draws++;
      if ((o as THREE.InstancedMesh).isInstancedMesh) instanced++;
    });
    expect(draws).toBeLessThan(110);
    expect(instanced).toBeGreaterThan(0);
    expect(b.stats.shadowLights).toBe(2);
    expect(b.stats.triangles).toBeGreaterThan(5000);
    expect(b.stats.triangles).toBeLessThan(400000);
    expect(b.bounds.getSize(new THREE.Vector3()).z).toBeGreaterThan(55);
    expect(b.keyLight!.shadow.camera.right).toBeGreaterThan(25);
    // statics are frozen, the door still moves
    const merged = root.getObjectByName('kit-static')!;
    expect(merged.children.every((m) => !m.matrixAutoUpdate)).toBe(true);
  });

  it("ceiling 'vaultClosed' encloses the hall: closed shell, haze seams, ribs on the requested stations, few draw calls", () => {
    const { b, root } = builder();
    b.setEnv({ sky: 'crashRib', look: {}, key: { dirFrom: [30, -16, 34] } });
    b.floor({ x: 28, n: 13, w: 56, d: 26 });
    b.ceiling({ x: 28, n: 13, w: 56, d: 26, h: 10, style: 'vaultClosed', rise: 6.6, bay: 8, bayPhase: 4 });
    const named = (n: string): THREE.Mesh => root.getObjectByName(n) as THREE.Mesh;
    const haze = named('vault-haze'), spill = named('vault-spill'), sheets = named('vault-light-sheets');
    expect(haze && spill && sheets).toBeTruthy();
    for (const m of [haze, spill, sheets]) {
      const pos = m.geometry.getAttribute('position');
      expect(pos.count).toBeGreaterThan(0);
      for (let i = 0; i < pos.array.length; i++) expect(Number.isFinite(pos.array[i])).toBe(true);
    }
    // 7 interior bays + 2 half bays (ribs at x = 4, 12 … 52), three seams in each
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(haze);
    expect(box.min.y).toBeGreaterThan(10);
    expect(box.max.y).toBeGreaterThan(16.6);
    expect(box.max.y).toBeLessThan(17.6);
    expect(haze.geometry.getAttribute('position').count / 6).toBe(8 * 3 * 10 + 2);
    b.finalize();
    // the shell neither casts shadows (the key light stands for the light from the seams) nor shows the sky
    let shells = 0, shellCasts = false, draws = 0;
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      draws++;
      if (!/kit-glow:whiteGold\b/.test((m.material as THREE.Material).name)) return;
      shells++;
      if (m.castShadow) shellCasts = true;
    });
    expect(shells).toBeGreaterThan(0);
    expect(shellCasts).toBe(false);
    expect(draws).toBeLessThan(14);
    // degenerate input never throws
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => b.ceiling({ x: 0, n: 0, w: Number.NaN, d: 0, style: 'vaultClosed', rise: -3, bay: Number.NaN, bayPhase: Number.POSITIVE_INFINITY })).not.toThrow();
    warn.mockRestore();
  });

  it('keep() leaves a piece live, reflective floors register, update() ignores repeated timestamps', () => {
    const f = fakeGame();
    const registered: Array<{ mesh: THREE.Mesh; y: number }> = [];
    const unregistered: THREE.Mesh[] = [];
    (f.game as unknown as { render: unknown }).render = {
      quality: { level: 'high', shadows: true, maxShadowLights: 1, shadowMapSize: 1024, volumetrics: true },
      registerReflectiveFloor: (mesh: THREE.Mesh, o: { y: number }) => registered.push({ mesh, y: o.y }),
      unregisterReflectiveFloor: (mesh: THREE.Mesh) => unregistered.push(mesh),
      refreshEnvironment() {}, setLook() {},
    };
    const { b, root } = builder(f);
    b.setEnv({ sky: 'coreChamber', look: {}, key: { dirFrom: [0, 0, 1] } });
    b.floor({ x: 0, n: 0, w: 20, d: 20, h: 1, mat: 'blackStoneFloor', reflective: true });
    b.floor({ x: 20, n: 0, w: 20, d: 20, h: 1, mat: 'blackStoneFloor', reflective: true });
    b.wall({ from: [-10, 10], to: [30, 10], mat: 'blackStone', style: 'ribbed' });
    const kept = b.keep(b.prop('fallenPlate', { x: 3, n: 3, h: 1 }));
    const merged = b.prop('refCrate', { x: -3, n: 3, h: 1 });
    b.spot({ x: 0, n: 0, h: 8, shadow: true });
    let calls = 0;
    b.onUpdate(() => { calls++; });
    b.finalize();
    expect(kept.children.some((c) => (c as THREE.Mesh).isMesh)).toBe(true);
    expect(merged.children.some((c) => (c as THREE.Mesh).isMesh)).toBe(false);
    // both slabs share one mirror plane
    expect(registered.length).toBe(1);
    expect(registered[0].y).toBe(1);
    // quality allows one shadow light: the key keeps it, the spot does not
    expect(b.keyLight!.castShadow).toBe(true);
    expect(b.stats.shadowLights).toBe(1);
    b.update(0.016, 5);
    b.update(0.016, 5);
    expect(calls).toBe(1);
    tick(f, 0.05);
    expect(calls).toBe(4);
    // the builder disposes itself when its root leaves the scene it was attached to
    const scene = new THREE.Scene();
    scene.add(root);
    tick(f, 0.02);
    scene.remove(root);
    tick(f, 0.02);
    expect(root.children.length).toBe(0);
    expect(unregistered.length).toBe(1);
  });

  it('the same seed builds the same zone', () => {
    const count = (seed: number): number => {
      const f = fakeGame();
      const root = new THREE.Group();
      const b = createZoneBuilder(f.game, root, seed);
      b.floor({ x: 0, n: 0, w: 30, d: 30, inlay: 'channels' });
      b.rib({ x: 0, n: 0, span: 20, height: 12, style: 'broken' });
      b.coverLow({ x: 3, n: 3, style: 'debris' });
      b.finalize();
      let sum = 0;
      root.traverse((o) => {
        const p = (o as THREE.Mesh).geometry?.getAttribute('position');
        if (p) for (let i = 0; i < p.count; i += 7) sum += p.getX(i) * 3 + p.getY(i) * 5 + p.getZ(i) * 7;
      });
      return sum;
    };
    expect(count(7)).toBe(count(7));
    expect(count(7)).not.toBe(count(8));
  });
});

describe('polish 3', () => {
  it('Geo.crystal and Geo.blob emit unit normals that face outward', () => {
    const r = (() => { let s = 1; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
    const g = new Geo().crystal(0.2, 1, 0.4, 6, r);
    const h = new Geo().blob(1, 0.6, 0.8, 0.9, r);
    for (const [geo, c] of [[g, [0, 0.6, 0]], [h, [0, 0.1, 0]]] as const) {
      expect(geo.vertexCount).toBeGreaterThan(30);
      for (let i = 0; i < geo.pos.length; i += 9) {
        const cx = (geo.pos[i] + geo.pos[i + 3] + geo.pos[i + 6]) / 3, cy = (geo.pos[i + 1] + geo.pos[i + 4] + geo.pos[i + 7]) / 3, cz = (geo.pos[i + 2] + geo.pos[i + 5] + geo.pos[i + 8]) / 3;
        const n = [geo.nor[i], geo.nor[i + 1], geo.nor[i + 2]];
        expect(Math.hypot(n[0], n[1], n[2])).toBeCloseTo(1, 4);
        expect(n[0] * (cx - c[0]) + n[1] * (cy - c[1]) + n[2] * (cz - c[2])).toBeGreaterThan(-0.05);
      }
    }
  });

  // the zone's rand() is ONE stream: prop variants (and with them their colliders) depend on where it stands.
  // Reworked dressing must leave it exactly where the pre-polish-3 pieces left it (values recorded from them).
  it('frost, corruption, broken ribs and cover leave the shared PRNG stream where it always was', () => {
    const cases: Array<[string, (b: ZoneBuilder) => void, number]> = [
      ['frost', (b) => b.frost({ x: 0, n: 0, w: 12, d: 0.8, height: 4 }), 0.870370583609],
      ['frostWide', (b) => b.frost({ x: 0, n: 0, w: 3, d: 9, height: 5, density: 1.2 }), 0.566763374722],
      ['corr', (b) => b.corruption({ x: 0, n: 0, r: 2.5 }), 0.676656869473],
      ['corrWall', (b) => b.corruption({ x: 0, n: 0, r: 0.8, onWall: true }), 0.988564268686],
      ['broken', (b) => b.rib({ x: 0, n: 0, span: 20, height: 14, style: 'broken' }), 0.022132867714],
      ['brokenRow', (b) => b.ribRow({ x: 0, n: 0, span: 20, height: 14, style: 'broken', count: 3, spacing: 6 }), 0.606505196542],
      ['cover', (b) => { b.coverLow({ x: 0, n: 0, style: 'debris' }); b.coverHigh({ x: 4, n: 0, style: 'ancient' }); }, 0.867735031061],
      ['props', (b) => { b.prop('domCrate', { x: 0, n: 0 }); b.prop('refConsole', { x: 3, n: 0 }); b.prop('recoveryPanel', { x: 6, n: 0 }); b.prop('fireControlStation', { x: 9, n: 0 }); b.prop('ancientConsole', { x: 12, n: 0 }); }, 0.526592542185],
    ];
    for (const [name, make, next] of cases) {
      const { b } = builder();
      make(b);
      expect(b.rand(), name).toBeCloseTo(next, 10);
    }
  });

  it('barrier emitter posts are solid whether the wall is up or down', () => {
    const f = fakeGame();
    const { b } = builder(f);
    b.floor({ x: 10, n: 10, w: 20, d: 20 });
    const bar = b.barrier({ from: [8, 10], to: [12, 10], active: false });
    b.finalize();
    expect(bar.active).toBe(false);
    for (const x of [8, 12]) {
      const hit = b.physics.raycast({ x, y: 1, z: -6 }, { x: 0, y: 0, z: -1 }, 8);
      expect(hit, `post at x ${x}`).not.toBeNull();
      expect(hit!.point.z).toBeGreaterThan(-10.5);
    }
    // the opening between the posts stays free
    expect(b.physics.raycast({ x: 10, y: 1, z: -6 }, { x: 0, y: 0, z: -1 }, 8)).toBeNull();
  });

  it('glass walls take their mullion spacing from mullionSpacing', () => {
    const count = (o?: { mullionSpacing?: number }): number => {
      const { b, root } = builder();
      b.wall({ from: [0, 0], to: [24, 0], height: 6, style: 'glass', ...o });
      let tris = 0;
      root.traverse((m) => {
        const mesh = m as THREE.Mesh;
        if (mesh.isMesh && (mesh.material as THREE.Material).name.startsWith('goldDark')) tris += mesh.geometry.getAttribute('position').count / 3;
      });
      return tris;
    };
    const def = count(), dense = count({ mullionSpacing: 1.5 }), none = count({ mullionSpacing: 0 });
    expect(dense).toBeGreaterThan(def);
    expect(none).toBeLessThan(def);
    expect(none).toBeGreaterThan(0);
  });

  it('fixture lights share or drop down to the light budget; placed lights are kept', () => {
    const { b, root } = builder();
    b.floor({ x: 30, n: 30, w: 60, d: 60 });
    const placed: THREE.Light[] = [];
    for (let i = 0; i < 4; i++) placed.push(b.point({ x: 5 + i * 15, n: 50, h: 4 }));
    // ten lamps in pairs a metre apart, spread over the room, and a corruption patch
    for (let i = 0; i < 10; i++) b.prop('refLamp', { x: 5 + (i >> 1) * 12 + (i & 1), n: 10 + ((i >> 1) % 3) * 8 });
    b.corruption({ x: 50, n: 30, r: 1.5 });
    b.finalize();
    let lights = 0;
    root.traverse((o) => { if ((o as THREE.PointLight).isPointLight || (o as THREE.SpotLight).isSpotLight) lights++; });
    expect(lights).toBeLessThanOrEqual(LIGHT_BUDGET);
    for (const l of placed) expect(l.parent).not.toBeNull();
    let shared = 0;
    root.traverse((o) => { if (o.name.startsWith('kit-shared-light')) shared++; });
    expect(shared).toBeGreaterThan(0);
    expect(b.stats.lights).toBe(lights);
  });
});
