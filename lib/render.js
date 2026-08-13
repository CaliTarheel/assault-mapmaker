// Paint a band field as an Assault board: flat tints, a contour stroke on every
// colour change, then the hex grid over the top. Returns raw RGBA so Node can
// write a PNG and the browser can putImageData it straight onto a canvas.

import { tintRgb, CONTOUR, GRID, STEEP, FEATURE } from './palette.js';
import { hexCenterPx, hexVertices } from './board.js';
import { shoreline } from './features.js';

const put = (buf, i, rgb) => { buf[i] = rgb[0]; buf[i + 1] = rgb[1]; buf[i + 2] = rgb[2]; };

// Cheap deterministic hash -> 0..1, so stipple and building blocks are stable
// between renders instead of dancing about every time you nudge a slider.
const noise = (x, y) => {
  let n = (x * 374761393 + y * 668265263) | 0;
  n = (n ^ (n >> 13)) * 1274126177 | 0;
  return ((n ^ (n >> 16)) >>> 0) / 4294967296;
};

// Woods are drawn as stipple over the terrain tint, never as a flat fill — the
// elevation band has to stay readable underneath, because the rules read levels
// off the colour areas even where trees cover them.
function paintWoods(buf, mask, w, h, scale = 1) {
  const cell = Math.max(4, Math.round(8 * scale));
  const rad = Math.max(1.2, 2.6 * scale);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      const gx = Math.floor(x / cell), gy = Math.floor(y / cell);
      if (noise(gx + 3, gy + 11) < 0.16) continue;
      const jx = gx * cell + noise(gx, gy) * cell;
      const jy = gy * cell + noise(gy, gx + 7) * cell;
      // Slightly squashed blobs, so the stipple reads as foliage not polka dots.
      const dx = (x - jx) / rad, dy = (y - jy) / (rad * 0.8);
      if (dx * dx + dy * dy <= 1) put(buf, i * 4, FEATURE.woods);
    }
  }
}

function paintMarsh(buf, mask, w, h) {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      const p = i * 4;
      // Pale wash, then short horizontal dashes in rows.
      buf[p] = (buf[p] + FEATURE.marsh[0] * 2) / 3;
      buf[p + 1] = (buf[p + 1] + FEATURE.marsh[1] * 2) / 3;
      buf[p + 2] = (buf[p + 2] + FEATURE.marsh[2] * 2) / 3;
      if (y % 7 < 2 && (x + (y % 14 < 7 ? 0 : 5)) % 14 < 7) put(buf, p, FEATURE.marshDash);
    }
  }
}

// An urban strip is scattered blocks, not a wash — that is how the printed maps
// distinguish it from a town at a glance.
function paintUrban(buf, mask, w, h) {
  const cell = 13;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      const gx = Math.floor(x / cell), gy = Math.floor(y / cell);
      if (noise(gx + 31, gy + 17) < 0.55) continue;
      const ox = x - gx * cell, oy = y - gy * cell;
      if (ox < 3 || ox > 8 || oy < 3 || oy > 7) continue;
      put(buf, i * 4, FEATURE.urban);
    }
  }
}

function paintMask(buf, mask, w, h, rgb) {
  for (let i = 0; i < mask.length; i++) if (mask[i]) put(buf, i * 4, rgb);
}

