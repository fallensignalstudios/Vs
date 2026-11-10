/**
 * Camera sandbox HUD — a thin diagnostic overlay in the game's UI tone (slate, parchment, aged gold, thin
 * rules, small caps): live input + camera state, a reticle while aiming, the lock-on marker projected through
 * `rig.worldToScreen`, letterbox bars during the cinematic demo and a control legend from `input.glyph()`.
 */
import type { ButtonAction, CameraRig, InputSystem, Vec3Like } from '@/core/api';
import { ACTIONS } from '@/core/input';

const CSS = `
.cs-root{position:fixed;inset:0;pointer-events:none;font:500 13px/1.35 'Barlow Condensed',system-ui,sans-serif;
  color:#d8d2c2;letter-spacing:.08em;text-transform:uppercase;font-variant-numeric:tabular-nums}
.cs-panel{position:absolute;left:28px;top:24px;width:268px;padding:14px 16px 12px;
  background:linear-gradient(180deg,rgba(9,12,18,.72),rgba(9,12,18,.46));border-top:1px solid rgba(201,164,92,.85);
  border-bottom:1px solid rgba(201,164,92,.25)}
.cs-title{font-weight:600;font-size:12px;letter-spacing:.3em;color:#c9a45c;margin-bottom:9px}
.cs-row{display:flex;justify-content:space-between;gap:12px;padding:1.5px 0;border-bottom:1px solid rgba(216,210,194,.07)}
.cs-row span:first-child{color:#8d93a0;letter-spacing:.16em;font-size:11.5px}
.cs-chips{display:flex;flex-wrap:wrap;gap:4px;margin-top:9px;min-height:21px}
.cs-chip{padding:1px 7px;border:1px solid rgba(201,164,92,.7);color:#f0e3c4;font-size:11.5px;background:rgba(201,164,92,.12)}
.cs-chip b{font-weight:600;color:#c9a45c;margin-right:5px}
.cs-stick{position:absolute;right:16px;top:14px;width:34px;height:34px;border:1px solid rgba(216,210,194,.28);border-radius:50%}
.cs-stick i{position:absolute;left:50%;top:50%;width:6px;height:6px;margin:-3px;border-radius:50%;background:#c9a45c}
.cs-root::after{content:'';position:absolute;left:0;right:0;bottom:0;height:120px;background:linear-gradient(180deg,rgba(5,7,11,0),rgba(5,7,11,.62))}
.cs-legend,.cs-note{z-index:1}
.cs-legend{position:absolute;left:0;right:0;bottom:22px;text-align:center;font-size:12px;color:#aeb3bd;letter-spacing:.12em;
  text-shadow:0 1px 6px rgba(0,0,0,.9)}
.cs-legend kbd{font:inherit;color:#f0e3c4;border:1px solid rgba(201,164,92,.6);padding:0 5px;margin:0 3px 0 10px;background:rgba(9,12,18,.55)}
.cs-note{position:absolute;left:0;right:0;bottom:50px;text-align:center;font-size:12px;color:#c9a45c;letter-spacing:.2em;
  text-shadow:0 1px 6px rgba(0,0,0,.9)}
.cs-reticle{position:absolute;left:50%;top:50%;width:0;height:0;opacity:0;transition:opacity .12s}
.cs-reticle i{position:absolute;background:#f4ead2;box-shadow:0 0 4px rgba(0,0,0,.9)}
.cs-lock{position:absolute;width:30px;height:30px;margin:-15px 0 0 -15px;border:1px solid #f4ead2;transform:rotate(45deg);
  box-shadow:0 0 6px rgba(0,0,0,.8),inset 0 0 6px rgba(0,0,0,.5);display:none}
.cs-lock::after{content:'';position:absolute;left:50%;top:50%;width:4px;height:4px;margin:-2px;background:#c9a45c}
.cs-locklabel{position:absolute;display:none;transform:translate(-50%,24px);font-size:11.5px;color:#f0e3c4;letter-spacing:.2em;
  text-shadow:0 1px 5px #000}
.cs-bar{position:absolute;left:0;right:0;height:0;background:#000;transition:height .5s cubic-bezier(.4,0,.2,1)}
.cs-menu{position:absolute;inset:0;display:none;place-items:center;background:rgba(5,7,11,.55);font-size:15px;letter-spacing:.4em;color:#c9a45c}
`;

const LEGEND: Array<[ButtonAction, string]> = [
  ['sprint', 'sprint'], ['dodge', 'dodge'], ['aim', 'aim'], ['attack', 'attack / fire'], ['heavy', 'heavy'],
  ['lockOn', 'lock-on'], ['swapShoulder', 'shoulder'], ['interact', 'cinematic'], ['pause', 'menu'],
];

export interface SandboxHud {
  update(state: { lockPoint: Vec3Like | null; lockName: string; cinematic: boolean; physics: string }): void;
  setVisible(v: boolean): void;
}

