// Rasterise OSM features into board-space masks, in the Assault vocabulary.
//
// Line widths are specified in metres of real ground so they stay honest whatever
// pixel scale the board is rendered at. A primary road on the printed maps is drawn
// far wider than its true carriageway — the symbol is what matters, not the asphalt.

import { latLonToOffset, rad } from './geo.js';
import { fillPolygon, strokePath, dilate } from './raster.js';

// Symbol widths in metres of ground, matched to how wide these read on the printed
// boards at 3.18 m/px — a primary road is about 10 px there, a stream about 5.
export const WIDTHS = {
  primary: 30,
  secondary: 11,
  minor: 8,
  track: 7,
  river: 22,
  stream: 13,
  ditch: 7,
  coastline: 8,      // barrier only, never drawn
};

// Water bodies smaller than this never earn a Full Lake symbol; below roughly a
// third of a hex they are farm ponds, and drawing them just speckles the board.
export const MIN_LAKE_M2 = 18000;

export const DEFAULT_KINDS = ['woods', 'marsh', 'builtup', 'lake', 'secondary', 'primary', 'stream', 'river', 'coastline'];

export function makeProjector(placement) {
  const g = placement.g;
  const t = rad(placement.bearing), c = Math.cos(t), s = Math.sin(t);
  return (lat, lon) => {
    const [e, n] = latLonToOffset(placement.lat, placement.lon, lat, lon);
    // Inverse of Placement.pixelToOffset.
    const bx = e * c - n * s;
    const by = -e * s - n * c;
    return [bx / g.mPerPx + g.w / 2, by / g.mPerPx + g.h / 2];
  };
}

const ringAreaPx = ring => {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i], [x2, y2] = ring[(i + 1) % ring.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
};

export function rasteriseFeatures(features, placement, opts = {}) {
  const { kinds = DEFAULT_KINDS, minLakeM2 = MIN_LAKE_M2 } = opts;
  const g = placement.g;
  const n = g.w * g.h;
  const project = makeProjector(placement);
  const px = m => m / g.mPerPx;
  const minLakePx = minLakeM2 / (g.mPerPx * g.mPerPx);

  const masks = {
    woods: new Uint8Array(n),
    marsh: new Uint8Array(n),
    lake: new Uint8Array(n),
    stream: new Uint8Array(n),
    builtup: new Uint8Array(n),
    primary: new Uint8Array(n),
    secondary: new Uint8Array(n),
    track: new Uint8Array(n),
    coastline: new Uint8Array(n),
    w: g.w, h: g.h,
  };
  // river drains into stream, minor and ditch into their nearest equivalents.
  const target = { river: 'stream', minor: 'secondary', ditch: 'stream' };

  const toBoard = ring => ring.map(([lat, lon]) => project(lat, lon));
  const wanted = new Set(kinds);

  // Areas first, then lines on top — a road through a wood is still a road.
  const order = ['coastline', 'woods', 'marsh', 'builtup', 'lake', 'track', 'minor', 'secondary', 'primary', 'ditch', 'stream', 'river'];
  for (const kind of order) {
    if (!wanted.has(kind)) continue;
    const dest = masks[target[kind] ?? kind];
    if (!dest) continue;
    for (const f of features) {
      if (f.kind !== kind) continue;
      if (f.area) {
        const rings = f.rings.map(toBoard);
        if (kind === 'lake' && rings.every(r => ringAreaPx(r) < minLakePx)) continue;
        fillPolygon(dest, g.w, g.h, rings);
      } else {
        const width = px(WIDTHS[kind] ?? WIDTHS.secondary);
        for (const ring of f.rings) strokePath(dest, g.w, g.h, toBoard(ring), width);
      }
    }
  }

  return masks;
}

