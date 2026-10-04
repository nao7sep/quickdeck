pub mod archive;
pub mod backup_store;
mod i18n;
mod instance_owner;
mod logging;
mod menu;
mod nanoid;
mod paths;
pub mod records;
mod records_window;
pub mod storage;
pub mod theme;
pub mod window_placement;

use std::sync::Mutex;

use i18n::LanguageState;
use menu::SAFE_QUIT_MENU_ID;
use records::{RecordDetail, RecordSources, RecordsPage, RecordsQuery};
use serde::Serialize;
use serde_json::{json, Map, Value as JsonValue};
use storage::{LoadedAppData, SnapshotInput, SnapshotListResult, SnapshotWriteResult};
use tauri::{AppHandle, Manager, RunEvent, Runtime, State, Theme, WindowEvent};
use window_placement::PlacementState;

// The window theme last applied, which a Records window opened later takes too.
struct WindowTheme(Mutex<Option<Theme>>);

impl WindowTheme {
    fn get(&self) -> Option<Theme> {
        *self
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn set(&self, theme: Option<Theme>) {
        *self
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = theme;
    }
}

// Activating the app — a second launch, or the macOS Dock — brings the main
// window back, whatever the Records window is doing.
pub(crate) fn bring_main_forward<R: Runtime>(app: &AppHandle<R>) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let result = window
        .unminimize()
        .and_then(|()| window.show())
        .and_then(|()| window.set_focus());
    if let Err(error) = result {
        logging::warn(
            "main window could not be brought forward",
            json!({ "error": error.to_string() }),
        );
    }
}

// File, database and clipboard work runs on a blocking thread, per the
// PLAYBOOK's "Own the work in flight".
async fn off_main_thread<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn load_app_data(app: AppHandle) -> Result<LoadedAppData, String> {
    off_main_thread(move || {
        archive::wait_for_launch(&app.state::<archive::ArchiveSession>().launch);
        let language = app.state::<LanguageState>();
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
    })
    .await
}

// Applies the saved theme to every open window; a Records window opened later
// takes it from WindowTheme.
#[tauri::command]
fn apply_theme(
    app: AppHandle,
    window_theme: State<WindowTheme>,
    preference: String,
) -> Result<(), String> {
    logging::boundary(
        "apply_theme",
        json!({ "preference": preference }),
        || {
            let theme = theme::window_theme_for(&preference);
            window_theme.set(theme);
            app.webview_windows()
                .values()
                .try_for_each(|window| theme::apply(window, theme))
        },
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
            state.set_current(language);
            // The menu has changed, so this call succeeded; a Records window
            // that missed the change is logged rather than reported as the
            // menu's failure.
            if let Err(error) = records_window::follow_language(&app, language) {
                logging::warn(
                    "records window language update failed",
                    json!({ "error": error }),
                );
            }
            Ok(())
        },
        |_| json!({}),
    )
}

// Sets equal to the file write nothing and log nothing, so every autosave can
// send them; only an actual write crosses the logged boundary.
#[tauri::command]
async fn save_config(app: AppHandle, config: JsonValue) -> Result<(), String> {
    off_main_thread(move || {
        let data_dir = paths::app_data_dir(&app)?;
        match storage::config_to_write(&data_dir, config)? {
            Some(config) => logging::boundary(
                "save_config",
                json!({}),
                || storage::write_config(&data_dir, &config),
                |_| json!({}),
            ),
            None => Ok(()),
        }
    })
    .await
}

#[tauri::command]
async fn save_state(app: AppHandle, state: JsonValue) -> Result<(), String> {
    off_main_thread(move || {
        logging::boundary(
            "save_state",
            json!({}),
            || storage::save_state(&app, state),
            |_| json!({}),
        )
    })
    .await
}

#[tauri::command]
async fn save_panes(app: AppHandle, panes: JsonValue) -> Result<(), String> {
    off_main_thread(move || {
        logging::boundary(
            "save_panes",
            json!({}),
            || storage::save_panes(&app, panes),
            |_| json!({}),
        )
    })
    .await
}

#[tauri::command]
async fn quarantine_corrupt_panes(app: AppHandle) -> Result<String, String> {
    off_main_thread(move || {
        logging::boundary(
            "quarantine_corrupt_panes",
            json!({}),
            || storage::quarantine_corrupt_panes(&app),
            |quarantined| json!({ "quarantinedTo": quarantined }),
        )
    })
    .await
}

