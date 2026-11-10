/**
 * The floor is real: device wreckage comes to rest ON it, no action drives a body through it, planted feet do
 * not slide, and a creature turning in place steps round instead of spinning on the spot. All measured on the
 * CPU-skinned surface (testkit.skinnedBounds), not on bone positions.
 */
import { afterAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { CharacterVisual, DeviceArchetype } from '@/core/api';
import { asDrone, asElite, CREATURE_ACTIONS } from '@/core/api/creatures';
import { createCreature } from './index';
import { disposeTemplates } from './core/rig';
import { mesh, run, skinnedBounds, STEP, sunk } from './testkit';

afterAll(() => disposeTemplates());

/** how far below the floor a pose may dip before it counts as a visible error (metres) */
const TOLERANCE = 0.06;

describe('device destruction', () => {
  const devices: [DeviceArchetype, number][] = [['commandEmitter', 0], ['relayReceiver', 0], ['relayReceiver', 1], ['scanHead', 0], ['weaverAnchor', 0], ['frostAnchor', 0]];
  /** bones that are thrown, per device — everything else is the base that stays put */
  const thrown: Record<string, RegExp> = {
    commandEmitter: /^(hub|crown|prong[LR]|leg\d)$/, relayReceiver: /^(mast|dish)$/, scanHead: /^(mast|yaw|head|bar|flap[LR])$/,
    weaverAnchor: /^cage\d$/, frostAnchor: /^cry\d$/,
  };

  it('wreckage never passes through the floor on the way down, and ends lying on it (5 seeds each)', () => {
    for (const [a, variant] of devices) {
      for (const seed of [1, 2, 3, 4, 5]) {
        const v = createCreature(null, a, { variant, seed });
        run(v, 0.3);
        v.play('death');
        let worst = 0, who: string[] = [];
        for (let t = 0; t < 4; t += 0.1) {
          run(v, 0.1);
          const b = skinnedBounds(v);
          if (b.min.y < worst) { worst = b.min.y; who = sunk(b, -0.03); }
        }
        expect(worst, `${a} seed ${seed}: ${who.join(' ')}`).toBeGreaterThanOrEqual(-0.03);
        // end pose: every thrown chunk touches the floor — nothing left hanging in the air
        const end = skinnedBounds(v);
        const lowest = new Map<string, number>();
        const m = mesh(v);
        for (const bone of m.skeleton.bones) {
          if (!thrown[a]!.test(bone.name)) continue;
          // a chunk is a thrown bone with no thrown ancestor that is ITS chunk root; group by nearest chunk root
          let root = bone.name;
          for (let o = bone.parent; o && (o as THREE.Bone).isBone; o = o.parent) if (/^(yaw)$/.test(o.name) && a === 'scanHead') root = o.name;
          const yMin = end.boneMinY.get(bone.name);
          if (yMin !== undefined) lowest.set(root, Math.min(lowest.get(root) ?? Infinity, yMin));
        }
        for (const [name, yMin] of lowest) expect(yMin, `${a} seed ${seed}: ${name} rests at ${yMin.toFixed(2)}`).toBeLessThan(0.3);
        v.dispose();
      }
    }
  }, 60000);

  it('wreck stays inside the culling sphere, and the oriented chunk boxes are tight', () => {
    for (const [a, variant] of devices) {
      const v = createCreature(null, a, { variant, seed: 3 });
      run(v, 0.2);
      v.play('death');
      run(v, 4);
      const b = skinnedBounds(v), s = mesh(v).boundingSphere!;
      const c = s.center.clone().applyMatrix4(mesh(v).matrixWorld);
      // every face of the debris field's box lies inside the sphere the renderer culls with
      for (const k of ['x', 'y', 'z'] as const) expect(Math.max(c[k] - b.min[k], b.max[k] - c[k]), `${a} ${k}`).toBeLessThan(s.radius * 0.8);
      v.dispose();
    }
    // a tripod leg is a diagonal strut: an axis-aligned box would be ~0.3 m thick, its principal-axis box is not
    const e = createCreature(null, 'commandEmitter') as unknown as { chunks: { bone: THREE.Bone; h: THREE.Vector3 }[] };
    const legs = e.chunks.filter((ch) => /^leg/.test(ch.bone.name));
    expect(legs.length).toBe(3);
    for (const leg of legs) {
      const h = [leg.h.x, leg.h.y, leg.h.z].sort((p, q) => p - q);
      expect(h[0]!).toBeLessThan(0.12);
      expect(h[2]!).toBeGreaterThan(0.45);
    }
    (e as unknown as CharacterVisual).dispose();
  });
});

describe('no action drives a body through the floor', () => {
  it('every documented action of every creature, sampled through its whole length', () => {
    for (const a of ['elite', 'wallrunner', 'weaver', 'secDrone', 'contamDrone'] as const) {
      for (const action of CREATURE_ACTIONS[a]) {
        const v = createCreature(null, a);
        const drone = a.endsWith('Drone');
        if (drone) { v.root.position.y = 1.8; asDrone(v)!.setHoverHeight(1.8); }
        if (drone && action !== 'death') { v.dispose(); continue; } // a hovering drone is nowhere near the floor
        run(v, 0.3);
        const info = v.play(action);
        const dur = Math.min(info.duration, 4.6) + 0.4;
        let worst = 0, when = 0, who: string[] = [];
        for (let t = 0; t < dur; t += 0.1) {
          run(v, 0.1);
          const b = skinnedBounds(v, 2);
          if (b.min.y < worst) { worst = b.min.y; when = t + 0.1; who = sunk(b, -TOLERANCE); }
        }
        expect(worst, `${a} ${action} @${when.toFixed(1)}s: ${who.slice(0, 6).join(' ')}`).toBeGreaterThanOrEqual(-TOLERANCE);
        v.dispose();
      }
    }
  }, 60000);

  it('a dead drone rests on the floor at its hover height, whatever that is', () => {
    for (const hover of [1.2, 1.8, 3]) {
      const d = createCreature(null, 'contamDrone');
      asDrone(d)!.setHoverHeight(hover);
      d.root.position.y = hover;
      d.update(STEP);
      d.play('death');
      run(d, 3);
      const b = skinnedBounds(d);
      expect(b.min.y, `hover ${hover}`).toBeGreaterThanOrEqual(-TOLERANCE);
      expect(b.min.y, `hover ${hover}`).toBeLessThan(0.05); // touching, not hovering
      expect(d.socket('core').getWorldPosition(new THREE.Vector3()).y).toBeLessThan(0.45);
      d.dispose();
    }
  });

  it('a wallrunner clinging to a wall keeps its body off the wall too', () => {
    const v = createCreature(null, 'wallrunner') as CharacterVisual & { setCling(c: { height: number; wallYaw: number }, s: number): void };
    v.setCling({ height: 3, wallYaw: 0 }, 0.05);
    v.setLocomotion(3, 0);
    run(v, 1);
    // wall plane: z = 0 with its normal along −Z (wallYaw 0); the body must stay on the −Z side
    expect(skinnedBounds(v, 2).max.z).toBeLessThanOrEqual(TOLERANCE);
    v.dispose();
  });
});

describe('feet', () => {
  /** drive a creature across the floor at a steady speed and return the worst planted-foot drift per plant */
  function drift(v: CharacterVisual, foot: THREE.Object3D, speed: number, seconds: number, liftLimit: number): number {
    v.setLocomotion(speed, 0);
    const p = new THREE.Vector3(), start = new THREE.Vector3();
    let planted = false, worst = 0, base = Infinity;
    // settle into the cycle, learning the height the ankle rides at while planted
    run(v, 2, () => {
      v.root.position.z -= speed * STEP;
      v.root.updateMatrixWorld(true);
      base = Math.min(base, foot.getWorldPosition(p).y);
    });
    for (let i = 0; i < seconds / STEP; i++) {
      v.root.position.z -= speed * STEP;
      v.update(STEP);
      v.root.updateMatrixWorld(true);
      foot.getWorldPosition(p);
      const down = p.y < base + liftLimit;
      if (down && !planted) start.copy(p);
      if (down && planted) worst = Math.max(worst, Math.hypot(p.x - start.x, p.z - start.z));
      planted = down;
    }
    return worst;
  }

  it('planted feet hold the world while walking (no slide at any speed)', () => {
    for (const speed of [1.2, 2.2, 4.5]) {
      const v = createCreature(null, 'elite');
      v.root.updateMatrixWorld(true);
      const foot = (v as unknown as { legs: { foot: THREE.Bone }[] }).legs[0]!.foot;
      expect(drift(v, foot, speed, 4, 0.002), `elite @${speed}`).toBeLessThan(0.02);
      v.dispose();
    }
  });

  it('the elite steps round when its root turns in place, and reports the footfalls', () => {
    const v = createCreature(null, 'elite');
    const steps: string[] = [];
    asElite(v)!.onFootfall = (side) => steps.push(side);
    run(v, 0.5);
    const legs = (v as unknown as { legs: { foot: THREE.Bone; plant: { stepping: boolean } }[] }).legs;
    const p = [new THREE.Vector3(), new THREE.Vector3()], prev = [new THREE.Vector3(), new THREE.Vector3()];
    v.root.updateMatrixWorld(true);
    legs.forEach((l, i) => l.foot.getWorldPosition(prev[i]!));
    let dragged = 0;
    const turn = Math.PI / 2, seconds = 1.5;
    for (let i = 0; i < seconds / STEP; i++) {
      v.root.rotation.y += (turn / seconds) * STEP;
      v.update(STEP);
      v.root.updateMatrixWorld(true);
      legs.forEach((l, k) => {
        l.foot.getWorldPosition(p[k]!);
        // distance a foot moves across the floor while it is supposed to be planted
        if (!l.plant.stepping) dragged += Math.hypot(p[k]!.x - prev[k]!.x, p[k]!.z - prev[k]!.z);
        prev[k]!.copy(p[k]!);
      });
    }
    expect(dragged).toBeLessThan(0.12); // was 0.85 m per foot before turn-stepping
    expect(steps).toContain('L');
    expect(steps).toContain('R');
    // and it ends standing over its feet, not twisted: both ankles back near their home under the body
    run(v, 1);
    v.root.updateMatrixWorld(true);
    legs.forEach((l, k) => {
      const local = v.root.worldToLocal(l.foot.getWorldPosition(p[k]!).clone());
      expect(Math.abs(Math.abs(local.x) - 0.55)).toBeLessThan(0.35);
    });
    v.dispose();
  });

  it('a teleporting root (yaw jump) does not trigger a step storm or break the pose', () => {
    const v = createCreature(null, 'wallrunner');
    run(v, 0.3);
    v.root.rotation.y = 2.9;
    v.root.position.set(40, 0, -12);
    run(v, 0.5);
    const b = skinnedBounds(v, 3);
    expect(b.max.y - b.min.y).toBeLessThan(1.4);
    expect(b.min.y).toBeGreaterThanOrEqual(-TOLERANCE);
    v.dispose();
  });
});
