import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { Game, MatId } from '@/core/api';
import { createMaterialLibrary } from './index';
import { MAT_DEFS, MAT_IDS } from './defs';
import { clonePatch, ensureHost, findUniform, getHost, setPatchParam, type SurfacePatch } from './patch';

type FakeShader = { uniforms: Record<string, { value: unknown }>; vertexShader: string; fragmentShader: string; skinning?: boolean };
type Hook = (shader: FakeShader, renderer: null) => void;

/** What WebGLRenderer hands to onBeforeCompile, built from three's real shader sources. */
function fakeShader(material: THREE.Material, skinning = false): FakeShader {
  const lib = (material as THREE.MeshBasicMaterial).isMeshBasicMaterial ? THREE.ShaderLib.basic : THREE.ShaderLib.physical;
  return { uniforms: {}, vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader, skinning };
}

function compile(material: THREE.Material, skinning = false): FakeShader {
  const shader = fakeShader(material, skinning);
  (material.onBeforeCompile as unknown as Hook).call(material, shader, null);
  return shader;
}

const marker = (name: string): SurfacePatch => ({
  key: name,
  order: 30,
  uniforms: { [`u_${name}`]: { value: new THREE.Vector4(1, 2, 3, 4) }, sharedTex: { value: 'tex', shared: true } },
  fragmentPars: `// pars:${name}`,
  surface: `// surface:${name}`,
  params: { knob: { uniform: `u_${name}`, comp: 'y', map: (v) => v * 2 } },
});

afterEach(() => vi.restoreAllMocks());

