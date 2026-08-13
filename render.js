#!/usr/bin/env node
// Headless render: pick a spot, get a board.
//
//   node render.js --lat 50.71 --lon 7.95 --bearing 0 --out out/westerwald
//
// Writes <out>.png (the board) and <out>.json (per-hex levels + fidelity report).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

import { Placement, BOARD_W_M, BOARD_H_M, M_PER_LEVEL } from './lib/board.js';
import { zoomForResolution } from './lib/geo.js';
import { loadDem, sampleBoard } from './lib/tiles-node.js';
import { buildFields, autoBase, analyseHexes, summarise, splitBuiltup, SEA_LEVEL } from './lib/terrain.js';
import { renderBoard } from './lib/render.js';
import { loadFeatures } from './lib/osm-node.js';
import { rasteriseFeatures, mergeWater, DEFAULT_KINDS } from './lib/features.js';
import { summariseFeatures } from './lib/osm.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

function args(argv) {
  const o = {};
  for (let i = 2; i < argv.length; i += 2) o[argv[i].replace(/^--/, '')] = argv[i + 1];
  return o;
}

const a = args(process.argv);
const lat = parseFloat(a.lat ?? '50.71');
const lon = parseFloat(a.lon ?? '7.95');
const bearing = parseFloat(a.bearing ?? '0');
const hexPx = parseFloat(a.hexpx ?? '78.6');
const smoothRadius = parseInt(a.smooth ?? '3', 10);
const minRegionPx = parseInt(a.minregion ?? '260', 10);
const interval = parseFloat(a.interval ?? String(M_PER_LEVEL));
const out = a.out ?? 'out/board';

const placement = new Placement(lat, lon, bearing, hexPx);
const g = placement.g;
// The underlying data is ~30 m posts, so there is nothing to gain below ~15 m/px
// and each extra zoom level quadruples the tile count.
const zoom = a.zoom ? parseInt(a.zoom, 10) : zoomForResolution(lat, 15);

console.log(`board ${g.w}x${g.h}px  ${(BOARD_W_M / 1000).toFixed(2)} x ${(BOARD_H_M / 1000).toFixed(2)} km`
  + `  @ ${g.mPerPx.toFixed(2)} m/px   centre ${lat.toFixed(5)},${lon.toFixed(5)} bearing ${bearing}deg`);

const { dem, tileCount } = await loadDem(ROOT, placement, zoom);
console.log(`dem: ${tileCount} terrarium tiles at z${zoom}`);

const elev = sampleBoard(dem, placement);
let nan = 0;
for (const v of elev) if (Number.isNaN(v)) nan++;
if (nan) console.warn(`warning: ${nan} samples fell outside the dem mosaic`);

const lowPct = parseFloat(a.lowpct ?? '0');
const seaLevel = a.sealevel === 'none' ? null : parseFloat(a.sealevel ?? String(SEA_LEVEL));
const stats = autoBase(elev, { interval, lowPercentile: lowPct, seaLevel });
const base = a.base != null && a.base !== 'auto' ? parseFloat(a.base) : stats.base;
console.log(`elevation ${stats.min.toFixed(0)}..${stats.max.toFixed(0)} m asl`
  + `   level 0 datum ${base.toFixed(0)} m   relief above datum ${(stats.max - base).toFixed(0)} m`);
console.log(`${interval} m/level -> needs ${((stats.max - base) / interval).toFixed(1)} levels of the 9 available`);
if (!stats.fits && !a.interval) {
  console.warn(`note: this ground is too tall for ${interval} m levels. `
    + `--interval ${stats.fitInterval} would hold it all, or leave it and the tops flatten at level 8.`);
}

const fields = buildFields(elev, g.w, g.h, { base, interval, smoothRadius, minRegionPx, seaLevel });
if (fields.clippedFraction > 0.001) {
  console.warn(`warning: ${(100 * fields.clippedFraction).toFixed(1)}% of the board sits above level 8 and is flattened`);
}
if (fields.waterFraction > 0.0005) {
  console.log(`waterline: ${(100 * fields.waterFraction).toFixed(1)}% of the board is at or below ${seaLevel} m`
    + ` and is held flat at level 0`);
}
const contours = [1, 3, 5, 7].map(l => (base + l * interval).toFixed(0));
console.log(`drawn contours (colour changes) at ${contours.join(', ')} m asl;`
  + ` hidden steps at ${[2, 4, 6, 8].map(l => (base + l * interval).toFixed(0)).join(', ')} m`);

let masks = null;
if (a.features !== 'false') {
  const features = await loadFeatures(ROOT, placement.bbox(200), { log: m => console.log(m) });
  console.log('osm features:', Object.entries(summariseFeatures(features)).map(([k, v]) => `${k}:${v}`).join('  ') || 'none');
  const kinds = [...DEFAULT_KINDS];
  if (a.tracks === 'true') kinds.push('track');
  if (a.minorroads === 'true') kinds.push('minor');
  masks = mergeWater(rasteriseFeatures(features, placement, { kinds }), fields.water);
}

const hexes = analyseHexes(fields.band, fields.level, g.w, g.h, g, { masks });
const report = summarise(hexes);
if (masks) {
  const split = splitBuiltup(masks, hexes, g.w, g.h, g);
  masks.builtupTown = split.town;
  masks.builtupUrban = split.urban;
}
console.log(`hexes ${report.hexes}   steep slopes ${report.steep}   `
  + `faithful to dem ${report.faithfulPct.toFixed(1)}%   mean drift ${report.meanDrift.toFixed(2)} levels`);
console.log('levels:', Object.entries(report.levelHist).map(([k, v]) => `${k}:${v}`).join('  '));
if (masks) {
  console.log('terrain:', Object.entries(report.terrainHist).map(([k, v]) => `${k}:${v}`).join('  '));
  console.log(`roads: ${report.withPrimary} hexes with primary, ${report.withSecondary} with secondary;`
    + ` ${report.withStream} with a stream; ${report.partialLake} part-water (want full lake hexsides)`);
}

const rgba = renderBoard(fields.band, g.w, g.h, g, {
  masks,
  steepHexes: a.marksteep === 'false' ? [] : hexes.filter(h => h.steep),
});

fs.mkdirSync(path.dirname(path.resolve(ROOT, out)), { recursive: true });
const png = new PNG({ width: g.w, height: g.h });
png.data = Buffer.from(rgba.buffer, rgba.byteOffset, rgba.length);
fs.writeFileSync(path.resolve(ROOT, out + '.png'), PNG.sync.write(png));

fs.writeFileSync(path.resolve(ROOT, out + '.json'), JSON.stringify({
  placement: { lat, lon, bearing, hexPx },
  grid: { cols: g.cols, rows: g.rows, w: g.w, h: g.h, mPerPx: g.mPerPx },
  vertical: { base, interval, seaLevel, ...stats, clippedFraction: fields.clippedFraction, waterFraction: fields.waterFraction },
  report,
  hexes: hexes.map(h => ({
    id: h.id, col: h.col, row: h.row, c: { x: h.cx, y: h.cy },
    levels: h.levels, demLevels: h.demLevels, bands: h.bands,
    steep: h.steep, faithful: h.faithful, drift: +h.drift.toFixed(3),
    terrain: h.terrain, blocking: h.blocking, roads: h.roads, stream: h.stream,
    partialLake: h.partialLake, share: h.share,
  })),
}, null, 1));

console.log(`wrote ${out}.png and ${out}.json`);
