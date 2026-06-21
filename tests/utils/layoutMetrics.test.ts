import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  computeWindowMinHeight,
  computeWindowMinWidth,
  DECK_GUTTER,
  PANE_MIN_HEIGHT,
  PANE_MIN_WIDTH,
  STATUS_BAR_HEIGHT,
} from "../../src/utils/layoutMetrics";

// `npm test` runs vitest from the repo root, so cwd is the project root.
function readTauriConf(): { minWidth: number; minHeight: number } {
  const text = readFileSync(join(process.cwd(), "src-tauri/tauri.conf.json"), "utf8");
  const window = JSON.parse(text).app.windows[0];
  return { minWidth: window.minWidth, minHeight: window.minHeight };
}

describe("computeWindowMinWidth", () => {
  it("a single pane is exactly its own minimum (no gutter, no chrome today)", () => {
    expect(computeWindowMinWidth(1, false)).toBe(PANE_MIN_WIDTH);
  });

  it("n panes reserve every pane plus the gutters between them", () => {
    // 3 panes → 3 mins + 2 gutters.
    expect(computeWindowMinWidth(3, false)).toBe(3 * PANE_MIN_WIDTH + 2 * DECK_GUTTER);
    expect(computeWindowMinWidth(5, false)).toBe(5 * PANE_MIN_WIDTH + 4 * DECK_GUTTER);
  });

  it("is monotonically non-decreasing in pane count", () => {
    let previous = computeWindowMinWidth(1, false);
    for (let count = 2; count <= 12; count += 1) {
      const current = computeWindowMinWidth(count, false);
      expect(current).toBeGreaterThan(previous);
      previous = current;
    }
  });

  it("zen mode collapses the width floor to a single pane regardless of count", () => {
    expect(computeWindowMinWidth(7, true)).toBe(computeWindowMinWidth(1, false));
    expect(computeWindowMinWidth(1, true)).toBe(computeWindowMinWidth(1, false));
  });

  it("treats a zero/negative pane count as a single pane (never below the floor)", () => {
    expect(computeWindowMinWidth(0, false)).toBe(PANE_MIN_WIDTH);
  });
});

describe("computeWindowMinHeight", () => {
  it("is one pane minimum stacked above the fixed status bar", () => {
    expect(computeWindowMinHeight()).toBe(PANE_MIN_HEIGHT + STATUS_BAR_HEIGHT);
  });
});

// The "kept in sync" guard: tauri.conf.json's static minimum is the very first
// frame's floor before any JS runs, so it must equal the single-pane derived
// floor — otherwise the static config and the computed minimum would disagree.
describe("tauri.conf.json static minimum stays in sync with the derived floor", () => {
  it("minWidth equals computeWindowMinWidth(1, false)", () => {
    expect(readTauriConf().minWidth).toBe(computeWindowMinWidth(1, false));
  });

  it("minHeight equals computeWindowMinHeight()", () => {
    expect(readTauriConf().minHeight).toBe(computeWindowMinHeight());
  });
});
