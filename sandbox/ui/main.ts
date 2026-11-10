/**
 * UI sandbox — mounts the real UiSystem over a concept painting with a fake game (miniGame + fake player HUD
 * state, input glyphs / menu presses and a real three.js camera for projection).
 *
 *   window.__ui                 the UiSystem under test
 *   window.__scene(name)        rebuild the UI and stage a named scene (see SCENES); returns the scene list if unknown
 *   window.__step(seconds)      advance the UI deterministically (also advances the fake sim clock)
 *   window.__press(key)         inject a menu press: up|down|left|right|confirm|cancel
 *   window.__fake               the mutable fake world (hud state, actors, camera) for ad-hoc evals
 *
 * URL: ?manual=1 (no RAF loop; CSS transitions disabled so screenshots are settled), ?scene=<name>,
 *      ?bg=quarantine|wound|relay|crownmark|grey, ?pad=1 (gamepad glyphs), ?bar=1 (scene buttons).
 */
import '@fontsource/cinzel/400.css';
import '@fontsource/cinzel/600.css';
import '@fontsource/barlow/400.css';
import '@fontsource/barlow/500.css';
import '@fontsource/barlow/600.css';
import '@fontsource/barlow-condensed/500.css';
import '@fontsource/barlow-condensed/600.css';
import * as THREE from 'three';
import type { Actor, ButtonAction, Game, InputContext, PlayerHudState, UiSystem } from '@/core/api';
import { createUiSystem } from '@/ui';
import { miniGame, withStubs } from '../harness';

const params = new URLSearchParams(location.search);
const manual = params.has('manual');
const world = document.getElementById('world') as HTMLElement;
const uiRoot = document.getElementById('ui') as HTMLElement;

const BACKDROPS: Record<string, string> = {
  quarantine: 'url(/art/quarantine-cooperation.jpg)',
  wound: 'url(/art/wound-overlook.jpg)',
  relay: 'url(/art/relay-route.jpg)',
  crownmark: 'url(/art/crownmark-chamber.jpg)',
  grey: 'linear-gradient(180deg, #8d8f92 0%, #4a4d52 45%, #0c0e12 100%)',
};
function backdrop(name: string): void {
  world.style.backgroundImage = BACKDROPS[name] ?? BACKDROPS.grey ?? '';
}

if (manual) {
  const st = document.createElement('style');
  st.textContent = '.aur *, .aur *::before, .aur *::after { transition: none !important; }';
  document.head.appendChild(st);
}

// ------------------------------------------------------------------------------------------------ fake world
const KBM: Record<ButtonAction, string> = {
  attack: 'LMB', heavy: 'F', guard: 'Q', aim: 'RMB', dodge: 'Space', sprint: 'Shift', interact: 'E', ability1: '1',
  ability2: '2', lockOn: 'Tab', scan: 'V', reload: 'R', swapShoulder: 'C', pause: 'Esc', skip: 'Space',
  confirm: 'Enter', cancel: 'Esc', menuUp: '↑', menuDown: '↓', menuLeft: '←', menuRight: '→',
};
const PAD: Record<ButtonAction, string> = {
  attack: 'X', heavy: 'Y', guard: 'LB', aim: 'LT', dodge: 'A', sprint: 'L3', interact: 'B', ability1: 'RB',
  ability2: 'RT', lockOn: 'R3', scan: 'D↑', reload: 'X', swapShoulder: 'D←', pause: 'Start', skip: 'B',
  confirm: 'A', cancel: 'B', menuUp: '↑', menuDown: '↓', menuLeft: '←', menuRight: '→',
};
const KEYMAP: Record<string, ButtonAction> = {
  ArrowUp: 'menuUp', KeyW: 'menuUp', ArrowDown: 'menuDown', KeyS: 'menuDown', ArrowLeft: 'menuLeft', KeyA: 'menuLeft',
  ArrowRight: 'menuRight', KeyD: 'menuRight', Enter: 'confirm', Space: 'confirm', Escape: 'cancel', Backspace: 'cancel',
};
const PRESS: Record<string, ButtonAction> = {
  up: 'menuUp', down: 'menuDown', left: 'menuLeft', right: 'menuRight', confirm: 'confirm', cancel: 'cancel',
};

