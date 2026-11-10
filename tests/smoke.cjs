#!/usr/bin/env node
/**
 * Full-mission smoke test: boots the real game headless, starts a new game and lets the autoplay bot run it
 * (`__aurelion.runTo`) once per Z07 choice. Prints one JSON report and exits 0 only when every run reached its
 * target with `stuck: null` and no page errors. With no zones registered it reports "no zones" and exits 0.
 *
 *   node tests/smoke.cjs [--url "/?debug=1&manual=1&mute=1&quality=low"] [--choices WestStretchers,EastWalkers]
 *                        [--until CP9] [--max 3600] [--stall 90] [--out report.json] [--timeout 1800000]
 *
 * Same Chromium launch flags as tools/shot.cjs (software WebGL). The run never renders, so sim time is fast.
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const ROOT = path.resolve(__dirname, '..');
const BASE = process.env.AURELION_BASE || 'http://127.0.0.1:5173';

function parseArgs(argv) {
  const o = { url: '/?debug=1&manual=1&mute=1&quality=low', choices: ['WestStretchers', 'EastWalkers'], until: 'CP9', max: 3600, stall: 90, out: null, timeout: 1800000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = argv[i + 1];
    if (a === '--url') { o.url = v; i++; }
    else if (a === '--choices') { o.choices = String(v).split(',').map((s) => s.trim()).filter(Boolean); i++; }
    else if (a === '--until') { o.until = v; i++; }
    else if (a === '--max') { o.max = Number(v) || o.max; i++; }
    else if (a === '--stall') { o.stall = Number(v) || o.stall; i++; }
    else if (a === '--out') { o.out = v; i++; }
    else if (a === '--timeout') { o.timeout = Number(v) || o.timeout; i++; }
    else { console.error(`unknown argument ${a}`); process.exit(2); }
  }
  return o;
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
  console.error('[smoke] dev server not responding — starting vite…');
  const out = fs.openSync('/tmp/aurelion-vite.log', 'a');
  const child = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', '5173', '--strictPort'], { cwd: ROOT, detached: true, stdio: ['ignore', out, out] });
  child.unref();
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await ping(BASE + '/')) return;
  }
  throw new Error('could not start the dev server (see /tmp/aurelion-vite.log)');
}

/** One fresh page (fresh localStorage) per run. */
async function runOnce(browser, opts, choice) {
  const context = await browser.newContext({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().split('\n')[0].slice(0, 300)); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + String(e.message).slice(0, 300)));
  const run = { choice, status: 'error', ok: false, stuck: null, reached: [], beats: [], simSeconds: 0, teleports: 0, forcedInteractions: [], errors: [], wallSeconds: 0 };
  const t0 = Date.now();
  try {
    await page.goto(BASE + opts.url, { waitUntil: 'load', timeout: opts.timeout });
    await page.waitForFunction('window.__aurelion && window.__aurelion.ready === true', null, { timeout: Math.min(opts.timeout, 240000) });
    const zones = await page.evaluate('window.__aurelion.zones()');
    run.zones = zones;
    if (!zones.length) {
      run.status = 'no zones';
      run.ok = true;
      return run;
    }
    const result = await page.evaluate(
      async ([c, until, max, stall]) => {
        const d = window.__aurelion;
        await d.newGame();
        const r = await d.runTo({ choice: c, untilCheckpoint: until, maxSimSeconds: max, stallSeconds: stall });
        const s = d.snapshot();
        return { r, final: { zone: s.zone, beat: s.beat, checkpoint: s.checkpoint, rescuePriority: s.rescuePriority, flags: s.flags, phase: s.phase }, log: d.autoplay.log.slice(-40), pageErrors: d.errors.map((e) => String(e).split('\n')[0].slice(0, 300)) };
      },
      [choice, opts.until, opts.max, opts.stall],
    );
    Object.assign(run, result.r);
    run.final = result.final;
    run.botLog = result.log;
    run.errors = [...new Set([...(result.r.errors || []), ...result.pageErrors, ...consoleErrors])];
    run.status = result.r.ok && !result.r.stuck && run.errors.length === 0 ? 'ok' : result.r.ok ? 'completed with problems' : 'stuck';
    run.ok = run.status === 'ok';
  } catch (err) {
    run.status = 'error';
    run.stuck = `smoke harness: ${String(err && err.message ? err.message : err).split('\n')[0]}`;
    run.errors = [...new Set(consoleErrors)];
  } finally {
    run.wallSeconds = Math.round((Date.now() - t0) / 100) / 10;
    await context.close().catch(() => {});
  }
  return run;
}

(async () => {
  const opts = parseArgs(process.argv.slice(2));
  const report = { url: opts.url, until: opts.until, maxSimSeconds: opts.max, status: 'error', ok: false, runs: [] };
  let browser = null;
  try {
    await ensureServer();
    const { chromium } = require('playwright');
    browser = await chromium.launch({
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--autoplay-policy=no-user-gesture-required'],
    });
    for (const choice of opts.choices) {
      const run = await runOnce(browser, opts, choice);
      report.runs.push(run);
      if (run.status === 'no zones') break;
    }
    const first = report.runs[0];
    if (first && first.status === 'no zones') {
      report.status = 'no zones';
      report.ok = true;
    } else {
      report.ok = report.runs.length > 0 && report.runs.every((r) => r.ok);
      report.status = report.ok ? 'ok' : 'failed';
    }
  } catch (err) {
    report.status = 'error';
    report.error = String(err && err.stack ? err.stack : err);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
  const text = JSON.stringify(report, null, 2);
  if (opts.out) {
    const file = path.resolve(ROOT, opts.out);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
  console.log(text);
  process.exit(report.ok ? 0 : 1);
})();
