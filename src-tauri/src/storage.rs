use std::{
    fs::{self, File},
    io::Write,
    path::{Path, PathBuf},
    sync::mpsc,
};

use chrono::{SecondsFormat, Utc};
use rusqlite::{
    params, params_from_iter, types::Value, Connection, OptionalExtension, Transaction,
    TransactionBehavior,
};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

use crate::file_header::{self, Format, JsonFormat, Refusal, SqliteOpen};
use crate::paths::app_data_dir;

// The managed files the data directory holds, each named in exactly one place so
// the on-disk layout has a single source of truth.
//
// - `config.json`      — durable user settings.               RECORDED (managed text)
// - `state.json`       — UI/session state (view only).        not recorded (volatile state)
// - `window.json`      — native window state (view only).     not recorded (volatile state)
// - `panes.json`       — the panes' TEXT — the user's work.   RECORDED (managed text)
// - `snapshots.sqlite3` — the snapshot store.                 not recorded (convenience copies)
// - `backups.sqlite3`   — the backup history.                 not recorded (the store itself)
// - `records.sqlite3`   — log lines (logging.rs).             not recorded (records)
// - `logs/`             — log lines whose record write failed. not recorded (append-mode, by construction)
//
// `backups/` may still hold ZIP archives, `.lock` and `.running` files an earlier
// build wrote. Nothing reads, writes or deletes them; they stay for manual use.
//
// Every managed-*text* write goes through `write_json_atomically`, which skips a
// write whose bytes equal the file's (content-lifecycle conventions). The recorded
// files (config.json, panes.json) pass the data dir, and the bytes each save wrote
// are handed to the backup history (see backup_store.rs); the volatile-state files
// (state.json, window.json) pass none. Only these four managed-text files reach
// that choke point; the enumeration of every write site under ~/.quickdeck and its
// record/no-record decision lives beside each write below.
pub const CONFIG_FILE_NAME: &str = "config.json";
pub const STATE_FILE_NAME: &str = "state.json";
pub const WINDOW_FILE_NAME: &str = "window.json";
pub const PANES_FILE_NAME: &str = "panes.json";
pub const SNAPSHOTS_DB_FILE_NAME: &str = "snapshots.sqlite3";
pub const RECORDS_DB_FILE_NAME: &str = "records.sqlite3";

// The Records window's list width, which state.json holds beside the main
// window's view state. The main window is the file's one writer: the Records
// window sends it the width when a drag ends, and the next state save carries it
// (window conventions); the Records window reads it back when it opens.
pub const RECORDS_LIST_WIDTH_KEY: &str = "recordsListWidth";
// Each JSON file has one writer that sends its commands one at a time: the
// main window's per-file save queue, and the launch load, which finishes before
// any save.

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedAppData {
    pub config: Option<JsonValue>,
    pub state: Option<JsonValue>,
    pub panes: Option<JsonValue>,
    // Every file the launch stops on (store-recovery conventions, What a
    // refused file does). When any is listed the app opens nothing, writes
    // nothing and only shows them; `config` is still given when it could be
    // read, so the stop speaks the saved language.
    pub refused: Vec<RefusedFile>,
    // Unreadable side stores (records, backups), left untouched and off for
    // this session, which the app reports and runs without.
    pub off: Vec<RefusedFile>,
    pub data_dir: String,
    // The computer's language and regional locale, read at launch. Set by the
    // command layer from presentation::PresentationState; storage leaves them empty.
    pub system_language: String,
    pub system_locale: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotWriteResult {
    pub inserted: bool,
    pub id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotInput {
    pub pane_id: String,
    /// The pane's title as it read when the copy was taken. Stored beside the id because a
    /// deleted pane cannot be asked for its name later, and a copy that cannot say where it
    /// came from is worth less than one that can.
    pub pane_title: String,
    pub trigger: String,
    pub content: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotRow {
    pub id: String,
    pub pane_id: String,
    /// Empty when the pane had no title.
    pub pane_title: String,
    pub created_at_utc: String,
    pub content: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotListResult {
    pub rows: Vec<SnapshotRow>,
    pub has_more: bool,
}

/// A file the app leaves exactly as it is: `newer` is the version a newer build
/// recorded, or None when the file could not be read. `message` is diagnostic.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefusedFile {
    pub path: String,
    pub newer: Option<u32>,
    pub message: String,
}

impl RefusedFile {
    fn at(path: &Path, refusal: Refusal) -> Self {
        Self {
            path: path.to_string_lossy().into_owned(),
            newer: refusal.newer,
            message: refusal.message,
        }
    }
}

// A load that stopped, with the store it stopped at when it was one, so the
// halt can name the file (store-recovery conventions). The message is
// diagnostic only.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadFailure {
    pub path: Option<String>,
    pub message: String,
}

impl LoadFailure {
    fn at(path: &Path) -> impl FnOnce(String) -> Self + '_ {
        move |message| Self {
            path: Some(path.to_string_lossy().into_owned()),
            message,
        }
    }
}

impl From<String> for LoadFailure {
    fn from(message: String) -> Self {
        Self {
            path: None,
            message,
        }
    }
}

impl std::fmt::Display for LoadFailure {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match &self.path {
            Some(path) => write!(formatter, "{path}: {}", self.message),
            None => formatter.write_str(&self.message),
        }
    }
}

