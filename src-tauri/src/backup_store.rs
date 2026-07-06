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

use rusqlite::{params, Connection, OptionalExtension};
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

    let StoreState::Open(open) = &*guard else {
        return; // unreachable after the match above, but keeps this total
    };

    if let Err(error) = insert_if_changed(&open.conn, absolute_path, bytes) {
        crate::logging::warn(
            "backup store: failed to record a managed write",
            json!({ "file": absolute_path.to_string_lossy(), "error": error }),
        );
    }
}

/// The dedup-read + conditional insert, factored out so the error handling above
/// stays a single `warn`. Returns `Err(reason)` on any SQLite failure.
fn insert_if_changed(conn: &Connection, absolute_path: &Path, bytes: &[u8]) -> Result<(), String> {
    let path_str = absolute_path.to_string_lossy();
    let hash = sha256_hex(bytes);

    let latest: Option<String> = conn
        .query_row(
            "SELECT content_sha256 FROM backups WHERE path = ?1 ORDER BY id DESC LIMIT 1",
            params![path_str],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;

    // Unchanged since the last recorded version — dedup skip.
    if latest.as_deref() == Some(hash.as_str()) {
        return Ok(());
    }

    // written_at_utc is the serialized ISO-8601-ms form (a data value), never the
    // filename stamp: e.g. 2026-07-06T04:05:12.345Z.
    let written_at_utc = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

    conn.execute(
        "INSERT INTO backups (path, content, content_sha256, byte_size, written_at_utc)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![path_str, bytes, hash, bytes.len() as i64, written_at_utc],
    )
    .map_err(|error| error.to_string())?;

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
mod tests {
    use super::*;

    /// A fresh in-file store in a throwaway directory, with the singleton reset so
    /// each test opens against its own root (mirrors the JS teardown that closes
    /// the store between throwaway roots so the singleton re-opens).
    fn fresh_store(dir: &Path) -> PathBuf {
        close_backup_store();
        dir.join(BACKUPS_DB_FILE_NAME)
    }

    fn latest_row(store_file: &Path, path: &Path) -> Option<(Vec<u8>, String, i64, String)> {
        let conn = Connection::open(store_file).unwrap();
        conn.query_row(
            "SELECT content, content_sha256, byte_size, written_at_utc
             FROM backups WHERE path = ?1 ORDER BY id DESC LIMIT 1",
            params![path.to_string_lossy()],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()
        .unwrap()
    }

    fn row_count(store_file: &Path, path: &Path) -> i64 {
        let conn = Connection::open(store_file).unwrap();
        conn.query_row(
            "SELECT count(*) FROM backups WHERE path = ?1",
            params![path.to_string_lossy()],
            |row| row.get(0),
        )
        .unwrap()
    }

    #[test]
    fn content_blob_is_byte_identical_including_crlf_and_non_utf8() {
        let dir = tempfile::tempdir().unwrap();
        let store = fresh_store(dir.path());
        let target = dir.path().join("config.json");

        // A CR/LF pair and a raw non-UTF-8 byte (0xFF is never valid UTF-8), to
        // prove the BLOB stores the exact bytes rather than a decoded/normalized
        // string. Reading as text would corrupt or reject 0xFF and could rewrite
        // the CR/LF.
        let bytes: Vec<u8> = vec![b'a', b'\r', b'\n', 0xFF, 0x00, b'z'];
        record(&store, &target, &bytes);

        let (content, sha, byte_size, _written) = latest_row(&store, &target).unwrap();
        assert_eq!(content, bytes, "BLOB must be byte-identical to what was written");
        assert_eq!(byte_size, bytes.len() as i64);
        assert_eq!(sha, sha256_hex(&bytes));
    }

    #[test]
    fn written_at_utc_is_serialized_iso_ms_not_the_filename_stamp() {
        let dir = tempfile::tempdir().unwrap();
        let store = fresh_store(dir.path());
        let target = dir.path().join("state.json");
        record(&store, &target, b"hello");

        let (_content, _sha, _size, written) = latest_row(&store, &target).unwrap();
        // Serialized ISO-8601-ms shape: 2026-07-06T04:05:12.345Z — length 24, ends
        // in 'Z', a '.' before the millisecond field, and a 'T' separator.
        assert_eq!(written.len(), 24, "written_at_utc: {written}");
        assert!(written.ends_with('Z'), "written_at_utc: {written}");
        assert_eq!(&written[19..20], ".", "written_at_utc: {written}");
        assert_eq!(&written[10..11], "T", "written_at_utc: {written}");
        assert!(
            chrono::DateTime::parse_from_rfc3339(&written).is_ok(),
            "not rfc3339: {written}"
        );
        // It is NOT the yyyymmdd-hhmmss(-fff)-utc filename stamp: no "-utc" suffix,
        // and it carries ':' and '-' in the ISO layout the filename form strips.
        assert!(!written.ends_with("-utc"), "must not be a filename stamp: {written}");
        assert!(written.contains(':'), "must be the ISO form: {written}");
    }

    #[test]
    fn unchanged_resave_is_deduped_and_writes_no_row() {
        let dir = tempfile::tempdir().unwrap();
        let store = fresh_store(dir.path());
        let target = dir.path().join("config.json");

        record(&store, &target, b"same body");
        record(&store, &target, b"same body");
        assert_eq!(row_count(&store, &target), 1, "an unchanged re-save must not insert");
    }

    #[test]
    fn a_changed_save_and_a_revert_each_insert_a_row() {
        let dir = tempfile::tempdir().unwrap();
        let store = fresh_store(dir.path());
        let target = dir.path().join("config.json");

        record(&store, &target, b"v1"); // insert
        record(&store, &target, b"v2"); // changed -> insert
        record(&store, &target, b"v1"); // revert differs from the *preceding* row -> insert

        assert_eq!(
            row_count(&store, &target),
            3,
            "v1, v2, then a revert to v1 are three distinct versions"
        );

        // The latest row is the reverted content, byte-identical.
        let (content, ..) = latest_row(&store, &target).unwrap();
        assert_eq!(content, b"v1");
    }

    #[test]
    fn distinct_paths_do_not_dedup_against_each_other() {
        let dir = tempfile::tempdir().unwrap();
        let store = fresh_store(dir.path());
        let config = dir.path().join("config.json");
        let state = dir.path().join("state.json");

        // Same bytes, different paths: dedup is per-path, so both record.
        record(&store, &config, b"shared");
        record(&store, &state, b"shared");
        assert_eq!(row_count(&store, &config), 1);
        assert_eq!(row_count(&store, &state), 1);
    }

    #[test]
    fn record_is_best_effort_when_the_store_cannot_be_opened() {
        // Inject a store failure: point the store file at a path whose parent is a
        // regular FILE, so create_dir_all / open cannot succeed. record must not
        // panic, must disable for the session, and must leave the save unaffected
        // (there is nothing for it to break — it returns quietly).
        let dir = tempfile::tempdir().unwrap();
        close_backup_store();

        let blocker = dir.path().join("not-a-dir");
        std::fs::write(&blocker, b"x").unwrap();
        let store = blocker.join(BACKUPS_DB_FILE_NAME); // parent is a file, not a dir
        let target = dir.path().join("config.json");

        // Does not panic.
        record(&store, &target, b"content");

        // The store file was never created, and recording is now disabled for the
        // session: a later record against a *valid* store file is a no-op until the
        // singleton is reset (proving the disable latched rather than retrying).
        assert!(!store.exists(), "no store file should have been created");

        let good_store = dir.path().join(BACKUPS_DB_FILE_NAME);
        record(&good_store, &target, b"content");
        assert!(
            !good_store.exists(),
            "recording stays disabled for the session after an open failure"
        );

        // After a reset, recording works again (per-root re-open).
        close_backup_store();
        record(&good_store, &target, b"content");
        assert_eq!(row_count(&good_store, &target), 1);
    }
}
