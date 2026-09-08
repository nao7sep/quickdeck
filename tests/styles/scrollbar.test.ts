import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(process.cwd(), "src/styles.css"), "utf8");
const compact = css.replace(/\s+/g, "");

type Rgb = [number, number, number];

function selectorBlock(selector: string): string {
  const start = css.search(new RegExp(`^${selector.replace(".", "\\.")}\\s*\\{`, "m"));
  expect(start, `${selector} must exist`).toBeGreaterThanOrEqual(0);
  const open = css.indexOf("{", start);
  const close = css.indexOf("\n}", open);
  return css.slice(open, close);
}

function tokenValue(block: string, token: string): string {
  const match = block.match(new RegExp(`${token.replaceAll("-", "\\-")}\\s*:\\s*([^;]+);`));
  expect(match, `${token} must be defined`).toBeTruthy();
  return match![1]!.trim();
}

function parseHex(value: string): Rgb {
  const hex = value.match(/^#([0-9a-f]{6})$/i)?.[1];
  expect(hex, `${value} must be an opaque six-digit hex color`).toBeTruthy();
  return [0, 2, 4].map((offset) => Number.parseInt(hex!.slice(offset, offset + 2), 16)) as Rgb;
}

function compositeThumb(value: string, background: Rgb): Rgb {
  const match = value.match(
    /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/,
  );
  expect(match, `${value} must be an rgba color`).toBeTruthy();
  const foreground: Rgb = [Number(match![1]), Number(match![2]), Number(match![3])];
  const alpha = Number(match![4]);
  return foreground.map(
    (channel, index) => channel * alpha + background[index] * (1 - alpha),
  ) as Rgb;
}

function luminance(rgb: Rgb): number {
  const [red, green, blue] = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(first: Rgb, second: Rgb): number {
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

describe("global scrollbar styling", () => {
  it("keeps a 16px hit gutter and a 10px visible rounded thumb", () => {
    const bar = compact.match(/::-webkit-scrollbar\{[^}]*\}/)?.[0] ?? "";
    const thumb = compact.match(/::-webkit-scrollbar-thumb\{[^}]*\}/)?.[0] ?? "";

    expect(bar).toContain("width:16px");
    expect(bar).toContain("height:16px");
    expect(thumb).toContain("border:3pxsolidtransparent");
    expect(thumb).toContain("border-radius:");
    expect(thumb).toContain("background-clip:padding-box");
  });

  it("uses normal standards geometry and strengthens while its whole owner is hovered or focused", () => {
    expect(compact).toContain("scrollbar-width:auto");
    expect(compact).not.toContain("scrollbar-width:thin");
    expect(compact).toContain("::-webkit-scrollbar-thumb:hover");
    expect(compact).toContain("*:hover::-webkit-scrollbar-thumb");
    expect(compact).toContain("*:focus-within::-webkit-scrollbar-thumb");
    expect(compact).toContain("*:hover,*:focus-within");
    expect(compact).toContain("scrollbar-color:var(--scrollbar-thumb-hover)transparent");
  });

  it("defines the scrollbar palette in both themes", () => {
    expect(css.match(/--scrollbar-thumb:/g)).toHaveLength(2);
    expect(css.match(/--scrollbar-thumb-hover:/g)).toHaveLength(2);
    expect(compact).toContain("color-scheme:light");
    expect(compact).toContain("color-scheme:dark");
  });

  it("keeps the composited resting thumb at least 3:1 against every base surface", () => {
    const surfaceTokens = [
      "--surface",
      "--surface-muted",
      "--surface-hover",
      "--app-bg",
      "--deck-gutter",
    ];
    for (const selector of [":root", ":root.dark"]) {
      const block = selectorBlock(selector);
      const thumb = tokenValue(block, "--scrollbar-thumb");
      for (const surfaceToken of surfaceTokens) {
        const background = parseHex(tokenValue(block, surfaceToken));
        expect(
          contrast(compositeThumb(thumb, background), background),
          `${selector} ${surfaceToken}`,
        ).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("reserves a stable gutter and visible focus treatment for passive owners", () => {
    expect(compact).toMatch(/\[data-passive-scroll-region\]\{[^}]*scrollbar-gutter:stable/);
    expect(compact).toMatch(/\[data-passive-scroll-region\]:focus-visible\{[^}]*outline:/);
  });
});
