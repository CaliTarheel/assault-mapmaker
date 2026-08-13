// The navigator. Leaflet on the left to place a board footprint on real ground,
// the rendered Assault board on the right. Everything below the tile fetch is the
// same code the headless renderer uses.

import { Placement, BOARD_W_M, BOARD_H_M, hexCenterPx } from '../lib/board.js';
import { zoomForResolution } from '../lib/geo.js';
import { DemGrid, tileCover } from '../lib/dem.js';
import { buildFields, autoBase, analyseHexes, summarise, splitBuiltup } from '../lib/terrain.js';
import { renderBoard } from '../lib/render.js';
import { TINTS, tintHex } from '../lib/palette.js';
import { rasteriseFeatures, mergeWater, DEFAULT_KINDS } from '../lib/features.js';
import { summariseFeatures } from '../lib/osm.js';
import * as sources from './sources.js';

const $ = id => document.getElementById(id);
const canvas = $('board');
const ctx = canvas.getContext('2d');

const state = {
  lat: 50.62, lon: 9.62, bearing: 0,
  last: null,          // most recent render result, for export
};

// ---------------------------------------------------------------- map

const map = L.map('map', { zoomControl: true }).setView([state.lat, state.lon], 12);

let layers = null;
function buildLayers() {
  layers = {
    'OpenStreetMap': L.tileLayer(sources.basemapTemplate('osm'), {
      maxZoom: 19, attribution: '&copy; OpenStreetMap contributors',
    }),
    'OpenTopoMap': L.tileLayer(sources.basemapTemplate('topo'), {
      maxZoom: 17, attribution: '&copy; OpenTopoMap (CC-BY-SA)',
    }),
  };
  layers['OpenTopoMap'].addTo(map);
  L.control.layers(layers).addTo(map);
}

const footprint = L.polygon([], { color: '#e0a23c', weight: 2, fillOpacity: 0.06 }).addTo(map);
const upArrow = L.polyline([], { color: '#e0a23c', weight: 2, opacity: 0.9, dashArray: '5 4' }).addTo(map);

function currentPlacement(hexPx) {
  return new Placement(state.lat, state.lon, state.bearing, hexPx);
}

function drawFootprint() {
  const p = currentPlacement(78.6);
  footprint.setLatLngs(p.corners());
  const g = p.g;
  upArrow.setLatLngs([p.pixelToLatLon(g.w / 2, g.h / 2), p.pixelToLatLon(g.w / 2, 0)]);
  $('lat').value = state.lat.toFixed(5);
  $('lon').value = state.lon.toFixed(5);
}

map.on('move', () => {
  if (!$('follow').checked) return;
  const c = map.getCenter();
  state.lat = c.lat; state.lon = c.lng;
  drawFootprint();
});

$('goto').onclick = () => {
  state.lat = parseFloat($('lat').value);
  state.lon = parseFloat($('lon').value);
  map.setView([state.lat, state.lon], map.getZoom());
  drawFootprint();
};

$('usecentre').onclick = () => {
  const c = map.getCenter();
  state.lat = c.lat; state.lon = c.lng;
  drawFootprint();
};

function setBearing(b) {
  state.bearing = ((b % 360) + 360) % 360;
  $('bearing').value = state.bearing;
  $('bearingNum').value = state.bearing;
  drawFootprint();
}
$('bearing').oninput = e => setBearing(+e.target.value);
$('bearingNum').onchange = e => setBearing(+e.target.value);
document.querySelectorAll('[data-bearing]').forEach(b => {
  b.onclick = () => setBearing(+b.dataset.bearing);
});

$('datumMode').onchange = e => { $('baseM').disabled = e.target.value !== 'manual'; };

// ---------------------------------------------------------------- dem

const tileCache = new Map();

