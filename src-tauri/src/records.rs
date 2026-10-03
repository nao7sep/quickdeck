//! What the Records window reads from `records.sqlite3`: a filtered page of log
//! lines, newest first and keyset-paged, the launches that have records, and one
//! line whole. The schema lives here beside the reads; logging.rs writes the rows.
//!
//! A read never writes a record of its own, not even on success: every stored
//! record signals the open window to read again, so a logged read would make the
//! window read forever. Only a failed read is logged, by the command layer, and the
//! window stops following new records until a read succeeds.

use std::{
    path::{Path, PathBuf},
    sync::mpsc,
    time::Duration,
};

use rusqlite::{params_from_iter, types::Value, Connection, OpenFlags, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

// `fields` holds the free fields as given, minus the domain ids, which have their
// own columns. The (time, id) index serves the Records window's newest-first pages.
pub const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS log_lines (
  id          INTEGER PRIMARY KEY,
  session     TEXT NOT NULL,
  time        TEXT NOT NULL,
  level       TEXT NOT NULL,
  message     TEXT NOT NULL,
  pane_id     TEXT,
  snapshot_id TEXT,
  fields      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS log_lines_session ON log_lines (session, id);
CREATE INDEX IF NOT EXISTS log_lines_time ON log_lines (time, id);
";

pub const PAGE_SIZE: usize = 100;

// How long a read may take before the window is told it failed (PLAYBOOK, "Bound
// every external wait"). The abandoned read still finishes on its own thread.
pub const READ_WAIT: Duration = Duration::from_secs(5);

// SQLite's own wait for a lock the writer holds, inside READ_WAIT.
const BUSY_WAIT: Duration = Duration::from_secs(2);

// The operation a boundary line names, when its fields carry one as text.
const OP: &str = "CASE WHEN json_valid(fields) AND json_type(fields, '$.op') = 'text' \
                  THEN json_extract(fields, '$.op') END";

// The columns a search looks through: everything a line holds as text.
const SEARCHED: [&str; 4] = ["message", "pane_id", "snapshot_id", "fields"];

/// What the level filter offers: a line's own level, or `attention`, every line
/// at `warn` or `error`.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum LevelFilter {
    Attention,
    Error,
    Warn,
    Info,
    Debug,
}

/// Where the next page starts: the last line of the page before it.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
pub struct Cursor {
    pub time: String,
    pub id: i64,
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct RecordsQuery {
    /// A launch, named by its session.
    pub session: Option<String>,
    pub level: Option<LevelFilter>,
    pub search: String,
    pub after: Option<Cursor>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct RecordSummary {
    pub id: i64,
    pub session: String,
    pub time: String,
    pub level: String,
    pub message: String,
    /// The operation a boundary line names.
    pub op: Option<String>,
}

#[derive(Debug, Eq, PartialEq, Serialize)]
pub struct RecordsPage {
    pub records: Vec<RecordSummary>,
    pub more: bool,
}

/// One line whole, every column as stored; `fields` is the JSON text it holds.
#[derive(Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordDetail {
    pub id: i64,
    pub session: String,
    pub time: String,
    pub level: String,
    pub message: String,
    pub pane_id: Option<String>,
    pub snapshot_id: Option<String>,
    pub fields: String,
}

/// The launches the launch filter offers, newest first, and this one.
#[derive(Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordSources {
    pub current_session: String,
    pub sessions: Vec<String>,
}

fn level_name(level: LevelFilter) -> Option<&'static str> {
    match level {
        LevelFilter::Attention => None,
        LevelFilter::Error => Some("error"),
        LevelFilter::Warn => Some("warn"),
        LevelFilter::Info => Some("info"),
        LevelFilter::Debug => Some("debug"),
    }
}

// The search as a LIKE pattern that matches the typed text literally.
fn like_pattern(search: &str) -> Option<String> {
    let trimmed = search.trim();
    (!trimmed.is_empty()).then(|| format!("%{}%", crate::storage::escape_like(trimmed)))
}

