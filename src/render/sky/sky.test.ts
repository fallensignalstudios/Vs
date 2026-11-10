import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { Game, SkyPreset } from '@/core/api';
import { createSkySystem } from './index';
import { battleFrame, battlePlaneCoords } from './fleet';
import { SKY_PRESETS, SKY_PRESET_IDS, SkyState, blendSkyStates, dirFromAzEl, rotateSkyState, slerpDir } from './presets';
import { CLIP_TOWER } from './scenic/clipTower';
import { GeoBuilder } from './scenic/geo';
import { archPoint } from './scenic/megaRibs';

function fakeGame(over: Partial<Record<string, unknown>> = {}): Game {
  return {
    scene: new THREE.Scene(),
    flags: { seed: 7283 },
    settings: { get: () => false },
    mats: null,
    ...over,
  } as unknown as Game;
}

/** signed "rightness" of `dir` for a viewer facing `toward` with +Y up (> 0 = to the right) */
function rightOf(toward: THREE.Vector3, dir: THREE.Vector3): number {
  const right = new THREE.Vector3().crossVectors(toward, new THREE.Vector3(0, 1, 0)).normalize();
  return dir.dot(right);
}

describe('sky presets', () => {
  it('defines every preset id', () => {
    for (const id of SKY_PRESET_IDS) expect(SKY_PRESETS[id]).toBeDefined();
    expect(SKY_PRESET_IDS.length).toBe(9);
  });

  it('az/el convention: az 0 = north (−Z), az 90 = east (+X), el 90 = up', () => {
    expect(dirFromAzEl(0, 0).toArray().map((v) => Math.round(v) + 0)).toEqual([0, 0, -1]);
    expect(dirFromAzEl(90, 0).toArray().map((v) => Math.round(v) + 0)).toEqual([1, 0, 0]);
    expect(dirFromAzEl(0, 90).y).toBeCloseTo(1);
  });

  it('keeps the plan layout: red remnant LEFT, white remnant RIGHT, the Wound BETWEEN', () => {
    for (const id of SKY_PRESET_IDS) {
      const s = new SkyState().setFromDef(SKY_PRESETS[id]);
      if (s.woundVis < 0.5 || s.redVis < 0.5 || s.whiteVis < 0.5) continue;
      expect(rightOf(s.woundDir, s.redDir), `${id} red`).toBeLessThan(-0.2);
      expect(rightOf(s.woundDir, s.whiteDir), `${id} white`).toBeGreaterThan(0.2);
    }
    const obs = new SkyState().setFromDef(SKY_PRESETS.observation);
    expect(obs.woundVis).toBe(1);
    expect(obs.redVis).toBe(1);
    expect(obs.whiteVis).toBe(1);
  });

  it('crashRib Wound is small and contained; woundVista Wound dominates the horizon', () => {
    expect(SKY_PRESETS.crashRib.wound.radius).toBeLessThan(4);
    expect(SKY_PRESETS.woundVista.wound.radius).toBeGreaterThan(10);
    expect(SKY_PRESETS.woundVista.wound.at[1] - SKY_PRESETS.woundVista.wound.radius).toBeLessThan(0); // dips below the horizon
  });

  it('all directions are unit vectors and every key light comes from above', () => {
    for (const id of SKY_PRESET_IDS) {
      const s = new SkyState().setFromDef(SKY_PRESETS[id]);
      for (const d of [s.woundDir, s.redDir, s.whiteDir, s.battleDir, s.keyDir, s.fillDir]) expect(d.length()).toBeCloseTo(1, 6);
      expect(s.keyDir.y, id).toBeGreaterThan(0.3);
    }
  });

  it('blends every field and keeps directions normalised', () => {
    const a = new SkyState().setFromDef(SKY_PRESETS.crashRib);
    const b = new SkyState().setFromDef(SKY_PRESETS.woundVista);
    const m = blendSkyStates(a, b, 0.5, new SkyState());
    expect(m.woundRadius).toBeCloseTo((a.woundRadius + b.woundRadius) / 2, 6);
    expect(m.woundDir.length()).toBeCloseTo(1, 6);
    expect(m.haze.r).toBeCloseTo((a.haze.r + b.haze.r) / 2, 6);
    expect(blendSkyStates(a, b, 0, new SkyState()).woundDir.distanceTo(a.woundDir)).toBeLessThan(1e-9);
    expect(blendSkyStates(a, b, 1, new SkyState()).keyIntensity).toBe(b.keyIntensity);
    // aliasing out with an input is allowed
    blendSkyStates(a, b, 1, a);
    expect(a.woundRadius).toBeCloseTo(b.woundRadius, 9);
  });

  it('slerpDir survives opposite and identical inputs', () => {
    const x = new THREE.Vector3(1, 0, 0), nx = new THREE.Vector3(-1, 0, 0);
    expect(slerpDir(x, x, 0.5, new THREE.Vector3()).distanceTo(x)).toBeLessThan(1e-9);
    const mid = slerpDir(x, nx, 0.5, new THREE.Vector3());
    expect(Number.isFinite(mid.x + mid.y + mid.z)).toBe(true);
    expect(mid.length()).toBeCloseTo(1, 6);
  });

  it('rotateSkyState follows the engine yaw convention (matches Object3D.rotation.y)', () => {
    const s = new SkyState().setFromDef(SKY_PRESETS.woundVista);
    const yaw = 0.7;
    const r = rotateSkyState(s, yaw, new SkyState());
    const expected = s.woundDir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    expect(r.woundDir.distanceTo(expected)).toBeLessThan(1e-9);
    expect(r.woundDir.y).toBeCloseTo(s.woundDir.y, 9);
  });
});

