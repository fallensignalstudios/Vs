/**
 * Polish 4 UI: world text (legible in-world labels with a minimum pixel size and a backing plate) and the debug
 * clean frame hiding context cards.
 */
import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Game, GameEvents, UiSystem, Vec3Like } from '@/core/api';
import { Emitter } from '@/core/events';
import { SettingsStoreImpl } from '@/core/settings';
import { nullObject } from '@/core/stub';
import { FakeElement, installFakeDom } from './fake-dom';
import { createUiSystem } from './index';
import { WORLD_TEXT_REF_H, worldTextPx } from './narrative/worldtext';

const W = 1280;
const H = 720;

/** a real perspective camera and its projection to CSS px of a 1280 × 720 view (what game.camera does) */
function fakeCamera() {
  const camera = new THREE.PerspectiveCamera(40, W / H, 0.1, 500);
  const v = new THREE.Vector3();
  const local = new THREE.Vector3();
  return {
    camera,
    worldToScreen(p: Vec3Like, out: { x: number; y: number }): boolean {
      camera.updateMatrixWorld();
      local.set(p.x, p.y, p.z).applyMatrix4(camera.matrixWorldInverse);
      v.set(p.x, p.y, p.z).project(camera);
      out.x = (v.x + 1) * 0.5 * W;
      out.y = (1 - v.y) * 0.5 * H;
      return local.z < 0;
    },
  };
}

function rig() {
  const root = installFakeDom();
  const events = new Emitter<GameEvents>();
  const settings = new SettingsStoreImpl(events);
  const cam = fakeCamera();
  const scene = new THREE.Scene();
  const time = { now: 0, dt: 0, unscaledDt: 0, scale: 1, frame: 0, hitStop() {}, slowMo() {} };
  const game = {
    events, settings, time, uiRoot: root, paused: false, phase: 'playing', scene,
    input: nullObject('input'),
    player: nullObject('player'),
    camera: cam, actors: nullObject('actors'), audio: nullObject('audio'), mission: nullObject('mission'), render: nullObject('render'),
  } as unknown as Game;
  const ui: UiSystem = createUiSystem(game);
  const step = (seconds: number) => {
    const n = Math.max(1, Math.round(seconds * 60));
    for (let i = 0; i < n; i++) {
      time.now += 1 / 60;
      ui.update(1 / 60);
    }
  };
  return { root, events, ui, cam, scene, step };
}

const labels = (root: FakeElement): FakeElement[] => root.findAll('aur-wt');
const px = (el: FakeElement): number => Number.parseFloat(String(el.style.fontSize));

beforeEach(() => {
  (globalThis as unknown as { __aurelionErrors?: string[] }).__aurelionErrors = [];
});

describe('worldTextPx', () => {
  it('projects the world size, never below the 720p minimum (scaled with the viewport), never above the maximum', () => {
    // a 4.5 cm cap at 5 m through 40° at 720p is ~9 px of cap: below the minimum
    expect(worldTextPx(0.045, 5, 40, 720, 15, 34)).toBe(15);
    expect(worldTextPx(0.045, 5, 40, 1080, 15, 34)).toBeCloseTo(15 * 1080 / WORLD_TEXT_REF_H, 6);
    // close up it grows with the world size
    const near = worldTextPx(0.045, 2.5, 40, 720, 15, 34);
    expect(near).toBeGreaterThan(15);
    expect(near).toBeLessThan(34);
    expect(worldTextPx(0.045, 0.1, 40, 720, 15, 34)).toBe(34);
    // nonsense in, a finite size out
    expect(Number.isFinite(worldTextPx(0.05, 0, Number.NaN, 720, 15, 34))).toBe(true);
  });
});

