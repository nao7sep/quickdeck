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

// The three files the data directory holds, each named in exactly one place so
// the on-disk layout has a single source of truth.
//
// - `config.json`      — durable user settings.               RECORDED (managed text)
// - `state.json`       — UI/session state (view only).        RECORDED (managed text)
// - `panes.json`       — the panes' TEXT — the user's work.   RECORDED (managed text)
// - `snapshots.sqlite3` — the snapshot store.                 not recorded (binary + append-safe)
// - `backups.sqlite3`   — the write-through backup store.     not recorded (the store itself)
// - `logs/`             — per-session logs.                   not recorded (append-mode, by construction)
//
// Every managed-*text* write goes through `atomic_write_json`, which — strictly
// AFTER the atomic rename lands — records the exact bytes it just wrote into
// `backups.sqlite3` (see backup_store.rs). Only these two managed-text files reach
// that choke point; the enumeration of every write site under ~/.quickdeck and its
// record/no-record decision lives beside each write below.
pub const CONFIG_FILE_NAME: &str = "config.json";
pub const STATE_FILE_NAME: &str = "state.json";
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
    pub trigger: String,
    pub content: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotSearchRow {
    pub id: String,
    pub created_at_utc: String,
    pub content: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotSearchResult {
    pub rows: Vec<SnapshotSearchRow>,
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
    trigger: String,
    content: String,
) -> Result<SnapshotWriteResult, String> {
    create_snapshot_from_input(
        app,
        SnapshotInput {
            pane_id,
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

pub fn search_snapshots(
    app: &AppHandle,
    query: String,
    limit: u32,
    offset: u32,
) -> Result<SnapshotSearchResult, String> {
    let data_dir = app_data_dir(app)?;
    let conn = open_snapshot_db(&data_dir)?;
    search_snapshots_with_connection(&conn, &query, limit, offset)
}

fn search_snapshots_with_connection(
    conn: &Connection,
    query: &str,
    limit: u32,
    offset: u32,
) -> Result<SnapshotSearchResult, String> {
    let terms = query
        .split_whitespace()
        .map(|term| term.to_lowercase())
        .filter(|term| !term.is_empty())
        .collect::<Vec<_>>();

    if terms.is_empty() {
        return Ok(SnapshotSearchResult {
            rows: Vec::new(),
            has_more: false,
        });
    }

    let bounded_limit = limit.clamp(1, 200);
    let fetch_limit = bounded_limit + 1;
    let mut sql =
        String::from("select id, created_at_utc, content from snapshots where 1 = 1");
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
            Ok(SnapshotSearchRow {
                id: row.get(0)?,
                created_at_utc: row.get(1)?,
                content: row.get(2)?,
            })
        })
        .map_err(to_string_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(to_string_error)?;

    let has_more = rows.len() > bounded_limit as usize;
    rows.truncate(bounded_limit as usize);

    Ok(SnapshotSearchResult { rows, has_more })
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
        "insert into snapshots (id, pane_id, created_at_utc, trigger, content_hash, content)
         values (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            id,
            snapshot.pane_id,
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

// The single managed-text atomic-write choke point for config.json and state.json,
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

fn init_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        pragma journal_mode = wal;
        create table if not exists snapshots (
          id text primary key,
          pane_id text not null,
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
mod tests {
    use super::*;
    use serial_test::serial;

    fn mem_db() -> Connection {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        init_schema(&conn).expect("init schema");
        conn
    }

    fn input(pane: &str, content: &str) -> SnapshotInput {
        SnapshotInput {
            pane_id: pane.to_string(),
            trigger: "copy".to_string(),
            content: content.to_string(),
        }
    }

    // Inserts a snapshot row with an explicit timestamp so ordering and
    // pagination tests don't depend on Utc::now()'s second granularity.
    fn insert_row(conn: &Connection, id: &str, pane: &str, created_at_utc: &str, content: &str) {
        conn.execute(
            "insert into snapshots (id, pane_id, created_at_utc, trigger, content_hash, content)
             values (?1, ?2, ?3, 'copy', ?4, ?5)",
            params![id, pane, created_at_utc, hash_content(content), content],
        )
        .expect("insert row");
    }

    // --- config serialization ----------------------------------------------

    #[test]
    fn json_object_key_order_is_preserved() {
        // QuickDeck relies on serde_json's `preserve_order` feature so config.json
        // round-trips in the frontend's field order (dark -> zen -> topmost ...)
        // instead of being alphabetized. Without the feature this would re-sort.
        let json = r#"{"dark":false,"zen":true,"topmost":false}"#;
        let value: JsonValue = serde_json::from_str(json).unwrap();
        assert_eq!(serde_json::to_string(&value).unwrap(), json);
    }

    // --- create_snapshot_with_connection -----------------------------------

    #[test]
    fn empty_content_is_not_inserted() {
        let conn = mem_db();
        let result = create_snapshot_with_connection(&conn, input("p1", "")).unwrap();
        assert!(!result.inserted);
        assert!(result.id.is_none());
        assert_eq!(count_rows(&conn), 0);
    }

    #[test]
    fn first_insert_succeeds_with_expected_id_shape() {
        let conn = mem_db();
        let result = create_snapshot_with_connection(&conn, input("pane-a", "hello")).unwrap();
        assert!(result.inserted);
        let id = result.id.expect("id present");
        // id = <created_at_utc>-<pane_id>-<hash12>, created_at_utc ends in "-utc".
        assert!(id.contains("-utc-pane-a-"), "unexpected id: {id}");
        let hash12 = id.rsplit('-').next().unwrap();
        assert_eq!(hash12.len(), 12);
        assert!(hash12.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn insert_writes_canonical_iso_created_at_utc() {
        let conn = mem_db();
        let id = create_snapshot_with_connection(&conn, input("pane-a", "hello"))
            .unwrap()
            .id
            .expect("id present");
        // The id keeps the compact filename-style stamp...
        assert!(id.contains("-utc-pane-a-"), "unexpected id: {id}");

        // ...but the created_at_utc column is canonical ISO 8601: exactly three
        // fractional digits and a Z suffix (e.g. 2026-06-10T03:15:42.123Z).
        let created_at_utc: String = conn
            .query_row(
                "select created_at_utc from snapshots where id = ?1",
                params![id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(created_at_utc.len(), 24, "created_at_utc: {created_at_utc}");
        assert!(created_at_utc.ends_with('Z'), "created_at_utc: {created_at_utc}");
        assert_eq!(&created_at_utc[19..20], ".", "created_at_utc: {created_at_utc}");
        assert!(
            chrono::DateTime::parse_from_rfc3339(&created_at_utc).is_ok(),
            "not rfc3339: {created_at_utc}"
        );
    }

    #[test]
    fn exact_duplicate_in_same_pane_is_deduped() {
        let conn = mem_db();
        let first = create_snapshot_with_connection(&conn, input("p1", "same body")).unwrap();
        let second = create_snapshot_with_connection(&conn, input("p1", "same body")).unwrap();
        assert!(first.inserted);
        assert!(!second.inserted);
        // The dedup path returns the existing row's id.
        assert_eq!(second.id, first.id);
        assert_eq!(count_rows(&conn), 1);
    }

    #[test]
    fn same_content_in_different_panes_both_insert() {
        let conn = mem_db();
        let a = create_snapshot_with_connection(&conn, input("p1", "shared")).unwrap();
        let b = create_snapshot_with_connection(&conn, input("p2", "shared")).unwrap();
        assert!(a.inserted);
        assert!(b.inserted);
        assert_ne!(a.id, b.id);
        assert_eq!(count_rows(&conn), 2);
    }

    #[test]
    fn batch_insert_dedupes_within_transaction() {
        let conn = mem_db();
        let tx = conn.unchecked_transaction().unwrap();
        let results: Vec<_> = vec![input("p1", "x"), input("p1", "x"), input("p1", "y")]
            .into_iter()
            .map(|s| create_snapshot_with_connection(&tx, s).unwrap())
            .collect();
        tx.commit().unwrap();
        assert!(results[0].inserted);
        assert!(!results[1].inserted);
        assert!(results[2].inserted);
        assert_eq!(count_rows(&conn), 2);
    }

    // --- hashing & LIKE escaping -------------------------------------------

    #[test]
    fn hash_content_matches_known_sha256_vector() {
        // SHA-256("abc")
        assert_eq!(
            hash_content("abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_eq!(hash_content("abc").len(), 64);
    }

    #[test]
    fn escape_like_escapes_wildcards_and_backslash() {
        assert_eq!(escape_like("100%"), "100\\%");
        assert_eq!(escape_like("a_b"), "a\\_b");
        assert_eq!(escape_like("c:\\path"), "c:\\\\path");
        assert_eq!(escape_like("plain"), "plain");
    }

    // --- search_snapshots_with_connection ----------------------------------

    #[test]
    fn search_with_empty_or_blank_query_returns_nothing() {
        let conn = mem_db();
        insert_row(&conn, "id1", "p1", "2026-01-01T00:00:01.000Z", "hello world");

        for query in ["", "   ", "\t\n"] {
            let result = search_snapshots_with_connection(&conn, query, 25, 0).unwrap();
            assert!(result.rows.is_empty(), "query {query:?} should match nothing");
            assert!(!result.has_more);
        }
    }

    #[test]
    fn search_is_case_insensitive() {
        let conn = mem_db();
        insert_row(&conn, "id1", "p1", "2026-01-01T00:00:01.000Z", "The Quick Brown Fox");
        let result = search_snapshots_with_connection(&conn, "QUICK", 25, 0).unwrap();
        assert_eq!(result.rows.len(), 1);
        assert_eq!(result.rows[0].id, "id1");
    }

    #[test]
    fn search_requires_all_terms() {
        let conn = mem_db();
        insert_row(&conn, "both", "p1", "2026-01-01T00:00:02.000Z", "alpha beta gamma");
        insert_row(&conn, "one", "p1", "2026-01-01T00:00:01.000Z", "alpha only");

        let result = search_snapshots_with_connection(&conn, "alpha gamma", 25, 0).unwrap();
        assert_eq!(result.rows.len(), 1);
        assert_eq!(result.rows[0].id, "both");
    }

    #[test]
    fn search_treats_like_wildcards_literally() {
        let conn = mem_db();
        insert_row(&conn, "pct", "p1", "2026-01-01T00:00:02.000Z", "50% off today");
        insert_row(&conn, "plain", "p1", "2026-01-01T00:00:01.000Z", "500 dollars");

        // Without LIKE escaping, "50%" would match "500" too.
        let result = search_snapshots_with_connection(&conn, "50%", 25, 0).unwrap();
        assert_eq!(result.rows.len(), 1);
        assert_eq!(result.rows[0].id, "pct");
    }

    #[test]
    fn search_orders_by_timestamp_descending() {
        let conn = mem_db();
        insert_row(&conn, "old", "p1", "2026-01-01T00:00:01.000Z", "note one");
        insert_row(&conn, "new", "p1", "2026-01-01T00:00:03.000Z", "note two");
        insert_row(&conn, "mid", "p1", "2026-01-01T00:00:02.000Z", "note three");

        let result = search_snapshots_with_connection(&conn, "note", 25, 0).unwrap();
        let ids: Vec<_> = result.rows.iter().map(|r| r.id.as_str()).collect();
        assert_eq!(ids, vec!["new", "mid", "old"]);
    }

    #[test]
    fn search_orders_same_second_rows_by_subsecond_precision() {
        let conn = mem_db();
        // Same second, different milliseconds. Under the old second-granularity
        // created_at_utc these tied and fell back to the id; the canonical ISO
        // form now carries ms, so they order directly — newest (latest ms) first.
        insert_row(&conn, "id-early", "p1", "2026-01-01T00:00:01.100Z", "note alpha");
        insert_row(&conn, "id-late", "p1", "2026-01-01T00:00:01.900Z", "note beta");

        let result = search_snapshots_with_connection(&conn, "note", 25, 0).unwrap();
        let ids: Vec<_> = result.rows.iter().map(|r| r.id.as_str()).collect();
        assert_eq!(ids, vec!["id-late", "id-early"]);
    }

    #[test]
    fn search_paginates_with_has_more_flag() {
        let conn = mem_db();
        for i in 0..3 {
            insert_row(
                &conn,
                &format!("id{i}"),
                "p1",
                &format!("2026-01-01T00:00:0{}.000Z", i + 1),
                &format!("term here {i}"),
            );
        }

        let page = search_snapshots_with_connection(&conn, "term", 2, 0).unwrap();
        assert_eq!(page.rows.len(), 2);
        assert!(page.has_more);

        let rest = search_snapshots_with_connection(&conn, "term", 2, 2).unwrap();
        assert_eq!(rest.rows.len(), 1);
        assert!(!rest.has_more);
    }

    #[test]
    fn search_pagination_is_stable_across_same_second_rows() {
        let conn = mem_db();
        // Four snapshots sharing one created_at_utc, with distinct content so
        // the (pane_id, content_hash) index is satisfied.
        let ts = "2026-01-01T00:00:01.000Z";
        for i in 0..4 {
            insert_row(&conn, &format!("id{i}"), "p1", ts, &format!("term {i}"));
        }

        let page1 = search_snapshots_with_connection(&conn, "term", 2, 0).unwrap();
        let page2 = search_snapshots_with_connection(&conn, "term", 2, 2).unwrap();

        let mut paged: Vec<_> = page1
            .rows
            .iter()
            .chain(page2.rows.iter())
            .map(|r| r.id.clone())
            .collect();
        // Every row appears exactly once across the two pages — no repeats, no skips.
        assert_eq!(paged.len(), 4);
        paged.sort();
        paged.dedup();
        assert_eq!(paged, vec!["id0", "id1", "id2", "id3"]);
        // The id tiebreaker fixes the order to newest-id-first.
        let order: Vec<_> = page1
            .rows
            .iter()
            .chain(page2.rows.iter())
            .map(|r| r.id.as_str())
            .collect();
        assert_eq!(order, vec!["id3", "id2", "id1", "id0"]);
    }

    #[test]
    fn search_limit_is_clamped_to_bounds() {
        let conn = mem_db();
        for i in 0..5 {
            insert_row(
                &conn,
                &format!("id{i}"),
                "p1",
                &format!("2026-01-01T00:00:0{}.000Z", i + 1),
                &format!("term {i}"),
            );
        }
        // limit 0 clamps up to 1.
        let result = search_snapshots_with_connection(&conn, "term", 0, 0).unwrap();
        assert_eq!(result.rows.len(), 1);
        assert!(result.has_more);
    }

    // --- JSON file IO ------------------------------------------------------

    // The backup store writes `backups.sqlite3` (+ its -wal/-shm sidecars) into the
    // same throwaway root the atomic write targets, so any assertion over the root's
    // contents must filter those out — they are the store, not a stray temp. Mirrors
    // the reference's store-file filter test-migration.
    fn is_store_file(name: &std::ffi::OsStr) -> bool {
        let name = name.to_string_lossy();
        name == crate::backup_store::BACKUPS_DB_FILE_NAME
            || name.starts_with(crate::backup_store::BACKUPS_DB_FILE_NAME)
                && (name.ends_with("-wal") || name.ends_with("-shm"))
    }

    #[test]
    #[serial(backup_store)]
    fn write_then_read_json_roundtrips() {
        // Reset the store singleton so it opens against this test's throwaway root
        // (the singleton re-opens per root; teardown mirrors the reference's
        // close-the-store-between-throwaway-roots migration).
        crate::backup_store::close_backup_store();

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.json");
        let value = serde_json::json!({ "zoomLevel": 1.2, "zen": true });

        atomic_write_json(dir.path(), &path, &value).unwrap();
        let read_back = read_json_optional(&path).unwrap();
        assert_eq!(read_back, Some(value));

        // No stray temp file remains beside the finished target — the rename left
        // exactly one managed file, named exactly "config.json" (the backup store's
        // own files are filtered out; they are the store, not stray debris).
        let entries: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .filter(|name| !is_store_file(name))
            .collect();
        assert_eq!(entries, vec![std::ffi::OsString::from("config.json")]);

        crate::backup_store::close_backup_store();
    }

    #[test]
    #[serial(backup_store)]
    fn atomic_write_records_byte_identical_bytes_through_the_choke_point() {
        // End-to-end at the choke point: the bytes recorded into backups.sqlite3 are
        // byte-identical to what the atomic write put on disk — pretty JSON plus the
        // single trailing newline — proving the hook fires after the rename and reuses
        // the in-hand bytes rather than re-reading (or re-serializing) the file.
        crate::backup_store::close_backup_store();

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.json");
        let value = serde_json::json!({ "zoomLevel": 1.2, "zen": true });

        atomic_write_json(dir.path(), &path, &value).unwrap();

        let on_disk = fs::read(&path).unwrap();
        let store = dir.path().join(crate::backup_store::BACKUPS_DB_FILE_NAME);
        let conn = Connection::open(&store).unwrap();
        let recorded: Vec<u8> = conn
            .query_row(
                "SELECT content FROM backups WHERE path = ?1 ORDER BY id DESC LIMIT 1",
                params![path.to_string_lossy()],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(recorded, on_disk, "recorded blob must equal the file's bytes");
        assert_eq!(recorded.last(), Some(&b'\n'), "the trailing newline must be recorded too");

        crate::backup_store::close_backup_store();
    }

    #[test]
    #[serial(backup_store)]
    fn failed_rename_cleans_up_the_temp_file() {
        crate::backup_store::close_backup_store();

        let dir = tempfile::tempdir().unwrap();
        // A DIRECTORY at the target path makes the final rename fail (a file
        // cannot be renamed over a directory), exercising the error path.
        let path = dir.path().join("config.json");
        fs::create_dir(&path).unwrap();

        let result = atomic_write_json(dir.path(), &path, &serde_json::json!({ "a": 1 }));
        assert!(result.is_err());

        // The failed write must not leave its temp file behind.
        let leftovers: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .flatten()
            .filter(|e| e.file_name().to_string_lossy().ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty(), "temp files left: {leftovers:?}");

        crate::backup_store::close_backup_store();
    }

    #[test]
    fn temp_path_for_uses_stem_discriminator_dot_tmp_shape_in_the_same_directory() {
        // <stem>-<discriminator>.tmp — the derived-filename grammar: one final
        // extension, the discriminator hyphen-joined onto the target's stem
        // (never dot-appended after the full "config.json"), alongside the target.
        let path = Path::new("/data/config.json");
        let tmp = temp_path_for(path).unwrap();
        assert_eq!(tmp.parent(), path.parent());

        let tmp_name = tmp.file_name().and_then(|n| n.to_str()).unwrap();
        assert!(tmp_name.starts_with("config-"), "unexpected tmp name: {tmp_name}");
        assert!(tmp_name.ends_with(".tmp"), "unexpected tmp name: {tmp_name}");
        assert!(!tmp_name.contains("config.json"), "old shape leaked in: {tmp_name}");
        let discriminator = &tmp_name["config-".len()..tmp_name.len() - ".tmp".len()];
        // The discriminator is a nanoid: crate::nanoid::DEFAULT_LENGTH characters
        // drawn from the standard URL-safe alphabet (A-Za-z0-9_-), not the old
        // nanosecond-timestamp digit string.
        assert_eq!(
            discriminator.chars().count(),
            crate::nanoid::DEFAULT_LENGTH,
            "unexpected discriminator length: {tmp_name}"
        );
        assert!(
            discriminator
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-'),
            "discriminator outside nanoid alphabet: {tmp_name}"
        );
    }

    #[test]
    fn temp_path_for_discriminator_differs_across_calls() {
        // Two temp names for the same target must not collide — the nanoid
        // discriminator, not call ordering or timing, is what guarantees this.
        let path = Path::new("/data/config.json");
        let first = temp_path_for(path).unwrap();
        let second = temp_path_for(path).unwrap();
        assert_ne!(first, second);
    }

    #[test]
    fn rebuildable_store_quarantines_corrupt_and_continues() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.json");
        fs::write(&path, b"{ corrupt bytes").unwrap();

        let (value, quarantined_to) = read_rebuildable_store(&path).unwrap();
        assert_eq!(value, None);
        let quarantined_to = quarantined_to.expect("quarantine path reported");
        assert!(quarantined_to.ends_with("-utc.invalid"), "{quarantined_to}");

        // The original was renamed aside with its exact bytes, never reset.
        assert!(!path.exists());
        assert_eq!(fs::read(&quarantined_to).unwrap(), b"{ corrupt bytes");
    }

    #[test]
    fn rebuildable_store_quarantines_non_utf8_too() {
        // Binary garbage is corruption: the reader parses bytes, so it takes
        // the quarantine path rather than an I/O halt.
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("state.json");
        fs::write(&path, [0xff, 0xfe, 0x00, 0x01]).unwrap();

        let (value, quarantined_to) = read_rebuildable_store(&path).unwrap();
        assert_eq!(value, None);
        assert!(quarantined_to.is_some());
        assert!(!path.exists());
    }

    #[test]
    fn rebuildable_store_passes_valid_and_missing_through() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.json");
        assert_eq!(read_rebuildable_store(&path).unwrap(), (None, None));
        fs::write(&path, br#"{"dark":true}"#).unwrap();
        let (value, quarantined_to) = read_rebuildable_store(&path).unwrap();
        assert_eq!(value, Some(serde_json::json!({"dark": true})));
        assert_eq!(quarantined_to, None);
        assert!(path.exists(), "a valid store stays in place");
    }

    #[test]
    fn corrupt_panes_store_halts_and_is_left_in_place() {
        // panes.json carries the user's text: the halting reader errors and the
        // file is left exactly where it is (storage-path conventions).
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("panes.json");
        fs::write(&path, b"{ corrupt bytes").unwrap();

        assert!(read_json_optional(&path).is_err());
        assert_eq!(fs::read(&path).unwrap(), b"{ corrupt bytes");
    }

    #[test]
    fn read_missing_file_returns_none() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("does-not-exist.json");
        assert_eq!(read_json_optional(&path).unwrap(), None);
    }

    #[test]
    fn read_malformed_json_returns_err() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("broken.json");
        fs::write(&path, "{ not valid json").unwrap();
        assert!(read_json_optional(&path).is_err());
    }

    fn count_rows(conn: &Connection) -> i64 {
        conn.query_row("select count(*) from snapshots", [], |row| row.get(0))
            .unwrap()
    }
}
