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
  it("keeps every field of a sound pane", () => {
    const panes = [
      { id: "p1", title: "Title", content: "body", headerColor: "#aabbcc", backgroundColor: "#112233" },
    ];
    expect(normalizePanes(panes, "New Buffer")).toEqual(panes);
  });

  it("shows the default title for a pane whose title was cleared", () => {
    const panes = [
      { id: "p1", title: "", content: "", headerColor: "#aabbcc", backgroundColor: "#112233" },
    ];
    expect(normalizePanes(panes, "New Buffer")[0].title).toBe("New Buffer");
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

  it("passes a sound store, an empty title included", () => {
    expect(panesShapeIssues({ panes: [pane, { ...pane, id: "b", title: "" }] })).toEqual([]);
  });

  it("flags a store without its panes", () => {
    expect(panesShapeIssues({})).toEqual(["panes is not an array"]);
  });

  it("flags a pane missing a field this build always writes, never filling it in", () => {
    const { title, ...untitled } = pane;
    const { headerColor, ...uncoloured } = pane;
    void title;
    void headerColor;
    expect(panesShapeIssues({ panes: [untitled] })).toEqual(["pane 0 has no string title"]);
    expect(panesShapeIssues({ panes: [uncoloured] })).toEqual(["pane 0 has no valid headerColor"]);
    expect(panesShapeIssues({ panes: [{ ...pane, backgroundColor: "red" }] })).toEqual([
      "pane 0 has no valid backgroundColor",
    ]);
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

  it("flags a non-string body", () => {
    expect(panesShapeIssues({ panes: [{ ...pane, content: 123 }] })).toEqual([
      "pane 0 has no string content",
    ]);
  });

  it("flags a non-array panes and a non-object root", () => {
    expect(panesShapeIssues({ panes: "nope" })).toEqual(["panes is not an array"]);
    expect(panesShapeIssues([])).toEqual(["panes file is not a JSON object"]);
    expect(panesShapeIssues(null)).toEqual(["panes file is not a JSON object"]);
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