// Trim the DEM's ocean mask back to the OSM coastline.
//
// The elevation tiles carry their sea mask baked in at a much coarser zoom than we
// sample at, so a raw shoreline comes out in blocky 200 m steps. OSM has the real
// thing, but as `natural=coastline` ways rather than a polygon — there is no "the
// ocean" object to fill. So: take the coastline as a barrier, seed from water the
// DEM is confident about (eroded well clear of the blocky fringe), and flood the
// sea outward. The fill cannot cross the coastline, so it lands exactly on it.
export function seaToCoastline(demWater, coastline, w, h, { erode = 8, margin = 80 } = {}) {
  if (!coastline || !coastline.some(v => v)) return demWater;

  // The coastline ways Overpass returns for a bbox rarely enclose the board on their
  // own, so an unconstrained fill escapes round their ends and floods everything.
  // Confine it to within `margin` px of where the DEM already says water is: enough
  // slack to straighten a 250 m staircase, not enough to swallow the map.
  const allowed = dilate(demWater, w, h, margin);

  // Seeds: DEM water, shrunk away from its own unreliable edge and off the barrier.
  let seeds = demWater;
  for (let p = 0; p < erode; p++) {
    const next = new Uint8Array(seeds.length);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (seeds[i] && seeds[i - 1] && seeds[i + 1] && seeds[i - w] && seeds[i + w]) next[i] = 1;
      }
    }
    seeds = next;
  }

  const out = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let sp = 0;
  for (let i = 0; i < seeds.length; i++) {
    if (seeds[i] && !coastline[i]) { out[i] = 1; stack[sp++] = i; }
  }
  if (!sp) return demWater;

  const open = j => !out[j] && !coastline[j] && allowed[j];
  while (sp > 0) {
    const i = stack[--sp];
    const x = i % w, y = (i / w) | 0;
    if (x > 0) { const j = i - 1; if (open(j)) { out[j] = 1; stack[sp++] = j; } }
    if (x < w - 1) { const j = i + 1; if (open(j)) { out[j] = 1; stack[sp++] = j; } }
    if (y > 0) { const j = i - w; if (open(j)) { out[j] = 1; stack[sp++] = j; } }
    if (y < h - 1) { const j = i + w; if (open(j)) { out[j] = 1; stack[sp++] = j; } }
  }
  // The barrier itself is the waterline, so count it as wet.
  for (let i = 0; i < out.length; i++) if (coastline[i] && demWater[i]) out[i] = 1;

  // If the refined mask is wildly bigger than what we started from, the coastline
  // did not enclose anything useful — keep the DEM's answer rather than a flooded map.
  let before = 0, after = 0;
  for (let i = 0; i < out.length; i++) { if (demWater[i]) before++; if (out[i]) after++; }
  return after > before * 1.6 + 5000 ? demWater : out;
}

// Merge the sea mask from the DEM into the lake mask — as far as the game is
// concerned open water is open water, and the TEC has one symbol for it.
export function mergeWater(masks, seaMask) {
  if (!seaMask) return masks;
  const sea = masks.coastline ? seaToCoastline(seaMask, masks.coastline, masks.w, masks.h) : seaMask;
  if (!masks.lake) masks.lake = new Uint8Array(sea.length);
  for (let i = 0; i < sea.length; i++) if (sea[i]) masks.lake[i] = 1;
  // Ground cover has no meaning under open water, and OSM waterways carry on out
  // to sea, which draws stream ribbons across the middle of a bay.
  for (const k of ['stream', 'marsh', 'woods', 'builtup']) {
    if (!masks[k]) continue;
    for (let i = 0; i < masks.lake.length; i++) if (masks.lake[i]) masks[k][i] = 0;
  }
  return masks;
}

// Assault distinguishes a Town (a solid built-up blob) from an Urban Strip (buildings
// strung thinly along a road). OSM landuse gives us the blob; the strip is what is
// left when the blob is too small to swallow a hex, so it falls out of the per-hex
// share rather than needing its own source layer.
export const TOWN_SHARE = 0.25;
export const URBAN_SHARE = 0.04;

export function shoreline(lakeMask, w, h, widthPx = 2) {
  const grown = dilate(lakeMask, w, h, Math.max(1, Math.round(widthPx)));
  const edge = new Uint8Array(lakeMask.length);
  for (let i = 0; i < edge.length; i++) if (grown[i] && !lakeMask[i]) edge[i] = 1;
  return edge;
}