pub fn load_app_data(app: &AppHandle) -> Result<LoadedAppData, LoadFailure> {
    load_app_data_in(
        &app_data_dir(app)?,
        &app.state::<SnapshotConnection>(),
        crate::logging::records_refusal(),
    )
}

// The data folders whose launch stopped on a refused file: nothing is written
// into them for the rest of the session (store-recovery conventions, A refused
// file is never changed), checked at the write itself.
static STOPPED: std::sync::Mutex<Vec<PathBuf>> = std::sync::Mutex::new(Vec::new());

fn stop_writes_in(data_dir: &Path) {
    let mut stopped = STOPPED
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    if !stopped.iter().any(|dir| dir == data_dir) {
        stopped.push(data_dir.to_path_buf());
    }
}

pub(crate) fn writes_stopped_in(data_dir: &Path) -> bool {
    STOPPED
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .iter()
        .any(|dir| dir == data_dir)
}

fn load_app_data_in(
    data_dir: &Path,
    snapshots: &SnapshotConnection,
    records: Option<Refusal>,
) -> Result<LoadedAppData, LoadFailure> {
    // Every file is checked before anything is opened for writing, so a stop
    // names every refused file and writes nothing (store-recovery conventions,
    // What a refused file does). Settings and the panes' text are valuable: newer
    // or unreadable stops the launch. View state and window placement are
    // disposable: newer stops, unreadable takes defaults and the next save
    // replaces it. The snapshot store stops either way; the records and backup
    // databases stop when newer and are switched off when unreadable.
    let mut refused = Vec::new();
    let mut off = Vec::new();

    let config_path = data_dir.join(CONFIG_FILE_NAME);
    let config = match read_json_store(&config_path, file_header::CONFIG) {
        Ok(JsonRead::Absent) => None,
        Ok(JsonRead::Readable(fields)) => Some(fields),
        Ok(JsonRead::Newer(recorded)) => {
            refused.push(RefusedFile::at(
                &config_path,
                Refusal::newer(CONFIG_FILE_NAME, recorded),
            ));
            None
        }
        Ok(JsonRead::Corrupt(message)) | Err(message) => {
            refused.push(RefusedFile::at(&config_path, Refusal::unreadable(message)));
            None
        }
    };

    let state_path = data_dir.join(STATE_FILE_NAME);
    let state = read_disposable_store(&state_path, file_header::STATE, &mut refused);
    let window_path = data_dir.join(WINDOW_FILE_NAME);
    read_disposable_store(&window_path, file_header::WINDOW, &mut refused);

    let panes_path = data_dir.join(PANES_FILE_NAME);
    let panes = match read_json_store(&panes_path, file_header::PANES) {
        Ok(JsonRead::Absent) => None,
        Ok(JsonRead::Readable(fields)) if valid_panes_shape(&fields) => Some(fields),
        Ok(JsonRead::Readable(_)) => {
            refused.push(RefusedFile::at(
                &panes_path,
                Refusal::unreadable("panes.json contains invalid pane data"),
            ));
            None
        }
        Ok(JsonRead::Newer(recorded)) => {
            refused.push(RefusedFile::at(
                &panes_path,
                Refusal::newer(PANES_FILE_NAME, recorded),
            ));
            None
        }
        Ok(JsonRead::Corrupt(message)) | Err(message) => {
            refused.push(RefusedFile::at(&panes_path, Refusal::unreadable(message)));
            None
        }
    };

    let snapshots_path = data_dir.join(SNAPSHOTS_DB_FILE_NAME);
    if let Some(refusal) = file_header::check_sqlite_file(&snapshots_path, file_header::SNAPSHOTS) {
        refused.push(RefusedFile::at(&snapshots_path, refusal));
    }
    let backups_path = data_dir.join(crate::backup_store::BACKUPS_DB_FILE_NAME);
    let side_stores = [
        (
            backups_path.clone(),
            file_header::check_sqlite_file(&backups_path, file_header::BACKUPS),
        ),
        (data_dir.join(RECORDS_DB_FILE_NAME), records),
    ];
    for (path, refusal) in side_stores {
        match refusal {
            Some(refusal) if refusal.newer.is_some() => {
                refused.push(RefusedFile::at(&path, refusal))
            }
            Some(refusal) => off.push(RefusedFile::at(&path, refusal)),
            None => {}
        }
    }

    for file in refused.iter().chain(&off) {
        crate::logging::warn(
            "store refused and left in place",
            serde_json::json!({
                "file": file.path,
                "newer": file.newer,
                "error": { "message": file.message },
            }),
        );
    }
    if !refused.is_empty() {
        stop_writes_in(data_dir);
    } else if let Some(recorded) = snapshots
        .open(data_dir)
        .map_err(LoadFailure::at(&snapshots_path))?
    {
        // Written by a newer build between the check and the open.
        stop_writes_in(data_dir);
        refused.push(RefusedFile::at(
            &snapshots_path,
            Refusal::newer(SNAPSHOTS_DB_FILE_NAME, recorded),
        ));
    }
    let stopped = !refused.is_empty();

    Ok(LoadedAppData {
        config: config.map(JsonValue::Object),
        state: state.filter(|_| !stopped).map(JsonValue::Object),
        panes: panes.filter(|_| !stopped).map(JsonValue::Object),
        refused,
        off,
        data_dir: data_dir.to_string_lossy().into_owned(),
        system_language: String::new(),
        system_locale: None,
    })
}

