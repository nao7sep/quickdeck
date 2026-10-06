// Validation and normalization of settings and panes.
//
// These are pure decision functions: given whatever was loaded (which may be
// partial, stale, or hand-edited) or a form draft, produce a valid in-memory
// shape. They live apart from the React provider so the load and commit paths'
// correctness can be tested without rendering anything.

import type { AppSettings, Pane } from "../types";
import { defaultSettings } from "./defaults";
import { singleLine } from "../utils/textCleanup";
import { normalizeLanguagePreference } from "../i18n/languages";
import { normalizeThemePreference } from "../utils/theme";
import { ZOOM_DEFAULT, ZOOM_MAX, ZOOM_MIN } from "../utils/zoom";

// Inclusive bounds for the numeric settings: the Settings form's input min/max
// and labels, and isSettingsDraftValid, which gates Save and the read of each
// set (config-sets conventions).
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

function inBounds(value: number, key: BoundedKey): boolean {
  const { min, max } = SETTINGS_BOUNDS[key];
  return Number.isFinite(value) && value >= min && value <= max;
}

// Whether a Settings form draft may be committed. Gates the Save button: every
// numeric field must be finite and within SETTINGS_BOUNDS. An emptied number
// input yields 0, which is below every field's minimum and therefore correctly
// rejected. The font families may be blank: blank uses the built-in stack.
export function isSettingsDraftValid(draft: AppSettings): boolean {
  return (
    inBounds(draft.editorFontSize, "editorFontSize") &&
    inBounds(draft.editorLineHeight, "editorLineHeight") &&
    inBounds(draft.editorPadding, "editorPadding") &&
    inBounds(draft.autosaveDelaySeconds, "autosaveDelaySeconds") &&
    inBounds(draft.snapshotSearchPageSize, "snapshotSearchPageSize")
  );
}

// Callers pass values that already passed isSettingsDraftValid; this keeps the
// canonical key order and cleans the font families (text-cleanup conventions).
export function normalizeSettings(settings: AppSettings): AppSettings {
  return {
    language: settings.language,
    theme: settings.theme,
    zen: settings.zen,
    topmost: settings.topmost,
    uiFontFamily: singleLine(settings.uiFontFamily),
    editorFontFamily: singleLine(settings.editorFontFamily),
    editorFontSize: settings.editorFontSize,
    editorLineHeight: settings.editorLineHeight,
    editorPadding: settings.editorPadding,
    editorBold: settings.editorBold,
    editorItalic: settings.editorItalic,
    editorUnderline: settings.editorUnderline,
    autosaveDelaySeconds: settings.autosaveDelaySeconds,
    snapshotSearchPageSize: settings.snapshotSearchPageSize,
  };
}

// Settings are persisted as whole sets; the editor's flat view model stays local
// to the form and renderer.
export function settingsBySet(settings: AppSettings) {
  const { editorFontFamily: family, editorFontSize: size, editorLineHeight: lineHeight,
    editorPadding: padding, editorBold: bold, editorItalic: italic,
    editorUnderline: underline, ...scalars } = settings;
  return { ...scalars, editorFont: { family, size, lineHeight, padding, bold, italic, underline } };
}

export type ConfigSets = ReturnType<typeof settingsBySet>;

function settingsFromSets({ editorFont, ...scalars }: ConfigSets): AppSettings {
  return { ...scalars, editorFontFamily: editorFont.family,
    editorFontSize: editorFont.size, editorLineHeight: editorFont.lineHeight,
    editorPadding: editorFont.padding, editorBold: editorFont.bold,
    editorItalic: editorFont.italic, editorUnderline: editorFont.underline };
}

// What config.json holds for these settings: every set that differs from its
// built-in, whole. Sets are compared after normalizeSettings, which applies the
// single-line text cleanup to the font families.
export function storedSettingsSets(settings: AppSettings): Partial<ConfigSets> {
  const builtIn = settingsBySet(defaultSettings);
  const sets = settingsBySet(normalizeSettings(settings));
  return Object.fromEntries(
    (Object.keys(sets) as (keyof ConfigSets)[])
      .filter((key) => JSON.stringify(sets[key]) !== JSON.stringify(builtIn[key]))
      .map((key) => [key, sets[key]]),
  );
}

