import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { Game, SkyPreset } from '@/core/api';
import { CARRIER_MODEL_OFFSET, type Carrier } from './carrier';
import { BOW_Z, HULL_LENGTH, RAM_BOTTOM, RAM_TOP, insideHull } from './carrierHull';
import { WOUND_SCALE_MIN, woundScale } from './dome';
import { DOME_FRAGMENT, WOUND_LOOK, WOUND_SOLID, woundCoreColor, woundEllipse, woundThroatHalfWidth, woundVoidOpacity, woundVoidReach, woundWander } from './domeShader';
import { createSkySystem } from './index';
import { battleFrame, battlePlaneCoords, createFleet } from './fleet';
import { createSharedUniforms } from './shared';
import { silhouette } from '@/world/props/ships/silhouettes';
import { GENERATED_CAPITAL_LIGHTS } from './scenic/hulls';
import { SKY_PRESETS, SKY_PRESET_IDS, SkyState, blendSkyStates, dirFromAzEl, rotateSkyState, slerpDir } from './presets';
import { lancet } from './scenic/arch';
import { CLIP_TOWER, clipTowerRadius } from './scenic/clipTower';
import { GeoBuilder } from './scenic/geo';
import { archPoint } from './scenic/megaRibs';
import { num } from './scenic/opts';
import { CAP_FLOOR, VOID_DOWN, insideWound, woundCap, woundCone } from './scenic/woundClear';

