//! The backup history (data-backup conventions): one SQLite file,
//! `backups.sqlite3`, directly under quickdeck's storage root (`QUICKDECK_DATA_DIR`
//! or `~/.quickdeck`, resolved in one place by `paths.rs` — never a hardcoded path
//! here). It holds the last saved version of each protected file from each app
//! session, so a bug that damages the user's text or settings leaves an earlier
//! session's version to restore by hand. There is no startup scan, no periodic
//! pass and no restore path.
//!
//! A save hands its exact bytes to `record` strictly after its atomic rename
//! lands and while it still holds the managed-write lock (see
//! `storage::write_json_atomically`), so history follows save order. `record`
//! only queues them; one writer thread applies them. A newer save of a path
//! replaces that path's pending version, so pending work never holds more than
//! one version per file. Ordinary quit drains the queue for at most
//! `DRAIN_WAIT`; an OS session end does not wait (lib.rs).
//!
//! Nothing here can delay or fail a save. A store that cannot be opened is
//! logged once and recording stops for the session; a failed write is logged
//! once until a write succeeds again. A crash, stalled store or forced exit may
//! omit a session's latest version while the file itself stays saved.
//!
//! SQLite binding: `rusqlite` (bundled), the same binding the snapshot store
//! uses. A BLOB comes back as raw bytes (`Vec<u8>`) for byte-identical
//! hashing and compare.

use std::{
    path::{Path, PathBuf},
    sync::{Arc, Condvar, Mutex, MutexGuard, OnceLock, PoisonError},
    thread::JoinHandle,
    time::Duration,
};

use rusqlite::{params, Connection, OptionalExtension};
use serde_json::json;
use sha2::{Digest, Sha256};

use crate::format_version::{self, SqliteFormat};

/// The store file's basename, under the resolved storage root. The full path is
/// composed by the caller, which already holds the resolved data dir, so this
/// module never resolves a path itself.
pub const BACKUPS_DB_FILE_NAME: &str = "backups.sqlite3";

/// How long an ordinary quit waits for pending history; part of the quit's
/// budget (src/quit.rs). An OS session end skips it.
pub(crate) const DRAIN_WAIT: Duration = Duration::from_millis(500);

/// The one table. `content` is a BLOB of the exact bytes written — never decoded
/// text, so CR/LF, a BOM and non-UTF-8 bytes are stored byte-identically.
/// `written_at_utc` is the serialized ISO-8601-ms form of the row's latest save
/// (`2026-07-06T04:05:12.345Z`), a data value, never a filename stamp. The
/// unique `(path, session_id)` owns the one row per file per session; rows from
/// before sessions keep a null `session_id`, which never conflicts. The
/// `(path, id)` index serves the latest-row lookup.
const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS backups (
  id             INTEGER PRIMARY KEY,
  path           TEXT NOT NULL,
  content        BLOB NOT NULL,
  content_sha256 TEXT NOT NULL,
  byte_size      INTEGER NOT NULL,
  written_at_utc TEXT NOT NULL,
  session_id     TEXT
);
CREATE INDEX IF NOT EXISTS idx_backups_path_id ON backups (path, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_backups_path_session ON backups (path, session_id);
";

/// A format-1 store, from before sessions, gains the session column; its rows
/// stay as earlier history.
const UPGRADE_FROM_1: &str = "
ALTER TABLE backups ADD COLUMN session_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_backups_path_session ON backups (path, session_id);
";

/// One saved version waiting for the writer.
struct Version {
    path: PathBuf,
    bytes: Vec<u8>,
    written_at_utc: String,
}

/// What the writer thread and its callers share.
#[derive(Default)]
struct Queue {
    pending: Vec<Version>,
    /// The writer is applying a batch it has taken from `pending`.
    writing: bool,
    /// No more versions are accepted; the writer finishes what is pending and stops.
    closed: bool,
}

type Shared = Arc<(Mutex<Queue>, Condvar)>;

/// The writer for one store file.
struct Writer {
    store_file: PathBuf,
    shared: Shared,
    thread: Option<JoinHandle<()>>,
}

/// The process's writer, started by the first save. Keyed by its store file so a
/// test's throwaway root gets its own; the app's root never changes.
static WRITER: Mutex<Option<Writer>> = Mutex::new(None);

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    // A poisoned lock means a thread panicked while holding it; the queue it
    // guards is still consistent, and the backup must never crash the app.
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// This launch's session: generated once per process, so another launch can
/// never replace this one's rows.
fn session_id() -> &'static str {
    static SESSION_ID: OnceLock<String> = OnceLock::new();
    SESSION_ID.get_or_init(|| {
        crate::nanoid::generate().unwrap_or_else(|_| {
            format!(
                "{}-{}",
                chrono::Utc::now().format("%Y%m%d-%H%M%S-%9f-utc"),
                std::process::id()
            )
        })
    })
}

