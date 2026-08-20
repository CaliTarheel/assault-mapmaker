// Ink colours measured off the GDW boards in the VASSAL module (AssaultMap_*comp.jpg).
// Note how small the last step is compared with the rest of the ramp — that is in the
// original printing, not a sampling artefact.

export const TINTS = [
  { name: 'light green',       hex: '#C4D89C', rgb: [196, 216, 156], levels: [0, 0] },
  { name: 'light brown',       hex: '#DCC8A0', rgb: [220, 200, 160], levels: [1, 2] },
  { name: 'medium brown',      hex: '#B09870', rgb: [176, 152, 112], levels: [3, 4] },
  { name: 'medium-dark brown', hex: '#907450', rgb: [144, 116,  80], levels: [5, 6] },
  { name: 'dark brown',        hex: '#7C6840', rgb: [124, 104,  64], levels: [7, 8] },
];

export const CONTOUR = [107, 82, 50];     // #6B5232 — the stroke on every colour change
export const GRID    = [ 68, 68, 65];     // #444441 — hex grid
export const STEEP   = [178,  45,  45];   // highlight for steep-slope hexes

// Feature inks, also measured off the boards (lake from the 1988 terrain key, which
// is the only sheet that shows a full lake swatch).
export const FEATURE = {
  woods:     [ 80, 140,  75],   // #508C4B  stipple ink, laid over the elevation tint
  denseWoods:[ 34, 110,  46],   // #226E2E  the heavier hexside line
  town:      [150, 150, 150],   // #969696
  townEdge:  [ 60,  60,  58],
  urban:     [ 45,  45,  40],   // #2D2D28  the scattered building blocks
  lake:      [ 20, 116, 200],   // #1474C8
  lakeEdge:  [ 16,  74, 130],
  stream:    [105, 150, 180],   // #6996B4  printed streams are muted, not saturated
  marsh:     [232, 238, 240],   // pale wash under the dashes
  marshDash: [ 90, 150, 195],
  primary:   [225,  55,  30],   // #E1371E
  primaryEdge:[130,  28,  14],
  secondary: [ 35,  35,  28],   // #23231C
};

export const tintRgb = band => TINTS[Math.max(0, Math.min(TINTS.length - 1, band))].rgb;
export const tintHex = band => TINTS[Math.max(0, Math.min(TINTS.length - 1, band))].hex;
