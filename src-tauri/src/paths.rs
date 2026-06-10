use std::{fs, path::PathBuf};

use tauri::{AppHandle, Manager};

const DATA_DIR_NAME: &str = ".quickdeck";

// Resolves (creating if missing) the app's data directory: `~/.quickdeck`.
// Shared by the storage layer and the session logger so neither hard-codes the
// location independently.
pub fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    let dir = home.join(DATA_DIR_NAME);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

// Resolves (creating if missing) the session-log directory: `~/.quickdeck/logs`.
pub fn logs_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app_data_dir(app)?.join("logs");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}