/// Queue one protected write: `store_file` is the resolved absolute path of
/// `backups.sqlite3`; `absolute_path` is the FULL absolute path of the file as
/// written; `bytes` is the exact raw bytes just written (the caller already holds
/// them — never re-read the file). Returns at once; no I/O happens here.
pub fn record(store_file: &Path, absolute_path: &Path, bytes: &[u8]) {
    let version = Version {
        path: absolute_path.to_path_buf(),
        bytes: bytes.to_vec(),
        written_at_utc: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
    };
    let mut writer = lock(&WRITER);
    if writer
        .as_ref()
        .is_none_or(|writer| writer.store_file != store_file)
    {
        // A writer for another root stops after its pending versions, unjoined.
        if let Some(previous) = writer.take() {
            previous.stop();
        }
        *writer = Some(Writer::start(store_file));
    }
    if let Some(writer) = writer.as_ref() {
        writer.enqueue(version);
    }
}

/// Waits at most `bound` until every version queued so far is written or has
/// failed; true when nothing is left. Called at ordinary quit.
pub fn drain(bound: Duration) -> bool {
    let Some(shared) = lock(&WRITER).as_ref().map(|writer| writer.shared.clone()) else {
        return true;
    };
    let (queue, changed) = &*shared;
    let (queue, _) = changed
        .wait_timeout_while(lock(queue), bound, |queue| {
            !queue.pending.is_empty() || queue.writing
        })
        .unwrap_or_else(PoisonError::into_inner);
    let drained = queue.pending.is_empty() && !queue.writing;
    if !drained {
        crate::logging::warn(
            "backup drain wait expired",
            json!({ "ms": bound.as_millis() as u64 }),
        );
    }
    drained
}

/// Stops the writer after its pending versions and waits for it, so the next
/// `record` starts a fresh one. Tests call it to settle the store and release
/// its file between throwaway roots.
pub fn close_backup_store() {
    let writer = lock(&WRITER).take();
    if let Some(mut writer) = writer {
        writer.stop();
        if let Some(thread) = writer.thread.take() {
            let _ = thread.join();
        }
    }
}

impl Writer {
    fn start(store_file: &Path) -> Self {
        let shared: Shared = Arc::default();
        let worker = shared.clone();
        let file = store_file.to_path_buf();
        let session = session_id();
        let thread = std::thread::Builder::new()
            .name("backups".to_string())
            .spawn(move || run_writer(&file, session, &worker));
        let thread = match thread {
            Ok(thread) => Some(thread),
            Err(error) => {
                warn_unavailable(store_file, &error.to_string());
                lock(&shared.0).closed = true;
                None
            }
        };
        Self {
            store_file: store_file.to_path_buf(),
            shared,
            thread,
        }
    }

    fn enqueue(&self, version: Version) {
        let (queue, changed) = &*self.shared;
        let mut queue = lock(queue);
        if queue.closed {
            return;
        }
        queue.pending.retain(|pending| pending.path != version.path);
        queue.pending.push(version);
        changed.notify_all();
    }

    fn stop(&self) {
        let (queue, changed) = &*self.shared;
        lock(queue).closed = true;
        changed.notify_all();
    }
}

/// The writer thread: owns the store connection and applies each batch of
/// pending versions in the order they were queued.
fn run_writer(store_file: &Path, session: &str, shared: &Shared) {
    let (queue, changed) = &**shared;
    // None until the first batch opens it; Err after an open that failed.
    let mut store: Option<Result<Connection, ()>> = None;
    let mut failing = false;
    loop {
        let batch = {
            let mut queue = changed
                .wait_while(lock(queue), |queue| queue.pending.is_empty() && !queue.closed)
                .unwrap_or_else(PoisonError::into_inner);
            if queue.pending.is_empty() {
                return;
            }
            queue.writing = true;
            std::mem::take(&mut queue.pending)
        };
        if let Ok(conn) = store.get_or_insert_with(|| open_store(store_file)) {
            for version in batch {
                match apply(conn, session, &version) {
                    Ok(()) => failing = false,
                    Err(error) if !failing => {
                        failing = true;
                        crate::logging::warn(
                            "backup store: failed to record a protected write",
                            json!({ "file": version.path.to_string_lossy(), "error": error }),
                        );
                    }
                    Err(_) => {}
                }
            }
        }
        lock(queue).writing = false;
        changed.notify_all();
    }
}

