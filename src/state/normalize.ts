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
import { ZOOM_MAX, ZOOM_MIN } from "../utils/zoom";

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
    zoomLevel: clampNumber(settings.zoomLevel, ZOOM_MIN, ZOOM_MAX, defaultSettings.zoomLevel),
  };
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
