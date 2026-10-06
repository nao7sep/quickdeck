use std::{
    fs::{self, File},
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};

use chrono::{SecondsFormat, Utc};
use rusqlite::{
    params, params_from_iter, types::Value, Connection, OptionalExtension, Transaction,
    TransactionBehavior,
};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use sha2::{Digest, Sha256};
use tauri::AppHandle;

use crate::format_version::{self, JsonFormat, SqliteFormat};
use crate::paths::app_data_dir;

// The managed files the data directory holds, each named in exactly one place so
// the on-disk layout has a single source of truth.
//
// - `config.json`      — durable user settings.               RECORDED (managed text)
// - `state.json`       — UI/session state (view only).        not recorded (volatile state)
// - `window.json`      — native window state (view only).     not recorded (volatile state)
// - `panes.json`       — the panes' TEXT — the user's work.   RECORDED (managed text)
// - `snapshots.sqlite3` — the snapshot store.                 not recorded (binary + append-safe)
// - `backups.sqlite3`   — the write-through backup store.     not recorded (the store itself)
// - `backups/`          — archive zips, `.lock`, `.running`.  not recorded (binary; archive.rs)
// - `records.sqlite3`   — log lines (logging.rs).             not recorded (binary; never archived)
// - `logs/`             — log lines whose record write failed. not recorded (append-mode, by construction)
//
// Every managed-*text* write goes through `write_json_atomically`, which skips a
// write whose bytes equal the file's (content-lifecycle conventions). The recorded
// files (config.json, panes.json) use `atomic_write_json`, which — strictly AFTER
// the atomic rename lands — records the exact bytes it just wrote into
// `backups.sqlite3` (see backup_store.rs); the volatile-state files (state.json,
// window.json) use `atomic_write_json_unrecorded`. Only these four managed-text files
// reach that choke point; the enumeration of every write site under ~/.quickdeck and
// its record/no-record decision lives beside each write below.
pub const CONFIG_FILE_NAME: &str = "config.json";
pub const STATE_FILE_NAME: &str = "state.json";
pub const WINDOW_FILE_NAME: &str = "window.json";
pub const PANES_FILE_NAME: &str = "panes.json";
// Original relative path and archive-root entry name, beside the store paths.
pub const ARCHIVED_STORES: &[(&str, &str)] = &[(SNAPSHOTS_DB_FILE_NAME, SNAPSHOTS_DB_FILE_NAME)];
pub const SNAPSHOTS_DB_FILE_NAME: &str = "snapshots.sqlite3";
pub const RECORDS_DB_FILE_NAME: &str = "records.sqlite3";

