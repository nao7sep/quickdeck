// Pane color generation.
//
// Goals:
//   1. Header colors must read white text comfortably — every color is dark
//      enough that its WCAG relative luminance stays well below white.
//   2. When adding a pane, the new header should be visibly distinct from
//      ALL existing pane headers, not just the most recent one.
//
// The algorithm samples N candidate hues evenly around the wheel, jitters
// each, and picks the one whose minimum hue distance to any existing pane
// header is largest. Lightness is capped so light hues (yellow, lime, cyan)
// don't drift toward white at high saturation.

const SATURATION = 0.7;
// Per-hue lightness target. Hues that read perceptually bright at a given
// lightness (yellow ~60°, green ~120°, cyan ~180°) get pushed darker so the
// header stays distinguishable from white text.
const HUE_LIGHTNESS: Array<{ centerDeg: number; lightness: number }> = [
  { centerDeg: 0, lightness: 0.46 },   // red
  { centerDeg: 30, lightness: 0.44 },  // orange
  { centerDeg: 60, lightness: 0.36 },  // yellow
  { centerDeg: 90, lightness: 0.36 },  // yellow-green
  { centerDeg: 120, lightness: 0.36 }, // green
  { centerDeg: 150, lightness: 0.36 }, // teal-green
  { centerDeg: 180, lightness: 0.38 }, // cyan
  { centerDeg: 210, lightness: 0.46 }, // azure
  { centerDeg: 240, lightness: 0.5 },  // blue
  { centerDeg: 270, lightness: 0.5 },  // violet
  { centerDeg: 300, lightness: 0.46 }, // magenta
  { centerDeg: 330, lightness: 0.44 }, // pink
];
const CANDIDATE_COUNT = 24;
const MIN_HUE_DISTANCE_FOR_DISTINCT = 25; // degrees

export type PaneColor = {
  header: string;
  background: string;
};

export function randomPaneColor(existingHeaders: ReadonlyArray<string> = []): PaneColor {
  const usedHues = existingHeaders
    .map((hex) => hueFromHex(hex))
    .filter((hue): hue is number => hue !== null);

  const hue = pickHue(usedHues);
  const lightness = lightnessForHue(hue);
  return {
    header: hslToHex(hue, SATURATION, lightness),
    background: hslToHex(hue, 0.55, 0.95),
  };
}

function pickHue(usedHues: number[]): number {
  if (usedHues.length === 0) {
    return Math.random() * 360;
  }

  let bestHue = Math.random() * 360;
  let bestScore = -1;

  for (let i = 0; i < CANDIDATE_COUNT; i += 1) {
    // Evenly spaced base + jitter so two consecutive calls aren't identical.
    const base = (i / CANDIDATE_COUNT) * 360;
    const jitter = (Math.random() - 0.5) * (360 / CANDIDATE_COUNT);
    const candidate = (base + jitter + 360) % 360;
    const minDistance = minHueDistance(candidate, usedHues);

    if (minDistance > bestScore) {
      bestScore = minDistance;
      bestHue = candidate;
    }
  }

  // If even the best is uncomfortably close (very crowded wheel), nudge it.
  if (bestScore < MIN_HUE_DISTANCE_FOR_DISTINCT && usedHues.length < 12) {
    bestHue = (bestHue + 180) % 360;
  }

  return bestHue;
}

function minHueDistance(hue: number, others: number[]): number {
  let min = 360;
  for (const other of others) {
    const diff = Math.abs(hue - other) % 360;
    const distance = Math.min(diff, 360 - diff);
    if (distance < min) {
      min = distance;
    }
  }
  return min;
}

function lightnessForHue(hue: number): number {
  let bestEntry = HUE_LIGHTNESS[0];
  let bestDistance = 360;
  for (const entry of HUE_LIGHTNESS) {
    const diff = Math.abs(hue - entry.centerDeg) % 360;
    const distance = Math.min(diff, 360 - diff);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestEntry = entry;
    }
  }
  return bestEntry.lightness;
}

function hslToHex(hueDeg: number, saturation: number, lightness: number): string {
  const h = ((hueDeg % 360) + 360) % 360 / 360;
  const s = clamp01(saturation);
  const l = clamp01(lightness);

  let r: number;
  let g: number;
  let b: number;

  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hueToRgb(p, q, h + 1 / 3);
    g = hueToRgb(p, q, h);
    b = hueToRgb(p, q, h - 1 / 3);
  }

  return `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}`;
}

function hueToRgb(p: number, q: number, t: number): number {
  let normalized = t;
  if (normalized < 0) normalized += 1;
  if (normalized > 1) normalized -= 1;
  if (normalized < 1 / 6) return p + (q - p) * 6 * normalized;
  if (normalized < 1 / 2) return q;
  if (normalized < 2 / 3) return p + (q - p) * (2 / 3 - normalized) * 6;
  return p;
}

function toHexByte(value: number): string {
  return Math.round(clamp01(value) * 255)
    .toString(16)
    .padStart(2, "0");
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function hueFromHex(hex: string): number | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) {
    return null;
  }
  const int = parseInt(match[1], 16);
  const r = ((int >> 16) & 0xff) / 255;
  const g = ((int >> 8) & 0xff) / 255;
  const b = (int & 0xff) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) {
    return 0;
  }
  let hue: number;
  if (max === r) {
    hue = ((g - b) / delta) % 6;
  } else if (max === g) {
    hue = (b - r) / delta + 2;
  } else {
    hue = (r - g) / delta + 4;
  }
  return ((hue * 60) + 360) % 360;
}
