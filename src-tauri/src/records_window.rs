//! The Records window: one durable secondary window showing `records.sqlite3`
//! (records.rs reads it). There is only ever one; opening it again brings it
//! forward. It keeps its own placement in window.json beside the main window's
//! (window conventions, Placement), and it never holds the app open: when the
//! main window goes, so does this one, and activating the app brings the main
//! window back (lib.rs).

use std::{io::Write, sync::Mutex};

use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, Theme, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::{i18n, logging, theme, window_placement, window_placement::PlacementState};

pub const LABEL: &str = "records";

/// Sent to the window after each record the database stored.
pub const RECORDS_CHANGED_EVENT: &str = "records-changed";

/// Sent to the window, with the language tag, when a saved change moves the
/// interface language.
pub const LANGUAGE_EVENT: &str = "records-language";

// The designed initial size; the window's minimum is derived from its panes by
// the page itself (src/records/recordsLayout.ts).
const WIDTH: f64 = 1240.0;
const HEIGHT: f64 = 820.0;

// The busy claim for opening: two quick requests would otherwise both find no
// window and both try to build one under the same label.
static OPENING: Mutex<()> = Mutex::new(());

fn title(app: &AppHandle, language: &str) -> String {
    i18n::catalogue(language).text("records.title", &app.package_info().name)
}

fn bring_forward(window: &WebviewWindow) {
    let result = window
        .unminimize()
        .and_then(|()| window.show())
        .and_then(|()| window.set_focus());
    if let Err(error) = result {
        logging::warn(
            "records window could not be brought forward",
            json!({ "error": error.to_string() }),
        );
    }
}

/// Opens the window, or brings the open one forward. It is built hidden, takes
/// the current theme and its saved placement, and only then is shown.
pub fn open(
    app: &AppHandle,
    placements: &PlacementState,
    window_theme: Option<Theme>,
    language: &str,
) -> Result<(), String> {
    let _opening = OPENING
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some(window) = app.get_webview_window(LABEL) {
        bring_forward(&window);
        return Ok(());
    }

    let window = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("records.html".into()))
        .title(title(app, language))
        .inner_size(WIDTH, HEIGHT)
        .visible(false)
        .disable_drag_drop_handler()
        .build()
        .map_err(|error| error.to_string())?;
    if let Err(error) = theme::apply(&window, window_theme) {
        logging::warn(
            "apply window theme to records window failed",
            json!({ "error": error }),
        );
    }
    window_placement::restore(&window.as_ref().window(), placements);
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())
}

/// Closes the window together with the main window, keeping its placement, so it
/// cannot keep the app running on its own.
pub fn close_with_main(app: &AppHandle, placements: &PlacementState) {
    let Some(window) = app.get_webview_window(LABEL) else {
        return;
    };
    window_placement::capture(&window.as_ref().window(), placements);
    if let Err(error) = window.destroy() {
        logging::warn(
            "records window could not be closed with the main window",
            json!({ "error": error.to_string() }),
        );
    }
}

/// Tells the window, when it is open, that a record was stored. Runs on the
/// records writer thread after every stored row, so a failure goes to stderr
/// rather than to a record, which would signal again.
pub fn notify_changed(app: &AppHandle) {
    if app.get_webview_window(LABEL).is_none() {
        return;
    }
    if let Err(error) = app.emit_to(LABEL, RECORDS_CHANGED_EVENT, ()) {
        let _ = writeln!(
            std::io::stderr(),
            "[quickdeck] records window signal failed: {error}"
        );
    }
}

/// Follows a saved change of the interface language: the title and the page.
pub fn follow_language(app: &AppHandle, language: &'static str) -> Result<(), String> {
    let Some(window) = app.get_webview_window(LABEL) else {
        return Ok(());
    };
    window
        .set_title(&title(app, language))
        .map_err(|error| error.to_string())?;
    app.emit_to(LABEL, LANGUAGE_EVENT, language)
        .map_err(|error| error.to_string())
}
