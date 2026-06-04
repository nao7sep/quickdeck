import { describe, expect, it } from "vitest";
import { clampNumber, normalizePanes, normalizeSettings } from "../../src/state/normalize";
import { defaultSettings } from "../../src/state/defaults";
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
    expect(result.zoomLevel).toBe(defaultSettings.zoomLevel);
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
