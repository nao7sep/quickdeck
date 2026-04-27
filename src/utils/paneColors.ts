// Random, vivid header colors for panes.
// Saturation/lightness are kept in a band that yields readable white text on
// the header while still feeling colorful. Background is a very light tint
// derived from the same hue.

const SATURATION = 0.68;
const LIGHTNESS = 0.48;
const MIN_HUE_DISTANCE_DEG = 90;

export type PaneColor = {
  header: string;
  background: string;
};

export function randomPaneColor(previousHeader?: string | null): PaneColor {
  const previousHue = previousHeader ? hueFromHex(previousHeader) : null;
  const hue = pickHue(previousHue);
  return {
    header: hslToHex(hue, SATURATION, LIGHTNESS),
    background: hslToHex(hue, 0.55, 0.95),
  };
}

function pickHue(previousHue: number | null): number {
  if (previousHue === null) {
    return Math.random() * 360;
  }

  // Pick a random hue from the half of the wheel that is far from the previous one.
  const offset = MIN_HUE_DISTANCE_DEG + Math.random() * (360 - 2 * MIN_HUE_DISTANCE_DEG);
  return (previousHue + offset) % 360;
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