describe('ui.worldText', () => {
  it('a label on an object: plate, legible size, anchored by its edge; follows the object; hides with it', () => {
    const r = rig();
    r.cam.camera.position.set(0, 1.6, 4);
    r.cam.camera.lookAt(0, 1.6, 0);
    const display = new THREE.Group();
    display.position.set(0, 0, 0);
    r.scene.add(display);
    display.updateMatrixWorld(true);
    r.ui.worldText!('lane', { at: display, offset: { x: 0.81, y: 1.825, z: 0 }, text: 'Dominion arcs', tone: 'amber', align: 'left', size: 0.045 });
    r.step(0.5);
    const [el] = labels(r.root);
    expect(el).toBeDefined();
    expect(el!.find('aur-wt-text')!.textContent).toBe('Dominion arcs');
    expect(el!.dataset.plate).toBe('1');
    expect(el!.dataset.tone).toBe('amber');
    expect(el!.dataset.align).toBe('left');
    expect(el!.style.visibility).toBe('visible');
    expect(Number(el!.style.opacity)).toBeCloseTo(1, 3);
    expect(px(el!)).toBeGreaterThanOrEqual(17);
    expect(String(el!.style.transform)).toContain('translate(0%, -50%)');
    // the label sits right of the screen centre (x +0.81 m) and above it (1.825 m against the 1.6 m eye)
    const m = /translate3d\(([-\d.]+)px, ([-\d.]+)px/.exec(String(el!.style.transform))!;
    expect(Number(m[1])).toBeGreaterThan(W / 2);
    expect(Number(m[2])).toBeLessThan(H / 2);
    // the object moves: so does the label
    display.position.x = -1;
    display.updateMatrixWorld(true);
    r.step(0.1);
    const m2 = /translate3d\(([-\d.]+)px/.exec(String(el!.style.transform))!;
    expect(Number(m2[1])).toBeLessThan(Number(m[1]));
    // the display fades out (its object hidden): so does the label
    display.visible = false;
    r.step(0.5);
    expect(el!.style.visibility).toBe('hidden');
    display.visible = true;
    r.step(0.5);
    expect(el!.style.visibility).toBe('visible');
    // taken out of the scene
    r.scene.remove(display);
    r.step(0.5);
    expect(el!.style.visibility).toBe('hidden');
  });

  it('faces: hidden from behind; maxDistance; opacity follows a panel fade', () => {
    const r = rig();
    const panel = new THREE.Object3D();
    r.scene.add(panel);
    panel.updateMatrixWorld(true);
    // the panel reads from +Z; the camera stands in front of it
    r.cam.camera.position.set(0, 0.2, 3);
    r.cam.camera.lookAt(0, 0, 0);
    r.ui.worldText!('proj', { at: panel, faces: { x: 0, y: 0, z: 1 }, text: 'PEOPLE FLOURISH THROUGH ORDER.', tone: 'gold', opacity: 0.5 });
    r.step(0.5);
    const [el] = labels(r.root);
    expect(el!.style.visibility).toBe('visible');
    expect(Number(el!.style.opacity)).toBeCloseTo(0.5, 2);
    // walk round behind it
    r.cam.camera.position.set(0, 0.2, -3);
    r.cam.camera.lookAt(0, 0, 0);
    r.step(0.5);
    expect(el!.style.visibility).toBe('hidden');
    // in front again but too far
    r.cam.camera.position.set(0, 0.2, 40);
    r.cam.camera.lookAt(0, 0, 0);
    r.step(0.5);
    expect(el!.style.visibility).toBe('hidden');
    r.ui.worldText!('proj', { at: panel, faces: { x: 0, y: 0, z: 1 }, text: 'PEOPLE FLOURISH THROUGH ORDER.', maxDistance: 60 });
    r.step(0.5);
    expect(el!.style.visibility).toBe('visible');
    expect(px(el!)).toBe(17); // far: the default minimum, not the 2 px the world size would give
  });

  it('null fades a label out and removes it; a zone change removes them all at once; a clean frame keeps them', () => {
    const r = rig();
    r.cam.camera.position.set(0, 1.6, 4);
    r.cam.camera.lookAt(0, 1.6, 0);
    r.ui.worldText!('a', { at: { x: 0, y: 1.6, z: 0 }, text: 'One' });
    r.ui.worldText!('b', { at: { x: 0.5, y: 1.6, z: 0 }, text: 'Two', plate: false });
    r.step(0.5);
    expect(labels(r.root)).toHaveLength(2);
    expect(labels(r.root)[1]!.dataset.plate).toBe('0');
    r.ui.setCleanFrame!(true);
    r.step(0.2);
    expect(labels(r.root).every((e) => e.style.visibility === 'visible')).toBe(true);
    r.ui.worldText!('a', null);
    r.step(0.5);
    expect(labels(r.root)).toHaveLength(1);
    r.events.emit('zone:loading', { zone: 'Z01' } as never);
    expect(labels(r.root)).toHaveLength(0);
  });

  it('bad input warns once and never throws', () => {
    const r = rig();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => {
      r.ui.worldText!('x', { at: { x: Number.NaN, y: 0, z: 0 }, text: 'x' });
      r.ui.worldText!('y', { at: { x: 0, y: 1.6, z: 0 }, text: 'y', tone: 'neon' as never, align: 'middle' as never, size: -1, minPx: Number.NaN });
      r.ui.worldText!('nobody', null);
      r.step(0.2);
    }).not.toThrow();
    expect(labels(r.root)).toHaveLength(1);
    expect(labels(r.root)[0]!.dataset.tone).toBe('pale');
    expect(labels(r.root)[0]!.dataset.align).toBe('center');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('clean frame and cards (polish 4)', () => {
  it("hud(false)'s clean frame hides a context card (kept, not cleared); narrative cards still draw", () => {
    const r = rig();
    const card = r.root.find('aur-card')!;
    r.ui.card('The fleets are not allies.', { style: 'context' });
    r.step(1);
    expect(card.style.visibility || '').toBe('');
    r.ui.setCleanFrame!(true);
    r.step(0.1);
    expect(card.style.visibility).toBe('hidden');
    r.ui.setCleanFrame!(false);
    r.step(0.1);
    expect(card.style.visibility).toBe('');
    expect(card.find('aur-card-text')!.textContent).toBe('The fleets are not allies.');
    // a witness card is part of the shot
    r.ui.setCleanFrame!(true);
    r.ui.card(null);
    r.step(1);
    r.ui.card('Witness V', { style: 'witness' });
    r.step(1.5);
    expect(card.dataset.style).toBe('witness');
    expect(card.style.visibility || '').toBe('');
    // and a context card that arrives while the frame is clean is hidden from its first frame
    r.ui.card(null);
    r.step(1);
    r.ui.card('Context', { style: 'context' });
    r.step(0.1);
    expect(card.style.visibility).toBe('hidden');
  });
});

describe('cards over world text and under screens (fix & ship)', () => {
  const LONG = 'The fleets are not allies, but their local cooperation has become a ceasefire before either government can authorize one.';

  it('a label that would sit under a card fades while the card is up and comes back after; one clear of it stays', () => {
    const r = rig();
    r.cam.camera.position.set(0, 1.6, 4);
    r.cam.camera.lookAt(0, 1.6, 0);
    // one label at the screen centre (where a context card sits), one near the top edge
    r.ui.worldText!('under', { at: { x: 0, y: 1.6, z: 0 }, text: 'REFORMATION TRACKS', align: 'left' });
    r.ui.worldText!('clear', { at: { x: 0, y: 2.9, z: 0 }, text: 'DOMINION ARCS' });
    r.step(0.5);
    const [under, clear] = labels(r.root);
    expect(under!.style.visibility).toBe('visible');
    expect(clear!.style.visibility).toBe('visible');
    r.ui.card(LONG, { style: 'context', seconds: 7 });
    r.step(0.5);
    expect(under!.style.visibility).toBe('hidden');
    expect(clear!.style.visibility).toBe('visible');
    // the card times out and fades: the label returns
    r.step(8);
    expect(r.root.find('aur-card')!.style.display).toBe('none');
    expect(under!.style.visibility).toBe('visible');
    // a witness card sits low (71 %): a centre label is clear of it, a low one is not
    r.ui.worldText!('low', { at: { x: 0, y: 1.6 - 0.62, z: 0 }, text: 'LOW' });
    r.step(0.5);
    const low = labels(r.root)[2]!;
    expect(low.style.visibility).toBe('visible');
    r.ui.card('Witness V', { style: 'witness' });
    r.step(1);
    expect(low.style.visibility).toBe('hidden');
    expect(under!.style.visibility).toBe('visible');
    // a context card hidden by the debug clean frame does not push labels away
    r.ui.card(null);
    r.step(1.5);
    r.ui.setCleanFrame!(true);
    r.ui.card(LONG, { style: 'context' });
    r.step(1);
    expect(under!.style.visibility).toBe('visible');
  });

  it('the pause menu covers every card style (hidden, timer held) and marks the root for the board and flash; all return on resume', () => {
    const r = rig();
    const card = r.root.find('aur-card')!;
    r.ui.card(LONG, { style: 'context', seconds: 3 });
    r.step(1);
    expect(card.style.display).toBe('flex');
    r.ui.showPause({ onResume() {}, onRestartCheckpoint() {}, onQuitToTitle() {} });
    r.step(0.5);
    expect(card.style.visibility).toBe('hidden');
    expect(r.root.find('aur')!.dataset.screen).toBe('1');
    // ten seconds in the menu do not use up the card's three
    r.step(10);
    r.ui.hidePause();
    r.step(0.1);
    expect(r.root.find('aur')!.dataset.screen).toBe('0');
    expect(card.style.visibility || '').toBe('');
    expect(card.style.display).toBe('flex');
    r.step(2.5);
    expect(card.style.display).toBe('none');
    // a witness card hides under the pause menu as well
    r.ui.card('Witness V', { style: 'witness' });
    r.step(1);
    r.ui.showPause({ onResume() {}, onRestartCheckpoint() {}, onQuitToTitle() {} });
    r.step(0.2);
    expect(card.style.visibility).toBe('hidden');
    r.ui.hidePause();
    r.step(0.1);
    expect(card.style.visibility || '').toBe('');
  });
});
