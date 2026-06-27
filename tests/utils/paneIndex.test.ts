import { describe, expect, it } from "vitest";
import { clampPaneIndex } from "../../src/utils/paneIndex";

describe("clampPaneIndex", () => {
  it("leaves an in-range index unchanged", () => {
    expect(clampPaneIndex(2, 5)).toBe(2);
  });

  it("clamps below 0 up to the first index (focus-previous past the start)", () => {
    expect(clampPaneIndex(-1, 5)).toBe(0);
    expect(clampPaneIndex(-3, 5)).toBe(0);
  });

  it("clamps past the end down to the last index (focus-next past the end)", () => {
    expect(clampPaneIndex(5, 5)).toBe(4);
    expect(clampPaneIndex(99, 5)).toBe(4);
  });

  it("maps a not-found active pane (index -1) to the first pane for both directions", () => {
    // focusPrevious: index -1 -> -1 - 1 = -2 -> 0; focusNext: -1 + 1 = 0 -> 0.
    expect(clampPaneIndex(-1 - 1, 3)).toBe(0);
    expect(clampPaneIndex(-1 + 1, 3)).toBe(0);
  });

  it("returns 0 defensively for an empty list", () => {
    expect(clampPaneIndex(0, 0)).toBe(0);
    expect(clampPaneIndex(3, 0)).toBe(0);
  });
});
