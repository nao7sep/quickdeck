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

// Boundaries that alone identify a control: a text field's outline on the modal
// surface, and the invalid-field outline.
const BOUNDARY_PAIRS: ReadonlyArray<[string, string]> = [
  ["--input-border", "--surface"],
  ["--danger", "--surface"],
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

    it(`keeps control boundaries at 3:1 or more in the ${theme} theme`, () => {
      for (const [foreground, background] of BOUNDARY_PAIRS) {
        expect(pairContrast(theme, foreground, background), `${foreground} on ${background}`)
          .toBeGreaterThanOrEqual(3);
      }
    });
  }
});

// The line a dialog's header and footer bands draw (checked in
// modalBands.test.ts) must stay as visible as the app's own control borders
// in both themes (modal-dialog-conventions). Recorded here as a contrast
// comparison so a future retint of either token can't quietly make the line
// fainter than a button's or field's own border again.
describe("dialog band separator contrast", () => {
  it("keeps the control-border token at least as visible as the divider token in both themes", () => {
    for (const theme of themes) {
      const dividerContrast = pairContrast(theme, "--border", "--surface");
      const controlEdgeContrast = pairContrast(theme, "--control-edge", "--surface");
      expect(controlEdgeContrast, theme).toBeGreaterThanOrEqual(dividerContrast);
    }
  });
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
