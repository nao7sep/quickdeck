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

// Each modifier is asserted ALONE — the old fixture set both in one event,
// which is exactly how the single-modifier zoom regression stayed invisible
// (keyboard-shortcut-conventions).
function keyEvent(
  key: string,
  mods: { metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean } = {},
): KeyboardEvent {
  return new KeyboardEvent("keydown", { key, ...mods });
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
  it("fires on Cmd (metaKey) alone for every zoom key", () => {
    expect(isZoomIn(keyEvent("=", { metaKey: true }))).toBe(true);
    expect(isZoomIn(keyEvent("+", { metaKey: true }))).toBe(true);
    expect(isZoomIn(keyEvent(";", { metaKey: true }))).toBe(true);
    expect(isZoomOut(keyEvent("-", { metaKey: true }))).toBe(true);
    expect(isZoomReset(keyEvent("0", { metaKey: true }))).toBe(true);
  });

  it("fires on Ctrl alone too — both modifiers are bound on every platform", () => {
    expect(isZoomIn(keyEvent("=", { ctrlKey: true }))).toBe(true);
    expect(isZoomIn(keyEvent(";", { ctrlKey: true }))).toBe(true);
    expect(isZoomOut(keyEvent("-", { ctrlKey: true }))).toBe(true);
    expect(isZoomReset(keyEvent("0", { ctrlKey: true }))).toBe(true);
  });

  it("rejects AltGr chords — Windows delivers AltGr as Ctrl+Alt", () => {
    // e.g. Hungarian AltGr+comma types ";" — a zoom-in key — and must keep
    // typing the character instead of zooming and swallowing it.
    expect(isZoomIn(keyEvent(";", { ctrlKey: true, altKey: true }))).toBe(false);
    expect(isZoomIn(keyEvent("=", { ctrlKey: true, altKey: true }))).toBe(false);
    expect(isZoomOut(keyEvent("-", { ctrlKey: true, altKey: true }))).toBe(false);
    expect(isZoomReset(keyEvent("0", { ctrlKey: true, altKey: true }))).toBe(false);
  });

  it("requires the modifier", () => {
    expect(isZoomIn(keyEvent("="))).toBe(false);
    expect(isZoomOut(keyEvent("-"))).toBe(false);
    expect(isZoomReset(keyEvent("0"))).toBe(false);
  });

  it("ignores unrelated keys", () => {
    expect(isZoomIn(keyEvent("a", { metaKey: true }))).toBe(false);
    expect(isZoomOut(keyEvent("=", { metaKey: true }))).toBe(false);
    expect(isZoomReset(keyEvent("9", { metaKey: true }))).toBe(false);
  });
});