// The Records window's list width, which state.json holds beside the main
// window's view state. The main window writes the file whole without knowing it,
// so every state.json write is a read-modify-write under STATE_LOCK that carries
// it over (window conventions: the width is saved only when a drag ends).
pub const RECORDS_LIST_WIDTH_KEY: &str = "recordsListWidth";
static STATE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedAppData {
    pub config: Option<JsonValue>,
    // Where a corrupt config.json was set aside, so the frontend can report it
    // (an unreported quarantine is a silent reset — storage-path conventions).
    pub config_quarantined_to: Option<String>,
    // The format a config.json from a newer build records. The file is left
    // exactly in place and the app runs on built-in settings without saving
    // them, so the frontend tells the user.
    pub config_newer: Option<u32>,
    pub state: Option<JsonValue>,
    pub panes: Option<JsonValue>,
    // Set when panes.json is present but unreadable: the user's text halts the
    // pane surface (file left exactly in place) while config and state still
    // load — per-store failure isolation.
    pub panes_error: Option<String>,
    // The formats a panes.json or snapshots.sqlite3 from a newer build records:
    // each halts the app with the file left exactly in place, and offers no reset.
    pub panes_newer: Option<u32>,
    pub snapshots_newer: Option<u32>,
    // Where panes.json and snapshots.sqlite3 live, so a halt on either names
    // the file (store-recovery conventions).
    pub panes_path: String,
    pub snapshots_path: String,
    pub data_dir: String,
    // Whether developer-only debug logging is on. Set by the command layer
    // (see lib.rs) from logging::debug_enabled(); storage leaves it false.
    pub debug_enabled: bool,
    // The computer's language and regional locale, read at launch. Set by the
    // command layer from i18n::LanguageState; storage leaves them empty.
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
    let data_dir = app_data_dir(app)?;
    // Per-store failure isolation (persisted-store-separation, Independent
    // recovery): each store takes its own branch, so a corrupt settings file
    // can never make the panes' text unreachable. Config and state are
    // rebuildable and quarantine-then-reset; panes.json carries the user's
    // work product and halts — its error rides in the result so the other
    // stores still load and the halt surface can offer a reset.
    let config_path = data_dir.join(CONFIG_FILE_NAME);
    let config = read_rebuildable_store(&config_path, format_version::CONFIG)
        .map_err(LoadFailure::at(&config_path))?;
    // state.json contains only the active pane and zoom. Preserve and log corrupt
    // bytes, or a newer format, but do not surface a dialog for disposable view
    // state.
    let state_path = data_dir.join(STATE_FILE_NAME);
    let state = read_rebuildable_store(&state_path, format_version::STATE)
        .map_err(LoadFailure::at(&state_path))?;
    let panes_path = data_dir.join(PANES_FILE_NAME);
    let (panes, panes_error, panes_newer) =
        match read_json_store(&panes_path, format_version::PANES) {
            Ok(JsonRead::Absent) => (None, None, None),
            Ok(JsonRead::Readable(fields)) => (Some(JsonValue::Object(fields)), None, None),
            Ok(JsonRead::Newer(recorded)) => (None, None, Some(recorded)),
            Ok(JsonRead::Corrupt(message)) | Err(message) => (None, Some(message), None),
        };
    let snapshots_path = data_dir.join(SNAPSHOTS_DB_FILE_NAME);
    let snapshots_newer =
        match open_snapshot_store(&data_dir).map_err(LoadFailure::at(&snapshots_path))? {
            SnapshotStore::Ready(_) => None,
            SnapshotStore::Newer(recorded) => Some(recorded),
        };
    for (path, newer) in [
        (&config_path, config.newer),
        (&state_path, state.newer),
        (&panes_path, panes_newer),
        (&snapshots_path, snapshots_newer),
    ] {
        if let Some(recorded) = newer {
            report_newer(path, recorded);
        }
    }

    Ok(LoadedAppData {
        config: config.value.map(JsonValue::Object),
        config_quarantined_to: config.quarantined_to,
        config_newer: config.newer,
        state: state.value.map(JsonValue::Object),
        panes,
        panes_error,
        panes_newer,
        snapshots_newer,
        panes_path: panes_path.to_string_lossy().into_owned(),
        snapshots_path: snapshots_path.to_string_lossy().into_owned(),
        data_dir: data_dir.to_string_lossy().into_owned(),
        debug_enabled: false,
        system_language: String::new(),
        system_locale: None,
    })
}

// What a config save writes, and where an unreadable config.json found on the
// way was set aside, so the frontend can report it (store-recovery conventions).
#[derive(Debug, PartialEq)]
pub struct ConfigToWrite {
    pub content: Option<JsonValue>,
    pub quarantined_to: Option<String>,
}

// The file content for the given sets — every set that differs from its
// built-in, which the frontend decides — keeping only known keys, or None when
// that equals the file, so an absent file stays absent and a file whose sets are
// all back at their built-ins keeps only its format marker.
pub fn config_to_write(data_dir: &Path, sets: JsonValue) -> Result<ConfigToWrite, String> {
    const KEYS: &[&str] = &[
        "language",
        "theme",
        "zen",
        "topmost",
        "uiFontFamily",
        "autosaveDelaySeconds",
        "snapshotSearchPageSize",
        "editorFont",
    ];
    let current = read_rebuildable_store(&data_dir.join(CONFIG_FILE_NAME), format_version::CONFIG)?;
    let mut stored = sets
        .as_object()
        .ok_or("config sets are not an object")?
        .clone();
    stored.retain(|key, _| KEYS.contains(&key.as_str()));
    Ok(ConfigToWrite {
        content: (current.value.unwrap_or_default() != stored).then_some(JsonValue::Object(stored)),
        quarantined_to: current.quarantined_to,
    })
}

