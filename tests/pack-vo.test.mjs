/**
 * (ship) tools/pack-vo.mjs on a throwaway dist: per-zone packs + a shared pack, a lossless index, the single
 * files removed from the dist only, and a second run that changes nothing.
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packOf } from '../tools/pack-vo.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOOL = path.join(ROOT, 'tools', 'pack-vo.mjs');
const run = (...args) => spawnSync(process.execPath, [TOOL, ...args], { encoding: 'utf8' });

function fakeDist() {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'packvo-'));
  const vo = path.join(dist, 'audio', 'vo');
  fs.mkdirSync(vo, { recursive: true });
  const lines = {
    l0: { zones: ['Z00'] },
    l1: { zones: ['Z00'] },
    l2: { zones: ['Z03'] },
    l3: { zones: ['Z03', 'Z04'] },
    l4: { zones: ['Z11'] },
  };
  const manifest = {};
  const bytes = {};
  let k = 1;
  for (const [id, { zones }] of Object.entries(lines)) {
    const b = Buffer.alloc(300 + k * 37);
    for (let i = 0; i < b.length; i++) b[i] = (i * 31 + k * 7) & 0xff;
    bytes[id] = b;
    fs.writeFileSync(path.join(vo, `${id}.mp3`), b);
    manifest[id] = { file: `${id}.mp3`, seconds: 1, zone: zones[0], zones };
    k++;
  }
  fs.writeFileSync(path.join(vo, 'manifest.json'), JSON.stringify(manifest));
  return { dist, vo, manifest, bytes };
}

describe('tools/pack-vo.mjs', () => {
  it('names the packs: one per zone, shared for lines said in several, common for none', () => {
    expect(packOf({ zone: 'Z05', zones: ['Z05'] })).toBe('Z05');
    expect(packOf({ zone: 'Z05' })).toBe('Z05');
    expect(packOf({ zone: 'Z05', zones: ['Z05', 'Z06'] })).toBe('shared');
    expect(packOf({})).toBe('common');
  });

  it('packs losslessly, removes the single files from the dist, keeps the manifest, and is idempotent', () => {
    const { dist, vo, manifest, bytes } = fakeDist();
    try {
      const first = run('--dist', dist);
      expect(first.status, first.stderr).toBe(0);
      const index = JSON.parse(fs.readFileSync(path.join(vo, 'packs', 'index.json'), 'utf8'));
      expect(Object.keys(index).sort()).toEqual(Object.keys(manifest).sort());
      expect(index.l3[0]).toBe('shared');
      expect(index.l0[0]).toBe('Z00');
      expect(fs.readdirSync(path.join(vo, 'packs')).sort()).toEqual(['Z00.bin', 'Z03.bin', 'Z11.bin', 'index.json', 'shared.bin']);
      for (const [id, [pack, off, len]] of Object.entries(index)) {
        const pb = fs.readFileSync(path.join(vo, 'packs', `${pack}.bin`));
        expect(Buffer.compare(pb.subarray(off, off + len), bytes[id])).toBe(0);
      }
      expect(fs.readdirSync(vo).sort()).toEqual(['manifest.json', 'packs']);
      const before = fs.readFileSync(path.join(vo, 'packs', 'index.json'), 'utf8');
      const second = run('--dist', dist);
      expect(second.status, second.stderr).toBe(0);
      expect(second.stdout).toContain('already packed');
      expect(fs.readFileSync(path.join(vo, 'packs', 'index.json'), 'utf8')).toBe(before);
    } finally {
      fs.rmSync(dist, { recursive: true, force: true });
    }
  });

  it('deletes nothing when a listed file is missing, and never packs public/', () => {
    const { dist, vo } = fakeDist();
    try {
      fs.unlinkSync(path.join(vo, 'l2.mp3'));
      const r = run('--dist', dist);
      expect(r.status).not.toBe(0);
      expect(fs.existsSync(path.join(vo, 'l0.mp3'))).toBe(true);
      expect(fs.existsSync(path.join(vo, 'packs'))).toBe(false);
    } finally {
      fs.rmSync(dist, { recursive: true, force: true });
    }
    const pub = run('--dist', path.join(ROOT, 'public'));
    expect(pub.status).not.toBe(0);
    expect(pub.stderr).toContain('refusing');
  });
});
