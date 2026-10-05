//! Log lines as rows in `records.sqlite3` (logging and data-lifecycle
//! conventions), each carrying its session and the pane or snapshot it belongs
//! to. The Rust core owns the database; the webview forwards structured log
//! objects via the `log_event` command (see `lib.rs`). Rows are written on the
//! logger's own thread, and `flush` waits for those already sent. A failed write
//! goes to `logs/<session stamp>.log` as one JSON line. The schema and the reads
//! the Records window makes live in `records.rs`.

use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::{mpsc, OnceLock},
    time::{Duration, Instant},
};

use chrono::{SecondsFormat, Utc};
use rusqlite::{params, Connection};
use serde_json::{json, Map, Value};
use tauri::AppHandle;

use crate::{
    format_version::{self, SqliteFormat},
    paths, records,
    storage::RECORDS_DB_FILE_NAME,
};

// The free fields that name a domain object, and the column each one fills.
const DOMAIN_IDS: [&str; 2] = ["paneId", "snapshotId"];

// How long `flush` waits for the writer before going on without it.
const FLUSH_WAIT: Duration = Duration::from_secs(2);

// The four levels, and only four.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Level {
    Debug,
    Info,
    Warn,
    Error,
}

impl Level {
    fn as_str(self) -> &'static str {
        match self {
            Level::Debug => "debug",
            Level::Info => "info",
            Level::Warn => "warn",
            Level::Error => "error",
        }
    }

    // Parse liberally: an unrecognized level from a forwarded event still gets
    // recorded (as `info`) rather than dropped.
    fn parse(raw: &str) -> Level {
        match raw.trim().to_ascii_lowercase().as_str() {
            "debug" => Level::Debug,
            "warn" | "warning" => Level::Warn,
            "error" => Level::Error,
            _ => Level::Info,
        }
    }
}

// This launch: its start time, which every row carries, and where the fallback
// file goes (None when the data directory could not be resolved).
#[derive(Clone)]
struct Session {
    started: String,
    stamp: String,
    root: Option<PathBuf>,
}

// What the writer thread receives: a line to write, or a request to say when
// every line sent before it is written.
enum Message {
    Line {
        level: Level,
        message: String,
        time: String,
        fields: Map<String, Value>,
    },
    Flush(mpsc::SyncSender<()>),
}

// `session` is kept here too, for the fallback when the writer thread is gone.
struct Logger {
    session: Session,
    writer: mpsc::Sender<Message>,
    debug_enabled: bool,
}

static LOGGER: OnceLock<Logger> = OnceLock::new();

// Called on the writer thread after each row the database stored; a line that
// went to the fallback file is not in the database, so it calls nothing.
type StoredListener = Box<dyn Fn() + Send + Sync>;
static STORED: OnceLock<StoredListener> = OnceLock::new();

/// Registers what runs after each stored row (the Records window's signal). Safe
/// to call once; later calls are ignored.
pub fn on_stored(listener: impl Fn() + Send + Sync + 'static) {
    let _ = STORED.set(Box::new(listener));
}

fn notify_stored() {
    if let Some(listener) = STORED.get() {
        listener();
    }
}

// Installs the panic hook, starts the writer thread, which opens the records
// database, and writes the startup line. Safe to call once; later calls are
// ignored. Never fails the app: without the database or the thread every line
// takes the fallback.
pub fn init(app: &AppHandle, version: &str) {
    let debug_enabled = cfg!(debug_assertions)
        || std::env::var("QUICKDECK_DEBUG")
            .map(|value| value == "1")
            .unwrap_or(false);

    let started = Utc::now();
    let root = paths::app_data_dir(app);
    let session = Session {
        started: started.to_rfc3339_opts(SecondsFormat::Millis, true),
        stamp: session_stamp(started),
        root: root.clone().ok(),
    };
    let (writer, lines) = mpsc::channel();
    let logger = Logger {
        session: session.clone(),
        writer,
        debug_enabled,
    };

    if LOGGER.set(logger).is_err() {
        return;
    }

    install_panic_hook();

    let file = root.map(|root| root.join(RECORDS_DB_FILE_NAME));
    let spawned = std::thread::Builder::new()
        .name("records".to_string())
        .spawn(move || run_writer(file, session, lines, notify_stored));
    if let Err(error) = spawned {
        warn(
            "records writer unavailable",
            json!({ "error": error.to_string() }),
        );
    }

    write_event(
        Level::Info,
        "startup",
        now_iso(),
        into_map(json!({
            "version": version,
            "build": if cfg!(debug_assertions) { "debug" } else { "release" },
            "debugEnabled": debug_enabled,
        })),
    );
}

