// A mosaic of Terrarium-encoded DEM tiles, sampled bilinearly in lat/lon.
//
// Terrarium (AWS "elevation-tiles-prod") packs metres into RGB as
//   elevation = (R * 256 + G + B / 256) - 32768
// which gives 1/256 m precision over the full terrestrial range.

import { TILE, lonToTileX, latToTileY, tileXToLon, tileYToLat, metersPerPixel } from './geo.js';

export function decodeTerrarium(r, g, b) {
  return r * 256 + g + b / 256 - 32768;
}

export class DemGrid {
  constructor(z, tx0, ty0, nx, ny) {
    this.z = z;
    this.tx0 = tx0; this.ty0 = ty0;
    this.nx = nx; this.ny = ny;
    this.w = nx * TILE; this.h = ny * TILE;
    this.data = new Float32Array(this.w * this.h).fill(NaN);
  }

  // rgba: Uint8Array/Uint8ClampedArray of TILE*TILE*4 for tile (tx, ty).
  setTile(tx, ty, rgba) {
    const ox = (tx - this.tx0) * TILE, oy = (ty - this.ty0) * TILE;
    if (ox < 0 || oy < 0 || ox >= this.w || oy >= this.h) return;
    for (let y = 0; y < TILE; y++) {
      let di = (oy + y) * this.w + ox;
      let si = y * TILE * 4;
      for (let x = 0; x < TILE; x++, di++, si += 4) {
        this.data[di] = decodeTerrarium(rgba[si], rgba[si + 1], rgba[si + 2]);
      }
    }
  }

  // Bilinear sample. Returns NaN outside the loaded mosaic.
  sample(lat, lon) {
    const fx = (lonToTileX(lon, this.z) - this.tx0) * TILE - 0.5;
    const fy = (latToTileY(lat, this.z) - this.ty0) * TILE - 0.5;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    if (x0 < 0 || y0 < 0 || x0 + 1 >= this.w || y0 + 1 >= this.h) return NaN;
    const ax = fx - x0, ay = fy - y0;
    const d = this.data, w = this.w;
    const i = y0 * w + x0;
    const a = d[i], b = d[i + 1], c = d[i + w], e = d[i + w + 1];
    return (a * (1 - ax) + b * ax) * (1 - ay) + (c * (1 - ax) + e * ax) * ay;
  }

  bounds() {
    return {
      west: tileXToLon(this.tx0, this.z),
      east: tileXToLon(this.tx0 + this.nx, this.z),
      north: tileYToLat(this.ty0, this.z),
      south: tileYToLat(this.ty0 + this.ny, this.z),
    };
  }
}

// Which tiles cover a lat/lon box, and how big the mosaic will be.
export function tileCover(z, north, south, west, east, pad = 1) {
  const tx0 = Math.floor(lonToTileX(west, z)) - pad;
  const tx1 = Math.floor(lonToTileX(east, z)) + pad;
  const ty0 = Math.floor(latToTileY(north, z)) - pad;
  const ty1 = Math.floor(latToTileY(south, z)) + pad;
  const list = [];
  for (let y = ty0; y <= ty1; y++) for (let x = tx0; x <= tx1; x++) list.push({ z, x, y });
  return { z, tx0, ty0, nx: tx1 - tx0 + 1, ny: ty1 - ty0 + 1, tiles: list };
}

export const TERRARIUM_URL = (z, x, y) =>
  `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;

export { metersPerPixel };
