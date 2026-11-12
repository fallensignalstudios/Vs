#!/usr/bin/env node
/**
 * Write the page for the claude.ai page host from the built `dist/index.html`.
 *
 *   node tools/host-page.mjs --out <file.html> [--dist dist]
 *
 * The host wraps the published page in its own doctype/head/body skeleton, so the page carries only its title,
 * style, stylesheet link, the canvas and UI roots, and the module script (with the hashed names of this build).
 * Publish it as the page, with every other dist file from `tools/publish-plan.mjs` as supporting files.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const DIST = path.resolve(ROOT, opt('--dist', 'dist'));
const OUT = opt('--out', null);
if (!OUT) {
  console.error('host-page: --out <file.html> is required');
  process.exit(1);
}

const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
const js = html.match(/src="\.\/(assets\/index-[\w-]+\.js)"/)?.[1];
const css = html.match(/href="\.\/(assets\/index-[\w-]+\.css)"/)?.[1];
if (!js || !css) {
  console.error('host-page: could not find the bundle script and stylesheet in dist/index.html');
  process.exit(1);
}

const page = `<title>Aurelion — Contrary Witness</title>
<style>
  /* One full-window canvas; the game draws its own UI. Single dark look by design. */
  :root { color-scheme: dark; --bg: #07090d; --gold: #b08a4a; }
  html, body { background: var(--bg); height: 100%; margin: 0; overflow: hidden; }
  #game { outline: none; width: 100%; height: 100%; display: block; position: fixed; inset: 0; }
  #ui { pointer-events: none; position: fixed; inset: 0; }
  #boot { color: var(--gold); letter-spacing: .4em; text-transform: uppercase; background: var(--bg); place-items: center; font: 500 12px/1 system-ui, sans-serif; transition: opacity .6s; display: grid; position: fixed; inset: 0; }
</style>
<link rel="stylesheet" crossorigin href="./${css}">
<canvas id="game" tabindex="0"></canvas>
<div id="ui"></div>
<div id="boot">Aurelion</div>
<script type="module" crossorigin src="./${js}"></script>
`;
fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
fs.writeFileSync(OUT, page);
console.log(`host-page: wrote ${OUT} (${js}, ${css})`);
