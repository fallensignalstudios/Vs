import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BARK_STALE_SECONDS, barkIsFresh, gazePoint, lineDuration } from './dialogue';
import { createTestWorld, idle, spawnAtStart, zoneOf } from './testkit';
import type { Actor, CharacterVisual, Routine, Vec3Like, ZoneRuntime } from '@/core/api';

describe('dialogue duration', () => {
  it('is clamp(1.6 + 0.055 × chars, 2, 8) from 20 characters up', () => {
    expect(lineDuration('x'.repeat(20))).toBeCloseTo(2.7, 6);
    expect(lineDuration('x'.repeat(60))).toBeCloseTo(4.9, 6);
    expect(lineDuration('x'.repeat(110))).toBeCloseTo(7.65, 6);
    expect(lineDuration('x'.repeat(400))).toBe(8);
  });

  it('one- and two-word lines ease down to a 1.2 s floor (polish 3: was 2 s for every line)', () => {
    expect(lineDuration('')).toBeCloseTo(1.2, 6);
    expect(lineDuration('No.')).toBeCloseTo(1.2, 6);
    expect(lineDuration('West.')).toBeLessThan(1.35);
    expect(lineDuration('Do it.')).toBeCloseTo(1.356, 3);
    expect(lineDuration('Kill them.')).toBeGreaterThan(1.6);
    expect(lineDuration('Kill them.')).toBeLessThan(1.9);
    // continuous and never shorter for a longer line
    let prev = lineDuration('');
    for (let n = 0; n <= 160; n++) {
      const d = lineDuration('x'.repeat(n));
      expect(d).toBeGreaterThanOrEqual(prev - 1e-9);
      expect(d - prev).toBeLessThan(0.12);
      prev = d;
    }
  });

  it('never returns a non-finite duration for bad input', () => {
    expect(lineDuration(undefined as unknown as string)).toBeCloseTo(1.2, 6);
    expect(lineDuration(null as unknown as string)).toBeCloseTo(1.2, 6);
  });

  it('barks go stale after six seconds in the queue', () => {
    expect(barkIsFresh(10, 10 + BARK_STALE_SECONDS)).toBe(true);
    expect(barkIsFresh(10, 10.01 + BARK_STALE_SECONDS)).toBe(false);
  });
});

describe('dialogue in a zone', () => {
  const zone = (run: (z: ZoneRuntime) => Routine) => zoneOf('Z00', [{ id: 'a', enter: spawnAtStart, run }, { id: 'b', run: idle }]);

  it('say blocks for the line duration, then clears', async () => {
    const w = createTestWorld({ zones: [zone(function* (z) { yield* z.say('Lyessa', 'x'.repeat(20)); z.setFlag('said', true); })] });
    await w.mission.gotoZone('Z00');
    w.tick(2.5);
    expect(w.ui.subtitles).toEqual(['x'.repeat(20)]);
    expect(w.mission.state.flags.said).toBeUndefined();
    w.tick(0.4);
    expect(w.mission.state.flags.said).toBe(true);
    expect(w.ui.subtitles.at(-1)).toBeNull();
    const line = w.eventsOf('dialogue:line')[0].line;
    expect(line.duration).toBeCloseTo(2.7, 6);
    expect(w.eventsOf('dialogue:clear')).toHaveLength(1);
  });

  it('an explicit duration wins, and confirm advances a line only after one second', async () => {
    const w = createTestWorld({ zones: [zone(function* (z) { yield* z.say('Tarrik', 'Hold.', { duration: 6 }); z.setFlag('said', true); })] });
    await w.mission.gotoZone('Z00');
    w.input.presses.add('confirm');
    w.tick(0.5);
    expect(w.mission.state.flags.said).toBeUndefined();
    w.tick(0.7);
    expect(w.mission.state.flags.said).toBe(true);
  });

  it('barks play one at a time, at most three wait, stale ones are dropped', async () => {
    const w = createTestWorld({
      zones: [zone(function* (z) {
        for (const n of ['one', 'two', 'three', 'four', 'five']) z.bark('Lyessa', n, { duration: 4 });
        yield 100;
      })],
    });
    await w.mission.gotoZone('Z00');
    w.tick(30);
    // "one" shows at once; "two" follows at 4 s; "three" would start at 8 s but has waited more than 6 s
    expect(w.ui.subtitles.filter((s) => s !== null)).toEqual(['one', 'two']);
  });

  it('a blocking line takes the stage from a bark', async () => {
    const w = createTestWorld({
      zones: [zone(function* (z) {
        z.bark('Lyessa', 'bark', { duration: 5 });
        yield 1;
        yield* z.say('Tarrik', 'line', { duration: 2 });
      })],
    });
    await w.mission.gotoZone('Z00');
    w.tick(4);
    expect(w.ui.subtitles).toEqual(['bark', null, 'line', null]);
  });
});