function loadTileRgba(z, x, y) {
  const key = `${z}/${x}/${y}`;
  if (tileCache.has(key)) return tileCache.get(key);
  const p = new Promise((resolve, reject) => {
    const img = new Image();
    const co = sources.demCrossOrigin();
    if (co) img.crossOrigin = co;
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const cx = c.getContext('2d', { willReadFrequently: true });
      cx.drawImage(img, 0, 0);
      resolve(cx.getImageData(0, 0, img.width, img.height).data);
    };
    img.onerror = () => reject(new Error(`tile ${key} failed`));
    img.src = sources.demTileUrl(z, x, y);
  });
  tileCache.set(key, p);
  return p;
}

async function loadDem(placement, zoom, onProgress) {
  const bb = placement.bbox();
  const cover = tileCover(zoom, bb.north, bb.south, bb.west, bb.east, 0);
  const dem = new DemGrid(cover.z, cover.tx0, cover.ty0, cover.nx, cover.ny);
  let done = 0;
  await Promise.all(cover.tiles.map(async t => {
    const rgba = await loadTileRgba(t.z, t.x, t.y);
    dem.setTile(t.x, t.y, rgba);
    onProgress?.(++done, cover.tiles.length);
  }));
  return { dem, tiles: cover.tiles.length };
}

function sampleBoard(dem, placement) {
  const g = placement.g;
  const out = new Float32Array(g.w * g.h);
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      const [lat, lon] = placement.pixelToLatLon(x + 0.5, y + 0.5);
      out[y * g.w + x] = dem.sample(lat, lon);
    }
  }
  return out;
}

// ---------------------------------------------------------------- osm

const osmCache = new Map();

async function loadOsm(placement, onProgress) {
  const bb = placement.bbox(200);
  const key = sources.bboxKey(bb);
  if (osmCache.has(key)) return osmCache.get(key);
  const p = sources.fetchFeatures(bb, { onProgress });
  osmCache.set(key, p);
  p.catch(() => osmCache.delete(key));
  return p;
}

// ---------------------------------------------------------------- render

const busy = msg => { $('busy').textContent = msg ?? ''; };

async function render({ hexPx } = {}) {
  const px = hexPx ?? +$('hexpx').value;
  const placement = currentPlacement(px);
  const g = placement.g;

  busy('fetching dem…');
  const zoom = zoomForResolution(state.lat, 15);
  const { dem, tiles } = await loadDem(placement, zoom, (d, n) => busy(`dem ${d}/${n}`));

  busy('sampling…');
  await new Promise(r => setTimeout(r, 0));
  const elev = sampleBoard(dem, placement);

  const interval = +$('interval').value;
  const mode = $('datumMode').value;
  const seaLevel = +$('sealevel').value;
  const stats = autoBase(elev, { interval, lowPercentile: mode === 'p2' ? 2 : 0, seaLevel });
  const base = mode === 'manual' ? +$('baseM').value : stats.base;
  if (mode !== 'manual') $('baseM').value = Math.round(base);

  busy('quantising…');
  await new Promise(r => setTimeout(r, 0));
  // Feature sizes are set in board metres, so they stay put when hex px changes.
  const refScale = px / 78.6;
  const fields = buildFields(elev, g.w, g.h, {
    base, interval, seaLevel,
    smoothRadius: Math.max(0, Math.round(+$('smooth').value * refScale)),
    minRegionPx: Math.round(+$('minregion').value * refScale * refScale),
  });

  let masks = null, featureCounts = null;
  if ($('useFeatures').checked) {
    busy('fetching map features…');
    try {
      const features = await loadOsm(placement, (i, n, what) =>
        busy(`features ${i}/${n} — ${what}`));
      featureCounts = summariseFeatures(features);
      const kinds = [...DEFAULT_KINDS];
      if ($('useTracks').checked) kinds.push('track');
      if ($('useMinor').checked) kinds.push('minor');
      busy('rasterising features…');
      await new Promise(r => setTimeout(r, 0));
      masks = mergeWater(rasteriseFeatures(features, placement, { kinds }), fields.water);
    } catch (e) {
      console.warn('osm unavailable:', e.message);
      $('featureNote').textContent = e.message;
    }
  } else if (fields.water) {
    masks = mergeWater({ lake: new Uint8Array(g.w * g.h) }, fields.water);
  }

  const hexes = analyseHexes(fields.band, fields.level, g.w, g.h, g, { masks });
  const report = summarise(hexes);
  if (masks?.builtup) {
    const split = splitBuiltup(masks, hexes, g.w, g.h, g);
    masks.builtupTown = split.town;
    masks.builtupUrban = split.urban;
  }

  busy('painting…');
  const rgba = renderBoard(fields.band, g.w, g.h, g, {
    masks,
    symbolScale: refScale,
    grid: $('showGrid').checked,
    contourWidth: Math.max(1, Math.round(2 * refScale)),
    steepHexes: $('showSteep').checked ? hexes.filter(h => h.steep) : [],
  });

  canvas.width = g.w; canvas.height = g.h;
  ctx.putImageData(new ImageData(rgba, g.w, g.h), 0, 0);
  if ($('showLevels').checked) drawLevels(hexes, g);
  if ($('showTerrain').checked) drawTerrain(hexes, g);
  if ($('showDrift').checked) markDrift(hexes, g);

  state.last = { placement, g, base, interval, stats, fields, hexes, report, tiles, zoom, featureCounts };
  showStats(state.last);
  busy('');
  return state.last;
}

