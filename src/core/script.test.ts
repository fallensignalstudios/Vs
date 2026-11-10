import { describe, expect, it } from 'vitest';
import { ScriptRunnerImpl } from './script';
import type { Routine } from './api';

describe('ScriptRunner', () => {
  it('waits seconds, predicates, sub-routines, all and race', () => {
    const r = new ScriptRunnerImpl();
    const log: string[] = [];
    let gate = false;
    function* sub(): Routine<number> { yield 0.5; log.push('sub'); return 7; }
    function* main(): Routine {
      yield 1; log.push('a');
      yield () => gate; log.push('b');
      const v = yield* sub(); log.push('v' + v);
      yield [0.2, sub()]; log.push('all');
      yield { race: [10, 0.1] }; log.push('race');
    }
    const h = r.start(main());
    for (let i = 0; i < 59; i++) r.update(1 / 60);
    expect(log).toEqual([]);
    r.update(1 / 60); r.update(1 / 60);
    expect(log).toEqual(['a']);
    for (let i = 0; i < 30; i++) r.update(1 / 60);
    expect(log).toEqual(['a']);
    gate = true;
    for (let i = 0; i < 200; i++) r.update(1 / 60);
    expect(log).toEqual(['a', 'b', 'sub', 'v7', 'sub', 'all', 'race']);
    expect(h.done).toBe(true);
  });

  it('fastForward collapses time but keeps state changes; stop runs finally', () => {
    const r = new ScriptRunnerImpl();
    const log: string[] = [];
    function* cine(): Routine { try { yield 5; log.push('x'); yield 5; log.push('y'); } finally { log.push('fin'); } }
    const h = r.start(cine());
    r.update(1 / 60);
    h.fastForward = true;
    r.update(1 / 60);
    expect(log).toEqual(['x', 'y', 'fin']);
    const h2 = r.start(cine());
    r.update(1 / 60);
    h2.stop();
    expect(log).toEqual(['x', 'y', 'fin', 'fin']);
  });
});