interface FakeActor {
  id: number; archetype: string; name: string; team: string; pos: THREE.Vector3; height: number; radius: number;
  hp: number; maxHp: number; poise: number; maxPoise: number; alive: boolean; targetable: boolean; protectedNpc: boolean;
  linked: boolean; frozenUntil: number; staggeredUntil: number; weakPoints: Array<{ id: string; socket: string; radius: number; multiplier: number; exposed: boolean }>;
  aimPoint(out: THREE.Vector3): THREE.Vector3;
}

function fakeActor(id: number, archetype: string, x: number, z: number, hp: number, maxHp: number, extra: Partial<FakeActor> = {}): FakeActor {
  const a: FakeActor = {
    id, archetype, name: archetype, team: 'eclipse', pos: new THREE.Vector3(x, 0, z), height: 1.9, radius: 0.4,
    hp, maxHp, poise: 20, maxPoise: 30, alive: true, targetable: true, protectedNpc: false, linked: false,
    frozenUntil: 0, staggeredUntil: 0, weakPoints: [],
    aimPoint(out) { return out.set(a.pos.x, a.pos.y + a.height * 0.62, a.pos.z); },
    ...extra,
  };
  return a;
}

interface Fake {
  hud: PlayerHudState;
  actors: FakeActor[];
  camera: THREE.PerspectiveCamera;
  pressed: Set<ButtonAction>;
  device: 'kbm' | 'gamepad';
  context: InputContext;
  log: string[];
}

function tarrikState(): PlayerHudState {
  return {
    protagonist: 'tarrik', name: 'Tarrik', hp: 112, maxHp: 140, poise: 44, maxPoise: 60, echo: 58, echoMax: 100,
    ammo: 4, magSize: 6, reserve: 18, reloading: false, meleeName: 'Velkorran', rangedName: 'Cinderline',
    abilities: [
      { id: 'cinderSlam', name: 'Cinder Slam', cost: 35, cooldown: 8, cooldownLeft: 0, ready: true },
      { id: 'cinderSticky', name: 'Sticky Grenade', cost: 30, cooldown: 10, cooldownLeft: 4.2, ready: false },
    ],
    aiming: false, guarding: false, lockTarget: null, context: null, threat: 0,
  };
}

function seleneState(): PlayerHudState {
  return {
    protagonist: 'selene', name: 'Selene', hp: 26, maxHp: 100, poise: 12, maxPoise: 35, echo: 32, echoMax: 100,
    ammo: 2, magSize: 8, reserve: 24, reloading: false, meleeName: 'Verity', rangedName: 'Axiom',
    abilities: [
      { id: 'stasisGrenade', name: 'Stasis Grenade', cost: 35, cooldown: 12, cooldownLeft: 0, ready: false },
      { id: 'dispatch', name: 'Dispatch', cost: 30, cooldown: 6, cooldownLeft: 0, ready: true },
    ],
    aiming: true, guarding: false, lockTarget: null, context: null, threat: 0,
  };
}

let fake!: Fake;
let game!: Game;
let ui!: UiSystem;
let simTime = 0;