describe('patch host', () => {
  it('composes patches into the standard shader without removing three chunks', () => {
    const m = new THREE.MeshStandardMaterial();
    const host = ensureHost(m);
    host.add(marker('b'));
    host.add({ ...marker('a'), order: 10 });
    const s = compile(m);
    expect(s.fragmentShader).toContain('// surface:a');
    expect(s.fragmentShader.indexOf('// surface:a')).toBeLessThan(s.fragmentShader.indexOf('// surface:b'));
    for (const chunk of ['#include <common>', '#include <normal_fragment_maps>', '#include <aomap_fragment>', '#include <lights_fragment_maps>', '#include <lights_physical_pars_fragment>']) {
      expect(s.fragmentShader).toContain(chunk);
    }
    expect(s.vertexShader).toContain('#include <project_vertex>');
    expect(s.vertexShader).toContain('vAurPos');
    expect(s.uniforms.aurTime).toBeDefined();
    expect(s.uniforms.u_a).toBeDefined();
    expect(ensureHost(m)).toBe(host);
  });

  it('switches to object-space mapping for skinned meshes and local hosts', () => {
    const m = new THREE.MeshStandardMaterial();
    ensureHost(m).add(marker('a'));
    expect(compile(m).fragmentShader.startsWith('#define AUR_LOCAL')).toBe(false);
    expect(compile(m, true).fragmentShader).toContain('#define AUR_LOCAL');
    ensureHost(m).local = true;
    expect(compile(m).vertexShader).toContain('#define AUR_LOCAL');
    expect(m.customProgramCacheKey()).toContain('aur:L');
  });

  it('runs a foreign hook assigned later (plain overwrite) after its own patches', () => {
    const m = new THREE.MeshStandardMaterial();
    ensureHost(m).add(marker('a'));
    const before = m.version;
    const seen: string[] = [];
    m.onBeforeCompile = (shader) => { seen.push(shader.fragmentShader.includes('// surface:a') ? 'patched' : 'raw'); shader.fragmentShader += '\n// foreign'; };
    expect(m.version).toBeGreaterThan(before);
    const s = compile(m);
    expect(seen).toEqual(['patched']);
    expect(s.fragmentShader).toContain('// foreign');
    expect(m.customProgramCacheKey()).toMatch(/^aur:W:a\|/);
  });

  it('survives a foreign hook and key that chain back to the previous ones (render-core pattern)', () => {
    const m = new THREE.MeshPhysicalMaterial();
    ensureHost(m).add(marker('a'));
    const prevCompile = m.onBeforeCompile;
    const prevKey = m.customProgramCacheKey;
    let calls = 0;
    m.onBeforeCompile = function (this: THREE.Material, shader, renderer): void {
      prevCompile.call(this, shader, renderer);
      calls++;
      shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_maps>', '#include <lights_fragment_maps>\n// refl');
    };
    m.customProgramCacheKey = function (this: THREE.Material): string { return `${prevKey.call(this)}|refl`; };
    const s = compile(m);
    expect(calls).toBe(1);
    expect(s.fragmentShader).toContain('// surface:a');
    expect(s.fragmentShader).toContain('// refl');
    expect((s.fragmentShader.match(/\/\/ surface:a/g) ?? []).length).toBe(1);
    const key = m.customProgramCacheKey();
    expect(key).toContain('|refl');
    expect(key.startsWith('aur:')).toBe(true);
  });

  it('keeps a hook that was already on a foreign material', () => {
    const m = new THREE.MeshStandardMaterial();
    m.onBeforeCompile = (shader) => { shader.fragmentShader += '\n// theirs'; };
    m.customProgramCacheKey = () => 'theirs';
    ensureHost(m).add(marker('a'));
    const s = compile(m);
    expect(s.fragmentShader).toContain('// theirs');
    expect(s.fragmentShader).toContain('// surface:a');
    expect(m.customProgramCacheKey()).toContain('theirs');
  });

  it('never throws out of the hook', () => {
    const m = new THREE.MeshStandardMaterial();
    ensureHost(m).add(marker('a'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    m.onBeforeCompile = () => { throw new Error('boom'); };
    expect(() => compile(m)).not.toThrow();
  });

  it('clone() keeps patches, copies own uniforms and shares shared ones', () => {
    const m = new THREE.MeshStandardMaterial({ roughness: 0.3 });
    ensureHost(m).add(marker('a'));
    const c = m.clone();
    expect(c).not.toBe(m);
    expect(c.roughness).toBe(0.3);
    expect(getHost(c)?.patches.map((p) => p.key)).toEqual(['a']);
    const ua = findUniform(m, 'u_a'), uc = findUniform(c, 'u_a');
    expect(uc).toBeDefined();
    expect(uc).not.toBe(ua);
    expect((uc?.value as THREE.Vector4).y).toBe(2);
    expect(findUniform(c, 'sharedTex')).toBe(findUniform(m, 'sharedTex'));
    expect(compile(c).fragmentShader).toContain('// surface:a');
    expect(c.clone()).toBeInstanceOf(THREE.MeshStandardMaterial);
    const p = clonePatch(marker('z'));
    expect(p.uniforms?.u_z).toBeDefined();
  });

  it('setPatchParam maps values onto uniform components', () => {
    const m = new THREE.MeshStandardMaterial();
    ensureHost(m).add(marker('a'));
    expect(setPatchParam(m, 'knob', 5)).toBe(true);
    expect((findUniform(m, 'u_a')?.value as THREE.Vector4).y).toBe(10);
    expect(setPatchParam(m, 'nope', 1)).toBe(false);
    expect(setPatchParam(new THREE.MeshStandardMaterial(), 'knob', 1)).toBe(false);
  });
});

describe('material library', () => {
  const lib = createMaterialLibrary(null);

  it('builds every MatId, shares instances, and every shader anchor resolves', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const id of MAT_IDS) {
      const m = lib.get(id);
      expect(m, id).toBeInstanceOf(THREE.Material);
      expect(lib.get(id)).toBe(m);
      expect(m.name).toBe(id);
      if (getHost(m)) {
        const s = compile(m);
        expect(s.fragmentShader.length, id).toBeGreaterThan(THREE.ShaderLib.basic.fragmentShader.length);
        // every sampler / vector uniform the GLSL declares (and has enabled) has a holder
        const panel = s.fragmentShader.includes('#define AUR_PANEL'), mask = s.fragmentShader.includes('#define AUR_MASK');
        for (const name of s.fragmentShader.match(/uniform \w+ (\w+);/g) ?? []) {
          const u = name.replace(/uniform \w+ (\w+);/, '$1');
          if (!/^(tp|glow|ice|spk|glass|aur|holo|shield|bar|cor)[A-Z]/.test(u)) continue;
          if ((/^tp(Panel|Wear)/.test(u) && !panel) || (/^tpMask/.test(u) && !mask)) continue;
          expect(s.uniforms[u], `${id}.${u}`).toBeDefined();
        }
      }
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it('object-space variants are separate shared instances', () => {
    const w = lib.get('refNavy'), l = lib.getLocal('refNavy');
    expect(l).not.toBe(w);
    expect(lib.getLocal('refNavy')).toBe(l);
    expect(getHost(l)?.local).toBe(true);
    expect(getHost(w)?.local).toBe(false);
    // worn / carried materials default to object space
    expect(getHost(lib.get('domCloth'))?.local).toBe(true);
    expect(lib.getLocal('domCloth')).toBe(lib.get('domCloth'));
  });

  it('falls back for unknown ids with one warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const m = lib.get('nope' as MatId);
    expect(m).toBe(lib.get('whiteGold'));
    lib.get('nope' as MatId);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(lib.clone('alsoNope' as MatId)).toBeInstanceOf(THREE.MeshStandardMaterial);
  });

  it('clone applies material properties, named params and objectSpace', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const c = lib.clone('goldChannel', { emissiveIntensity: 5, pulse: 0, objectSpace: true, bogus: 1 });
    expect(c).not.toBe(lib.get('goldChannel'));
    expect(c.emissiveIntensity).toBe(5);
    expect((findUniform(c, 'glowA')?.value as THREE.Vector4).x).toBe(0);
    expect((findUniform(lib.get('goldChannel'), 'glowA')?.value as THREE.Vector4).x).toBeGreaterThan(0);
    expect(getHost(c)?.local).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    const s = lib.clone('whiteGold', { scale: 2, color: 0xff0000 });
    expect((findUniform(s, 'tpA')?.value as THREE.Vector4).x).toBeCloseTo(0.5);
    expect(s.color.getHex()).toBe(0xff0000);
    const holo = lib.clone<THREE.MeshBasicMaterial>('hologram', { reveal: 0.5 });
    expect(holo.isMeshBasicMaterial).toBe(true);
    expect((findUniform(holo, 'holoB')?.value as THREE.Vector4).y).toBe(0.5);
  });

  it('emissive materials are cached per colour and intensity', () => {
    const a = lib.emissive(0xffc56b, 3);
    expect(lib.emissive(0xffc56b, 3)).toBe(a);
    expect(lib.emissive(0xffc56b, 6)).not.toBe(a);
    expect(a.emissiveIntensity).toBe(3);
    expect(a.emissive.getHex()).toBe(0xffc56b);
    expect(lib.emissive(0x123456).emissiveIntensity).toBe(1.5);
    expect(lib.emissive(Number.NaN, Number.NaN)).toBeInstanceOf(THREE.MeshStandardMaterial);
  });

  it('corrupt adds an overlay with a clamped, animatable amount', () => {
    const m = lib.clone('whiteGold');
    const h = lib.corrupt(m, { amount: 0.3 });
    expect(h.amount).toBeCloseTo(0.3);
    h.amount = 2;
    expect(h.amount).toBe(1);
    h.amount = Number.NaN;
    expect(h.amount).toBe(0);
    expect(lib.corrupt(m, { amount: 0.7 })).toBe(h);
    expect(h.amount).toBeCloseTo(0.7);
    expect(compile(m).fragmentShader).toContain('aurVeinTex');
    expect(getHost(m)?.patches.map((p) => p.key.split(':')[0])).toEqual(['tp', 'corrupt']);
    // works on a plain foreign material too
    const foreign = new THREE.MeshStandardMaterial();
    expect(lib.corrupt(foreign).amount).toBeCloseTo(0.5);
    expect(compile(foreign).fragmentShader).toContain('aurVeinTex');
  });

  it('bad input never throws', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(lib.corrupt(new THREE.MeshBasicMaterial() as unknown as THREE.MeshStandardMaterial).amount).toBe(0);
    expect(lib.corrupt(null as unknown as THREE.MeshStandardMaterial, { amount: 0.4 }).amount).toBeCloseTo(0.4);
    expect(() => lib.setParam(lib.get('woundBlack'), 'pulse', 1)).not.toThrow();
    expect(() => lib.setParam(lib.get('goldChannel'), 'nope', 1)).not.toThrow();
    expect(() => lib.setParam(null as unknown as THREE.Material, 'pulse', 1)).not.toThrow();
    expect(() => lib.rippleShield(lib.get('whiteGold'), { x: 0, y: 0, z: 0 })).not.toThrow();
    expect(() => lib.update(Number.NaN, Number.NaN)).not.toThrow();
  });

  it('rippleShield stamps the hit point and the shared clock', () => {
    const s = lib.clone<THREE.MeshBasicMaterial>('shieldEnergy');
    lib.update(0.016, 12.5);
    lib.rippleShield(s, { x: 1, y: 2, z: 3 }, 0.8);
    const hit = findUniform(s, 'shieldHit')?.value as THREE.Vector4;
    expect([hit.x, hit.y, hit.z, hit.w]).toEqual([1, 2, 3, 12.5]);
    expect((findUniform(s, 'shieldB')?.value as THREE.Vector4).x).toBe(0.8);
  });

  it('exposes textures for textured ids only', () => {
    expect(lib.textures('glass')).toBeNull();
    const t = lib.textures('blackStoneFloor');
    expect(t?.metresPerRepeat).toBe(MAT_DEFS.blackStoneFloor.tp?.scale);
    expect((t?.albedo as THREE.Texture).isTexture).toBe(true);
  });

  it('init() bakes real maps, swaps them in place, reports progress and is idempotent', async () => {
    const game = { render: { quality: { textureSize: 256, anisotropy: 2 } }, flags: { debug: false } } as unknown as Game;
    const l = createMaterialLibrary(game);
    const mat = l.get('blackStone');
    const holder = findUniform(mat, 'tpAlbedo');
    const before = holder?.value as THREE.DataTexture;
    expect(before.image.width).toBe(1);
    expect(l.ready).toBe(false);
    const p = l.init();
    expect(l.init()).toBe(p);
    await p;
    expect(l.ready).toBe(true);
    expect(l.progress).toBe(1);
    const after = holder?.value as THREE.DataTexture;
    expect(after).not.toBe(before);
    expect(after.image.width).toBe(256);
    expect(after.colorSpace).toBe(THREE.SRGBColorSpace);
    expect((findUniform(mat, 'tpNormal')?.value as THREE.DataTexture).colorSpace).toBe(THREE.NoColorSpace);
    expect((findUniform(mat, 'aurMacroTex')?.value as THREE.DataTexture).image.width).toBe(256);
    expect(l.textures('blackStone')?.albedo).toBe(after);
    expect(l.palette.gold).toBe(0xc9a45c);
  }, 30000);

  it('follows quality changes after init: anisotropy at once, texture size only outside gameplay', async () => {
    const quality = { textureSize: 256, anisotropy: 2 };
    const game = { render: { quality }, flags: { debug: false }, phase: 'playing' } as unknown as Game & { phase: string };
    const l = createMaterialLibrary(game);
    await l.init();
    const holder = findUniform(l.get('whiteGold'), 'tpAlbedo');
    const first = holder?.value as THREE.DataTexture;
    expect(first.anisotropy).toBe(2);
    quality.anisotropy = 8;
    l.update(0.016, 1);
    expect((holder?.value as THREE.DataTexture)).toBe(first);
    expect(first.anisotropy).toBe(8);
    quality.textureSize = 512;
    l.update(0.016, 2);
    expect(holder?.value).toBe(first); // still playing: no re-bake
    (game as { phase: string }).phase = 'paused';
    l.update(0.016, 3);
    for (let i = 0; i < 400 && (holder?.value as THREE.DataTexture).image.width !== 512; i++) await new Promise((r) => setTimeout(r, 10));
    expect((holder?.value as THREE.DataTexture).image.width).toBe(512);
  }, 60000);
});
