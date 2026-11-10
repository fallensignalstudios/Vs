/**
 * PBR layer buffers → packed 8-bit maps → GPU textures.
 *
 * A family generator fills a {@link PbrLayers} (linear float channels); {@link packLayers} derives the normal map
 * from the height channel and packs three RGBA8 images:
 *
 *   albedo  RGB = base colour (sRGB encoded)          A = height
 *   normal  RGB = tangent-space normal (+Z out)       A = 255
 *   orm     R = ambient occlusion  G = roughness variation (0.5 = the material's nominal roughness)
 *           B = metalness multiplier                  A = accent / wear mask
 */
import * as THREE from 'three';
import { normalsFromHeight } from './features';

export interface PbrLayers {
  size: number;
  /** linear RGB albedo */
  r: Float32Array;
  g: Float32Array;
  b: Float32Array;
  /** height 0 … 1 (drives the normal map) */
  height: Float32Array;
  /** roughness variation centred on 0.5 */
  rough: Float32Array;
  /** metalness multiplier 0 … 1 */
  metal: Float32Array;
  /** ambient occlusion 0 … 1 */
  ao: Float32Array;
  /** accent / wear mask 0 … 1 (meaning is per family: gold-leaf wear, chips, veins, cracks, cloud density) */
  mask: Float32Array;
  /** feature height ÷ tile width; scales the derived normals */
  relief: number;
}

export interface PackedMaps {
  size: number;
  albedo: Uint8Array;
  normal: Uint8Array;
  orm: Uint8Array;
}

export interface TextureSet {
  size: number;
  albedo: THREE.DataTexture;
  normal: THREE.DataTexture;
  orm: THREE.DataTexture;
}

/** Fresh layers with neutral defaults: white albedo, mid height, nominal roughness, full metal multiplier, no AO. */
export function newLayers(size: number, relief: number): PbrLayers {
  const n = size * size;
  const fill = (v: number): Float32Array => new Float32Array(n).fill(v);
  return { size, r: fill(1), g: fill(1), b: fill(1), height: fill(0.5), rough: fill(0.5), metal: fill(1), ao: fill(1), mask: fill(0), relief };
}

const SRGB_LUT = (() => {
  const lut = new Uint8Array(4097);
  for (let i = 0; i <= 4096; i++) {
    const c = i / 4096;
    const s = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
    lut[i] = Math.round(Math.min(1, Math.max(0, s)) * 255);
  }
  return lut;
})();

/** Linear [0, 1] → sRGB byte. */
export const toSrgb8 = (c: number): number => SRGB_LUT[c <= 0 ? 0 : c >= 1 ? 4096 : (c * 4096) | 0];

const to8 = (v: number): number => (v <= 0 ? 0 : v >= 1 ? 255 : (v * 255 + 0.5) | 0);

/** sRGB hex → linear RGB triple. */
export function linearRgb(hex: number): [number, number, number] {
  const f = (c: number): number => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return [f(((hex >> 16) & 255) / 255), f(((hex >> 8) & 255) / 255), f((hex & 255) / 255)];
}

/** Derive normals and pack the layers into three RGBA8 images (pure CPU; no GPU access). */
export function packLayers(l: PbrLayers): PackedMaps {
  const n = l.size * l.size;
  const albedo = new Uint8Array(n * 4);
  const normal = new Uint8Array(n * 4);
  const orm = new Uint8Array(n * 4);
  const nrm = normalsFromHeight({ size: l.size, data: l.height }, l.relief);
  for (let i = 0; i < n; i++) {
    const o = i * 4, p = i * 3;
    albedo[o] = toSrgb8(l.r[i]); albedo[o + 1] = toSrgb8(l.g[i]); albedo[o + 2] = toSrgb8(l.b[i]); albedo[o + 3] = to8(l.height[i]);
    normal[o] = to8(nrm[p] * 0.5 + 0.5); normal[o + 1] = to8(nrm[p + 1] * 0.5 + 0.5); normal[o + 2] = to8(nrm[p + 2] * 0.5 + 0.5); normal[o + 3] = 255;
    orm[o] = to8(l.ao[i]); orm[o + 1] = to8(l.rough[i]); orm[o + 2] = to8(l.metal[i]); orm[o + 3] = to8(l.mask[i]);
  }
  return { size: l.size, albedo, normal, orm };
}

/** Wrap an RGBA8 buffer as a repeating, mip-mapped texture. */
export function dataTexture(data: Uint8Array, size: number, srgb: boolean, anisotropy: number, name: string): THREE.DataTexture {
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.name = name;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = Math.max(1, anisotropy);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

export function toTextureSet(p: PackedMaps, anisotropy: number, name: string): TextureSet {
  return {
    size: p.size,
    albedo: dataTexture(p.albedo, p.size, true, anisotropy, `${name}.albedo`),
    normal: dataTexture(p.normal, p.size, false, anisotropy, `${name}.normal`),
    orm: dataTexture(p.orm, p.size, false, anisotropy, `${name}.orm`),
  };
}

/** 1×1 stand-in set used before `init()` has baked the real maps (flat normal, neutral ORM, white albedo). */
export function placeholderSet(name: string): TextureSet {
  return toTextureSet(
    { size: 1, albedo: new Uint8Array([255, 255, 255, 128]), normal: new Uint8Array([128, 128, 255, 255]), orm: new Uint8Array([255, 128, 255, 0]) },
    1, `${name}.placeholder`,
  );
}