function build(): void {
  uiRoot.replaceChildren();
  simTime = 0;
  const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 500);
  camera.position.set(0, 1.9, 4.2);
  camera.lookAt(0, 1.3, -6);
  camera.updateMatrixWorld(true);
  fake = {
    hud: tarrikState(), actors: [], camera, pressed: new Set(), device: params.has('pad') ? 'gamepad' : 'kbm', context: 'game', log: [],
  };
  const playerActor = fakeActor(1, 'tarrik', 0, 2, 112, 140, { team: 'player' });
  fake.actors.push(playerActor);
  const v = new THREE.Vector3();

  // NB: withStubs copies own properties once, so live values are plain fields we assign through the proxy
  const input = withStubs<Game['input']>('input', {
    device: fake.device,
    context: fake.context,
    pointerLocked: false,
    glyph: (a: ButtonAction) => (fake.device === 'gamepad' ? PAD[a] : KBM[a]) ?? '?',
    pressed: (a: ButtonAction) => fake.pressed.has(a),
    down: () => false,
    released: () => false,
    heldTime: () => 0,
    consume: (a: ButtonAction) => { fake.pressed.delete(a); },
    setContext: (c: InputContext) => { fake.context = c; (input as unknown as { context: InputContext }).context = c; fake.log.push(`context:${c}`); },
    exitPointerLock: () => { fake.log.push('exitPointerLock'); },
    requestPointerLock: () => { fake.log.push('requestPointerLock'); },
    update: () => undefined,
  } as unknown as Partial<Game['input']>);

  const cameraRig = withStubs<Game['camera']>('camera', {
    camera, mode: 'follow', yaw: 0, pitch: 0,
    getForward: (out: THREE.Vector3) => { camera.getWorldDirection(out); out.y = 0; return out.normalize(); },
    getRight: (out: THREE.Vector3) => { camera.getWorldDirection(out); out.y = 0; out.normalize(); return out.set(-out.z, 0, out.x); },
    worldToScreen: (p: { x: number; y: number; z: number }, out: { x: number; y: number }) => {
      v.set(p.x, p.y, p.z).applyMatrix4(camera.matrixWorldInverse);
      if (v.z >= -0.05) return false;
      v.applyMatrix4(camera.projectionMatrix);
      out.x = (v.x * 0.5 + 0.5) * innerWidth;
      out.y = (-v.y * 0.5 + 0.5) * innerHeight;
      return true;
    },
  } as unknown as Partial<Game['camera']>);

  const actors = withStubs<Game['actors']>('actors', {
    all: fake.actors as unknown as readonly Actor[],
    areHostile: (a: Actor, b: Actor) => a.team !== b.team,
  } as unknown as Partial<Game['actors']>);

  const player = withStubs<Game['player']>('player', {
    actor: playerActor as unknown as Actor,
    getHudState: () => fake.hud,
  } as unknown as Partial<Game['player']>);

  const time = { now: 0, dt: 0, unscaledDt: 0, scale: 1, frame: 0, hitStop() {}, slowMo() {} };
  game = miniGame(null, { uiRoot, input, camera: cameraRig, actors, player, time: time as Game['time'] });
  ui = createUiSystem(game);
  Object.assign(window, { __ui: ui, __game: game, __fake: fake });
}

function step(seconds: number): void {
  const n = Math.max(1, Math.round(seconds * 60));
  for (let i = 0; i < n; i++) {
    simTime += 1 / 60;
    game.time.now = simTime;
    game.time.dt = 1 / 60;
    game.time.frame++;
    ui.update(1 / 60);
    fake.pressed.clear();
  }
}

function press(key: string, settle = 0.4): void {
  const a = PRESS[key];
  if (!a) return;
  fake.pressed.add(a);
  step(1 / 60);
  step(settle);
}

// ------------------------------------------------------------------------------------------------ scenes
function combatScene(selene: boolean): void {
  backdrop(selene ? 'wound' : 'quarantine');
  fake.hud = selene ? seleneState() : tarrikState();
  if (selene) game.events.emit('player:protagonist', { id: 'selene' });
  const elite = fakeActor(10, 'elite', 0.4, -9, 610, 900, { height: 3.6, maxPoise: 200, poise: 120, linked: true, weakPoints: [{ id: 'joint', socket: 'joint', radius: 0.4, multiplier: 3, exposed: selene }] });
  const a = fakeActor(11, 'linkbound', -3.4, -4.5, 44, 70, { linked: true, poise: 22 });
  const b = fakeActor(12, 'linkbound', 3.2, -6, 70, 70, { poise: 30 });
  const c = fakeActor(13, 'weaver', -6.5, -13, 52, 90, { maxPoise: 40, poise: 9, weakPoints: [{ id: 'core', socket: 'core', radius: 0.3, multiplier: 2.5, exposed: true }] });
  const d = fakeActor(14, 'wallrunner', 6.4, -11, 18, 50, { maxPoise: 15, poise: 0, staggeredUntil: 999, height: 1.5 });
  const e = fakeActor(15, 'linkbound', 1.6, -3.2, 31, 70, { frozenUntil: 999, poise: 30 });
  fake.actors.push(elite, a, b, c, d, e);
  fake.hud.lockTarget = (selene ? c : a) as unknown as Actor;
  fake.hud.threat = selene ? 0.82 : 0.34;
  if (!selene) fake.hud.guarding = true;
  ui.setHudVisible(true);
  ui.objective(selene ? 'Arrest the regenerating joint' : 'Isolate the breach organism — sever its links');
  ui.marker('obj', { x: -1.5, y: 1.2, z: -22 }, { kind: 'objective', label: 'Frost anchor' });
  ui.marker('opt', { x: 14, y: 1, z: -9 }, { kind: 'optional', label: 'O3 · Contamination record' });
  ui.marker('ret', { x: -2, y: 1, z: 20 }, { kind: 'return', label: 'Main route' });
  ui.marker('int', { x: 4.6, y: 1.0, z: -2.5 }, { kind: 'interact', label: 'Recovery panel' });
  ui.marker('cmp', { x: -5.2, y: 1.9, z: -2.2 }, { kind: 'companion', label: selene ? 'Tarrik' : 'Selene' });
  ui.marker('thr', { x: -30, y: 2, z: -6 }, { kind: 'threat', label: 'Weaver anchor' });
  ui.eliteBar({ name: 'Breach Organism', hp: 610, maxHp: 900, regenerating: !selene, exposed: selene });
  ui.readout(selene ? { label: 'Containment forecast', value: '02:11:43', tone: 'gold' } : { label: 'Carrier impact', value: '1:31', tone: 'amber' });
  step(1.2);
  ui.toast('Checkpoint saved', 'checkpoint');
  ui.toast(selene ? 'Link severed' : 'Echo +22 — counter', 'echo');
  if (selene) ui.toast('Record added: threat-track exchange', 'record'); else ui.toast('Quarantine band closing', 'warning');
  game.events.emit('player:echo', { value: fake.hud.echo, delta: selene ? 25 : 22, reason: selene ? 'link sever' : 'counter' });
  ui.damageDirection(-2.2, 1);
  ui.damageDirection(0.7, 0.6);
  ui.hitMarker(selene ? 'weak' : 'hit');
  fake.hud.context = selene
    ? { id: 'arrest', prompt: 'Arrest the joint', button: 'heavy', window: 3.2, autoConfirmable: true, onConfirm() {} }
    : { id: 'fracture', prompt: 'Thermal Fracture', button: 'heavy', window: 2.4, autoConfirmable: true, onConfirm() {} };
  ui.prompt(selene ? { text: 'Hold the coherent plane', glyph: 'E', hold: true, progress: 0.62 } : { text: 'Lift the plate', glyph: 'E', hold: true, progress: 0.35 });
  ui.caption('Link hum', 'link', -1.2);
  ui.subtitle(selene
    ? { speaker: 'Tharne', text: 'The joint is cycling. Arrest it on the next exposure.', offscreen: true, channel: 'radio' }
    : { speaker: 'Lyessa', text: 'Three lanes. They are not guessing.', offscreen: true });
  step(0.5);
}

