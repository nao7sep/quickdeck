// Validation and normalization of persisted state read off disk.
//
// These are pure decision functions: given whatever was loaded (which may be
// partial, stale, or hand-edited), produce a valid in-memory shape. They live
// apart from the React provider so the load path's correctness can be tested
// without rendering anything.

import type { AppSettings, Pane } from "../types";
import { defaultSettings } from "./defaults";
import { randomPaneColor } from "../utils/paneColors";

export function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, value));
}

export function normalizeSettings(settings: AppSettings | null): AppSettings {
  if (!settings) {
    return defaultSettings;
  }

  return {
    ...defaultSettings,
    ...settings,
    editorFontSize: clampNumber(settings.editorFontSize, 10, 32, defaultSettings.editorFontSize),
    autosaveDelaySeconds: clampNumber(settings.autosaveDelaySeconds, 1, 60, defaultSettings.autosaveDelaySeconds),
    snapshotSearchPageSize: clampNumber(
      settings.snapshotSearchPageSize,
      5,
      200,
      defaultSettings.snapshotSearchPageSize,
    ),
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
