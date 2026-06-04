import { describe, expect, it } from "vitest";
import {
  ZOOM_DEFAULT,
  ZOOM_LEVELS,
  ZOOM_MAX,
  ZOOM_MIN,
  isZoomIn,
  isZoomOut,
  isZoomReset,
  stepZoomIn,
  stepZoomOut,
} from "../../src/utils/zoom";

// Set both modifiers so the platform-detected primary modifier is satisfied
// whether the test host resolves to Apple (metaKey) or not (ctrlKey).
function keyEvent(key: string, withModifier: boolean): KeyboardEvent {
  return new KeyboardEvent("keydown", {
    key,
    ctrlKey: withModifier,
    metaKey: withModifier,
  });
}

describe("zoom levels", () => {
  it("is strictly increasing with the expected bounds", () => {
    for (let i = 1; i < ZOOM_LEVELS.length; i += 1) {
      expect(ZOOM_LEVELS[i]).toBeGreaterThan(ZOOM_LEVELS[i - 1]);
    }
    expect(ZOOM_MIN).toBe(0.5);
    expect(ZOOM_MAX).toBe(5.0);
    expect(ZOOM_DEFAULT).toBe(1.0);
  });

  it("steps in toward the next level and clamps at the maximum", () => {
    expect(stepZoomIn(1.0)).toBe(1.2);
    expect(stepZoomIn(0.5)).toBe(0.6);
    expect(stepZoomIn(ZOOM_MAX)).toBe(ZOOM_MAX);
  });

  it("steps out toward the previous level and clamps at the minimum", () => {
    expect(stepZoomOut(1.0)).toBe(0.9);
    expect(stepZoomOut(5.0)).toBe(4.2);
    expect(stepZoomOut(ZOOM_MIN)).toBe(ZOOM_MIN);
  });

  it("snaps an off-list value onto the nearest level before stepping", () => {
    expect(stepZoomIn(1.05)).toBe(1.2); // nearest 1.0 -> next 1.2
    expect(stepZoomOut(1.05)).toBe(0.9); // nearest 1.0 -> prev 0.9
  });
});

describe("zoom shortcuts", () => {
  it("recognizes zoom-in keys with the primary modifier", () => {
    expect(isZoomIn(keyEvent("=", true))).toBe(true);
    expect(isZoomIn(keyEvent("+", true))).toBe(true);
    expect(isZoomIn(keyEvent(";", true))).toBe(true);
  });

  it("recognizes zoom-out and zoom-reset keys", () => {
    expect(isZoomOut(keyEvent("-", true))).toBe(true);
    expect(isZoomReset(keyEvent("0", true))).toBe(true);
  });

  it("requires the modifier", () => {
    expect(isZoomIn(keyEvent("=", false))).toBe(false);
    expect(isZoomOut(keyEvent("-", false))).toBe(false);
    expect(isZoomReset(keyEvent("0", false))).toBe(false);
  });

  it("ignores unrelated keys", () => {
    expect(isZoomIn(keyEvent("a", true))).toBe(false);
    expect(isZoomOut(keyEvent("=", true))).toBe(false);
    expect(isZoomReset(keyEvent("9", true))).toBe(false);
  });
});
