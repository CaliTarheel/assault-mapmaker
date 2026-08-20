// Where the data comes from.
//
// Two modes, decided once at startup by probing for the local server:
//   proxied — running under `npm start`; tiles and Overpass go through the local
//             server, which caches everything to disk and spares Overpass.
//   direct  — running as a static site; the browser talks to the upstream services
//             itself. All three send Access-Control-Allow-Origin: *, so this works
//             from any host, which is what lets the whole thing deploy with no backend.
//
// Baked feature data ships with the static build for a few showcase areas, so the
// first view is instant instead of waiting on a cold Overpass query.

import { TERRARIUM_URL } from './lib/dem.js';
import { fetchFeaturesDirect } from './lib/osm-fetch.js';
import { bboxKeyOf } from './lib/osm-key.js';

const BASEMAPS = {
  osm: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
  topo: (z, x, y) => `https://tile.opentopomap.org/${z}/${x}/${y}.png`,
};

export const bboxKey = bboxKeyOf;

let mode = null;
let bakedIndex = null;

async function probe() {
  if (mode) return mode;
  try {
    const res = await fetch('/tiles/dem/1/0/0.png', { method: 'HEAD' });
    mode = res.ok ? 'proxied' : 'direct';
  } catch {
    mode = 'direct';
  }
  if (mode === 'direct') {
    try {
      const res = await fetch('data/osm/index.json');
      if (res.ok) bakedIndex = new Set(await res.json());
    } catch { bakedIndex = null; }
  }
  return mode;
}

export const currentMode = () => mode;

export async function init() {
  return probe();
}

export function demTileUrl(z, x, y) {
  return mode === 'proxied' ? `/tiles/dem/${z}/${x}/${y}.png` : TERRARIUM_URL(z, x, y);
}

export function basemapTemplate(style) {
  return mode === 'proxied'
    ? `/tiles/${style}/{z}/{x}/{y}.png`
    : BASEMAPS[style]('{z}', '{x}', '{y}');
}

// Terrarium pixels get read back off a canvas, so the image must be CORS-clean.
export const demCrossOrigin = () => (mode === 'proxied' ? null : 'anonymous');

export async function fetchFeatures(bbox, { onProgress } = {}) {
  await probe();

  if (mode === 'proxied') {
    onProgress?.(0, 1, 'asking local server');
    const r = await fetch(`/osm?s=${bbox.south}&w=${bbox.west}&n=${bbox.north}&e=${bbox.east}`);
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `osm ${r.status}`);
    return r.json();
  }

  const key = bboxKey(bbox);
  if (bakedIndex?.has(key)) {
    onProgress?.(0, 1, 'loading bundled features');
    const r = await fetch(`data/osm/${key}.json`);
    if (r.ok) return r.json();
  }
  return fetchFeaturesDirect(bbox, { onProgress });
}
