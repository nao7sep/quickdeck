import { listen } from "@tauri-apps/api/event";

// The native menu's About item asks the main window for its own About dialog,
// which opens inside the window and so stays above it even when it is kept on
// top; the system About panel would open behind it (src-tauri/src/menu.rs).
const ABOUT_REQUESTED_EVENT = "about-requested";

export function onAboutRequested(listener: () => void): Promise<() => void> {
  return listen(ABOUT_REQUESTED_EVENT, () => listener());
}
