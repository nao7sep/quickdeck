use super::*;
use serial_test::serial;
use std::time::Instant;

/// A store file in a throwaway directory, with the writer reset so each test
/// starts its own against its own root.
fn fresh_store(dir: &Path) -> PathBuf {
    close_backup_store();
    dir.join(BACKUPS_DB_FILE_NAME)
}

type Row = (Option<String>, Vec<u8>, String, i64, String);

fn rows(store_file: &Path, path: &Path) -> Vec<Row> {
    let conn = Connection::open(store_file).unwrap();
    let mut statement = conn
        .prepare(
            "SELECT session_id, content, content_sha256, byte_size, written_at_utc
             FROM backups WHERE path = ?1 ORDER BY id",
        )
        .unwrap();
    statement
        .query_map(params![path.to_string_lossy()], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?))
        })
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap()
}

fn contents(store_file: &Path, path: &Path) -> Vec<Vec<u8>> {
    rows(store_file, path).into_iter().map(|row| row.1).collect()
}

fn version(path: &Path, bytes: &[u8]) -> Version {
    Version {
        path: path.to_path_buf(),
        bytes: bytes.to_vec(),
        written_at_utc: "2026-10-09T00:00:00.000Z".to_string(),
    }
}

/// A prepared store on its own connection, for driving `apply` with chosen sessions.
fn open(store_file: &Path) -> Connection {
    let conn = Connection::open(store_file).unwrap();
    prepare_store(&conn).unwrap();
    conn
}

#[test]
#[serial(backup_store)]
fn content_blob_is_byte_identical_including_crlf_and_non_utf8() {
    let dir = tempfile::tempdir().unwrap();
    let store = fresh_store(dir.path());
    let target = dir.path().join("config.json");

    // A CR/LF pair and a raw non-UTF-8 byte (0xFF is never valid UTF-8), to
    // prove the BLOB stores the exact bytes rather than a decoded string.
    let bytes: Vec<u8> = vec![b'a', b'\r', b'\n', 0xFF, 0x00, b'z'];
    record(&store, &target, &bytes);
    close_backup_store();

    let [(session, content, sha, byte_size, _)] = rows(&store, &target).try_into().unwrap();
    assert_eq!(session.as_deref(), Some(session_id()));
    assert_eq!(content, bytes, "BLOB must be byte-identical to what was written");
    assert_eq!(byte_size, bytes.len() as i64);
    assert_eq!(sha, sha256_hex(&bytes));
}

#[test]
#[serial(backup_store)]
fn written_at_utc_is_serialized_iso_ms_not_the_filename_stamp() {
    let dir = tempfile::tempdir().unwrap();
    let store = fresh_store(dir.path());
    let target = dir.path().join("panes.json");
    record(&store, &target, b"hello");
    close_backup_store();

    let [(.., written)] = rows(&store, &target).try_into().unwrap();
    // 2026-07-06T04:05:12.345Z: length 24, a 'T' separator, a '.' before the
    // milliseconds, 'Z' last — never the yyyymmdd-hhmmss-utc filename stamp.
    assert_eq!(written.len(), 24, "written_at_utc: {written}");
    assert!(written.ends_with('Z'), "written_at_utc: {written}");
    assert_eq!(&written[19..20], ".", "written_at_utc: {written}");
    assert_eq!(&written[10..11], "T", "written_at_utc: {written}");
    assert!(chrono::DateTime::parse_from_rfc3339(&written).is_ok(), "{written}");
}

#[test]
#[serial(backup_store)]
fn a_session_keeps_one_row_per_file_holding_its_latest_save() {
    let dir = tempfile::tempdir().unwrap();
    let store = fresh_store(dir.path());
    let config = dir.path().join("config.json");
    let panes = dir.path().join("panes.json");

    record(&store, &config, b"v1");
    record(&store, &panes, b"v1");
    close_backup_store();
    record(&store, &config, b"v2");
    record(&store, &config, b"v1");
    close_backup_store();

    assert_eq!(contents(&store, &config), [b"v1".to_vec()]);
    assert_eq!(contents(&store, &panes), [b"v1".to_vec()]);
}

