// One definition of the bbox cache key, shared by the Node fetcher, the static
// build and the browser. If these ever drift, baked feature data silently stops
// being found and every visitor pays for a cold Overpass query instead.

export const bboxKeyOf = bb =>
  [bb.south, bb.west, bb.north, bb.east].map(v => v.toFixed(4)).join('_');