pub fn write_config(data_dir: &Path, config: &JsonValue) -> Result<(), String> {
    // records: config.json is durable user settings — managed text, recorded on
    // every save that changes it (data-backup conventions).
    atomic_write_json(
        data_dir,
        &data_dir.join(CONFIG_FILE_NAME),
        config,
        format_version::CONFIG,
    )
}

pub fn save_state(app: &AppHandle, state: JsonValue) -> Result<(), String> {
    save_state_in(&app_data_dir(app)?, state)
}

fn save_state_in(data_dir: &Path, mut state: JsonValue) -> Result<(), String> {
    // not recorded: state.json is pure view/session state (active pane, zoom, the
    // Records list width) — volatile state, kept out of the backup history
    // (data-backup conventions).
    let path = data_dir.join(STATE_FILE_NAME);
    let _guard = STATE_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let carried =
        read_state_object(&path).and_then(|stored| stored.get(RECORDS_LIST_WIDTH_KEY).cloned());
    if let (Some(width), Some(object)) = (carried, state.as_object_mut()) {
        object.entry(RECORDS_LIST_WIDTH_KEY).or_insert(width);
    }
    atomic_write_json_unrecorded(&path, &state, format_version::STATE)
}

pub fn records_list_width(app: &AppHandle) -> Result<Option<f64>, String> {
    records_list_width_in(&app_data_dir(app)?)
}

fn records_list_width_in(data_dir: &Path) -> Result<Option<f64>, String> {
    let _guard = STATE_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    Ok(
        read_state_object(&data_dir.join(STATE_FILE_NAME)).and_then(|stored| {
            stored
                .get(RECORDS_LIST_WIDTH_KEY)
                .and_then(JsonValue::as_f64)
        }),
    )
}

pub fn save_records_list_width(app: &AppHandle, width: u32) -> Result<(), String> {
    save_records_list_width_in(&app_data_dir(app)?, width)
}

fn save_records_list_width_in(data_dir: &Path, width: u32) -> Result<(), String> {
    let path = data_dir.join(STATE_FILE_NAME);
    let _guard = STATE_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    // An unreadable file is left for the launch's recovery to set aside rather
    // than overwritten here; a newer one is never overwritten by the write below.
    let mut state = match read_json_store(&path, format_version::STATE)? {
        JsonRead::Absent | JsonRead::Newer(_) => serde_json::Map::new(),
        JsonRead::Readable(fields) => fields,
        JsonRead::Corrupt(reason) => return Err(reason),
    };
    state.insert(RECORDS_LIST_WIDTH_KEY.to_string(), JsonValue::from(width));
    atomic_write_json_unrecorded(&path, &JsonValue::Object(state), format_version::STATE)
}

// state.json as an object, or None when it is missing, unreadable or newer; its
// recovery stays with the launch's load path.
fn read_state_object(path: &Path) -> Option<serde_json::Map<String, JsonValue>> {
    match read_json_store(path, format_version::STATE) {
        Ok(JsonRead::Readable(fields)) => Some(fields),
        _ => None,
    }
}

pub fn load_window_state(app: &AppHandle) -> Result<Option<JsonValue>, String> {
    let path = app_data_dir(app)?.join(WINDOW_FILE_NAME);
    let loaded = read_rebuildable_store(&path, format_version::WINDOW)?;
    if let Some(recorded) = loaded.newer {
        report_newer(&path, recorded);
    }
    Ok(loaded.value.map(JsonValue::Object))
}