/** `instant` disables CSS transitions so headless screenshots are deterministic. */
export function createHud(input: InputSystem, rig: CameraRig, instant = false): SandboxHud {
  const style = document.createElement('style');
  style.textContent = instant ? `${CSS}.cs-root *{transition:none!important}` : CSS;
  document.head.appendChild(style);
  const root = document.createElement('div');
  root.className = 'cs-root';
  root.innerHTML = `
    <div class="cs-bar" style="top:0"></div><div class="cs-bar" style="bottom:0"></div>
    <div class="cs-panel">
      <div class="cs-title">Camera · Input</div>
      <div class="cs-stick"><i></i></div>
      <div class="cs-rows"></div>
      <div class="cs-chips"></div>
    </div>
    <div class="cs-reticle">
      <i style="left:-1px;top:-1px;width:2px;height:2px"></i>
      <i style="left:-13px;top:-.5px;width:7px;height:1px"></i><i style="left:6px;top:-.5px;width:7px;height:1px"></i>
      <i style="left:-.5px;top:-13px;width:1px;height:7px"></i><i style="left:-.5px;top:6px;width:1px;height:7px"></i>
    </div>
    <div class="cs-lock"></div><div class="cs-locklabel"></div>
    <div class="cs-note"></div>
    <div class="cs-legend"></div>
    <div class="cs-menu">Menu context · gameplay input suspended</div>`;
  document.body.appendChild(root);

  const q = <T extends HTMLElement>(sel: string): T => root.querySelector(sel) as T;
  const rows = q<HTMLDivElement>('.cs-rows');
  const chips = q<HTMLDivElement>('.cs-chips');
  const stick = q<HTMLElement>('.cs-stick i');
  const reticle = q<HTMLDivElement>('.cs-reticle');
  const lock = q<HTMLDivElement>('.cs-lock');
  const lockLabel = q<HTMLDivElement>('.cs-locklabel');
  const note = q<HTMLDivElement>('.cs-note');
  const legend = q<HTMLDivElement>('.cs-legend');
  const menu = q<HTMLDivElement>('.cs-menu');
  const bars = Array.from(root.querySelectorAll<HTMLDivElement>('.cs-bar'));

  const labels = ['Mode', 'Device', 'Look', 'Context', 'Yaw / pitch', 'Arm / FOV', 'Collision'];
  const cells: HTMLSpanElement[] = labels.map((label) => {
    const row = document.createElement('div');
    row.className = 'cs-row';
    const a = document.createElement('span');
    a.textContent = label;
    const b = document.createElement('span');
    row.append(a, b);
    rows.appendChild(row);
    return b;
  });

  const screen = { x: 0, y: 0 };
  let lastChips = '';
  let lastLegend = '';
  const deg = (r: number) => `${(r * 180 / Math.PI).toFixed(0)}°`;

  return {
    setVisible(v) {
      root.style.display = v ? '' : 'none';
    },
    update({ lockPoint, lockName, cinematic, physics }) {
      const values = [
        rig.mode, input.device === 'kbm' ? 'keyboard + mouse' : 'gamepad', input.lookMode, input.context,
        `${deg(rig.yaw)} / ${deg(rig.pitch)}`, `${rig.targetDistance.toFixed(2)} m / ${rig.camera.fov.toFixed(1)}°`, physics,
      ];
      for (let i = 0; i < cells.length; i++) if (cells[i].textContent !== values[i]) cells[i].textContent = values[i];

      stick.style.transform = `translate(${(input.move.x * 12).toFixed(1)}px,${(-input.move.y * 12).toFixed(1)}px)`;

      let held = '';
      const inGame = input.context === 'game';
      for (const a of ACTIONS) {
        // in play the stick / WASD also read as menu directions; that is noise on this panel
        if (inGame && (a.startsWith('menu') || a === 'confirm' || a === 'cancel' || a === 'skip')) continue;
        if (input.down(a)) held += `<span class="cs-chip"><b>${input.glyph(a)}</b>${a}</span>`;
      }
      if (held !== lastChips) chips.innerHTML = lastChips = held;

      let text = `<kbd>${input.device === 'kbm' ? 'WASD' : 'L-Stick'}</kbd>move`;
      for (const [a, label] of LEGEND) text += `<kbd>${input.glyph(a)}</kbd>${label}`;
      if (text !== lastLegend) legend.innerHTML = lastLegend = text;

      note.textContent = input.context !== 'game' ? '' : input.lookMode === 'drag'
        ? `No pointer lock — drag with ${input.glyph('aim')} to look · hold it still to aim · arrow keys turn · click to capture`
        : '';

      reticle.style.opacity = rig.aiming && rig.mode === 'follow' ? '1' : '0';
      const showLock = !!lockPoint && rig.mode === 'follow' && rig.worldToScreen(lockPoint, screen);
      lock.style.display = lockLabel.style.display = showLock ? 'block' : 'none';
      if (showLock) {
        lock.style.left = lockLabel.style.left = `${screen.x.toFixed(1)}px`;
        lock.style.top = lockLabel.style.top = `${screen.y.toFixed(1)}px`;
        if (lockLabel.textContent !== lockName) lockLabel.textContent = lockName;
      }
      for (const b of bars) b.style.height = cinematic ? '10.5%' : '0';
      menu.style.display = input.context === 'menu' ? 'grid' : 'none';
    },
  };
}
