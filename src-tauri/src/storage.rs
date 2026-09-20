use std::{
    fs::{self, File},
    io::Write,
    path::{Path, PathBuf},
};

use chrono::{SecondsFormat, Utc};
use rusqlite::{params, params_from_iter, types::Value, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use sha2::{Digest, Sha256};
use tauri::AppHandle;

use crate::paths::app_data_dir;

// The managed files the data directory holds, each named in exactly one place so
// the on-disk layout has a single source of truth.
//
// - `config.json`      — durable user settings.               RECORDED (managed text)
// - `state.json`       — UI/session state (view only).        RECORDED (managed text)
// - `window.json`      — native window state (view only).     RECORDED (managed text)
// - `panes.json`       — the panes' TEXT — the user's work.   RECORDED (managed text)
// - `snapshots.sqlite3` — the snapshot store.                 not recorded (binary + append-safe)
// - `backups.sqlite3`   — the write-through backup store.     not recorded (the store itself)
// - `logs/`             — per-session logs.                   not recorded (append-mode, by construction)
//
// Every managed-*text* write goes through `atomic_write_json`, which — strictly
// AFTER the atomic rename lands — records the exact bytes it just wrote into
// `backups.sqlite3` (see backup_store.rs). Only these four managed-text files reach
// that choke point; the enumeration of every write site under ~/.quickdeck and its
// record/no-record decision lives beside each write below.
pub const CONFIG_FILE_NAME: &str = "config.json";
pub const STATE_FILE_NAME: &str = "state.json";
pub const WINDOW_FILE_NAME: &str = "window.json";
pub const PANES_FILE_NAME: &str = "panes.json";
pub const SNAPSHOTS_DB_FILE_NAME: &str = "snapshots.sqlite3";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedAppData {
    pub config: Option<JsonValue>,
    // Where a corrupt config.json was set aside, so the frontend can report it
    // (an unreported quarantine is a silent reset — storage-path conventions).
    pub config_quarantined_to: Option<String>,
    pub state: Option<JsonValue>,
    pub panes: Option<JsonValue>,
    // Set when panes.json is present but unreadable: the user's text halts the
    // pane surface (file left exactly in place) while config and state still
    // load — per-store failure isolation.
    pub panes_error: Option<String>,
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
    /// Empty for a copy taken before titles were recorded.
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

pub fn load_app_data(app: &AppHandle) -> Result<LoadedAppData, String> {
    let data_dir = app_data_dir(app)?;
    // Per-store failure isolation (persisted-store-separation, Independent
    // recovery): each store takes its own branch, so a corrupt settings file
    // can never make the panes' text unreachable. Config and state are
    // rebuildable and quarantine-then-reset; panes.json carries the user's
    // work product and halts — its error rides in the result so the other
    // stores still load and the halt surface can offer a reset.
    let (config, config_quarantined_to) =
        read_rebuildable_store(&data_dir.join(CONFIG_FILE_NAME))?;
    // state.json contains only the active pane and zoom. Preserve and log corrupt
    // bytes, but do not surface a recovery dialog for disposable view state.
    let (state, _) = read_rebuildable_store(&data_dir.join(STATE_FILE_NAME))?;
    let (panes, panes_error) = match read_json_optional(&data_dir.join(PANES_FILE_NAME)) {
        Ok(value) => (value, None),
        Err(message) => (None, Some(message)),
    };
    ensure_snapshot_db(&data_dir)?;

    Ok(LoadedAppData {
        config,
        config_quarantined_to,
        state,
        panes,
        panes_error,
        data_dir: data_dir.to_string_lossy().into_owned(),
        debug_enabled: false,
        system_language: String::new(),
        system_locale: None,
    })
}

pub fn save_config(app: &AppHandle, config: JsonValue) -> Result<(), String> {
    // records: config.json is durable user settings — managed text, recorded on
    // every save (data-backup conventions).
    let data_dir = app_data_dir(app)?;
    atomic_write_json(&data_dir, &data_dir.join(CONFIG_FILE_NAME), &config)
}

pub fn save_state(app: &AppHandle, state: JsonValue) -> Result<(), String> {
    // records: state.json is pure view/session state (active pane, zoom) —
    // managed text, recorded on every save; the store's per-path content dedup
    // absorbs the churn (data-backup conventions).
    let data_dir = app_data_dir(app)?;
    atomic_write_json(&data_dir, &data_dir.join(STATE_FILE_NAME), &state)
}

pub fn load_window_state(app: &AppHandle) -> Result<Option<JsonValue>, String> {
    let data_dir = app_data_dir(app)?;
    read_rebuildable_store(&data_dir.join(WINDOW_FILE_NAME)).map(|(value, _)| value)
}

pub fn save_window_state(app: &AppHandle, state: JsonValue) -> Result<(), String> {
    let data_dir = app_data_dir(app)?;
    atomic_write_json(&data_dir, &data_dir.join(WINDOW_FILE_NAME), &state)
}

pub fn save_panes(app: &AppHandle, panes: JsonValue) -> Result<(), String> {
    // records: panes.json holds the panes' text — the user's durable work
    // product — managed text, recorded on every save (data-backup conventions).
    let data_dir = app_data_dir(app)?;
    atomic_write_json(&data_dir, &data_dir.join(PANES_FILE_NAME), &panes)
}

// The user-commanded reset behind the panes halt surface: sets the corrupt
// panes.json aside to its `.invalid` name (the same quarantine every
// rebuildable store performs automatically) and returns where it went, so the
// report can name it. The rename either lands or its failure propagates —
// never a silent fall-through to defaults over the preserved bytes
// (storage-path conventions: halting requires exactly this reset offer).
pub fn quarantine_corrupt_config(app: &AppHandle) -> Result<String, String> {
    // The frontend detects a shape-failed config (valid JSON, wrong types) and
    // takes the same corrupt branch the bytes-level reader takes: set the file
    // aside, reseed, report (storage-path conventions' shape-failure clause).
    let data_dir = app_data_dir(app)?;
    let path = data_dir.join(CONFIG_FILE_NAME);
    let quarantined = quarantine_name(&path);
    fs::rename(&path, &quarantined).map_err(to_string_error)?;
    crate::logging::warn(
        "shape-failed config.json quarantined",
        serde_json::json!({
            "file": path.to_string_lossy(),
            "quarantinedTo": quarantined.to_string_lossy(),
        }),
    );
    Ok(quarantined.to_string_lossy().into_owned())
}

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
    let transaction = conn.transaction().map_err(to_string_error)?;
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
    let mut sql =
        String::from("select id, pane_id, pane_title, created_at_utc, content from snapshots where 1 = 1");
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
    let conn = open_snapshot_db(&data_dir)?;
    create_snapshot_with_connection(&conn, snapshot)
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

    let content_hash = hash_content(&snapshot.content);
    let existing_id = conn
        .query_row(
            "select id from snapshots where pane_id = ?1 and content_hash = ?2 limit 1",
            params![snapshot.pane_id, content_hash],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(to_string_error)?;

    if let Some(id) = existing_id {
        return Ok(SnapshotWriteResult {
            inserted: false,
            id: Some(id),
        });
    }

    let now = Utc::now();
    // Data column: the canonical internal/serialized form (ISO 8601, exactly 3
    // fractional digits, Z). The id keeps the compact filename-style stamp — an
    // opaque, sortable, filesystem-safe key whose content-hash suffix makes it
    // unique even within the same second.
    let created_at_utc = now.to_rfc3339_opts(SecondsFormat::Millis, true);
    let id = format!(
        "{}-{}-{}",
        now.format("%Y%m%d-%H%M%S-utc"),
        snapshot.pane_id,
        &content_hash[..12]
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

fn read_json_optional(path: &Path) -> Result<Option<JsonValue>, String> {
    if !path.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(path).map_err(to_string_error)?;
    serde_json::from_str(&content)
        .map(Some)
        .map_err(to_string_error)
}

// `<stem>-<yyyymmdd-hhmmss-fff-utc>.invalid` beside the source — the
// derived-filename grammar with a moment discriminator (storage-path
// conventions' quarantine name), stamped by the one shared formatter.
fn quarantine_name(path: &Path) -> PathBuf {
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("store");
    path.with_file_name(format!(
        "{stem}-{}.invalid",
        crate::logging::session_stamp(Utc::now())
    ))
}

// Reads a REBUILDABLE store (config, view state): missing → None; parseable →
// Some; present-but-corrupt (unreadable bytes or unparseable JSON — a bytes
// parse, so UTF-8 garbage counts) → quarantine aside and return the `.invalid`
// path so the caller reports it, then None so launch proceeds and first-run
// materialization reseeds. The quarantine rename runs OUTSIDE the parse-failure
// handling: its own failure propagates as a load error rather than falling
// through to a default write over the preserved bytes (storage-path
// conventions). panes.json never takes this path — it holds the user's text
// and uses the halting reader above.
fn read_rebuildable_store(path: &Path) -> Result<(Option<JsonValue>, Option<String>), String> {
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok((None, None)),
        Err(err) => return Err(to_string_error(err)),
    };
    match serde_json::from_slice::<JsonValue>(&bytes) {
        Ok(value) => Ok((Some(value), None)),
        Err(parse_err) => {
            let quarantined = quarantine_name(path);
            fs::rename(path, &quarantined).map_err(|rename_err| {
                format!(
                    "could not quarantine corrupt {}: {rename_err} (parse error: {parse_err})",
                    path.display()
                )
            })?;
            crate::logging::warn(
                "corrupt store quarantined; continuing with defaults",
                serde_json::json!({
                    "file": path.to_string_lossy(),
                    "quarantinedTo": quarantined.to_string_lossy(),
                    "error": { "message": parse_err.to_string() },
                }),
            );
            Ok((None, Some(quarantined.to_string_lossy().into_owned())))
        }
    }
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
// window.json,
// and — crucially — the ONE place the data-backup hook lives. A managed-text write
// that bypasses this helper is a silent backup gap; there is deliberately no second
// atomic-write path in the app.
//
// Writes `value` to a same-directory `<stem>-<nanoid>.tmp` (the derived-filename
// grammar), then atomically renames it over `path`, so a crash mid-write cannot
// corrupt the target. STRICTLY AFTER the rename lands — the file is exactly where it
// belongs — it best-effort records the exact bytes just written into `backups.sqlite3`
// under `data_dir` (the caller's resolved root, from the single resolver). Recording
// before the rename would risk a "backup of a save that never happened": if the rename
// then failed, the history would hold a version that never reached disk. The recorded
// `bytes` is the same buffer written above — never a re-read of the file (which would
// risk capturing a concurrent writer's content). The record never throws back into
// this write and never affects the save's success (see backup_store.rs).
fn atomic_write_json(data_dir: &Path, path: &Path, value: &JsonValue) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("missing parent directory for {}", path.display()))?;
    fs::create_dir_all(parent).map_err(to_string_error)?;

    let tmp_path = temp_path_for(path)?;
    // The exact bytes that land on disk: pretty JSON plus the single trailing
    // newline. Building the whole buffer once (rather than two write_all calls)
    // is what lets the backup record a blob byte-identical to the file.
    let mut bytes = serde_json::to_vec_pretty(value).map_err(to_string_error)?;
    bytes.push(b'\n');

    // A failed write or rename must not leave the temp file behind — best-effort
    // removal on each error path (the fleet's shared write_atomic behavior).
    let write_tmp = (|| -> std::io::Result<()> {
        let mut file = File::create(&tmp_path)?;
        file.write_all(&bytes)?;
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

fn open_snapshot_db(data_dir: &Path) -> Result<Connection, String> {
    ensure_snapshot_db(data_dir)?;
    Connection::open(data_dir.join(SNAPSHOTS_DB_FILE_NAME)).map_err(to_string_error)
}

fn ensure_snapshot_db(data_dir: &Path) -> Result<(), String> {
    // not recorded: snapshots.sqlite3 (+ its -wal/-shm sidecars) is a binary,
    // append-safe store and the app's own recovery mechanism — excluded from the
    // managed-text backup layer, and separate from backups.sqlite3 (data-backup
    // conventions).
    fs::create_dir_all(data_dir).map_err(to_string_error)?;
    let conn = Connection::open(data_dir.join(SNAPSHOTS_DB_FILE_NAME)).map_err(to_string_error)?;
    init_schema(&conn)
}

// The store keeps every copy until someone deletes it: there is no age, count or
// size rule here, and its absence is a decision rather than an omission. The row
// a rule would drop is often the only one left — a pane must be emptied before it
// can be deleted, so once it is gone these copies hold the last of what was in
// it — and nothing about a copy's age or position says whether it still matters.
// The window browses and searches every row, the count is on screen, and Delete
// and Delete all are one action each, so forgetting stays the reader's to decide.
// The unique index on (pane_id, content_hash) is what keeps that affordable:
// repeating a copy writes nothing, so only genuinely new text adds a row.
fn init_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        pragma journal_mode = wal;
        create table if not exists snapshots (
          id text primary key,
          pane_id text not null,
          pane_title text not null default '',
          created_at_utc text not null,
          trigger text not null,
          content_hash text not null,
          content text not null
        );
        create unique index if not exists snapshots_unique_pane_content
          on snapshots(pane_id, content_hash);
        create index if not exists snapshots_pane_time
          on snapshots(pane_id, created_at_utc desc);
        create index if not exists snapshots_time
          on snapshots(created_at_utc desc);
        ",
    )
    .map_err(to_string_error)?;

    // A store written before titles were recorded gains the column; its existing rows keep
    // the empty title they were saved with, which the app reads as "pane unknown".
    let has_title = conn
        .prepare("select 1 from pragma_table_info('snapshots') where name = 'pane_title'")
        .and_then(|mut statement| statement.exists([]))
        .map_err(to_string_error)?;
    if !has_title {
        conn.execute_batch("alter table snapshots add column pane_title text not null default '';")
            .map_err(to_string_error)?;
    }

    Ok(())
}

fn hash_content(content: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(content.as_bytes());
    hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn escape_like(term: &str) -> String {
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