describe('voice-over hand-off', () => {
  function world(clipSeconds: number) {
    const calls: string[] = [];
    const audio = new Proxy({
      voice: (speaker: string, text: string, o?: { channel?: string }) => { calls.push(`voice:${speaker}:${text}:${o?.channel}`); return clipSeconds; },
      stopVoice: (fade?: number) => { calls.push(`stop:${fade}`); },
      speak: (speaker: string) => { calls.push(`speak:${speaker}`); },
    } as Record<string, unknown>, { get: (t, p) => (p in t ? t[p as string] : () => undefined) });
    const z = zoneOf('Z00', [{
      id: 'a',
      enter: spawnAtStart,
      *run(rt: ZoneRuntime): Routine {
        yield* rt.cinematic('scene', function* (): Routine {
          yield* rt.say('Selene', 'Hold the plane.', { channel: 'radio' });
          rt.setFlag('said', true);
        });
      },
    }]);
    return { w: createTestWorld({ zones: [z], overrides: { audio } }), calls };
  }

  it('a voiced line lasts as long as its clip plus a short tail and does not play the comm tick', async () => {
    const { w, calls } = world(5);
    await w.mission.gotoZone('Z00');
    w.tick(5.1);
    expect(calls).toEqual(['voice:Selene:Hold the plane.:radio']);
    expect(w.eventsOf('dialogue:line')[0].line.duration).toBeCloseTo(5.25, 6);
    expect(w.mission.state.flags.said).toBeUndefined();
    w.tick(0.4);
    expect(w.mission.state.flags.said).toBe(true);
    expect(calls).toHaveLength(1); // a line that ran its course does not call stopVoice
  });

  it('without a clip the comm tick plays and the text length sets the duration', async () => {
    const { w, calls } = world(0);
    await w.mission.gotoZone('Z00');
    w.tick(1);
    expect(calls).toEqual(['voice:Selene:Hold the plane.:radio', 'speak:Selene']);
    expect(w.eventsOf('dialogue:line')[0].line.duration).toBeCloseTo(lineDuration('Hold the plane.'), 6);
  });

  it('skipping the scene cuts the voice', async () => {
    const { w, calls } = world(5);
    await w.mission.gotoZone('Z00');
    w.tick(1);
    w.mission.skipCinematic();
    w.tick(0.2);
    expect(calls).toEqual(['voice:Selene:Hold the plane.:radio', 'stop:0.15']);
    expect(w.mission.state.flags.said).toBe(true);
  });
});

