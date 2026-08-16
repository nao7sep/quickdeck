import { describe, expect, it } from "vitest";
import {
  SETTINGS_BOUNDS,
  clampNumber,
  isSettingsDraftValid,
  normalizePanes,
  normalizeSettings,
  normalizeZoomLevel,
} from "../../src/state/normalize";
import { defaultSettings } from "../../src/state/defaults";
import { ZOOM_DEFAULT, ZOOM_MAX, ZOOM_MIN } from "../../src/utils/zoom";
import type { AppSettings, Pane } from "../../src/types";

const HEX = /^#[0-9a-f]{6}$/i;

describe("clampNumber", () => {
  it("returns the fallback for non-finite values", () => {
    expect(clampNumber(Number.NaN, 0, 10, 5)).toBe(5);
    expect(clampNumber(Number.POSITIVE_INFINITY, 0, 10, 5)).toBe(5);
  });

  it("clamps into range and passes through valid values", () => {
    expect(clampNumber(15, 0, 10, 5)).toBe(10);
    expect(clampNumber(-3, 0, 10, 5)).toBe(0);
    expect(clampNumber(7, 0, 10, 5)).toBe(7);
  });
});

describe("normalizeSettings", () => {
  it("returns defaults when given null", () => {
    expect(normalizeSettings(null)).toEqual(defaultSettings);
  });

  it("fills missing fields from defaults", () => {
    const result = normalizeSettings({ zen: true } as AppSettings);
    expect(result.zen).toBe(true);
    expect(result.editorFontFamily).toBe(defaultSettings.editorFontFamily);
    expect(result.editorFontSize).toBe(defaultSettings.editorFontSize);
  });

  it("clamps numeric settings to their allowed ranges", () => {
    const result = normalizeSettings({
      ...defaultSettings,
      editorFontSize: 100,
      autosaveDelaySeconds: 0,
      snapshotSearchPageSize: 9999,
    });
    expect(result.editorFontSize).toBe(32);
    expect(result.autosaveDelaySeconds).toBe(1);
    expect(result.snapshotSearchPageSize).toBe(200);

    const low = normalizeSettings({
      ...defaultSettings,
      editorFontSize: 2,
      autosaveDelaySeconds: 999,
      snapshotSearchPageSize: 1,
    });
    expect(low.editorFontSize).toBe(10);
    expect(low.autosaveDelaySeconds).toBe(60);
    expect(low.snapshotSearchPageSize).toBe(5);
  });

  it("falls back when a numeric setting is not finite", () => {
    const result = normalizeSettings({ ...defaultSettings, editorFontSize: Number.NaN });
    expect(result.editorFontSize).toBe(defaultSettings.editorFontSize);
  });

  it("drops unknown keys not in the schema", () => {
    const result = normalizeSettings({
      ...defaultSettings,
      darkMode: true,
      theme: "light",
      uiZoomPercent: 69,
    } as unknown as AppSettings);
    expect(result).not.toHaveProperty("darkMode");
    expect(result).not.toHaveProperty("theme");
    expect(result).not.toHaveProperty("uiZoomPercent");
    expect(Object.keys(result).sort()).toEqual(Object.keys(defaultSettings).sort());
  });

  it("emits keys in canonical order (dark, zen, topmost first)", () => {
    expect(Object.keys(normalizeSettings({ ...defaultSettings }))).toEqual([
      "dark",
      "zen",
      "topmost",
      "uiFontFamily",
      "editorFontFamily",
      "editorFontSize",
      "editorLineHeight",
      "editorPadding",
      "editorBold",
      "editorItalic",
      "editorUnderline",
      "autosaveDelaySeconds",
      "snapshotSearchPageSize",
    ]);
  });

  it("coerces the boolean toggles and falls back for non-booleans", () => {
    expect(normalizeSettings({ ...defaultSettings, dark: true }).dark).toBe(true);
    const bad = normalizeSettings({
      ...defaultSettings,
      dark: "yes",
      topmost: 1,
    } as unknown as AppSettings);
    expect(bad.dark).toBe(defaultSettings.dark);
    expect(bad.topmost).toBe(defaultSettings.topmost);
  });

  it("falls back for an empty or non-string font family", () => {
    expect(normalizeSettings({ ...defaultSettings, editorFontFamily: "   " }).editorFontFamily).toBe(
      defaultSettings.editorFontFamily,
    );
    expect(
      normalizeSettings({ ...defaultSettings, editorFontFamily: 123 } as unknown as AppSettings)
        .editorFontFamily,
    ).toBe(defaultSettings.editorFontFamily);
    expect(normalizeSettings({ ...defaultSettings, editorFontFamily: "Courier" }).editorFontFamily).toBe(
      "Courier",
    );
  });

  it("trims surrounding whitespace from a non-blank font family", () => {
    expect(normalizeSettings({ ...defaultSettings, editorFontFamily: "  Menlo  " }).editorFontFamily).toBe(
      "Menlo",
    );
  });

  it("keeps the UI font blank (= default) but trims it; reverts a non-string to the default", () => {
    // Unlike the editor font, a blank UI font is preserved (blank means the built-in default stack).
    expect(normalizeSettings({ ...defaultSettings, uiFontFamily: "   " }).uiFontFamily).toBe("");
    expect(normalizeSettings({ ...defaultSettings, uiFontFamily: "  Iosevka  " }).uiFontFamily).toBe("Iosevka");
    expect(
      normalizeSettings({ ...defaultSettings, uiFontFamily: 123 } as unknown as AppSettings).uiFontFamily,
    ).toBe(defaultSettings.uiFontFamily);
  });

  it("clamps editor line-height and padding, and coerces the style toggles", () => {
    const r = normalizeSettings({
      ...defaultSettings,
      editorLineHeight: 9,
      editorPadding: -5,
      editorBold: true,
      editorItalic: "yes" as unknown as boolean,
    });
    expect(r.editorLineHeight).toBe(SETTINGS_BOUNDS.editorLineHeight.max);
    expect(r.editorPadding).toBe(SETTINGS_BOUNDS.editorPadding.min);
    expect(r.editorBold).toBe(true);
    expect(r.editorItalic).toBe(defaultSettings.editorItalic); // non-boolean → default
    expect(r.editorUnderline).toBe(false);
  });

  it("ignores a stray zoomLevel left in config.json by an older build", () => {
    // zoomLevel moved to state.json (persisted-store-separation); the known-keys
    // rebuild drops the old config field on the next save, no migration needed.
    const result = normalizeSettings({
      ...defaultSettings,
      zoomLevel: 2.4,
    } as unknown as AppSettings);
    expect(result).not.toHaveProperty("zoomLevel");
  });
});

