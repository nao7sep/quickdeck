import { describe, expect, it } from "vitest";
import {
  normalizeWindowPlacement,
  resolveWindowRestoration,
  settledWindowPlacement,
  usableWindowBounds,
} from "../../src/services/windowPlacement";

const monitors = [
  { position: { x: 0, y: 0 }, size: { width: 1920, height: 1080 }, workArea: { position: { x: 0, y: 0 }, size: { width: 1920, height: 1080 } }, scaleFactor: 1 },
  { position: { x: -2560, y: 0 }, size: { width: 2560, height: 2048 }, workArea: { position: { x: -2560, y: 0 }, size: { width: 2560, height: 2048 } }, scaleFactor: 2 },
];

describe("window placement", () => {
  it("self-heals malformed records field by field", () => {
    expect(normalizeWindowPlacement(null)).toBeNull();
    expect(normalizeWindowPlacement({ mode: "fullscreen", normalBounds: { x: 1, y: 2, width: "wide", height: 700 } }))
      .toEqual({ mode: "normal", normalBounds: null });
  });

  it("defaults maximized and preserves mode when geometry falls back", () => {
    expect(resolveWindowRestoration(null, { width: 900, height: 600 }, monitors))
      .toEqual({ normalBounds: null, mode: "maximized" });
    expect(resolveWindowRestoration({ mode: "normal", normalBounds: { x: 9000, y: 9000, width: 1200, height: 800 } }, { width: 900, height: 600 }, monitors))
      .toEqual({ normalBounds: null, mode: "normal" });
  });

  it("requires integral bounds above the scaled minimum and wholly within one work area", () => {
    expect(usableWindowBounds({ x: -2400, y: 20, width: 1900, height: 1300 }, { width: 900, height: 600 }, monitors)).toBe(true);
    expect(usableWindowBounds({ x: 10, y: 10, width: 899, height: 700 }, { width: 900, height: 600 }, monitors)).toBe(false);
    expect(usableWindowBounds({ x: 1200, y: 10, width: 900, height: 700 }, { width: 900, height: 600 }, monitors)).toBe(false);
    expect(usableWindowBounds({ x: 10.5, y: 10, width: 900, height: 700 }, { width: 900, height: 600 }, monitors)).toBe(false);
  });

  it("captures normal geometry, preserves it on maximize, and ignores transient shutdown bounds", () => {
    const opening = { normalBounds: { x: 10, y: 20, width: 1200, height: 800 }, mode: "normal" as const };
    const moved = settledWindowPlacement(opening, {
      bounds: { x: 50, y: 60, width: 1300, height: 850 },
      minimized: false, fullscreen: false, maximized: false,
    });
    expect(moved).toEqual({ normalBounds: { x: 50, y: 60, width: 1300, height: 850 }, mode: "normal" });
    const maximized = settledWindowPlacement(moved, {
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      minimized: false, fullscreen: false, maximized: true,
    });
    expect(maximized).toEqual({ normalBounds: moved.normalBounds, mode: "maximized" });
    expect(settledWindowPlacement(maximized, {
      bounds: { x: 0, y: 0, width: 300, height: 200 },
      minimized: true, fullscreen: false, maximized: false,
    })).toEqual(maximized);
    expect(settledWindowPlacement(maximized, {
      bounds: { x: 0, y: 0, width: 300, height: 200 },
      minimized: false, fullscreen: true, maximized: false,
    })).toEqual(maximized);
  });
});
