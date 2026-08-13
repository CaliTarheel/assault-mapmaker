// OpenStreetMap -> Assault terrain vocabulary.
//
// The TEC recognises exactly these: clear, woods, town, urban strip, primary road,
// secondary road, full lake, marsh as hex terrain; full lake, stream, dense woods and
// steep slope as hexsides. Everything below maps OSM tagging onto that list and
// nothing else — anything unmatched stays clear.
//
// Overpass is split into four queries rather than one because a single combined query
// over a 7 km box times out, and fired back to back they trip the rate limiter. The
// caller runs them in sequence with backoff and caches the result.

// Only mirrors verified to answer with global data. kumi.systems and private.coffee
// were timing out; overpass.osm.ch is Switzerland-only; osm.jp has an expired cert.
export const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

export const QUERY_GROUPS = {
  green: [
    'way["natural"="wood"]', 'relation["natural"="wood"]',
    'way["landuse"="forest"]', 'relation["landuse"="forest"]',
    'way["natural"="wetland"]', 'relation["natural"="wetland"]',
    'way["natural"="scrub"]',
  ],
  water: [
    'way["natural"="water"]', 'relation["natural"="water"]',
    'way["landuse"="reservoir"]', 'way["waterway"="riverbank"]',
    'way["waterway"~"^(river|stream|canal|ditch|drain)$"]',
    // Open sea is not a polygon in OSM — it is bounded by coastline ways, which we
    // use as a barrier to trim the DEM's coarse ocean mask back to the real shore.
    'way["natural"="coastline"]',
  ],
  builtup: [
    'way["landuse"~"^(residential|industrial|commercial|retail|farmyard|allotments|construction)$"]',
    'relation["landuse"~"^(residential|industrial|commercial|retail)$"]',
    'way["place"~"^(town|village|hamlet|suburb|city)$"]',
  ],
  roads: [
    'way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|track)$"]',
  ],
};

export function buildQuery(group, bbox, timeout = 90) {
  const bb = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  const parts = QUERY_GROUPS[group].map(sel => `  ${sel}(${bb});`).join('\n');
  return `[out:json][timeout:${timeout}];\n(\n${parts}\n);\nout geom;`;
}

// One OSM element -> one Assault feature kind, or null to ignore it.
export function classify(tags = {}) {
  const { natural, landuse, waterway, highway, place, wetland } = tags;

  if (highway) {
    if (/^(motorway|trunk|primary)$/.test(highway)) return { kind: 'primary', area: false };
    if (/^(secondary|tertiary|unclassified)$/.test(highway)) return { kind: 'secondary', area: false };
    // Village streets and farm tracks are tagged in OSM but never drawn on an
    // Assault map — a board carries a handful of roads, not a street atlas. Kept
    // as their own kinds so they can be switched back on, off by default.
    if (/^(residential|living_street)$/.test(highway)) return { kind: 'minor', area: false };
    if (highway === 'track') return { kind: 'track', area: false };
    return null;
  }

  if (waterway) {
    if (waterway === 'riverbank') return { kind: 'lake', area: true };
    if (waterway === 'river') return { kind: 'river', area: false };
    // Field drains are not tactical obstacles.
    if (/^(ditch|drain)$/.test(waterway)) return { kind: 'ditch', area: false };
    return { kind: 'stream', area: false };
  }

  if (natural === 'coastline') return { kind: 'coastline', area: false };
  if (natural === 'water' || landuse === 'reservoir') return { kind: 'lake', area: true };

  if (natural === 'wetland') {
    // Reed beds and wet meadow read as marsh; mangrove/tidal flats are close enough.
    if (wetland && /^(bog|fen|marsh|swamp|reedbed|wet_meadow|saltmarsh|tidalflat|mangrove)$/.test(wetland)) {
      return { kind: 'marsh', area: true };
    }
    return { kind: 'marsh', area: true };
  }

  if (natural === 'wood' || landuse === 'forest') return { kind: 'woods', area: true };
  if (natural === 'scrub') return { kind: 'woods', area: true };

  if (place && /^(city|town|village|hamlet|suburb)$/.test(place)) return { kind: 'builtup', area: true };
  if (landuse && /^(residential|industrial|commercial|retail|farmyard|allotments|construction)$/.test(landuse)) {
    return { kind: 'builtup', area: true };
  }
  return null;
}

// Overpass JSON -> flat feature list of { kind, area, rings: [[[lat,lon],...]] }.
// Relation members come through as separate rings of the same feature, which is
// close enough to proper multipolygon handling at 250 m per hex.
export function normalise(elements) {
  const out = [];
  for (const el of elements ?? []) {
    const c = classify(el.tags);
    if (!c) continue;

    if (el.type === 'way' && el.geometry) {
      const pts = el.geometry.map(p => [p.lat, p.lon]);
      if (pts.length >= 2) out.push({ ...c, rings: [pts] });
      continue;
    }

    if (el.type === 'relation' && el.members) {
      const rings = [];
      for (const m of el.members) {
        if (m.role === 'inner') continue;      // holes ignored; rare at this scale
        if (!m.geometry) continue;
        const pts = m.geometry.map(p => [p.lat, p.lon]);
        if (pts.length >= 2) rings.push(pts);
      }
      if (rings.length) out.push({ ...c, rings });
    }
  }
  return out;
}

export function summariseFeatures(features) {
  const n = {};
  for (const f of features) n[f.kind] = (n[f.kind] ?? 0) + 1;
  return n;
}