// Reads disposable view state: its value when readable; nothing when absent or
// unreadable, the next save replacing it; a newer one joins the files the
// launch stops on.
fn read_disposable_store(
    path: &Path,
    format: Format,
    refused: &mut Vec<RefusedFile>,
) -> Option<serde_json::Map<String, JsonValue>> {
    match read_json_store(path, format) {
        Ok(JsonRead::Readable(fields)) => Some(fields),
        Ok(JsonRead::Newer(recorded)) => {
            let file = path.file_name().unwrap_or_default().to_string_lossy();
            refused.push(RefusedFile::at(path, Refusal::newer(&file, recorded)));
            None
        }
        Ok(JsonRead::Absent) => None,
        Ok(JsonRead::Corrupt(message)) | Err(message) => {
            crate::logging::warn(
                "view state unreadable; using defaults",
                serde_json::json!({ "file": path.to_string_lossy(), "error": { "message": message } }),
            );
            None
        }
    }
}

// What a config save writes: the content, or None when it equals the file.
#[derive(Debug, PartialEq)]
pub struct ConfigToWrite {
    pub content: Option<JsonValue>,
}

// The numeric settings' accepted values, as the Settings form and the read of
// config.json accept them (number-field conventions): inclusive bounds, and
// whether only a whole number is accepted, by where each sits in the sets.
const NUMBER_SETTINGS: &[(&[&str], f64, f64, bool)] = &[
    (&["editorFont", "size"], 10.0, 32.0, true),
    (&["editorFont", "lineHeight"], 1.0, 3.0, false),
    (&["editorFont", "padding"], 0.0, 64.0, true),
    (&["autosaveDelaySeconds"], 1.0, 60.0, true),
    (&["snapshotPageSize"], 5.0, 200.0, true),
];

/// The snapshot page sizes a list read accepts: the Snapshots per page setting's
/// range.
pub const SNAPSHOT_PAGE_SIZE: std::ops::RangeInclusive<u32> = 5..=200;

// A save is refused, never corrected, when a set it changes carries a numeric
// setting outside its accepted values; a set it leaves out is at its built-in,
// and one equal to the file's is kept as it is (config-sets conventions).
fn check_number_settings(
    sets: &serde_json::Map<String, JsonValue>,
    current: &serde_json::Map<String, JsonValue>,
) -> Result<(), String> {
    for (path, min, max, whole) in NUMBER_SETTINGS {
        let Some(set) = sets.get(path[0]) else {
            continue;
        };
        if current.get(path[0]) == Some(set) {
            continue;
        }
        let value = path[1..]
            .iter()
            .try_fold(set, |value, member| value.get(member));
        let accepted = value.and_then(JsonValue::as_f64).is_some_and(|number| {
            (*min..=*max).contains(&number) && (!whole || number.fract() == 0.0)
        });
        if !accepted {
            return Err(format!(
                "config setting {} is not an accepted value",
                path.join(".")
            ));
        }
    }
    Ok(())
}

// The file content for the given sets — every set that differs from its
// built-in, which the frontend decides, including a set it could not read and
// kept as it was — plus every key this build does not know, kept from the file
// (config-sets conventions), or None when that equals the file, so an absent
// file stays absent and a file whose sets are all back at their built-ins keeps
// only its header. A newer or unreadable config.json is never saved over.
pub fn config_to_write(data_dir: &Path, sets: JsonValue) -> Result<ConfigToWrite, String> {
    const KEYS: &[&str] = &[
        "language",
        "theme",
        "zen",
        "topmost",
        "uiFontFamily",
        "displayZone",
        "autosaveDelaySeconds",
        "snapshotPageSize",
        "editorFont",
    ];
    let mut stored = sets
        .as_object()
        .ok_or("config sets are not an object")?
        .clone();
    stored.retain(|key, _| KEYS.contains(&key.as_str()));
    let current = match read_json_store(&data_dir.join(CONFIG_FILE_NAME), file_header::CONFIG)? {
        JsonRead::Absent => serde_json::Map::new(),
        JsonRead::Readable(fields) => fields,
        JsonRead::Newer(recorded) => {
            return Err(file_header::newer_message(CONFIG_FILE_NAME, recorded))
        }
        JsonRead::Corrupt(message) => {
            return Err(format!(
                "{CONFIG_FILE_NAME} cannot be read and is left in place: {message}"
            ))
        }
    };
    check_number_settings(&stored, &current)?;
    for (key, value) in &current {
        if !KEYS.contains(&key.as_str()) {
            stored.insert(key.clone(), value.clone());
        }
    }
    Ok(ConfigToWrite {
        content: (current != stored).then_some(JsonValue::Object(stored)),
    })
}

pub fn write_config(data_dir: &Path, config: &JsonValue) -> Result<(), String> {
    // records: config.json is the user's settings — protected, recorded on every
    // save that changes it (data-backup conventions).
    atomic_write_json(
        data_dir,
        &data_dir.join(CONFIG_FILE_NAME),
        config,
        file_header::CONFIG,
    )
    .map(|_| ())
}

// Returns whether the file was written; a save equal to the file writes nothing.
pub fn save_state(app: &AppHandle, state: JsonValue) -> Result<bool, String> {
    save_state_in(&app_data_dir(app)?, state)
}