// The writer thread: owns the records database for the rest of the process and
// writes each line in the order it was sent, calling `stored` after each row the
// database took.
fn run_writer(
    file: Result<PathBuf, String>,
    session: Session,
    lines: mpsc::Receiver<Message>,
    stored: impl Fn(),
) {
    let records = file.and_then(|file| open_records(&file));
    let records = match records {
        Ok(conn) => Some(conn),
        Err(error) => {
            write_record(
                None,
                &session,
                Level::Warn,
                "records database unavailable",
                &now_iso(),
                &into_map(json!({ "error": error })),
            );
            None
        }
    };
    for line in lines {
        match line {
            Message::Line {
                level,
                message,
                time,
                fields,
            } => {
                if write_record(records.as_ref(), &session, level, &message, &time, &fields) {
                    stored();
                }
            }
            Message::Flush(done) => {
                let _ = done.send(());
            }
        }
    }
}

// Waits, at most `FLUSH_WAIT`, until every line sent so far is written: on exit
// and after a panic (logging conventions, Flush and durability).
pub fn flush() {
    let Some(logger) = LOGGER.get() else {
        return;
    };
    let (done, written) = mpsc::sync_channel(1);
    if logger.writer.send(Message::Flush(done)).is_err() {
        return;
    }
    if written.recv_timeout(FLUSH_WAIT).is_err() {
        let _ = writeln!(
            std::io::stderr(),
            "[quickdeck] log flush gave up after {} s",
            FLUSH_WAIT.as_secs()
        );
    }
}

// not recorded: records.sqlite3 is written only here, never through the
// managed-text atomic path, and is not archived (data-backup and data-lifecycle
// conventions). A store in a newer format, or without its format marker, is left
// untouched, and every line takes the fallback.
fn open_records(file: &Path) -> Result<Connection, String> {
    let to_string = |error: rusqlite::Error| error.to_string();
    let conn = Connection::open(file).map_err(to_string)?;
    conn.pragma_update(None, "busy_timeout", 5000)
        .map_err(to_string)?;
    match format_version::check_sqlite(&conn, RECORDS_DB_FILE_NAME, format_version::RECORDS)? {
        SqliteFormat::Newer(recorded) => {
            return Err(format_version::newer_message(
                RECORDS_DB_FILE_NAME,
                recorded,
            ))
        }
        SqliteFormat::New => conn
            .pragma_update(None, "journal_mode", "WAL")
            .and_then(|_| {
                format_version::create_sqlite(&conn, records::SCHEMA, format_version::RECORDS)
            })
            .map_err(to_string)?,
        SqliteFormat::Readable => {}
    }
    // Each row commits on its own; NORMAL under WAL keeps that from syncing the
    // disk every time, and a crashed process still loses nothing.
    conn.pragma_update(None, "synchronous", "NORMAL")
        .map_err(to_string)?;
    Ok(conn)
}

// Formats `now` as `yyyymmdd-hhmmss-fff-utc`, the machine-paced millisecond form
// (timestamp-conventions): the fallback file's name, and the moment discriminator
// for other derived-sibling names (storage's quarantine `<stem>-<stamp>.invalid`).
pub(crate) fn session_stamp(now: chrono::DateTime<Utc>) -> String {
    format!(
        "{}-{:03}-utc",
        now.format("%Y%m%d-%H%M%S"),
        now.timestamp_subsec_millis()
    )
}

// The authoritative debug gate, exposed so the command layer can hand the
// resolved value to the frontend (which gates its own debug calls to spare the
// IPC hop). The Rust writer enforces the gate regardless.
pub fn debug_enabled() -> bool {
    LOGGER
        .get()
        .map(|logger| logger.debug_enabled)
        .unwrap_or(cfg!(debug_assertions))
}

