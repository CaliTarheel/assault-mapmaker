// Minimal scanline polygon fill and round-capped polyline stroke, writing into
// flat Uint8Array masks in board pixel space.

export function stampDisc(mask, w, h, cx, cy, r, value = 1) {
  const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(w - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(h - 1, Math.ceil(cy + r));
  const rr = r * r;
  for (let y = y0; y <= y1; y++) {
    const dy = y - cy;
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      if (dx * dx + dy * dy <= rr) mask[y * w + x] = value;
    }
  }
}

// Round joins and caps, which is what a drawn road looks like anyway.
export function strokePath(mask, w, h, pts, width, value = 1) {
  const r = Math.max(0.5, width / 2);
  for (let i = 0; i < pts.length; i++) {
    const [x, y] = pts[i];
    stampDisc(mask, w, h, x, y, r, value);
    if (i === 0) continue;
    const [px, py] = pts[i - 1];
    const dist = Math.hypot(x - px, y - py);
    const steps = Math.ceil(dist / Math.max(0.6, r * 0.6));
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      stampDisc(mask, w, h, px + (x - px) * t, py + (y - py) * t, r, value);
    }
  }
}

// Even-odd scanline fill over one or more rings.
export function fillPolygon(mask, w, h, rings, value = 1) {
  const edges = [];
  let minY = Infinity, maxY = -Infinity;
  for (const ring of rings) {
    if (ring.length < 3) continue;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      if (a[1] === b[1]) continue;
      edges.push([a, b]);
      minY = Math.min(minY, a[1], b[1]);
      maxY = Math.max(maxY, a[1], b[1]);
    }
  }
  if (!edges.length) return;

  const y0 = Math.max(0, Math.floor(minY)), y1 = Math.min(h - 1, Math.ceil(maxY));
  const xs = [];
  for (let y = y0; y <= y1; y++) {
    const yc = y + 0.5;
    xs.length = 0;
    for (const [a, b] of edges) {
      const [ax, ay] = a, [bx, by] = b;
      if ((yc >= ay && yc < by) || (yc >= by && yc < ay)) {
        xs.push(ax + (yc - ay) / (by - ay) * (bx - ax));
      }
    }
    if (xs.length < 2) continue;
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const sx = Math.max(0, Math.ceil(xs[i] - 0.5));
      const ex = Math.min(w - 1, Math.floor(xs[i + 1] - 0.5));
      const row = y * w;
      for (let x = sx; x <= ex; x++) mask[row + x] = value;
    }
  }
}

// Grow a mask by `r` pixels (used to give lakes a shoreline, woods a soft margin).
export function dilate(mask, w, h, r) {
  if (r < 1) return mask;
  let cur = mask;
  for (let pass = 0; pass < r; pass++) {
    const next = Uint8Array.from(cur);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!cur[i]) continue;
        if (x > 0) next[i - 1] = cur[i];
        if (x < w - 1) next[i + 1] = cur[i];
        if (y > 0) next[i - w] = cur[i];
        if (y < h - 1) next[i + w] = cur[i];
      }
    }
    cur = next;
  }
  return cur;
}

export function maskShare(mask, w, h, cx, cy, R, halfFlat, inHexFn) {
  let hit = 0, total = 0;
  const x0 = Math.max(0, Math.floor(cx - R)), x1 = Math.min(w - 1, Math.ceil(cx + R));
  const y0 = Math.max(0, Math.floor(cy - halfFlat)), y1 = Math.min(h - 1, Math.ceil(cy + halfFlat));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!inHexFn(x - cx, y - cy)) continue;
      total++;
      if (mask[y * w + x]) hit++;
    }
  }
  return total ? hit / total : 0;
}