function drawLevels(hexes, g) {
  const size = Math.max(9, Math.round(g.hexFlatPx * 0.20));
  ctx.font = `600 ${size}px "Segoe UI", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const h of hexes) {
    const txt = h.levels.join('/');
    const w = ctx.measureText(txt).width;
    ctx.fillStyle = 'rgba(255,255,255,0.82)';
    ctx.fillRect(h.cx - w / 2 - 3, h.cy - size * 0.62, w + 6, size * 1.24);
    ctx.fillStyle = h.steep ? '#b22d2d' : '#16150f';
    ctx.fillText(txt, h.cx, h.cy);
  }
}

const TERRAIN_LETTER = { woods: 'W', town: 'T', urban: 'U', lake: 'L', marsh: 'M', clear: '' };

function drawTerrain(hexes, g) {
  const size = Math.max(8, Math.round(g.hexFlatPx * 0.16));
  ctx.font = `600 ${size}px "Segoe UI", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const h of hexes) {
    const bits = [TERRAIN_LETTER[h.terrain] ?? '', h.roads?.includes('primary') ? 'P' : '',
      h.roads?.includes('secondary') ? 'r' : '', h.stream ? 's' : ''].filter(Boolean).join('');
    if (!bits) continue;
    const y = h.cy - g.hexFlatPx * 0.30;
    const w = ctx.measureText(bits).width;
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillRect(h.cx - w / 2 - 2, y - size * 0.6, w + 4, size * 1.2);
    ctx.fillStyle = '#243018';
    ctx.fillText(bits, h.cx, y);
  }
}

function markDrift(hexes, g) {
  ctx.lineWidth = Math.max(1, g.hexFlatPx / 40);
  for (const h of hexes) {
    if (h.faithful) continue;
    ctx.strokeStyle = `rgba(60,120,220,${Math.min(0.85, 0.25 + h.drift)})`;
    ctx.beginPath();
    ctx.arc(h.cx, h.cy + g.hexFlatPx * 0.30, g.hexFlatPx * 0.07, 0, Math.PI * 2);
    ctx.stroke();
  }
}

const TERRAIN_ORDER = ['clear', 'woods', 'town', 'urban', 'lake', 'marsh'];

