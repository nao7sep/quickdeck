use std::{
    fs,
    path::{Path, PathBuf},
};

use tauri::{AppHandle, Manager};

const DATA_DIR_NAME: &str = ".quickdeck";
const HOME_ENV_VAR: &str = "QUICKDECK_HOME";

// Resolves (creating if missing) the app's data directory.
//
// The root is `QUICKDECK_HOME` when that variable is set and non-empty;
// otherwise it defaults to `~/.quickdeck`. The override value is expanded
// (a leading `~` becomes the home directory) and made absolute against the
// home directory — never the current working directory — so the location the
// app reads and writes can never depend on how the process was launched.
//
// Shared by the storage layer and the session logger so neither hard-codes the
// location independently.
pub fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    let dir = resolve_root(&home, std::env::var(HOME_ENV_VAR).ok());
    fs::create_dir_all(&dir)
        .map_err(|e| format!("could not create data dir {}: {e}", dir.display()))?;
    Ok(dir)
}

// Pure root resolution, factored out so it can be unit-tested without an
// AppHandle. `override_value` is the raw `QUICKDECK_HOME` value (if any).
fn resolve_root(home: &Path, override_value: Option<String>) -> PathBuf {
    if let Some(raw) = override_value {
        let trimmed = raw.trim();
        if !trimmed.is_empty() {
            return absolutize(home, expand_tilde(home, trimmed));
        }
    }
    home.join(DATA_DIR_NAME)
}

// Expands a leading `~` / `~/` in the override value to the home directory.
fn expand_tilde(home: &Path, value: &str) -> PathBuf {
    if value == "~" {
        return home.to_path_buf();
    }
    if let Some(rest) = value.strip_prefix("~/").or_else(|| value.strip_prefix("~\\")) {
        return home.join(rest);
    }
    PathBuf::from(value)
}

// A relative override is resolved against the home directory (never the
// working directory), so the override can never reintroduce a cwd dependence.
fn absolutize(home: &Path, path: PathBuf) -> PathBuf {
    if path.is_absolute() {
        path
    } else {
        home.join(path)
    }
}

// Resolves (creating if missing) the session-log directory: `<root>/logs`.
pub fn logs_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app_data_dir(app)?.join("logs");
    fs::create_dir_all(&dir)
        .map_err(|e| format!("could not create logs dir {}: {e}", dir.display()))?;
    Ok(dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_root_is_home_dot_quickdeck() {
        let home = PathBuf::from("/home/tester");
        // Unset / empty / whitespace all fall back to the default root.
        assert_eq!(resolve_root(&home, None), home.join(".quickdeck"));
        assert_eq!(resolve_root(&home, Some(String::new())), home.join(".quickdeck"));
        assert_eq!(
            resolve_root(&home, Some("   ".to_string())),
            home.join(".quickdeck")
        );
    }

    #[test]
    fn env_var_relocates_root_to_absolute_path() {
        let home = PathBuf::from("/home/tester");
        assert_eq!(
            resolve_root(&home, Some("/tmp/qd-test".to_string())),
            PathBuf::from("/tmp/qd-test")
        );
    }

    #[test]
    fn env_var_expands_leading_tilde() {
        let home = PathBuf::from("/home/tester");
        assert_eq!(resolve_root(&home, Some("~".to_string())), home);
        assert_eq!(
            resolve_root(&home, Some("~/profiles/work".to_string())),
            home.join("profiles/work")
        );
    }

    #[test]
    fn relative_env_var_resolves_against_home_not_cwd() {
        let home = PathBuf::from("/home/tester");
        assert_eq!(
            resolve_root(&home, Some("alt-root".to_string())),
            home.join("alt-root")
        );
    }
}
