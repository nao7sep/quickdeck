mod logging;
mod paths;
mod storage;

use serde_json::{json, Map, Value as JsonValue};
use storage::{LoadedAppData, SnapshotInput, SnapshotSearchResult, SnapshotWriteResult};
use tauri::{AppHandle, RunEvent};

#[tauri::command]
fn load_app_data(app: AppHandle) -> Result<LoadedAppData, String> {
    logging::boundary(
        "load_app_data",
        json!({}),
        || {
            // The frontend gates its debug logging on this resolved flag.
            storage::load_app_data(&app).map(|mut data| {
                data.debug_enabled = logging::debug_enabled();
                data
            })
        },
        |data| {
            json!({
                "hasConfig": data.config.is_some(),
                "hasSession": data.session.is_some(),
                "dataDir": data.data_dir,
                "debugEnabled": data.debug_enabled,
            })
        },
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
fn save_session(app: AppHandle, session: JsonValue) -> Result<(), String> {
    logging::boundary(
        "save_session",
        json!({}),
        || storage::save_session(&app, session),
        |_| json!({}),
    )
}

#[tauri::command]
fn create_snapshot(
    app: AppHandle,
    pane_id: String,
    trigger: String,
    content: String,
) -> Result<SnapshotWriteResult, String> {
    // Summarize, don't dump: log the content's length, never its text.
    let params = json!({ "paneId": pane_id.clone(), "trigger": trigger.clone(), "contentLen": content.len() });
    logging::boundary(
        "create_snapshot",
        params,
        move || storage::create_snapshot(&app, pane_id, trigger, content),
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
fn search_snapshots(
    app: AppHandle,
    query: String,
    limit: u32,
    offset: u32,
) -> Result<SnapshotSearchResult, String> {
    // The query is the user's own search text; log its length, not its content.
    let params = json!({ "queryLen": query.len(), "limit": limit, "offset": offset });
    logging::boundary(
        "search_snapshots",
        params,
        move || storage::search_snapshots(&app, query, limit, offset),
        |result| json!({ "rows": result.rows.len(), "hasMore": result.has_more }),
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
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let version = app.package_info().version.to_string();
            logging::init(app.handle(), &version);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_app_data,
            save_config,
            save_session,
            create_snapshot,
            create_snapshots,
            search_snapshots,
            count_snapshots,
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
    app.run(move |_app, event| {
        let ending = matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit);
        if ending && !shutdown_logged {
            shutdown_logged = true;
            logging::log_shutdown();
        }
        if matches!(event, RunEvent::Exit) {
            logging::flush();
        }
    });
}