describe('speaker gestures', () => {
  /** a humanoid-looking visual that records what the dialogue director asks of it; sockets sit `up` above `at` */
  function fakeVisual(calls: string[], at: Vec3Like, up: Record<string, number> = {}): CharacterVisual {
    return {
      play: (a: string) => { calls.push(`play:${a}`); return 1; },
      stop: (a?: string) => { calls.push(`stop:${a ?? ''}`); },
      lookAt: (p: Vec3Like | null) => { calls.push(p ? `look:${p.y.toFixed(2)}` : 'look:null'); },
      setSpeaking: (k: number) => { calls.push(`speak:${k}`); },
      setHandTarget: () => {},
      teleported: () => {},
      socket: (n: string) => ({ getWorldPosition: (o: THREE.Vector3) => o.set(at.x, at.y + (up[n] ?? 0), at.z) }),
    } as unknown as CharacterVisual;
  }

  it("looks at the listener's eye socket (a seated listener's face, not over its head)", () => {
    const pos = new THREE.Vector3(2, 0, -3);
    const seated = { pos, height: 1.8, visual: fakeVisual([], pos, { eye: 1.12, head: 1.2 }) } as unknown as Actor;
    expect(gazePoint(seated, { x: 0, y: 0, z: 0 }).y).toBeCloseTo(1.12, 6);
    // no believable socket (the root comes back for unknown names): eye height of a standing figure
    const bare = { pos, height: 1.8, visual: fakeVisual([], pos) } as unknown as Actor;
    expect(gazePoint(bare, { x: 0, y: 0, z: 0 }).y).toBeCloseTo(1.8 * 0.93, 6);
  });

  /** a companion-shaped speaker that records face() calls into the same log as its visual */
  function fakeCompanion(calls: string[], at: THREE.Vector3, faceTo: THREE.Vector3 | null = null) {
    const actor = { id: 11, pos: at, height: 1.8, alive: true, team: 'player', visual: fakeVisual(calls, at) } as unknown as Actor;
    const c = {
      actor, who: 'tharne', mode: 'scripted', faceTo,
      moveTo: () => {},
      face(t: Vec3Like | null) {
        this.faceTo = t ? new THREE.Vector3(t.x, t.y, t.z) : null;
        calls.push(t ? `face:${t.x.toFixed(1)},${t.z.toFixed(1)}` : 'face:null');
        // the real Companion.face also points the head at the (foot-level) point it is given
        actor.visual!.lookAt(this.faceTo);
      },
    };
    return c;
  }

  function sayWorld(lines: (rt: ZoneRuntime) => Routine) {
    const z = zoneOf('Z00', [{ id: 'a', enter: spawnAtStart, run: lines }, { id: 'b', run: idle }]);
    return createTestWorld({ zones: [z] });
  }

  it("a companion speaker turns to the listener but its gaze ends on the listener's eyes, not its feet", async () => {
    const calls: string[] = [];
    const tharne = fakeCompanion(calls, new THREE.Vector3(3, 0, 0));
    const w = sayWorld(function* (rt) {
      yield* rt.say('Tharne', 'Both routes stay passable.', { actor: tharne as never, duration: 1 });
      rt.setFlag('said', true);
    });
    await w.mission.gotoZone('Z00');
    const lead = w.player.actor as Actor;
    (lead as { visual: CharacterVisual | null }).visual = fakeVisual([], lead.pos, { eye: 1.6 });
    w.tick(1.2);
    expect(w.mission.state.flags.said).toBe(true);
    const faceAt = calls.findIndex((c) => c.startsWith('face:') && c !== 'face:null');
    expect(faceAt).toBeGreaterThanOrEqual(0);
    // the first gaze after the turn is the eye point (1.6 m), the last word before the line ends
    const looks = calls.slice(faceAt).filter((c) => c.startsWith('look:'));
    expect(looks[1]).toBe(`look:${(lead.pos.y + 1.6).toFixed(2)}`);
    // no facing of its own before the line: released afterwards
    expect(calls.at(-2)).toBe('face:null');
  });

  it('after the line a companion goes back to the facing the zone gave it', async () => {
    const calls: string[] = [];
    const target = new THREE.Vector3(9, 0, -4);
    const tharne = fakeCompanion(calls, new THREE.Vector3(3, 0, 0), target.clone());
    const w = sayWorld(function* (rt) {
      yield* rt.say('Tharne', 'It followed the containment geometry.', { actor: tharne as never, duration: 1 });
      rt.setFlag('said', true);
    });
    await w.mission.gotoZone('Z00');
    w.tick(1.2);
    expect(w.mission.state.flags.said).toBe(true);
    expect(calls.filter((c) => c.startsWith('face:')).at(-1)).toBe('face:9.0,-4.0');
    expect(tharne.faceTo?.x).toBe(9);
  });

  it('keepFacing leaves the body alone — only the head turns to the listener', async () => {
    const calls: string[] = [];
    const target = new THREE.Vector3(-5, 0, 1);
    const tharne = fakeCompanion(calls, new THREE.Vector3(3, 0, 0), target.clone());
    const w = sayWorld(function* (rt) {
      yield* rt.say('Tharne', 'I can bridge local targeting.', { actor: tharne as never, keepFacing: true, duration: 1 });
      rt.setFlag('said', true);
    });
    await w.mission.gotoZone('Z00');
    const lead = w.player.actor as Actor;
    (lead as { visual: CharacterVisual | null }).visual = fakeVisual([], lead.pos, { eye: 1.6 });
    w.tick(1.2);
    expect(w.mission.state.flags.said).toBe(true);
    expect(calls.some((c) => c.startsWith('face:'))).toBe(false);
    expect(calls).toContain(`look:${(lead.pos.y + 1.6).toFixed(2)}`);
    expect(calls).toContain('play:talk');
    // the head goes back to what the body faces
    expect(calls.at(-1)).toBe('look:0.00');
    expect(tharne.faceTo?.x).toBe(-5);
  });

  it('keepWeapon is the same as gesture: false (no talk clip, the mouth moves)', async () => {
    const calls: string[] = [];
    const tharne = fakeCompanion(calls, new THREE.Vector3(3, 0, 0));
    const w = sayWorld(function* (rt) {
      yield* rt.say('Tharne', 'Hold.', { actor: tharne as never, keepWeapon: true, duration: 1 });
      rt.setFlag('said', true);
    });
    await w.mission.gotoZone('Z00');
    w.tick(1.2);
    expect(w.mission.state.flags.said).toBe(true);
    expect(calls).not.toContain('play:talk');
    expect(calls).toContain('speak:0.7');
    expect(calls).toContain('speak:0');
  });

  it('gesture: false keeps a drawn weapon out — no talk clip, the mouth moves, the gaze still meets the listener', async () => {
    const calls: string[] = [];
    const speakerPos = new THREE.Vector3(0, 0, 2);
    const speaker = { id: 9, pos: speakerPos, height: 1.9, alive: true, team: 'player', visual: fakeVisual(calls, speakerPos) } as unknown as Actor;
    const z = zoneOf('Z00', [{
      id: 'a',
      enter: spawnAtStart,
      *run(rt: ZoneRuntime): Routine {
        yield* rt.say('Tarrik', 'Hold.', { actor: speaker, gesture: false, duration: 1 });
        rt.setFlag('first', true);
        yield* rt.say('Tarrik', 'Go.', { actor: speaker, duration: 1 });
        rt.setFlag('second', true);
      },
    }, { id: 'b', run: idle }]);
    const w = createTestWorld({ zones: [z] });
    await w.mission.gotoZone('Z00');
    const lead = w.player.actor as Actor;
    (lead as { visual: CharacterVisual | null }).visual = fakeVisual([], lead.pos, { eye: 1.16 });
    w.tick(1.2);
    expect(w.mission.state.flags.first).toBe(true);
    // the first line, up to its end (the second line starts on the same tick)
    const first = calls.splice(0, calls.indexOf('speak:0') + 1);
    expect(first).not.toContain('play:talk');
    expect(first).toContain('speak:0.7');
    expect(first).toContain('speak:0');
    expect(first.some((c) => c.startsWith('look:') && c !== 'look:null')).toBe(true);
    w.tick(1.2);
    expect(w.mission.state.flags.second).toBe(true);
    expect(calls).toContain('play:talk'); // the default still gestures
    expect(calls).toContain('stop:talk');
    expect(calls).toContain(`look:${(lead.pos.y + 1.16).toFixed(2)}`);
  });
});
