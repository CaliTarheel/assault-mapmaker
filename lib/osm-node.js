// Overpass fetching for Node: one group at a time, backing off on 429/504, and
// cached to disk by bbox so a given area is only ever pulled once.

import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { OVERPASS_MIRRORS, QUERY_GROUPS, buildQuery, normalise } from './osm.js';

const UA = 'assault-mapmaker/0.1 (local hex-map tool)';
const sleep = ms => new Promise(r => setTimeout(r, ms));

function post(url, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': UA,
      },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.setTimeout(120000, () => req.destroy(new Error('overpass timeout')));
    req.end(body);
  });
}

async function askOverpass(query, { attempts = 6, log } = {}) {
  let wait = 8000;
  for (let i = 0; i < attempts; i++) {
    const url = OVERPASS_MIRRORS[i % OVERPASS_MIRRORS.length];
    try {
      const res = await post(url, 'data=' + encodeURIComponent(query));
      if (res.status === 200) return JSON.parse(res.body);
      // 429 = too many slots in flight, 504 = server busy. Both want patience.
      log?.(`  overpass ${res.status} from ${new URL(url).host}, retrying in ${wait / 1000}s`);
    } catch (e) {
      log?.(`  overpass ${e.message}, retrying in ${wait / 1000}s`);
    }
    await sleep(wait);
    wait = Math.min(wait * 2, 30000);
  }
  throw new Error('overpass unavailable after retries');
}

import { bboxKeyOf as bboxKey } from './osm-key.js';

// Each group is cached separately. Overpass fails often enough that losing three
// successful queries because the fourth 429'd is not acceptable — a rerun should
// pick up where it left off.
export async function loadFeatures(root, bbox, { log = () => {} } = {}) {
  const dir = path.join(root, 'cache', 'osm', bboxKey(bbox));
  fs.mkdirSync(dir, { recursive: true });

  const elements = [];
  const groups = Object.keys(QUERY_GROUPS);
  let fetched = 0;
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    const file = path.join(dir, `${g}.json`);
    if (fs.existsSync(file)) {
      elements.push(...JSON.parse(fs.readFileSync(file, 'utf8')));
      log(`osm: ${g} cached`);
      continue;
    }
    // Overpass gives each IP about two slots and enforces a cooldown between them.
    if (fetched > 0) await sleep(6000);
    log(`osm: ${g} (${i + 1}/${groups.length})`);
    const json = await askOverpass(buildQuery(g, bbox), { log });
    const els = json.elements ?? [];
    fs.writeFileSync(file, JSON.stringify(els));
    elements.push(...els);
    fetched++;
  }

  const features = normalise(elements);
  log(`osm: ${elements.length} elements -> ${features.length} features`);
  return features;
}
