import { describe, expect, it } from "vitest";
import { clampPaneWidth } from "../../src/utils/paneWidth";

const bounds = { siblingMin: 500, min: 320, max: 640 };

describe("clampPaneWidth", () => {
  it("shows the intent while the window has room for it", () => {
    expect(clampPaneWidth(400, { available: 2000, ...bounds })).toBe(400);
  });

  it("narrows toward the pane's minimum as the window leaves less room, and returns when it grows", () => {
    expect(clampPaneWidth(600, { available: 1000, ...bounds })).toBe(500);
    expect(clampPaneWidth(600, { available: 700, ...bounds })).toBe(320);
    expect(clampPaneWidth(600, { available: 2000, ...bounds })).toBe(600);
  });

  it("holds the intent to the pane's own bounds before the container is measured", () => {
    expect(clampPaneWidth(900, { available: null, ...bounds })).toBe(640);
    expect(clampPaneWidth(100, { available: null, ...bounds })).toBe(320);
  });
});
