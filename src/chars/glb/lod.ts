/**
 * Distance levels of detail for generated meshes.
 *
 * The levels are baked offline (scratchpad lodbake → public/models/<name>.lod.bin, manifest field `lod`) with
 * meshoptimizer. A level is only an INDEX BUFFER into the model's own vertex buffer (simplification never makes
 * vertices), so at load it becomes a BufferGeometry that shares every attribute of the loaded mesh — including
 * the skin weights the analysis re-wrote for the curl bones — and costs one small index buffer on the GPU.
 *
 * LodSwitch picks a level per character from its projected height on screen (a fraction of the viewport, so
 * the choice is resolution independent) and swaps the geometry of the meshes it governs. three.js calls
 * `update(camera)` on LOD objects while it walks the scene for a render, before any mesh below it is drawn, so
 * the choice is made with the camera of THIS frame — a cut to a close-up never shows a coarse body. Only the
 * game's main camera decides: mirror, probe and shadow renders reuse that choice. Shadows are cast by the same
 * geometry, so a distant figure's shadow is as cheap as its body.
 */
import * as THREE from 'three';

/** One mesh under level control: `levels[0]` is the full geometry. */
export interface LodEntry {
  mesh: THREE.Mesh;
  levels: THREE.BufferGeometry[];
}

/**
 * Projected-height fractions (of the viewport height) below which level 1 / level 2 take over, at quality
 * 'high'. A 1.9 m figure at the follow distance (3.4 m, FOV 62°) fills ≈ 0.46: it always stays at level 0.
 */
export const LOD_SCREEN: readonly [number, number] = [0.3, 0.1];
/** a level is left only when the size is this much (relative) past its threshold — no flicker at the boundary */
const HYSTERESIS = 0.14;
/** threshold multipliers per quality level (higher = coarser sooner) */
const QUALITY_BIAS: Readonly<Record<string, number>> = { low: 1.7, medium: 1.3, high: 1, ultra: 0.7 };

let enabled = true;
try {
  if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('lod') === '0') enabled = false;
} catch { /* no page */ }

/** Master switch (default on; `?lod=0` starts it off): off = every generated mesh draws its full geometry. */
export function setCharacterLodEnabled(on: boolean): void { enabled = !!on; }
export function characterLodEnabled(): boolean { return enabled; }

/**
 * Parse a baked .lod.bin against the geometry it was baked from. Returns the coarser levels (level 1 first) as
 * geometries sharing `base`'s attributes, or null when the file does not belong to this geometry.
 *
 * Layout (little-endian u32 words): 'ALOD', version 1, vertex count, bytes per index (2|4), level count, index
 * count per level, then each level's indices padded to 4 bytes.
 */
export function parseLodFile(buf: ArrayBuffer, base: THREE.BufferGeometry): THREE.BufferGeometry[] | null {
  try {
    if (buf.byteLength < 20) return null;
    const dv = new DataView(buf);
    const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
    const version = dv.getUint32(4, true), vc = dv.getUint32(8, true), bpi = dv.getUint32(12, true), n = dv.getUint32(16, true);
    const pos = base.getAttribute('position');
    if (magic !== 'ALOD' || version !== 1 || !pos || vc !== pos.count || (bpi !== 2 && bpi !== 4) || n < 1 || n > 4) return null;
    let off = 20 + n * 4;
    if (off > buf.byteLength) return null;
    const out: THREE.BufferGeometry[] = [];
    for (let k = 0; k < n; k++) {
      const count = dv.getUint32(20 + k * 4, true);
      const bytes = count * bpi;
      if (count % 3 !== 0 || off + bytes > buf.byteLength) return null;
      const idx = bpi === 2 ? new Uint16Array(buf.slice(off, off + bytes)) : new Uint32Array(buf.slice(off, off + bytes));
      for (let i = 0; i < idx.length; i++) if (idx[i] >= vc) return null;
      off += Math.ceil(bytes / 4) * 4;
      out.push(shareAttributes(base, idx));
    }
    return out;
  } catch {
    return null;
  }
}