pub fn save_window_state(data_dir: &Path, state: JsonValue) -> Result<(), String> {
    // not recorded: window.json is pure window geometry — volatile state, kept out
    // of the backup history (data-backup conventions).
    atomic_write_json_unrecorded(
        &data_dir.join(WINDOW_FILE_NAME),
        &state,
        format_version::WINDOW,
    )
}

pub fn save_panes(app: &AppHandle, panes: JsonValue) -> Result<(), String> {
    // records: panes.json holds the panes' text — the user's durable work
    // product — managed text, recorded on every save that changes it (data-backup
    // conventions).
    let data_dir = app_data_dir(app)?;
    atomic_write_json(
        &data_dir,
        &data_dir.join(PANES_FILE_NAME),
        &panes,
        format_version::PANES,
    )
}

// The user-commanded reset behind the panes halt surface: sets the corrupt
// panes.json aside to its `.invalid` name (the same quarantine every
// rebuildable store performs automatically) and returns where it went, so the
// report can name it. The rename either lands or its failure propagates —
// never a silent fall-through to defaults over the preserved bytes
// (storage-path conventions: halting requires exactly this reset offer).
pub fn quarantine_corrupt_panes(app: &AppHandle) -> Result<String, String> {
    let data_dir = app_data_dir(app)?;
    let path = data_dir.join(PANES_FILE_NAME);
    let quarantined = quarantine_name(&path);
    fs::rename(&path, &quarantined).map_err(to_string_error)?;
    crate::logging::warn(
        "corrupt panes.json set aside on user command",
        serde_json::json!({
            "file": path.to_string_lossy(),
            "quarantinedTo": quarantined.to_string_lossy(),
        }),
    );
    Ok(quarantined.to_string_lossy().into_owned())
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
    let data_dir = app_data_dir(app)?;
    let mut conn = open_snapshot_db(&data_dir)?;
    let transaction = begin_snapshot_write(&mut conn)?;
    let results = snapshots
        .into_iter()
        .map(|snapshot| create_snapshot_with_connection(&transaction, snapshot))
        .collect::<Result<Vec<_>, _>>()?;
    transaction.commit().map_err(to_string_error)?;
    Ok(results)
}

pub fn list_snapshots(
    app: &AppHandle,
    query: String,
    limit: u32,
    offset: u32,
) -> Result<SnapshotListResult, String> {
    let data_dir = app_data_dir(app)?;
    let conn = open_snapshot_db(&data_dir)?;
    list_snapshots_with_connection(&conn, &query, limit, offset)
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

    let bounded_limit = limit.clamp(1, 200);
    let fetch_limit = bounded_limit + 1;
    let mut sql = String::from(
        "select id, pane_id, pane_title, created_at_utc, content from snapshots where 1 = 1",
    );
    let mut values: Vec<Value> = Vec::new();

    for term in terms {
        sql.push_str(" and lower(content) like ? escape '\\'");
        values.push(Value::Text(format!("%{}%", escape_like(&term))));
    }

    // id is the tiebreaker so pagination stays stable when several snapshots
    // share an identical created_at_utc. Without it, LIMIT/OFFSET pages could
    // repeat or skip rows with the same timestamp. Each id begins with its own
    // timestamp, so `id desc` keeps newest-first within a tie.
    sql.push_str(" order by created_at_utc desc, id desc limit ? offset ?");
    values.push(Value::Integer(fetch_limit as i64));
    values.push(Value::Integer(offset as i64));

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

    let has_more = rows.len() > bounded_limit as usize;
    rows.truncate(bounded_limit as usize);

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

    let data_dir = app_data_dir(app)?;
    let mut conn = open_snapshot_db(&data_dir)?;
    let transaction = begin_snapshot_write(&mut conn)?;
    let result = create_snapshot_with_connection(&transaction, snapshot)?;
    transaction.commit().map_err(to_string_error)?;
    Ok(result)
}