fn save_state_in(data_dir: &Path, state: JsonValue) -> Result<bool, String> {
    // not recorded: state.json is pure view/session state (active pane, zoom, the
    // Records list width) — volatile state, kept out of the backup history
    // (data-backup conventions).
    atomic_write_json_unrecorded(&data_dir.join(STATE_FILE_NAME), &state, file_header::STATE)
}

pub fn records_list_width(app: &AppHandle) -> Result<Option<f64>, String> {
    records_list_width_in(&app_data_dir(app)?)
}

fn records_list_width_in(data_dir: &Path) -> Result<Option<f64>, String> {
    Ok(
        read_state_object(&data_dir.join(STATE_FILE_NAME)).and_then(|stored| {
            stored
                .get(RECORDS_LIST_WIDTH_KEY)
                .and_then(JsonValue::as_f64)
        }),
    )
}

// state.json as an object, or None when it is missing, unreadable or newer; its
// recovery stays with the launch's load path.
fn read_state_object(path: &Path) -> Option<serde_json::Map<String, JsonValue>> {
    match read_json_store(path, file_header::STATE) {
        Ok(JsonRead::Readable(fields)) => Some(fields),
        _ => None,
    }
}

// window.json before the windows exist: its value, or None when it is absent,
// unreadable or newer. The launch's load reports a newer one and stops; an
// unreadable one is disposable and the next save replaces it.
pub(crate) fn load_window_state_in(root: &Path) -> Result<Option<JsonValue>, String> {
    Ok(
        match read_json_store(&root.join(WINDOW_FILE_NAME), file_header::WINDOW)? {
            JsonRead::Readable(fields) => Some(JsonValue::Object(fields)),
            JsonRead::Absent | JsonRead::Newer(_) | JsonRead::Corrupt(_) => None,
        },
    )
}

