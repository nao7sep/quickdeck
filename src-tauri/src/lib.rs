mod storage;

use serde_json::Value as JsonValue;
use storage::{LoadedAppData, SnapshotInput, SnapshotSearchResult, SnapshotWriteResult};
use tauri::AppHandle;

#[tauri::command]
fn load_app_data(app: AppHandle) -> Result<LoadedAppData, String> {
    storage::load_app_data(&app)
}

#[tauri::command]
fn save_config(app: AppHandle, config: JsonValue) -> Result<(), String> {
    storage::save_config(&app, config)
}

#[tauri::command]
fn save_session(app: AppHandle, session: JsonValue) -> Result<(), String> {
    storage::save_session(&app, session)
}

#[tauri::command]
fn create_snapshot(
    app: AppHandle,
    pane_id: String,
    trigger: String,
    content: String,
) -> Result<SnapshotWriteResult, String> {
    storage::create_snapshot(&app, pane_id, trigger, content)
}

#[tauri::command]
fn create_snapshots(
    app: AppHandle,
    snapshots: Vec<SnapshotInput>,
) -> Result<Vec<SnapshotWriteResult>, String> {
    storage::create_snapshots(&app, snapshots)
}

#[tauri::command]
fn search_snapshots(
    app: AppHandle,
    query: String,
    limit: u32,
    offset: u32,
) -> Result<SnapshotSearchResult, String> {
    storage::search_snapshots(&app, query, limit, offset)
}

#[tauri::command]
fn count_snapshots(app: AppHandle) -> Result<u64, String> {
    storage::count_snapshots(&app)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            load_app_data,
            save_config,
            save_session,
            create_snapshot,
            create_snapshots,
            search_snapshots,
            count_snapshots,
        ])
        .run(tauri::generate_context!())
        .expect("error while running QuickDeck");
}