fn summary(row: &Row) -> rusqlite::Result<RecordSummary> {
    Ok(RecordSummary {
        id: row.get(0)?,
        session: row.get(1)?,
        time: row.get(2)?,
        level: row.get(3)?,
        message: row.get(4)?,
        op: row.get(5)?,
    })
}

pub fn read_page(conn: &Connection, query: &RecordsQuery) -> rusqlite::Result<RecordsPage> {
    let mut clauses: Vec<String> = Vec::new();
    let mut params: Vec<Value> = Vec::new();
    if let Some(session) = &query.session {
        clauses.push("session = ?".to_string());
        params.push(Value::Text(session.clone()));
    }
    if let Some(level) = query.level {
        match level_name(level) {
            Some(name) => {
                clauses.push("level = ?".to_string());
                params.push(Value::Text(name.to_string()));
            }
            None => clauses.push("level IN ('warn', 'error')".to_string()),
        }
    }
    if let Some(pattern) = like_pattern(&query.search) {
        let searched: Vec<String> = SEARCHED
            .iter()
            .map(|column| format!("{column} LIKE ? ESCAPE '\\'"))
            .collect();
        clauses.push(format!("({})", searched.join(" OR ")));
        params.extend(SEARCHED.iter().map(|_| Value::Text(pattern.clone())));
    }
    if let Some(after) = &query.after {
        clauses.push("(time < ? OR (time = ? AND id < ?))".to_string());
        params.push(Value::Text(after.time.clone()));
        params.push(Value::Text(after.time.clone()));
        params.push(Value::Integer(after.id));
    }
    let filter = if clauses.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", clauses.join(" AND "))
    };
    params.push(Value::Integer(PAGE_SIZE as i64 + 1));
    let sql = format!(
        "SELECT id, session, time, level, message, {OP} FROM log_lines {filter}
         ORDER BY time DESC, id DESC LIMIT ?"
    );
    let mut records = conn
        .prepare(&sql)?
        .query_map(params_from_iter(params), summary)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let more = records.len() > PAGE_SIZE;
    records.truncate(PAGE_SIZE);
    Ok(RecordsPage { records, more })
}

pub fn read_sessions(conn: &Connection) -> rusqlite::Result<Vec<String>> {
    conn.prepare("SELECT DISTINCT session FROM log_lines ORDER BY session DESC")?
        .query_map([], |row| row.get(0))?
        .collect()
}

pub fn read_detail(conn: &Connection, id: i64) -> rusqlite::Result<Option<RecordDetail>> {
    conn.query_row(
        "SELECT id, session, time, level, message, pane_id, snapshot_id, fields
         FROM log_lines WHERE id = ?1",
        [id],
        |row| {
            Ok(RecordDetail {
                id: row.get(0)?,
                session: row.get(1)?,
                time: row.get(2)?,
                level: row.get(3)?,
                message: row.get(4)?,
                pane_id: row.get(5)?,
                snapshot_id: row.get(6)?,
                fields: row.get(7)?,
            })
        },
    )
    .optional()
}

// A connection of its own for each read, read-only, beside the writer's: WAL lets
// it read every row already committed while the writer goes on.
fn open(file: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open_with_flags(
        file,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    conn.busy_timeout(BUSY_WAIT)?;
    Ok(conn)
}

/// Runs one read on its own thread and waits for it at most `READ_WAIT`.
pub fn read_bounded<T: Send + 'static>(
    file: PathBuf,
    read: impl FnOnce(&Connection) -> rusqlite::Result<T> + Send + 'static,
) -> Result<T, String> {
    let (done, result) = mpsc::channel();
    std::thread::Builder::new()
        .name("records-read".to_string())
        .spawn(move || {
            let outcome = open(&file)
                .and_then(|conn| read(&conn))
                .map_err(|error| error.to_string());
            // After a timeout nobody waits for the outcome any more; dropping it
            // is the abandonment READ_WAIT describes.
            let _ = done.send(outcome);
        })
        .map_err(|error| error.to_string())?;
    match result.recv_timeout(READ_WAIT) {
        Ok(outcome) => outcome,
        Err(_) => Err(format!(
            "records read gave up after {} s",
            READ_WAIT.as_secs()
        )),
    }
}