describe('battle plane', () => {
  it('frame is orthonormal with centre = battle direction, right = +X when facing north', () => {
    const f = battleFrame(new THREE.Vector3(0, 0, -1), new THREE.Matrix3());
    expect(Array.from(f.elements).map((v) => Math.round(v) + 0)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, -1]);
    const z = battleFrame(new THREE.Vector3(0, 1, 0), new THREE.Matrix3());
    expect(Number.isFinite(z.elements.reduce((a, b) => a + b, 0))).toBe(true);
  });

  it('battlePlaneCoords inverts the shader mapping', () => {
    const dir = dirFromAzEl(20, 40);
    const f = battleFrame(dir, new THREE.Matrix3());
    const e = f.elements, spread = 0.6, u = 0.4, v = -0.3;
    const p = new THREE.Vector3(e[6] + (e[0] * u + e[3] * v) * spread, e[7] + (e[1] * u + e[4] * v) * spread, e[8] + (e[2] * u + e[5] * v) * spread).normalize();
    const out = { u: 0, v: 0 };
    expect(battlePlaneCoords(f, spread, p, out)).toBe(true);
    expect(out.u).toBeCloseTo(u, 6);
    expect(out.v).toBeCloseTo(v, 6);
    expect(battlePlaneCoords(f, spread, dir.clone().negate(), out)).toBe(false);
  });
});

describe('GeoBuilder', () => {
  const outward = (b: GeoBuilder, centre: THREE.Vector3): boolean => {
    const { pos, nrm, idx } = b.raw();
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t] * 3;
      const p = new THREE.Vector3(pos[a], pos[a + 1], pos[a + 2]);
      const c = new THREE.Vector3(pos[idx[t + 1] * 3], pos[idx[t + 1] * 3 + 1], pos[idx[t + 1] * 3 + 2]);
      const d = new THREE.Vector3(pos[idx[t + 2] * 3], pos[idx[t + 2] * 3 + 1], pos[idx[t + 2] * 3 + 2]);
      const face = new THREE.Vector3().crossVectors(c.clone().sub(p), d.clone().sub(p));
      const n = new THREE.Vector3(nrm[a], nrm[a + 1], nrm[a + 2]);
      const mid = p.clone().add(c).add(d).divideScalar(3).sub(centre);
      if (face.dot(n) <= 0 || n.dot(mid) <= 0) return false;
    }
    return true;
  };

  it('boxes, prisms and lofts wind counter-clockwise with outward normals', () => {
    expect(outward(new GeoBuilder().box(1, 2, 3, 2, 4, 6), new THREE.Vector3(1, 2, 3))).toBe(true);
    expect(outward(new GeoBuilder().box(0, 0, 0, 2, 2, 2, { top: 0.5, shift: [0.2, 0.1] }), new THREE.Vector3())).toBe(true);
    expect(outward(new GeoBuilder().prism(0, 0, 0, 5, 2, 1, 6), new THREE.Vector3(0, 2.5, 0))).toBe(true);
    expect(outward(new GeoBuilder().prism(0, 0, 0, 5, 2, 0, 4), new THREE.Vector3(0, 1.5, 0))).toBe(true);
    const ring = (z: number): [number, number, number][] => [[0, -1, z], [1, 0, z], [0, 1, z], [-1, 0, z]];
    expect(outward(new GeoBuilder().loft([ring(2), ring(0), ring(-3)]), new THREE.Vector3(0, 0, 0))).toBe(true);
  });

  it('stays outward under mirrored and rotated transforms', () => {
    const b = new GeoBuilder().push().scale(-1, 1, 1).rotateY(0.6).box(0, 0, 0, 2, 3, 4).pop();
    expect(outward(b, new THREE.Vector3())).toBe(true);
  });

  it('sweep produces a closed outward tube for either handedness', () => {
    for (const s of [-1, 1]) {
      const frames = [0, 1, 2, 3].map((i) => ({ p: [s * i, i * 2, 0] as [number, number, number], side: [0, 0, 1] as [number, number, number], up: [s * 0.894, -0.447, 0] as [number, number, number], w: 1, d: 1 }));
      const b = new GeoBuilder().sweep(frames);
      expect(outward(b, new THREE.Vector3(s * 1.5, 3, 0))).toBe(true);
    }
  });

  it('builds indexed geometry with colour and glow attributes', () => {
    const g = new GeoBuilder().paint(0xff0000, 2).box(0, 0, 0, 1, 1, 1).build();
    expect(g.getAttribute('position').count).toBe(24);
    expect(g.getAttribute('aGlow').getX(0)).toBe(2);
    expect(g.index?.count).toBe(36);
  });
});

