import { describe, expect, it } from "vitest";
import {
  NUMBER_SETTING_KEYS,
  SETTINGS_BOUNDS,
  clampNumber,
  isSettingsDraftValid,
  normalizeSettings,
  normalizeZoomLevel,
  parseNumberSetting,
  settingsShapeIssues,
  settingsBySet,
  readSettingsSets,
  storedSettingsSets,
} from "../../src/state/normalize";
import { DEFAULT_EDITOR_FONT_FAMILY_STACK, defaultSettings } from "../../src/state/defaults";
import { ZOOM_DEFAULT, ZOOM_MAX, ZOOM_MIN } from "../../src/utils/zoom";

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
  it("emits keys in canonical order (language, theme, zen, topmost first)", () => {
    expect(Object.keys(normalizeSettings({ ...defaultSettings }))).toEqual([
      "language",
      "theme",
      "zen",
      "topmost",
      "uiFontFamily",
      "displayZone",
      "editorFontFamily",
      "editorFontSize",
      "editorLineHeight",
      "editorPadding",
      "editorBold",
      "editorItalic",
      "editorUnderline",
      "autosaveDelaySeconds",
      "snapshotPageSize",
    ]);
  });

  it("preserves a chosen font family and built-in stack", () => {
    expect(defaultSettings.editorFontFamily).toBe("");
    expect(normalizeSettings({ ...defaultSettings, editorFontFamily: "Courier New" }).editorFontFamily).toBe("Courier New");
    expect(
      normalizeSettings({ ...defaultSettings, editorFontFamily: DEFAULT_EDITOR_FONT_FAMILY_STACK })
        .editorFontFamily,
    ).toBe(DEFAULT_EDITOR_FONT_FAMILY_STACK);
  });

  it("trims both font families, keeping a blank one blank", () => {
    expect(normalizeSettings({ ...defaultSettings, editorFontFamily: "  Menlo  " }).editorFontFamily).toBe("Menlo");
    expect(normalizeSettings({ ...defaultSettings, editorFontFamily: "   " }).editorFontFamily).toBe("");
    expect(normalizeSettings({ ...defaultSettings, uiFontFamily: "   " }).uiFontFamily).toBe("");
    expect(normalizeSettings({ ...defaultSettings, uiFontFamily: "  Iosevka  " }).uiFontFamily).toBe("Iosevka");
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

describe("parseNumberSetting", () => {
  it("reads a plain decimal in range", () => {
    expect(parseNumberSetting("16", "editorFontSize")).toBe(16);
    expect(parseNumberSetting(" 0 ", "editorPadding")).toBe(0);
    expect(parseNumberSetting("1.37", "editorLineHeight")).toBe(1.37);
    expect(parseNumberSetting("+2", "editorLineHeight")).toBe(2);
    expect(parseNumberSetting("2.", "editorLineHeight")).toBe(2);
  });

  it("gives nothing for empty text, a fraction where a whole number is needed, or a value out of range", () => {
    expect(parseNumberSetting("", "editorPadding")).toBeNull();
    expect(parseNumberSetting("   ", "editorFontSize")).toBeNull();
    expect(parseNumberSetting("16.5", "editorFontSize")).toBeNull();
    expect(parseNumberSetting("9", "editorFontSize")).toBeNull();
    expect(parseNumberSetting("3.01", "editorLineHeight")).toBeNull();
    expect(parseNumberSetting("201", "snapshotPageSize")).toBeNull();
  });

  it("gives nothing for text Number() would read but a person would not type as a decimal", () => {
    for (const text of ["1e1", "0x10", "Infinity", "12px", "1,5", "--2"]) {
      expect(parseNumberSetting(text, "autosaveDelaySeconds"), text).toBeNull();
    }
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
        snapshotPageSize: SETTINGS_BOUNDS.snapshotPageSize.min,
      }),
    ).toBe(true);
  });

  it("rejects values just outside the bounds", () => {
    expect(isSettingsDraftValid({ ...defaultSettings, editorFontSize: 9 })).toBe(false);
    expect(isSettingsDraftValid({ ...defaultSettings, editorFontSize: 33 })).toBe(false);
    expect(isSettingsDraftValid({ ...defaultSettings, snapshotPageSize: 4 })).toBe(false);
  });

  it("rejects a fraction in every whole-number setting, and takes any line height in range", () => {
    for (const key of NUMBER_SETTING_KEYS.filter((name) => SETTINGS_BOUNDS[name].whole)) {
      expect(isSettingsDraftValid({ ...defaultSettings, [key]: SETTINGS_BOUNDS[key].min + 0.5 }), key).toBe(false);
    }
    expect(isSettingsDraftValid({ ...defaultSettings, editorLineHeight: 1.37 })).toBe(true);
  });

  it("rejects non-finite values", () => {
    expect(isSettingsDraftValid({ ...defaultSettings, autosaveDelaySeconds: Number.NaN })).toBe(false);
    expect(
      isSettingsDraftValid({ ...defaultSettings, snapshotPageSize: Number.POSITIVE_INFINITY }),
    ).toBe(false);
  });
});

