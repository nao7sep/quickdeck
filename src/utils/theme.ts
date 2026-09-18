import type { ThemePreference } from "../types";

// The native window theme is the single theme authority (app-chrome
// conventions, Theme). The Rust core applies the saved choice before the window
// is shown and on every Save (src-tauri/src/theme.rs, whose window_theme_for
// follows the same rule as normalizeThemePreference), and the page follows the
// window through prefers-color-scheme, so nothing here resolves System against
// the OS.

export const THEME_PREFERENCES: ReadonlyArray<{ value: ThemePreference; label: string }> = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

// A missing, retired, or hand-edited value follows the OS.
export function normalizeThemePreference(value: unknown): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}