#[tauri::command]
async fn create_snapshot(
    app: AppHandle,
    pane_id: String,
    pane_title: String,
    trigger: String,
    content: String,
) -> Result<SnapshotWriteResult, String> {
    off_main_thread(move || {
        // Summarize, don't dump: log the content's length, never its text.
        let params = json!({ "paneId": pane_id.clone(), "trigger": trigger.clone(), "contentLen": content.len() });
        logging::boundary(
            "create_snapshot",
            params,
            move || storage::create_snapshot(&app, pane_id, pane_title, trigger, content),
            |result| json!({ "inserted": result.inserted, "snapshotId": result.id }),
        )
    })
    .await
}

#[tauri::command]
async fn create_snapshots(
    app: AppHandle,
    snapshots: Vec<SnapshotInput>,
) -> Result<Vec<SnapshotWriteResult>, String> {
    off_main_thread(move || {
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
    })
    .await
}

#[tauri::command]
async fn list_snapshots(
    app: AppHandle,
    query: String,
    limit: u32,
    offset: u32,
) -> Result<SnapshotListResult, String> {
    off_main_thread(move || {
        // The query is the user's own search text; log its length, not its content.
        let params = json!({ "queryLen": query.len(), "limit": limit, "offset": offset });
        logging::boundary(
            "list_snapshots",
            params,
            move || storage::list_snapshots(&app, query, limit, offset),
            |result| json!({ "rows": result.rows.len(), "hasMore": result.has_more }),
        )
    })
    .await
}

// Puts a snapshot's text on the system clipboard. The text is the user's own
// writing, so only its length is logged.
#[tauri::command]
async fn copy_text(text: String) -> Result<(), String> {
    off_main_thread(move || {
        logging::boundary(
            "copy_text",
            json!({ "textLen": text.len() }),
            move || {
                let mut clipboard = arboard::Clipboard::new().map_err(|error| error.to_string())?;
                clipboard.set_text(text).map_err(|error| error.to_string())
            },
            |_| json!({}),
        )
    })
    .await
}

#[tauri::command]
async fn count_snapshots(app: AppHandle) -> Result<u64, String> {
    off_main_thread(move || {
        logging::boundary(
            "count_snapshots",
            json!({}),
            || storage::count_snapshots(&app),
            |count| json!({ "count": count }),
        )
    })
    .await
}

#[tauri::command]
async fn delete_snapshot(app: AppHandle, id: String) -> Result<bool, String> {
    off_main_thread(move || {
        logging::boundary(
            "delete_snapshot",
            json!({ "snapshotId": id.clone() }),
            move || storage::delete_snapshot(&app, id),
            |removed| json!({ "removed": removed }),
        )
    })
    .await
}

#[tauri::command]
async fn delete_all_snapshots(app: AppHandle) -> Result<u64, String> {
    off_main_thread(move || {
        logging::boundary(
            "delete_all_snapshots",
            json!({}),
            || storage::delete_all_snapshots(&app),
            |count| json!({ "count": count }),
        )
    })
    .await
}

#[tauri::command]
async fn open_records_window(
    app: AppHandle,
    placements: State<'_, PlacementState>,
) -> Result<(), String> {
    let placements = placements.inner().clone();
    off_main_thread(move || {
        logging::boundary(
            "open_records_window",
            json!({}),
            || {
                let window_theme = app.state::<WindowTheme>().get();
                let language = app.state::<LanguageState>().current();
                records_window::open(&app, &placements, window_theme, language)
            },
            |_| json!({}),
        )
    })
    .await
}

// What the Records window needs before its first frame: the language it speaks
// and the list width last chosen.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RecordsWindowSetup {
    language: &'static str,
    system_locale: Option<String>,
    list_width: Option<f64>,
}

#[tauri::command]
async fn records_window_setup(app: AppHandle) -> Result<RecordsWindowSetup, String> {
    off_main_thread(move || {
        logging::boundary(
            "records_window_setup",
            json!({}),
            || {
                let language = app.state::<LanguageState>();
                Ok(RecordsWindowSetup {
                    language: language.current(),
                    system_locale: language.system_locale.clone(),
                    list_width: storage::records_list_width(&app)?,
                })
            },
            |setup| json!({ "language": setup.language, "listWidth": setup.list_width }),
        )
    })
    .await
}

// Saved only when a splitter drag ends (window conventions).
#[tauri::command]
async fn save_records_list_width(app: AppHandle, width: u32) -> Result<(), String> {
    off_main_thread(move || {
        logging::boundary(
            "save_records_list_width",
            json!({ "width": width }),
            || storage::save_records_list_width(&app, width),
            |_| json!({}),
        )
    })
    .await
}

