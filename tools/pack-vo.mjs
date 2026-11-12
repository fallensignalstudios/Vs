#!/usr/bin/env node
/**
 * Post-build step for the hosted build: packs the voice-over into a few files per zone.
 *
 *   node tools/pack-vo.mjs [--dist dist] [--keep]        (npm run build:ship = build, then this)
 *
 * Reads `<dist>/audio/vo/manifest.json` (copied from public/ by the build) and writes
 *   <dist>/audio/vo/packs/<pack>.bin   the original mp3 bytes of that pack's lines, concatenated (lossless)
 *   <dist>/audio/vo/packs/index.json   { "<line id>": ["<pack>", byteOffset, byteLength], … }
 * then deletes the single mp3s from <dist> (never from public/; `--keep` leaves them).
 *
 * Packs: one per zone, named after it (`Z00` … `Z12`), holding the lines said only in that zone; lines said in
 * several zones (manifest `zones` longer than one) go once into `shared`; lines without a zone into `common`.
 * The runtime (src/audio/assets/library.ts) loads the packs of the zones it prefetches and slices each clip out.
 * Every pack is read back and compared byte for byte with its source files before anything is deleted.
 * Plain Node, no dependencies. Exits non-zero (and deletes nothing) on any problem. Running it again on an
 * already packed dist checks the packs and changes nothing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function args(argv) {
  const o = { dist: path.join(ROOT, 'dist'), keep: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dist') o.dist = path.resolve(argv[++i]);
    else if (argv[i] === '--keep') o.keep = true;
    else {
      console.error(`[pack-vo] unknown argument ${argv[i]}`);
      process.exit(2);
    }
  }
  return o;
}

const fail = (msg) => {
  console.error(`[pack-vo] ${msg}`);
  process.exit(1);
};

/** Which pack a manifest entry goes in. */
export function packOf(meta) {
  const zones = Array.isArray(meta.zones) && meta.zones.length ? meta.zones : meta.zone ? [meta.zone] : [];
  if (zones.length > 1) return 'shared';
  return zones.length ? String(zones[0]) : 'common';
}

function main() {
  const opts = args(process.argv.slice(2));
  const voDir = path.join(opts.dist, 'audio', 'vo');
  const packDir = path.join(voDir, 'packs');
  const publicVo = path.join(ROOT, 'public', 'audio', 'vo');
  if (path.resolve(voDir) === path.resolve(publicVo)) fail('refusing to pack public/ — point --dist at a build output');
  const manifestPath = path.join(voDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) fail(`no ${manifestPath} — run the build first`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const ids = Object.keys(manifest).filter((id) => manifest[id] && typeof manifest[id].file === 'string');
  if (!ids.length) fail('the voice manifest lists no lines');

  // already packed (a second run): verify the index against the packs and stop
  const indexPath = path.join(packDir, 'index.json');
  const singles = ids.filter((id) => fs.existsSync(path.join(voDir, manifest[id].file)));
  if (!singles.length && fs.existsSync(indexPath)) {
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    const missing = ids.filter((id) => !index[id]);
    if (missing.length) fail(`already packed, but ${missing.length} lines have no pack entry (e.g. ${missing[0]})`);
    const sizes = new Map();
    for (const [id, [pack, off, len]] of Object.entries(index)) {
      if (!sizes.has(pack)) sizes.set(pack, fs.statSync(path.join(packDir, `${pack}.bin`)).size);
      if (off + len > sizes.get(pack)) fail(`index entry ${id} runs past the end of ${pack}.bin`);
    }
    console.log(`[pack-vo] already packed: ${ids.length} lines in ${sizes.size} packs — nothing to do`);
    return;
  }
  if (singles.length !== ids.length) fail(`${ids.length - singles.length} listed voice files are missing from ${voDir}`);

  // group in manifest order
  const groups = new Map();
  for (const id of ids) {
    const p = packOf(manifest[id]);
    if (!/^[A-Za-z0-9_-]+$/.test(p)) fail(`bad pack name "${p}" for ${id}`);
    if (!groups.has(p)) groups.set(p, []);
    groups.get(p).push(id);
  }

  fs.mkdirSync(packDir, { recursive: true });
  const index = {};
  const summary = [];
  for (const [pack, list] of groups) {
    const parts = [];
    let off = 0;
    for (const id of list) {
      const bytes = fs.readFileSync(path.join(voDir, manifest[id].file));
      if (!bytes.length) fail(`${manifest[id].file} is empty`);
      index[id] = [pack, off, bytes.length];
      parts.push(bytes);
      off += bytes.length;
    }
    const file = path.join(packDir, `${pack}.bin`);
    fs.writeFileSync(file, Buffer.concat(parts, off));
    // read back and compare: lossless or nothing is deleted
    const back = fs.readFileSync(file);
    for (const id of list) {
      const [, o, n] = index[id];
      const src = fs.readFileSync(path.join(voDir, manifest[id].file));
      if (!back.subarray(o, o + n).equals(src)) fail(`${pack}.bin does not reproduce ${manifest[id].file}`);
    }
    summary.push({ pack, lines: list.length, bytes: off });
  }
  fs.writeFileSync(indexPath, JSON.stringify(index));

  let removed = 0;
  if (!opts.keep) {
    for (const id of ids) {
      const f = path.join(voDir, manifest[id].file);
      if (!path.resolve(f).startsWith(path.resolve(opts.dist) + path.sep)) fail(`refusing to delete outside ${opts.dist}: ${f}`);
      fs.unlinkSync(f);
      removed++;
    }
  }
  const total = summary.reduce((s, p) => s + p.bytes, 0);
  for (const p of summary) console.log(`[pack-vo] ${p.pack.padEnd(7)} ${String(p.lines).padStart(4)} lines ${(p.bytes / 1e6).toFixed(2).padStart(6)} MB`);
  console.log(`[pack-vo] ${ids.length} lines → ${summary.length} packs + index.json (${(total / 1e6).toFixed(2)} MB); removed ${removed} single files from ${voDir}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
