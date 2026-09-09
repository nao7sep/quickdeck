import { describe, expect, it } from "vitest";
import {
  normalizeWindowPlacement,
  resolveWindowRestoration,
  settledWindowPlacement,
  restorableBounds,
} from "../../src/services/windowPlacement";

const monitors = [
  { workArea: { position: { x: 0, y: 30 }, size: { width: 1920, height: 1010 } } },
  { workArea: { position: { x: -2560, y: 0 }, size: { width: 2560, height: 2048 } } },
];

describe("window placement", () => {
  it("repairs malformed geometry independently from stable mode", () => {
    expect(normalizeWindowPlacement(null)).toBeNull();
    expect(normalizeWindowPlacement({ mode: "maximized", normalBounds: { x: 1, y: 2, width: -1, height: 700 } }))
      .toEqual({ mode: "maximized", normalBounds: null });
  });

  it("uses the approved default and preserves mode when the display is unavailable", () => {
    expect(resolveWindowRestoration(null, monitors))
      .toEqual({ normalBounds: null, mode: "maximized" });
    expect(resolveWindowRestoration({ mode: "maximized", normalBounds: { x: 9000, y: 9000, width: 1200, height: 800 } }, monitors))
      .toEqual({ normalBounds: null, mode: "maximized" });
  });

  it("retains useful splits and fits constrained bounds within the work area origin", () => {
    const split = { x: -2400, y: 20, width: 900, height: 1300 };
    expect(restorableBounds(split, monitors)).toEqual(split);
    expect(restorableBounds({ x: 10, y: 10, width: 899, height: 700 }, monitors))
      .toEqual({ x: 10, y: 30, width: 899, height: 700 });
    expect(restorableBounds({ x: 1200, y: 40, width: 900, height: 1100 }, monitors))
      .toEqual({ x: 1020, y: 30, width: 900, height: 1010 });
    expect(restorableBounds({ x: 10.5, y: 30, width: 900, height: 700 }, monitors)).toBeNull();
    expect(restorableBounds({ x: 10, y: 30, width: 0, height: 700 }, monitors)).toBeNull();
  });

  it("captures normal geometry and keeps it through maximized and transient modes", () => {
    const opening = { normalBounds: { x: 10, y: 40, width: 1200, height: 800 }, mode: "normal" as const };
    const moved = settledWindowPlacement(opening, {
      bounds: { x: 50, y: 60, width: 1300, height: 850 },
      minimized: false, fullscreen: false, maximized: false,
    });
    const maximized = settledWindowPlacement(moved, {
      bounds: { x: 0, y: 30, width: 1920, height: 1010 },
      minimized: false, fullscreen: false, maximized: true,
    });
    expect(maximized).toEqual({ normalBounds: moved.normalBounds, mode: "maximized" });
    for (const transient of [{ minimized: true, fullscreen: false }, { minimized: false, fullscreen: true }]) {
      expect(settledWindowPlacement(maximized, {
        bounds: { x: 0, y: 0, width: 300, height: 200 }, maximized: false, ...transient,
      })).toEqual(maximized);
    }
  });
});
