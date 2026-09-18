import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contrast, parseHex, themeBlock, tokenValue, type Rgb } from "../helpers/themeCss";

const css = readFileSync(join(process.cwd(), "src/styles.css"), "utf8");
const compact = css.replace(/\s+/g, "");

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
    for (const theme of ["light", "dark"] as const) {
      const block = themeBlock(css, theme);
      const thumb = tokenValue(block, "--scrollbar-thumb");
      for (const surfaceToken of surfaceTokens) {
        const background = parseHex(tokenValue(block, surfaceToken));
        expect(
          contrast(compositeThumb(thumb, background), background),
          `${theme} ${surfaceToken}`,
        ).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("reserves a stable gutter and visible focus treatment for passive owners", () => {
    expect(compact).toMatch(/\[data-passive-scroll-region\]\{[^}]*scrollbar-gutter:stable/);
    expect(compact).toMatch(/\[data-passive-scroll-region\]:focus-visible\{[^}]*outline:/);
  });
});