// Snapshot commands run concurrently, so a write takes SQLite's write lock before
// its duplicate check: two copies of the same text then cannot both pass the
// check and store it twice.
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
    // pane held before and returned to is recorded again. Latest is newest in the
    // order the window lists, with insertion order breaking a same-instant tie.
    let content_hash = hash_content(&snapshot.content);
    let latest = conn
        .query_row(
            "select id, content_hash from snapshots where pane_id = ?1
             order by created_at_utc desc, rowid desc limit 1",
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

    // not recorded: this writes into snapshots.sqlite3, a binary SQLite file that is
    // effectively appended (near-zero accidental-truncation risk) and is itself the
    // app's own recovery mechanism — two independent reasons it is not written through
    // the managed-text backup layer (data-backup conventions). It also never touches
    // atomic_write_json, so it never reaches the record hook by construction.
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
    let data_dir = app_data_dir(app)?;
    let conn = open_snapshot_db(&data_dir)?;
    let count: i64 = conn
        .query_row("select count(*) from snapshots", [], |row| row.get(0))
        .map_err(to_string_error)?;
    Ok(count.max(0) as u64)
}

/// Removes one snapshot. Returns whether a row was there to remove, so a copy deleted from
/// two windows at once reports honestly rather than twice.
pub fn delete_snapshot(app: &AppHandle, id: String) -> Result<bool, String> {
    let data_dir = app_data_dir(app)?;
    let conn = open_snapshot_db(&data_dir)?;
    delete_snapshot_with_connection(&conn, &id)
}

fn delete_snapshot_with_connection(conn: &Connection, id: &str) -> Result<bool, String> {
    let removed = conn
        .execute("delete from snapshots where id = ?1", params![id])
        .map_err(to_string_error)?;
    Ok(removed > 0)
}

/// Empties the store and returns how many copies went. The file itself stays: it is the
/// app's own recovery store, and an empty one is the normal state on a first run.
pub fn delete_all_snapshots(app: &AppHandle) -> Result<u64, String> {
    let data_dir = app_data_dir(app)?;
    let conn = open_snapshot_db(&data_dir)?;
    delete_all_snapshots_with_connection(&conn)
}

fn delete_all_snapshots_with_connection(conn: &Connection) -> Result<u64, String> {
    let removed = conn
        .execute("delete from snapshots", [])
        .map_err(to_string_error)?;
    Ok(removed as u64)
}

// What a JSON store's file holds, its format marker checked and removed.
#[derive(Debug, PartialEq)]
enum JsonRead {
    Absent,
    Readable(serde_json::Map<String, JsonValue>),
    // Recorded in this newer format: intact data this build cannot read, which
    // is reported and left exactly in place (store-recovery conventions).
    Newer(u32),
    // Bytes that do not parse, or a format marker that is missing or not a
    // positive integer.
    Corrupt(String),
}

// The one reader every JSON store loads through. Absence is not an error; a
// failure to read the bytes at all is, and the caller's branch decides the rest.
fn read_json_store(path: &Path, version: u32) -> Result<JsonRead, String> {
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(JsonRead::Absent),
        Err(err) => return Err(to_string_error(err)),
    };
    let value = match serde_json::from_slice::<JsonValue>(&bytes) {
        Ok(value) => value,
        Err(parse_err) => return Ok(JsonRead::Corrupt(parse_err.to_string())),
    };
    Ok(match format_version::read_json(value, version) {
        Ok(JsonFormat::Readable(value)) => JsonRead::Readable(value),
        Ok(JsonFormat::Newer(recorded)) => JsonRead::Newer(recorded),
        Err(reason) => JsonRead::Corrupt(reason),
    })
}

// Logs a store found in a newer format, by name, at the load that found it.
fn report_newer(path: &Path, recorded: u32) {
    let file = path.file_name().unwrap_or_default().to_string_lossy();
    crate::logging::warn(
        "store from a newer build left in place",
        serde_json::json!({
            "file": path.to_string_lossy(),
            "error": { "message": format_version::newer_message(&file, recorded) },
        }),
    );
}

