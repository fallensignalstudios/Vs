/**
 * Hologram displays (OWNER: hero-props) — additive data displays built from quads, ribbons and glyph cells in
 * one mesh each, drawn with the library's `hologram` material (scanlines, flicker, reveal).
 *
 * Draw calls: 1 per display.
 */
import type * as THREE from 'three';
import type { HologramKind, HologramProp, MaterialLibrary } from '@/core/api';
import { clamp01 } from '@/core/mathx';
import { PropBase, spring, warnOnce } from '../base';
import { HoloCanvas } from './canvas';
import { casualtyLog, contaminationRecord, forecast, threatStreams, type Content } from './flat';
import { diagnostic, sensorReconstruction, trajectory } from './spatial';

interface KindDef {
  build(c: HoloCanvas): Content;
  /** quad pool size */
  max: number;
  /** flat panels are turned to face the front and float at reading height */
  flat: boolean;
  gain: number;
  /** height of the display's centre above the prop origin (socket `center`) */
  center: number;
}

// pool sizes include the longer text fields (40-character headers, 32-character labels: 15 quads a character)
const KINDS: Record<HologramKind, KindDef> = {
  trajectory: { build: trajectory, max: 1200, flat: false, gain: 3.4, center: 1.5 },
  threatStreams: { build: threatStreams, max: 3200, flat: true, gain: 3.2, center: 1.5 },
  diagnostic: { build: diagnostic, max: 1400, flat: false, gain: 3.2, center: 1.55 },
  forecast: { build: forecast, max: 1400, flat: true, gain: 3.4, center: 1.5 },
  casualtyLog: { build: casualtyLog, max: 3700, flat: true, gain: 3.0, center: 1.5 },
  contaminationRecord: { build: contaminationRecord, max: 1900, flat: true, gain: 3.2, center: 1.5 },
  sensorReconstruction: { build: sensorReconstruction, max: 1300, flat: false, gain: 3.4, center: 1.3 },
};

type Params = { progress: number; visible: number };

export class Hologram extends PropBase<Params> implements HologramProp {
  private readonly canvas: HoloCanvas;
  private readonly content: Content;
  private readonly material: THREE.MeshBasicMaterial;

  constructor(lib: MaterialLibrary | null, kind: HologramKind) {
    let def = (KINDS as Record<string, KindDef | undefined>)[kind];
    if (!def) {
      warnOnce(`unknown hologram kind "${String(kind)}" — using "forecast"`);
      def = KINDS.forecast;
    }
    super(`hologram.${kind}`, lib, { progress: 0, visible: 1 }, { progress: spring(7, 1), visible: spring(8, 1) });
    this.canvas = new HoloCanvas(def.max);
    this.content = def.build(this.canvas);
    this.material = this.mk.holo(def.gain);
    const mesh = this.canvas.mesh(this.material);
    mesh.name = 'display';
    if (def.flat) {
      mesh.position.y = def.center;
      mesh.rotation.y = Math.PI;
    }
    this.object.add(mesh);
    this.addSocket('center', 0, def.center, 0, Math.PI);
    this.addSocket('viewer', 0, 0, -2.2, Math.PI);
    this.ready();
  }

  setText(text: string): void {
    this.content.setText(typeof text === 'string' ? text : String(text ?? ''));
  }

  setLabel(slot: string, text: string): void {
    const t = typeof text === 'string' ? text : String(text ?? '');
    if (slot === 'header') { this.content.setText(t); return; }
    if (!this.content.setLabel?.(String(slot), t)) warnOnce(`hologram ${this.object.name}: no label slot "${String(slot)}"`);
  }

  protected apply(_dt: number, time: number): void {
    const v = clamp01(this.cur.visible);
    this.object.visible = v > 0.004;
    if (!this.object.visible) return;
    this.mk.holoReveal(this.material, v);
    this.content.update(clamp01(this.cur.progress), time);
    this.canvas.commit();
  }
}