// --- Forwarded (webview) logging ----------------------------------------------

// Records an event forwarded from the frontend. The frontend stamps `time` at
// the event instant; we trust it when present and fall back to now otherwise.
// Returns nothing: logging must never surface an error back into the UI.
pub fn log_forwarded(
    level: &str,
    message: &str,
    time: Option<String>,
    fields: Option<Map<String, Value>>,
) {
    let time = match time {
        Some(value) if !value.is_empty() => value,
        _ => now_iso(),
    };
    write_event(
        Level::parse(level),
        message,
        time,
        fields.unwrap_or_default(),
    );
}

// Records the clean end of a session. Logged from the Rust run-loop on exit
// (see lib.rs) rather than the webview, so it cannot be lost to an in-flight IPC
// message racing the window teardown.
pub fn log_shutdown() {
    write_event(Level::Info, "shutdown", now_iso(), Map::new());
}

// This launch's session, as every row of it carries.
pub fn session() -> Option<String> {
    LOGGER.get().map(|logger| logger.session.started.clone())
}

// A single Rust-side error, for a failure that has no boundary of its own.
pub fn error(message: &str, fields: Value) {
    write_event(Level::Error, message, now_iso(), into_map(fields));
}

// A single Rust-side warning. `fields` is any JSON object (a non-object payload
// is wrapped, never lost); the timestamp is stamped here.
pub fn warn(message: &str, fields: Value) {
    write_event(Level::Warn, message, now_iso(), into_map(fields));
}

// --- Boundary instrumentation --------------------------------------------------

// Wraps an external-boundary operation (file / database / IPC command) with the
// standard logging: a `debug` line at the start, then exactly one `info` line on
// success or one `error` line on failure, each carrying the parameters and the
// elapsed duration. This is what keeps "log every boundary crossing" to one info
// line per crossing.
pub fn boundary<T>(
    op: &str,
    params: Value,
    body: impl FnOnce() -> Result<T, String>,
    summarize: impl FnOnce(&T) -> Value,
) -> Result<T, String> {
    let started = Instant::now();

    let mut fields = into_map(params);
    fields.insert("op".to_string(), Value::String(op.to_string()));
    write_event(Level::Debug, "boundary start", now_iso(), fields.clone());

    let result = body();
    fields.insert(
        "ms".to_string(),
        json!(started.elapsed().as_millis() as u64),
    );

    match &result {
        Ok(value) => {
            fields.extend(into_map(summarize(value)));
            write_event(Level::Info, "boundary ok", now_iso(), fields);
        }
        Err(err) => {
            fields.insert("error".to_string(), Value::String(err.clone()));
            write_event(Level::Error, "boundary failed", now_iso(), fields);
        }
    }

    result
}

// --- Core write path -----------------------------------------------------------

fn write_event(level: Level, message: &str, time: String, fields: Map<String, Value>) {
    let Some(logger) = LOGGER.get() else {
        // Not initialized (e.g. a unit test in another module) — best effort: drop.
        return;
    };

    // Debug never reaches an end-user disk.
    if level == Level::Debug && !logger.debug_enabled {
        return;
    }

    let line = Message::Line {
        level,
        message: message.to_string(),
        time,
        fields,
    };
    // A writer thread that never started or has stopped leaves the fallback.
    if let Err(mpsc::SendError(Message::Line {
        level,
        message,
        time,
        fields,
    })) = logger.writer.send(line)
    {
        write_record(None, &logger.session, level, &message, &time, &fields);
    }
}

