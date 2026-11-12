#!/usr/bin/env node
/**
 * Serve the built game the way it will be hosted: static files only, under a sub-path, with the same media
 * types the publish plan declares (tools/publish-plan.mjs), nothing at the root, no SPA fallback.
 *
 *   node tools/serve-dist.mjs [--dist dist] [--port 4173] [--prefix /a/b/game/] [--host 127.0.0.1] [--log file] [--cors]
 *
 * The page is then at http://<host>:<port><prefix>. Every request outside the prefix is a 404, so an absolute
 * URL anywhere in the game (`/audio/…`, `/assets/…`) shows up as a failed request instead of working by
 * accident. `--log` appends one line per request (status, bytes, path) for checking what was fetched. `--cors`
 * adds `Access-Control-Allow-Origin: *`, which a page in a sandboxed iframe without allow-same-origin (an opaque
 * origin) needs for its module script, fonts and fetches.
 * Plain Node, no dependencies.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { contentTypeOf } from './publish-plan.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const o = { dist: path.join(ROOT, 'dist'), port: 4173, prefix: '/a/b/game/', host: '127.0.0.1', log: null, cors: false };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--cors') {
    o.cors = true;
    continue;
  }
  const v = argv[++i];
  if (a === '--dist') o.dist = path.resolve(v);
  else if (a === '--port') o.port = Number(v);
  else if (a === '--prefix') o.prefix = v.endsWith('/') ? v : `${v}/`;
  else if (a === '--host') o.host = v;
  else if (a === '--log') o.log = path.resolve(v);
  else {
    console.error(`[serve-dist] unknown argument ${a}`);
    process.exit(2);
  }
}
if (!o.prefix.startsWith('/')) o.prefix = `/${o.prefix}`;
const distRoot = path.resolve(o.dist);
if (!fs.existsSync(path.join(distRoot, 'index.html'))) {
  console.error(`[serve-dist] no index.html in ${distRoot} — run npm run build:ship first`);
  process.exit(1);
}

const log = (status, bytes, url) => {
  if (o.log) fs.appendFile(o.log, `${status} ${bytes} ${url}\n`, () => {});
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  let rel = null;
  if (url.pathname.startsWith(o.prefix)) rel = decodeURIComponent(url.pathname.slice(o.prefix.length));
  else if (url.pathname === o.prefix.slice(0, -1)) {
    res.writeHead(301, { location: o.prefix + url.search });
    res.end();
    log(301, 0, req.url);
    return;
  }
  if (rel === null) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
    log(404, 0, req.url);
    return;
  }
  if (rel === '' || rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(distRoot, rel);
  if (!file.startsWith(distRoot + path.sep)) {
    res.writeHead(403);
    res.end();
    log(403, 0, req.url);
    return;
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
      log(404, 0, req.url);
      return;
    }
    const type = contentTypeOf(file) ?? 'application/octet-stream';
    res.writeHead(200, { 'content-type': type, 'content-length': st.size, 'cache-control': 'no-store', ...(o.cors ? { 'access-control-allow-origin': '*' } : {}) });
    if (req.method === 'HEAD') {
      res.end();
      log(200, 0, req.url);
      return;
    }
    fs.createReadStream(file).pipe(res);
    log(200, st.size, req.url);
  });
});
server.listen(o.port, o.host, () => {
  console.log(`[serve-dist] ${distRoot} at http://${o.host}:${o.port}${o.prefix}`);
});
