/**
 * HoloCanvas — a fixed pool of quads (rects, ribbons, rings, glyph cells) in ONE indexed mesh with RGBA vertex
 * colours, drawn with the library's additive `hologram` material. A display is built once; afterwards only
 * alphas, colours and positions of existing quads change (no allocation, one draw call per display).
 */
import * as THREE from 'three';

/** a run of consecutive quads: [first id, count] */
export type Range = readonly [number, number];

/** 3 × 5 pixel font: five rows of three bits each, top row first, as octal digits */
const FONT: Record<string, string> = {
  '0': '75557', '1': '26227', '2': '71747', '3': '71717', '4': '55711', '5': '74717', '6': '74757', '7': '71222', '8': '75757', '9': '75717',
  A: '75755', B: '65656', C: '74447', D: '65556', E: '74747', F: '74744', G: '74557', H: '55755', I: '72227', J: '11157', K: '55655',
  L: '44447', M: '57755', N: '65555', O: '75557', P: '75744', Q: '75571', R: '75655', S: '74717', T: '72222', U: '55557', V: '55552',
  W: '55775', X: '55255', Y: '55222', Z: '71247', ':': '02020', '/': '11244', '.': '00002', '-': '00700', ' ': '00000',
};

/** 15-bit mask of a character (bit 14 = top-left … bit 0 = bottom-right); unknown characters are blank */
export function glyphMask(ch: string): number {
  const rows = FONT[ch.toUpperCase()] ?? FONT[' '];
  let m = 0;
  for (let r = 0; r < 5; r++) m = (m << 3) | (rows.charCodeAt(r) - 48);
  return m;
}

/** seven-segment masks (bit 0 = a top, b, c, d bottom, e, f, bit 6 = g middle) */
const SEG: Record<string, number> = { '0': 0x3f, '1': 0x06, '2': 0x5b, '3': 0x4f, '4': 0x66, '5': 0x6d, '6': 0x7d, '7': 0x07, '8': 0x7f, '9': 0x6f, '-': 0x40, ' ': 0 };

/** a row of pixel-font characters whose content can be replaced */
export interface TextField {
  readonly range: Range;
  set(text: string): void;
}

const _c = new THREE.Color();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _n = new THREE.Vector3();

export class HoloCanvas {
  private readonly pos: Float32Array;
  private readonly pos0: Float32Array;
  private readonly col: Float32Array;
  private readonly nrm: Float32Array;
  /** base alpha per quad (what `setAlpha(id, 1)` means) */
  private readonly alpha0: Float32Array;
  /** glyph gate per quad (text / segment cells that are switched off stay off whatever the fade) and fade level */
  private readonly gate: Float32Array;
  private readonly level: Float32Array;
  private used = 0;
  private posAttr: THREE.BufferAttribute | null = null;
  private colAttr: THREE.BufferAttribute | null = null;
  private dirtyPos = false;
  private dirtyCol = false;

  constructor(private readonly max: number) {
    this.pos = new Float32Array(max * 12);
    this.pos0 = new Float32Array(max * 12);
    this.col = new Float32Array(max * 16);
    this.nrm = new Float32Array(max * 12);
    this.alpha0 = new Float32Array(max);
    this.gate = new Float32Array(max).fill(1);
    this.level = new Float32Array(max).fill(1);
  }

  get count(): number {
    return this.used;
  }

  /** quad from four corners given as 12 numbers; returns its id (−1 when the pool is full) */
  quad(p: ArrayLike<number>, color: number, alpha = 1): number {
    if (this.used >= this.max) return -1;
    const id = this.used++;
    this.pos.set(p as number[], id * 12);
    this.pos0.set(p as number[], id * 12);
    _a.set(p[3] - p[0], p[4] - p[1], p[5] - p[2]);
    _b.set(p[9] - p[0], p[10] - p[1], p[11] - p[2]);
    _n.crossVectors(_a, _b).normalize();
    for (let k = 0; k < 4; k++) this.nrm.set([_n.x, _n.y, _n.z], id * 12 + k * 3);
    _c.setHex(color);
    for (let k = 0; k < 4; k++) this.col.set([_c.r, _c.g, _c.b, alpha], id * 16 + k * 4);
    this.alpha0[id] = alpha;
    return id;
  }

  /** axis-aligned rectangle in the XY plane, centred on (x, y) */
  rect(x: number, y: number, w: number, h: number, color: number, alpha = 1, z = 0): number {
    const a = w / 2, b = h / 2;
    return this.quad([x - a, y - b, z, x + a, y - b, z, x + a, y + b, z, x - a, y + b, z], color, alpha);
  }