function line(buf, w, h, x0, y0, x1, y1, rgb, alpha = 1) {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    if (x0 >= 0 && y0 >= 0 && x0 < w && y0 < h) {
      const i = (y0 * w + x0) * 4;
      for (let k = 0; k < 3; k++) buf[i + k] = buf[i + k] * (1 - alpha) + rgb[k] * alpha;
    }
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

export function renderBoard(band, w, h, g, opts = {}) {
  const {
    contourWidth = 2,
    grid = true,
    texture = true,
    steepHexes = [],
    masks = null,
    features = true,
    symbolScale = 1,
  } = opts;

  const buf = new Uint8ClampedArray(w * h * 4);

  for (let i = 0, p = 0; i < band.length; i++, p += 4) {
    const c = tintRgb(band[i]);
    buf[p] = c[0]; buf[p + 1] = c[1]; buf[p + 2] = c[2]; buf[p + 3] = 255;
  }

  // Faint paper grain, so large flats do not read as flat vector fill.
  if (texture) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const n = ((x * 73856093) ^ (y * 19349663)) & 0xff;
        const d = ((n / 255) - 0.5) * 7;
        const p = (y * w + x) * 4;
        buf[p] += d; buf[p + 1] += d; buf[p + 2] += d;
      }
    }
  }

  // Contour = any pixel whose band differs from its right or lower neighbour.
  const edge = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (x + 1 < w && band[i] !== band[i + 1]) { edge[i] = 1; edge[i + 1] = 1; }
      if (y + 1 < h && band[i] !== band[i + w]) { edge[i] = 1; edge[i + w] = 1; }
    }
  }
  let mask = edge;
  for (let pass = 1; pass < contourWidth; pass++) {
    const next = Uint8Array.from(mask);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!mask[i]) continue;
        if (x > 0) next[i - 1] = 1;
        if (x < w - 1) next[i + 1] = 1;
        if (y > 0) next[i - w] = 1;
        if (y < h - 1) next[i + w] = 1;
      }
    }
    mask = next;
  }
  for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
    if (!mask[i]) continue;
    buf[p] = CONTOUR[0]; buf[p + 1] = CONTOUR[1]; buf[p + 2] = CONTOUR[2];
  }

  // Features, bottom to top: ground cover, then water, then the road net. Order is
  // the printed map's own — a road drawn through a wood still reads as a road.
  if (masks && features) {
    if (masks.marsh) paintMarsh(buf, masks.marsh, w, h);
    if (masks.woods) paintWoods(buf, masks.woods, w, h, symbolScale);
    if (masks.builtupTown) {
      paintMask(buf, masks.builtupTown, w, h, FEATURE.town);
      paintMask(buf, shoreline(masks.builtupTown, w, h, 1), w, h, FEATURE.townEdge);
    }
    if (masks.builtupUrban) paintUrban(buf, masks.builtupUrban, w, h);
    if (masks.lake) {
      paintMask(buf, masks.lake, w, h, FEATURE.lake);
      paintMask(buf, shoreline(masks.lake, w, h, 1), w, h, FEATURE.lakeEdge);
    }
    if (masks.stream) paintMask(buf, masks.stream, w, h, FEATURE.stream);
    if (masks.track) paintMask(buf, masks.track, w, h, FEATURE.secondary);
    if (masks.secondary) paintMask(buf, masks.secondary, w, h, FEATURE.secondary);
    if (masks.primary) {
      paintMask(buf, shoreline(masks.primary, w, h, 1), w, h, FEATURE.primaryEdge);
      paintMask(buf, masks.primary, w, h, FEATURE.primary);
    }
  }

  if (steepHexes.length) {
    for (const hx of steepHexes) {
      const v = hexVertices(hx.cx, hx.cy, g.R - 3);
      for (let i = 0; i < 6; i++) {
        const a = v[i], b = v[(i + 1) % 6];
        line(buf, w, h, a[0], a[1], b[0], b[1], STEEP, 0.85);
      }
    }
  }

  if (grid) {
    for (let col = 1; col <= g.cols; col++) {
      for (let row = 1; row <= g.rows; row++) {
        const c = hexCenterPx(col, row, g);
        const v = hexVertices(c.x, c.y, g.R);
        for (let i = 0; i < 6; i++) {
          const a = v[i], b = v[(i + 1) % 6];
          line(buf, w, h, a[0], a[1], b[0], b[1], GRID, 0.55);
        }
      }
    }
  }

  return buf;
}
