/**
 * Z11 / Z12 — small in-world text projections: the command-strip projection over the table (the two versions of
 * the Admonition, the authority summary), the comm messages on the leads' forearm units and the fleet alerts "in
 * the room's own air". A canvas-texture quad, additive, HDR (blooms a little), fading on the sim clock.
 *
 * The text is the book's on-screen text, exact; the panel never invents any. It is a presentation layer only:
 * every line it shows is ALSO given to the subtitle stream by the scene (accessibility contract), so nothing is
 * lost when a panel is off screen or too small to read.
 */
import * as THREE from 'three';
import type { UiSystem, WorldTextOpts } from '@/core/api';

export interface TextPanelOpts {
  /** text lines, top to bottom */
  lines: string[];
  /** width of the quad in metres (height follows the text block) */
  width: number;
  /** light colour of the glyphs */
  color: number;
  /** HDR multiplier on the colour (above ~1.4 it blooms; default 1.8) */
  intensity?: number;
  /** pixel height of a text line on the canvas (default 64) */
  px?: number;
  /** draw a thin frame with corner ticks around the block (default true) */
  frame?: boolean;
  /** CSS font family (default the HUD's condensed face) */
  family?: string;
  /** most lines the panel will ever show (fixes its size; default 3) */
  maxRows?: number;
  /**
   * ADDED (polish 4): a legible screen-space twin of the text (`ui.worldText`): a dark plate over the panel that
   * follows it, fades with it and never draws below the UI's minimum size, so the book's text reads at 720p.
   * `size` = cap height in metres in the world (the label grows as the camera comes closer).
   */
  label?: { id: string; tone: NonNullable<WorldTextOpts['tone']>; size: number };
}

export interface TextPanel {
  readonly object: THREE.Mesh;
  /** replace the text (re-renders the canvas; cheap, but not every frame) */
  setLines(lines: string[]): void;
  /** fade target 0…1 (ease ~`seconds`, default 0.5); a skip snaps through `update(dt, true)` */
  show(level: number, seconds?: number): void;
  /** current opacity 0…1 */
  readonly level: number;
  update(dt: number, snap: boolean): void;
  /** polish 4: keep the screen-space label (if any) in step with the panel — call after `update` each frame */
  syncLabel(ui: UiSystem | null | undefined): void;
  dispose(): void;
}

const CANVAS_W = 1024;

/** a projection quad facing +Z (rotate the object to aim it). Starts hidden. */
export function textPanel(o: TextPanelOpts): TextPanel {
  const px = o.px ?? 64;
  const family = o.family ?? '"Barlow Condensed", "Barlow", "Arial Narrow", sans-serif';
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  const tex = canvas ? new THREE.CanvasTexture(canvas) : null;
  if (tex) {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
  }
  const colour = new THREE.Color(o.color).multiplyScalar(o.intensity ?? 1.8);
  const mat = new THREE.MeshBasicMaterial({
    map: tex, color: colour, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending, fog: false, toneMapped: true,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  mesh.name = 'text-panel';
  mesh.renderOrder = 4;
  mesh.visible = false;
  let level = 0;
  let target = 0;
  let rate = 2;
  let flick = 0;

  // the canvas keeps one size for the panel's life (a GPU texture cannot change size once uploaded): room for
  // `maxRows` lines, the block centred vertically; the quad keeps the canvas aspect
  const maxRows = Math.max(1, o.maxRows ?? 3);
  const lineH = Math.round(px * 1.42);
  const pad = Math.round(px * 0.7);
  const h = maxRows * lineH + pad * 2;
  mesh.scale.set(o.width, o.width * (h / CANVAS_W), 1);
  if (canvas) {
    canvas.width = CANVAS_W;
    canvas.height = h;
  }
  const draw = (lines: string[]): void => {
    if (!canvas || !tex) return;
    const g = canvas.getContext('2d');
    if (!g) return;
    const rows = Math.min(maxRows, Math.max(1, lines.length));
    const top = Math.round((h - rows * lineH) / 2);
    g.clearRect(0, 0, CANVAS_W, h);
    g.fillStyle = '#ffffff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    // fit the longest line to the width
    let size = px;
    g.font = `600 ${size}px ${family}`;
    const widest = Math.max(1, ...lines.map((l) => g.measureText(l).width));
    if (widest > CANVAS_W - pad * 2) {
      size = Math.floor(size * (CANVAS_W - pad * 2) / widest);
      g.font = `600 ${size}px ${family}`;
    }
    lines.slice(0, rows).forEach((l, i) => g.fillText(l, CANVAS_W / 2, top + lineH * (i + 0.5)));
    if (o.frame !== false) {
      g.globalAlpha = 0.45;
      g.lineWidth = 3;
      g.strokeStyle = '#ffffff';
      const t = Math.round(px * 0.5);
      const inset = 6;
      const y0 = Math.max(inset, top - pad + inset);
      const y1 = Math.min(h - inset, top + rows * lineH + pad - inset);
      for (const [x, y, dx, dy] of [[inset, y0, 1, 1], [CANVAS_W - inset, y0, -1, 1], [inset, y1, 1, -1], [CANVAS_W - inset, y1, -1, -1]] as const) {
        g.beginPath();
        g.moveTo(x + dx * t, y);
        g.lineTo(x, y);
        g.lineTo(x, y + dy * t);
        g.stroke();
      }
      // faint scan lines: it is light in the air, not a screen
      g.globalAlpha = 0.07;
      for (let y = y0; y < y1; y += 6) g.fillRect(0, y, CANVAS_W, 2);
      g.globalAlpha = 1;
    }
    tex.needsUpdate = true;
  };
  draw(o.lines);
  // the screen-space label: what it last showed, so the UI is only told when something changed
  let text = o.lines.join('\n').trim();
  let shown: { text: string; opacity: number } | null = null;
  let labelUi: UiSystem | null = null;

  return {
    object: mesh,
    setLines(lines) {
      draw(lines);
      text = lines.join('\n').trim();
    },
    show(l, seconds = 0.5) {
      const next = Math.min(1, Math.max(0, Number.isFinite(l) ? l : 0));
      if (next > target && level < 0.05) flick = 0.35;
      target = next;
      rate = 1 / Math.max(0.05, seconds);
    },
    get level() {
      return level;
    },
    update(dt, snap) {
      if (snap) level = target;
      else level += Math.sign(target - level) * Math.min(Math.abs(target - level), rate * Math.max(0, dt));
      flick = Math.max(0, flick - dt);
      // a short unsteady flicker when a projection first lights, then still
      const unsteady = flick > 0 && !snap ? 0.6 + 0.4 * Math.abs(Math.sin(flick * 61)) : 1;
      mat.opacity = level * unsteady;
      mesh.visible = level > 0.002;
    },
    syncLabel(ui) {
      const l = o.label;
      if (!l || !ui?.worldText) return;
      labelUi = ui;
      const opacity = Math.round(mat.opacity * 50) / 50;
      if (!mesh.visible || opacity <= 0.02 || !text) {
        if (shown) ui.worldText(l.id, null);
        shown = null;
        return;
      }
      if (shown && shown.text === text && shown.opacity === opacity) return;
      shown = { text, opacity };
      ui.worldText(l.id, { at: mesh, faces: { x: 0, y: 0, z: 1 }, text, tone: l.tone, size: l.size, opacity });
    },
    dispose() {
      if (o.label && shown) labelUi?.worldText?.(o.label.id, null);
      shown = null;
      mesh.removeFromParent();
      mesh.geometry.dispose();
      mat.dispose();
      tex?.dispose();
    },
  };
}