describe("normalizeZoomLevel", () => {
  it("clamps into the supported range and passes valid levels through", () => {
    expect(normalizeZoomLevel(99)).toBe(ZOOM_MAX);
    expect(normalizeZoomLevel(0.01)).toBe(ZOOM_MIN);
    expect(normalizeZoomLevel(1.2)).toBe(1.2);
  });

  it("falls back to the default for absent or invalid values", () => {
    expect(normalizeZoomLevel(undefined)).toBe(ZOOM_DEFAULT);
    expect(normalizeZoomLevel(null)).toBe(ZOOM_DEFAULT);
    expect(normalizeZoomLevel(Number.NaN)).toBe(ZOOM_DEFAULT);
    expect(normalizeZoomLevel("1.2")).toBe(ZOOM_DEFAULT);
  });
});

describe("isSettingsDraftValid", () => {
  it("accepts the default settings", () => {
    expect(isSettingsDraftValid(defaultSettings)).toBe(true);
  });

  it("accepts values exactly at the inclusive bounds", () => {
    expect(
      isSettingsDraftValid({
        ...defaultSettings,
        editorFontSize: SETTINGS_BOUNDS.editorFontSize.min,
        autosaveDelaySeconds: SETTINGS_BOUNDS.autosaveDelaySeconds.max,
        snapshotSearchPageSize: SETTINGS_BOUNDS.snapshotSearchPageSize.min,
      }),
    ).toBe(true);
  });

  it("rejects values just outside the bounds", () => {
    expect(isSettingsDraftValid({ ...defaultSettings, editorFontSize: 9 })).toBe(false);
    expect(isSettingsDraftValid({ ...defaultSettings, editorFontSize: 33 })).toBe(false);
    expect(isSettingsDraftValid({ ...defaultSettings, snapshotSearchPageSize: 4 })).toBe(false);
  });

  it("rejects zero, the value an emptied number input produces", () => {
    expect(isSettingsDraftValid({ ...defaultSettings, editorFontSize: 0 })).toBe(false);
  });

  it("rejects non-finite values", () => {
    expect(isSettingsDraftValid({ ...defaultSettings, autosaveDelaySeconds: Number.NaN })).toBe(false);
    expect(
      isSettingsDraftValid({ ...defaultSettings, snapshotSearchPageSize: Number.POSITIVE_INFINITY }),
    ).toBe(false);
  });
});

