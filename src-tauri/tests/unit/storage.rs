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
        pane_title: format!("{pane} title"),
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

#[test]
fn a_snapshot_keeps_the_pane_title_it_was_taken_under() {
    let conn = mem_db();
    create_snapshot_with_connection(&conn, input("pane-1", "hello")).expect("insert");

    let listed = list_snapshots_with_connection(&conn, "", 10, 0).expect("list");
    let row = listed.rows.first().expect("one row");
    assert_eq!(row.pane_title, "pane-1 title");
}

#[test]
fn a_store_written_before_titles_gains_the_column_and_reads_its_rows_as_unnamed() {
    let conn = Connection::open_in_memory().expect("open in-memory db");
    // The schema as it stood before a snapshot carried its pane's name.
    conn.execute_batch(
        "create table snapshots (
           id text primary key,
           pane_id text not null,
           created_at_utc text not null,
           trigger text not null,
           content_hash text not null,
           content text not null
         );
         insert into snapshots (id, pane_id, created_at_utc, trigger, content_hash, content)
         values ('old', 'pane-1', '2026-09-08T00:00:00.000Z', 'copy', 'hash', 'kept text');",
    )
    .expect("old schema");

    init_schema(&conn).expect("migrate");

    let listed = list_snapshots_with_connection(&conn, "", 10, 0).expect("list");
    let row = listed.rows.first().expect("the old row survives");
    assert_eq!(row.content, "kept text");
    assert_eq!(row.pane_title, "");
}

#[test]
fn deleting_takes_one_copy_or_the_whole_store() {
    let conn = mem_db();
    for content in ["first", "second", "third"] {
        create_snapshot_with_connection(&conn, input("pane-1", content)).expect("insert");
    }

    let listed = list_snapshots_with_connection(&conn, "", 10, 0).expect("list");
    let target = listed.rows.first().expect("a row").id.clone();

    assert!(delete_snapshot_with_connection(&conn, &target).expect("delete"));
    // Gone means gone: asking again says there was nothing to take.
    assert!(!delete_snapshot_with_connection(&conn, &target).expect("delete again"));
    let after = list_snapshots_with_connection(&conn, "", 10, 0).expect("list");
    assert_eq!(after.rows.len(), 2);
    assert!(after.rows.iter().all(|row| row.id != target));

    assert_eq!(delete_all_snapshots_with_connection(&conn).expect("delete all"), 2);
    let empty = list_snapshots_with_connection(&conn, "", 10, 0).expect("list");
    assert!(empty.rows.is_empty());

    // The store still works afterwards: emptying is not closing.
    create_snapshot_with_connection(&conn, input("pane-1", "after")).expect("insert");
    let reused = list_snapshots_with_connection(&conn, "", 10, 0).expect("list");
    assert_eq!(reused.rows.len(), 1);
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

// --- list_snapshots_with_connection ----------------------------------

#[test]
fn blank_query_lists_the_whole_store_newest_first() {
    let conn = mem_db();
    insert_row(&conn, "id1", "p1", "2026-01-01T00:00:01.000Z", "hello world");
    insert_row(&conn, "id2", "p2", "2026-01-01T00:00:02.000Z", "nothing in common");

    for query in ["", "   ", "\t\n"] {
        let result = list_snapshots_with_connection(&conn, query, 25, 0).unwrap();
        let ids = result.rows.iter().map(|row| row.id.as_str()).collect::<Vec<_>>();
        assert_eq!(ids, ["id2", "id1"], "query {query:?} should list every row");
        assert!(!result.has_more);
    }
}

#[test]
fn blank_query_paginates_like_a_search() {
    let conn = mem_db();
    for index in 1..=3 {
        insert_row(
            &conn,
            &format!("id{index}"),
            "p1",
            &format!("2026-01-01T00:00:0{index}.000Z"),
            &format!("row {index}"),
        );
    }

    let first = list_snapshots_with_connection(&conn, "", 2, 0).unwrap();
    assert_eq!(
        first.rows.iter().map(|row| row.id.as_str()).collect::<Vec<_>>(),
        ["id3", "id2"]
    );
    assert!(first.has_more);

    let second = list_snapshots_with_connection(&conn, "", 2, 2).unwrap();
    assert_eq!(
        second.rows.iter().map(|row| row.id.as_str()).collect::<Vec<_>>(),
        ["id1"]
    );
    assert!(!second.has_more);
}

// The modal resolves this id against the live panes to colour a row; a
// snapshot from a deleted pane simply finds no match.
#[test]
fn rows_carry_the_pane_they_came_from() {
    let conn = mem_db();
    insert_row(&conn, "id1", "pane-abc", "2026-01-01T00:00:01.000Z", "hello world");

    let result = list_snapshots_with_connection(&conn, "", 25, 0).unwrap();
    assert_eq!(result.rows[0].pane_id, "pane-abc");
}

#[test]
fn search_is_case_insensitive() {
    let conn = mem_db();
    insert_row(&conn, "id1", "p1", "2026-01-01T00:00:01.000Z", "The Quick Brown Fox");
    let result = list_snapshots_with_connection(&conn, "QUICK", 25, 0).unwrap();
    assert_eq!(result.rows.len(), 1);
    assert_eq!(result.rows[0].id, "id1");
}

#[test]
fn search_requires_all_terms() {
    let conn = mem_db();
    insert_row(&conn, "both", "p1", "2026-01-01T00:00:02.000Z", "alpha beta gamma");
    insert_row(&conn, "one", "p1", "2026-01-01T00:00:01.000Z", "alpha only");

    let result = list_snapshots_with_connection(&conn, "alpha gamma", 25, 0).unwrap();
    assert_eq!(result.rows.len(), 1);
    assert_eq!(result.rows[0].id, "both");
}

#[test]
fn search_treats_like_wildcards_literally() {
    let conn = mem_db();
    insert_row(&conn, "pct", "p1", "2026-01-01T00:00:02.000Z", "50% off today");
    insert_row(&conn, "plain", "p1", "2026-01-01T00:00:01.000Z", "500 dollars");

    // Without LIKE escaping, "50%" would match "500" too.
    let result = list_snapshots_with_connection(&conn, "50%", 25, 0).unwrap();
    assert_eq!(result.rows.len(), 1);
    assert_eq!(result.rows[0].id, "pct");
}

#[test]
fn search_orders_by_timestamp_descending() {
    let conn = mem_db();
    insert_row(&conn, "old", "p1", "2026-01-01T00:00:01.000Z", "note one");
    insert_row(&conn, "new", "p1", "2026-01-01T00:00:03.000Z", "note two");
    insert_row(&conn, "mid", "p1", "2026-01-01T00:00:02.000Z", "note three");

    let result = list_snapshots_with_connection(&conn, "note", 25, 0).unwrap();
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

    let result = list_snapshots_with_connection(&conn, "note", 25, 0).unwrap();
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

    let page = list_snapshots_with_connection(&conn, "term", 2, 0).unwrap();
    assert_eq!(page.rows.len(), 2);
    assert!(page.has_more);

    let rest = list_snapshots_with_connection(&conn, "term", 2, 2).unwrap();
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

    let page1 = list_snapshots_with_connection(&conn, "term", 2, 0).unwrap();
    let page2 = list_snapshots_with_connection(&conn, "term", 2, 2).unwrap();

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
    let result = list_snapshots_with_connection(&conn, "term", 0, 0).unwrap();
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
