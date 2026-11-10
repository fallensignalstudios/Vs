/**
 * Z07 — small in-world text: the two personal displays (Selene's command strip, Tarrik's Crownwatch display), the
 * labels of the interoperability streams and the lines of the contamination record. A canvas-texture quad,
 * additive and slightly HDR (it blooms a little), fading on the sim clock; a skip snaps it.
 *
 * Presentation only: every string a panel shows is also given to the subtitle stream by the scene that lights it
 * (accessibility contract), so nothing is lost when a panel is small or off screen.
 */
import * as THREE from 'three';

export interface TextPanelOpts {
  /** text lines, top to bottom */
  lines: string[];
  /** width of the quad in metres (its height follows the canvas) */
  width: number;
  /** glyph colour */
  color: number;
  /** HDR multiplier on the colour (above ~1.4 it blooms; default 1.7) */
  intensity?: number;
  /** most lines the panel will show (fixes the canvas size; default 1) */
  maxRows?: number;
  /** text alignment (default 'center') */
  align?: 'left' | 'center';
  /** corner ticks and faint scan lines (default true) */
  frame?: boolean;
}

export interface TextPanel {
  /** a quad facing local +Z — rotate the object to aim it */
  readonly object: THREE.Mesh;
  setLines(lines: string[]): void;
  /** fade toward `level` (0…1) over about `seconds` */
  show(level: number, seconds?: number): void;
  readonly level: number;
  /** advance the fade; `snap` jumps to the target (skip / restore) */
  update(dt: number, snap: boolean): void;
  dispose(): void;
}

const CANVAS_W = 1024;
const PX = 64;
const FAMILY = '"Barlow Condensed", "Barlow", "Arial Narrow", sans-serif';

export function textPanel(o: TextPanelOpts): TextPanel {
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  const tex = canvas ? new THREE.CanvasTexture(canvas) : null;
  if (tex) {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
  }
  const mat = new THREE.MeshBasicMaterial({
    map: tex, color: new THREE.Color(o.color).multiplyScalar(o.intensity ?? 1.7), transparent: true, opacity: 0,
    depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  mesh.name = 'z07-text';
  mesh.renderOrder = 4;
  mesh.visible = false;

  const rows = Math.max(1, o.maxRows ?? 1);
  const lineH = Math.round(PX * 1.42);
  const pad = Math.round(PX * 0.6);
  const h = rows * lineH + pad * 2;
  mesh.scale.set(o.width, o.width * (h / CANVAS_W), 1);
  if (canvas) {
    canvas.width = CANVAS_W;
    canvas.height = h;
  }
  const left = o.align === 'left';

  const draw = (lines: string[]): void => {
    const g = canvas?.getContext('2d');
    if (!g || !tex) return;
    const shown = lines.slice(0, rows);
    const top = Math.round((h - shown.length * lineH) / 2);
    g.clearRect(0, 0, CANVAS_W, h);
    g.fillStyle = '#ffffff';
    g.textAlign = left ? 'left' : 'center';
    g.textBaseline = 'middle';
    let size = PX;
    g.font = `600 ${size}px ${FAMILY}`;
    const widest = Math.max(1, ...shown.map((l) => g.measureText(l).width));
    if (widest > CANVAS_W - pad * 2) {
      size = Math.floor((size * (CANVAS_W - pad * 2)) / widest);
      g.font = `600 ${size}px ${FAMILY}`;
    }
    shown.forEach((l, i) => g.fillText(l, left ? pad : CANVAS_W / 2, top + lineH * (i + 0.5)));
    if (o.frame !== false) {
      g.globalAlpha = 0.45;
      g.lineWidth = 3;
      g.strokeStyle = '#ffffff';
      const t = Math.round(PX * 0.45);
      const y0 = 5;
      const y1 = h - 5;
      for (const [x, y, dx, dy] of [[5, y0, 1, 1], [CANVAS_W - 5, y0, -1, 1], [5, y1, 1, -1], [CANVAS_W - 5, y1, -1, -1]] as const) {
        g.beginPath();
        g.moveTo(x + dx * t, y);
        g.lineTo(x, y);
        g.lineTo(x, y + dy * t);
        g.stroke();
      }
      // light in the air, not a screen
      g.globalAlpha = 0.07;
      for (let y = y0; y < y1; y += 6) g.fillRect(0, y, CANVAS_W, 2);
      g.globalAlpha = 1;
    }
    tex.needsUpdate = true;
  };
  draw(o.lines);

  let level = 0;
  let target = 0;
  let rate = 2;
  let flick = 0;
  return {
    object: mesh,
    setLines: draw,
    show(l, seconds = 0.5) {
      const next = Math.min(1, Math.max(0, Number.isFinite(l) ? l : 0));
      if (next > target && level < 0.05) flick = 0.3;
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
      // a short unsteady flicker when it first lights, then still
      const unsteady = flick > 0 && !snap ? 0.6 + 0.4 * Math.abs(Math.sin(flick * 61)) : 1;
      mat.opacity = level * unsteady;
      mesh.visible = level > 0.002;
    },
    dispose() {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      mat.dispose();
      tex?.dispose();
    },
  };
}
