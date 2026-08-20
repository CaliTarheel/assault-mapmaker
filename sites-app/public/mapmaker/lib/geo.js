// Web Mercator tile math and a local-tangent-plane helper.
// Pure math, no I/O — runs identically in Node and the browser.

export const TILE = 256;

export const rad = d => d * Math.PI / 180;
export const deg = r => r * 180 / Math.PI;

export function lonToTileX(lon, z) {
  return (lon + 180) / 360 * Math.pow(2, z);
}

export function latToTileY(lat, z) {
  const s = Math.sin(rad(lat));
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * Math.pow(2, z);
}

export function tileXToLon(x, z) {
  return x / Math.pow(2, z) * 360 - 180;
}

export function tileYToLat(y, z) {
  const n = Math.PI - 2 * Math.PI * y / Math.pow(2, z);
  return deg(Math.atan(Math.sinh(n)));
}

// Ground resolution of one tile pixel, in metres.
export function metersPerPixel(lat, z) {
  return 40075016.686 * Math.cos(rad(lat)) / (TILE * Math.pow(2, z));
}

// Smallest zoom whose pixels are at least as fine as `metres`.
export function zoomForResolution(lat, metres, max = 15) {
  for (let z = 1; z <= max; z++) if (metersPerPixel(lat, z) <= metres) return z;
  return max;
}

// Local tangent plane about (lat0, lon0). East/north in metres -> lat/lon.
// Over a 7 km board the flat-earth error is well under a metre.
export function offsetLatLon(lat0, lon0, east, north) {
  const lat = lat0 + north / 111132.92;
  const lon = lon0 + east / (111319.49 * Math.cos(rad((lat0 + lat) / 2)));
  return [lat, lon];
}

// Inverse of offsetLatLon.
export function latLonToOffset(lat0, lon0, lat, lon) {
  const north = (lat - lat0) * 111132.92;
  const east = (lon - lon0) * 111319.49 * Math.cos(rad((lat0 + lat) / 2));
  return [east, north];
}