// `<stem>-<yyyymmdd-hhmmss-fff-utc>.invalid` beside the source — the
// derived-filename grammar with a moment discriminator (storage-path
// conventions' quarantine name), stamped by the one shared formatter.
fn quarantine_name(path: &Path) -> PathBuf {
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("store");
    path.with_file_name(format!(
        "{stem}-{}.invalid",
        crate::logging::session_stamp(Utc::now())
    ))
}

// A rebuildable store's load: its value, where a corrupt file was set aside, or
// the newer format a file was left in place at. At most one is set.
#[derive(Debug, Default, PartialEq)]
struct Rebuildable {
    value: Option<serde_json::Map<String, JsonValue>>,
    quarantined_to: Option<String>,
    newer: Option<u32>,
}

// Reads a REBUILDABLE store (config, view state): missing → nothing; readable →
// its value; newer → left in place and reported as newer, so launch proceeds
// with built-ins; present-but-corrupt (unreadable bytes, unparseable JSON — a
// bytes parse, so UTF-8 garbage counts — or a missing or bad format marker,
// which every non-object lacks) → quarantine
// aside and return the `.invalid` path so the caller reports it, then built-ins.
// The quarantine rename runs OUTSIDE the parse-failure
// handling: its own failure propagates as a load error rather than falling
// through to a default write over the preserved bytes (storage-path
// conventions). panes.json never takes this path — it holds the user's text
// and halts instead.
fn read_rebuildable_store(path: &Path, version: u32) -> Result<Rebuildable, String> {
    Ok(match read_json_store(path, version)? {
        JsonRead::Absent => Rebuildable::default(),
        JsonRead::Readable(fields) => Rebuildable {
            value: Some(fields),
            ..Rebuildable::default()
        },
        JsonRead::Newer(recorded) => Rebuildable {
            newer: Some(recorded),
            ..Rebuildable::default()
        },
        JsonRead::Corrupt(reason) => quarantine_rebuildable_store(path, &reason)?,
    })
}

/// config.json's settings for the reads made before the load path runs (the
/// menu language, the window theme): None for a file that does not parse or
/// is in a newer format, as the load path will report it.
pub fn launch_config(text: &str) -> Option<serde_json::Map<String, JsonValue>> {
    let value = serde_json::from_str(text).ok()?;
    match format_version::read_json(value, format_version::CONFIG).ok()? {
        JsonFormat::Readable(fields) => Some(fields),
        JsonFormat::Newer(_) => None,
    }
}

fn quarantine_rebuildable_store(path: &Path, reason: &str) -> Result<Rebuildable, String> {
    let quarantined = quarantine_name(path);
    fs::rename(path, &quarantined).map_err(|rename_err| {
        format!(
            "could not quarantine corrupt {}: {rename_err} ({reason})",
            path.display()
        )
    })?;
    crate::logging::warn(
        "corrupt store quarantined; continuing with defaults",
        serde_json::json!({
            "file": path.to_string_lossy(),
            "quarantinedTo": quarantined.to_string_lossy(),
            "error": { "message": reason },
        }),
    );
    Ok(Rebuildable {
        quarantined_to: Some(quarantined.to_string_lossy().into_owned()),
        ..Rebuildable::default()
    })
}

