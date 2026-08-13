// Elevation -> Assault map language.
//
// The chain is: metres -> level (0..8, 25 m each) -> colour band (5 tints).
// Only the band field is actually drawn, because that is all the printed map
// carries. The levels a player will read back off the finished map are then
// re-derived from the bands with rule 10(B)2, which is *not* always what the DEM
// said — a hex whose only colour is light brown always plays as level 2, never 1.
// Keeping both fields lets the tool show where the notation bends the terrain.

import { hexCenterPx, inHex, hexId, MAX_LEVEL, M_PER_LEVEL } from './board.js';
import { TOWN_SHARE, URBAN_SHARE } from './features.js';

export const levelOf = (h, base, interval = M_PER_LEVEL) =>
  Math.max(0, Math.min(MAX_LEVEL, Math.floor((h - base) / interval)));

// Green is level 0 alone; every brown covers a pair.
export const bandOf = level => (level === 0 ? 0 : Math.ceil(level / 2));
export const bandLevels = band => (band === 0 ? [0, 0] : [2 * band - 1, 2 * band]);
export const BANDS = 5;

// Rule 10(B)2: a band reads as its lower level when a lower band shares the hex,
// otherwise as its higher level (including when the hex is a single colour).
export function readback(bandsPresent) {
  const sorted = [...bandsPresent].sort((a, b) => a - b);
  return sorted.map((b, i) => {
    const [lo, hi] = bandLevels(b);
    return i > 0 ? lo : hi;
  });
}

// Separable box blur, run three times to approximate a Gaussian.
export function smooth(src, w, h, radius) {
  if (radius < 1) return src;
  let a = Float32Array.from(src), b = new Float32Array(src.length);
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        let s = 0, n = 0;
        for (let i = -radius; i <= radius; i++) {
          const xx = x + i;
          if (xx < 0 || xx >= w) continue;
          const v = a[row + xx];
          if (!Number.isNaN(v)) { s += v; n++; }
        }
        b[row + x] = n ? s / n : NaN;
      }
    }
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        let s = 0, n = 0;
        for (let i = -radius; i <= radius; i++) {
          const yy = y + i;
          if (yy < 0 || yy >= h) continue;
          const v = b[yy * w + x];
          if (!Number.isNaN(v)) { s += v; n++; }
        }
        a[y * w + x] = n ? s / n : NaN;
      }
    }
  }
  return a;
}

// Nothing below the waterline exists as far as this game is concerned, so flatten
// it and remember where it was. This matters more than it sounds: the DEM carries
// real bathymetry on the continental shelf (-22 m in the German Bight), so without
// a floor a coastal board would put its level-0 datum on the sea bed and peg every
// scrap of dry land at level 8. Deep ocean is masked to exactly 0 in the same data,
// which is why the test is "at or below" rather than "below".
//
// Set `seaLevel` to null for inland ground that genuinely sits below sea level —
// polders, the Dead Sea, Death Valley — or move it to that basin's water surface.
export const SEA_LEVEL = 0;

export function applySeaFloor(elev, seaLevel = SEA_LEVEL) {
  const water = new Uint8Array(elev.length);
  if (seaLevel === null || seaLevel === undefined) {
    return { elev, water, waterFraction: 0 };
  }
  const out = Float32Array.from(elev);
  let wet = 0, valid = 0;
  for (let i = 0; i < out.length; i++) {
    const v = out[i];
    if (Number.isNaN(v)) continue;
    valid++;
    if (v <= seaLevel) { out[i] = seaLevel; water[i] = 1; wet++; }
  }
  return { elev: out, water, waterFraction: valid ? wet / valid : 0 };
}

// Majority filter over a binary mask. The DEM's ocean mask is baked in at a coarser
// zoom than we sample at, so a raw coastline comes out in blocky steps; a couple of
// majority passes round it back to something a draughtsman would have drawn.
export function smoothMask(mask, w, h, radius = 5, passes = 2) {
  if (radius < 1) return mask;
  let cur = mask;
  const need = (2 * radius + 1) ** 2 / 2;
  for (let p = 0; p < passes; p++) {
    const next = new Uint8Array(cur.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let n = 0;
        const y0 = Math.max(0, y - radius), y1 = Math.min(h - 1, y + radius);
        const x0 = Math.max(0, x - radius), x1 = Math.min(w - 1, x + radius);
        for (let yy = y0; yy <= y1; yy++) {
          const row = yy * w;
          for (let xx = x0; xx <= x1; xx++) if (cur[row + xx]) n++;
        }
        next[y * w + x] = n > need ? 1 : 0;
      }
    }
    cur = next;
  }
  return cur;
}

