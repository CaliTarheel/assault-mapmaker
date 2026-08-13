#!/usr/bin/env node
// Assemble dist/ — a backend-free static site.
//
// The browser talks straight to AWS Terrain Tiles, Overpass and the basemap; all
// three send Access-Control-Allow-Origin: *, so no proxy is needed once the pages
// are served from a real origin. The only transform is moving lib/ in beside the
// page and rewriting the '../lib/' imports to match.
//
// Feature data for the showcase areas is baked in so the first view is instant
// rather than waiting on a cold Overpass query.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Placement } from './lib/board.js';
import { loadFeatures } from './lib/osm-node.js';
import { bboxKeyOf } from './lib/osm-key.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(ROOT, 'dist');

// Areas pre-baked into the bundle. Keep this short: each one is a chunk of payload.
const SHOWCASE = [
  { name: 'Fulda Gap', lat: 50.62, lon: 9.62, bearing: 0 },
  { name: 'Eckernförde Bay', lat: 54.47, lon: 9.87, bearing: 0 },
];

const copy = (from, to, transform) => {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  if (transform) {
    fs.writeFileSync(to, transform(fs.readFileSync(from, 'utf8')));
  } else {
    fs.copyFileSync(from, to);
  }
};

const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
  const p = path.join(dir, e.name);
  return e.isDirectory() ? walk(p) : [p];
});

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

// web/* -> dist/*, rewriting the one path assumption that changes.
for (const file of walk(path.join(ROOT, 'web'))) {
  const rel = path.relative(path.join(ROOT, 'web'), file);
  const isJs = file.endsWith('.js');
  copy(file, path.join(DIST, rel), isJs ? s => s.replaceAll('../lib/', './lib/') : null);
}

// lib/* -> dist/lib/*, minus the Node-only modules (they import node:fs).
const NODE_ONLY = new Set(['tiles-node.js', 'osm-node.js']);
for (const file of walk(path.join(ROOT, 'lib'))) {
  const rel = path.relative(path.join(ROOT, 'lib'), file);
  if (NODE_ONLY.has(rel)) continue;
  copy(file, path.join(DIST, 'lib', rel));
}

// Bake features for the showcase areas.
const baked = [];
for (const spot of SHOWCASE) {
  const bbox = new Placement(spot.lat, spot.lon, spot.bearing).bbox(200);
  const key = bboxKeyOf(bbox);
  process.stdout.write(`baking ${spot.name} (${key})… `);
  try {
    const features = await loadFeatures(ROOT, bbox, { log: () => {} });
    const out = path.join(DIST, 'data', 'osm', `${key}.json`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(features));
    baked.push(key);
    console.log(`${features.length} features, ${(fs.statSync(out).size / 1024).toFixed(0)} kB`);
  } catch (e) {
    console.log(`skipped (${e.message})`);
  }
}
fs.writeFileSync(path.join(DIST, 'data', 'osm', 'index.json'), JSON.stringify(baked));

// GitHub Pages otherwise runs everything through Jekyll, which ignores _-prefixed
// paths and can mangle things it thinks are templates.
fs.writeFileSync(path.join(DIST, '.nojekyll'), '');

const total = walk(DIST).reduce((n, f) => n + fs.statSync(f).size, 0);
console.log(`\ndist/ ready — ${walk(DIST).length} files, ${(total / 1024 / 1024).toFixed(2)} MB`);
console.log('serve it from any static host; no backend required.');
