#!/usr/bin/env node
// Local server for the navigator: static files plus disk-cached tile proxies.
// The proxies exist so the browser gets same-origin, CORS-free tiles and so we
// only ever pull a given tile from the network once.

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { cachedTile } from './lib/tiles-node.js';
import { TERRARIUM_URL } from './lib/dem.js';
import { loadFeatures } from './lib/osm-node.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8787;

const BASEMAPS = {
  osm: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
  topo: (z, x, y) => `https://tile.opentopomap.org/${z}/${x}/${y}.png`,
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function serveStatic(req, res, urlPath) {
  // Redirect rather than serve index.html from "/", so the page's relative
  // asset and module paths resolve against /web/ where the files actually live.
  if (urlPath === '/' || urlPath === '/web') {
    res.writeHead(302, { Location: '/web/' });
    return res.end();
  }
  const rel = urlPath === '/web/' ? '/web/index.html' : urlPath;
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(buf);
  });
}

async function serveTile(res, kind, z, x, y) {
  const n = 1 << z;
  if (!(z >= 0 && z <= 19) || x < 0 || y < 0 || x >= n || y >= n) {
    res.writeHead(400).end('bad tile'); return;
  }
  try {
    const urlFor = kind === 'dem' ? TERRARIUM_URL : BASEMAPS[kind];
    if (!urlFor) { res.writeHead(404).end('unknown tile source'); return; }
    const buf = await cachedTile(ROOT, kind, z, x, y, urlFor);
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=604800' });
    res.end(buf);
  } catch (e) {
    res.writeHead(502).end(String(e.message ?? e));
  }
}

// Overpass is slow and rate-limited, so the browser never talks to it directly —
// it asks here and gets whatever the disk cache already holds.
async function serveOsm(res, url) {
  const num = k => parseFloat(url.searchParams.get(k));
  const bbox = { south: num('s'), west: num('w'), north: num('n'), east: num('e') };
  if (Object.values(bbox).some(v => !Number.isFinite(v))) {
    res.writeHead(400).end('bad bbox'); return;
  }
  const span = Math.max(bbox.north - bbox.south, bbox.east - bbox.west);
  if (span > 0.35) { res.writeHead(400).end('bbox too large'); return; }
  try {
    const features = await loadFeatures(ROOT, bbox, { log: m => console.log(m) });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(features));
  } catch (e) {
    res.writeHead(502).end(JSON.stringify({ error: String(e.message ?? e) }));
  }
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const tile = url.pathname.match(/^\/tiles\/([a-z]+)\/(\d+)\/(\d+)\/(\d+)\.png$/);
  if (tile) {
    return serveTile(res, tile[1], +tile[2], +tile[3], +tile[4]);
  }
  if (url.pathname === '/osm') return serveOsm(res, url);
  serveStatic(req, res, url.pathname);
}).listen(PORT, () => {
  console.log(`assault-mapmaker navigator: http://localhost:${PORT}/`);
  console.log(`tiles cached under ${path.join(ROOT, 'cache')}`);
});
