#!/usr/bin/env node
/**
 * Audit a build for hosting on claude.ai and write the publish plan.
 *
 *   node tools/publish-plan.mjs [--dist dist] [--out plan.json] [--group-bytes 50000000]
 *
 * Hosting limits (claude.ai page): ≤ 511 files in one version; ≤ 255 files and 64 MB per publish (more files go
 * up in further publishes to the same page); ≤ 15 MB per binary file, 16 MB per text file; standard web media
 * types only; every URL relative to the page. The plan is
 *   { page: { from, contentType },                       index.html — the page itself, not in any group
 *     groups: [ { "<published path>": { from, contentType }, … }, … ],   each ≤ 255 files and ≤ --group-bytes
 *     groupTotals: [ { files, bytes, first, last } … ], totals: { … }, types: { ext: contentType }, problems: [] }
 * Groups are filled in a fixed order (code and fonts, art, textures, models, music, voice packs) so the first
 * publish carries what the title screen needs. --group-bytes defaults to 50 MB to keep a margin under 64 MB.
 * Prints the audit (counts, sizes by extension, the largest files) and exits non-zero if a limit is broken or a
 * file does not belong in the dist (docs, source maps, dotfiles, an extension without a declared type).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** the media type declared for each extension the game ships (anything else is a problem) */
export const TYPES = {
  html: 'text/html',
  js: 'text/javascript',
  css: 'text/css',
  json: 'application/json',
  woff2: 'font/woff2',
  woff: 'font/woff',
  mp3: 'audio/mpeg',
  webp: 'image/webp',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  svg: 'image/svg+xml',
  glb: 'model/gltf-binary',
  bin: 'application/octet-stream',
  wasm: 'application/wasm',
};
const TEXT = new Set(['html', 'js', 'css', 'json', 'svg']);

export function contentTypeOf(file) {
  const ext = path.extname(file).slice(1).toLowerCase();
  return TYPES[ext] ?? null;
}

const LIMITS = { versionFiles: 511, publishFiles: 255, publishBytes: 64 * 1000 * 1000, binaryBytes: 15 * 1000 * 1000, textBytes: 16 * 1000 * 1000 };

/** publish order: what the page needs first */
function rank(rel) {
  if (rel.startsWith('assets/')) return 0;
  if (rel.startsWith('art/')) return 1;
  if (rel.startsWith('textures/')) return 2;
  if (rel.startsWith('models/')) return 3;
  if (rel.startsWith('audio/music/')) return 4;
  if (rel.startsWith('audio/vo/')) return 5;
  return 6;
}

function walk(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, base, out);
    else out.push({ abs: p, rel: path.relative(base, p).split(path.sep).join('/'), bytes: fs.statSync(p).size });
  }
  return out;
}