pub fn save_window_state(data_dir: &Path, state: JsonValue) -> Result<(), String> {
    // not recorded: window.json is pure window geometry — volatile state, kept out
    // of the backup history (data-backup conventions).
    atomic_write_json_unrecorded(
        &data_dir.join(WINDOW_FILE_NAME),
        &state,
        file_header::WINDOW,
    )
    .map(|_| ())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveFailure {
    pub path: Option<String>,
    pub newer: Option<u32>,
    pub message: String,
}

impl From<String> for SaveFailure {
    fn from(message: String) -> Self {
        Self {
            path: None,
            newer: None,
            message,
        }
    }
}

impl std::fmt::Display for SaveFailure {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

// Returns whether the file was written; a save equal to the file writes nothing.
pub fn save_panes(app: &AppHandle, panes: JsonValue) -> Result<bool, SaveFailure> {
    save_panes_in(&app_data_dir(app)?, &panes)
}

fn save_panes_in(data_dir: &Path, panes: &JsonValue) -> Result<bool, SaveFailure> {
    // records: panes.json is the user's text — protected (data-backup conventions).
    let path = data_dir.join(PANES_FILE_NAME);
    let outcome = write_json_atomically(&path, panes, file_header::PANES, Some(data_dir)).map_err(
        |message| SaveFailure {
            path: Some(path.to_string_lossy().into_owned()),
            newer: None,
            message,
        },
    )?;
    match outcome {
        JsonWrite::Newer(recorded) => Err(SaveFailure {
            path: Some(path.to_string_lossy().into_owned()),
            newer: Some(recorded),
            message: file_header::newer_message(PANES_FILE_NAME, recorded),
        }),
        JsonWrite::Written => Ok(true),
        JsonWrite::Unchanged => Ok(false),
    }
}

// Loading and saving share the current pane shape consumed by the editor.
fn valid_panes_shape(fields: &serde_json::Map<String, JsonValue>) -> bool {
    let Some(panes) = fields.get("panes").and_then(JsonValue::as_array) else {
        return false;
    };
    let mut ids = std::collections::HashSet::new();
    panes.iter().all(|pane| {
        let Some(pane) = pane.as_object() else {
            return false;
        };
        let Some(id) = pane.get("id").and_then(JsonValue::as_str) else {
            return false;
        };
        !id.is_empty()
            && ids.insert(id)
            && ["title", "content"]
                .iter()
                .all(|key| pane.get(*key).is_some_and(JsonValue::is_string))
            && ["headerColor", "backgroundColor"].iter().all(|key| {
                pane.get(*key)
                    .and_then(JsonValue::as_str)
                    .is_some_and(|color| {
                        color.len() == 7
                            && color.starts_with('#')
                            && color.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit)
                    })
            })
    })
}

pub fn create_snapshot(
    app: &AppHandle,
    pane_id: String,
    pane_title: String,
    trigger: String,
    content: String,
) -> Result<SnapshotWriteResult, String> {
    create_snapshot_from_input(
        app,
        SnapshotInput {
            pane_id,
            pane_title,
            trigger,
            content,
        },
    )
}

pub fn create_snapshots(
    app: &AppHandle,
    snapshots: Vec<SnapshotInput>,
) -> Result<Vec<SnapshotWriteResult>, String> {
    app.state::<SnapshotConnection>().with(move |conn| {
        let transaction = begin_snapshot_write(conn)?;
        let results = snapshots
            .into_iter()
            .map(|snapshot| create_snapshot_with_connection(&transaction, snapshot))
            .collect::<Result<Vec<_>, _>>()?;
        transaction.commit().map_err(to_string_error)?;
        Ok(results)
    })
}

pub fn list_snapshots(
    app: &AppHandle,
    query: String,
    limit: u32,
    offset: u32,
) -> Result<SnapshotListResult, String> {
    app.state::<SnapshotConnection>()
        .with(move |conn| list_snapshots_with_connection(conn, &query, limit, offset))
}

// A blank query lists the whole store newest-first; terms narrow that list. The
// browse path carries no `where` clause at all, so `snapshots_time` serves the
// ordering directly instead of the scan a `like` filter forces.
fn list_snapshots_with_connection(
    conn: &Connection,
    query: &str,
    limit: u32,
    offset: u32,
) -> Result<SnapshotListResult, String> {
    let terms = query
        .split_whitespace()
        .map(|term| term.to_lowercase())
        .filter(|term| !term.is_empty())
        .collect::<Vec<_>>();

    if !SNAPSHOT_PAGE_SIZE.contains(&limit) {
        return Err(format!(
            "snapshot page size {limit} is not an accepted value"
        ));
    }
    let fetch_limit = limit + 1;
    let mut sql = String::from(
        "select id, pane_id, pane_title, created_at_utc, content from snapshots where 1 = 1",
    );
    let mut values: Vec<Value> = Vec::new();

    for term in terms {
        sql.push_str(" and unicode_lower(content) like ? escape '\\'");
        values.push(Value::Text(format!("%{}%", escape_like(&term))));
    }

    // id is the tiebreaker so pagination stays stable when several snapshots
    // share an identical created_at_utc. Without it, LIMIT/OFFSET pages could
    // repeat or skip rows with the same timestamp. Each id begins with its own
    // timestamp, so `id desc` keeps newest-first within a tie.
    sql.push_str(" order by created_at_utc desc, id desc limit ? offset ?");
    values.push(Value::Integer(fetch_limit as i64));
    values.push(Value::Integer(offset as i64));

    conn.create_scalar_function(
        "unicode_lower",
        1,
        rusqlite::functions::FunctionFlags::SQLITE_UTF8
            | rusqlite::functions::FunctionFlags::SQLITE_DETERMINISTIC,
        |context| Ok(context.get::<String>(0)?.to_lowercase()),
    )
    .map_err(to_string_error)?;
    let mut statement = conn.prepare(&sql).map_err(to_string_error)?;
    let mut rows = statement
        .query_map(params_from_iter(values.iter()), |row| {
            Ok(SnapshotRow {
                id: row.get(0)?,
                pane_id: row.get(1)?,
                pane_title: row.get(2)?,
                created_at_utc: row.get(3)?,
                content: row.get(4)?,
            })
        })
        .map_err(to_string_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(to_string_error)?;

    let has_more = rows.len() > limit as usize;
    rows.truncate(limit as usize);

    Ok(SnapshotListResult { rows, has_more })
}

fn create_snapshot_from_input(
    app: &AppHandle,
    snapshot: SnapshotInput,
) -> Result<SnapshotWriteResult, String> {
    if snapshot.content.is_empty() {
        return Ok(SnapshotWriteResult {
            inserted: false,
            id: None,
        });
    }

    app.state::<SnapshotConnection>().with(move |conn| {
        let transaction = begin_snapshot_write(conn)?;
        let result = create_snapshot_with_connection(&transaction, snapshot)?;
        transaction.commit().map_err(to_string_error)?;
        Ok(result)
    })
}

// A write's duplicate check and insert, or a batch's, commit together: a failure
// part-way leaves none of them. The write lock is taken first, before the check.
fn begin_snapshot_write(conn: &mut Connection) -> Result<Transaction<'_>, String> {
    conn.transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(to_string_error)
}

fn create_snapshot_with_connection(
    conn: &Connection,
    snapshot: SnapshotInput,
) -> Result<SnapshotWriteResult, String> {
    if snapshot.content.is_empty() {
        return Ok(SnapshotWriteResult {
            inserted: false,
            id: None,
        });
    }

    // A copy is new when it differs from the pane's latest snapshot, so text the
    // pane held before and returned to is recorded again. Latest follows insertion
    // order even when the wall clock moves backward; display keeps its own order.
    let content_hash = hash_content(&snapshot.content);
    let latest = conn
        .query_row(
            "select id, content_hash from snapshots where pane_id = ?1
             order by rowid desc limit 1",
            params![snapshot.pane_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()
        .map_err(to_string_error)?;

    if let Some((id, latest_hash)) = latest {
        if latest_hash == content_hash {
            return Ok(SnapshotWriteResult {
                inserted: false,
                id: Some(id),
            });
        }
    }

    let now = Utc::now();
    // Data column: the canonical internal/serialized form (ISO 8601, exactly 3
    // fractional digits, Z). The id keeps the compact filename-style stamp — an
    // opaque, sortable, filesystem-safe key whose nanoid suffix keeps it unique
    // when a pane returns to earlier text within the same second.
    let created_at_utc = now.to_rfc3339_opts(SecondsFormat::Millis, true);
    let id = format!(
        "{}-{}-{}",
        now.format("%Y%m%d-%H%M%S-utc"),
        snapshot.pane_id,
        crate::nanoid::generate()?
    );

    // not recorded: snapshots are convenience copies the user keeps or deletes in
    // the app, not protected content (data-backup conventions). This never touches
    // write_json_atomically, so it never reaches the backup history by construction.
    conn.execute(
        "insert into snapshots (id, pane_id, pane_title, created_at_utc, trigger, content_hash, content)
         values (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            id,
            snapshot.pane_id,
            snapshot.pane_title,
            created_at_utc,
            snapshot.trigger,
            content_hash,
            snapshot.content
        ],
    )
    .map_err(to_string_error)?;

    Ok(SnapshotWriteResult {
        inserted: true,
        id: Some(id),
    })
}

pub fn count_snapshots(app: &AppHandle) -> Result<u64, String> {
    app.state::<SnapshotConnection>().with(|conn| {
        let count: i64 = conn
            .query_row("select count(*) from snapshots", [], |row| row.get(0))
            .map_err(to_string_error)?;
        Ok(count.max(0) as u64)
    })
}

/// Removes one snapshot. Returns whether a row was there to remove, so a copy deleted from
/// two windows at once reports honestly rather than twice.
pub fn delete_snapshot(app: &AppHandle, id: String) -> Result<bool, String> {
    app.state::<SnapshotConnection>()
        .with(move |conn| delete_snapshot_with_connection(conn, &id))
}

fn delete_snapshot_with_connection(conn: &Connection, id: &str) -> Result<bool, String> {
    let removed = conn
        .execute("delete from snapshots where id = ?1", params![id])
        .map_err(to_string_error)?;
    Ok(removed > 0)
}

/// Empties the store and returns how many copies went. The file itself stays: an empty
/// one is the normal state on a first run.
pub fn delete_all_snapshots(app: &AppHandle) -> Result<u64, String> {
    app.state::<SnapshotConnection>()
        .with(|conn| delete_all_snapshots_with_connection(conn))
}

fn delete_all_snapshots_with_connection(conn: &Connection) -> Result<u64, String> {
    let removed = conn
        .execute("delete from snapshots", [])
        .map_err(to_string_error)?;
    Ok(removed as u64)
}

// What a JSON store's file holds, its header checked and removed.
#[derive(Debug, PartialEq)]
enum JsonRead {
    Absent,
    Readable(serde_json::Map<String, JsonValue>),
    // Recorded in this newer format: intact data this build cannot read, which
    // is reported and left exactly in place (store-recovery conventions).
    Newer(u32),
    // Bytes that do not parse, or a header that is missing, malformed or names
    // another owner or kind.
    Corrupt(String),
}

// The one reader every JSON store loads through. Absence is not an error; a
// failure to read the bytes at all is, and the caller's branch decides the rest.
fn read_json_store(path: &Path, format: Format) -> Result<JsonRead, String> {
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(JsonRead::Absent),
        Err(err) => return Err(to_string_error(err)),
    };
    let value = match serde_json::from_slice::<JsonValue>(&bytes) {
        Ok(value) => value,
        Err(parse_err) => return Ok(JsonRead::Corrupt(parse_err.to_string())),
    };
    Ok(match file_header::read_json(value, format) {
        Ok(JsonFormat::Readable(value)) => JsonRead::Readable(value),
        Ok(JsonFormat::Newer(recorded)) => JsonRead::Newer(recorded),
        Err(reason) => JsonRead::Corrupt(reason),
    })
}

/// config.json's settings for the reads made before the load path runs (the
/// menu language, the window theme): None for a file that does not parse or
/// is in a newer format, as the load path will report it.
pub fn launch_config(text: &str) -> Option<JsonValue> {
    let value = serde_json::from_str(text).ok()?;
    match file_header::read_json(value, file_header::CONFIG).ok()? {
        JsonFormat::Readable(fields) => Some(JsonValue::Object(fields)),
        JsonFormat::Newer(_) => None,
    }
}

// The atomic-write temp name for `path`: `<stem>-<discriminator>.tmp`, in the
// same directory so the rename that publishes it stays on one volume. The
// discriminator is a random nanoid, so two writers never pick the same temp.
fn temp_path_for(path: &Path) -> Result<PathBuf, String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("missing parent directory for {}", path.display()))?;
    let stem = path
        .file_stem()
        .and_then(|name| name.to_str())
        .ok_or_else(|| format!("invalid file name for {}", path.display()))?;
    Ok(parent.join(format!("{}-{}.tmp", stem, crate::nanoid::generate()?)))
}