// Save (isSettingsDraftValid) and the read of config.json accept the same
// values, so a launch reads exactly what the form could have saved.
describe("SETTINGS_BOUNDS agreement between Save and read", () => {
  const keys = Object.keys(SETTINGS_BOUNDS) as (keyof typeof SETTINGS_BOUNDS)[];

  for (const key of keys) {
    const { min, max } = SETTINGS_BOUNDS[key];

    it(`saves and reads ${key} at its max`, () => {
      const draft = { ...defaultSettings, [key]: max };
      expect(isSettingsDraftValid(draft)).toBe(true);
      expect(readSettingsSets(storedSettingsSets(draft))[key]).toBe(max);
    });

    it(`rejects ${key} above its max and reads that set as its built-in`, () => {
      const draft = { ...defaultSettings, [key]: max + 1 };
      expect(isSettingsDraftValid(draft)).toBe(false);
      expect(readSettingsSets(storedSettingsSets(draft))).toEqual(defaultSettings);
    });

    it(`rejects ${key} below its min and reads that set as its built-in`, () => {
      const draft = { ...defaultSettings, [key]: min - 1 };
      expect(isSettingsDraftValid(draft)).toBe(false);
      expect(readSettingsSets(storedSettingsSets(draft))).toEqual(defaultSettings);
    });
  }
});

describe("snapshot page-size settings boundary", () => {
  it("reports a fractional config value and uses its built-in while preserving other settings", () => {
    const config = { snapshotPageSize: 5.5, zen: !defaultSettings.zen };
    expect(settingsShapeIssues(config)).toEqual(["snapshotPageSize is invalid"]);
    expect(readSettingsSets(config)).toEqual({ ...defaultSettings, zen: config.zen });
  });

  it("saves and reads every integer from 5 through 200", () => {
    for (let snapshotPageSize = 5; snapshotPageSize <= 200; snapshotPageSize += 1) {
      const draft = { ...defaultSettings, snapshotPageSize };
      expect(isSettingsDraftValid(draft)).toBe(true);
      expect(settingsShapeIssues({ snapshotPageSize })).toEqual([]);
      expect(readSettingsSets(storedSettingsSets(draft)).snapshotPageSize).toBe(snapshotPageSize);
    }
  });

  it("retains zero editor padding through a settings save and read", () => {
    const draft = { ...defaultSettings, editorPadding: 0 };
    expect(readSettingsSets(storedSettingsSets(draft)).editorPadding).toBe(0);
  });
});

describe("settingsShapeIssues", () => {
  it("passes a clean config and one with absent fields", () => {
    expect(settingsShapeIssues({ ...defaultSettings })).toEqual([]);
    // Absent fields take their defaults — never a shape failure.
    expect(settingsShapeIssues({ zen: true })).toEqual([]);
  });

  it("flags wrong-typed and out-of-range present sets", () => {
    expect(settingsShapeIssues({ ...defaultSettings, theme: true })).toEqual(["theme is invalid"]);
    // A zone is System or one from the platform's list, never a typed abbreviation.
    expect(settingsShapeIssues({ displayZone: "Asia/Tokyo" })).toEqual([]);
    expect(settingsShapeIssues({ displayZone: "JST" })).toEqual(["displayZone is invalid"]);
    expect(settingsShapeIssues({ autosaveDelaySeconds: 0 })).toEqual(["autosaveDelaySeconds is invalid"]);
    expect(settingsShapeIssues({ ...defaultSettings, editorFont: { size: "14" } })).toContain(
      "editorFont is invalid",
    );
    expect(settingsShapeIssues("not an object")).toEqual(["config is not a JSON object"]);
    expect(settingsShapeIssues(null)).toEqual(["config is not a JSON object"]);
  });

  it("ignores unknown keys — dropped by the known-keys rebuild, not corruption", () => {
    expect(settingsShapeIssues({ ...defaultSettings, zoomLevel: 1.2, retired: true })).toEqual([]);
  });
});

describe("config sets", () => {
  it("uses built-ins for every absent set and rejects an incomplete cluster whole", () => {
    expect(readSettingsSets({ zen: true })).toEqual({ ...defaultSettings, zen: true });
    expect(readSettingsSets({ editorFont: { size: 20 }, theme: "sepia" })).toEqual(defaultSettings);
  });
  it("stores nothing for the built-ins, which are kept in cleaned form", () => {
    expect(normalizeSettings(defaultSettings)).toEqual(defaultSettings);
    expect(storedSettingsSets(defaultSettings)).toEqual({});
  });
  it("stores the complete editor cluster when one member differs", () => {
    const next = { ...defaultSettings, editorBold: true };
    expect(storedSettingsSets(next)).toEqual({ editorFont: settingsBySet(next).editorFont });
  });
  it("stores every differing set, untouched ones included, and drops a set changed back", () => {
    const changed = { ...defaultSettings, zen: true, topmost: true };
    expect(storedSettingsSets(changed)).toEqual({ zen: true, topmost: true });
    expect(storedSettingsSets({ ...changed, zen: false })).toEqual({ topmost: true });
  });
  it("reads a set with any member out of range as its built-in, never clamped", () => {
    const editorFont = { ...settingsBySet(defaultSettings).editorFont, bold: true, size: 99 };
    expect(readSettingsSets({ editorFont, zen: true })).toEqual({ ...defaultSettings, zen: true });
  });
  it("compares text after single-line cleanup", () => {
    expect(storedSettingsSets({ ...defaultSettings, uiFontFamily: " \n " })).toEqual({});
    expect(storedSettingsSets({ ...defaultSettings, uiFontFamily: " Inter\n" })).toEqual({
      uiFontFamily: "Inter",
    });
  });
});