  /** square standing on a corner (one quad) in the XY plane or lying in XZ */
  diamond(x: number, y: number, z: number, size: number, color: number, alpha = 1, flat = false): number {
    return flat
      ? this.quad([x - size, y, z, x, y, z - size, x + size, y, z, x, y, z + size], color, alpha)
      : this.quad([x - size, y, z, x, y - size, z, x + size, y, z, x, y + size, z], color, alpha);
  }

  private ribbon(ax: number, ay: number, az: number, bx: number, by: number, bz: number, width: number, second: boolean, out: number[]): void {
    _a.set(bx - ax, by - ay, bz - az);
    // width axis: perpendicular to the line and to Z (or to Y for the second, crossed ribbon / lines along Z)
    const alongZ = Math.abs(_a.z) > 0.999 * _a.length();
    _b.set(0, 0, 1);
    if (alongZ) _b.set(1, 0, 0);
    _n.crossVectors(_a, _b).normalize();
    if (second) _n.crossVectors(_a, _n).normalize();
    const hx = _n.x * width * 0.5, hy = _n.y * width * 0.5, hz = _n.z * width * 0.5;
    out[0] = ax - hx; out[1] = ay - hy; out[2] = az - hz;
    out[3] = bx - hx; out[4] = by - hy; out[5] = bz - hz;
    out[6] = bx + hx; out[7] = by + hy; out[8] = bz + hz;
    out[9] = ax + hx; out[10] = ay + hy; out[11] = az + hz;
  }

  private readonly tmp: number[] = new Array<number>(12).fill(0);

  /** ribbon from a to b. `cross` adds a second ribbon at right angles (2 quads) so it reads from every side */
  line(ax: number, ay: number, az: number, bx: number, by: number, bz: number, width: number, color: number, alpha = 1, cross = false): number {
    this.ribbon(ax, ay, az, bx, by, bz, width, false, this.tmp);
    const id = this.quad(this.tmp, color, alpha);
    if (cross) {
      this.ribbon(ax, ay, az, bx, by, bz, width, true, this.tmp);
      this.quad(this.tmp, color, alpha);
    }
    return id;
  }

  /** move an existing line (same `cross` as when it was created) */
  setLine(id: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, width: number, cross = false): void {
    if (id < 0) return;
    for (let k = 0; k < (cross ? 2 : 1); k++) {
      this.ribbon(ax, ay, az, bx, by, bz, width, k === 1, this.tmp);
      this.pos.set(this.tmp, (id + k) * 12);
    }
    this.dirtyPos = true;
  }

  /** circle / arc outline made of `seg` ribbons, in the XY plane (or XZ when `flat`) */
  circle(cx: number, cy: number, cz: number, r: number, width: number, color: number, alpha = 1, flat = false, seg = 32, a0 = 0, a1 = Math.PI * 2): Range {
    const first = this.used;
    for (let i = 0; i < seg; i++) {
      const ta = a0 + ((a1 - a0) * i) / seg, tb = a0 + ((a1 - a0) * (i + 1)) / seg;
      const ri = r - width / 2, ro = r + width / 2;
      const ca = Math.cos(ta), sa = Math.sin(ta), cb = Math.cos(tb), sb = Math.sin(tb);
      if (flat) this.quad([cx + ca * ri, cy, cz + sa * ri, cx + cb * ri, cy, cz + sb * ri, cx + cb * ro, cy, cz + sb * ro, cx + ca * ro, cy, cz + sa * ro], color, alpha);
      else this.quad([cx + ca * ri, cy + sa * ri, cz, cx + cb * ri, cy + sb * ri, cz, cx + cb * ro, cy + sb * ro, cz, cx + ca * ro, cy + sa * ro, cz], color, alpha);
    }
    return [first, this.used - first];
  }