// The single managed-text atomic-write choke point for config.json, state.json,
// window.json and panes.json, and the ONE place the backup history is fed. A
// protected write passes its data dir (`atomic_write_json`, `save_panes_in`); the
// volatile-state stores pass none (`atomic_write_json_unrecorded`). A protected
// write that bypasses this is a silent backup gap.
//
// Writes `value` to a same-directory `<stem>-<nanoid>.tmp` (the derived-filename
// grammar), then atomically renames it over `path`, so a crash mid-write cannot
// corrupt the target; bytes equal to the file's are not written at all, so neither
// the file nor the backup history sees a save that changed nothing. STRICTLY AFTER
// the rename lands, a protected write hands the exact bytes it wrote — never a re-read of the file —
// to `backup_store::record`, which only queues them. Recording before the rename
// would risk a backup of a save that never reached disk. The history never throws
// back into this write, never delays it and never affects its success.
fn atomic_write_json(
    data_dir: &Path,
    path: &Path,
    value: &JsonValue,
    format: Format,
) -> Result<bool, String> {
    write_json_atomically(path, value, format, Some(data_dir))
        .and_then(|outcome| written(path, outcome))
}

// The same atomic write without the backup record, for volatile state (state.json,
// window.json) that stays out of the backup history. Returns whether it wrote.
fn atomic_write_json_unrecorded(
    path: &Path,
    value: &JsonValue,
    format: Format,
) -> Result<bool, String> {
    write_json_atomically(path, value, format, None).and_then(|outcome| written(path, outcome))
}

