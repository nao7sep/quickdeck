use super::*;
use serial_test::serial;

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
#[serial(backup_store)]
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
#[serial(backup_store)]
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
#[serial(backup_store)]
fn unchanged_resave_is_deduped_and_writes_no_row() {
    let dir = tempfile::tempdir().unwrap();
    let store = fresh_store(dir.path());
    let target = dir.path().join("config.json");

    record(&store, &target, b"same body");
    record(&store, &target, b"same body");
    assert_eq!(row_count(&store, &target), 1, "an unchanged re-save must not insert");
}

#[test]
#[serial(backup_store)]
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
#[serial(backup_store)]
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
#[serial(backup_store)]
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
