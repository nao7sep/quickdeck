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
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        mpsc, Arc, LazyLock, Mutex,
    },
    time::{Duration, Instant},
};

use rusqlite::{params_from_iter, types::Value, Connection, OpenFlags, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

use crate::{
    format_version::{self, SqliteFormat},
    storage::RECORDS_DB_FILE_NAME,
};

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

// How long a read may take before the window is told it failed, so a stalled
// disk never leaves the Records window waiting. Cancellation interrupts SQLite;
// capacity stays owned until the blocking work has actually ended.
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
        // One tuple range lets the time/id index seek to the cursor instead
        // of scanning the newer prefix for the equivalent OR predicate.
        clauses.push("(time, id) < (?, ?)".to_string());
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
// it read every row already committed while the writer goes on. A store in a
// newer format, or without its format marker, is not read.
fn open(file: &Path) -> Result<Connection, String> {
    let to_string = |error: rusqlite::Error| error.to_string();
    let conn = Connection::open_with_flags(
        file,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(to_string)?;
    conn.busy_timeout(BUSY_WAIT).map_err(to_string)?;
    match format_version::check_sqlite(&conn, RECORDS_DB_FILE_NAME, format_version::RECORDS)? {
        SqliteFormat::Newer(recorded) => Err(format_version::newer_message(
            RECORDS_DB_FILE_NAME,
            recorded,
        )),
        SqliteFormat::New | SqliteFormat::Readable => Ok(conn),
    }
}

// Admission counts queued and running blocking work, including a stalled open.
// A timed-out caller cannot free capacity still occupied by its read.
struct ReadAdmission {
    active: AtomicUsize,
    limit: usize,
}

impl ReadAdmission {
    fn acquire(self: &Arc<Self>) -> Result<ReadPermit, String> {
        let mut active = self.active.load(Ordering::Acquire);
        loop {
            if active >= self.limit {
                return Err("records reads are at capacity".to_string());
            }
            match self.active.compare_exchange_weak(
                active,
                active + 1,
                Ordering::AcqRel,
                Ordering::Acquire,
            ) {
                Ok(_) => return Ok(ReadPermit(Arc::clone(self))),
                Err(current) => active = current,
            }
        }
    }
}

struct ReadPermit(Arc<ReadAdmission>);

impl Drop for ReadPermit {
    fn drop(&mut self) {
        self.0.active.fetch_sub(1, Ordering::AcqRel);
    }
}

static READ_ADMISSION: LazyLock<Arc<ReadAdmission>> = LazyLock::new(|| {
    Arc::new(ReadAdmission {
        active: AtomicUsize::new(0),
        // Opening the view may read its sources, page and selected detail together.
        limit: std::thread::available_parallelism().map_or(3, |count| count.get().max(3)),
    })
});

/// Runs an admitted read on the runtime's blocking pool, waiting at most `READ_WAIT`.
pub fn read_bounded<T: Send + 'static>(
    file: PathBuf,
    read: impl FnOnce(&Connection) -> rusqlite::Result<T> + Send + 'static,
) -> Result<T, String> {
    read_with_wait(file, read, READ_WAIT, Arc::clone(&READ_ADMISSION), open)
}

fn read_with_wait<T: Send + 'static>(
    file: PathBuf,
    read: impl FnOnce(&Connection) -> rusqlite::Result<T> + Send + 'static,
    wait: Duration,
    admission: Arc<ReadAdmission>,
    open: impl FnOnce(&Path) -> Result<Connection, String> + Send + 'static,
) -> Result<T, String> {
    let deadline = Instant::now() + wait;
    let permit = admission.acquire()?;
    let cancelled = Arc::new(AtomicBool::new(false));
    let interrupt = Arc::new(Mutex::new(None::<rusqlite::InterruptHandle>));
    let (done, result) = mpsc::channel();
    let worker_cancelled = Arc::clone(&cancelled);
    let worker_interrupt = Arc::clone(&interrupt);
    tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        let outcome = open(&file).and_then(|conn| {
            let progress_cancelled = Arc::clone(&worker_cancelled);
            conn.progress_handler(
                1000,
                Some(move || {
                    progress_cancelled.load(Ordering::Acquire) || Instant::now() >= deadline
                }),
            )
            .map_err(|error| error.to_string())?;
            *worker_interrupt.lock().unwrap() = Some(conn.get_interrupt_handle());
            // Publication can race with caller cancellation while opening the
            // file. Check again here even if SQLite has not begun a statement.
            if worker_cancelled.load(Ordering::Acquire) || Instant::now() >= deadline {
                return Err("records read cancelled after its deadline".to_string());
            }
            read(&conn).map_err(|error| error.to_string())
        });
        let _ = done.send(outcome);
    });
    match result.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
        Ok(outcome) => outcome,
        Err(mpsc::RecvTimeoutError::Timeout) => {
            cancelled.store(true, Ordering::Release);
            if let Some(handle) = interrupt.lock().unwrap().as_ref() {
                handle.interrupt();
            }
            Err(format!(
                "records read gave up after {} s",
                wait.as_secs_f64()
            ))
        }
        Err(mpsc::RecvTimeoutError::Disconnected) => {
            Err("records read worker stopped before returning a result".to_string())
        }
    }
}

#[cfg(test)]
#[path = "../tests/unit/records_bounded.rs"]
mod bounded_read_tests;