const SCENES: Record<string, () => void> = {
  title() {
    ui.setHudVisible(false);
    ui.showTitle({ canContinue: true, onNewGame: (d) => fake.log.push(`new:${d}`), onContinue: () => fake.log.push('continue') });
    step(2);
  },
  'title-new'() {
    ui.setHudVisible(false);
    ui.showTitle({ canContinue: false, onNewGame: (d) => fake.log.push(`new:${d}`), onContinue: () => fake.log.push('continue') });
    step(2);
  },
  'title-difficulty'() {
    SCENES.title?.();
    press('down');
    press('confirm');
  },
  'settings-graphics'() { SCENES.title?.(); press('down'); press('down'); press('confirm'); press('confirm'); },
  'settings-audio'() { SCENES['settings-graphics']?.(); press('cancel'); press('down'); press('confirm'); press('down'); press('left'); press('left'); },
  'settings-controls'() { SCENES.title?.(); press('down'); press('down'); press('down'); press('confirm'); press('confirm'); },
  'settings-gameplay'() { SCENES['settings-graphics']?.(); press('cancel'); press('down'); press('down'); press('down'); press('confirm'); },
  'settings-accessibility'() {
    SCENES['settings-graphics']?.(); press('cancel');
    for (let i = 0; i < 4; i++) press('down');
    press('confirm'); press('down'); press('right');
  },
  pause() {
    combatScene(false);
    fake.hud.context = null;
    ui.showPause({ onResume: () => { ui.hidePause(); fake.log.push('resume'); }, onRestartCheckpoint: () => fake.log.push('restart'), onQuitToTitle: () => fake.log.push('quit') });
    step(1);
  },
  'pause-confirm'() { SCENES.pause?.(); press('down'); press('confirm'); },
  'pause-settings'() { SCENES.pause?.(); press('down'); press('down'); press('confirm'); press('down'); press('down'); press('down'); press('down'); press('confirm'); },
  'hud-tarrik'() { combatScene(false); },
  'hud-selene'() { combatScene(true); },
  'hud-quiet'() {
    backdrop('relay');
    fake.hud = { ...tarrikState(), hp: 140, echo: 12, ammo: 6, poise: 60 };
    fake.hud.abilities[1].cooldownLeft = 0;
    ui.setHudVisible(true);
    ui.objective('Reach the relay overlook');
    ui.marker('obj', { x: 2, y: 1.4, z: -40 }, { kind: 'objective' });
    ui.zoneCard('Z04 · Relay Overlook', 'Encounter E2 — two receivers, three routes');
    ui.hint({ text: 'Hold to guard. Press just before impact to counter.', glyph: 'Q' });
    ui.prompt({ text: 'Open the service hatch', glyph: 'E' });
    step(2.4);
  },
  'hud-hits'() {
    combatScene(false);
    fake.hud.context = null;
    ui.subtitle(null);
    ui.prompt(null);
    step(0.6);
  },
  subtitles() {
    backdrop('quarantine');
    ui.setHudVisible(false);
    ui.subtitle({ speaker: 'Tarrik', text: 'Hold the line. Nobody fires until I say the word.' });
    ui.caption('Scan sweep', 'scan', 1.4);
    ui.caption('Breach — wall seam', 'breach', -2.6);
    step(0.6);
  },
  'subtitles-l'() {
    backdrop('quarantine');
    ui.setHudVisible(false);
    game.settings.set('subtitleSize', 'l');
    ui.subtitle({ speaker: 'Selene', text: 'Tharne, give me the trajectory. If the carrier clips the atrium, seven thousand people go with it.', offscreen: true, channel: 'radio' });
    step(0.6);
  },
  'subtitles-xl'() {
    backdrop('quarantine');
    ui.setHudVisible(false);
    game.settings.set('subtitleSize', 'xl');
    game.settings.set('subtitleBackground', false);
    ui.subtitle({ speaker: 'Lyric', text: 'It is not a voice. It is a grammar — and it already knows how you answer.', offscreen: true });
    ui.caption('Corruption pressure rising', 'pressure');
    step(0.6);
  },
  'subtitles-long'() {
    backdrop('wound');
    ui.setHudVisible(false);
    ui.letterbox(true, 0);
    ui.subtitle({ speaker: 'Terminal', channel: 'system', text: 'Four active references are unbalanced. Doing nothing threatens containment. Completion stabilises the boundary and enables authority. No action taken here opens the prison. Two independent assents are required; neither interface commands the other.' });
    ui.skipHint(true, 0.4);
    step(0.6);
  },
  narration() {
    backdrop('wound');
    ui.setHudVisible(false);
    ui.letterbox(true, 0);
    ui.subtitle({ speaker: 'Narrator', channel: 'narration', text: 'Aurelion was never a fortress. It was a decision, held open for a thousand years.' });
    step(0.6);
  },
  choice() {
    backdrop('relay');
    ui.setHudVisible(false);
    const hnd = ui.choice({
      id: 'rescuePriority', title: 'Local priority · Recovery panel',
      prompt: 'Lyessa — “Two routes, one escort. Where do I stand?”',
      options: [
        { id: 'WestStretchers', tag: 'West', label: 'Stretcher cases first', detail: 'Lyessa shields the medics. Their field cache is staged in the west recovery alcove before the crucible.' },
        { id: 'EastWalkers', tag: 'East', label: 'Walking wounded first', detail: 'Mobile survivors reach the manual shutter early. The east flank opens before the second phase.' },
      ],
      note: 'This choice is explicit and untimed. Both groups reach safety.',
    });
    Object.assign(window, { __choice: hnd });
    step(1.5);
  },
  'choice-selected'() { SCENES.choice?.(); press('right'); press('confirm', 0.9); },
  'choice-committed'() { SCENES['choice-selected']?.(); press('confirm', 0.3); },
  board() {
    backdrop('crownmark');
    ui.setHudVisible(false);
    ui.fade(0.55, 0, 'black');
    ui.statusBoard([
      { label: 'Boundary', value: 'Closed', tone: 'ok' },
      { label: 'Stability', value: 'Recovering', tone: 'ok' },
      { label: 'Authority', value: 'Available', tone: 'warn' },
      { label: 'Release', value: 'Withheld', tone: 'ok' },
      { label: 'External queries', value: 'No authority', tone: 'neutral' },
    ], { title: 'Meridian · 5 / 5' });
    step(5);
  },
  'board-partial'() {
    backdrop('crownmark');
    ui.setHudVisible(false);
    ui.fade(0.55, 0, 'black');
    ui.statusBoard([
      { label: 'Boundary', value: 'Closed', tone: 'ok' },
      { label: 'Stability', value: 'Recovering', tone: 'ok' },
      { label: 'Authority', value: 'Available', tone: 'warn' },
    ], { title: 'Meridian · 5 / 5' });
    step(1.4);
  },
  'card-context'() {
    backdrop('grey');
    ui.setHudVisible(false);
    ui.fade(1, 0, 'black');
    ui.card('Two fleets hold the same wound in the sky.\nNeither will be the first to look away.', { sub: 'Aurelion · the outer ring', style: 'context' });
    step(1.6);
  },
  'card-witness'() {
    backdrop('crownmark');
    ui.setHudVisible(false);
    ui.letterbox(true, 0);
    ui.card('He drew the enemy in, and sundered the star to hold the door.', { sub: 'Witness V', style: 'witness' });
    step(1.6);
  },
  'card-consequence'() {
    backdrop('crownmark');
    ui.setHudVisible(false);
    ui.fade(0.7, 0, 'black');
    ui.card('Release withheld', { sub: 'Command grammar propagates. External queries lack authority.', style: 'consequence' });
    step(1.6);
  },
  'card-title'() {
    backdrop('wound');
    ui.setHudVisible(false);
    ui.fade(0.45, 0, 'black');
    ui.card('Aurelion', { sub: 'Contrary Witness', style: 'title' });
    step(1.6);
  },
  loading() {
    ui.setHudVisible(false);
    ui.showLoading(true, { title: 'Z08 · Quarantine Crucible', subtitle: 'Encounter E4 — isolate, expose, fracture', art: 'quarantine-cooperation', progress: 0.62 });
    step(1.5);
  },
  'loading-indeterminate'() {
    ui.setHudVisible(false);
    ui.showLoading(true, { title: 'Z04 · Relay Overlook', subtitle: 'Encounter E2 — two receivers, three routes', art: 'relay-route' });
    step(1.1);
  },
  death() {
    combatScene(true);
    fake.hud.hp = 0;
    ui.showDeath({ onRetry: () => { ui.hideDeath(); fake.log.push('retry'); } });
    step(2.4);
  },
  complete() {
    ui.setHudVisible(false);
    ui.showMissionComplete({
      state: {} as never,
      lines: [
        { label: 'Containment', value: 'Closed' }, { label: 'Meridian', value: 'Complete — 5 / 5' },
        { label: 'Release', value: 'Withheld' }, { label: 'Local priority', value: 'West — stretcher cases first' },
        { label: 'Evidence', value: 'Exchanged' }, { label: 'Pact', value: 'Agreed' },
        { label: 'Optional records', value: '3 / 4' }, { label: 'Mission time', value: '48:12' },
      ],
    }, { onTitle: () => fake.log.push('title') });
    step(7);
  },
  'fade-gold'() { backdrop('crownmark'); ui.setHudVisible(false); ui.fade(0.8, 0, 'gold'); step(0.2); },
  debug() { combatScene(false); game.settings.set('showFps', true); ui.debugText('zone Z08 · beat e4_phaseB\nhostiles 4 / cap 5\nlinks 2'); step(0.8); },
};

