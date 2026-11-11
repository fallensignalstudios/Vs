/**
 * Low-poly, synchronous stand-ins of the two generated capitals: ~3 k / 1.5 k triangles with one colour per face,
 * baked offline from the GLBs (silhouettes.data.ts). They exist because some pieces cannot wait for a file: the
 * sky's fleet impostors are baked once at start-up, and a far-field capital needs something on screen while (or
 * if never) its GLB loads. Frame: the procedural hulls' (src/render/sky/scenic/hulls.ts) — nose −Z, +Y up,
 * metres, at the forge's length (capital 600 m, carrier 500 m), origin at the hull centre.
 */
import { SIL_DOMINIONCAPITAL, SIL_REFORMATIONCARRIER, type SilhouetteData } from './silhouettes.data';

export type SilhouetteId = 'dominionCapital' | 'reformationCarrier';

export interface Silhouette {
  /** vertex positions, metres, nose −Z */
  pos: Float32Array;
  idx: Uint16Array;
  /** per face: sRGB colour 0xRRGGBB and whether it lies on glowing texels */
  faceColor: Uint32Array;
  faceGlow: Uint8Array;
  tris: number;
}

/**
 * Light anchors on the silhouettes / generated capitals in the same frame (engine centres from the forge's
 * `engineGlow`, running lights on the tower / bridge top and the bow), for impostors that draw their own lights.
 */
export const SILHOUETTE_LIGHTS: Readonly<Record<SilhouetteId, { engines: ReadonlyArray<readonly [number, number, number]>; running: ReadonlyArray<readonly [number, number, number]> }>> = {
  dominionCapital: {
    engines: [[0, 0, 288], [-39.6, -25.8, 288], [39.6, -25.8, 288], [0, -58.8, 288]],
    running: [[0, 107, 125], [0, -2, -300]],
  },
  reformationCarrier: {
    engines: [[59.5, -2.5, 200], [-59.5, -2.5, 200], [52, -19, 195], [-52, -19, 195], [46, -35, 195], [-46, -35, 195]],
    running: [[0, 53, 125], [0, 0, -250]],
  },
};

const DATA: Record<SilhouetteId, { data: SilhouetteData; length: number; carrier: boolean }> = {
  dominionCapital: { data: SIL_DOMINIONCAPITAL, length: 600, carrier: false },
  reformationCarrier: { data: SIL_REFORMATIONCARRIER, length: 500, carrier: true },
};

const cache = new Map<SilhouetteId, Silhouette>();

function bytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Decode (once) a silhouette into the hull frame. */
export function silhouette(id: SilhouetteId): Silhouette {
  const have = cache.get(id);
  if (have) return have;
  const { data: d, length, carrier } = DATA[id] ?? DATA.dominionCapital;
  const pb = bytes(d.pos), ib = bytes(d.idx), cb = bytes(d.col), gb = bytes(d.glow);
  const q = new Int16Array(pb.buffer, pb.byteOffset, d.verts * 3);
  const pos = new Float32Array(d.verts * 3);
  for (let i = 0; i < d.verts; i++) {
    const r = [0, 1, 2].map((k) => d.min[k] + ((q[i * 3 + k] + 32768) / 65535) * (d.max[k] - d.min[k]));
    // raw file frame → nose −Z: the capital's nose is +Z (turn π), the carrier's +X (turn +π/2)
    const x = carrier ? r[2] : -r[0];
    const z = carrier ? -r[0] : -r[2];
    pos[i * 3] = x * length;
    pos[i * 3 + 1] = r[1] * length;
    pos[i * 3 + 2] = z * length;
  }
  const idx = new Uint16Array(ib.buffer.slice(ib.byteOffset, ib.byteOffset + d.tris * 6));
  const faceColor = new Uint32Array(d.tris);
  for (let f = 0; f < d.tris; f++) faceColor[f] = cb[f * 3] | (cb[f * 3 + 1] << 8) | (cb[f * 3 + 2] << 16);
  const out: Silhouette = { pos, idx, faceColor, faceGlow: gb.slice(0, d.tris), tris: d.tris };
  cache.set(id, out);
  return out;
}