// Inserts one row, or appends the line to the fallback file when there is no
// database or the insert fails; true when the row reached the database. It must
// NEVER panic: the std print macros
// (eprint!/eprintln!) panic on a failed stderr write, which on a no-console GUI
// build would fire the panic hook, which logs and flushes, on the writer thread
// itself. All stderr output here therefore goes through non-panicking
// `write!`/`writeln!` whose Result is deliberately ignored.
fn write_record(
    records: Option<&Connection>,
    session: &Session,
    level: Level,
    message: &str,
    time: &str,
    fields: &Map<String, Value>,
) -> bool {
    let inserted = match records {
        Some(conn) => insert_record(conn, &session.started, level, message, time, fields)
            .map_err(|error| error.to_string()),
        None => Err("records database unavailable".to_string()),
    };
    let Err(reason) = inserted else {
        return true;
    };

    let line = build_line(level, message, time, fields.clone());
    let appended = match &session.root {
        Some(root) => {
            append_fallback(root, &session.stamp, &line).map_err(|error| error.to_string())
        }
        None => Err("data directory unavailable".to_string()),
    };
    if let Err(error) = appended {
        let _ = writeln!(
            std::io::stderr(),
            "[quickdeck] log record not written ({reason}; fallback: {error}): {line}"
        );
    }
    false
}

fn insert_record(
    conn: &Connection,
    session: &str,
    level: Level,
    message: &str,
    time: &str,
    fields: &Map<String, Value>,
) -> rusqlite::Result<()> {
    let mut ids: [Option<&str>; 2] = [None, None];
    let mut rest = Map::new();
    for (key, value) in fields {
        match (DOMAIN_IDS.iter().position(|id| id == key), value) {
            (Some(index), Value::String(id)) => ids[index] = Some(id),
            _ => {
                rest.insert(key.clone(), value.clone());
            }
        }
    }
    conn.execute(
        "INSERT INTO log_lines (session, time, level, message, pane_id, snapshot_id, fields)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            session,
            time,
            level.as_str(),
            message,
            ids[0],
            ids[1],
            Value::Object(rest).to_string()
        ],
    )?;
    Ok(())
}

// not recorded: the fallback file is append-mode and never written through the
// managed-text atomic path (data-backup conventions).
fn append_fallback(root: &Path, stamp: &str, line: &str) -> std::io::Result<()> {
    let dir = root.join("logs");
    fs::create_dir_all(&dir)?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join(format!("{stamp}.log")))?;
    file.write_all(format!("{line}\n").as_bytes())
}

// Pure: serialize one JSON line with the envelope first
// (time, level, message) followed by the free fields. serde_json's
// preserve_order feature keeps this insertion order in the output.
fn build_line(level: Level, message: &str, time: &str, fields: Map<String, Value>) -> String {
    let mut obj = Map::new();
    obj.insert("time".to_string(), Value::String(time.to_string()));
    obj.insert(
        "level".to_string(),
        Value::String(level.as_str().to_string()),
    );
    obj.insert("message".to_string(), Value::String(message.to_string()));
    for (key, value) in fields {
        // The envelope keys are authoritative: a free field must never overwrite
        // one — but it is never silently dropped either. A colliding field is
        // preserved under a suffixed name so no data is lost.
        if key == "time" || key == "level" || key == "message" {
            obj.insert(format!("{key}_"), value);
        } else {
            obj.insert(key, value);
        }
    }

    serde_json::to_string(&Value::Object(obj)).unwrap_or_default()
}

// --- Helpers -------------------------------------------------------------------

fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn into_map(value: Value) -> Map<String, Value> {
    match value {
        Value::Object(map) => map,
        Value::Null => Map::new(),
        // A non-object payload is wrapped so it is never silently lost.
        other => {
            let mut map = Map::new();
            map.insert("value".to_string(), other);
            map
        }
    }
}

fn install_panic_hook() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let location = info
            .location()
            .map(|loc| format!("{}:{}:{}", loc.file(), loc.line(), loc.column()))
            .unwrap_or_else(|| "unknown".to_string());
        let payload = if let Some(text) = info.payload().downcast_ref::<&str>() {
            (*text).to_string()
        } else if let Some(text) = info.payload().downcast_ref::<String>() {
            text.clone()
        } else {
            "non-string panic payload".to_string()
        };

        write_event(
            Level::Error,
            "panic",
            now_iso(),
            into_map(json!({ "payload": payload, "location": location })),
        );
        flush();
        previous(info);
    }));
}

#[cfg(test)]
// EXCEPTION to tests-folder conventions: the module is private to the crate, and the tests drive
// the private `Level`, `build_line` and the record writers.
#[path = "../tests/unit/logging.rs"]
mod tests;