describe('megaRibs arch', () => {
  it('springs at the half span and meets at the apex', () => {
    expect(archPoint(0, 200, 300)[0]).toBeCloseTo(100);
    expect(archPoint(0, 200, 300)[1]).toBeCloseTo(0);
    expect(archPoint(1, 200, 300)[0]).toBeCloseTo(0, 5);
    expect(archPoint(1, 200, 300)[1]).toBeCloseTo(300);
  });
});

describe('sky system', () => {
  it('adds itself to the scene and reports target directions immediately', () => {
    const game = fakeGame();
    const sky = createSkySystem(game);
    expect(sky.root.parent).toBe(game.scene);
    sky.setPreset('observation', { blendSeconds: 5 });
    expect(sky.preset).toBe('observation');
    const want = new SkyState().setFromDef(SKY_PRESETS.observation);
    expect(sky.woundDir.distanceTo(want.woundDir)).toBeLessThan(1e-9);
    expect(sky.keyLight.intensity).toBe(SKY_PRESETS.observation.key.intensity);
    expect(sky.keyLight.dir.length()).toBeCloseTo(1, 6);
    expect(sky.fillLight.intensity).toBeGreaterThan(0);
  });

  it('setHeading rotates bodies and lights together', () => {
    const sky = createSkySystem(fakeGame());
    sky.setPreset('woundVista');
    const before = sky.woundDir.clone();
    sky.setHeading(Math.PI / 2);
    expect(sky.heading).toBeCloseTo(Math.PI / 2);
    expect(sky.woundDir.distanceTo(before.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2))).toBeLessThan(1e-9);
    expect(rightOf(sky.woundDir, sky.whiteRemnantDir)).toBeGreaterThan(0.2);
    expect(rightOf(sky.woundDir, sky.redRemnantDir)).toBeLessThan(-0.2);
  });

  it('never throws on bad input: unknown preset, NaN, zero / negative dt', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sky = createSkySystem(fakeGame());
    const cam = new THREE.PerspectiveCamera();
    expect(() => {
      sky.setPreset('nope' as SkyPreset);
      sky.setPreset('nope' as SkyPreset);
      sky.setBattleIntensity(Number.NaN);
      sky.setWoundActivity(7);
      sky.setBoundaryClosed(true, Number.NaN);
      sky.setHeading(Number.NaN);
      sky.impact({ dir: { x: Number.NaN, y: 0, z: 0 }, strength: Number.NaN });
      sky.impact();
      sky.carrier.setProgress(Number.NaN);
      sky.carrier.setStabilized(Number.POSITIVE_INFINITY);
      sky.carrier.setAnchor({ x: 1, y: 2, z: 3 }, Number.NaN);
      sky.update(Number.NaN, cam);
      sky.update(-1, cam);
      sky.update(0, cam);
      sky.update(1 / 60, cam);
    }).not.toThrow();
    expect(sky.preset).toBe('void');
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('unknown preset')).length).toBe(1);
    expect(sky.woundActivity).toBeLessThanOrEqual(1);
    expect(sky.heading).toBe(0);
    warn.mockRestore();
  });

  it('crossfades over blendSeconds and eases the setters', () => {
    const sky = createSkySystem(fakeGame());
    const cam = new THREE.PerspectiveCamera();
    sky.setPreset('crashRib');
    expect(sky.battleIntensity).toBeCloseTo(SKY_PRESETS.crashRib.battle.intensity);
    sky.setPreset('hangar', { blendSeconds: 2 });
    const mid = sky.hazeColor.clone();
    for (let i = 0; i < 60; i++) sky.update(1 / 60, cam);
    expect(sky.hazeColor.equals(mid)).toBe(false);
    for (let i = 0; i < 400; i++) sky.update(1 / 60, cam);
    expect(sky.hazeColor.getHex()).toBe(new THREE.Color(SKY_PRESETS.hangar.haze).getHex());
    expect(sky.battleIntensity).toBeLessThan(0.01);
    sky.setBoundaryClosed(true, 1);
    for (let i = 0; i < 70; i++) sky.update(1 / 60, cam);
    expect(sky.boundaryClosed).toBe(1);
  });

  it('battle produces light only while it is hot, deterministically', () => {
    const run = (): number => {
      const sky = createSkySystem(fakeGame());
      const cam = new THREE.PerspectiveCamera();
      sky.setPreset('battleCeiling');
      sky.setBattleIntensity(1);
      let sum = 0;
      for (let i = 0; i < 900; i++) { sky.update(1 / 60, cam); sum += sky.battleGlow.r + sky.battleGlow.g + sky.battleGlow.b; }
      return sum;
    };
    const a = run();
    expect(a).toBeGreaterThan(0);
    expect(run()).toBe(a);
    const quiet = createSkySystem(fakeGame());
    quiet.setPreset('hangar');
    for (let i = 0; i < 600; i++) quiet.update(1 / 60, new THREE.PerspectiveCamera());
    expect(quiet.battleGlow.r + quiet.battleGlow.g + quiet.battleGlow.b).toBe(0);
    quiet.impact({ strength: 1 });
    quiet.update(1 / 60, new THREE.PerspectiveCamera());
    expect(quiet.battleGlow.r + quiet.battleGlow.g + quiet.battleGlow.b).toBeGreaterThan(0);
  });
});