// Erase regions smaller than minPx by merging them into whichever value shares the
// most boundary with them. Hand-drawn contours and coastlines have no speckle.
export function despeckle(band, w, h, minPx, values = BANDS) {
  if (minPx <= 1) return band;
  const out = Uint8Array.from(band);
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  for (let start = 0; start < out.length; start++) {
    if (seen[start]) continue;
    const val = out[start];
    let sp = 0, count = 0;
    stack[sp++] = start; seen[start] = 1;
    const members = [];
    const edge = new Int32Array(BANDS);
    while (sp > 0) {
      const i = stack[--sp];
      members.push(i); count++;
      const x = i % w, y = (i / w) | 0;
      const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
      for (const j of nb) {
        if (j < 0) continue;
        if (out[j] === val) {
          if (!seen[j]) { seen[j] = 1; stack[sp++] = j; }
        } else {
          edge[out[j]]++;
        }
      }
    }
    if (count >= minPx) continue;
    let best = -1, bestN = 0;
    for (let b = 0; b < BANDS; b++) if (edge[b] > bestN) { bestN = edge[b]; best = b; }
    if (best >= 0) for (const i of members) out[i] = best;
  }
  return out;
}

// Turn a raster of elevations into the level and band fields.
export function buildFields(elev, w, h, opts = {}) {
  const {
    base = 0,
    interval = M_PER_LEVEL,
    smoothRadius = 2,
    minRegionPx = 260,
    seaLevel = SEA_LEVEL,
    water = null,          // pre-computed mask, if the caller already floored
  } = opts;

  const sea = water ? { elev, water, waterFraction: 0 } : applySeaFloor(elev, seaLevel);
  const wet = smoothMask(
    despeckle(sea.water, w, h, Math.round(minRegionPx / 2), 2),
    w, h, Math.max(1, Math.round(smoothRadius * 1.5)), 2);
  const e = smooth(sea.elev, w, h, smoothRadius);
  const level = new Uint8Array(w * h);
  const band = new Uint8Array(w * h);
  let clipped = 0, valid = 0;
  for (let i = 0; i < e.length; i++) {
    const v = e[i];
    if (Number.isNaN(v)) { level[i] = 0; band[i] = 0; continue; }
    valid++;
    const raw = Math.floor((v - base) / interval);
    if (raw > MAX_LEVEL || raw < 0) clipped++;
    const l = Math.max(0, Math.min(MAX_LEVEL, raw));
    level[i] = l;
    band[i] = bandOf(l);
  }
  const cleaned = despeckle(band, w, h, minRegionPx);
  return {
    elev: e, level, band: cleaned, water: wet,
    clippedFraction: valid ? clipped / valid : 0,
    waterFraction: sea.waterFraction,
  };
}

// Choose the datum for level 0.
//
// The board's own lowest ground is level 0, always — a board in Denver starts from
// the valley floor at 1600 m, not from sea level, or every hex would peg at level 8.
// So the datum is relative to this board and absolute altitude never enters into it.
// `lowPercentile` > 0 trades a little of the lowest ground (which just clamps to 0
// anyway, and reads identically) for immunity to a single noisy DEM pixel.
export function autoBase(elev, { lowPercentile = 0, interval = M_PER_LEVEL, seaLevel = SEA_LEVEL } = {}) {
  const floor = seaLevel === null || seaLevel === undefined ? -Infinity : seaLevel;
  const vals = [];
  for (let i = 0; i < elev.length; i += 7) if (!Number.isNaN(elev[i])) vals.push(Math.max(elev[i], floor));
  if (!vals.length) return { base: 0, min: 0, max: 0, relief: 0, levelsNeeded: 0, fits: true };
  vals.sort((a, b) => a - b);
  const at = p => vals[Math.min(vals.length - 1, Math.max(0, Math.floor(p / 100 * vals.length)))];
  const min = vals[0], max = vals[vals.length - 1];
  const base = lowPercentile > 0 ? at(lowPercentile) : min;
  const relief = max - base;
  return {
    base, min, max, relief,
    levelsNeeded: relief / interval,
    fits: relief <= (MAX_LEVEL + 1) * interval,
    // What metres-per-level would be needed to hold this relief in 9 levels.
    fitInterval: fitInterval(relief),
  };
}

// Smallest sensible metres-per-level that fits the relief into levels 0..8.
// 25 is the real game's value; the rest are escape hatches for high-relief ground,
// and they do change what a level means for LOS and steep slopes.
export function fitInterval(relief, choices = [25, 30, 40, 50, 75, 100, 150, 200]) {
  const need = relief / (MAX_LEVEL + 1);
  return choices.find(c => c >= need) ?? choices[choices.length - 1];
}