#[test]
#[serial(backup_store)]
fn each_session_adds_its_own_row_and_never_changes_an_earlier_one() {
    let dir = tempfile::tempdir().unwrap();
    let store = dir.path().join(BACKUPS_DB_FILE_NAME);
    let path = dir.path().join("panes.json");
    let conn = open(&store);

    apply(&conn, "first", &version(&path, b"a")).unwrap();
    apply(&conn, "first", &version(&path, b"b")).unwrap();
    apply(&conn, "second", &version(&path, b"c")).unwrap();
    apply(&conn, "second", &version(&path, b"d")).unwrap();

    let sessions: Vec<_> = rows(&store, &path).into_iter().map(|row| (row.0, row.1)).collect();
    assert_eq!(
        sessions,
        [
            (Some("first".to_string()), b"b".to_vec()),
            (Some("second".to_string()), b"d".to_vec()),
        ]
    );
}

#[test]
#[serial(backup_store)]
fn a_first_save_equal_to_the_previous_sessions_row_adds_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let store = dir.path().join(BACKUPS_DB_FILE_NAME);
    let path = dir.path().join("panes.json");
    let conn = open(&store);

    apply(&conn, "first", &version(&path, b"same")).unwrap();
    apply(&conn, "second", &version(&path, b"same")).unwrap();
    assert_eq!(rows(&store, &path).len(), 1);

    // A later change in that session still gets its row.
    apply(&conn, "second", &version(&path, b"changed")).unwrap();
    assert_eq!(contents(&store, &path), [b"same".to_vec(), b"changed".to_vec()]);
}

#[test]
#[serial(backup_store)]
fn distinct_paths_keep_their_own_rows() {
    let dir = tempfile::tempdir().unwrap();
    let store = fresh_store(dir.path());
    let config = dir.path().join("config.json");
    let panes = dir.path().join("panes.json");

    record(&store, &config, b"shared");
    record(&store, &panes, b"shared");
    close_backup_store();
    assert_eq!(rows(&store, &config).len(), 1);
    assert_eq!(rows(&store, &panes).len(), 1);
}

#[test]
#[serial(backup_store)]
fn pending_work_keeps_only_the_newest_version_of_each_path() {
    let dir = tempfile::tempdir().unwrap();
    let writer = Writer {
        store_file: dir.path().join(BACKUPS_DB_FILE_NAME),
        shared: Arc::default(),
        thread: None,
    };
    let config = dir.path().join("config.json");
    let panes = dir.path().join("panes.json");

    writer.enqueue(version(&config, b"1"));
    writer.enqueue(version(&panes, b"1"));
    writer.enqueue(version(&config, b"2"));

    let queue = lock(&writer.shared.0);
    let pending: Vec<_> = queue
        .pending
        .iter()
        .map(|version| (version.path.clone(), version.bytes.clone()))
        .collect();
    assert_eq!(pending, [(panes, b"1".to_vec()), (config, b"2".to_vec())]);
}

#[test]
#[serial(backup_store)]
fn a_blocked_store_holds_up_neither_a_save_nor_the_next_save_of_that_file() {
    let dir = tempfile::tempdir().unwrap();
    let store = fresh_store(dir.path());
    let path = dir.path().join("panes.json");
    record(&store, &path, b"v1");
    assert!(drain(Duration::from_secs(5)));

    // Another connection holds the write lock, so the writer waits on it.
    let blocker = Connection::open(&store).unwrap();
    blocker.execute_batch("BEGIN EXCLUSIVE").unwrap();

    let started = Instant::now();
    record(&store, &path, b"v2");
    record(&store, &path, b"v3");
    assert!(
        started.elapsed() < Duration::from_millis(100),
        "record waited {:?}",
        started.elapsed()
    );
    assert!(!drain(Duration::from_millis(100)), "the drain is bounded");

    blocker.execute_batch("ROLLBACK").unwrap();
    close_backup_store();
    assert_eq!(contents(&store, &path), [b"v3".to_vec()]);
}