// Whether a write wrote; a newer file it left in place fails the save, so it is
// never reported as saved.
fn written(path: &Path, outcome: JsonWrite) -> Result<bool, String> {
    match outcome {
        JsonWrite::Written => Ok(true),
        JsonWrite::Unchanged => Ok(false),
        JsonWrite::Newer(recorded) => Err(file_header::newer_message(
            &path.file_name().unwrap_or_default().to_string_lossy(),
            recorded,
        )),
    }
}

enum JsonWrite {
    Unchanged,
    Newer(u32),
    Written,
}

// The writer distinguishes an exact no-op from a protected newer destination
// (store-recovery conventions); each store owns how it reports that refusal.
// `backups_in` is the data dir whose backup history records this file, or None.
fn write_json_atomically(
    path: &Path,
    value: &JsonValue,
    format: Format,
    backups_in: Option<&Path>,
) -> Result<JsonWrite, String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("missing parent directory for {}", path.display()))?;
    if writes_stopped_in(parent) {
        return Err(format!(
            "{} is not written: the launch stopped on a refused file",
            path.display()
        ));
    }

    // Pane content may have changed on disk since loading. Check it again at
    // publication before replacing authored text.
    let is_panes = format == file_header::PANES;
    // Only disposable view state may replace a file it cannot read; settings
    // and the panes' text are left in place (store-recovery conventions).
    let keeps_unreadable = format == file_header::CONFIG || is_panes;
    if is_panes && !value.as_object().is_some_and(valid_panes_shape) {
        return Err("panes.json contains invalid pane data".to_string());
    }

    // The exact bytes that land on disk: pretty JSON plus the single trailing
    // newline. Building the whole buffer once (rather than two write_all calls)
    // is what lets the backup record a blob byte-identical to the file.
    let stamped = file_header::stamp_json(value, format)?;
    let mut bytes = serde_json::to_vec_pretty(&stamped).map_err(to_string_error)?;
    bytes.push(b'\n');
    match fs::read(path) {
        Ok(current) => {
            let parsed = serde_json::from_slice(&current)
                .map_err(to_string_error)
                .and_then(|current| file_header::read_json(current, format));
            match parsed {
                Ok(JsonFormat::Newer(recorded)) => return Ok(JsonWrite::Newer(recorded)),
                Ok(JsonFormat::Readable(fields)) if is_panes && !valid_panes_shape(&fields) => {
                    return Err(
                        "panes.json contains invalid pane data and is left in place".to_string()
                    )
                }
                Err(message) if keeps_unreadable => {
                    return Err(format!(
                        "{} cannot be read and is left in place: {message}",
                        path.display()
                    ))
                }
                _ => {}
            }
            if current == bytes {
                return Ok(JsonWrite::Unchanged);
            }
        }
        Err(error) if keeps_unreadable && error.kind() != std::io::ErrorKind::NotFound => {
            return Err(to_string_error(error))
        }
        Err(_) => {}
    }

    fs::create_dir_all(parent).map_err(to_string_error)?;
    let tmp_path = temp_path_for(path)?;

    // A failed write or rename removes its own temp, best-effort, on each error
    // path. Nothing else ever removes a temp: a crash-stranded temp is left as
    // harmless debris (storage-path-conventions).
    let mut file = create_private_stage(&tmp_path).map_err(to_string_error)?;
    let write_tmp = (|| -> std::io::Result<()> {
        file.write_all(&bytes)?;
        #[cfg(target_os = "macos")]
        carry_replaced_permissions(path, &file)?;
        file.sync_all()?;
        Ok(())
    })();
    drop(file);
    if let Err(error) = write_tmp {
        let _ = fs::remove_file(&tmp_path);
        return Err(to_string_error(error));
    }

    if let Err(error) = fs::rename(&tmp_path, path) {
        let _ = fs::remove_file(&tmp_path);
        return Err(to_string_error(error));
    }

    if let Some(data_dir) = backups_in {
        crate::backup_store::record(
            &data_dir.join(crate::backup_store::BACKUPS_DB_FILE_NAME),
            path,
            &bytes,
        );
    }
    Ok(JsonWrite::Written)
}

fn create_private_stage(path: &Path) -> std::io::Result<File> {
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path)
}

// Preserve ordinary permission bits when replacing an existing file. The
// staged file gets its own modified time; no other metadata is transported.
#[cfg(target_os = "macos")]
fn carry_replaced_permissions(original: &Path, tmp: &File) -> std::io::Result<()> {
    let source = match File::open(original) {
        Ok(source) => source,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error),
    };
    tmp.set_permissions(source.metadata()?.permissions())
}

// The snapshot store, opened for use, or the newer format it records, in which
// case it was left untouched.
enum SnapshotStore {
    Ready(Connection),
    Newer(u32),
}

// The snapshot store's owner: one thread that holds the store's one connection
// for this process, opened and checked by the launch's load; instance_owner makes
// this process the store's only one. Every snapshot command is a message it
// answers in order on that connection, so their writes never overlap, and a new
// store's WAL switch has a single opener although React's development StrictMode
// sends load_app_data twice together. Callers wait for the answer on their own
// thread (the runtime's blocking pool for commands).
pub struct SnapshotConnection(mpsc::Sender<SnapshotJob>);

