#!/usr/bin/env node
/**
 * Voice-over check: does public/audio/vo/manifest.json cover the script, and is every file it lists real?
 *
 *   node tools/vo-check.mjs [--lines <lines.json>] [--manifest <manifest.json>] [--tolerance 0.15] [--json] [--strict]
 *
 * - lines.json is the VO line list (an array of { id, speaker, text, zone, channel, … }); default: $VO_LINES,
 *   else the polish-pass scratchpad copy (scratchpad/vo/lines.json). A `lines-excluded.json` beside it (display
 *   text that must never be voiced) is read too, if present.
 * - For every line: listed in the manifest; its file exists; `seconds` > 0 and within ±tolerance of the duration
 *   ffprobe measures; its `zone` (optional in the manifest) matches the line's first zone.
 * - Orphans: manifest entries that are not lines, files in the folder that the manifest does not list, and
 *   any excluded (display) line that has a recording.
 * Exit code 1 when a listed entry is broken (no file, bad seconds, unreadable, wrong length), display text has a
 * recording, or the manifest is unreadable; lines not recorded yet are only reported (with --strict they fail
 * too). 2 on a usage error. An empty or missing manifest just reports 0/N.
 */
import { execFile } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRATCH_LINES = '/tmp/claude-0/-home-user-Vs/3c7ea414-9f85-5238-b414-170848a5f780/scratchpad/vo/lines.json';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : dflt;
};
const linesPath = resolve(opt('--lines', process.env.VO_LINES || SCRATCH_LINES));
const manifestPath = resolve(opt('--manifest', join(ROOT, 'public/audio/vo/manifest.json')));
const tolerance = Number(opt('--tolerance', '0.15'));
const asJson = args.includes('--json');
const dir = dirname(manifestPath);

if (!existsSync(linesPath)) {
  console.error(`vo-check: no line list at ${linesPath} (pass --lines <lines.json> or set VO_LINES)`);
  process.exit(2);
}
const readJson = (p, dflt) => {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return dflt;
  }
};
const lines = readJson(linesPath, null);
if (!Array.isArray(lines)) {
  console.error(`vo-check: ${linesPath} is not a JSON array of lines`);
  process.exit(2);
}
const excludedPath = join(dirname(linesPath), 'lines-excluded.json');
const excluded = existsSync(excludedPath) ? readJson(excludedPath, []) : [];
const rawManifest = existsSync(manifestPath) ? readJson(manifestPath, null) : {};
const manifest = rawManifest && typeof rawManifest === 'object' && !Array.isArray(rawManifest) ? rawManifest : null;

/** ffprobe's duration of a file (s), or null when it cannot read it */
const probe = (file) => new Promise((done) => {
  execFile('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { timeout: 20000 }, (err, out) => {
    const d = err ? NaN : parseFloat(String(out).trim());
    done(Number.isFinite(d) && d > 0 ? d : null);
  });
});
async function pool(items, n, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  }));
}

const problems = { missing: [], noFile: [], badSeconds: [], unreadable: [], lengthMismatch: [], zoneMismatch: [] };
let ok = 0;
const ids = new Set(lines.map((l) => l.id));
const entries = manifest ? manifest : {};
const checks = [];
for (const l of lines) {
  const e = entries[l.id];
  if (!e || typeof e !== 'object') {
    problems.missing.push(l.id);
    continue;
  }
  checks.push(l);
}
await pool(checks, 6, async (l) => {
  const e = entries[l.id];
  const file = typeof e.file === 'string' ? join(dir, e.file) : null;
  if (!file || !existsSync(file) || statSync(file).size === 0) {
    problems.noFile.push(`${l.id} → ${e.file ?? '(no file field)'}`);
    return;
  }
  if (!(typeof e.seconds === 'number' && e.seconds > 0)) {
    problems.badSeconds.push(`${l.id}: seconds = ${JSON.stringify(e.seconds)}`);
    return;
  }
  const d = await probe(file);
  if (d === null) {
    problems.unreadable.push(`${l.id} → ${e.file}`);
    return;
  }
  if (Math.abs(d - e.seconds) > tolerance) {
    problems.lengthMismatch.push(`${l.id}: manifest ${e.seconds.toFixed(3)} s, file ${d.toFixed(3)} s`);
    return;
  }
  if (e.zone !== undefined && e.zone !== l.zone) problems.zoneMismatch.push(`${l.id}: manifest ${e.zone}, line ${l.zone}`);
  ok++;
});

const orphans = Object.keys(entries).filter((id) => !ids.has(id));
const listedFiles = new Set(Object.values(entries).map((e) => (e && typeof e.file === 'string' ? e.file : '')));
const strayFiles = existsSync(dir) ? readdirSync(dir).filter((f) => /\.(mp3|ogg|wav|m4a|flac)$/i.test(f) && !listedFiles.has(f)) : [];
const displayVoiced = excluded.filter((x) => x && entries[x.id]).map((x) => `${x.id} (${x.speaker}: ${x.text})`);
const valid = ok;
const total = lines.length;

const report = {
  lines: total, valid, manifest: manifest ? Object.keys(entries).length : 'unreadable', manifestPath, linesPath, tolerance,
  ...problems, orphans, strayFiles, displayVoiced,
};
if (asJson) console.log(JSON.stringify(report, null, 1));
else {
  console.log(`vo-check: ${valid}/${total} lines voiced and valid  (manifest: ${manifest ? Object.keys(entries).length + ' entries' : 'UNREADABLE'}, ${manifestPath})`);
  const show = (title, list) => {
    if (!list.length) return;
    console.log(`  ${title}: ${list.length}`);
    for (const x of list.slice(0, 12)) console.log(`    ${x}`);
    if (list.length > 12) console.log(`    … and ${list.length - 12} more`);
  };
  show('not in the manifest', problems.missing);
  show('listed, file missing or empty', problems.noFile);
  show('listed, seconds not > 0', problems.badSeconds);
  show('listed, ffprobe cannot read the file', problems.unreadable);
  show(`listed, seconds off by more than ${tolerance} s`, problems.lengthMismatch);
  show('zone differs from the line list (warning)', problems.zoneMismatch);
  show('orphan manifest entries (no such line)', orphans);
  show('files in the folder the manifest does not list', strayFiles);
  show('DISPLAY TEXT WITH A RECORDING (must never be voiced)', displayVoiced);
}
// listed-but-broken entries and voiced display text are errors; lines not recorded yet only with --strict
const broken = problems.noFile.length + problems.badSeconds.length + problems.unreadable.length + problems.lengthMismatch.length;
const bad = !manifest || broken > 0 || displayVoiced.length > 0 || (args.includes('--strict') && valid < total);
process.exit(bad ? 1 : 0);
