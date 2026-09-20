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
    let dir = resolve_root(&home, std::env::var(HOME_ENV_VAR).ok())?;
    fs::create_dir_all(&dir)
        .map_err(|e| format!("could not create data dir {}: {e}", dir.display()))?;
    Ok(dir)
}

// The data directory as the app will resolve it, found before Tauri builds the
// app (the interface language must be read before then; see i18n::align_appkit).
// It uses the same home directory Tauri's path resolver returns and creates
// nothing; None if the home or the override cannot be resolved.
pub fn data_dir_before_launch() -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    resolve_root(&home, std::env::var(HOME_ENV_VAR).ok()).ok()
}

// Root resolution, factored out so it can be unit-tested with an injected home
// directory. `override_value` is the raw `QUICKDECK_HOME` value (if any). The
// value is expanded (environment references first, then a leading `~`) and made
// absolute against the home directory. An override that is set but expands to
// nothing — an unset `$VAR`/`%VAR%`, say — is a reported error, never a silent
// collapse onto the bare home directory.
fn resolve_root(home: &Path, override_value: Option<String>) -> Result<PathBuf, String> {
    let Some(raw) = override_value else {
        return Ok(home.join(DATA_DIR_NAME));
    };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(home.join(DATA_DIR_NAME));
    }
    let expanded = expand_env_references(trimmed);
    let expanded = expanded.trim();
    if expanded.is_empty() {
        return Err(format!(
            "{HOME_ENV_VAR} is set to \"{raw}\" but expands to an empty path \
             (an unset $VAR/%VAR%?). Set it to a usable directory, or unset it to use ~/{DATA_DIR_NAME}."
        ));
    }
    Ok(absolutize(home, expand_tilde(home, expanded)))
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

// Expands `${VAR}`, `$VAR` (POSIX) and `%VAR%` (Windows) references in the
// override against the environment. An unset reference expands to empty,
// matching shell behavior, rather than being left as a literal path segment.
// Identifier characters are ASCII, so all slicing lands on char boundaries.
fn expand_env_references(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut rest = value;
    while !rest.is_empty() {
        if let Some(after) = rest.strip_prefix("${") {
            if let Some(end) = after.find('}') {
                out.push_str(&std::env::var(&after[..end]).unwrap_or_default());
                rest = &after[end + 1..];
                continue;
            }
        }
        if let Some(after) = rest.strip_prefix('$') {
            let bytes = after.as_bytes();
            let mut n = 0;
            while n < bytes.len()
                && (bytes[n].is_ascii_alphanumeric() || bytes[n] == b'_')
                && !(n == 0 && bytes[n].is_ascii_digit())
            {
                n += 1;
            }
            if n > 0 {
                out.push_str(&std::env::var(&after[..n]).unwrap_or_default());
                rest = &after[n..];
                continue;
            }
        }
        if let Some(after) = rest.strip_prefix('%') {
            if let Some(end) = after.find('%') {
                let name = &after[..end];
                if !name.is_empty() && name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_') {
                    out.push_str(&std::env::var(name).unwrap_or_default());
                    rest = &after[end + 1..];
                    continue;
                }
            }
        }
        let mut chars = rest.chars();
        out.push(chars.next().unwrap());
        rest = chars.as_str();
    }
    out
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
// EXCEPTION to tests-folder conventions: the module is private to the crate, and the tests drive
// the private `resolve_root`.
#[path = "../tests/unit/paths.rs"]
mod tests;