// Per-hex analysis of a drawn board: which bands it holds, what those bands
// play as, and what the underlying DEM levels were before the notation rounded.
export function analyseHexes(band, level, w, h, g, opts = {}) {
  const { minShare = 0.06, masks = null } = opts;
  const FEAT = ['lake', 'woods', 'marsh', 'builtup', 'stream', 'primary', 'secondary', 'track'];
  const active = masks ? FEAT.filter(k => masks[k]) : [];
  const hexes = [];
  for (let col = 1; col <= g.cols; col++) {
    for (let row = 1; row <= g.rows; row++) {
      const c = hexCenterPx(col, row, g);
      const x0 = Math.max(0, Math.floor(c.x - g.R)), x1 = Math.min(w - 1, Math.ceil(c.x + g.R));
      const y0 = Math.max(0, Math.floor(c.y - g.halfFlat)), y1 = Math.min(h - 1, Math.ceil(c.y + g.halfFlat));
      const bandCount = new Int32Array(BANDS);
      const levelCount = new Int32Array(MAX_LEVEL + 1);
      const featCount = new Int32Array(active.length);
      let total = 0;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          if (!inHex(x - c.x, y - c.y, g)) continue;
          const i = y * w + x;
          bandCount[band[i]]++; levelCount[level[i]]++; total++;
          for (let k = 0; k < active.length; k++) if (masks[active[k]][i]) featCount[k]++;
        }
      }
      if (total < 40) continue;
      const share = {};
      for (const k of FEAT) share[k] = 0;
      active.forEach((k, i) => { share[k] = featCount[i] / total; });

      const present = [];
      for (let b = 0; b < BANDS; b++) if (bandCount[b] / total >= minShare) present.push(b);
      if (!present.length) present.push(bandCount.indexOf(Math.max(...bandCount)));

      const played = readback(present);
      const demLevels = [];
      for (let l = 0; l <= MAX_LEVEL; l++) if (levelCount[l] / total >= minShare) demLevels.push(l);

      // How far the notation moved the ground: compare each pixel's DEM level
      // against the level its band actually plays as in this hex.
      const playedFor = new Map();
      present.forEach((b, i) => playedFor.set(b, played[i]));
      let drift = 0;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          if (!inHex(x - c.x, y - c.y, g)) continue;
          const i = y * w + x;
          const p = playedFor.get(band[i]);
          if (p !== undefined) drift += Math.abs(p - level[i]);
        }
      }

      // One hex terrain type, in the TEC's own vocabulary. Roads and streams sit on
      // top of whatever the hex already is rather than replacing it.
      const terrain =
        share.lake >= 0.5 ? 'lake'
        : share.marsh >= 0.4 ? 'marsh'
        : share.builtup >= TOWN_SHARE ? 'town'
        : share.woods >= 0.4 ? 'woods'
        : share.builtup >= URBAN_SHARE ? 'urban'
        : 'clear';

      hexes.push({
        col, row, id: hexId(col, row),
        cx: c.x, cy: c.y,
        bands: present,
        levels: played,
        demLevels,
        steep: present.length >= 3,
        drift: drift / total,
        faithful: played.length === demLevels.length && played.every((v, i) => v === demLevels[i]),
        terrain,
        // Rule 10(B)3: these block line of sight one level above the terrain level,
        // and unlike the colour areas they count as filling the whole hex.
        blocking: terrain === 'woods' || terrain === 'town' || terrain === 'urban',
        roads: [share.primary > 0.008 && 'primary', share.secondary > 0.008 && 'secondary'].filter(Boolean),
        stream: share.stream > 0.01,
        partialLake: share.lake > 0.05 && share.lake < 0.5,
        share: Object.fromEntries(Object.entries(share).map(([k, v]) => [k, +v.toFixed(3)])),
      });
    }
  }
  return hexes;
}

export function summarise(hexes) {
  const n = hexes.length || 1;
  const steep = hexes.filter(h => h.steep).length;
  const faithful = hexes.filter(h => h.faithful).length;
  const drift = hexes.reduce((s, h) => s + h.drift, 0) / n;
  const levelHist = {};
  for (const h of hexes) for (const l of h.levels) levelHist[l] = (levelHist[l] || 0) + 1;
  const terrainHist = {};
  for (const h of hexes) if (h.terrain) terrainHist[h.terrain] = (terrainHist[h.terrain] ?? 0) + 1;
  return {
    hexes: hexes.length, steep, faithful, faithfulPct: 100 * faithful / n,
    meanDrift: drift, levelHist, terrainHist,
    withPrimary: hexes.filter(h => h.roads?.includes('primary')).length,
    withSecondary: hexes.filter(h => h.roads?.includes('secondary')).length,
    withStream: hexes.filter(h => h.stream).length,
    partialLake: hexes.filter(h => h.partialLake).length,
  };
}

// Assault draws a Town as a solid blob and an Urban Strip as scattered blocks, so
// the same built-up raster has to be painted two different ways depending on how
// much of the hex it fills. Decide that per hex, then split the mask to match.
export function splitBuiltup(masks, hexes, w, h, g) {
  const town = new Uint8Array(w * h);
  const urban = new Uint8Array(w * h);
  if (!masks?.builtup) return { town, urban };
  for (const hx of hexes) {
    if (hx.terrain !== 'town' && hx.terrain !== 'urban') continue;
    const dst = hx.terrain === 'town' ? town : urban;
    const x0 = Math.max(0, Math.floor(hx.cx - g.R)), x1 = Math.min(w - 1, Math.ceil(hx.cx + g.R));
    const y0 = Math.max(0, Math.floor(hx.cy - g.halfFlat)), y1 = Math.min(h - 1, Math.ceil(hx.cy + g.halfFlat));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (!inHex(x - hx.cx, y - hx.cy, g)) continue;
        const i = y * w + x;
        if (masks.builtup[i]) dst[i] = 1;
      }
    }
  }
  return { town, urban };
}
