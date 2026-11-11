/**
 * Polish 3 character options: localized frost, face-only / half-face corruption, the Witness without the halo,
 * the breath gesture, Verity collapsed in hand and its ignite cue, and the protagonist-strength rim flash.
 */
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { FigureUniforms } from './material';
import { createHumanoid } from './index';
import { HumanoidVisualImpl } from './visual';
import { FLASH_LIFT_FROM, HIT_FLASH_GLSL } from '../flash';
import { corruptionCode, frostCode } from '../regions';

const uniformsOf = (v: unknown): FigureUniforms => (v as { uniforms: FigureUniforms }).uniforms;

describe('polish 3 character options', () => {
  it('localized frost: a locked boot shows the region and leaves the figure free (no slowing)', () => {
    expect([frostCode(undefined), frostCode('body'), frostCode('lead'), frostCode('footL'), frostCode('footR'), frostCode('feet')]).toEqual([0, 0, 1, 1, 2, 3]);
    const free = createHumanoid(null, 'tarrik');
    const boot = createHumanoid(null, 'tarrik');
    for (const v of [free, boot]) v.setLocomotion(5, 0);
    boot.setFrozen(1, { region: 'lead' });
    expect(uniformsOf(boot).uFrozen.value).toBe(1);
    expect(uniformsOf(boot).uLocal.value.x).toBe(1);
    const a0 = free.socket('handL').getWorldPosition(new THREE.Vector3());
    const b0 = boot.socket('handL').getWorldPosition(new THREE.Vector3());
    for (let i = 0; i < 30; i++) { free.update(1 / 60); boot.update(1 / 60); }
    // the boot-locked figure animates exactly like a free one
    const a1 = free.socket('handL').getWorldPosition(new THREE.Vector3());
    const b1 = boot.socket('handL').getWorldPosition(new THREE.Vector3());
    expect(b1.clone().sub(b0).distanceTo(a1.clone().sub(a0))).toBeLessThan(1e-6);
    // whole-body frost (the default) arrests it, and resets the region
    boot.setFrozen(1);
    expect(uniformsOf(boot).uLocal.value.x).toBe(0);
    boot.update(1 / 60);
    const c = boot.socket('handL').getWorldPosition(new THREE.Vector3());
    for (let i = 0; i < 20; i++) boot.update(1 / 60);
    expect(boot.socket('handL').getWorldPosition(new THREE.Vector3()).distanceTo(c)).toBeLessThan(1e-4);
  });

  it('corruption modes: face only and half face are remembered; the face is measured from the rig', () => {
    expect([corruptionCode(undefined), corruptionCode('body'), corruptionCode('face'), corruptionCode('halfFace')]).toEqual([0, 0, 1, 2]);
    const v = createHumanoid(null, 'lyric');
    const u = uniformsOf(v);
    // eye centre in model space, a skull size, at a believable height for this figure
    expect(u.uFace.value.w).toBeGreaterThan(0.1);
    expect(u.uFace.value.y).toBeGreaterThan(1.4);
    expect(u.uFace.value.y).toBeLessThan(1.9);
    v.setCorruption(0.5, { mode: 'face' });
    expect([u.uCorruption.value, u.uLocal.value.y]).toEqual([0.5, 1]);
    v.setCorruption(0.8);
    expect([u.uCorruption.value, u.uLocal.value.y]).toEqual([0.8, 1]); // the mode stays until another is given
    v.setCorruption(0.8, { mode: 'halfFace', side: 'left' });
    expect([u.uLocal.value.y, u.uLocal.value.z]).toEqual([2, -1]);
    v.setCorruption(0.2, { mode: 'body' });
    expect(u.uLocal.value.y).toBe(0);
    // the linkbound whose face is half human: starts taken on its right half
    const lb = createHumanoid(null, 'linkbound', { halfHuman: true });
    expect([uniformsOf(lb).uCorruption.value, uniformsOf(lb).uLocal.value.y, uniformsOf(lb).uLocal.value.z]).toEqual([1, 2, 1]);
    // ignored elsewhere
    expect(uniformsOf(createHumanoid(null, 'tharne', { halfHuman: true })).uLocal.value.y).toBe(0);
  });

  it('the Witness can be drawn without the King\'s halo (Vesryn)', () => {
    const king = createHumanoid(null, 'kingWitness');
    const vesryn = createHumanoid(null, 'kingWitness', { halo: false });
    expect(vesryn.triangles).toBeLessThan(king.triangles - 200);
    expect(vesryn.height).toBeCloseTo(king.height, 6);
    // other archetypes ignore it
    expect(createHumanoid(null, 'tarrik', { halo: false }).triangles).toBe(createHumanoid(null, 'tarrik').triangles);
  });

  it('breath, verityCollapsed and igniteBlades are authored clips', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const t = createHumanoid(null, 'tharne');
      const b = t.play('breath');
      expect(b.duration).toBeGreaterThan(2.5);
      expect(b.loop).toBe(false);
      const s = createHumanoid(null, 'selene');
      expect(s.play('verityCollapsed').loop).toBe(false);
      expect(s.play('igniteBlades').hitTimes.length).toBe(1);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('Verity collapsed in hand: held, blades in; ignite draws it, the blades come out and flare', () => {
    const s = createHumanoid(null, 'selene') as HumanoidVisualImpl;
    const acc = s.retargetAccess();
    const blade = (): number => acc.rig.byName.bladeA.scale.z;
    s.setLoadout({ melee: false });
    for (let i = 0; i < 60; i++) s.update(1 / 60);
    expect(acc.equip.meleeHeld).toBe(false);
    s.play('verityCollapsed');
    for (let i = 0; i < 60; i++) s.update(1 / 60);
    expect(acc.equip.meleeHeld).toBe(true); // in the hand …
    expect(blade()).toBeLessThan(0.05); // … with the blades drawn in
    s.stop('verityCollapsed');
    for (let i = 0; i < 60; i++) s.update(1 / 60);
    expect(acc.equip.meleeHeld).toBe(false); // the loadout said sheathed: back to the hip
    expect(s.bladeFlare).toBe(0);
    s.play('igniteBlades');
    let peak = 0;
    for (let i = 0; i < 40; i++) { s.update(1 / 60); peak = Math.max(peak, s.bladeFlare); }
    expect(peak).toBeGreaterThan(0.5);
    expect(acc.equip.meleeHeld).toBe(true);
    expect(blade()).toBeGreaterThan(0.6);
    for (let i = 0; i < 90; i++) s.update(1 / 60);
    expect(s.bladeFlare).toBe(0);
  });

  it('a protagonist-strength flash is a rim only: no albedo lift below the threshold', () => {
    // the GLSL lift term is gated by smoothstep(FLASH_LIFT_FROM, 1, a): evaluate the same curve here
    const smooth = (a: number, b: number, x: number): number => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    expect(HIT_FLASH_GLSL).toContain(`smoothstep( ${FLASH_LIFT_FROM.toFixed(2)}, 1.0, a )`);
    for (const a of [0.4, 0.55, 0.6]) expect(a * smooth(FLASH_LIFT_FROM, 1, a) * 1.25).toBe(0);
    expect(1 * smooth(FLASH_LIFT_FROM, 1, 1) * 1.25).toBeCloseTo(1.25, 6); // an enemy's confirm is unchanged
  });
});
