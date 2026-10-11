import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contrast, parseHex, themeBlock, tokenValue } from "../helpers/themeCss";

const css = readFileSync(join(process.cwd(), "src/styles.css"), "utf8");
const themeRs = readFileSync(join(process.cwd(), "src-tauri/src/theme.rs"), "utf8");
const themes = ["light", "dark"] as const;

// Foreground tokens on the surfaces the stylesheet actually places them on.
const TEXT_PAIRS: ReadonlyArray<[string, string]> = [
  ["--text", "--surface"],
  ["--text", "--surface-muted"],
  ["--text", "--app-bg"],
  ["--text-strong", "--surface"],
  ["--text-strong", "--surface-muted"],
  ["--text-strong", "--surface-accent"],
  ["--text-heading", "--surface"],
  ["--text-onhover", "--surface-hover"],
  ["--text-onhover", "--surface-selected"],
  ["--text-muted", "--surface"],
  ["--accent", "--surface"],
  ["--accent", "--surface-accent"],
  ["--accent-strong", "--surface"],
  ["--accent-strong", "--surface-accent"],
  ["--danger", "--surface"],
  ["--danger", "--danger-surface"],
  ["--danger", "--danger-surface-pressed"],
  ["--kbd-text", "--kbd-bg"],
];

function pairContrast(theme: (typeof themes)[number], foreground: string, background: string): number {
  const block = themeBlock(css, theme);
  return contrast(parseHex(tokenValue(block, foreground)), parseHex(tokenValue(block, background)));
}

describe("theme token contrast", () => {
  for (const theme of themes) {
    it(`keeps text at 4.5:1 or more in the ${theme} theme`, () => {
      for (const [foreground, background] of TEXT_PAIRS) {
        expect(pairContrast(theme, foreground, background), `${foreground} on ${background}`)
          .toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`preserves the measured line hierarchy in the ${theme} theme`, () => {
      for (const surface of ["--surface", "--surface-muted", "--surface-accent"]) {
        const band = pairContrast(theme, "--border", surface);
        const control = pairContrast(theme, "--control-edge", surface);
        expect(band, surface).toBeGreaterThanOrEqual(1.35);
        expect(band, surface).toBeLessThanOrEqual(1.7);
        expect(control, surface).toBeGreaterThanOrEqual(2);
        expect(control, surface).toBeLessThanOrEqual(2.5);
        expect(pairContrast(theme, "--input-border", surface)).toBe(control);
      }
    });
  }
});

describe("native window background", () => {
  function rustBackground(arm: string): string {
    const match = themeRs.match(
      new RegExp(`${arm} => Color\\(0x([0-9a-f]{2}), 0x([0-9a-f]{2}), 0x([0-9a-f]{2}), 0xff\\)`, "i"),
    );
    if (!match) throw new Error(`window_background arm ${arm} missing`);
    return `#${match[1]}${match[2]}${match[3]}`.toLowerCase();
  }

  it("matches --app-bg in each theme so the frame behind the page never flashes", () => {
    expect(rustBackground("Theme::Dark")).toBe(tokenValue(themeBlock(css, "dark"), "--app-bg").toLowerCase());
    expect(rustBackground("_")).toBe(tokenValue(themeBlock(css, "light"), "--app-bg").toLowerCase());
  });
});
