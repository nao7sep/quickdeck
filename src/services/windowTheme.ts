import { invoke } from "@tauri-apps/api/core";
import type { ThemePreference } from "../types";

// The Rust core owns the native theme: it maps the preference to the window
// theme and sets the matching window background in one step (src-tauri/src/theme.rs).
export function applyWindowTheme(preference: ThemePreference): Promise<void> {
  return invoke<void>("apply_theme", { preference });
}
