use std::{
    fs::{self, File},
    io::Write,
    path::{Path, PathBuf},
};

use chrono::Utc;
use rusqlite::{params, params_from_iter, types::Value, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

const DATA_DIR_NAME: &str = ".quickdeck";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedAppData {
    pub config: Option<JsonValue>,
    pub session: Option<JsonValue>,
    pub data_dir: String,
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
    let config = read_json_optional(&data_dir.join("config.json"))?;
    let session = read_json_optional(&data_dir.join("session.json"))?;
    ensure_snapshot_db(&data_dir)?;

    Ok(LoadedAppData {
        config,
        session,
        data_dir: data_dir.to_string_lossy().into_owned(),
    })
}

pub fn save_config(app: &AppHandle, config: JsonValue) -> Result<(), String> {
    let data_dir = app_data_dir(app)?;
    atomic_write_json(&data_dir.join("config.json"), &config)
}

pub fn save_session(app: &AppHandle, session: JsonValue) -> Result<(), String> {
    let data_dir = app_data_dir(app)?;
    atomic_write_json(&data_dir.join("session.json"), &session)
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

    sql.push_str(" order by created_at_utc desc limit ? offset ?");
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

    let created_at_utc = Utc::now().format("%Y%m%d-%H%M%S-utc").to_string();
    let id = format!(
        "{}-{}-{}",
        created_at_utc,
        snapshot.pane_id,
        &content_hash[..12]
    );

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

fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let home = app.path().home_dir().map_err(to_string_error)?;
    let data_dir = home.join(DATA_DIR_NAME);
    fs::create_dir_all(&data_dir).map_err(to_string_error)?;
    Ok(data_dir)
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

fn atomic_write_json(path: &Path, value: &JsonValue) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("missing parent directory for {}", path.display()))?;
    fs::create_dir_all(parent).map_err(to_string_error)?;

    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| format!("invalid file name for {}", path.display()))?;
    let tmp_path = parent.join(format!(
        ".{}.{}.tmp",
        file_name,
        Utc::now().timestamp_nanos_opt().unwrap_or(0)
    ));
    let bytes = serde_json::to_vec_pretty(value).map_err(to_string_error)?;

    {
        let mut file = File::create(&tmp_path).map_err(to_string_error)?;
        file.write_all(&bytes).map_err(to_string_error)?;
        file.write_all(b"\n").map_err(to_string_error)?;
        file.sync_all().map_err(to_string_error)?;
    }

    fs::rename(&tmp_path, path).map_err(to_string_error)?;
    if let Ok(directory) = File::open(parent) {
        let _ = directory.sync_all();
    }

    Ok(())
}

fn open_snapshot_db(data_dir: &Path) -> Result<Connection, String> {
    ensure_snapshot_db(data_dir)?;
    Connection::open(data_dir.join("snapshots.sqlite3")).map_err(to_string_error)
}

fn ensure_snapshot_db(data_dir: &Path) -> Result<(), String> {
    fs::create_dir_all(data_dir).map_err(to_string_error)?;
    let conn = Connection::open(data_dir.join("snapshots.sqlite3")).map_err(to_string_error)?;
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
