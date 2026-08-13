// Node-side tile fetching with an on-disk cache, so repeated renders of the same
// area never hit the network twice.

import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { PNG } from 'pngjs';
import { TILE } from './geo.js';
import { DemGrid, tileCover, TERRARIUM_URL } from './dem.js';

const UA = 'assault-mapmaker/0.1 (local hex-map tool)';

export function cacheDir(root, kind) {
  const d = path.join(root, 'cache', kind);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

export function fetchUrl(url, { retries = 3 } = {}) {
  return new Promise((resolve, reject) => {
    const attempt = n => {
      const req = https.get(url, { headers: { 'User-Agent': UA } }, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return attempt(n);
        }
        if (res.statusCode !== 200) {
          res.resume();
          if (n < retries) return setTimeout(() => attempt(n + 1), 400 * (n + 1));
          return reject(new Error(`${res.statusCode} for ${url}`));
        }
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      });
      req.on('error', err => {
        if (n < retries) return setTimeout(() => attempt(n + 1), 400 * (n + 1));
        reject(err);
      });
      req.setTimeout(20000, () => req.destroy(new Error('timeout')));
    };
    attempt(0);
  });
}

export async function cachedTile(root, kind, z, x, y, urlFor) {
  const dir = path.join(cacheDir(root, kind), String(z), String(x));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${y}.png`);
  if (fs.existsSync(file) && fs.statSync(file).size > 0) return fs.readFileSync(file);
  const buf = await fetchUrl(urlFor(z, x, y));
  fs.writeFileSync(file, buf);
  return buf;
}

// Fetch every DEM tile covering a placement and assemble the mosaic.
export async function loadDem(root, placement, zoom, { concurrency = 6, onProgress } = {}) {
  const bb = placement.bbox();
  const cover = tileCover(zoom, bb.north, bb.south, bb.west, bb.east, 0);
  const dem = new DemGrid(cover.z, cover.tx0, cover.ty0, cover.nx, cover.ny);

  let done = 0;
  const queue = [...cover.tiles];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length) {
      const t = queue.shift();
      const buf = await cachedTile(root, 'terrarium', t.z, t.x, t.y, TERRARIUM_URL);
      const png = PNG.sync.read(buf);
      if (png.width !== TILE || png.height !== TILE) throw new Error(`odd tile size ${png.width}x${png.height}`);
      dem.setTile(t.x, t.y, png.data);
      done++;
      if (onProgress) onProgress(done, cover.tiles.length);
    }
  });
  await Promise.all(workers);
  return { dem, tileCount: cover.tiles.length };
}

// Sample the DEM over the whole board raster.
export function sampleBoard(dem, placement) {
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
