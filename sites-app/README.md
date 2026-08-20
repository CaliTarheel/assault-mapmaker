# Assault Map Maker

**Live site:** <https://assault-mapmaker.srider.chatgpt.site/>

**Public source:** <https://github.com/CaliTarheel/assault-mapmaker>

Assault Map Maker turns real-world terrain into one 32 × 21 hex board or a
seamless mosaic up to 4 × 4 boards using elevation and OpenStreetMap data. The
map footprint, continuous terrain render, seam guides, diagnostics, and PNG/JSON
exports all expand with the selected board array.

The Sites application lives in `sites-app/` in the public repository. The
repository root also preserves the earlier standalone implementation and its
GitHub Pages deployment.

## Local development

The Sites application requires Node.js 22.13 or newer.

```bash
cd sites-app
npm ci
npm run dev
```

Run `npm test` for a production build and attribution checks.

## Data and trademarks

Elevation comes from AWS Terrain Tiles. Features come from OpenStreetMap via
Overpass. *Assault* is a Game Designers' Workshop game; this independent tool
does not include game rules, maps, or other game assets and is not affiliated
with the rights holder.

## License and attribution

Copyright © 2026 Stephen G. Rider. The code is available under the MIT License.
If you reuse or customize it, keep the copyright and license notice and credit
Stephen G. Rider. Contact: <rider.sg@gmail.com>.