  /**
   * Pixel-font text: `capacity` characters of 15 cells each, left edge at x, vertical centre at y. `dir` −1
   * mirrors the row for displays that are read from the −Z side without being turned around.
   */
  text(text: string, x: number, y: number, cell: number, color: number, alpha = 1, z = 0, dir = 1, capacity = text.length): TextField {
    const first = this.used;
    for (let i = 0; i < capacity; i++) {
      for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) {
        this.rect(x + dir * (i * cell * 4 + (c + 0.5) * cell), y + (2 - r) * cell, cell * 0.86, cell * 0.86, color, alpha, z);
      }
    }
    const range: Range = [first, this.used - first];
    const field: TextField = {
      range,
      set: (s: string): void => {
        for (let i = 0; i < capacity; i++) {
          const m = i < s.length ? glyphMask(s[i]) : 0;
          for (let b = 0; b < 15; b++) this.setGate(first + i * 15 + b, (m >> (14 - b)) & 1);
        }
      },
    };
    field.set(text);
    return field;
  }

  /**
   * Seven-segment digit cell (7 quads, slanted): returns its first id. Lit with {@link setSegments}.
   * `w` × `h` is the digit box, `t` the stroke thickness.
   */
  segments(x: number, y: number, w: number, h: number, t: number, color: number, alpha = 1, z = 0): number {
    const first = this.used;
    const sk = 0.12;
    const bar = (cx: number, cy: number, bw: number, bh: number): void => {
      const a = bw / 2, b = bh / 2;
      const s0 = (cy - b) * sk, s1 = (cy + b) * sk;
      this.quad([x + cx - a + s0, y + cy - b, z, x + cx + a + s0, y + cy - b, z, x + cx + a + s1, y + cy + b, z, x + cx - a + s1, y + cy + b, z], color, alpha);
    };
    const hw = w / 2, hh = h / 2, g = t * 0.25;
    bar(0, hh - t / 2, w - 2 * t - g, t);                 // a
    bar(hw - t / 2, hh / 2, t, hh - t - g);               // b
    bar(hw - t / 2, -hh / 2, t, hh - t - g);              // c
    bar(0, -hh + t / 2, w - 2 * t - g, t);                // d
    bar(-hw + t / 2, -hh / 2, t, hh - t - g);             // e
    bar(-hw + t / 2, hh / 2, t, hh - t - g);              // f
    bar(0, 0, w - 2 * t - g, t);                          // g
    return first;
  }

  /** light a seven-segment cell for a character; unlit segments keep a faint ghost */
  setSegments(first: number, ch: string, ghost = 0.06): void {
    const m = SEG[ch] ?? 0;
    for (let b = 0; b < 7; b++) this.setGate(first + b, (m >> b) & 1 ? 1 : ghost);
  }

  /** switch a glyph cell on / off (or to a ghost level) independently of the fade applied with `setAlpha` */
  setGate(id: number, g: number): void {
    if (id < 0 || id >= this.used || this.gate[id] === g) return;
    this.gate[id] = g;
    this.write(id);
  }

  private write(id: number): void {
    const v = this.alpha0[id] * this.gate[id] * this.level[id], o = id * 16 + 3;
    if (this.col[o] === v) return;
    this.col[o] = this.col[o + 4] = this.col[o + 8] = this.col[o + 12] = v;
    this.dirtyCol = true;
  }

  /** alpha as a fraction of the quad's authored alpha */
  setAlpha(id: number, a: number): void {
    if (id < 0 || id >= this.used || this.level[id] === a) return;
    this.level[id] = a;
    this.write(id);
  }

  fade(range: Range, a: number): void {
    for (let i = 0; i < range[1]; i++) this.setAlpha(range[0] + i, a);
  }

  setColor(id: number, color: number): void {
    if (id < 0 || id >= this.used) return;
    _c.setHex(color);
    for (let k = 0; k < 4; k++) {
      const o = id * 16 + k * 4;
      this.col[o] = _c.r; this.col[o + 1] = _c.g; this.col[o + 2] = _c.b;
    }
    this.dirtyCol = true;
  }

  /** place a run of quads at their authored position plus an offset */
  offset(range: Range, dx: number, dy: number, dz: number): void {
    const end = (range[0] + range[1]) * 12;
    for (let i = range[0] * 12; i < end; i += 3) {
      this.pos[i] = this.pos0[i] + dx;
      this.pos[i + 1] = this.pos0[i + 1] + dy;
      this.pos[i + 2] = this.pos0[i + 2] + dz;
    }
    this.dirtyPos = true;
  }

  /** build the mesh (call once, after every quad has been created) */
  mesh(material: THREE.Material): THREE.Mesh {
    const n = this.used;
    const g = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos.subarray(0, n * 12), 3);
    this.colAttr = new THREE.BufferAttribute(this.col.subarray(0, n * 16), 4);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.colAttr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.posAttr);
    g.setAttribute('color', this.colAttr);
    g.setAttribute('normal', new THREE.BufferAttribute(this.nrm.subarray(0, n * 12), 3));
    const index = new Uint32Array(n * 6);
    for (let i = 0; i < n; i++) index.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
    g.setIndex(new THREE.BufferAttribute(index, 1));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, material);
    m.frustumCulled = false;
    m.renderOrder = 6;
    return m;
  }

  /** upload what changed since the last call */
  commit(): void {
    if (this.dirtyPos && this.posAttr) this.posAttr.needsUpdate = true;
    if (this.dirtyCol && this.colAttr) this.colAttr.needsUpdate = true;
    this.dirtyPos = this.dirtyCol = false;
  }
}