#[test]
#[serial(backup_store)]
fn record_is_best_effort_when_the_store_cannot_be_opened() {
    // The store file's parent is a regular FILE, so the store cannot be made.
    let dir = tempfile::tempdir().unwrap();
    close_backup_store();
    let blocker = dir.path().join("not-a-dir");
    std::fs::write(&blocker, b"x").unwrap();
    let store = blocker.join(BACKUPS_DB_FILE_NAME);
    let target = dir.path().join("config.json");

    record(&store, &target, b"content");
    record(&store, &target, b"content 2");
    assert!(drain(Duration::from_secs(5)), "a disabled store still drains");
    close_backup_store();
    assert!(!store.exists(), "no store file should have been created");

    // The next writer, for a usable root, records again.
    let good_store = dir.path().join(BACKUPS_DB_FILE_NAME);
    record(&good_store, &target, b"content");
    close_backup_store();
    assert_eq!(rows(&good_store, &target).len(), 1);
}

#[test]
#[serial(backup_store)]
fn a_new_store_records_its_format_version() {
    let dir = tempfile::tempdir().unwrap();
    let store = fresh_store(dir.path());
    record(&store, &dir.path().join("config.json"), b"{}");
    close_backup_store();
    let version: i64 = Connection::open(&store)
        .unwrap()
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .unwrap();
    assert_eq!(version, i64::from(format_version::BACKUPS));
}

#[test]
#[serial(backup_store)]
fn a_store_from_before_sessions_is_upgraded_with_its_rows_kept_as_earlier_history() {
    let dir = tempfile::tempdir().unwrap();
    let store = fresh_store(dir.path());
    let path = dir.path().join("panes.json");
    {
        let conn = Connection::open(&store).unwrap();
        conn.execute_batch(
            "CREATE TABLE backups (
               id INTEGER PRIMARY KEY, path TEXT NOT NULL, content BLOB NOT NULL,
               content_sha256 TEXT NOT NULL, byte_size INTEGER NOT NULL,
               written_at_utc TEXT NOT NULL);
             CREATE INDEX idx_backups_path_id ON backups (path, id);
             PRAGMA user_version = 1;",
        )
        .unwrap();
        for content in [b"old 1", b"old 2"] {
            conn.execute(
                "INSERT INTO backups (path, content, content_sha256, byte_size, written_at_utc)
                 VALUES (?1, ?2, ?3, 5, '2026-07-06T04:05:12.345Z')",
                params![path.to_string_lossy(), content.to_vec(), sha256_hex(content)],
            )
            .unwrap();
        }
    }

    record(&store, &path, b"old 2"); // equal to the latest earlier row: nothing
    close_backup_store();
    record(&store, &path, b"new");
    close_backup_store();

    let sessions: Vec<_> = rows(&store, &path).into_iter().map(|row| (row.0, row.1)).collect();
    assert_eq!(
        sessions,
        [
            (None, b"old 1".to_vec()),
            (None, b"old 2".to_vec()),
            (Some(session_id().to_string()), b"new".to_vec()),
        ]
    );
    let version: i64 = Connection::open(&store)
        .unwrap()
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .unwrap();
    assert_eq!(version, i64::from(format_version::BACKUPS));
}

#[test]
#[serial(backup_store)]
fn a_store_from_a_newer_build_is_left_untouched() {
    let dir = tempfile::tempdir().unwrap();
    let store = fresh_store(dir.path());
    Connection::open(&store)
        .unwrap()
        .execute_batch("pragma user_version = 3;")
        .unwrap();
    let before = std::fs::read(&store).unwrap();

    record(&store, &dir.path().join("config.json"), b"{}");
    close_backup_store();

    assert_eq!(std::fs::read(&store).unwrap(), before);
}

#[test]
#[serial(backup_store)]
fn a_store_without_its_marker_is_left_untouched() {
    let dir = tempfile::tempdir().unwrap();
    let store = fresh_store(dir.path());
    Connection::open(&store)
        .unwrap()
        .execute_batch(SCHEMA)
        .unwrap();
    let before = std::fs::read(&store).unwrap();

    record(&store, &dir.path().join("config.json"), b"{}");
    close_backup_store();

    assert_eq!(std::fs::read(&store).unwrap(), before);
}