function main() {
  const o = { dist: path.join(ROOT, 'dist'), out: null, groupBytes: 50 * 1000 * 1000 };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = argv[++i];
    if (a === '--dist') o.dist = path.resolve(v);
    else if (a === '--out') o.out = path.resolve(v);
    else if (a === '--group-bytes') o.groupBytes = Number(v);
    else {
      console.error(`[publish-plan] unknown argument ${a}`);
      process.exit(2);
    }
  }
  o.groupBytes = Math.min(o.groupBytes, LIMITS.publishBytes);
  const dist = path.resolve(o.dist);
  if (!fs.existsSync(path.join(dist, 'index.html'))) {
    console.error(`[publish-plan] no index.html in ${dist}`);
    process.exit(1);
  }
  const files = walk(dist);
  const problems = [];
  const byExt = {};
  for (const f of files) {
    const ext = path.extname(f.rel).slice(1).toLowerCase();
    const k = (byExt[ext || '(none)'] ??= { files: 0, bytes: 0, contentType: TYPES[ext] ?? null });
    k.files++;
    k.bytes += f.bytes;
    if (!TYPES[ext]) problems.push(`no declared media type for ${f.rel}`);
    if (/(^|\/)\./.test(f.rel)) problems.push(`dotfile in dist: ${f.rel}`);
    if (/\.(md|map|txt|log|ts|tsx|mjs|cjs|py|sh)$/i.test(f.rel)) problems.push(`not a game file: ${f.rel}`);
    const cap = TEXT.has(ext) ? LIMITS.textBytes : LIMITS.binaryBytes;
    if (f.bytes > cap) problems.push(`${f.rel} is ${(f.bytes / 1e6).toFixed(2)} MB (limit ${cap / 1e6} MB)`);
    if (f.bytes === 0) problems.push(`empty file: ${f.rel}`);
  }
  if (files.length > LIMITS.versionFiles) problems.push(`${files.length} files (limit ${LIMITS.versionFiles} per version)`);
  // a relative page: no root-absolute or other-host references in the page itself
  const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
  for (const m of html.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/g)) {
    if (/^(?:[a-z]+:)?\/\//i.test(m[1]) || m[1].startsWith('/')) problems.push(`index.html references ${m[1]} (not relative to the page)`);
  }

  const page = files.find((f) => f.rel === 'index.html');
  const rest = files.filter((f) => f !== page).sort((a, b) => rank(a.rel) - rank(b.rel) || a.rel.localeCompare(b.rel));
  const groups = [];
  const groupTotals = [];
  let cur = null;
  for (const f of rest) {
    if (!cur || cur.files + 1 > LIMITS.publishFiles || cur.bytes + f.bytes > o.groupBytes) {
      // (the page goes up with the first group: its bytes count there)
      cur = { map: {}, files: 0, bytes: groups.length ? 0 : page.bytes, first: f.rel, last: f.rel };
      groups.push(cur);
    }
    cur.map[f.rel] = { from: f.abs, contentType: contentTypeOf(f.rel) ?? 'application/octet-stream' };
    cur.files++;
    cur.bytes += f.bytes;
    cur.last = f.rel;
  }
  for (const g of groups) {
    if (g.files > LIMITS.publishFiles) problems.push(`a group has ${g.files} files`);
    if (g.bytes > LIMITS.publishBytes) problems.push(`a group has ${(g.bytes / 1e6).toFixed(2)} MB`);
    groupTotals.push({ files: g.files, bytes: g.bytes, megabytes: +(g.bytes / 1e6).toFixed(2), first: g.first, last: g.last });
  }
  const totalBytes = files.reduce((s, f) => s + f.bytes, 0);
  const largest = [...files].sort((a, b) => b.bytes - a.bytes).slice(0, 12).map((f) => ({ path: f.rel, megabytes: +(f.bytes / 1e6).toFixed(2) }));
  const plan = {
    dist,
    page: { from: page.abs, contentType: 'text/html' },
    groups: groups.map((g) => g.map),
    groupTotals,
    totals: {
      files: files.length,
      filesInGroups: rest.length,
      bytes: totalBytes,
      megabytes: +(totalBytes / 1e6).toFixed(2),
      groups: groups.length,
      byExtension: byExt,
      largest,
    },
    types: TYPES,
    limits: { ...LIMITS, groupBytesUsed: o.groupBytes },
    problems,
  };

  console.log(`[publish-plan] ${dist}: ${files.length} files, ${(totalBytes / 1e6).toFixed(2)} MB`);
  for (const [ext, k] of Object.entries(byExt).sort((a, b) => b[1].bytes - a[1].bytes)) {
    console.log(`  .${ext.padEnd(6)} ${String(k.files).padStart(4)} files ${(k.bytes / 1e6).toFixed(2).padStart(7)} MB  ${k.contentType ?? 'NO TYPE'}`);
  }
  console.log('  largest:');
  for (const l of largest) console.log(`    ${l.megabytes.toFixed(2).padStart(6)} MB  ${l.path}`);
  groupTotals.forEach((g, i) => console.log(`  group ${i + 1}: ${g.files} files, ${g.megabytes} MB (${g.first} … ${g.last})${i === 0 ? ' + the page' : ''}`));
  if (o.out) {
    fs.mkdirSync(path.dirname(o.out), { recursive: true });
    fs.writeFileSync(o.out, JSON.stringify(plan, null, 2));
    console.log(`[publish-plan] wrote ${o.out}`);
  }
  if (problems.length) {
    for (const p of problems) console.error(`[publish-plan] PROBLEM ${p}`);
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
