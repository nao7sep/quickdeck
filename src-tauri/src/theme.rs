//! The saved appearance choice, applied natively (app-chrome conventions,
//! Theme). The window theme is the one theme authority: it paints the title bar
//! and drives the webview's prefers-color-scheme, which the stylesheet's dark
//! block follows. It is applied before the window is first shown and again on
//! every Save, together with the window background behind the page.

use std::path::Path;

use serde_json::Value as JsonValue;
use tauri::window::Color;
use tauri::{Theme, WebviewWindow};

/// The window theme for a saved preference: `Some` for "light" or "dark",
/// `None` (follow the OS) for anything else — the same rule as the frontend's
/// normalizeThemePreference, so a missing, retired, or hand-edited value never
/// pins a theme the frontend would not.
pub fn window_theme_for(preference: &str) -> Option<Theme> {
    match preference {
        "light" => Some(Theme::Light),
        "dark" => Some(Theme::Dark),
        _ => None,
    }
}

/// The window theme saved in a config.json body; anything unparseable follows
/// the OS.
pub fn saved_window_theme(config: &str) -> Option<Theme> {
    let value: JsonValue = serde_json::from_str(config).ok()?;
    window_theme_for(value.get("theme")?.as_str()?)
}

/// Reads the saved choice without touching the file. A missing or unreadable
/// config follows the OS; recovery of a corrupt one stays with the load path.
pub fn read_saved_window_theme(config_path: &Path) -> Option<Theme> {
    let text = std::fs::read_to_string(config_path).ok()?;
    saved_window_theme(&text)
}

/// The window background behind the page — styles.css's --app-bg in each
/// theme — so the frames before the page paints and the backing exposed while
/// resizing already match.
pub fn window_background(theme: Theme) -> Color {
    match theme {
        Theme::Dark => Color(0x14, 0x14, 0x19, 0xff),
        _ => Color(0xec, 0xed, 0xf5, 0xff),
    }
}

/// Applies a window theme (`None` follows the OS) and the matching background.
pub fn apply(window: &WebviewWindow, theme: Option<Theme>) -> Result<(), String> {
    window.set_theme(theme).map_err(|error| error.to_string())?;
    let effective = match theme {
        Some(theme) => theme,
        None => window.theme().map_err(|error| error.to_string())?,
    };
    window
        .set_background_color(Some(window_background(effective)))
        .map_err(|error| error.to_string())
}
