import { describe, expect, it } from "vitest";
import {
  SETTINGS_BOUNDS,
  clampNumber,
  isSettingsDraftValid,
  normalizePanes,
  normalizeSettings,
  normalizeZoomLevel,
  panesShapeIssues,
  settingsShapeIssues,
  settingsBySet,
  readSettingsSets,
  storedSettingsSets,
} from "../../src/state/normalize";
import { DEFAULT_EDITOR_FONT_FAMILY_STACK, defaultSettings } from "../../src/state/defaults";
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

  it("falls back when a numeric setting is not finite", () => {
    const result = normalizeSettings({ ...defaultSettings, editorFontSize: Number.NaN });
    expect(result.editorFontSize).toBe(defaultSettings.editorFontSize);
  });

  it("drops unknown keys not in the schema", () => {
    const result = normalizeSettings({
      ...defaultSettings,
      dark: true,
      darkMode: true,
      uiZoomPercent: 69,
    } as unknown as AppSettings);
    expect(result).not.toHaveProperty("dark");
    expect(result).not.toHaveProperty("darkMode");
    expect(result).not.toHaveProperty("uiZoomPercent");
    expect(Object.keys(result).sort()).toEqual(Object.keys(defaultSettings).sort());
  });

  it("emits keys in canonical order (language, theme, zen, topmost first)", () => {
    expect(Object.keys(normalizeSettings({ ...defaultSettings }))).toEqual([
      "language",
      "theme",
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
    expect(normalizeSettings({ ...defaultSettings, zen: true }).zen).toBe(true);
    const bad = normalizeSettings({
      ...defaultSettings,
      zen: "yes",
      topmost: 1,
    } as unknown as AppSettings);
    expect(bad.zen).toBe(defaultSettings.zen);
    expect(bad.topmost).toBe(defaultSettings.topmost);
  });

  it("defaults the theme to System and keeps a saved Light or Dark", () => {
    expect(defaultSettings.theme).toBe("system");
    expect(normalizeSettings({ ...defaultSettings, theme: "dark" }).theme).toBe("dark");
    const retired = normalizeSettings({ ...defaultSettings, theme: "sepia" } as unknown as AppSettings);
    expect(retired.theme).toBe("system");
    const absent = { ...defaultSettings } as Partial<AppSettings>;
    delete absent.theme;
    expect(normalizeSettings(absent as AppSettings).theme).toBe("system");
  });

  it("preserves a chosen monospace font", () => {
    expect(normalizeSettings({ ...defaultSettings, editorFontFamily: "monospace" }).editorFontFamily).toBe(
      "monospace",
    );
    expect(normalizeSettings({ ...defaultSettings, editorFontFamily: "Courier New" }).editorFontFamily).toBe("Courier New");
  });

  it("preserves a chosen built-in stack", () => {
    expect(defaultSettings.editorFontFamily).toBe("");
    expect(
      normalizeSettings({ ...defaultSettings, editorFontFamily: DEFAULT_EDITOR_FONT_FAMILY_STACK })
        .editorFontFamily,
    ).toBe(DEFAULT_EDITOR_FONT_FAMILY_STACK);
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

  it("coerces the style toggles", () => {
    const r = normalizeSettings({
      ...defaultSettings,
      editorBold: true,
      editorItalic: "yes" as unknown as boolean,
    });
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

describe("normalizePanes", () => {
  it("returns an empty array for non-array input", () => {
    expect(normalizePanes(undefined, "New Buffer")).toEqual([]);
    expect(normalizePanes("nope" as unknown as Pane[], "New Buffer")).toEqual([]);
  });

  it("drops panes without a usable id", () => {
    const panes = [
      { id: "", title: "x", content: "", headerColor: "#aabbcc", backgroundColor: "#112233" },
      { title: "no id" },
    ] as unknown as Pane[];
    expect(normalizePanes(panes, "New Buffer")).toEqual([]);
  });

  it("preserves valid colors and content", () => {
    const panes = [
      { id: "p1", title: "Title", content: "body", headerColor: "#aabbcc", backgroundColor: "#112233" },
    ] as Pane[];
    expect(normalizePanes(panes, "New Buffer")[0]).toEqual({
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
    const pane = normalizePanes(panes, "New Buffer")[0];
    expect(pane.headerColor).toMatch(HEX);
    expect(pane.backgroundColor).toMatch(HEX);
  });

  it("applies the given default title and the content fallback", () => {
    const panes = [
      { id: "p1", title: "" },
      { id: "p2", content: 42 },
    ] as unknown as Pane[];
    const result = normalizePanes(panes, "New Buffer");
    expect(result[0].title).toBe("New Buffer");
    expect(result[1].content).toBe("");
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
    expect(settingsShapeIssues({ autosaveDelaySeconds: 0 })).toEqual(["autosaveDelaySeconds is invalid"]);
    // The retired "dark" key is an unknown key, dropped rather than treated as corruption.
    expect(settingsShapeIssues({ ...defaultSettings, dark: true })).toEqual([]);
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

describe("panesShapeIssues", () => {
  const pane = { id: "a", title: "T", content: "body", headerColor: "#112233", backgroundColor: "#445566" };

  it("passes a sound store and an absent panes key (first run)", () => {
    expect(panesShapeIssues({ version: 1, panes: [pane] })).toEqual([]);
    expect(panesShapeIssues({ version: 1 })).toEqual([]);
  });

  it("flags a pane with no usable id — normalizePanes would silently DROP it", () => {
    // The close path saves unconditionally, so without this gate launching and
    // quitting would write the dropped pane out of existence.
    expect(panesShapeIssues({ panes: [pane, { ...pane, id: "" }] })).toEqual([
      "pane 1 has no usable id",
    ]);
    expect(panesShapeIssues({ panes: [{ ...pane, id: 42 }] })).toEqual(["pane 0 has no usable id"]);
  });

  it("flags duplicate pane ids before React state and snapshots can alias them", () => {
    expect(panesShapeIssues({ panes: [pane, { ...pane, title: "Other" }] })).toEqual([
      'pane 1 duplicates id "a"',
    ]);
  });

  it("flags a non-string body — normalizePanes would silently blank it", () => {
    expect(panesShapeIssues({ panes: [{ ...pane, content: 123 }] })).toEqual([
      "pane 0 has a non-string content",
    ]);
  });

  it("flags a non-array panes and a non-object root", () => {
    expect(panesShapeIssues({ panes: "nope" })).toEqual(["panes is not an array"]);
    expect(panesShapeIssues([])).toEqual(["panes file is not a JSON object"]);
    expect(panesShapeIssues(null)).toEqual(["panes file is not a JSON object"]);
  });

  it("flags a malformed schema version", () => {
    expect(panesShapeIssues({ version: "2", panes: [pane] })).toEqual([
      "version is not a finite number",
    ]);
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
