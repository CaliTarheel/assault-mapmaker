# Assault map maker — terrain

Pick a real place, at Assault board size and orientation, and get its terrain rendered
in Assault's own map language: five ink colours, contour strokes on every colour change,
woods, towns, roads, water and marsh, on the hex grid the module already uses.

Everything the TEC recognises is generated except **dense woods** and **steep slope**
hexsides — steep slopes are detected and reported, just not drawn as hexside symbols.

## Running it

```bash
npm install
npm start
```

Then open <http://localhost:8787/>. Pan the map, set a bearing, hit **render board**.

## Putting it on the web

```bash
npm run build
```

`dist/` is a **backend-free static site** — drop it on GitHub Pages, Netlify, Cloudflare
Pages, S3, anything. It behaves exactly like the local server, including navigation to
anywhere on earth, because AWS Terrain Tiles, Overpass and the basemaps all send
`Access-Control-Allow-Origin: *`; the browser talks to them directly and no proxy is
needed. `npm run preview` serves `dist/` on :8788 to check that before you deploy.

The page detects at startup which mode it is in:

- **local server** — tiles and Overpass go through `server.js`, cached to disk.
- **direct** — no server; the browser fetches everything itself.

Features for the areas in `SHOWCASE` (in `build.js`) are baked into the bundle so the
first view is instant. Anywhere else costs a cold Overpass fetch of about 30–60 s,
shown as progress. Overpass is a donated public service — the four queries per area
are modest and cached per session, but be decent about it.

Headless, for scripting or batch work:

```bash
node render.js --lat 50.62 --lon 9.62 --bearing 0 --out out/fulda
```

Writes `out/fulda.png` (2178×1651, the board) and `out/fulda.json` (per-hex levels and
terrain plus a fidelity report). Useful flags: `--interval` metres per level, `--base`
to override the datum, `--sealevel` (metres, or `none`), `--smooth`, `--minregion`,
`--hexpx`, `--zoom`, `--marksteep false`, `--features false`, `--tracks true`,
`--minorroads true`.

## How a board is placed

One board is 32 hex columns × 21 rows of flat-top hexes at 250 m flat-to-flat, so it
covers **6.93 × 5.25 km**. Bearing rotates the footprint on the ground; the board's
own "up" points at that compass bearing. The hex origin reproduces the VASSAL module's
grid (`dx=67.92 dy=78.6 x0=0 y0=37`), so hex ids line up with the real boards and
output drops onto the existing grid definition.

## Vertical datum

**Level 0 is the board's own lowest ground, never sea level.** A board sited in Denver
takes its datum from the valley floor at ~1600 m; absolute altitude never enters into
it. `datum: board minimum` is the default. The `2nd percentile` option gives up a
sliver of the lowest ground — which clamps to level 0 and reads identically anyway —
in exchange for immunity to a single bad DEM pixel.

The hard constraint is that Assault only has **9 levels × 25 m = 225 m of vertical
range**. Real ground often has more relief than that across 7 km. The tool reports
`levels needed` and how much of the board is `flattened at 8`; if it doesn't fit you
can raise metres-per-level (which does change what a level means for LOS and steep
slopes) or move the board somewhere gentler.

## Water

Ground at or below the waterline is held flat and drawn as Full Lake. This matters
more than it sounds: the elevation tiles carry real bathymetry on the continental
shelf — −22 m in the German Bight — so without a floor a coastal board would put its
level-0 datum on the sea bed and peg every scrap of dry land at level 8. Deep ocean is
masked to exactly 0 in the same dataset, so the test is "at or below", not "below".

Move the sea level control for ground that genuinely sits below sea level — polders,
the Dead Sea, Death Valley — or set it to that basin's water surface.

The DEM's own ocean mask is baked in at a coarser zoom than we sample at, so it gives
a shoreline in 200 m steps. Where OSM has `natural=coastline`, that gets used as a
barrier and the sea is flood-filled up to it, which lands the waterline on the real
shore. The fill is confined to within 80 px of the DEM's answer and falls back to it
outright if the result balloons, because coastline ways rarely enclose a board on
their own and an unconstrained fill escapes round their ends.

## Terrain features

From OSM via Overpass, mapped onto the TEC's vocabulary:

| Assault | OSM |
| --- | --- |
| woods | `natural=wood`, `landuse=forest`, `natural=scrub` |
| marsh | `natural=wetland` |
| full lake | `natural=water`, `landuse=reservoir`, `waterway=riverbank`, plus the sea |
| stream | `waterway=river\|stream\|canal` |
| town / urban strip | `landuse=residential\|industrial\|commercial\|retail\|farmyard`, `place=*` |
| primary road | `highway=motorway\|trunk\|primary` |
| secondary road | `highway=secondary\|tertiary\|unclassified` |

Village streets, farm tracks and field drains are deliberately dropped — a board
carries a handful of roads, not a street atlas. Turning them on makes central Germany
look like a spiderweb. Water bodies under 18,000 m² are dropped as farm ponds.

Town versus Urban Strip is decided per hex from how much of it is built up: 25% or
more is a Town (solid grey blob), 4% or more an Urban Strip (scattered blocks). Woods
are drawn as stipple over the elevation tint, never as a flat fill, because the rules
read levels off the colour areas even where trees cover them.

Overpass is slow and rate-limits hard. Each of the four query groups is cached
separately under `cache/osm/<bbox>/`, so a failed run resumes rather than starting
over, and the browser never talks to Overpass directly — it asks the local server.

## Reading the fidelity numbers

The map only carries the **band** field — which of five tints each point is in. The
levels a player reads back off it are then re-derived with rule 10(B)2, and that is not
always what the DEM said: a hex whose only colour is light brown always plays as level
2, never 1. So the tool reports:

- **reads back true** — hexes where the played levels match the DEM levels exactly.
  Expect roughly half on rolling ground; this is the notation, not a bug.
- **mean drift** — average distance in levels between the DEM and what the map plays.
  Typically 0.2–0.3 levels, i.e. 5–8 m.
- **steep slopes** — hexes holding three bands (two contour lines), which skip a level.

Tick *flag notation drift* to mark the hexes where the two disagree.

## Data sources

- Elevation: [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/)
  (Terrarium encoding, ~30 m posts), keyless.
- Basemap: OpenStreetMap or OpenTopoMap, for navigation only.

Both are proxied through the local server and cached under `cache/`, so a given tile is
fetched once. Delete `cache/` to force a refresh.

## Layout

```
lib/geo.js        web mercator tile math, local tangent plane
lib/dem.js        terrarium decode, tile mosaic, bilinear sampling
lib/board.js      board geometry, hex grid, world placement
lib/terrain.js    metres -> level -> band, sea floor, despeckle, per-hex read-back
lib/osm.js        overpass queries, OSM tags -> Assault terrain
lib/raster.js     polygon fill, polyline stroke, dilate
lib/features.js   OSM -> board-space masks, coastline trimming
lib/palette.js    every measured ink colour
lib/render.js     tints, contours, features, hex grid -> RGBA
lib/tiles-node.js node-side tile fetch + disk cache
lib/osm-node.js   node-side overpass fetch + disk cache
server.js         static files, tile proxies, /osm
render.js         headless CLI
web/              the navigator
```

Everything under `lib/` is plain ESM with no environment assumptions, so the browser
and the CLI run the same code.