describe('carrier', () => {
  it('passes the clip tower at progress 0.8 and keeps position current', () => {
    const sky = createSkySystem(fakeGame());
    const c = sky.carrier;
    expect(c.visible).toBe(false);
    c.visible = true;
    c.setStabilized(1);
    c.setProgress(CLIP_TOWER.progress);
    expect(c.progress).toBe(0.8);
    expect(c.position.distanceTo(c.object.position)).toBe(0);
    // hull centre is within the hull's own half-height + beam of the tower's cut point
    expect(Math.hypot(c.position.x - c.clipPoint.x, c.position.z - c.clipPoint.z)).toBeLessThan(40);
    expect(c.position.y - c.clipPoint.y).toBeGreaterThan(20);
    expect(c.position.y - c.clipPoint.y).toBeLessThan(70);
    expect(c.forward.length()).toBeCloseTo(1, 6);
    c.setProgress(5);
    expect(c.progress).toBe(1);
    const far = c.position.clone();
    c.setProgress(0.2);
    expect(c.position.distanceTo(far)).toBeGreaterThan(800);
  });

  it('setAnchor moves and rotates the whole pass', () => {
    const sky = createSkySystem(fakeGame());
    const c = sky.carrier;
    c.setStabilized(1);
    c.setProgress(0.5);
    const base = c.position.clone();
    c.setAnchor({ x: 100, y: 10, z: -50 }, Math.PI);
    const want = base.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI).add(new THREE.Vector3(100, 10, -50));
    expect(c.position.distanceTo(want)).toBeLessThan(1e-6);
  });

  it('casts its shadow only while overhead between the atrium and the key light', () => {
    const sky = createSkySystem(fakeGame());
    const cam = new THREE.PerspectiveCamera();
    sky.setPreset('battleCeiling');
    const c = sky.carrier;
    c.setStabilized(1);
    c.setProgress(0.05);
    sky.update(1 / 60, cam);
    expect(c.shadow).toBe(0); // hidden
    c.visible = true;
    sky.update(1 / 60, cam);
    expect(c.shadow).toBe(0); // far away
    let peak = 0;
    for (let p = 0.4; p <= 0.9; p += 0.01) { c.setProgress(p); sky.update(1 / 60, cam); peak = Math.max(peak, c.shadow); }
    expect(peak).toBeGreaterThan(0.5);
  });
});