function shapedSet(key: keyof ConfigSets, value: unknown): boolean {
  const builtIn = settingsBySet(defaultSettings)[key];
  if (key === "language") return typeof value === "string" && normalizeLanguagePreference(value) === value;
  if (key === "theme") return typeof value === "string" && normalizeThemePreference(value) === value;
  if (key === "editorFont") {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
    const source = value as Record<string, unknown>;
    return Object.entries(builtIn as ConfigSets["editorFont"]).every(([member, defaultValue]) =>
      typeof source[member] === typeof defaultValue);
  }
  return typeof value === typeof builtIn;
}

// A set is read only when it passes the check Save applies (config-sets
// conventions), judged with every other set at its built-in.
function validSet(key: keyof ConfigSets, value: unknown): boolean {
  return shapedSet(key, value) &&
    isSettingsDraftValid(settingsFromSets({ ...settingsBySet(defaultSettings), [key]: value }));
}

export function settingsShapeIssues(loaded: unknown): string[] {
  if (loaded === null || typeof loaded !== "object" || Array.isArray(loaded)) {
    return ["config is not a JSON object"];
  }
  const source = loaded as Record<string, unknown>;
  return (Object.keys(settingsBySet(defaultSettings)) as (keyof ConfigSets)[])
    .filter((key) => key in source && !validSet(key, source[key]))
    .map((key) => `${key} is invalid`);
}

export function readSettingsSets(loaded: unknown): AppSettings {
  const source = loaded !== null && typeof loaded === "object" && !Array.isArray(loaded)
    ? loaded as Record<string, unknown> : {};
  const sets = settingsBySet(defaultSettings);
  for (const key of Object.keys(sets) as (keyof ConfigSets)[]) {
    if (key in source && validSet(key, source[key])) {
      Object.assign(sets, { [key]: source[key] });
    }
  }
  return normalizeSettings(settingsFromSets(sets));
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

// Shape failures in a loaded panes.json — the store that carries the user's TEXT, so a
// failure here halts rather than quarantines (storage-path conventions). Every field
// this build writes must be there: a pane without its id, title, content or colours
// is damaged, never filled in, because the close path saves unconditionally and a
// launch and a quit would write the filled-in reading back over the user's text.
export function panesShapeIssues(loaded: unknown): string[] {
  if (loaded === null || typeof loaded !== "object" || Array.isArray(loaded)) {
    return ["panes file is not a JSON object"];
  }
  const source = loaded as Record<string, unknown>;
  if (!Array.isArray(source.panes)) {
    return ["panes is not an array"];
  }
  const issues: string[] = [];
  const seenIds = new Set<string>();
  source.panes.forEach((pane, index) => {
    if (pane === null || typeof pane !== "object" || Array.isArray(pane)) {
      issues.push(`pane ${index} is not an object`);
      return;
    }
    const entry = pane as Record<string, unknown>;
    if (typeof entry.id !== "string" || entry.id.length === 0) {
      issues.push(`pane ${index} has no usable id`);
    } else if (seenIds.has(entry.id)) {
      issues.push(`pane ${index} duplicates id ${JSON.stringify(entry.id)}`);
    } else {
      seenIds.add(entry.id);
    }
    for (const key of ["title", "content"]) {
      if (typeof entry[key] !== "string") {
        issues.push(`pane ${index} has no string ${key}`);
      }
    }
    for (const key of ["headerColor", "backgroundColor"]) {
      const color = entry[key];
      if (typeof color !== "string" || !HEX_COLOR.test(color)) {
        issues.push(`pane ${index} has no valid ${key}`);
      }
    }
  });
  return issues;
}

// The session zoom level — a view adjustment persisted in state.json, not a
// setting in config.json (persisted-store-separation conventions), so it is
// normalized apart from settings. Anything loaded (absent, hand-edited, out of
// range) lands back on a sane level.
export function normalizeZoomLevel(value: unknown): number {
  return clampNumber(
    typeof value === "number" ? value : Number.NaN,
    ZOOM_MIN,
    ZOOM_MAX,
    ZOOM_DEFAULT,
  );
}

// Panes that passed panesShapeIssues, as the editor holds them. A title the user
// cleared stays empty; the default name is only shown in its place.
export function normalizePanes(panes: Pane[]): Pane[] {
  return panes.map((pane) => ({
    id: pane.id,
    title: pane.title,
    content: pane.content,
    headerColor: pane.headerColor,
    backgroundColor: pane.backgroundColor,
  }));
}
