import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  computeWindowMinHeight,
  computeWindowMinWidth,
} from "../../src/utils/layoutMetrics";

// Static guards over the stylesheet and the Tauri window manifest. They check
// the window-chrome-conventions artifacts that live as text rather than code:
// the color-scheme declarations, the styled scroll bar, the real per-pane
// minimum, and a non-transparent title bar with a minimum matching the derived
// single-pane floor. `npm test` runs vitest from the repo root.
function read(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), "utf8");
}

describe("styles.css scroll-bar and color-scheme guards", () => {
  const css = read("src/styles.css");

  it(":root declares color-scheme: light", () => {
    expect(css).toMatch(/:root\s*\{[^}]*color-scheme:\s*light/);
  });

  it(":root.dark declares color-scheme: dark", () => {
    expect(css).toMatch(/:root\.dark\s*\{[^}]*color-scheme:\s*dark/);
  });

  it("styles the scroll bar with a rounded thumb", () => {
    expect(css).toMatch(/::-webkit-scrollbar\b/);
    // The pill thumb: a ::-webkit-scrollbar-thumb rule carrying a border-radius.
    expect(css).toMatch(/::-webkit-scrollbar-thumb\s*\{[^}]*border-radius/);
  });

  it("declares thin native scroll bars (scrollbar-width)", () => {
    expect(css).toMatch(/scrollbar-width:\s*thin/);
  });

  it("does not paint disabled menu buttons with the clickable hover state", () => {
    expect(css).toMatch(/\.menuPanel button:hover:not\(:disabled\)\s*\{/);
    expect(css).not.toMatch(/\.menuPanel button:hover\s*\{/);
  });

  it(".pane carries a real min-width but no min-height (the footer must never be clipped)", () => {
    // Match the standalone `.pane { ... }` rule (anchored at line start) rather
    // than the descendant `:root.dark .pane { ... }` rule earlier in the file.
    const paneRule = /^\.pane\s*\{([^}]*)\}/m.exec(css);
    expect(paneRule).not.toBeNull();
    expect(paneRule![1]).not.toMatch(/min-width:\s*0\b/);
    expect(paneRule![1]).toMatch(/min-width:/);
    // The vertical minimum is enforced at the window level, not as a pane min-height:
    // a pane taller than the deck would overflow and the deck's overflow:hidden would
    // clip the footer (the char counts). Guard that the regression doesn't return.
    expect(paneRule![1]).not.toMatch(/min-height:/);
  });
});

describe("tauri.conf.json window-chrome guards", () => {
  const window = JSON.parse(read("src-tauri/tauri.conf.json")).app.windows[0];

  it("the title bar is not transparent (a normal themed bar)", () => {
    expect(window.titleBarStyle).not.toBe("Transparent");
  });

  it("minWidth equals the single-pane derived floor", () => {
    expect(window.minWidth).toBe(computeWindowMinWidth(1, false));
  });

  it("minHeight equals the derived height floor", () => {
    expect(window.minHeight).toBe(computeWindowMinHeight());
  });
});