function showStats(r) {
  const { stats, base, interval, fields, report, tiles, zoom } = r;
  const needed = (stats.max - base) / interval;
  const cell = (label, value, warn = false) =>
    `<div class="${warn ? 'warn' : ''}"><span>${label}</span> <b>${value}</b></div>`;

  $('stats').innerHTML = [
    cell('ground', `${stats.min.toFixed(0)}–${stats.max.toFixed(0)} m asl`),
    cell('level 0 datum', `${base.toFixed(0)} m`),
    cell('relief', `${(stats.max - base).toFixed(0)} m`),
    cell('levels needed', `${needed.toFixed(1)} of 9`, needed > 9),
    cell('flattened at 8', `${(100 * fields.clippedFraction).toFixed(1)}%`, fields.clippedFraction > 0.02),
    cell('steep slopes', report.steep),
    cell('reads back true', `${report.faithfulPct.toFixed(0)}%`),
    cell('mean drift', `${report.meanDrift.toFixed(2)} lvl`),
    cell('dem', `${tiles} tiles @ z${zoom}`),
    cell('below waterline', `${(100 * (fields.waterFraction ?? 0)).toFixed(1)}%`),
    ...(report.terrainHist ? TERRAIN_ORDER
      .filter(k => report.terrainHist[k])
      .map(k => cell(k, report.terrainHist[k])) : []),
    ...(report.withPrimary || report.withSecondary
      ? [cell('road hexes', `${report.withPrimary} primary / ${report.withSecondary} secondary`)] : []),
    ...(report.withStream ? [cell('stream hexes', report.withStream)] : []),
    ...(report.partialLake ? [cell('part-water hexes', report.partialLake)] : []),
  ].join('');

  $('legend').innerHTML = TINTS.map((t, i) => {
    const [lo, hi] = t.levels;
    const n = report.levelHist;
    const count = (n[lo] ?? 0) + (lo === hi ? 0 : (n[hi] ?? 0));
    return `<div><i style="background:${t.hex}"></i>${lo === hi ? lo : `${lo} or ${hi}`} · ${count} hex</div>`;
  }).join('') + (needed > 9
    ? `<div style="color:#e0a23c">relief exceeds 9 levels — try ${stats.fitInterval} m/level</div>` : '');
}

// ---------------------------------------------------------------- export

$('render').onclick = () => render().catch(err => { busy(''); alert(err.message); });

$('exportPng').onclick = async () => {
  busy('rendering at board scale…');
  const r = await render({ hexPx: 78.6 });
  const a = document.createElement('a');
  a.download = `assault_${r.placement.lat.toFixed(4)}_${r.placement.lon.toFixed(4)}_${r.placement.bearing}.png`;
  a.href = canvas.toDataURL('image/png');
  a.click();
  busy('');
};

$('exportJson').onclick = () => {
  const r = state.last;
  if (!r) return alert('render a board first');
  const data = {
    placement: { lat: r.placement.lat, lon: r.placement.lon, bearing: r.placement.bearing },
    board: { cols: r.g.cols, rows: r.g.rows, widthM: BOARD_W_M, heightM: BOARD_H_M },
    vertical: { base: r.base, interval: r.interval, min: r.stats.min, max: r.stats.max },
    report: r.report,
    hexes: r.hexes.map(h => ({
      id: h.id, col: h.col, row: h.row,
      levels: h.levels, demLevels: h.demLevels, bands: h.bands,
      steep: h.steep, faithful: h.faithful, drift: +h.drift.toFixed(3),
      terrain: h.terrain, blocking: h.blocking, roads: h.roads,
      stream: h.stream, partialLake: h.partialLake, share: h.share,
    })),
  };
  const a = document.createElement('a');
  a.download = `assault_${r.placement.lat.toFixed(4)}_${r.placement.lon.toFixed(4)}.json`;
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
  a.click();
};

for (const id of ['showGrid', 'showLevels', 'showSteep', 'showDrift', 'showTerrain',
                  'useFeatures', 'useTracks', 'useMinor']) {
  $(id).onchange = () => { if (state.last) render().catch(err => busy(err.message)); };
}

(async () => {
  const mode = await sources.init();
  buildLayers();
  document.body.dataset.mode = mode;
  $('modeNote').textContent = mode === 'proxied'
    ? 'local server — tiles and features cached to disk'
    : 'direct — elevation from AWS Terrain Tiles, features from Overpass';
  drawFootprint();
  render().catch(err => busy(err.message));
})();