describe('scenic factory', () => {
  const drawCalls = (o: THREE.Object3D): number => {
    let n = 0;
    o.traverse((c) => { if ((c as THREE.Mesh).isMesh) n++; });
    return n;
  };
  const triangles = (o: THREE.Object3D): number => {
    let n = 0;
    o.traverse((c) => {
      const m = c as THREE.Mesh;
      if (!m.isMesh) return;
      const g = m.geometry as THREE.BufferGeometry & { instanceCount?: number };
      const per = (g.index ? g.index.count : g.getAttribute('position').count) / 3;
      n += per * (Number.isFinite(g.instanceCount) ? (g.instanceCount as number) : 1);
    });
    return n;
  };

  it('every piece stays within 12 draw calls and a sane triangle budget', () => {
    const f = createSkySystem(fakeGame()).scenic;
    const pieces: Array<[string, THREE.Object3D, number]> = [
      ['terminalVista', f.terminalVista(), 120000],
      ['atriumShell', f.atriumShell(), 60000],
      ['crownmarkArm', f.crownmarkArm(), 60000],
      ['megaRibs', f.megaRibs(), 20000],
      ['dominionShuttle', f.ship('dominionShuttle'), 4000],
      ['reformationTransport', f.ship('reformationTransport'), 5000],
      ['dominionCapital', f.ship('dominionCapital'), 5000],
      ['reformationCapital', f.ship('reformationCapital'), 6000],
      ['wreck dominion', f.wreck('dominion'), 4000],
      ['wreck reformation', f.wreck('reformation'), 4000],
    ];
    for (const [name, o, budget] of pieces) {
      expect(drawCalls(o), name).toBeGreaterThan(0);
      expect(drawCalls(o), name).toBeLessThanOrEqual(12);
      expect(triangles(o), name).toBeLessThan(budget);
    }
  });

  it('is deterministic per seed and honours options', () => {
    const f = createSkySystem(fakeGame()).scenic;
    const a = f.megaRibs({ count: 3 }), b = f.megaRibs({ count: 3 }), c = f.megaRibs({ count: 6 });
    expect(triangles(a)).toBe(triangles(b));
    expect(triangles(c)).toBeGreaterThan(triangles(a));
    expect(triangles(f.terminalVista({ corridor: 600 }))).toBeLessThan(triangles(f.terminalVista()));
    expect(f.ship('dominionShuttle', { scale: 2 }).scale.x).toBe(2);
  });

  it('falls back instead of throwing on unknown kinds and absurd options', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const f = createSkySystem(fakeGame()).scenic;
    expect(() => {
      f.ship('yacht' as 'dominionShuttle');
      f.wreck('pirate' as 'dominion');
      f.megaRibs({ count: -4, span: Number.NaN, height: 0, spacing: -1 });
      f.atriumShell({ radius: 1, height: 1, shaftRadius: 9999, tiers: 99 });
      f.terminalVista({ radius: -5, density: 99 });
      f.crownmarkArm({ length: 0, width: 0 });
    }).not.toThrow();
    warn.mockRestore();
  });

  it('near-field ships use the material library when it is real', () => {
    const lib = new Map<string, THREE.Material>();
    const mats = {
      get: (id: string) => { if (!lib.has(id)) lib.set(id, new THREE.MeshStandardMaterial({ name: id })); return lib.get(id); },
      emissive: () => new THREE.MeshStandardMaterial({ name: 'emissive' }),
    };
    const f = createSkySystem(fakeGame({ mats })).scenic;
    const names = new Set<string>();
    f.ship('dominionShuttle').traverse((c) => { const m = c as THREE.Mesh; if (m.isMesh) names.add((m.material as THREE.Material).name); });
    expect(names.has('domBronze')).toBe(true);
    expect(names.has('domOxblood')).toBe(true);
  });
});
