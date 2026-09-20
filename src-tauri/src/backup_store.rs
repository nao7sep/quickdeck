//! The write-through data-backup store (data-backup conventions). It owns one
//! add-only SQLite file, `backups.sqlite3`, directly under quickdeck's storage
//! root (`QUICKDECK_HOME` or `~/.quickdeck`, resolved in one place by `paths.rs`
//! via the storage layer — never a hardcoded path here). Every managed *text*
//! save records the exact bytes it just wrote here, strictly AFTER its atomic
//! rename lands (see `storage::atomic_write_json`), so the history is always as
//! current as the last save. There is no startup scan, no periodic pass, no
//! restore path.
//!
//! SQLite binding: `rusqlite` (bundled), the same binding the snapshot store
//! already uses — no second SQLite dependency, no native-rebuild churn. It is
//! synchronous, exactly what a record-after-rename hook wants, and returns a BLOB
//! as raw bytes (`Vec<u8>`) for byte-identical hashing and compare.
//!
//! Two absolute musts drive every line below (they are not best-effort aspirations):
//!
//!  - It never breaks a save and never crashes the app. The save has already
//!    succeeded — the file is on disk before `record` is called — so any failure
//!    here (the DB is locked, the disk is full, an insert errors) is caught,
//!    logged once at `warn`, and swallowed. A lost record self-heals on the next
//!    save of that file, whose content will differ from the last recorded row.
//!  - It logs only failures. A successful record logs NOTHING; a line per save
//!    would flood the log.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde_json::json;
use sha2::{Digest, Sha256};

/// The store file's basename, under the resolved storage root. The full path is
/// composed by the caller (the choke point already holds the resolved data dir),
/// so this module never resolves a path itself — the one-resolver rule stays intact.
pub const BACKUPS_DB_FILE_NAME: &str = "backups.sqlite3";

