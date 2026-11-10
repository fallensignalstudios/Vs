import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { MeshBuilder } from './geo/builder';
import { buildRigSpec, instantiateRig } from './rig';
import { ClothSim, clothPanel, type ClothCapsule } from './cloth';

function setup(): { sim: ClothSim; bones: THREE.Bone[]; rest: number[]; jp: THREE.Vector3[]; jq: THREE.Quaternion[]; bone0: number; n: number } {
  const spec = buildRigSpec({ height: 1.85, shoulder: 0.19, hip: 0.095, bulk: 1, fem: 0 });
  const b = new MeshBuilder();
  const def = clothPanel(b, spec, {
    name: 'cape', cols: 5, rows: 6, pin: 'chest', surf: { color: 0x5a1616 },
    at: (u, v) => [(u - 0.5) * 0.5, 1.5 - v * 1.1, 0.18 + v * 0.1],
  });
  const rig = instantiateRig(spec);
  const jp: THREE.Vector3[] = [], jq: THREE.Quaternion[] = [];
  for (let i = 0; i < spec.names.length; i++) { jp.push(new THREE.Vector3(spec.rest[i * 3], spec.rest[i * 3 + 1], spec.rest[i * 3 + 2])); jq.push(new THREE.Quaternion()); }
  return { sim: new ClothSim(def, rig.bones, 1), bones: rig.bones, rest: spec.rest, jp, jq, bone0: def.bone0, n: def.cols * def.rows };
}

const caps: ClothCapsule[] = [{ a: new THREE.Vector3(0, 1.0, 0), b: new THREE.Vector3(0, 1.45, 0), r: 0.16 }];

function maxStretch(s: ReturnType<typeof setup>): number {
  let worst = 0;
  for (let i = 0; i < s.n; i++) {
    const p = s.bones[s.bone0 + i].position;
    expect(Number.isFinite(p.x + p.y + p.z)).toBe(true);
    worst = Math.max(worst, p.distanceTo(new THREE.Vector3(0, 1.5, 0.18)));
  }
  return worst;
}

describe('cloth', () => {
  it('hangs stably at any frame rate', () => {
    for (const dt of [1 / 240, 1 / 60, 1 / 20, 0.2]) {
      const s = setup();
      const m = new THREE.Matrix4();
      for (let i = 0; i < 300; i++) s.sim.update(dt, m, s.jp, s.jq, s.rest, caps, 1);
      expect(maxStretch(s)).toBeLessThan(1.4);
    }
  });

  it('survives violent motion and teleports without stretching or NaN', () => {
    const s = setup();
    const m = new THREE.Matrix4();
    let seed = 7;
    const rnd = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const pos = new THREE.Vector3();
    for (let i = 0; i < 1500; i++) {
      if (i % 200 === 199) pos.set(rnd() * 400 - 200, 0, rnd() * 400 - 200); // teleport
      else pos.x += (rnd() - 0.5) * 0.6; // up to 18 m/s jitter
      m.makeRotationY(rnd() * 6.28).setPosition(pos);
      s.sim.update(rnd() * 0.05, m, s.jp, s.jq, s.rest, caps, 1);
      // cloth never ends up farther from its pin than its own length (model space)
      expect(maxStretch(s)).toBeLessThan(1.65);
    }
  });

  it('follows the pinned bone', () => {
    const s = setup();
    const m = new THREE.Matrix4();
    for (let i = 0; i < 60; i++) s.sim.update(1 / 60, m, s.jp, s.jq, s.rest, caps, 1);
    const top = s.bones[s.bone0].position.clone();
    const chest = 3;
    s.jp[chest].y += 0.2;
    for (let i = 0; i < 10; i++) s.sim.update(1 / 60, m, s.jp, s.jq, s.rest, caps, 1);
    expect(s.bones[s.bone0].position.y - top.y).toBeCloseTo(0.2, 3);
  });

  it('keeps the pinned row exactly on its bone at any frame time', () => {
    const cases: Array<[string, (i: number) => number]> = [
      ['144 Hz', () => 1 / 144], ['jittered 60 Hz', (i) => 1 / 60 + (((i * 7919) % 13) / 13 - 0.5) * 0.003], ['slow motion', () => 1 / 300], ['hitch', (i) => (i % 9 === 0 ? 0.11 : 1 / 60)],
    ];
    for (const [, dtf] of cases) {
      const s = setup();
      const m = new THREE.Matrix4();
      const pos = new THREE.Vector3();
      const rest0 = new THREE.Vector3(-0.25, 1.5, 0.18);
      for (let i = 0; i < 400; i++) {
        const dt = dtf(i);
        pos.z -= 5.2 * dt; // the wearer runs
        m.makeRotationY(Math.sin(i * 0.05) * 0.4).setPosition(pos);
        s.sim.update(dt, m, s.jp, s.jq, s.rest, caps, 1);
        // bones are written in model space: the pinned particle must sit on its rest spot under the pin bone
        expect(s.bones[s.bone0].position.distanceTo(rest0)).toBeLessThan(1e-4);
      }
      expect(maxStretch(s)).toBeLessThan(1.65);
    }
  });

  it('rides with the wearer when time is stopped or the wearer is arrested', () => {
    for (const [dt, carry] of [[0, 0], [1 / 60, 1]] as const) {
      const s = setup();
      const m = new THREE.Matrix4();
      for (let i = 0; i < 90; i++) s.sim.update(1 / 60, m, s.jp, s.jq, s.rest, caps, 1);
      const hem = s.bones[s.bone0 + 5].position.clone();
      const pos = new THREE.Vector3();
      for (let i = 0; i < 30; i++) {
        pos.x += 0.05;
        m.makeRotationY(i * 0.03).setPosition(pos);
        s.sim.update(dt, m, s.jp, s.jq, s.rest, caps, 1, carry);
      }
      // 1.5 m and a quarter turn later the hem has not moved relative to the body
      expect(s.bones[s.bone0 + 5].position.distanceTo(hem)).toBeLessThan(1e-3);
    }
  });

  it('trails behind a running wearer and settles when they stop', () => {
    const s = setup();
    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    for (let i = 0; i < 120; i++) s.sim.update(1 / 60, m, s.jp, s.jq, s.rest, caps, 1);
    const restZ = s.bones[s.bone0 + 2 * 6 + 5].position.z;
    for (let i = 0; i < 180; i++) { pos.z -= 6 / 60; m.setPosition(pos); s.sim.update(1 / 60, m, s.jp, s.jq, s.rest, caps, 1); }
    // model faces −Z: the hem streams out behind (+Z)
    expect(s.bones[s.bone0 + 2 * 6 + 5].position.z - restZ).toBeGreaterThan(0.08);
    for (let i = 0; i < 240; i++) s.sim.update(1 / 60, m, s.jp, s.jq, s.rest, caps, 1);
    expect(Math.abs(s.bones[s.bone0 + 2 * 6 + 5].position.z - restZ)).toBeLessThan(0.06);
  });
});
