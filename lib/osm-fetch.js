// Browser-side Overpass client. Same four query groups as the Node fetcher, run in
// sequence with backoff — Overpass allows an IP only a couple of slots at a time and
// answers 429 if you crowd it.
//
// Overpass sends Access-Control-Allow-Origin: *, so a static page can call it
// directly with no proxy of its own.

import { OVERPASS_MIRRORS, QUERY_GROUPS, buildQuery, normalise } from './osm.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function askOverpass(query, { attempts = 6, onLog } = {}) {
  let wait = 8000;
  for (let i = 0; i < attempts; i++) {
    const url = OVERPASS_MIRRORS[i % OVERPASS_MIRRORS.length];
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query),
      });
      if (res.ok) return res.json();
      onLog?.(`overpass ${res.status}, retrying in ${wait / 1000}s`);
    } catch (e) {
      onLog?.(`overpass ${e.message}, retrying in ${wait / 1000}s`);
    }
    await sleep(wait);
    wait = Math.min(wait * 2, 30000);
  }
  throw new Error('overpass is busy — try again in a minute, or untick the feature layer');
}

export async function fetchFeaturesDirect(bbox, { onProgress } = {}) {
  const groups = Object.keys(QUERY_GROUPS);
  const elements = [];
  for (let i = 0; i < groups.length; i++) {
    onProgress?.(i, groups.length, groups[i]);
    if (i > 0) await sleep(6000);
    const json = await askOverpass(buildQuery(groups[i], bbox), {
      onLog: m => onProgress?.(i, groups.length, `${groups[i]} — ${m}`),
    });
    elements.push(...(json.elements ?? []));
  }
  onProgress?.(groups.length, groups.length, 'done');
  return normalise(elements);
}