/// The one add-only table. `content` is a BLOB of the exact bytes written — never
/// decoded text, so CR/LF, a BOM, and non-UTF-8 bytes are stored byte-identically.
/// `written_at_utc` is the serialized ISO-8601-ms form (`2026-07-06T04:05:12.345Z`),
/// a data value — NEVER the `yyyymmdd-hhmmss-fff-utc` filename stamp. The
/// `(path, id)` index serves the latest-row-per-path dedup lookup.
const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS backups (
  id             INTEGER PRIMARY KEY,
  path           TEXT NOT NULL,
  content        BLOB NOT NULL,
  content_sha256 TEXT NOT NULL,
  byte_size      INTEGER NOT NULL,
  written_at_utc TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_backups_path_id ON backups (path, id);
";

/// The resolved store: a live connection plus the file it was opened against.
struct OpenStore {
    conn: Connection,
    file: PathBuf,
}

/// The session-wide state of the store:
///
/// - `Uninitialized` — not yet opened this session.
/// - `Disabled`      — the open failed (a single warn was already logged); every
///   later `record` becomes a no-op rather than retrying (and re-logging) a broken
///   open on every save.
/// - `Open`          — the live store, keyed by the file it was opened against so
///   a changed root (a test's throwaway `QUICKDECK_HOME`) forces a re-open.
enum StoreState {
    Uninitialized,
    Disabled,
    Open(OpenStore),
}

/// Module-level singleton. A `Mutex` (not a bare cell) because two app windows can
/// call `record` concurrently and the connection is not `Sync`; the lock also
/// serializes the dedup-read + insert into one critical section per record.
static STORE: Mutex<StoreState> = Mutex::new(StoreState::Uninitialized);

/// Opens and initializes the store for `file` (create the table if absent, switch
/// on WAL, set a busy timeout). Best-effort: on any failure it logs ONE warn and
/// returns `Err(())`, leaving the caller to disable recording for the session.
///
/// WAL is what lets the tolerated two-instance case (two quickdeck windows writing
/// at once) serialize safely without a cross-process lock. `busy_timeout = 5000`
/// makes a contended write wait up to five seconds for SQLite's write lock instead
/// of immediately failing with `SQLITE_BUSY` and dropping that record.
fn open_store(file: &Path) -> Result<Connection, ()> {
    // The first writer under the root does the `mkdir -p` (storage-path convention);
    // the store may be the first thing written on a fresh root.
    if let Some(parent) = file.parent() {
        if let Err(error) = std::fs::create_dir_all(parent) {
            warn_once(file, &error.to_string());
            return Err(());
        }
    }
    let conn = match Connection::open(file) {
        Ok(conn) => conn,
        Err(error) => {
            warn_once(file, &error.to_string());
            return Err(());
        }
    };
    if let Err(error) = conn
        .pragma_update(None, "journal_mode", "WAL")
        .and_then(|_| conn.pragma_update(None, "busy_timeout", 5000))
        .and_then(|_| conn.execute_batch(SCHEMA))
    {
        warn_once(file, &error.to_string());
        return Err(());
    }
    Ok(conn)
}

/// Logs the one open/disable warn line. Naming the file and the reason is enough
/// to diagnose; recording is disabled for the session after this.
fn warn_once(file: &Path, reason: &str) {
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

/// Record one managed-text write: `store_file` is the resolved absolute path of
/// `backups.sqlite3` (the caller composes it from the single resolver's data dir);
/// `absolute_path` is the FULL absolute path of the file as written; `bytes` is the
/// exact raw bytes just written (the caller already holds them — never re-read the
/// file).
///
/// Dedup by content hash per path: the new content's SHA-256 is compared against
/// the latest row for the same `path`, and the insert is SKIPPED when they are
/// equal. This collapses consecutive identical saves (an autosave with no real
/// change writes no row) while still recording every genuinely distinct version —
/// including a revert, whose content differs from the immediately preceding row.
///
/// Best-effort and silent on success; any failure is caught, logged once at `warn`
/// (file + reason), and swallowed. It never panics, never crashes the app, and
/// never breaks the save.
pub fn record(store_file: &Path, absolute_path: &Path, bytes: &[u8]) {
    let mut guard = match STORE.lock() {
        Ok(guard) => guard,
        // A poisoned lock means another thread panicked mid-record. Recover the
        // inner state rather than propagating the panic — the backup must never
        // crash the app.
        Err(poisoned) => poisoned.into_inner(),
    };

    // Resolve the session state, opening (once) if needed. A root change between
    // throwaway test roots re-opens against the new file.
    match &*guard {
        StoreState::Disabled => return, // open failed earlier; already warned once
        StoreState::Open(open) if open.file == store_file => {}
        _ => match open_store(store_file) {
            Ok(conn) => {
                *guard = StoreState::Open(OpenStore {
                    conn,
                    file: store_file.to_path_buf(),
                });
            }
            Err(()) => {
                *guard = StoreState::Disabled;
                return;
            }
        },
    }

    let StoreState::Open(open) = &mut *guard else {
        return; // unreachable after the match above, but keeps this total
    };

    if let Err(error) = insert_if_changed(&mut open.conn, absolute_path, bytes) {
        crate::logging::warn(
            "backup store: failed to record a managed write",
            json!({ "file": absolute_path.to_string_lossy(), "error": error }),
        );
    }
}

/// The dedup-read + conditional insert, factored out so the error handling above
/// stays a single `warn`. Returns `Err(reason)` on any SQLite failure.
fn insert_if_changed(
    conn: &mut Connection,
    absolute_path: &Path,
    bytes: &[u8],
) -> Result<(), String> {
    let path_str = absolute_path.to_string_lossy();
    let hash = sha256_hex(bytes);

    // Acquire the SQLite write lock before reading the predecessor. WAL alone
    // serializes the INSERTs, not the SELECTs that decide whether to insert; two
    // processes using deferred transactions could both observe the same latest
    // row and append a duplicate. IMMEDIATE makes latest-read + conditional
    // insert one cross-process decision while busy_timeout handles contention.
    let transaction = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| error.to_string())?;

    let latest: Option<String> = transaction
        .query_row(
            "SELECT content_sha256 FROM backups WHERE path = ?1 ORDER BY id DESC LIMIT 1",
            params![path_str],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;

    // Unchanged since the last recorded version — dedup skip.
    if latest.as_deref() == Some(hash.as_str()) {
        transaction.commit().map_err(|error| error.to_string())?;
        return Ok(());
    }

    // written_at_utc is the serialized ISO-8601-ms form (a data value), never the
    // filename stamp: e.g. 2026-07-06T04:05:12.345Z.
    let written_at_utc = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

    transaction
        .execute(
            "INSERT INTO backups (path, content, content_sha256, byte_size, written_at_utc)
         VALUES (?1, ?2, ?3, ?4, ?5)",
            params![path_str, bytes, hash, bytes.len() as i64, written_at_utc],
        )
        .map_err(|error| error.to_string())?;

    transaction.commit().map_err(|error| error.to_string())?;

    Ok(())
}

/// Close the store (best-effort). For tests that need to release the file handle
/// between throwaway roots; the app itself lets the process exit close it. Resets
/// the singleton so the next `record` re-opens against the current root.
pub fn close_backup_store() {
    let mut guard = match STORE.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    // Dropping the connection closes it; a close failure on teardown is harmless.
    *guard = StoreState::Uninitialized;
}

#[cfg(test)]
// EXCEPTION to tests-folder conventions: exercises the private `sha256_hex` alongside the public
// store, so the hashing it records stays covered without widening the crate's API.
#[path = "../tests/unit/backup_store.rs"]
mod tests;
