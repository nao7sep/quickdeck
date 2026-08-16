// Validation and normalization of settings and panes.
//
// These are pure decision functions: given whatever was loaded (which may be
// partial, stale, or hand-edited) or a form draft, produce a valid in-memory
// shape. They live apart from the React provider so the load and commit paths'
// correctness can be tested without rendering anything.

import type { AppSettings, Pane } from "../types";
import { defaultSettings } from "./defaults";
import { randomPaneColor } from "../utils/paneColors";
import { singleLine } from "../utils/textCleanup";
import { ZOOM_DEFAULT, ZOOM_MAX, ZOOM_MIN } from "../utils/zoom";

// Inclusive bounds for the numeric settings. Single source of truth for the
// load-path clamp (normalizeSettings), the commit-enable check
// (isSettingsDraftValid), and the Settings form's input min/max and labels, so
// the form can never accept a value the load path would silently clamp away.
export const SETTINGS_BOUNDS = {
  editorFontSize: { min: 10, max: 32 },
  editorLineHeight: { min: 1, max: 3 },
  editorPadding: { min: 0, max: 64 },
  autosaveDelaySeconds: { min: 1, max: 60 },
  snapshotSearchPageSize: { min: 5, max: 200 },
} as const;

type BoundedKey = keyof typeof SETTINGS_BOUNDS;

export function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, value));
}

function clampSetting(value: number, key: BoundedKey): number {
  const { min, max } = SETTINGS_BOUNDS[key];
  return clampNumber(value, min, max, defaultSettings[key]);
}

function inBounds(value: number, key: BoundedKey): boolean {
  const { min, max } = SETTINGS_BOUNDS[key];
  return Number.isFinite(value) && value >= min && value <= max;
}

// Whether a Settings form draft may be committed. Gates the Save button: every
// numeric field must be finite and within SETTINGS_BOUNDS. An emptied number
// input yields 0, which is below every field's minimum and therefore correctly
// rejected. The font family may be blank — normalizeSettings supplies a fallback
// rather than blocking the commit.
export function isSettingsDraftValid(draft: AppSettings): boolean {
  return (
    inBounds(draft.editorFontSize, "editorFontSize") &&
    inBounds(draft.editorLineHeight, "editorLineHeight") &&
    inBounds(draft.editorPadding, "editorPadding") &&
    inBounds(draft.autosaveDelaySeconds, "autosaveDelaySeconds") &&
    inBounds(draft.snapshotSearchPageSize, "snapshotSearchPageSize")
  );
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function normalizeSettings(settings: AppSettings | null): AppSettings {
  if (!settings) {
    return defaultSettings;
  }

  // Build the result from known keys only, in the canonical field order.
  // Spreading the loaded object would carry hand-edited or renamed keys (e.g.
  // a stale "darkMode"/"theme") back into every save; listing fields explicitly
  // keeps config.json pinned to the current schema.
  return {
    dark: asBoolean(settings.dark, defaultSettings.dark),
    zen: asBoolean(settings.zen, defaultSettings.zen),
    topmost: asBoolean(settings.topmost, defaultSettings.topmost),
    // UI font is free text and may be blank (blank = the built-in default stack), so unlike the
    // editor font it never falls back on empty — only a non-string reverts to the default.
    uiFontFamily:
      typeof settings.uiFontFamily === "string"
        ? singleLine(settings.uiFontFamily)
        : defaultSettings.uiFontFamily,
    editorFontFamily:
      typeof settings.editorFontFamily === "string" && singleLine(settings.editorFontFamily).length > 0
        ? singleLine(settings.editorFontFamily)
        : defaultSettings.editorFontFamily,
    editorFontSize: clampSetting(settings.editorFontSize, "editorFontSize"),
    editorLineHeight: clampSetting(settings.editorLineHeight, "editorLineHeight"),
    editorPadding: clampSetting(settings.editorPadding, "editorPadding"),
    editorBold: asBoolean(settings.editorBold, defaultSettings.editorBold),
    editorItalic: asBoolean(settings.editorItalic, defaultSettings.editorItalic),
    editorUnderline: asBoolean(settings.editorUnderline, defaultSettings.editorUnderline),
    autosaveDelaySeconds: clampSetting(settings.autosaveDelaySeconds, "autosaveDelaySeconds"),
    snapshotSearchPageSize: clampSetting(settings.snapshotSearchPageSize, "snapshotSearchPageSize"),
  };
}

// The session zoom level — a view adjustment persisted in state.json, not a
// setting in config.json (persisted-store-separation conventions), so it is
// normalized apart from settings. Anything loaded (absent, hand-edited, out of
// range) lands back on a sane level.
// Wrong-typed PRESENT fields in a loaded config — the shape failures that make
// the file corrupt (storage-path conventions: a file that parses but does not
// fit its shape takes the corrupt branch, because flushing a coerced reading
// back would destroy the user's bytes on a file that never looked corrupt).
// An ABSENT field takes its default and is not an issue; an unknown key is
// dropped by the known-keys rebuild and reported by the caller's log, not
// treated as corruption (pre-release update-in-place tolerates retired keys).
export function settingsShapeIssues(loaded: unknown): string[] {
  if (loaded === null || typeof loaded !== "object" || Array.isArray(loaded)) {
    return ["config is not a JSON object"];
  }
  const source = loaded as Record<string, unknown>;
  const issues: string[] = [];
  const expect = (key: string, check: (v: unknown) => boolean, type: string) => {
    if (key in source && !check(source[key])) {
      issues.push(`${key} is not a ${type}`);
    }
  };
  const isBool = (v: unknown) => typeof v === "boolean";
  const isNum = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  const isStr = (v: unknown) => typeof v === "string";
  expect("dark", isBool, "boolean");
  expect("zen", isBool, "boolean");
  expect("topmost", isBool, "boolean");
  expect("uiFontFamily", isStr, "string");
  expect("editorFontFamily", isStr, "string");
  expect("editorFontSize", isNum, "finite number");
  expect("editorLineHeight", isNum, "finite number");
  expect("editorPadding", isNum, "finite number");
  expect("editorBold", isBool, "boolean");
  expect("editorItalic", isBool, "boolean");
  expect("editorUnderline", isBool, "boolean");
  expect("autosaveDelaySeconds", isNum, "finite number");
  expect("snapshotSearchPageSize", isNum, "finite number");
  return issues;
}

export function normalizeZoomLevel(value: unknown): number {
  return clampNumber(
    typeof value === "number" ? value : Number.NaN,
    ZOOM_MIN,
    ZOOM_MAX,
    ZOOM_DEFAULT,
  );
}

export function normalizePanes(panes: Pane[] | undefined): Pane[] {
  if (!Array.isArray(panes)) {
    return [];
  }

  const accumulatedHeaders: string[] = [];

  return panes
    .filter((pane) => typeof pane.id === "string" && pane.id.length > 0)
    .map((pane) => {
      const hasColors =
        typeof pane.headerColor === "string" &&
        /^#[0-9a-f]{6}$/i.test(pane.headerColor) &&
        typeof pane.backgroundColor === "string" &&
        /^#[0-9a-f]{6}$/i.test(pane.backgroundColor);

      const colors = hasColors
        ? { header: pane.headerColor, background: pane.backgroundColor }
        : randomPaneColor(accumulatedHeaders);

      accumulatedHeaders.push(colors.header);

      return {
        id: pane.id,
        title: typeof pane.title === "string" && pane.title.length > 0 ? pane.title : "New Buffer",
        content: typeof pane.content === "string" ? pane.content : "",
        headerColor: colors.header,
        backgroundColor: colors.background,
      };
    });
}