// The atomic-write temp name for `path`: `<stem>-<discriminator>.tmp`, alongside
// `path` in the same directory (never a different placement). The discriminator
// is a nanoid, per house style, generated by this Rust core's own hand-rolled
// helper (see nanoid.rs) — a crate-free equivalent of the frontend's `nanoid`
// package, since that JS dependency isn't reachable from here.
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
// window.json and panes.json (`write_json_atomically`), and — crucially — the ONE
// place the data-backup hook lives (`atomic_write_json`). A recorded managed-text
// write that bypasses `atomic_write_json` is a silent backup gap; the volatile-state
// stores opt out of recording through `atomic_write_json_unrecorded`, which shares
// the same atomic write.
//
// Writes `value` to a same-directory `<stem>-<nanoid>.tmp` (the derived-filename
// grammar), then atomically renames it over `path`, so a crash mid-write cannot
// corrupt the target; bytes equal to the file's are not written at all, so neither
// the file nor the backup history sees a save that changed nothing. STRICTLY AFTER
// the rename lands — the file is exactly where it belongs — it best-effort records
// the exact bytes just written into `backups.sqlite3`
// under `data_dir` (the caller's resolved root, from the single resolver). Recording
// before the rename would risk a "backup of a save that never happened": if the rename
// then failed, the history would hold a version that never reached disk. The recorded
// `bytes` is the same buffer written above — never a re-read of the file (which would
// risk capturing a concurrent writer's content). The record never throws back into
// this write and never affects the save's success (see backup_store.rs).
fn atomic_write_json(
    data_dir: &Path,
    path: &Path,
    value: &JsonValue,
    version: u32,
) -> Result<(), String> {
    let Some(bytes) = write_json_atomically(path, value, version)? else {
        return Ok(());
    };

    // After the rename: the file is exactly where it belongs, so record the bytes we
    // just wrote. Best-effort — record() catches, logs once, and swallows every
    // failure, so a backup problem can never break the save that already succeeded.
    crate::backup_store::record(
        &data_dir.join(crate::backup_store::BACKUPS_DB_FILE_NAME),
        path,
        &bytes,
    );

    Ok(())
}

// The same atomic write without the backup record, for volatile state (state.json,
// window.json) that stays out of the backup history.
fn atomic_write_json_unrecorded(
    path: &Path,
    value: &JsonValue,
    version: u32,
) -> Result<(), String> {
    write_json_atomically(path, value, version).map(|_| ())
}

// The temp-file-then-rename write itself, with `version` recorded as the file's
// format marker; returns the exact bytes now on disk, or None when nothing was
// written: the file already held them, or it records a newer format. A newer
// file is never written to (store-recovery conventions); the load that found it
// reported it, so the skip itself is silent.
fn write_json_atomically(
    path: &Path,
    value: &JsonValue,
    version: u32,
) -> Result<Option<Vec<u8>>, String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("missing parent directory for {}", path.display()))?;

    // The exact bytes that land on disk: pretty JSON plus the single trailing
    // newline. Building the whole buffer once (rather than two write_all calls)
    // is what lets the backup record a blob byte-identical to the file.
    let stamped = format_version::stamp_json(value, version)?;
    let mut bytes = serde_json::to_vec_pretty(&stamped).map_err(to_string_error)?;
    bytes.push(b'\n');
    // A missing or unreadable file is written.
    if let Ok(current) = fs::read(path) {
        let newer = || {
            serde_json::from_slice(&current)
                .ok()
                .and_then(|current| format_version::read_json(current, version).ok())
                .is_some_and(|format| matches!(format, JsonFormat::Newer(_)))
        };
        if current == bytes || newer() {
            return Ok(None);
        }
    }

    fs::create_dir_all(parent).map_err(to_string_error)?;
    let tmp_path = temp_path_for(path)?;

    // A failed write or rename removes its own temp, best-effort, on each error
    // path. Nothing else ever removes a temp: a startup sweep could delete a
    // concurrent instance's in-flight one, so a crash-stranded temp is left as
    // harmless debris (storage-path-conventions).
    let write_tmp = (|| -> std::io::Result<()> {
        let mut file = File::create(&tmp_path)?;
        file.write_all(&bytes)?;
        #[cfg(target_os = "macos")]
        carry_replaced_metadata(path, &file, &tmp_path)?;
        file.sync_all()?;
        Ok(())
    })();
    if let Err(error) = write_tmp {
        let _ = fs::remove_file(&tmp_path);
        return Err(to_string_error(error));
    }

    if let Err(error) = fs::rename(&tmp_path, path) {
        let _ = fs::remove_file(&tmp_path);
        return Err(to_string_error(error));
    }
    if let Ok(directory) = File::open(parent) {
        let _ = directory.sync_all();
    }

    Ok(Some(bytes))
}

