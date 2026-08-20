// Assault board geometry.
//
// A board is 32 hex columns x 21 hex rows of flat-top hexes, 250 m flat-to-flat.
// Column 1 is centred on the left edge (half hexes) so boards butt geomorphically,
// which is why the width is exactly 32 column pitches rather than 32 hex widths.
//
// The hex origin reproduces the VASSAL module's grid (x0=0, y0=37 at dy=78.6) so
// generated boards drop straight onto the existing grid definition and hex ids line up.

import { offsetLatLon, rad } from './geo.js';

export const HEX_FLAT_M = 250;                              // flat to flat = 250 m
export const HEX_R_M = HEX_FLAT_M / Math.sqrt(3);           // centre to vertex
export const COL_PITCH_M = 1.5 * HEX_R_M;                   // = 250 * sqrt(3)/2
export const ROW_PITCH_M = HEX_FLAT_M;
export const COLS = 32;
export const ROWS = 21;
export const BOARD_W_M = COLS * COL_PITCH_M;                // 6928.2 m
export const BOARD_H_M = ROWS * ROW_PITCH_M;                // 5250 m
export const Y0_FRACTION = 37 / 78.6;                       // module's y0 / dy

export const M_PER_LEVEL = 25;
export const MAX_LEVEL = 8;

export function boardGeometry(hexFlatPx = 78.6) {
  const mPerPx = HEX_FLAT_M / hexFlatPx;
  const rowPitch = hexFlatPx;
  const colPitch = COL_PITCH_M / mPerPx;
  const R = HEX_R_M / mPerPx;
  return {
    mPerPx, hexFlatPx, rowPitch, colPitch, R,
    halfFlat: hexFlatPx / 2,
    y0: Y0_FRACTION * rowPitch,
    w: Math.round(COLS * colPitch),
    h: Math.round(ROWS * rowPitch),
    cols: COLS, rows: ROWS,
  };
}

export function hexCenterPx(col, row, g) {
  return {
    x: (col - 1) * g.colPitch,
    y: (row - 1) * g.rowPitch + ((col - 1) % 2) * (g.rowPitch / 2) + g.y0,
  };
}

// Flat-top containment, optionally shrunk by `inset` pixels.
export function inHex(dx, dy, g, inset = 0) {
  const R = g.R - inset, hh = g.halfFlat - inset;
  const ax = Math.abs(dx), ay = Math.abs(dy);
  return ax <= R && ay <= hh && ay <= Math.sqrt(3) * (R - ax) + 1e-9;
}

export function hexVertices(cx, cy, R) {
  const h = R * Math.sqrt(3) / 2;
  return [
    [cx + R, cy], [cx + R / 2, cy + h], [cx - R / 2, cy + h],
    [cx - R, cy], [cx - R / 2, cy - h], [cx + R / 2, cy - h],
  ];
}

export const hexId = (col, row) =>
  String(col).padStart(2, '0') + String(row).padStart(2, '0');

// A board placed on the world: centre lat/lon plus a bearing for board "up",
// in degrees clockwise from true north.
export class Placement {
  constructor(lat, lon, bearing = 0, hexFlatPx = 78.6) {
    this.lat = lat; this.lon = lon; this.bearing = bearing;
    this.g = boardGeometry(hexFlatPx);
  }

  // Board pixel -> metres east/north of board centre.
  pixelToOffset(px, py) {
    const g = this.g;
    const bx = (px - g.w / 2) * g.mPerPx;
    const by = (py - g.h / 2) * g.mPerPx;
    const t = rad(this.bearing), c = Math.cos(t), s = Math.sin(t);
    return [bx * c - by * s, -bx * s - by * c];
  }

  pixelToLatLon(px, py) {
    const [e, n] = this.pixelToOffset(px, py);
    return offsetLatLon(this.lat, this.lon, e, n);
  }

  // The four board corners, clockwise from top-left, as [lat, lon].
  corners() {
    const g = this.g;
    return [[0, 0], [g.w, 0], [g.w, g.h], [0, g.h]].map(([x, y]) => this.pixelToLatLon(x, y));
  }

  // Lat/lon bounding box of the rotated board, with a margin in metres.
  bbox(marginM = 400) {
    const cs = this.corners();
    let north = -90, south = 90, west = 180, east = -180;
    for (const [la, lo] of cs) {
      north = Math.max(north, la); south = Math.min(south, la);
      west = Math.min(west, lo); east = Math.max(east, lo);
    }
    const dLat = marginM / 111132.92;
    const dLon = marginM / (111319.49 * Math.cos(rad(this.lat)));
    return { north: north + dLat, south: south - dLat, west: west - dLon, east: east + dLon };
  }
}
