// Validation and normalization of settings and view preferences.
//
// These are pure decision functions: given whatever was loaded (which may be
// partial, stale, or hand-edited) or a form draft, produce a valid in-memory
// shape. They live apart from the React provider so the load and commit paths'
// correctness can be tested without rendering anything.

import type { AppSettings } from "../types";
import { defaultSettings } from "./defaults";
import { singleLine } from "../utils/textCleanup";
import { normalizeLanguagePreference } from "../i18n/languages";
import { normalizeThemePreference } from "../utils/theme";
import { isDisplayZone } from "../utils/timeZone";
import { ZOOM_DEFAULT, ZOOM_MAX, ZOOM_MIN } from "../utils/zoom";

// The numeric settings' accepted values: inclusive bounds, and whether only a
// whole number is accepted. The Settings form's errors and Save, the read of
// each set (config-sets conventions) and the core's config save all accept
// exactly these (number-field conventions).
export const SETTINGS_BOUNDS = {
  editorFontSize: { min: 10, max: 32, whole: true },
  editorLineHeight: { min: 1, max: 3, whole: false },
  editorPadding: { min: 0, max: 64, whole: true },
  autosaveDelaySeconds: { min: 1, max: 60, whole: true },
  snapshotPageSize: { min: 5, max: 200, whole: true },
} as const;

export type NumberSettingKey = keyof typeof SETTINGS_BOUNDS;

export const NUMBER_SETTING_KEYS = Object.keys(SETTINGS_BOUNDS) as NumberSettingKey[];

export function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, value));
}

function accepted(value: number, key: NumberSettingKey): boolean {
  const { min, max, whole } = SETTINGS_BOUNDS[key];
  return Number.isFinite(value) && (!whole || Number.isInteger(value)) && value >= min && value <= max;
}

// A plain decimal as typed: no exponent, hex, Infinity or empty text, which
// Number() would otherwise read.
const DECIMAL = /^\s*[+-]?(\d+(\.\d*)?|\.\d+)\s*$/;

// The value a Settings number field's text gives, or null while the text is not
// an accepted value; the field keeps the text either way.
export function parseNumberSetting(text: string, key: NumberSettingKey): number | null {
  if (!DECIMAL.test(text)) return null;
  const value = Number(text);
  return accepted(value, key) ? value : null;
}

// Whether a set of settings may be committed or read: every numeric setting is
// an accepted value. The font families may be blank: blank uses the built-in
// stack.
export function isSettingsDraftValid(draft: AppSettings): boolean {
  return NUMBER_SETTING_KEYS.every((key) => accepted(draft[key], key));
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
    displayZone: settings.displayZone,
    editorFontFamily: singleLine(settings.editorFontFamily),
    editorFontSize: settings.editorFontSize,
    editorLineHeight: settings.editorLineHeight,
    editorPadding: settings.editorPadding,
    editorBold: settings.editorBold,
    editorItalic: settings.editorItalic,
    editorUnderline: settings.editorUnderline,
    autosaveDelaySeconds: settings.autosaveDelaySeconds,
    snapshotPageSize: settings.snapshotPageSize,
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
  if (key === "displayZone") return isDisplayZone(value);
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

// The sets config.json holds that could not be read, as they were. They run on
// their built-ins and are saved back unchanged until the user changes that
// setting, so a save never drops what this build does not accept (config-sets
// conventions).
export function unreadSets(loaded: unknown): Record<string, unknown> {
  if (loaded === null || typeof loaded !== "object" || Array.isArray(loaded)) return {};
  const source = loaded as Record<string, unknown>;
  return Object.fromEntries((Object.keys(settingsBySet(defaultSettings)) as (keyof ConfigSets)[])
    .filter((key) => key in source && !validSet(key, source[key]))
    .map((key) => [key, source[key]]));
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
