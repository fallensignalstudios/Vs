#!/usr/bin/env node
/**
 * Rewrite the shipped build's binary files as base64 text, for the claude.ai page host.
 *
 *   node tools/pack-b64.mjs [--dist dist]
 *
 * The host serves only standard web types and refuses `.glb` and `.bin`. For every `*.glb` and `*.bin` under
 * `dist/` this writes `<file>.txt` (base64 of the exact bytes), reads it back and compares it byte for byte with the
 * original, then deletes the original from `dist/` only. It refuses to run on `public/`. Running it twice changes
 * nothing. The game decodes the `.txt` files through `src/core/binfetch.ts`, which a `VITE_HOST_B64=1` build
 * installs (`npm run build:ship` does both).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const distArg = args.includes('--dist') ? args[args.indexOf('--dist') + 1] : 'dist';
const DIST = path.resolve(ROOT, distArg);

if (path.resolve(DIST) === path.resolve(ROOT, 'public') || !fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error(`pack-b64: refusing to run on ${DIST} (not a built dist with index.html)`);
  process.exit(1);
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

let count = 0;
let before = 0;
let after = 0;
for (const file of walk(DIST)) {
  if (!/\.(glb|bin)$/i.test(file)) continue;
  const bytes = fs.readFileSync(file);
  const text = bytes.toString('base64');
  const out = `${file}.txt`;
  fs.writeFileSync(out, text);
  const back = Buffer.from(fs.readFileSync(out, 'utf8'), 'base64');
  if (!back.equals(bytes)) {
    console.error(`pack-b64: round trip failed for ${path.relative(DIST, file)}`);
    process.exit(1);
  }
  fs.unlinkSync(file);
  count++;
  before += bytes.length;
  after += text.length;
}

const left = walk(DIST).filter((f) => /\.(glb|bin)$/i.test(f));
if (left.length) {
  console.error(`pack-b64: binaries left in dist: ${left.map((f) => path.relative(DIST, f)).join(', ')}`);
  process.exit(1);
}
console.log(
  count
    ? `pack-b64: ${count} binaries → base64 text (${(before / 1e6).toFixed(2)} MB → ${(after / 1e6).toFixed(2)} MB)`
    : 'pack-b64: nothing to do (no .glb or .bin in dist)',
);