// The form (isSettingsDraftValid + input min/max) and the load path
// (normalizeSettings clamp) read the same SETTINGS_BOUNDS, so they can never
// disagree about what is acceptable. This guards against the form accepting a
// value the load path would silently clamp away on the next launch.
describe("SETTINGS_BOUNDS agreement between validation and clamping", () => {
  const keys = ["editorFontSize", "autosaveDelaySeconds", "snapshotSearchPageSize"] as const;

  for (const key of keys) {
    const { min, max } = SETTINGS_BOUNDS[key];

    it(`treats ${key} at its max as valid and leaves it unchanged`, () => {
      const draft = { ...defaultSettings, [key]: max };
      expect(isSettingsDraftValid(draft)).toBe(true);
      expect(normalizeSettings(draft)[key]).toBe(max);
    });

    it(`rejects ${key} above its max and clamps it to the same max`, () => {
      const draft = { ...defaultSettings, [key]: max + 1 };
      expect(isSettingsDraftValid(draft)).toBe(false);
      expect(normalizeSettings(draft)[key]).toBe(max);
    });

    it(`rejects ${key} below its min and clamps it to the same min`, () => {
      const draft = { ...defaultSettings, [key]: min - 1 };
      expect(isSettingsDraftValid(draft)).toBe(false);
      expect(normalizeSettings(draft)[key]).toBe(min);
    });
  }
});

describe("normalizePanes", () => {
  it("returns an empty array for non-array input", () => {
    expect(normalizePanes(undefined)).toEqual([]);
    expect(normalizePanes("nope" as unknown as Pane[])).toEqual([]);
  });

  it("drops panes without a usable id", () => {
    const panes = [
      { id: "", title: "x", content: "", headerColor: "#aabbcc", backgroundColor: "#112233" },
      { title: "no id" },
    ] as unknown as Pane[];
    expect(normalizePanes(panes)).toEqual([]);
  });

  it("preserves valid colors and content", () => {
    const panes = [
      { id: "p1", title: "Title", content: "body", headerColor: "#aabbcc", backgroundColor: "#112233" },
    ] as Pane[];
    expect(normalizePanes(panes)[0]).toEqual({
      id: "p1",
      title: "Title",
      content: "body",
      headerColor: "#aabbcc",
      backgroundColor: "#112233",
    });
  });

  it("regenerates colors when they are missing or invalid", () => {
    const panes = [
      { id: "p1", title: "T", content: "", headerColor: "red", backgroundColor: "#112233" },
    ] as unknown as Pane[];
    const pane = normalizePanes(panes)[0];
    expect(pane.headerColor).toMatch(HEX);
    expect(pane.backgroundColor).toMatch(HEX);
  });

  it("applies title and content fallbacks", () => {
    const panes = [
      { id: "p1", title: "" },
      { id: "p2", content: 42 },
    ] as unknown as Pane[];
    const result = normalizePanes(panes);
    expect(result[0].title).toBe("New Buffer");
    expect(result[1].content).toBe("");
  });
});