function scene(name: string): string | string[] {
  const fn = SCENES[name];
  if (!fn) return Object.keys(SCENES);
  try { localStorage.removeItem('aurelion.settings.v1'); } catch { /* ignore */ }
  build();
  backdrop('grey');
  fn();
  return name;
}

Object.assign(window, {
  __scene: scene,
  __step: (s: number) => step(s),
  __press: (k: string, settle?: number) => press(k, settle),
  __log: () => fake.log.slice(),
});

addEventListener('keydown', (e) => {
  const a = KEYMAP[e.code];
  if (a) fake.pressed.add(a);
});
addEventListener('error', (e) => ((window as unknown as { __aurelionErrors?: string[] }).__aurelionErrors ??= []).push(String(e.error?.stack ?? e.message)));

if (params.has('bar')) {
  const bar = document.createElement('div');
  bar.id = 'bar';
  for (const name of Object.keys(SCENES)) {
    const b = document.createElement('button');
    b.textContent = name;
    b.onclick = () => scene(name);
    bar.appendChild(b);
  }
  document.body.appendChild(bar);
}

build();
backdrop(params.get('bg') ?? 'grey');
void ui.init().then(() => {
  const first = params.get('scene');
  if (first) scene(first);
  if (!manual) {
    let last = performance.now();
    const loop = (now: number): void => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      simTime += dt;
      game.time.now = simTime;
      game.time.dt = dt;
      ui.update(dt);
      fake.pressed.clear();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
  (window as unknown as { __ready: boolean }).__ready = true;
});