/** a geometry drawing `index` over `base`'s vertex attributes (shared objects: one GPU buffer each) */
export function shareAttributes(base: THREE.BufferGeometry, index: Uint16Array | Uint32Array): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  for (const name of Object.keys(base.attributes)) g.setAttribute(name, base.getAttribute(name));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  g.boundingBox = base.boundingBox;
  g.boundingSphere = base.boundingSphere;
  g.name = base.name + ':lod';
  return g;
}

const _cam = new THREE.Vector3(), _at = new THREE.Vector3();

export interface LodSwitchOpts {
  /** standing height of the figure (metres) */
  height: () => number;
  /** the camera that decides (the game's main camera); null = any perspective camera narrower than 80° */
  mainCamera: () => THREE.Camera | null;
  /** current quality level name ('low' | 'medium' | 'high' | 'ultra') */
  quality: () => string;
}

/**
 * Per-character level switch. Add it to the character's root BEFORE the meshes it governs (it is an
 * Object3D with no geometry of its own); it swaps `mesh.geometry` of every entry to the chosen level.
 */
export class LodSwitch extends THREE.LOD {
  /** chosen level (0 = full) */
  current = 0;
  private readonly entries: LodEntry[] = [];

  constructor(private readonly opts: LodSwitchOpts) {
    super();
    this.name = 'lodSwitch';
  }

  /** put `mesh` under level control (`levels`: coarser geometries, level 1 first) */
  govern(mesh: THREE.Mesh, levels: readonly THREE.BufferGeometry[]): void {
    if (!levels.length) return;
    this.entries.push({ mesh, levels: [mesh.geometry, ...levels] });
    this.apply(this.current);
  }

  get governed(): number { return this.entries.length; }

  /** triangles drawn by the governed meshes at the current level */
  get triangles(): number {
    let n = 0;
    for (const e of this.entries) {
      const g = e.mesh.geometry;
      n += (g.index ? g.index.count : g.getAttribute('position')?.count ?? 0) / 3;
    }
    return Math.round(n);
  }

  /** the level a figure of this projected size should use, given the level it is at now */
  static pick(frac: number, current: number, bias: number): number {
    const t1 = LOD_SCREEN[0] * bias, t2 = LOD_SCREEN[1] * bias;
    // thresholds move away from the current level: it takes a clear change in size to leave it
    const up = 1 + HYSTERESIS, down = 1 - HYSTERESIS;
    const a = current >= 1 ? t1 * up : t1 * down;
    const b = current >= 2 ? t2 * up : t2 * down;
    return frac >= a ? 0 : frac >= b ? 1 : 2;
  }

  override update(camera: THREE.Camera): void {
    if (!this.entries.length) return;
    if (!enabled) { if (this.current !== 0) this.apply(0); return; }
    const main = this.opts.mainCamera();
    const persp = camera as THREE.PerspectiveCamera;
    if (main ? camera !== main : !(persp.isPerspectiveCamera && persp.fov < 80)) return;
    if (!persp.isPerspectiveCamera) return;
    const h = Math.max(0.2, this.opts.height());
    _cam.setFromMatrixPosition(camera.matrixWorld);
    this.getWorldPosition(_at);
    _at.y += h * 0.5;
    const d = Math.max(0.05, _cam.distanceTo(_at));
    const frac = (h * (persp.zoom || 1)) / (2 * d * Math.tan(THREE.MathUtils.degToRad(persp.fov) * 0.5));
    const bias = QUALITY_BIAS[this.opts.quality()] ?? 1;
    const lvl = LodSwitch.pick(frac, this.current, bias);
    if (lvl !== this.current) this.apply(lvl);
  }

  private apply(level: number): void {
    this.current = level;
    for (const e of this.entries) e.mesh.geometry = e.levels[Math.min(level, e.levels.length - 1)];
  }

  /** back to full geometry and release the entries (the geometries belong to the model templates) */
  release(): void {
    this.apply(0);
    this.entries.length = 0;
    this.removeFromParent();
  }
}
