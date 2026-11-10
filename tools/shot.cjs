#!/usr/bin/env node
/**
 * Headless screenshot / smoke tool (software WebGL via SwiftShader — slow but faithful).
 *
 *   node tools/shot.cjs <urlPath> [--w 1280] [--h 720] [--timeout 180000]
 *        [--eval "<js>"]... [--wait <ms>]... [--shot <file.png>]...
 *
 * Steps run in the order given. Examples:
 *   node tools/shot.cjs "/sandbox/kit/" --shot shots/kit/overview.png
 *   node tools/shot.cjs "/sandbox/chars/?who=tarrik" --eval "__h.setCam([2,1.6,3],[0,1,0])" --shot shots/chars/tarrik.png \
 *        --eval "__play('attackHeavy'); __step(0.35)" --shot shots/chars/tarrik-heavy.png
 *   node tools/shot.cjs "/?zone=Z04&debug=1&manual=1&mute=1" --eval "__aurelion.settle(1)" --shot shots/z04.png
 *
 * The page must set window.__ready = true (sandbox harness) or window.__aurelion.ready = true (game).
 * --eval may be async (the expression is awaited); its JSON result is printed.
 * Console errors from the page are printed at the end; exit code 2 if the page never became ready.
 * Renders are serialised across agents with flock so the 4-core box is not thrashed.
 */
const { spawnSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const ROOT = path.resolve(__dirname, '..');
const BASE = process.env.AURELION_BASE || 'http://127.0.0.1:5173';

if (!process.env.SHOT_LOCKED && !process.argv.includes('--no-lock')) {
  const env = { ...process.env, SHOT_LOCKED: '1' };
  const args = [process.argv[1], ...process.argv.slice(2)];
  let r = spawnSync('flock', ['-n', '-E', '200', '/tmp/aurelion-shot-0.lock', process.execPath, ...args], { stdio: 'inherit', env });
  if (r.status === 200) r = spawnSync('flock', ['/tmp/aurelion-shot-1.lock', process.execPath, ...args], { stdio: 'inherit', env });
  process.exit(r.status == null ? 1 : r.status);
}

function ping(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => { res.resume(); resolve(res.statusCode < 500); });
    req.on('error', () => resolve(false));
    req.setTimeout(1500, () => { req.destroy(); resolve(false); });
  });
}

async function ensureServer() {
  if (await ping(BASE + '/')) return;
  console.log('[shot] dev server not responding — starting vite…');
  const out = fs.openSync('/tmp/aurelion-vite.log', 'a');
  const child = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', '5173', '--strictPort'], { cwd: ROOT, detached: true, stdio: ['ignore', out, out] });
  child.unref();
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await ping(BASE + '/')) return;
  }
  throw new Error('could not start dev server (see /tmp/aurelion-vite.log)');
}

(async () => {
  const argv = process.argv.slice(2).filter((a) => a !== '--no-lock');
  if (!argv.length || argv[0].startsWith('--')) {
    console.error('usage: node tools/shot.cjs <urlPath> [--w N] [--h N] [--eval js] [--wait ms] [--shot out.png] …');
    process.exit(1);
  }
  const urlPath = argv[0];
  let w = 1280, h = 720, timeout = 180000;
  const steps = [];
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i], v = argv[i + 1];
    if (a === '--w') { w = +v; i++; }
    else if (a === '--h') { h = +v; i++; }
    else if (a === '--timeout') { timeout = +v; i++; }
    else if (a === '--eval') { steps.push({ kind: 'eval', v }); i++; }
    else if (a === '--wait') { steps.push({ kind: 'wait', v: +v }); i++; }
    else if (a === '--shot') { steps.push({ kind: 'shot', v }); i++; }
    else { console.error('unknown arg ' + a); process.exit(1); }
  }

  await ensureServer();
  const { chromium } = require('playwright');
  const t0 = Date.now();
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + (e.stack || e.message)));
  page.on('requestfailed', (r) => { if (!r.url().includes('favicon')) errors.push('requestfailed: ' + r.url() + ' ' + (r.failure()?.errorText || '')); });

  let exit = 0;
  try {
    await page.goto(BASE + urlPath, { waitUntil: 'load', timeout });
    try {
      await page.waitForFunction('window.__ready === true || (window.__aurelion && window.__aurelion.ready === true)', null, { timeout });
    } catch {
      console.error(`[shot] page never became ready within ${timeout} ms`);
      exit = 2;
    }
    for (const s of steps) {
      if (s.kind === 'wait') await page.waitForTimeout(s.v);
      else if (s.kind === 'eval') {
        try {
          const res = await page.evaluate(`(async () => { return await (${s.v}); })()`);
          if (res !== undefined) console.log('[eval] ' + JSON.stringify(res));
        } catch (e) {
          console.error('[eval error] ' + s.v.slice(0, 120) + ' → ' + (e.message || e).split('\n')[0]);
          exit = exit || 3;
        }
      } else if (s.kind === 'shot') {
        const out = path.resolve(ROOT, s.v);
        fs.mkdirSync(path.dirname(out), { recursive: true });
        await page.waitForTimeout(50);
        await page.screenshot({ path: out, timeout: 120000 });
        console.log(`[shot] ${path.relative(ROOT, out)} (${w}x${h})`);
      }
    }
    const pageErrs = await page.evaluate('(window.__aurelionErrors || []).slice(0, 20)').catch(() => []);
    for (const e of pageErrs) if (!errors.includes(e)) errors.push(e);
  } catch (e) {
    console.error('[shot] ' + (e.stack || e));
    exit = exit || 1;
  } finally {
    await browser.close();
  }
  const uniq = [...new Set(errors)].slice(0, 25);
  console.log(`[shot] done in ${((Date.now() - t0) / 1000).toFixed(1)}s — page errors: ${uniq.length}`);
  for (const e of uniq) console.log('  ! ' + e.split('\n').slice(0, 3).join(' | ').slice(0, 400));
  process.exit(exit);
})();
