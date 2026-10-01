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
import { normalizeLanguagePreference } from "../i18n/languages";
import { normalizeThemePreference } from "../utils/theme";
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

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function normalizeSettings(settings: AppSettings | null): AppSettings {
  if (!settings) {
    return defaultSettings;
  }

  // Build the result from known keys only, in the canonical field order, so a
  // stray key on the input never reaches the in-memory settings.
  return {
    language: normalizeLanguagePreference(settings.language),
    theme: normalizeThemePreference(settings.theme),
    zen: asBoolean(settings.zen, defaultSettings.zen),
    topmost: asBoolean(settings.topmost, defaultSettings.topmost),
    // Both font families are free text and may be blank (blank = the built-in stack), so only a
    // non-string reverts to the default.
    uiFontFamily:
      typeof settings.uiFontFamily === "string"
        ? singleLine(settings.uiFontFamily)
        : defaultSettings.uiFontFamily,
    editorFontFamily:
      typeof settings.editorFontFamily === "string"
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

// Settings are persisted as whole sets; the editor's flat view model stays local
// to the form and renderer.
export function settingsBySet(settings: AppSettings) {
  const { editorFontFamily: family, editorFontSize: size, editorLineHeight: lineHeight,
    editorPadding: padding, editorBold: bold, editorItalic: italic,
    editorUnderline: underline, ...scalars } = settings;
  return { ...scalars, editorFont: { family, size, lineHeight, padding, bold, italic, underline } };
}

export type ConfigSets = ReturnType<typeof settingsBySet>;

export function changedSettingsSets(previous: AppSettings, next: AppSettings): Partial<ConfigSets> {
  const before = settingsBySet(previous);
  const after = settingsBySet(next);
  return Object.fromEntries(
    (Object.keys(after) as (keyof ConfigSets)[])
      .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
      .map((key) => [key, after[key]]),
  );
}

function validSet(key: keyof ConfigSets, value: unknown): boolean {
  const builtIn = settingsBySet(defaultSettings)[key];
  if (key === "language") return typeof value === "string" && normalizeLanguagePreference(value) === value;
  if (key === "theme") return typeof value === "string" && normalizeThemePreference(value) === value;
  if (key === "editorFont") {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
    const source = value as Record<string, unknown>;
    return Object.entries(builtIn as ConfigSets["editorFont"]).every(([member, defaultValue]) =>
      typeof source[member] === typeof defaultValue &&
      (typeof defaultValue !== "number" || Number.isFinite(source[member])));
  }
  return typeof value === typeof builtIn && (typeof builtIn !== "number" || Number.isFinite(value));
}

export function settingsShapeIssues(loaded: unknown): string[] {
  if (loaded === null || typeof loaded !== "object" || Array.isArray(loaded)) {
    return ["config is not a JSON object"];
  }
  const source = loaded as Record<string, unknown>;
  return (Object.keys(settingsBySet(defaultSettings)) as (keyof ConfigSets)[])
    .filter((key) => key in source && !validSet(key, source[key]))
    .map((key) => `${key} has an invalid shape`);
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
  const { editorFont, ...scalars } = sets;
  return normalizeSettings({ ...scalars, editorFontFamily: editorFont.family,
    editorFontSize: editorFont.size, editorLineHeight: editorFont.lineHeight,
    editorPadding: editorFont.padding, editorBold: editorFont.bold,
    editorItalic: editorFont.italic, editorUnderline: editorFont.underline });
}

// Shape failures in a loaded panes.json — the store that carries the user's TEXT, so a
// failure here halts rather than quarantines (storage-path conventions). normalizePanes
// below is deliberately lossy: it DROPS an entry with no usable id and coerces a
// non-string body to "". That is right for a value already known to be sound, and
// catastrophic for one that is not — the close path saves unconditionally, so a launch
// and a quit is enough to write the lossy reading back over the user's text. This gate
// runs first so a damaged store reaches the halt branch instead.
export function panesShapeIssues(loaded: unknown): string[] {
  if (loaded === null || typeof loaded !== "object" || Array.isArray(loaded)) {
    return ["panes file is not a JSON object"];
  }
  const source = loaded as Record<string, unknown>;
  if ("version" in source && (typeof source.version !== "number" || !Number.isFinite(source.version))) {
    return ["version is not a finite number"];
  }
  if (!("panes" in source)) {
    // Absent is the first-run case, not corruption: the default pane is created.
    return [];
  }
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
    if ("content" in entry && typeof entry.content !== "string") {
      issues.push(`pane ${index} has a non-string content`);
    }
    if ("title" in entry && typeof entry.title !== "string") {
      issues.push(`pane ${index} has a non-string title`);
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

// `defaultTitle` is the localized name given to a pane whose title is missing.
export function normalizePanes(panes: Pane[] | undefined, defaultTitle: string): Pane[] {
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
        title: typeof pane.title === "string" && pane.title.length > 0 ? pane.title : defaultTitle,
        content: typeof pane.content === "string" ? pane.content : "",
        headerColor: colors.header,
        backgroundColor: colors.background,
      };
    });
}
