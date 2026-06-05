import { afterEach, describe, expect, it, vi } from "vitest";
import {
  darkPaneBackground,
  hslToHex,
  hueFromHex,
  minHueDistance,
  randomPaneColor,
} from "../../src/utils/paneColors";

const HEX = /^#[0-9a-f]{6}$/;

// WCAG relative luminance from a #rrggbb string.
function relativeLuminance(hex: string): number {
  const int = parseInt(hex.slice(1), 16);
  const channels = [(int >> 16) & 0xff, (int >> 8) & 0xff, int & 0xff].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

// Chroma = max - min of the RGB channels (0..1); the perceptual "colorfulness".
function chroma(hex: string): number {
  const int = parseInt(hex.slice(1), 16);
  const r = ((int >> 16) & 0xff) / 255;
  const g = ((int >> 8) & 0xff) / 255;
  const b = (int & 0xff) / 255;
  return Math.max(r, g, b) - Math.min(r, g, b);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("hueFromHex", () => {
  it("extracts the primary hues", () => {
    expect(hueFromHex("#ff0000")).toBeCloseTo(0, 0);
    expect(hueFromHex("#00ff00")).toBeCloseTo(120, 0);
    expect(hueFromHex("#0000ff")).toBeCloseTo(240, 0);
  });

  it("returns 0 for greys and null for invalid input", () => {
    expect(hueFromHex("#000000")).toBe(0);
    expect(hueFromHex("red")).toBeNull();
    expect(hueFromHex("#xyz")).toBeNull();
  });
});

describe("hslToHex / hueFromHex round-trip", () => {
  it("recovers the hue it was built from", () => {
    for (const hue of [30, 90, 200, 300]) {
      const recovered = hueFromHex(hslToHex(hue, 0.7, 0.4));
      expect(recovered).not.toBeNull();
      expect(recovered as number).toBeCloseTo(hue, 0);
    }
  });
});

describe("minHueDistance", () => {
  it("measures the shortest distance around the wheel", () => {
    expect(minHueDistance(10, [350, 40])).toBe(20);
    expect(minHueDistance(0, [])).toBe(360);
  });
});

describe("randomPaneColor", () => {
  it("always produces well-formed hex colors", () => {
    for (let i = 0; i < 50; i += 1) {
      const color = randomPaneColor();
      expect(color.header).toMatch(HEX);
      expect(color.background).toMatch(HEX);
    }
  });

  it("keeps every header dark enough for white text (well below white)", () => {
    for (let i = 0; i < 200; i += 1) {
      expect(relativeLuminance(randomPaneColor().header)).toBeLessThan(0.5);
    }
  });

  it("chooses a hue distinct from existing headers", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const existingHues = [0, 120, 240];
    const existingHeaders = existingHues.map((h) => hslToHex(h, 0.7, 0.4));
    const chosen = hueFromHex(randomPaneColor(existingHeaders).header);
    expect(chosen).not.toBeNull();
    expect(minHueDistance(chosen as number, existingHues)).toBeGreaterThan(25);
  });

  it("ignores unparseable existing headers without throwing", () => {
    expect(() => randomPaneColor(["not-a-color", "#zzzzzz"])).not.toThrow();
  });
});

describe("darkPaneBackground", () => {
  const lightHues = [0, 35, 90, 150, 210, 270, 330];

  it("reproduces the light background's exact chroma at a dark lightness", () => {
    for (const hue of lightHues) {
      // Same recipe randomPaneColor uses for the light pane background.
      const light = hslToHex(hue, 0.55, 0.95);
      const dark = darkPaneBackground(light);
      // Same colorfulness as the pale light tint (not the old, vivid ~0.13).
      expect(Math.abs(chroma(dark) - chroma(light))).toBeLessThan(0.01);
    }
  });

  it("keeps the hue but renders it much darker", () => {
    for (const hue of lightHues) {
      const light = hslToHex(hue, 0.55, 0.95);
      const dark = darkPaneBackground(light);
      // Circular distance tolerates byte-rounding noise at low lightness/chroma.
      expect(minHueDistance(hueFromHex(dark) as number, [hue])).toBeLessThan(3);
      expect(relativeLuminance(dark)).toBeLessThan(0.06);
      expect(relativeLuminance(dark)).toBeLessThan(relativeLuminance(light));
    }
  });

  it("leaves a grey input grey (zero chroma in, zero chroma out)", () => {
    expect(chroma(darkPaneBackground("#cccccc"))).toBeCloseTo(0, 5);
  });

  it("returns a valid dark hex for unparseable input without throwing", () => {
    expect(() => darkPaneBackground("not-a-color")).not.toThrow();
    expect(darkPaneBackground("not-a-color")).toMatch(HEX);
  });
});