const DEG = Math.PI / 180;

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

  it('crashRib Wound is small and contained; woundVista Wound dominates the horizon, wholly above the city', () => {
    expect(SKY_PRESETS.crashRib.wound.radius).toBeLessThan(4);
    expect(SKY_PRESETS.woundVista.wound.radius).toBeGreaterThan(8);
    // the disc's lower limb clears the horizon (and the spires capped under it): a clean, seam-free silhouette — but
    // only just (polish pass 4: the painting's opening sits low over the city, its centre ≈ 1.1 radii above the skyline)
    expect(SKY_PRESETS.woundVista.wound.at[1] - SKY_PRESETS.woundVista.wound.radius).toBeGreaterThan(2);
    expect(SKY_PRESETS.woundVista.wound.at[1] / SKY_PRESETS.woundVista.wound.radius).toBeLessThan(1.35);
    // the red remnant is the one accent, and smaller than the Wound by far
    expect(SKY_PRESETS.woundVista.red.radius).toBeLessThan(SKY_PRESETS.woundVista.wound.radius * 0.6);
    expect(SKY_PRESETS.woundVista.sat).toBeLessThan(0.6);
  });

  it('interior presets close overhead; Z10 sees the Wound through its shut boundary; Z07 sees the battle at eye level', () => {
    const frozen = new SkyState().setFromDef(SKY_PRESETS.frozenInterior);
    expect(frozen.enclosure).toBeGreaterThan(0.5);
    expect(frozen.stars).toBe(0);
    expect(frozen.horizon.r + frozen.horizon.g + frozen.horizon.b).toBeGreaterThan(0.6); // bright haze, not night
    const core = new SkyState().setFromDef(SKY_PRESETS.coreChamber);
    expect(core.woundVis).toBe(1);
    expect(core.veil).toBeGreaterThan(0.2);
    expect(core.fleet).toBe(0);
    const breach = SKY_PRESETS.breachDeep.battle;
    expect(breach.at[1]).toBeLessThan(25); // through a glass wall, not over it
    expect(breach.fleet).toBeGreaterThan(0.3);
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

describe('the Wound: a soft vortex (dome shader maths, mirrored on the CPU)', () => {
  const lum = (c: readonly number[]): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

  it('its core is an almost uniform near-black, not flat black: darkest at the centre, faint funnel rings only near the rim', () => {
    const centre = woundCoreColor(0, 0.5);
    for (const ch of centre) expect(ch).toBeGreaterThan(0.002);
    // neutral: the void carries no hue of its own (each preset white-balances it against its grade)
    for (const rn of [0, 0.5, 0.9]) {
      const c = woundCoreColor(rn, 0.5);
      expect(Math.max(...c) - Math.min(...c)).toBeLessThan(0.05 * Math.max(...c));
    }
    // depth: it lifts steadily from the centre toward the rim, slightly
    let prev = 0;
    for (let rn = 0; rn <= 1.0001; rn += 0.05) {
      const l = lum(woundCoreColor(rn, 0.5));
      expect(l).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = l;
    }
    expect(lum(woundCoreColor(0.95, 0.5))).toBeGreaterThan(lum(centre) * 1.1);
    expect(lum(woundCoreColor(0.95, 0.5))).toBeLessThan(lum(centre) * 1.5);
    // the spiral grain: clearly there near the rim, and nothing at all inside 0.6 radii (no curtain through the void)
    const rim = lum(woundCoreColor(0.92, 1)) / lum(woundCoreColor(0.92, 0));
    expect(rim).toBeGreaterThan(1.6);
    for (const rn of [0, 0.3, WOUND_LOOK.ringsFrom]) expect(lum(woundCoreColor(rn, 1)) / lum(woundCoreColor(rn, 0))).toBeCloseTo(1, 9);
    for (let st = 0; st <= 1; st += 0.25) {
      for (const ch of woundCoreColor(0.8, st)) {
        expect(ch).toBeGreaterThan(0);
        expect(ch).toBeLessThan(0.02); // a void: never as bright as the smoke around it
      }
    }
    // no preset renders it flat black; the gallery lifts it most (its grade crushes the blacks)
    for (const id of SKY_PRESET_IDS) expect(SKY_PRESETS[id].woundCore, id).toBeGreaterThan(0.1);
    expect(SKY_PRESETS.woundVista.woundCore).toBeGreaterThan(2);
    // …and where the sky around it is near-black (Z10 behind its veil, Z12) it stays near-black too, so the opening
    // still reads as the darkest thing there against its lit smoke
    for (const id of ['coreChamber', 'hangar'] as const) expect(SKY_PRESETS[id].woundCore, id).toBeLessThan(0.35);
  });

  it('the gallery white-balances the void against its blue shadows (warm in, neutral out)', () => {
    const s = new SkyState().setFromDef(SKY_PRESETS.woundVista);
    const c = woundCoreColor(0, 0.5).map((v, i) => v * s.woundCore * [s.coreTint.r, s.coreTint.g, s.coreTint.b][i] * [s.tint.r, s.tint.g, s.tint.b][i]);
    // the woundGallery grade lifts blue roughly ×2 in its deepest tones: the void goes in at about half as much blue
    expect(c[2] / c[0]).toBeGreaterThan(0.35);
    expect(c[2] / c[0]).toBeLessThan(0.6);
    expect(c[1] / c[0]).toBeGreaterThan(0.85);
  });

  it('its edge is soft and irregular: never a step, never a circle', () => {
    for (const ell of [WOUND_LOOK.edgeB, 1, WOUND_LOOK.edgeA]) {
      for (const wob of [0, 0.25, 0.5, 0.75, 1]) {
        expect(woundVoidOpacity(WOUND_SOLID, wob, ell)).toBeCloseTo(1, 6);
        expect(woundVoidOpacity(1.3, wob, ell)).toBe(0);
        // from 95 % to 5 % takes at least an eighth of the radius, and no 1 % of the radius drops it by 12 % or more
        let r95 = Number.NaN, r05 = Number.NaN, maxDrop = 0;
        for (let rn = 0.5; rn < 1.35; rn += 0.001) {
          const a = woundVoidOpacity(rn, wob, ell);
          maxDrop = Math.max(maxDrop, a - woundVoidOpacity(rn + 0.01, wob, ell));
          if (Number.isNaN(r95) && a < 0.95) r95 = rn;
          if (Number.isNaN(r05) && a < 0.05) r05 = rn;
        }
        expect(r05 - r95).toBeGreaterThan(0.12);
        expect(maxDrop).toBeLessThan(0.12);
      }
    }
    // the boundary wanders with angle at low frequency (its wander 0 → 1) by about a fifth of a radius…
    const half = (wob: number, ell = 1): number => {
      let rn = 0.4;
      while (woundVoidOpacity(rn, wob, ell) > 0.5) rn += 0.0005;
      return rn;
    };
    expect(half(1) - half(0)).toBeGreaterThan(0.18);
    // …swelling outward twice as far as it recedes, so it never bites a deep concave notch into the opening
    expect(half(0.5) - half(0)).toBeLessThan(0.6 * (half(1) - half(0.5)));
    expect(woundWander(0)).toBeCloseTo(-WOUND_LOOK.edgeWobble / 4, 9);
    expect(woundWander(1)).toBeCloseTo(WOUND_LOOK.edgeWobble / 2, 9);
    // …around an opening that is an ellipse, wider than tall
    expect(woundEllipse(1, 0)).toBeCloseTo(WOUND_LOOK.edgeA, 9);
    expect(woundEllipse(0, -3)).toBeCloseTo(WOUND_LOOK.edgeB, 9);
    expect(woundEllipse(1, 0) - woundEllipse(0, 1)).toBeGreaterThan(0.1);
    expect(half(0.5, woundEllipse(1, 0)) - half(0.5, woundEllipse(0, 1))).toBeGreaterThan(0.1);
    // the furthest fringe is where the mirror says it is
    for (const [dx, dy] of [[1, 0], [0, -1], [-0.6, 0.8]]) {
      const ell = woundEllipse(dx, dy);
      expect(woundVoidOpacity(woundVoidReach(dx, dy), 1, ell)).toBe(0);
      expect(woundVoidOpacity(woundVoidReach(dx, dy) - 0.02, 1, ell)).toBeGreaterThan(0);
    }
  });

  it('the shader runs on exactly the numbers the mirror checks, and draws no hairline rim', () => {
    expect(DOME_FRAGMENT).toContain(`const float EDGE_R = ${WOUND_LOOK.edgeR};`);
    expect(DOME_FRAGMENT).toContain(`const float EDGE_A = ${WOUND_LOOK.edgeA};`);
    expect(DOME_FRAGMENT).toContain(`const float EDGE_B = ${WOUND_LOOK.edgeB};`);
    expect(DOME_FRAGMENT).toContain(`const float EDGE_WOBBLE = ${WOUND_LOOK.edgeWobble};`);
    expect(DOME_FRAGMENT).toContain(`const float EDGE_IN = ${WOUND_LOOK.edgeIn};`);
    expect(DOME_FRAGMENT).toContain(`const float EDGE_OUT = ${WOUND_LOOK.edgeOut};`);
    expect(DOME_FRAGMENT).toContain(`const float CORE_RINGS = ${WOUND_LOOK.rings};`);
    expect(DOME_FRAGMENT).toContain(`const float CORE_RINGS_FROM = ${WOUND_LOOK.ringsFrom};`);
    expect(DOME_FRAGMENT).toContain(`const vec3 CORE_DEEP = vec3(${WOUND_LOOK.coreDeep.join(', ')});`);
    expect(DOME_FRAGMENT).toContain(`const float THROAT_TOP = ${WOUND_LOOK.throatTop};`);
    expect(DOME_FRAGMENT).toContain(`const float THROAT_BOTTOM = ${WOUND_LOOK.throatBottom};`);
    expect(DOME_FRAGMENT).toMatch(/const float WOUND_SOLID = 0\.\d+;/);
    expect(DOME_FRAGMENT).not.toMatch(/event.horizon/i);
    // the background is only skipped where the void is opaque at every angle
    expect(DOME_FRAGMENT).toContain('rn < WOUND_SOLID');
  });

  it('its crust is one ragged mass, not a lattice of plates: no cellular noise anywhere, veins only on matter', () => {
    // (the previous shell was whole Voronoi plates with glowing cell borders; the crust is a thresholded,
    // domain-warped fbm mass, and its violet veins are masked by the crust's own coverage or held to the lip)
    expect(DOME_FRAGMENT).not.toMatch(/\bcells\s*\(/);
    expect(DOME_FRAGMENT).not.toMatch(/shellPlates/);
    expect(DOME_FRAGMENT).toMatch(/glow \+= vein \* \(1\.0 - inkA\) \* \(matter \*/);
    // the lining next to the opening is one smooth, dark mass: no chunks and no highlights there (no lit lip)
    expect(DOME_FRAGMENT).toMatch(/float lining = 1\.0 - smoothstep\(/);
    expect(DOME_FRAGMENT).toMatch(/float hl = .*\* \(1\.0 - lining\);/);
    expect(DOME_FRAGMENT).toMatch(/- 0\.22 \* lining/);
  });

  it('its violet is light on matter, not lamps: irregular clusters and forked crackle filaments, no point sprites', () => {
    // (the previous pass ringed the opening with five evenly spaced round knots, which read as LEDs)
    expect(DOME_FRAGMENT).not.toMatch(/woundKnot|knotAt/);
    // the clusters light the matter itself (its lit faces turn lavender-violet) and glow softly as an area
    expect(DOME_FRAGMENT).toMatch(/matC = mix\(matC, mix\(LAVVIO, LAVGREY, /);
    expect(DOME_FRAGMENT).toMatch(/col \+= LAVVIO \* mt \* [\d.]+ \* vl/);
    // one forked filament (a main thread and two branches) along the lower-right lip; no more than a few threads
    const threads = DOME_FRAGMENT.match(/crackle\(pc, /g) ?? [];
    expect(threads.length).toBeGreaterThanOrEqual(2);
    expect(threads.length).toBeLessThanOrEqual(4);
  });

  it('its throat carries the funnel down to the horizon: its grooved wall, narrowing, matter rather than void', () => {
    // only where the Wound sinks into a city behind the skyline (the overlook); elsewhere it hangs in open space
    expect(new SkyState().setFromDef(SKY_PRESETS.woundVista).woundThroat).toBe(1);
    for (const id of SKY_PRESET_IDS.filter((i) => i !== 'woundVista')) expect(new SkyState().setFromDef(SKY_PRESETS[id]).woundThroat, id).toBe(0);
    expect(DOME_FRAGMENT).toMatch(/smoothstep\(-0\.6, -0\.15, hgt\) \* uWoundThroat/);
    // as wide as the opening where it leaves it, narrower at the horizon, never wider than the opening
    const top = woundThroatHalfWidth(0), bottom = woundThroatHalfWidth(1);
    expect(top).toBeLessThanOrEqual(WOUND_LOOK.edgeR * WOUND_LOOK.edgeA + 1e-9);
    expect(top).toBeGreaterThan(0.85);
    expect(bottom).toBeLessThan(top);
    // about 1.2 – 1.8 radii across where it meets the skyline (the painting's dark column)
    expect(2 * bottom).toBeGreaterThan(1.2);
    expect(2 * bottom).toBeLessThan(1.8);
    for (let k = 0; k < 1; k += 0.1) expect(woundThroatHalfWidth(k + 0.1)).toBeLessThanOrEqual(woundThroatHalfWidth(k) + 1e-12);
    expect(woundThroatHalfWidth(-1)).toBe(top);
    expect(woundThroatHalfWidth(2)).toBe(bottom);
    // polish pass 4: right under the opening it IS the void's rim colour (so the lower arc never shows as a U-shaped
    // edge), grading into the void's rock (ink) lifted by the grooves further down — no vertical curtain folds
    expect(DOME_FRAGMENT).toMatch(/vec3 rimC = woundCore\(1\.0, grooveT\)/);
    expect(DOME_FRAGMENT).toMatch(/vec3 thC = mix\(rimC, ink \* \(0\.9\d? \+/);
    expect(DOME_FRAGMENT).not.toMatch(/tx \* 4\.2/);
    // it is matter, not void: only the horizon haze reads it (the white remnant's glare masks the void alone)
    expect(DOME_FRAGMENT).toContain('gWoundDark = max(voidA, throatA');
    expect(DOME_FRAGMENT).toContain('gWoundVoid = voidA * uWoundVis');
    expect(DOME_FRAGMENT).toContain('float absence = gWoundDark');
  });

  it('balances its matter on its own against the gallery grade (cool grey, not magenta)', () => {
    const s = new SkyState().setFromDef(SKY_PRESETS.woundVista);
    const m = s.matterTint;
    // the gallery splits blue shadows from warm highlights; polish pass 4 measured the painting's crust and smoke as a
    // faintly violet grey (red ≈ green, blue a little higher), so matter goes in near neutral, blue held back a touch
    expect(m.g / m.r).toBeGreaterThan(0.95);
    expect(m.g / m.r).toBeLessThan(1.12);
    expect(m.g).toBeGreaterThan(m.b * 1.05);
    // Z10's silver-cold grade turns its smoke blue-white: it goes in a touch warm, to land on grey
    const z10 = new SkyState().setFromDef(SKY_PRESETS.coreChamber).matterTint;
    expect(z10.r).toBeGreaterThanOrEqual(z10.g);
    expect(z10.g).toBeGreaterThan(z10.b);
    // presets without such a grade leave it alone
    for (const id of ['hangar', 'observation', 'crashRib'] as const) {
      const t = new SkyState().setFromDef(SKY_PRESETS[id]).matterTint;
      expect([t.r, t.g, t.b], id).toEqual([1, 1, 1]);
    }
    // it blends like every other colour
    const a = new SkyState().setFromDef(SKY_PRESETS.hangar);
    const mid = blendSkyStates(a, s, 0.5, new SkyState());
    expect(mid.matterTint.r).toBeCloseTo((a.matterTint.r + m.r) / 2, 9);
  });

  it('its void stays wholly above the skyline and above every spire capped under it, even fully swollen; its funnel may sink behind them', () => {
    const w = SKY_PRESETS.woundVista.wound;
    // the furthest the void's faintest fringe reaches straight down, fully swollen, in Wound radii
    expect(VOID_DOWN).toBeCloseTo(woundVoidReach(0, -1) * woundScale(1), 9);
    const lowest = w.at[1] - w.radius * VOID_DOWN;
    // (polish pass 4: just above the city's glow line, 1.1°, where the painting puts it)
    expect(lowest).toBeGreaterThan(1.15);
    expect(lowest).toBeLessThan(3);
    // scenic/woundClear caps whatever stands under the void just below that lowest point (and lower toward the sides)
    const cone = woundCone();
    const capAt = (dazDeg: number): number | null => {
      const c = woundCap(cone, dazDeg * DEG);
      return c === null ? null : c / DEG;
    };
    expect(capAt(0)!).toBeLessThan(lowest);
    expect(capAt(0)!).toBeGreaterThan(lowest - 1.5);
    // the floor a cap never goes under stays under the void's lowest point too
    expect(CAP_FLOOR / DEG).toBeLessThan(lowest - 0.3);
    for (let daz = 0; daz < 20; daz += 0.5) {
      const c = capAt(daz);
      if (c === null) continue;
      // the void's lower arc at that azimuth stays above the cap
      const off = Math.max(daz - 1.5, 0);
      const arc = w.at[1] - Math.sqrt(Math.max((w.radius * VOID_DOWN) ** 2 - off * off, 0));
      expect(c, `daz ${daz}`).toBeLessThan(arc);
    }
    // structures beside the void are not capped at all
    expect(capAt(w.radius * VOID_DOWN + 2)).toBeNull();
    // while the Wound as a whole (its crust and smoke, ≈ 1.6 radii) reaches down to the horizon behind them
    expect(w.at[1] - w.radius * 1.6).toBeLessThan(1);
    // it fills about 30 % of the painting framing's width (fov 58 at 16:9 ≈ 89° across), crust included
    const hfov = 2 * Math.atan(Math.tan(29 * DEG) * 16 / 9) / DEG;
    expect((w.radius * 1.6 * 2) / hfov).toBeGreaterThan(0.33);
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

  it('builds indexed geometry with colour, glow, baked light and surface coordinates', () => {
    const g = new GeoBuilder().paint(0xff0000, 2).light(0.5, 1).dress(0.25, 0).box(0, 0, 0, 1, 1, 1).build();
    expect(g.getAttribute('position').count).toBe(24);
    expect(g.getAttribute('aGlow').getX(0)).toBe(2);
    expect(g.getAttribute('aLight').getX(0)).toBeCloseTo(0.5, 2);
    expect(g.getAttribute('aLight').getY(0)).toBeCloseTo(1, 2);
    expect(g.getAttribute('aLight').getZ(0)).toBeCloseTo(0.25, 2);
    expect(g.getAttribute('aLight').getW(0)).toBe(0);
    expect(g.getAttribute('aUv').count).toBe(24);
    expect(g.getAttribute('normal').getY(8)).toBeCloseTo(0, 1);
    expect(g.index?.count).toBe(36);
  });

  it('bevelled boxes, lathes, skins, tubes and balls face outward (also when mirrored)', () => {
    const o = new THREE.Vector3();
    expect(new GeoBuilder().bevelBox(0, 0, 0, 4, 2, 6, 0.3).triangleCount).toBe(44);
    expect(outward(new GeoBuilder().bevelBox(0, 0, 0, 4, 2, 6, 0.3), o)).toBe(true);
    expect(outward(new GeoBuilder().push().scale(-1, 1, 1).bevelBox(0, 0, 0, 4, 2, 6, 0.3).pop(), o)).toBe(true);
    // closed section revolved (a ring slab): every normal points away from the section's own centre line
    const slab = new GeoBuilder().lathe(0, 0, [[5, -1], [5, 1], [4.2, 1], [4.2, -1]], 24, { closed: true }).raw();
    for (let i = 0; i < slab.pos.length; i += 3) {
      const r = Math.hypot(slab.pos[i], slab.pos[i + 2]);
      const cx = (slab.pos[i] / r) * 4.6, cz = (slab.pos[i + 2] / r) * 4.6;
      expect((slab.pos[i] - cx) * slab.nrm[i] + slab.pos[i + 1] * slab.nrm[i + 1] + (slab.pos[i + 2] - cz) * slab.nrm[i + 2]).toBeGreaterThan(0);
    }
    expect(outward(new GeoBuilder().cyl(0, -1, 0, 1, 1, 0.5, 12), o)).toBe(true);
    expect(outward(new GeoBuilder().ball(0, 0, 0, 2, 1, 3, 12, 8), o)).toBe(true);
    expect(outward(new GeoBuilder().tube([[0, 0, 0], [0, 0, -4], [1, 0, -8]], 0.5, 8), new THREE.Vector3(0.2, 0, -4))).toBe(true);
    const ring = (z: number, k: number): [number, number, number][] => [[0, -k, z], [k, 0, z], [0, k, z], [-k, 0, z]];
    expect(outward(new GeoBuilder().skin([ring(2, 1), ring(0, 1.4), ring(-3, 0.8)], { crease: [1, 3], caps: true }), o)).toBe(true);
    expect(outward(new GeoBuilder().push().scale(-1, 1, 1).skin([ring(2, 1), ring(0, 1.4), ring(-3, 0.8)], { caps: true }).pop(), o)).toBe(true);
  });

  it('a lathe wall listed top → bottom faces the axis (atrium interiors)', () => {
    const { pos, nrm } = new GeoBuilder().lathe(0, 0, [[10, 5], [10, 0]], 16).raw();
    for (let i = 0; i < pos.length; i += 3) expect(pos[i] * nrm[i] + pos[i + 2] * nrm[i + 2]).toBeLessThan(0);
  });
});

describe('option sanitiser', () => {
  it('forces finite numbers into range', () => {
    expect(num(Number.NaN, 7, 0, 10)).toBe(7);
    expect(num(Number.POSITIVE_INFINITY, 7, 0, 10)).toBe(7);
    expect(num('12', 7, 0, 10)).toBe(7);
    expect(num(null, 7, 0, 10)).toBe(7);
    expect(num(99, 7, 0, 10)).toBe(10);
    expect(num(-99, 7, 0, 10)).toBe(0);
  });

  it('lancet arches spring at the half width and meet at the apex, round or pointed', () => {
    for (const rise of [0.6, 1, 1.9]) {
      expect(lancet(0, 2, 2 * rise)[0]).toBeCloseTo(2, 6);
      expect(lancet(0, 2, 2 * rise)[1]).toBeCloseTo(0, 6);
      expect(lancet(1, 2, 2 * rise)[0]).toBeCloseTo(0, 5);
      expect(lancet(1, 2, 2 * rise)[1]).toBeCloseTo(2 * rise, 5);
    }
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

  it('never throws on bad input: unknown preset, NaN, null, zero / negative dt', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sky = createSkySystem(fakeGame());
    const cam = new THREE.PerspectiveCamera();
    const c = sky.carrier;
    c.visible = true;
    c.setAnchor({ x: 5, y: 6, z: 7 }, 0.3);
    c.setProgress(0.5);
    const anchored = c.position.clone();
    expect(() => {
      sky.setPreset('nope' as SkyPreset);
      sky.setPreset('nope' as SkyPreset);
      sky.setPreset('battleCeiling', { blendSeconds: Number.NaN });
      sky.setBattleIntensity(Number.NaN);
      sky.setWoundActivity(7);
      sky.setBoundaryClosed(true, Number.NaN);
      sky.setHeading(Number.NaN);
      sky.impact({ dir: { x: Number.NaN, y: 0, z: 0 }, strength: Number.NaN });
      sky.impact(null as unknown as undefined);
      sky.impact();
      c.visible = true;
      c.setProgress(Number.NaN);
      c.setStabilized(Number.POSITIVE_INFINITY);
      c.setAnchor(null as unknown as { x: number; y: number; z: number });
      c.setAnchor(undefined as unknown as { x: number; y: number; z: number }, 1);
      c.setAnchor({ x: Number.NaN, y: 0, z: 0 });
      c.setAnchor({ x: 0, y: Number.POSITIVE_INFINITY, z: 0 }, Number.NaN);
      c.setAnchor({} as { x: number; y: number; z: number });
      sky.update(Number.NaN, cam);
      sky.update(-1, cam);
      sky.update(0, cam);
      sky.update(1 / 60, cam);
    }).not.toThrow();
    expect(sky.preset).toBe('battleCeiling');
    expect(warn.mock.calls.filter((w) => String(w[0]).includes('unknown preset')).length).toBe(1);
    expect(sky.woundActivity).toBeLessThanOrEqual(1);
    expect(sky.heading).toBe(0);
    // a bad anchor keeps the previous one (yaw 1 from the second call was finite and is applied): state stays finite
    for (const v of [c.position, c.forward, c.clipPoint, c.shadowFootprint.center, c.shadowFootprint.axis]) {
      expect(Number.isFinite(v.x + v.y + v.z)).toBe(true);
    }
    expect(Number.isFinite(c.shadow)).toBe(true);
    expect(Number.isFinite(c.shadowFootprint.halfLength + c.shadowFootprint.halfWidth)).toBe(true);
    expect(c.position.y).toBeCloseTo(anchored.y, 6); // still anchored at y = 6
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

  it('a snap preset is a cut: no battle light survives it, and the carrier stays with the Z05 sky', () => {
    const sky = createSkySystem(fakeGame());
    const cam = new THREE.PerspectiveCamera();
    sky.setPreset('battleCeiling');
    sky.setBattleIntensity(1);
    sky.carrier.visible = true;
    sky.carrier.setProgress(0.5);
    for (let i = 0; i < 600; i++) sky.update(1 / 60, cam);
    sky.impact({ strength: 1 });
    sky.update(1 / 60, cam);
    expect(sky.battleGlow.r + sky.battleGlow.g + sky.battleGlow.b).toBeGreaterThan(0);
    sky.setPreset('coreChamber'); // fleet 0, intensity 0
    expect(sky.battleGlow.r + sky.battleGlow.g + sky.battleGlow.b).toBe(0);
    expect(sky.carrier.visible).toBe(false);
    let after = 0;
    for (let i = 0; i < 240; i++) { sky.update(1 / 60, cam); after += sky.battleGlow.r + sky.battleGlow.g + sky.battleGlow.b; }
    expect(after).toBe(0);
    // battleCeiling itself keeps a carrier that was already shown
    sky.setPreset('battleCeiling');
    sky.carrier.visible = true;
    sky.setPreset('battleCeiling', { blendSeconds: 2 });
    expect(sky.carrier.visible).toBe(true);
  });

  it('the Wound contracts with its activity, and both Wound setters can snap (explicitly, or during a skip / load)', () => {
    expect(woundScale(0.3)).toBeCloseTo(1, 6);
    expect(woundScale(0.05)).toBeLessThan(0.85);
    expect(woundScale(0)).toBeCloseTo(WOUND_SCALE_MIN, 6);
    expect(WOUND_SCALE_MIN).toBeLessThanOrEqual(0.8);
    expect(woundScale(1)).toBeGreaterThan(1);
    expect(Number.isFinite(woundScale(Number.NaN))).toBe(true);
    const cam = new THREE.PerspectiveCamera();
    const sky = createSkySystem(fakeGame());
    sky.setPreset('coreChamber');
    const dome = sky.root.getObjectByName('sky:dome') as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
    sky.setWoundActivity(0.3, { snap: true });
    expect(sky.woundActivity).toBe(0.3);
    expect(dome.material.uniforms.uWoundScale.value).toBeCloseTo(1, 6);
    expect(dome.material.uniforms.uWoundCore.value).toBeCloseTo(SKY_PRESETS.coreChamber.woundCore, 6);
    // eased by default…
    sky.setWoundActivity(0.05);
    sky.update(1 / 60, cam);
    expect(sky.woundActivity).toBeGreaterThan(0.2);
    // …but a snap lands at once, scale included
    sky.setWoundActivity(0.05, { snap: true });
    expect(sky.woundActivity).toBe(0.05);
    expect(dome.material.uniforms.uWoundScale.value).toBeLessThan(0.85);
    sky.setBoundaryClosed(true, 4, { snap: true });
    expect(sky.boundaryClosed).toBe(1);
    sky.setBoundaryClosed(false, 4);
    sky.update(1 / 60, cam);
    expect(sky.boundaryClosed).toBeGreaterThan(0.9);
    // a skipped cinematic (or a zone load) fast-forwards: the setters snap without being asked
    const mission = { loading: false, runtime: { skipping: true } };
    const ff = createSkySystem(fakeGame({ mission }));
    ff.setPreset('coreChamber');
    ff.setWoundActivity(0.02);
    expect(ff.woundActivity).toBe(0.02);
    ff.setBoundaryClosed(true, 4);
    expect(ff.boundaryClosed).toBe(1);
    mission.runtime.skipping = false;
    mission.loading = true;
    ff.setWoundActivity(0.4);
    expect(ff.woundActivity).toBe(0.4);
    mission.loading = false;
    ff.setWoundActivity(0.1);
    expect(ff.woundActivity).toBe(0.4);
  });

  it('a quiet battle is visibly quieter than a hot one (fewer streaks, softer flashes)', () => {
    const glowAt = (k: number): number => {
      const sky = createSkySystem(fakeGame());
      const cam = new THREE.PerspectiveCamera();
      sky.setPreset('breachDeep');
      sky.setBattleIntensity(k);
      let sum = 0;
      for (let i = 0; i < 1800; i++) { sky.update(1 / 60, cam); sum += sky.battleGlow.r + sky.battleGlow.g + sky.battleGlow.b; }
      return sum;
    };
    const hot = glowAt(0.7), quiet = glowAt(0.12);
    expect(hot).toBeGreaterThan(0);
    expect(quiet).toBeLessThan(hot * 0.35);
  });

  it('reset() returns to the neutral start state', () => {
    const sky = createSkySystem(fakeGame());
    const cam = new THREE.PerspectiveCamera();
    sky.setPreset('battleCeiling');
    sky.setHeading(1.2);
    sky.setBoundaryClosed(true, 0);
    sky.carrier.visible = true;
    sky.carrier.setStabilized(0.7);
    sky.carrier.setProgress(0.9);
    sky.update(1 / 60, cam);
    sky.reset();
    expect(sky.preset).toBe('void');
    expect(sky.heading).toBe(0);
    expect(sky.boundaryClosed).toBe(0);
    expect(sky.carrier.visible).toBe(false);
    expect(sky.carrier.progress).toBe(0);
    expect(sky.carrier.stabilized).toBe(0);
    expect(sky.carrier.shadow).toBe(0);
  });

  it('follows the render quality profile and tolerates a missing one', () => {
    const cam = new THREE.PerspectiveCamera();
    for (const [level, want] of [['low', 0], ['medium', 1], ['high', 2], ['ultra', 2], ['bogus', 2]] as const) {
      const quality = { level: level as string };
      const sky = createSkySystem(fakeGame({ render: { quality } }));
      sky.update(1 / 60, cam);
      const dome = sky.root.getObjectByName('sky:dome') as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
      // each tier is its own compiled program (the cheap tiers do not contain the expensive code at all)
      expect(dome.material.defines.SKY_DETAIL, level).toBe(want);
      // a small secondary target (reflection / PMREM face) also drops the fine detail at run time
      const renderer = { getRenderTarget: (): unknown => null, getDrawingBufferSize: (v: THREE.Vector2) => v.set(1280, 720), capabilities: { reversedDepthBuffer: false } };
      const draw = (r: unknown): void => dome.onBeforeRender(r as THREE.WebGLRenderer, new THREE.Scene(), cam, dome.geometry, dome.material, null as unknown as THREE.Group);
      draw(renderer);
      expect(dome.material.uniforms.uLite.value).toBe(0);
      draw({ ...renderer, getRenderTarget: () => ({ width: 256, height: 256 }) });
      expect(dome.material.uniforms.uLite.value).toBe(1);
      // the profile can change at run time (settings, the auto-quality governor)
      quality.level = 'low';
      sky.update(1 / 60, cam);
      expect(dome.material.defines.SKY_DETAIL).toBe(0);
    }
    expect(() => createSkySystem(fakeGame()).update(1 / 60, cam)).not.toThrow();
  });
});

describe('carrier', () => {
  const up = new THREE.Vector3(0, 1, 0);
  /** is any part of the tower between heights y0..y1 inside the hull? (tower = vertical solid of revolution) */
  const towerHits = (c: Carrier, y0: number, y1: number): boolean => {
    c.object.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(c.object.matrixWorld).invert();
    const p = new THREE.Vector3();
    for (let y = y0; y <= y1; y += 2) {
      const r = clipTowerRadius(y);
      for (let k = 0; k < 9; k++) {
        const a = (k / 8) * Math.PI * 2, rr = k === 8 ? 0 : r;
        p.set(CLIP_TOWER.x + Math.cos(a) * rr, y, CLIP_TOWER.z + Math.sin(a) * rr).applyMatrix4(inv);
        if (insideHull(c.hullProxy, p.x, p.y, p.z)) return true;
      }
    }
    return false;
  };

  it('keeps position current along the pass and reaches the tower at clipProgress', () => {
    const sky = createSkySystem(fakeGame());
    const c = sky.carrier;
    expect(c.visible).toBe(false);
    expect(c.clipProgress).toBe(0.8);
    c.visible = true;
    c.setStabilized(1);
    c.setProgress(CLIP_TOWER.progress);
    expect(c.progress).toBe(0.8);
    expect(c.position.distanceTo(c.object.position)).toBe(0);
    expect(c.clipPoint.toArray()).toEqual([CLIP_TOWER.x, CLIP_TOWER.cut, CLIP_TOWER.z]);
    // first contact is a BOW strike: the hull centre is still half a ship's length short of the tower, flying level
    const flat = Math.hypot(c.position.x - c.clipPoint.x, c.position.z - c.clipPoint.z);
    expect(flat).toBeGreaterThan(c.length / 2 - 6);
    expect(flat).toBeLessThan(c.length / 2 + 12);
    expect(Math.abs(c.forward.y)).toBeLessThan(0.01);
    expect(c.forward.length()).toBeCloseTo(1, 6);
    // after the clip it goes down into the distortion, nose-down — barely at first, steeply by the end
    const atClip = c.position.y;
    c.setProgress(0.86);
    expect(atClip - c.position.y).toBeLessThan(15);
    c.setProgress(0.97);
    expect(c.forward.y).toBeLessThan(-0.5);
    c.setProgress(5);
    expect(c.progress).toBe(1);
    expect(atClip - c.position.y).toBeGreaterThan(500);
    const far = c.position.clone();
    c.setProgress(0.2);
    expect(c.position.distanceTo(far)).toBeGreaterThan(800);
  });

  it('nothing touches the tower before the clip, the bow ram strikes the needle at 0.8, the stump stays clear after', () => {
    const sky = createSkySystem(fakeGame());
    const cam = new THREE.PerspectiveCamera();
    const c = sky.carrier as Carrier;
    for (const stab of [0, 0.5, 1]) {
      for (const clock of [0, 2.9, 7.3]) {
        c.reset();
        sky.update(clock, cam); // the unstabilised wander depends on the sim clock
        sky.update(clock, cam);
        c.setStabilized(stab);
        // (carrier hidden: crossings are "skips", which is fine — this test is about geometry)
        for (let p = 0; p <= 0.796; p += 0.002) {
          c.setProgress(p);
          expect(towerHits(c, 150, CLIP_TOWER.top), `early contact at p=${p.toFixed(3)} stab=${stab} clock=${clock}`).toBe(false);
        }
        let struck = false;
        for (let p = 0.797; p <= 0.812; p += 0.001) {
          c.setProgress(p);
          struck = struck || towerHits(c, CLIP_TOWER.cut + 1, CLIP_TOWER.top);
        }
        expect(struck, `ram meets the needle near 0.8 (stab=${stab} clock=${clock})`).toBe(true);
        for (let p = 0.8; p <= 1.0001; p += 0.002) {
          c.setProgress(Math.min(p, 1));
          expect(towerHits(c, 150, CLIP_TOWER.cut), `stump inside the hull at p=${p.toFixed(3)} stab=${stab} clock=${clock}`).toBe(false);
        }
      }
    }
  });

  it('a played clip fires onClip once and keeps animating on the sim clock while progress is held', () => {
    const sky = createSkySystem(fakeGame());
    const cam = new THREE.PerspectiveCamera();
    sky.setPreset('battleCeiling');
    const tip = sky.scenic.atriumShell().getObjectByName('scenic:atriumShell:clipTip') as THREE.Object3D;
    const c = sky.carrier;
    const hits: THREE.Vector3[] = [];
    c.onClip = (p) => hits.push(p.clone());
    c.visible = true;
    for (let p = 0.7; p < 0.8005; p += 0.002) { c.setProgress(p); sky.update(1 / 60, cam); }
    expect(hits.length).toBe(1);
    expect(hits[0].distanceTo(c.clipPoint)).toBe(0);
    expect(tip.visible).toBe(true);
    // the script now HOLDS progress: the sheared needle must keep falling
    const y0 = tip.position.y;
    for (let i = 0; i < 120; i++) sky.update(1 / 60, cam);
    const y1 = tip.position.y;
    for (let i = 0; i < 120; i++) sky.update(1 / 60, cam);
    expect(y1).toBeLessThan(y0 - 5);
    expect(tip.position.y).toBeLessThan(y1 - 20);
    expect(sky.root.getObjectByName('sky:carrierSparks')?.visible).toBe(true);
    // paused sim (dt = 0): nothing moves
    const held = tip.position.y;
    sky.update(0, cam);
    expect(tip.position.y).toBe(held);
    // rewinding restores the tower; replaying fires again
    c.setProgress(0.7);
    expect(tip.position.y).toBe(CLIP_TOWER.cut);
    expect(tip.rotation.x).toBe(0);
    c.setProgress(0.72);
    for (let p = 0.74; p < 0.81; p += 0.01) c.setProgress(p);
    expect(hits.length).toBe(2);
  });

  it('a skip / load past the clip lands with the needle gone and no effects', () => {
    const sky = createSkySystem(fakeGame());
    const cam = new THREE.PerspectiveCamera();
    sky.setPreset('battleCeiling');
    const tip = sky.scenic.atriumShell().getObjectByName('scenic:atriumShell:clipTip') as THREE.Object3D;
    const c = sky.carrier;
    let clips = 0;
    c.onClip = () => { clips++; };
    c.visible = true;
    c.setProgress(0.3);
    c.setProgress(0.95); // cinematic skip
    sky.update(1 / 60, cam);
    expect(clips).toBe(0);
    expect(tip.visible).toBe(false);
    expect(sky.root.getObjectByName('sky:carrierSparks')?.visible).toBe(false);
    // a shell built afterwards (zone reload at a later checkpoint) picks the same state up
    const tip2 = sky.scenic.atriumShell().getObjectByName('scenic:atriumShell:clipTip') as THREE.Object3D;
    sky.update(1 / 60, cam);
    expect(tip2.visible).toBe(false);
    sky.reset();
    expect(tip2.visible).toBe(true);
  });

  it('two sky systems do not share tower needles', () => {
    const a = createSkySystem(fakeGame()), b = createSkySystem(fakeGame());
    const tipA = a.scenic.atriumShell().getObjectByName('scenic:atriumShell:clipTip') as THREE.Object3D;
    const tipB = b.scenic.atriumShell().getObjectByName('scenic:atriumShell:clipTip') as THREE.Object3D;
    b.carrier.setProgress(0.9);
    expect(tipB.visible).toBe(false);
    expect(tipA.visible).toBe(true);
  });

  it('setAnchor moves and rotates the whole pass', () => {
    const sky = createSkySystem(fakeGame());
    const c = sky.carrier;
    c.setStabilized(1);
    c.setProgress(0.5);
    const base = c.position.clone();
    c.setAnchor({ x: 100, y: 10, z: -50 }, Math.PI);
    const want = base.clone().applyAxisAngle(up, Math.PI).add(new THREE.Vector3(100, 10, -50));
    expect(c.position.distanceTo(want)).toBeLessThan(1e-6);
  });

  it('casts its shadow across the atrium around the clip, with a usable footprint', () => {
    const sky = createSkySystem(fakeGame());
    const cam = new THREE.PerspectiveCamera();
    sky.setPreset('battleCeiling');
    const c = sky.carrier;
    c.setStabilized(1);
    c.setProgress(0.05);
    sky.update(1 / 60, cam);
    expect(c.shadow).toBe(0); // hidden
    expect(c.shadowFootprint.halfLength).toBe(0);
    c.visible = true;
    sky.update(1 / 60, cam);
    expect(c.shadow).toBe(0); // far away
    let peak = 0, at = 0;
    for (let p = 0.4; p <= 1; p += 0.005) {
      c.setProgress(p);
      sky.update(1 / 60, cam);
      expect(c.shadow).toBeGreaterThanOrEqual(0);
      expect(c.shadow).toBeLessThanOrEqual(1);
      if (c.shadow > peak) { peak = c.shadow; at = p; }
    }
    expect(peak).toBeGreaterThan(0.9);
    expect(at).toBeGreaterThan(0.7);
    expect(at).toBeLessThan(0.9); // darkest around the clip (see the api note on `shadow`)
    c.setProgress(0.8);
    sky.update(1 / 60, cam);
    const f = c.shadowFootprint;
    expect(f.center.y).toBe(0);
    expect(f.axis.length()).toBeCloseTo(1, 6);
    expect(f.halfLength).toBeGreaterThan(c.length / 2 - 1);
    expect(f.halfWidth).toBeGreaterThan(40);
    expect(f.halfWidth).toBeLessThan(120);
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
  /** every vertex / instance position of every mesh is a finite number */
  const finiteGeometry = (o: THREE.Object3D): boolean => {
    let ok = true;
    o.traverse((c) => {
      const m = c as THREE.Mesh;
      if (!m.isMesh) return;
      for (const name of ['position', 'normal', 'iPos', 'iSize']) {
        const a = m.geometry.getAttribute(name);
        if (!a) continue;
        const arr = a.array as ArrayLike<number>;
        for (let i = 0; i < arr.length; i++) if (!Number.isFinite(arr[i])) { ok = false; return; }
      }
    });
    return ok;
  };

  it('every piece stays within 12 draw calls and its triangle budget', () => {
    const f = createSkySystem(fakeGame()).scenic;
    // [name, piece, at least, at most] — floors guard against a piece silently collapsing to a blockout again
    const pieces: Array<[string, THREE.Object3D, number, number]> = [
      ['terminalVista', f.terminalVista(), 70000, 320000],
      ['atriumShell', f.atriumShell(), 100000, 260000],
      ['crownmarkArm', f.crownmarkArm(), 12000, 120000],
      ['megaRibs', f.megaRibs(), 12000, 60000],
      ['dominionShuttle', f.ship('dominionShuttle'), 7000, 45000],
      ['reformationTransport', f.ship('reformationTransport'), 7000, 45000],
      ['dominionCapital', f.ship('dominionCapital'), 500, 12000],
      ['reformationCapital', f.ship('reformationCapital'), 500, 12000],
      ['wreck dominion', f.wreck('dominion'), 4000, 45000],
      ['wreck reformation', f.wreck('reformation'), 4000, 45000],
    ];
    for (const [name, o, min, max] of pieces) {
      expect(drawCalls(o), name).toBeGreaterThan(0);
      expect(drawCalls(o), name).toBeLessThanOrEqual(12);
      expect(triangles(o), name).toBeGreaterThan(min);
      expect(triangles(o), name).toBeLessThan(max);
      expect(finiteGeometry(o), name).toBe(true);
    }
  });

  it('is deterministic per seed and honours options', () => {
    const f = createSkySystem(fakeGame()).scenic;
    const a = f.megaRibs({ count: 3 }), b = f.megaRibs({ count: 3 }), c = f.megaRibs({ count: 6 });
    expect(triangles(a)).toBe(triangles(b));
    expect(triangles(c)).toBeGreaterThan(triangles(a));
    expect(triangles(f.terminalVista({ corridor: 600 }))).toBeLessThan(triangles(f.terminalVista()));
    expect(f.ship('dominionShuttle', { scale: 2 }).scale.x).toBe(2);
    expect(triangles(f.atriumShell({ tiers: 2 }))).toBeLessThan(triangles(f.atriumShell({ tiers: 5 })));
  });

  it('falls back instead of throwing, hanging or emitting NaN on unknown kinds and absurd options', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const f = createSkySystem(fakeGame()).scenic;
    const N = Number.NaN, I = Number.POSITIVE_INFINITY;
    const nil = null as unknown as undefined;
    const built: Array<[string, THREE.Object3D]> = [];
    expect(() => {
      built.push(['ship yacht', f.ship('yacht' as 'dominionShuttle')]);
      built.push(['ship NaN', f.ship('dominionShuttle', { scale: N })]);
      built.push(['ship null', f.ship('reformationTransport', nil)]);
      built.push(['capital -1', f.ship('dominionCapital', { scale: -1 })]);
      built.push(['wreck pirate', f.wreck('pirate' as 'dominion')]);
      built.push(['wreck NaN', f.wreck('reformation', { scale: I, seed: N })]);
      built.push(['ribs abs', f.megaRibs({ count: -4, span: N, height: 0, spacing: -1 })]);
      built.push(['ribs inf', f.megaRibs({ count: I, span: I, height: I, spacing: I, seed: I })]);
      built.push(['ribs null', f.megaRibs(nil)]);
      built.push(['atrium abs', f.atriumShell({ radius: 1, height: 1, shaftRadius: 9999, tiers: 99 })]);
      built.push(['atrium nan', f.atriumShell({ radius: N, height: N, shaftRadius: N, tiers: N, seed: N })]);
      built.push(['atrium inf', f.atriumShell({ radius: I, height: I, shaftRadius: I, tiers: I })]);
      built.push(['atrium null', f.atriumShell(nil)]);
      built.push(['vista abs', f.terminalVista({ radius: -5, density: 99 })]);
      built.push(['vista nan', f.terminalVista({ radius: N, density: N, drop: N, corridor: N, seed: N })]);
      built.push(['vista inf', f.terminalVista({ radius: I, density: I, drop: I, corridor: I })]);
      built.push(['vista null', f.terminalVista(nil)]);
      built.push(['arm abs', f.crownmarkArm({ length: 0, width: 0 })]);
      built.push(['arm nan', f.crownmarkArm({ length: N, width: N, drop: N, seed: N })]);
      built.push(['arm inf', f.crownmarkArm({ length: I, width: I, drop: I })]);
      built.push(['arm null', f.crownmarkArm(nil)]);
    }).not.toThrow();
    for (const [name, o] of built) {
      expect(triangles(o), name).toBeGreaterThan(0); // a real piece, not the empty fallback group
      expect(finiteGeometry(o), name).toBe(true);
    }
    expect(err).not.toHaveBeenCalled(); // three.js reports NaN bounding spheres through console.error
    warn.mockRestore();
    err.mockRestore();
  });

  it('nothing shines inside the Wound: no vista / arm light card projects into the disc from the overlook', () => {
    const f = createSkySystem(fakeGame()).scenic;
    const cone = woundCone();
    for (const [name, o] of [
      ['terminalVista', f.terminalVista()], ['terminalVista+corridor', f.terminalVista({ corridor: 640 })], ['crownmarkArm', f.crownmarkArm()],
    ] as const) {
      let cards = 0, inside = 0;
      o.traverse((c) => {
        const a = (c as THREE.Mesh).isMesh ? (c as THREE.Mesh).geometry.getAttribute('iPos') : null;
        if (!a) return;
        for (let i = 0; i < a.count; i++) {
          cards++;
          if (insideWound(cone, a.getX(i), a.getY(i), a.getZ(i), 1)) inside++;
        }
      });
      expect(cards, name).toBeGreaterThan(200);
      expect(inside, name).toBe(0);
      // …and no emissive surface (light seam, channel) or lit-window face either
      let glowing = 0;
      o.traverse((c) => {
        const g = (c as THREE.Mesh).isMesh ? (c as THREE.Mesh).geometry : null;
        const glow = g?.getAttribute('aGlow'), lit = g?.getAttribute('aLight'), pos = g?.getAttribute('position');
        if (!g || !glow || !lit || !pos) return;
        for (let i = 0; i < pos.count; i++) {
          if ((glow.getX(i) > 0.05 || lit.getZ(i) > 0.02) && insideWound(cone, pos.getX(i), pos.getY(i), pos.getZ(i), 1)) glowing++;
        }
      });
      expect(glowing, name).toBe(0);
    }
    // …and no structure at all stands inside the disc: spires in its azimuth band are capped under the lower limb,
    // so the silhouette is never cut (the accretion swirl beyond the rim may sink behind them)
    for (const [name, o] of [['terminalVista', f.terminalVista({ corridor: 640 })], ['crownmarkArm', f.crownmarkArm()]] as const) {
      let inDisc = 0;
      o.traverse((c) => {
        const m = c as THREE.Mesh;
        const pos = m.isMesh && !m.geometry.getAttribute('iPos') ? m.geometry.getAttribute('position') : null;
        if (pos) for (let i = 0; i < pos.count; i++) if (insideWound(cone, pos.getX(i), pos.getY(i), pos.getZ(i), 1)) inDisc++;
      });
      expect(inDisc, name).toBe(0);
    }
    // the rule is opt-out for other skies
    let lit = 0;
    f.terminalVista({ clearWound: false }).traverse((c) => {
      const a = (c as THREE.Mesh).isMesh ? (c as THREE.Mesh).geometry.getAttribute('iPos') : null;
      if (a) for (let i = 0; i < a.count; i++) if (insideWound(cone, a.getX(i), a.getY(i), a.getZ(i), 1)) lit++;
    });
    expect(lit).toBeGreaterThan(0);
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

describe('polish pass 4: generated ships in the sky, the slate night', () => {
  it('the fleet impostors are the generated capitals, with the procedural hulls as the fallback', () => {
    const gen = createFleet(createSharedUniforms(), 7283);
    expect(gen.generated).toBe(true);
    const proc = createFleet(createSharedUniforms(), 7283, { procedural: true });
    expect(proc.generated).toBe(false);
    // same layout either way; lights at the generated files' real engines and running lights
    expect(gen.ships.length).toBe(proc.ships.length);
    const dom = gen.ships.find((sh) => sh.faction === 0)!;
    const ref = gen.ships.find((sh) => sh.faction === 1)!;
    const count = (sh: typeof dom, engine: boolean): number => sh.lights.filter((l) => l.engine === engine).length;
    expect(count(dom, true)).toBe(GENERATED_CAPITAL_LIGHTS.dominionCapital.engines.length);
    expect(count(ref, true)).toBe(GENERATED_CAPITAL_LIGHTS.reformationCapital.engines.length);
    expect(count(ref, false)).toBe(GENERATED_CAPITAL_LIGHTS.reformationCapital.running.length);
    for (const sh of gen.ships) for (const l of sh.lights) expect(Number.isFinite(l.x + l.y + l.w)).toBe(true);
    const idx = gen.mesh.geometry.getIndex()!;
    expect(idx.count).toBeGreaterThan(3000);
    for (const v of gen.mesh.geometry.getAttribute('aLocal').array as Float32Array) expect(Number.isFinite(v)).toBe(true);
    gen.dispose(); proc.dispose();
  });

  it('the generated carrier sits on the procedural ram: nothing lower, its lower bow at the ram face, its prow clear of the needle', () => {
    const o = CARRIER_MODEL_OFFSET;
    expect(o.scale).toBeCloseTo(HULL_LENGTH / 500, 9);
    const sil = silhouette('reformationCarrier');
    let lowest = Infinity, front = Infinity;
    // the needle's tip in the hull frame at first contact (centre at collar + clearance − ram bottom), with the
    // unstabilised nose-down pitch (0.06 rad) and a margin
    const needleTop = CLIP_TOWER.top - (CLIP_TOWER.cut + 22 - RAM_BOTTOM);
    for (let i = 0; i < sil.pos.length; i += 3) {
      const y = sil.pos[i + 1] * o.scale + o.y, z = sil.pos[i + 2] * o.scale + o.z;
      lowest = Math.min(lowest, y);
      if (y <= RAM_TOP - 2) front = Math.min(front, z);
      // anything ahead of the ram's face rides above the needle's tip even pitched nose-down
      if (z < BOW_Z - 0.5) expect(y - Math.sin(0.06) * Math.abs(z), `vertex ${i / 3}`).toBeGreaterThan(needleTop + 1);
    }
    expect(lowest).toBeGreaterThanOrEqual(RAM_BOTTOM);
    expect(lowest).toBeLessThan(RAM_BOTTOM + 2);
    expect(front).toBeCloseTo(BOW_Z, 6);
  });

  it('the overlook night is darker and slate, the remnants and the Wound untouched by it', () => {
    const s = new SkyState().setFromDef(SKY_PRESETS.woundVista);
    const t = s.skyTint;
    expect(Math.max(t.r, t.g, t.b)).toBeLessThan(0.7);
    expect(t.g).toBeGreaterThan(t.r * 1.15);
    expect(t.g).toBeGreaterThan(t.b);
    for (const id of SKY_PRESET_IDS.filter((i) => i !== 'woundVista')) {
      const o = new SkyState().setFromDef(SKY_PRESETS[id]).skyTint;
      expect([o.r, o.g, o.b], id).toEqual([1, 1, 1]);
    }
    // only the empty sky is tinted: applied before the red remnant is added and before the Wound is composited
    const at = DOME_FRAGMENT.indexOf('col *= uSkyTint;');
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(DOME_FRAGMENT.indexOf('col += red.rgb * uRedGain;'));
    expect(at).toBeLessThan(DOME_FRAGMENT.indexOf('col = woundComposite('));
    const mid = blendSkyStates(new SkyState().setFromDef(SKY_PRESETS.hangar), s, 0.5, new SkyState());
    expect(mid.skyTint.g).toBeCloseTo((1 + t.g) / 2, 9);
  });

  it('the funnel wall is grooved in concentric arcs, the violet stays lavender at full activity, the crackle is soft', () => {
    // fine radial ripples (≈ 23 per radius), barely spiralling, broken into long arcs
    expect(DOME_FRAGMENT).toMatch(/vec2 fd = rot2\(dir, 0\.35 \* lr/);
    expect(DOME_FRAGMENT).toMatch(/rho \* 23\.0/);
    expect(DOME_FRAGMENT).toMatch(/float arcs = /);
    // the lining's streaks are those grooves, not a steep spiral
    expect(DOME_FRAGMENT).toMatch(/fdr = mix\(0\.5, fsk, /);
    expect(WOUND_LOOK.rings).toBeGreaterThan(0.7);
    // the violet's growth with the activity is held back, and turns lavender-grey as it grows
    expect(DOME_FRAGMENT).toMatch(/float vio = \(0\.4\d? \+ 0\.4 \* act\)/);
    expect(DOME_FRAGMENT).toMatch(/mix\(LAVVIO, LAVGREY, 0\.25 \+ 0\.3 \* act\)/);
    // the lip filament is a soft vein on the rock, not a lightning bolt
    expect(DOME_FRAGMENT).toMatch(/glow \+= c \* flick \* 0\.2\d? \* \(0\.35 \+ 0\.65 \* matter\)/);
    // loose chunks: clumped, in cells of at least a fifth of a radius at medium and up (not confetti)
    expect(DOME_FRAGMENT).toMatch(/float clump = /);
    expect(DOME_FRAGMENT).toMatch(/const float CELL = 0\.24, CFILL = 0\.7, CAA = 1\.0;/);
    expect(DOME_FRAGMENT).toMatch(/splatRock\(cq \/ CELL, fl \* CFILL, 0\.2, 23\.0, CAA \* pxn \/ CELL, dq\)/);
    expect(DOME_FRAGMENT).not.toMatch(/cq \/ 0\.07/);
  });

  it('(fix & ship) low is a simplified medium: smaller soft chunks, a rotated two-octave ink field with erosion, wider AA', () => {
    const low = DOME_FRAGMENT.slice(DOME_FRAGMENT.indexOf('float chunk = 0.5;'));
    // the low branch's ink field: two octaves on a rotated lattice (no single unrotated octave → no square blots)
    expect(low).toMatch(/float sp = fbm2\(FBM_ROT \* vec3\(pc \* 4\.6, 11\.0\)\);/);
    expect(low).toMatch(/float ero = vnoise\(FBM_ROT \* vec3\(pc \* 11\.0, 21\.0\)\);/);
    expect(DOME_FRAGMENT).not.toMatch(/float sp = vnoise\(vec3\(pc \* 6\.5/);
    // a wider anti-aliased ink edge below medium
    expect(DOME_FRAGMENT).toMatch(/#else\s+float aaI = max\(fwidth\(inkF\) \* 1\.5, 0\.012\);/);
    // one layer of loose chunks in smaller cells (0.15 R, not 0.24), sparser, with a softer edge
    expect(DOME_FRAGMENT).toMatch(/const float CELL = 0\.15, CFILL = 0\.5, CAA = 1\.8;/);
  });
});

describe('(fix & ship) zone sky balance', () => {
  it('multiplies the preset over its crossfades, only for the zone that set it, and a reset clears it', async () => {
    const { setSkyBalance } = await import('./index');
    const sky = createSkySystem(fakeGame());
    sky.setPreset('woundVista');
    sky.update(0.016, new THREE.PerspectiveCamera());
    const base = sky.hazeColor.clone();
    expect(setSkyBalance(sky, { haze: [0.5, 1, 2], tint: 0xffffff })).toBe(true);
    sky.update(0.016, new THREE.PerspectiveCamera());
    expect(sky.hazeColor.r).toBeCloseTo(base.r * 0.5, 6);
    expect(sky.hazeColor.g).toBeCloseTo(base.g, 6);
    expect(sky.hazeColor.b).toBeCloseTo(base.b * 2, 6);
    // it survives a preset change (it is the zone's, not the preset's)…
    sky.setPreset('woundVista', { blendSeconds: 0 });
    sky.update(0.016, new THREE.PerspectiveCamera());
    expect(sky.hazeColor.b).toBeCloseTo(base.b * 2, 6);
    // …and is gone after the next zone load's reset
    sky.reset();
    sky.setPreset('woundVista');
    sky.update(0.016, new THREE.PerspectiveCamera());
    expect(sky.hazeColor.r).toBeCloseTo(base.r, 6);
    expect(sky.hazeColor.b).toBeCloseTo(base.b, 6);
    // garbage is ignored (white), and a non-engine sky is refused
    setSkyBalance(sky, { haze: [NaN, 1, 1] as unknown as [number, number, number] });
    sky.update(0.016, new THREE.PerspectiveCamera());
    expect(sky.hazeColor.r).toBeCloseTo(base.r, 6);
    expect(setSkyBalance({} as never, { haze: 0x808080 })).toBe(false);
    sky.dispose();
  });
});

describe('(fix & ship) the Z05 carrier loads lazily', () => {
  it('is not requested at boot nor under other skies; the battle sky, showing it or awaiting modelReady requests it', () => {
    const sky = createSkySystem(fakeGame());
    const c = sky.carrier as Carrier;
    expect(c.requested).toBe(false);
    expect(sky.root.getObjectByName('sky:carrierModel')).toBeUndefined();
    for (const p of ['crashRib', 'frozenInterior', 'woundVista'] as SkyPreset[]) {
      sky.setPreset(p);
      sky.update(0.016, new THREE.PerspectiveCamera());
    }
    expect(c.requested).toBe(false);
    sky.setPreset('battleCeiling');
    sky.update(0.016, new THREE.PerspectiveCamera());
    expect(c.requested).toBe(true);
    expect(sky.root.getObjectByName('sky:carrierModel')).toBeDefined();
    sky.dispose();

    const a = createSkySystem(fakeGame()).carrier as Carrier;
    expect(a.requested).toBe(false);
    a.visible = true;
    expect(a.requested).toBe(true);
    const b = createSkySystem(fakeGame()).carrier as Carrier;
    expect(b.requested).toBe(false);
    expect(b.modelReady).toBeInstanceOf(Promise);
    expect(b.requested).toBe(true);
  });

  it('is requested on entering Z04 or Z05 (by the mission\'s zone), not elsewhere', () => {
    for (const [id, want] of [['Z03', false], ['Z04', true], ['Z05', true], ['Z12', false]] as const) {
      const sky = createSkySystem(fakeGame({ mission: { currentZone: { id }, loading: false, runtime: null } }));
      sky.setPreset('frozenInterior');
      sky.update(0.016, new THREE.PerspectiveCamera());
      expect((sky.carrier as Carrier).requested, id).toBe(want);
      sky.dispose();
    }
  });
});