type SnapshotJob = Box<dyn FnOnce(&mut SnapshotSlot) + Send>;

#[derive(Default)]
enum SnapshotSlot {
    #[default]
    Unopened,
    Ready(Connection),
    Newer(u32),
}

impl Default for SnapshotConnection {
    fn default() -> Self {
        let (jobs, received) = mpsc::channel::<SnapshotJob>();
        // A thread that cannot start drops the receiver, so every command
        // reports the store unavailable.
        let spawned = std::thread::Builder::new()
            .name("snapshots".to_string())
            .spawn(move || {
                let mut slot = SnapshotSlot::Unopened;
                for job in received {
                    job(&mut slot);
                }
            });
        if let Err(error) = spawned {
            crate::logging::warn(
                "snapshot store owner unavailable",
                serde_json::json!({ "error": error.to_string() }),
            );
        }
        Self(jobs)
    }
}

impl SnapshotConnection {
    fn run<T: Send + 'static>(
        &self,
        job: impl FnOnce(&mut SnapshotSlot) -> Result<T, String> + Send + 'static,
    ) -> Result<T, String> {
        let (answer, answered) = mpsc::sync_channel(1);
        self.0
            .send(Box::new(move |slot| {
                let _ = answer.send(job(slot));
            }))
            .map_err(|_| format!("{SNAPSHOTS_DB_FILE_NAME} is unavailable"))?;
        answered
            .recv()
            .map_err(|_| format!("{SNAPSHOTS_DB_FILE_NAME} is unavailable"))?
    }

    // Opens the store unless an earlier load already did. Returns the newer
    // format a store records, which the load reports and halts on.
    fn open(&self, data_dir: &Path) -> Result<Option<u32>, String> {
        let data_dir = data_dir.to_path_buf();
        self.run(move |slot| {
            if let SnapshotSlot::Ready(_) = slot {
                return Ok(None);
            }
            let (opened, newer) = match open_snapshot_store(&data_dir)? {
                SnapshotStore::Ready(conn) => (SnapshotSlot::Ready(conn), None),
                SnapshotStore::Newer(recorded) => (SnapshotSlot::Newer(recorded), Some(recorded)),
            };
            *slot = opened;
            Ok(newer)
        })
    }

    fn with<T: Send + 'static>(
        &self,
        work: impl FnOnce(&mut Connection) -> Result<T, String> + Send + 'static,
    ) -> Result<T, String> {
        self.run(move |slot| match slot {
            SnapshotSlot::Ready(conn) => work(conn),
            SnapshotSlot::Newer(recorded) => Err(file_header::newer_message(
                SNAPSHOTS_DB_FILE_NAME,
                *recorded,
            )),
            SnapshotSlot::Unopened => Err(format!("{SNAPSHOTS_DB_FILE_NAME} is not open")),
        })
    }
}

fn open_snapshot_store(data_dir: &Path) -> Result<SnapshotStore, String> {
    // not recorded: snapshots.sqlite3 (+ its -wal/-shm sidecars) holds convenience
    // copies, not protected content, and is separate from backups.sqlite3
    // (data-backup conventions).
    fs::create_dir_all(data_dir).map_err(to_string_error)?;
    let conn = Connection::open(data_dir.join(SNAPSHOTS_DB_FILE_NAME)).map_err(to_string_error)?;
    match file_header::prepare_sqlite(
        &conn,
        SNAPSHOTS_DB_FILE_NAME,
        file_header::SNAPSHOTS,
        SCHEMA,
    )? {
        SqliteOpen::Newer(recorded) => return Ok(SnapshotStore::Newer(recorded)),
        SqliteOpen::Ready => {}
    }
    Ok(SnapshotStore::Ready(conn))
}

// The store keeps every copy until someone deletes it: there is no age, count or
// size rule here, and its absence is a decision rather than an omission. The row
// a rule would drop is often the only one left — a pane must be emptied before it
// can be deleted, so once it is gone these copies hold the last of what was in
// it — and nothing about a copy's age or position says whether it still matters.
// The window browses and searches every row, the count is on screen, and Delete
// and Delete all are one action each, so forgetting stays the reader's to decide.
// Repeating a copy of a pane's latest text writes nothing, so only text the pane
// did not just hold adds a row.
const SCHEMA: &str = "
        create table if not exists snapshots (
          id text primary key,
          pane_id text not null,
          pane_title text not null default '',
          created_at_utc text not null,
          trigger text not null,
          content_hash text not null,
          content text not null
        );
        create index if not exists snapshots_pane
          on snapshots(pane_id);
        create index if not exists snapshots_time
          on snapshots(created_at_utc desc);
        ";

fn hash_content(content: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(content.as_bytes());
    hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

pub(crate) fn escape_like(term: &str) -> String {
    term.replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

fn to_string_error(error: impl std::fmt::Display) -> String {
    error.to_string()
}

#[cfg(test)]
// EXCEPTION to tests-folder conventions: the tests drive private helpers only —
// `atomic_write_json`, `SnapshotConnection`, `create_snapshot_with_connection`, `escape_like`,
// `hash_content` and the connection-taking deletes — which promoting would widen the crate's API for.
#[path = "../tests/unit/storage.rs"]
mod tests;