/// Opens and prepares the store for `file`. On any failure it logs ONE warn and
/// returns `Err(())`, and recording stays off for the session.
// The root already exists: the save being recorded was just written into it. A
// data folder deleted while the app runs is not made again here.
fn open_store(file: &Path) -> Result<Connection, ()> {
    let opened = Connection::open(file)
        .map_err(|error| error.to_string())
        .and_then(|conn| prepare_store(&conn).map(|()| conn));
    opened.map_err(|reason| warn_unavailable(file, &reason))
}

/// The format check, before anything that writes. A new store gets WAL, its
/// schema and its format marker; a format-1 store is upgraded in place; a store
/// in a newer format is left untouched.
fn prepare_store(conn: &Connection) -> Result<(), String> {
    let to_string = |error: rusqlite::Error| error.to_string();
    // Only this process writes the store (instance.lock); the timeout covers a
    // reader such as a developer inspecting it, without holding up the writer long.
    conn.busy_timeout(Duration::from_secs(1))
        .map_err(to_string)?;
    match format_version::check_sqlite(conn, BACKUPS_DB_FILE_NAME, format_version::BACKUPS)? {
        SqliteFormat::Newer(recorded) => Err(format_version::newer_message(
            BACKUPS_DB_FILE_NAME,
            recorded,
        )),
        SqliteFormat::New => conn
            .pragma_update(None, "journal_mode", "WAL")
            .and_then(|_| format_version::create_sqlite(conn, SCHEMA, format_version::BACKUPS))
            .map_err(to_string),
        SqliteFormat::Readable => {
            let recorded: i64 = conn
                .pragma_query_value(None, "user_version", |row| row.get(0))
                .map_err(to_string)?;
            if recorded == 1 {
                format_version::create_sqlite(conn, UPGRADE_FROM_1, format_version::BACKUPS)
                    .map_err(to_string)?;
            }
            Ok(())
        }
    }
}

/// Logs the one line that says recording is off for this session. Naming the
/// file and the reason is enough to diagnose.
fn warn_unavailable(file: &Path, reason: &str) {
    crate::logging::warn(
        "backup store: could not open; recording disabled for this session",
        json!({ "file": file.to_string_lossy(), "error": reason }),
    );
}

/// SHA-256 of the exact bytes, lowercase hex.
fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// Records one version as `session`'s row for its path. The session's first
/// save of a path inserts the row and later saves replace it; a first save
/// equal to the latest row of an earlier session writes nothing, so relaunching
/// and saving unchanged text adds no row. Only this process writes the store,
/// so the latest row of a path is this session's whenever it has one.
fn apply(conn: &Connection, session: &str, version: &Version) -> Result<(), String> {
    let path = version.path.to_string_lossy();
    let hash = sha256_hex(&version.bytes);
    let latest: Option<(Option<String>, String)> = conn
        .query_row(
            "SELECT session_id, content_sha256 FROM backups WHERE path = ?1 ORDER BY id DESC LIMIT 1",
            params![path],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    if latest.is_some_and(|(_, latest_hash)| latest_hash == hash) {
        return Ok(());
    }
    conn.execute(
        "INSERT INTO backups (session_id, path, content, content_sha256, byte_size, written_at_utc)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT (path, session_id) DO UPDATE SET
           content = excluded.content,
           content_sha256 = excluded.content_sha256,
           byte_size = excluded.byte_size,
           written_at_utc = excluded.written_at_utc",
        params![
            session,
            path,
            version.bytes,
            hash,
            version.bytes.len() as i64,
            version.written_at_utc
        ],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(test)]
// EXCEPTION to tests-folder conventions: exercises the private `apply`, `sha256_hex` and
// queue alongside the public store, so per-session rows and hashing stay covered
// without widening the crate's API.
#[path = "../tests/unit/backup_store.rs"]
mod tests;
