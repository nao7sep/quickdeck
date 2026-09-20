pub mod backup_store;
mod i18n;
mod instance_owner;
mod logging;
mod menu;
mod nanoid;
mod paths;
pub mod storage;
pub mod theme;
pub mod window_placement;

use serde_json::{json, Map, Value as JsonValue};
use storage::{
    LoadedAppData, SnapshotInput, SnapshotListResult, SnapshotWriteResult,
};
use i18n::LanguageState;
use menu::SAFE_QUIT_MENU_ID;
use tauri::{AppHandle, Manager, RunEvent, State};

#[tauri::command]
fn load_app_data(app: AppHandle, language: State<LanguageState>) -> Result<LoadedAppData, String> {
    logging::boundary(
        "load_app_data",
        json!({}),
        || {
            // The frontend gates its debug logging on this resolved flag.
            storage::load_app_data(&app).map(|mut data| {
                data.debug_enabled = logging::debug_enabled();
                data.system_language = language.system_language.to_string();
                data.system_locale = language.system_locale.clone();
                data
            })
        },
        |data| {
            json!({
                "hasConfig": data.config.is_some(),
                "hasState": data.state.is_some(),
                "hasPanes": data.panes.is_some(),
                "panesError": data.panes_error,
                "dataDir": data.data_dir,
                "debugEnabled": data.debug_enabled,
                "systemLanguage": data.system_language,
                "systemLocale": data.system_locale,
            })
        },
    )
}

#[tauri::command]
fn apply_theme(window: tauri::WebviewWindow, preference: String) -> Result<(), String> {
    logging::boundary(
        "apply_theme",
        json!({ "preference": preference }),
        || theme::apply(&window, theme::window_theme_for(&preference)),
        |_| json!({}),
    )
}

// Rebuilds the native menu in the interface language after a change is saved.
// The frontend sends the resolved language (System already resolved), so only a
// supported tag is accepted.
#[tauri::command]
fn apply_language(
    app: AppHandle,
    state: State<LanguageState>,
    language: String,
) -> Result<(), String> {
    logging::boundary(
        "apply_language",
        json!({ "language": language }),
        || {
            let language = i18n::normalize_preference(Some(&language))
                .ok_or_else(|| format!("unsupported language {language:?}"))?;
            if state.current() == language {
                return Ok(());
            }
            #[cfg(any(target_os = "macos", target_os = "windows"))]
            {
                let menu = menu::build(&app, language).map_err(|error| error.to_string())?;
                app.set_menu(menu).map_err(|error| error.to_string())?;
            }
            #[cfg(not(any(target_os = "macos", target_os = "windows")))]
            let _ = &app;
            state.set_current(language);
            Ok(())
        },
        |_| json!({}),
    )
}

#[tauri::command]
fn save_config(app: AppHandle, config: JsonValue) -> Result<(), String> {
    logging::boundary(
        "save_config",
        json!({}),
        || storage::save_config(&app, config),
        |_| json!({}),
    )
}

#[tauri::command]
fn save_state(app: AppHandle, state: JsonValue) -> Result<(), String> {
    logging::boundary(
        "save_state",
        json!({}),
        || storage::save_state(&app, state),
        |_| json!({}),
    )
}

#[tauri::command]
fn save_panes(app: AppHandle, panes: JsonValue) -> Result<(), String> {
    logging::boundary(
        "save_panes",
        json!({}),
        || storage::save_panes(&app, panes),
        |_| json!({}),
    )
}

#[tauri::command]
fn quarantine_corrupt_config(app: AppHandle) -> Result<String, String> {
    logging::boundary(
        "quarantine_corrupt_config",
        json!({}),
        || storage::quarantine_corrupt_config(&app),
        |quarantined| json!({ "quarantinedTo": quarantined }),
    )
}

#[tauri::command]
fn quarantine_corrupt_panes(app: AppHandle) -> Result<String, String> {
    logging::boundary(
        "quarantine_corrupt_panes",
        json!({}),
        || storage::quarantine_corrupt_panes(&app),
        |quarantined| json!({ "quarantinedTo": quarantined }),
    )
}

#[tauri::command]
fn create_snapshot(
    app: AppHandle,
    pane_id: String,
    pane_title: String,
    trigger: String,
    content: String,
) -> Result<SnapshotWriteResult, String> {
    // Summarize, don't dump: log the content's length, never its text.
    let params = json!({ "paneId": pane_id.clone(), "trigger": trigger.clone(), "contentLen": content.len() });
    logging::boundary(
        "create_snapshot",
        params,
        move || storage::create_snapshot(&app, pane_id, pane_title, trigger, content),
        |result| json!({ "inserted": result.inserted, "id": result.id }),
    )
}

#[tauri::command]
fn create_snapshots(
    app: AppHandle,
    snapshots: Vec<SnapshotInput>,
) -> Result<Vec<SnapshotWriteResult>, String> {
    let count = snapshots.len();
    logging::boundary(
        "create_snapshots",
        json!({ "count": count }),
        move || storage::create_snapshots(&app, snapshots),
        |results| {
            json!({
                "count": results.len(),
                "inserted": results.iter().filter(|result| result.inserted).count(),
            })
        },
    )
}

