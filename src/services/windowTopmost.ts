import { invoke } from "@tauri-apps/api/core";

// Keeps the main window on top or not; the Rust core keeps an open Records
// window at the same level, so a window opened from main can stay above it
// (window conventions).
export function applyTopmost(topmost: boolean): Promise<void> {
  return invoke("apply_topmost", { topmost });
}