// The Records window's reads. Unlike every other command they log nothing when
// they succeed (records.rs says why); a failure is logged once.
async fn read_records<T: Send + 'static>(
    app: AppHandle,
    op: &'static str,
    read: impl FnOnce(&rusqlite::Connection) -> rusqlite::Result<T> + Send + 'static,
) -> Result<T, String> {
    off_main_thread(move || {
        let file = paths::app_data_dir(&app)?.join(storage::RECORDS_DB_FILE_NAME);
        records::read_bounded(file, read)
    })
    .await
    .inspect_err(|error| logging::error("records read failed", json!({ "op": op, "error": error })))
}

#[tauri::command]
async fn read_records_page(app: AppHandle, query: RecordsQuery) -> Result<RecordsPage, String> {
    read_records(app, "read_records_page", move |conn| {
        records::read_page(conn, &query)
    })
    .await
}

#[tauri::command]
async fn read_record_detail(app: AppHandle, id: i64) -> Result<Option<RecordDetail>, String> {
    read_records(app, "read_record_detail", move |conn| {
        records::read_detail(conn, id)
    })
    .await
}

#[tauri::command]
async fn read_record_sources(app: AppHandle) -> Result<RecordSources, String> {
    let current_session = logging::session().unwrap_or_default();
    read_records(app, "read_record_sources", move |conn| {
        Ok(RecordSources {
            current_session,
            sessions: records::read_sessions(conn)?,
        })
    })
    .await
}

// Receives a structured log object from the sandboxed webview and records it.
// The frontend stamps `time`; the Rust core owns the records database.
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
    let managed_placement_state = placement_state.clone();
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
        .manage(managed_placement_state)
        .plugin(instance_owner::init())
        .plugin(tauri_plugin_opener::init())
        .on_window_event(move |window, event| {
            window_placement::on_window_event(window, event, &event_placement_state);
            // The Records window never keeps the app running on its own.
            if window.label() == "main" && matches!(event, WindowEvent::Destroyed) {
                records_window::close_with_main(window.app_handle(), &event_placement_state);
            }
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
            let records_app = app.handle().clone();
            logging::on_stored(move || records_window::notify_changed(&records_app));
            // The saved theme is applied before the window is shown so the first
            // frame and title bar already match it; the frontend re-applies it on
            // every Save.
            let saved_theme = paths::app_data_dir(app.handle()).ok().and_then(|dir| {
                theme::read_saved_window_theme(&dir.join(storage::CONFIG_FILE_NAME))
            });
            app.manage(WindowTheme(Mutex::new(saved_theme)));
            window_placement::load(app.handle(), &setup_placement_state);
            let main_window = app.get_webview_window("main");
            if let Some(window) = main_window.as_ref() {
                if let Err(error) = theme::apply(window, saved_theme) {
                    logging::warn("apply saved window theme failed", json!({ "error": error }));
                }
                window_placement::restore(&window.as_ref().window(), &setup_placement_state);
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
            open_records_window,
            records_window_setup,
            save_records_list_width,
            read_records_page,
            read_record_detail,
            read_record_sources,
            save_config,
            save_state,
            save_panes,
            quarantine_corrupt_panes,
            create_snapshot,
            create_snapshots,
            list_snapshots,
            count_snapshots,
            delete_snapshot,
            delete_all_snapshots,
            copy_text,
            log_event,
        ])
        .build(tauri::generate_context!())
        .expect("error while running QuickDeck");

    // The shutdown line is logged here, Rust-side, rather than from the webview:
    // a forwarded log would be a fire-and-forget IPC racing the window teardown
    // and could be lost on the very clean-exit path it is meant to mark. Log it
    // exactly once (whichever exit event fires first).
    let mut shutdown_logged = false;
    app.run(move |app, event| {
        if matches!(event, RunEvent::ExitRequested { .. }) {
            for label in window_placement::DURABLE_WINDOWS {
                if let Some(window) = app.get_webview_window(label) {
                    window_placement::capture(&window.as_ref().window(), &placement_state);
                }
            }
        }
        #[cfg(target_os = "macos")]
        if let RunEvent::Reopen { .. } = event {
            bring_main_forward(app);
        }
        let ending = matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit);
        if ending && !shutdown_logged {
            shutdown_logged = true;
            logging::log_shutdown();
        }
        if matches!(event, RunEvent::Exit) {
            let session = app.state::<archive::ArchiveSession>();
            window_placement::save(&session.root, &placement_state);
            archive::finish_session(session.root.clone(), &session.launch);
            logging::flush();
        }
    });
}