#[tauri::command]
fn list_snapshots(
    app: AppHandle,
    query: String,
    limit: u32,
    offset: u32,
) -> Result<SnapshotListResult, String> {
    // The query is the user's own search text; log its length, not its content.
    let params = json!({ "queryLen": query.len(), "limit": limit, "offset": offset });
    logging::boundary(
        "list_snapshots",
        params,
        move || storage::list_snapshots(&app, query, limit, offset),
        |result| json!({ "rows": result.rows.len(), "hasMore": result.has_more }),
    )
}

// Puts a snapshot's text on the system clipboard. The text is the user's own
// writing, so only its length is logged.
#[tauri::command]
fn copy_text(text: String) -> Result<(), String> {
    logging::boundary(
        "copy_text",
        json!({ "textLen": text.len() }),
        move || {
            let mut clipboard = arboard::Clipboard::new().map_err(|error| error.to_string())?;
            clipboard.set_text(text).map_err(|error| error.to_string())
        },
        |_| json!({}),
    )
}

#[tauri::command]
fn count_snapshots(app: AppHandle) -> Result<u64, String> {
    logging::boundary(
        "count_snapshots",
        json!({}),
        || storage::count_snapshots(&app),
        |count| json!({ "count": count }),
    )
}

// Receives a structured log object from the sandboxed webview and writes it to
// the session file. The frontend stamps `time`; the Rust core owns the file.
#[tauri::command]
fn log_event(
    level: String,
    message: String,
    time: Option<String>,
    fields: Option<Map<String, JsonValue>>,
) {
    logging::log_forwarded(&level, &message, time, fields);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let placement_state = window_placement::new_state();
    let event_placement_state = placement_state.clone();
    let setup_placement_state = placement_state.clone();
    // The interface language is settled before Tauri builds the app: macOS fixes
    // AppKit's language when the application object is created.
    let language = LanguageState::detect(
        paths::data_dir_before_launch()
            .map(|dir| dir.join(storage::CONFIG_FILE_NAME))
            .as_deref(),
    );
    #[cfg(target_os = "macos")]
    i18n::align_appkit(language.current());
    let app = tauri::Builder::default()
        .manage(language)
        .plugin(instance_owner::init())
        .plugin(tauri_plugin_opener::init())
        .on_window_event(move |window, event| {
            window_placement::on_window_event(window, event, &event_placement_state);
            // Under System the OS appearance can change while the app runs; keep
            // the backing behind the page in step. (macOS reports only OS
            // changes here, which is why apply_theme sets the background itself.)
            if let tauri::WindowEvent::ThemeChanged(changed) = event {
                if let Err(error) =
                    window.set_background_color(Some(theme::window_background(*changed)))
                {
                    logging::warn(
                        "window background update failed",
                        json!({ "error": error.to_string() }),
                    );
                }
            }
        })
        .on_menu_event(|app, event| {
            if event.id() == SAFE_QUIT_MENU_ID {
                if let Some(window) = app.get_webview_window("main") {
                    if let Err(error) = window.close() {
                        logging::warn(
                            "route quit through main window failed",
                            json!({ "error": error.to_string() }),
                        );
                    }
                } else {
                    app.exit(0);
                }
            }
        })
        .setup(move |app| {
            let version = app.package_info().version.to_string();
            logging::init(app.handle(), &version);
            let main_window = app.get_webview_window("main");
            if let Some(window) = main_window.as_ref() {
                // The saved theme is applied before the window is shown so the
                // first frame and title bar already match it; the frontend
                // re-applies it on every Save.
                let saved_theme = paths::app_data_dir(app.handle()).ok().and_then(|dir| {
                    theme::read_saved_window_theme(&dir.join(storage::CONFIG_FILE_NAME))
                });
                if let Err(error) = theme::apply(window, saved_theme) {
                    logging::warn("apply saved window theme failed", json!({ "error": error }));
                }
                window_placement::restore(
                    app.handle(),
                    &window.as_ref().window(),
                    &setup_placement_state,
                );
            }
            #[cfg(any(target_os = "macos", target_os = "windows"))]
            {
                let language = app.state::<LanguageState>().current();
                let menu = menu::build(app.handle(), language)?;
                app.set_menu(menu)?;
            }
            if let Some(window) = main_window {
                window.show()?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            apply_language,
            apply_theme,
            load_app_data,
            save_config,
            save_state,
            save_panes,
            quarantine_corrupt_config,
            quarantine_corrupt_panes,
            create_snapshot,
            create_snapshots,
            list_snapshots,
            count_snapshots,
            copy_text,
            log_event,
        ])
        .build(tauri::generate_context!())
        .expect("error while running QuickDeck");

    // The shutdown line is logged here, Rust-side, rather than from the webview:
    // a forwarded log would be a fire-and-forget IPC racing the window teardown
    // and could be lost on the very clean-exit path it is meant to mark. Log it
    // exactly once (whichever exit event fires first), then flush buffered (info)
    // lines on exit — warn/error/debug already flush immediately, and the panic
    // hook flushes on a crash.
    let mut shutdown_logged = false;
    app.run(move |app, event| {
        if matches!(event, RunEvent::ExitRequested { .. }) {
            if let Some(window) = app.get_webview_window("main") {
                window_placement::capture(&window.as_ref().window(), &placement_state);
            }
        }
        let ending = matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit);
        if ending && !shutdown_logged {
            shutdown_logged = true;
            logging::log_shutdown();
        }
        if matches!(event, RunEvent::Exit) {
            window_placement::save(app, &placement_state);
            logging::flush();
        }
    });
}