// A replace keeps the original's permissions, ACL and extended attributes, Finder
// tags among them (content-lifecycle conventions: a replace keeps what it can).
// The flags never include COPYFILE_STAT or COPYFILE_SECURITY, which would also
// carry the original's modified time; a volume that holds no ACL or extended
// attributes keeps the rest. Windows replaces without carrying metadata.
#[cfg(target_os = "macos")]
fn carry_replaced_metadata(original: &Path, tmp: &File, tmp_path: &Path) -> std::io::Result<()> {
    use std::ffi::{c_int, c_void};
    use std::os::fd::AsRawFd;

    extern "C" {
        fn fcopyfile(from: c_int, to: c_int, state: *mut c_void, flags: u32) -> c_int;
    }
    const COPYFILE_ACL: u32 = 1 << 0;
    const COPYFILE_XATTR: u32 = 1 << 2;
    const ENOTSUP: i32 = 45;

    let source = match File::open(original) {
        Ok(source) => source,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error),
    };
    // SAFETY: both descriptors stay open for the call, and fcopyfile accepts a
    // null state.
    let copied = unsafe {
        fcopyfile(
            source.as_raw_fd(),
            tmp.as_raw_fd(),
            std::ptr::null_mut(),
            COPYFILE_ACL | COPYFILE_XATTR,
        )
    };
    if copied != 0 {
        let error = std::io::Error::last_os_error();
        if error.raw_os_error() != Some(ENOTSUP) {
            return Err(error);
        }
    }
    fs::set_permissions(tmp_path, source.metadata()?.permissions())
}

// The snapshot store, opened for use, or the newer format it records, in which
// case it was left untouched.
enum SnapshotStore {
    Ready(Connection),
    Newer(u32),
}

fn open_snapshot_db(data_dir: &Path) -> Result<Connection, String> {
    match open_snapshot_store(data_dir)? {
        SnapshotStore::Ready(conn) => Ok(conn),
        SnapshotStore::Newer(recorded) => Err(format_version::newer_message(
            SNAPSHOTS_DB_FILE_NAME,
            recorded,
        )),
    }
}

fn open_snapshot_store(data_dir: &Path) -> Result<SnapshotStore, String> {
    // not recorded: snapshots.sqlite3 (+ its -wal/-shm sidecars) is a binary,
    // append-safe store and the app's own recovery mechanism — excluded from the
    // managed-text backup layer, and separate from backups.sqlite3 (data-backup
    // conventions).
    fs::create_dir_all(data_dir).map_err(to_string_error)?;
    let conn = Connection::open(data_dir.join(SNAPSHOTS_DB_FILE_NAME)).map_err(to_string_error)?;
    // WAL alone only orders writers; without this a second writer contending for
    // the write lock (e.g. two panes' copy/paste snapshots, or a close-time batch
    // racing an in-flight single snapshot) fails immediately with SQLITE_BUSY
    // instead of waiting, exactly as backup_store::open_store's comment explains.
    conn.pragma_update(None, "busy_timeout", 5000)
        .map_err(to_string_error)?;
    match format_version::check_sqlite(&conn, SNAPSHOTS_DB_FILE_NAME, format_version::SNAPSHOTS)? {
        SqliteFormat::Newer(recorded) => return Ok(SnapshotStore::Newer(recorded)),
        SqliteFormat::New => init_schema(&conn)?,
        SqliteFormat::Readable => {}
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
fn init_schema(conn: &Connection) -> Result<(), String> {
    conn.pragma_update(None, "journal_mode", "WAL")
        .and_then(|_| format_version::create_sqlite(conn, SCHEMA, format_version::SNAPSHOTS))
        .map_err(to_string_error)
}

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
        create index if not exists snapshots_pane_time
          on snapshots(pane_id, created_at_utc desc);
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
// `atomic_write_json`, `create_snapshot_with_connection`, `escape_like`, `hash_content` and the
// connection-taking deletes — which promoting would widen the crate's API for.
#[path = "../tests/unit/storage.rs"]
mod tests;
