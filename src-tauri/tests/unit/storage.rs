use super::*;
use serial_test::serial;

#[path = "../support/statement_work.rs"]
mod statement_work;

#[test]
fn latest_snapshot_dedup_does_not_sort_retained_history() {
    let conn = mem_db();
    conn.execute(
        "WITH RECURSIVE sequence(id) AS (VALUES(1) UNION ALL SELECT id + 1 FROM sequence WHERE id < 40000)
         INSERT INTO snapshots(id, pane_id, pane_title, created_at_utc, trigger, content_hash, content)
         SELECT CAST(id AS TEXT), 'pane', '', strftime('%Y-%m-%dT%H:%M:%fZ', '2026-01-01', (40000 - id) || ' seconds'), 'copy', ?1, 'kept' FROM sequence",
        params![hash_content("kept")],
    ).unwrap();
    let (result, work) = statement_work::measure(&conn, || {
        create_snapshot_with_connection(&conn, input("pane", "kept")).unwrap()
    });
    assert!(!result.inserted);
    assert_eq!(result.id.as_deref(), Some("40000"));
    assert_eq!(
        work.sorts, 0,
        "dedup must follow insertion order directly: {work:?}"
    );
    assert!(
        work.steps < 1000,
        "lookup should not grow with retained history: {work:?}"
    );
}

// A JSON object's fields, as a readable store holds them.
fn fields(value: JsonValue) -> serde_json::Map<String, JsonValue> {
    match value {
        JsonValue::Object(fields) => fields,
        other => panic!("not an object: {other}"),
    }
}

// `content`'s fields under the header a store of `format` is written with, as
// the JSON it lands on disk as.
fn stamped(format: file_header::Format, content: JsonValue) -> JsonValue {
    file_header::stamp_json(&content, format).unwrap()
}

// A store of `format` holding `content`'s fields, as compact file text.
fn stored(format: file_header::Format, content: JsonValue) -> String {
    stamped(format, content).to_string()
}

// A store of `format`'s owner and kind, recorded in a newer version.
fn newer(format: file_header::Format) -> String {
    serde_json::json!({
        "format": { "owner": "quickdeck", "kind": format.kind, "version": format.version + 1 },
        "writer": { "name": "quickdeck", "version": "9.0.0" },
        "shape": "unknown to this build",
    })
    .to_string()
}

fn mem_db() -> Connection {
    let conn = Connection::open_in_memory().expect("open in-memory db");
    file_header::prepare_sqlite(
        &conn,
        SNAPSHOTS_DB_FILE_NAME,
        file_header::SNAPSHOTS,
        SCHEMA,
    )
    .expect("init schema");
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

    assert_eq!(
        delete_all_snapshots_with_connection(&conn).expect("delete all"),
        2
    );
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
    // id = <yyyymmdd-hhmmss-utc>-<pane_id>-<nanoid>.
    let (_, discriminator) = id.split_once("-utc-pane-a-").expect("stamp and pane");
    assert_eq!(
        discriminator.chars().count(),
        crate::nanoid::DEFAULT_LENGTH,
        "unexpected id: {id}"
    );
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
    assert!(
        created_at_utc.ends_with('Z'),
        "created_at_utc: {created_at_utc}"
    );
    assert_eq!(
        &created_at_utc[19..20],
        ".",
        "created_at_utc: {created_at_utc}"
    );
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
fn a_pane_returning_to_earlier_text_records_it_again() {
    let conn = mem_db();
    let results: Vec<_> = ["first", "second", "first", "first"]
        .into_iter()
        .map(|content| create_snapshot_with_connection(&conn, input("p1", content)).unwrap())
        .collect();
    assert!(results[0].inserted);
    assert!(results[1].inserted);
    assert!(results[2].inserted);
    assert_ne!(results[2].id, results[0].id);
    // Only the pane's latest snapshot is compared.
    assert!(!results[3].inserted);
    assert_eq!(results[3].id, results[2].id);
    assert_eq!(count_rows(&conn), 3);
}

#[test]
fn another_panes_copy_does_not_change_which_snapshot_is_latest() {
    let conn = mem_db();
    create_snapshot_with_connection(&conn, input("p1", "body")).unwrap();
    create_snapshot_with_connection(&conn, input("p2", "other")).unwrap();
    let again = create_snapshot_with_connection(&conn, input("p1", "body")).unwrap();
    assert!(!again.inserted);
    assert_eq!(count_rows(&conn), 2);
}

#[test]
fn the_latest_of_same_instant_snapshots_is_the_one_stored_last() {
    let conn = mem_db();
    let ts = "2026-01-01T00:00:01.000Z";
    insert_row(&conn, "z-older", "p1", ts, "older");
    insert_row(&conn, "a-newer", "p1", ts, "newer");
    let repeat = create_snapshot_with_connection(&conn, input("p1", "newer")).unwrap();
    assert!(!repeat.inserted);
    assert_eq!(repeat.id.as_deref(), Some("a-newer"));
    let back = create_snapshot_with_connection(&conn, input("p1", "older")).unwrap();
    assert!(back.inserted);
}

#[test]
fn dedup_uses_insertion_order_when_the_clock_moves_backward() {
    let conn = mem_db();
    insert_row(&conn, "first", "p1", "2026-01-01T12:00:00.000Z", "A");
    insert_row(&conn, "second", "p1", "2026-01-01T11:59:00.000Z", "B");
    let repeat = create_snapshot_with_connection(&conn, input("p1", "B")).unwrap();
    assert!(!repeat.inserted);
    assert_eq!(repeat.id.as_deref(), Some("second"));
    let back = create_snapshot_with_connection(&conn, input("p1", "A")).unwrap();
    assert!(back.inserted);
    assert_eq!(count_rows(&conn), 3);
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
    let results: Vec<_> = vec![
        input("p1", "x"),
        input("p1", "x"),
        input("p1", "y"),
        input("p1", "x"),
    ]
    .into_iter()
    .map(|s| create_snapshot_with_connection(&tx, s).unwrap())
    .collect();
    tx.commit().unwrap();
    assert!(results[0].inserted);
    assert!(!results[1].inserted);
    assert!(results[2].inserted);
    assert!(results[3].inserted);
    assert_eq!(count_rows(&conn), 3);
}

#[test]
fn concurrent_writes_of_the_same_copy_store_it_once_without_failing() {
    let dir = tempfile::tempdir().unwrap();
    let snapshots = std::sync::Arc::new(SnapshotConnection::default());
    assert_eq!(snapshots.open(dir.path()).unwrap(), None);
    let start = std::sync::Arc::new(std::sync::Barrier::new(8));
    let writers: Vec<_> = (0..8)
        .map(|_| {
            let snapshots = snapshots.clone();
            let start = start.clone();
            std::thread::spawn(move || {
                start.wait();
                snapshots.with(|conn| {
                    let transaction = begin_snapshot_write(conn)?;
                    let result =
                        create_snapshot_with_connection(&transaction, input("p1", "same"))?;
                    transaction.commit().map_err(to_string_error)?;
                    Ok(result)
                })
            })
        })
        .collect();
    let joined: Vec<_> = writers.into_iter().map(|writer| writer.join()).collect();
    let results: Vec<_> = joined
        .into_iter()
        .map(|result| result.unwrap().unwrap())
        .collect();
    assert_eq!(results.iter().filter(|result| result.inserted).count(), 1);
    assert!(results.iter().all(|result| result.id == results[0].id));
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
    insert_row(
        &conn,
        "id1",
        "p1",
        "2026-01-01T00:00:01.000Z",
        "hello world",
    );
    insert_row(
        &conn,
        "id2",
        "p2",
        "2026-01-01T00:00:02.000Z",
        "nothing in common",
    );

    for query in ["", "   ", "\t\n"] {
        let result = list_snapshots_with_connection(&conn, query, 25, 0).unwrap();
        let ids = result
            .rows
            .iter()
            .map(|row| row.id.as_str())
            .collect::<Vec<_>>();
        assert_eq!(ids, ["id2", "id1"], "query {query:?} should list every row");
        assert!(!result.has_more);
    }
}

#[test]
fn blank_query_paginates_like_a_search() {
    let conn = mem_db();
    for index in 1..=6 {
        insert_row(
            &conn,
            &format!("id{index}"),
            "p1",
            &format!("2026-01-01T00:00:0{index}.000Z"),
            &format!("row {index}"),
        );
    }

    let first = list_snapshots_with_connection(&conn, "", 5, 0).unwrap();
    assert_eq!(
        first
            .rows
            .iter()
            .map(|row| row.id.as_str())
            .collect::<Vec<_>>(),
        ["id6", "id5", "id4", "id3", "id2"]
    );
    assert!(first.has_more);

    let second = list_snapshots_with_connection(&conn, "", 5, 5).unwrap();
    assert_eq!(
        second
            .rows
            .iter()
            .map(|row| row.id.as_str())
            .collect::<Vec<_>>(),
        ["id1"]
    );
    assert!(!second.has_more);
}

// The modal resolves this id against the live panes to colour a row; a
// snapshot from a deleted pane simply finds no match.
#[test]
fn rows_carry_the_pane_they_came_from() {
    let conn = mem_db();
    insert_row(
        &conn,
        "id1",
        "pane-abc",
        "2026-01-01T00:00:01.000Z",
        "hello world",
    );

    let result = list_snapshots_with_connection(&conn, "", 25, 0).unwrap();
    assert_eq!(result.rows[0].pane_id, "pane-abc");
}

#[test]
fn search_is_case_insensitive() {
    let conn = mem_db();
    insert_row(
        &conn,
        "id1",
        "p1",
        "2026-01-01T00:00:01.000Z",
        "The Quick Brown Fox",
    );
    let result = list_snapshots_with_connection(&conn, "QUICK", 25, 0).unwrap();
    assert_eq!(result.rows.len(), 1);
    assert_eq!(result.rows[0].id, "id1");
}

#[test]
fn search_requires_all_terms() {
    let conn = mem_db();
    insert_row(
        &conn,
        "both",
        "p1",
        "2026-01-01T00:00:02.000Z",
        "alpha beta gamma",
    );
    insert_row(&conn, "one", "p1", "2026-01-01T00:00:01.000Z", "alpha only");

    let result = list_snapshots_with_connection(&conn, "alpha gamma", 25, 0).unwrap();
    assert_eq!(result.rows.len(), 1);
    assert_eq!(result.rows[0].id, "both");
}

#[test]
fn search_treats_like_wildcards_literally() {
    let conn = mem_db();
    insert_row(
        &conn,
        "pct",
        "p1",
        "2026-01-01T00:00:02.000Z",
        "50% off today",
    );
    insert_row(
        &conn,
        "plain",
        "p1",
        "2026-01-01T00:00:01.000Z",
        "500 dollars",
    );

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
    insert_row(
        &conn,
        "id-early",
        "p1",
        "2026-01-01T00:00:01.100Z",
        "note alpha",
    );
    insert_row(
        &conn,
        "id-late",
        "p1",
        "2026-01-01T00:00:01.900Z",
        "note beta",
    );

    let result = list_snapshots_with_connection(&conn, "note", 25, 0).unwrap();
    let ids: Vec<_> = result.rows.iter().map(|r| r.id.as_str()).collect();
    assert_eq!(ids, vec!["id-late", "id-early"]);
}

#[test]
fn search_paginates_with_has_more_flag() {
    let conn = mem_db();
    for i in 0..6 {
        insert_row(
            &conn,
            &format!("id{i}"),
            "p1",
            &format!("2026-01-01T00:00:0{}.000Z", i + 1),
            &format!("term here {i}"),
        );
    }

    let page = list_snapshots_with_connection(&conn, "term", 5, 0).unwrap();
    assert_eq!(page.rows.len(), 5);
    assert!(page.has_more);

    let rest = list_snapshots_with_connection(&conn, "term", 5, 5).unwrap();
    assert_eq!(rest.rows.len(), 1);
    assert!(!rest.has_more);
}

#[test]
fn search_pagination_is_stable_across_same_second_rows() {
    let conn = mem_db();
    // Eight snapshots sharing one created_at_utc.
    let ts = "2026-01-01T00:00:01.000Z";
    for i in 0..8 {
        insert_row(&conn, &format!("id{i}"), "p1", ts, &format!("term {i}"));
    }

    let page1 = list_snapshots_with_connection(&conn, "term", 5, 0).unwrap();
    let page2 = list_snapshots_with_connection(&conn, "term", 5, 5).unwrap();

    let mut paged: Vec<_> = page1
        .rows
        .iter()
        .chain(page2.rows.iter())
        .map(|r| r.id.clone())
        .collect();
    // Every row appears exactly once across the two pages — no repeats, no skips.
    assert_eq!(paged.len(), 8);
    paged.sort();
    paged.dedup();
    assert_eq!(
        paged,
        vec!["id0", "id1", "id2", "id3", "id4", "id5", "id6", "id7"]
    );
    // The id tiebreaker fixes the order to newest-id-first.
    let order: Vec<_> = page1
        .rows
        .iter()
        .chain(page2.rows.iter())
        .map(|r| r.id.as_str())
        .collect();
    assert_eq!(
        order,
        vec!["id7", "id6", "id5", "id4", "id3", "id2", "id1", "id0"]
    );
}

#[test]
fn a_page_size_outside_the_settings_range_is_refused_not_corrected() {
    let conn = mem_db();
    for limit in [0, 4, 201] {
        assert!(
            list_snapshots_with_connection(&conn, "", limit, 0).is_err(),
            "{limit}"
        );
    }
    for limit in [5, 200] {
        assert!(
            list_snapshots_with_connection(&conn, "", limit, 0).is_ok(),
            "{limit}"
        );
    }
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

    atomic_write_json(dir.path(), &path, &value, file_header::CONFIG).unwrap();
    assert_eq!(
        read_json_store(&path, file_header::CONFIG).unwrap(),
        JsonRead::Readable(fields(value))
    );

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

    atomic_write_json(dir.path(), &path, &value, file_header::CONFIG).unwrap();
    crate::backup_store::close_backup_store();

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
    assert_eq!(
        recorded, on_disk,
        "recorded blob must equal the file's bytes"
    );
    assert_eq!(
        recorded.last(),
        Some(&b'\n'),
        "the trailing newline must be recorded too"
    );

    crate::backup_store::close_backup_store();
}

fn backup_rows(data_dir: &Path, path: &Path) -> i64 {
    Connection::open(data_dir.join(crate::backup_store::BACKUPS_DB_FILE_NAME))
        .unwrap()
        .query_row(
            "SELECT count(*) FROM backups WHERE path = ?1",
            params![path.to_string_lossy()],
            |row| row.get(0),
        )
        .unwrap()
}

// Backdates a file so a test can tell a rewrite of the same bytes from no write.
fn backdate(path: &Path) -> std::time::SystemTime {
    let old = std::time::UNIX_EPOCH + std::time::Duration::from_secs(1_000_000_000);
    File::options()
        .write(true)
        .open(path)
        .unwrap()
        .set_modified(old)
        .unwrap();
    old
}

#[test]
#[serial(backup_store)]
fn a_write_that_changes_nothing_leaves_the_file_and_the_backups_alone() {
    crate::backup_store::close_backup_store();

    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join(PANES_FILE_NAME);
    let value = serde_json::json!({ "panes": [] });

    assert!(atomic_write_json(dir.path(), &path, &value, file_header::PANES).unwrap());
    let old = backdate(&path);
    assert!(!atomic_write_json(dir.path(), &path, &value, file_header::PANES).unwrap());
    crate::backup_store::close_backup_store();
    assert_eq!(fs::metadata(&path).unwrap().modified().unwrap(), old);
    assert_eq!(backup_rows(dir.path(), &path), 1);

    // A change in the same session replaces that session's row.
    let changed = serde_json::json!({ "panes": [{
        "id": "p1", "title": "", "content": "changed",
        "headerColor": "#ABCDEF", "backgroundColor": "#123456"
    }] });
    assert!(atomic_write_json(dir.path(), &path, &changed, file_header::PANES).unwrap());
    crate::backup_store::close_backup_store();
    assert_ne!(fs::metadata(&path).unwrap().modified().unwrap(), old);
    assert_eq!(
        read_json_store(&path, file_header::PANES).unwrap(),
        JsonRead::Readable(fields(changed))
    );
    assert_eq!(backup_rows(dir.path(), &path), 1);
    assert_eq!(latest_backup(dir.path(), &path), fs::read(&path).unwrap());
}

fn latest_backup(data_dir: &Path, path: &Path) -> Vec<u8> {
    Connection::open(data_dir.join(crate::backup_store::BACKUPS_DB_FILE_NAME))
        .unwrap()
        .query_row(
            "SELECT content FROM backups WHERE path = ?1 ORDER BY id DESC LIMIT 1",
            params![path.to_string_lossy()],
            |row| row.get(0),
        )
        .unwrap()
}

#[test]
#[serial(backup_store)]
fn saves_report_whether_they_wrote() {
    crate::backup_store::close_backup_store();
    let dir = tempfile::tempdir().unwrap();
    let panes = serde_json::json!({ "panes": [] });
    assert!(save_panes_in(dir.path(), &panes).unwrap());
    assert!(!save_panes_in(dir.path(), &panes).unwrap());
    let state = serde_json::json!({ "activePaneId": "p1" });
    assert!(save_state_in(dir.path(), state.clone()).unwrap());
    assert!(!save_state_in(dir.path(), state).unwrap());
    crate::backup_store::close_backup_store();
}

#[test]
#[serial(backup_store)]
fn a_panes_save_is_recorded_and_a_state_save_is_not() {
    crate::backup_store::close_backup_store();
    let dir = tempfile::tempdir().unwrap();
    save_panes_in(dir.path(), &serde_json::json!({ "panes": [] })).unwrap();
    save_state_in(dir.path(), serde_json::json!({ "activePaneId": "p1" })).unwrap();
    crate::backup_store::close_backup_store();
    let panes = dir.path().join(PANES_FILE_NAME);
    assert_eq!(latest_backup(dir.path(), &panes), fs::read(&panes).unwrap());
    assert_eq!(
        backup_rows(dir.path(), &dir.path().join(STATE_FILE_NAME)),
        0
    );
}

#[test]
fn private_staging_refuses_an_existing_path_without_changing_its_bytes() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("existing.tmp");
    fs::write(&path, "another writer").unwrap();
    assert_eq!(
        create_private_stage(&path).unwrap_err().kind(),
        std::io::ErrorKind::AlreadyExists
    );
    assert_eq!(fs::read_to_string(&path).unwrap(), "another writer");
}

#[cfg(unix)]
#[test]
fn private_staging_has_restrictive_access_before_any_bytes_are_written() {
    use std::os::unix::fs::PermissionsExt;
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("new.tmp");
    let file = create_private_stage(&path).unwrap();
    assert_eq!(file.metadata().unwrap().len(), 0);
    assert_eq!(file.metadata().unwrap().permissions().mode() & 0o777, 0o600);
}

#[cfg(target_os = "macos")]
#[test]
fn a_changed_save_keeps_the_mode_with_a_fresh_modified_time() {
    use std::os::unix::fs::PermissionsExt;

    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join(STATE_FILE_NAME);
    atomic_write_json_unrecorded(
        &path,
        &serde_json::json!({ "zoomLevel": 1.0 }),
        file_header::STATE,
    )
    .unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o640)).unwrap();
    let old = backdate(&path);

    atomic_write_json_unrecorded(
        &path,
        &serde_json::json!({ "zoomLevel": 1.2 }),
        file_header::STATE,
    )
    .unwrap();

    let metadata = fs::metadata(&path).unwrap();
    assert_eq!(metadata.permissions().mode() & 0o777, 0o640);
    assert_ne!(metadata.modified().unwrap(), old);
}

#[test]
fn a_state_save_that_changes_nothing_leaves_the_file_alone() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join(STATE_FILE_NAME);
    let state = serde_json::json!({ "activePaneId": "p1", "zoomLevel": 1.1 });
    save_state_in(dir.path(), state.clone()).unwrap();
    let old = backdate(&path);

    save_state_in(dir.path(), state).unwrap();
    assert_eq!(fs::metadata(&path).unwrap().modified().unwrap(), old);
}

#[test]
#[serial(backup_store)]
fn unrecorded_write_lands_on_disk_but_not_in_the_backup_store() {
    crate::backup_store::close_backup_store();

    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("state.json");
    let value = serde_json::json!({ "activePaneId": "p1" });

    atomic_write_json_unrecorded(&path, &value, file_header::STATE).unwrap();

    assert_eq!(
        read_json_store(&path, file_header::STATE).unwrap(),
        JsonRead::Readable(fields(value))
    );
    assert!(
        !dir.path()
            .join(crate::backup_store::BACKUPS_DB_FILE_NAME)
            .exists(),
        "an unrecorded write must not touch the backup store"
    );

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

    let result = atomic_write_json(
        dir.path(),
        &path,
        &serde_json::json!({ "a": 1 }),
        file_header::CONFIG,
    );
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

// On Windows a file held open without delete-sharing cannot be replaced: the
// save fails, the file keeps its bytes and the temp is removed.
#[cfg(windows)]
#[test]
#[serial(backup_store)]
fn a_target_held_open_without_delete_sharing_fails_cleanly() {
    use std::os::windows::fs::OpenOptionsExt;
    const FILE_SHARE_READ: u32 = 0x1;
    const FILE_SHARE_WRITE: u32 = 0x2;

    crate::backup_store::close_backup_store();
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join(CONFIG_FILE_NAME);
    atomic_write_json(
        dir.path(),
        &path,
        &serde_json::json!({ "a": 1 }),
        file_header::CONFIG,
    )
    .unwrap();
    let before = fs::read(&path).unwrap();

    let held = File::options()
        .read(true)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
        .open(&path)
        .unwrap();
    let result = atomic_write_json(
        dir.path(),
        &path,
        &serde_json::json!({ "a": 2 }),
        file_header::CONFIG,
    );
    drop(held);

    assert!(
        result.is_err(),
        "the replace should fail while the file is held"
    );
    assert_eq!(fs::read(&path).unwrap(), before);
    let temps: Vec<_> = fs::read_dir(dir.path())
        .unwrap()
        .flatten()
        .filter(|entry| entry.file_name().to_string_lossy().ends_with(".tmp"))
        .collect();
    assert!(temps.is_empty(), "temp files left: {temps:?}");
    // Releasing the external handle permits an ordinary retry; a failed
    // publication must not poison ownership or require restarting the app.
    atomic_write_json(
        dir.path(),
        &path,
        &serde_json::json!({ "a": 2 }),
        file_header::CONFIG,
    )
    .unwrap();
    assert_eq!(on_disk(&path)["a"], 2);
    crate::backup_store::close_backup_store();
}

// Off Windows the test above is listed as ignored rather than left out; run
// explicitly, it fails.
#[cfg(not(windows))]
#[test]
#[ignore = "Windows only: needs Windows file sharing modes"]
fn a_target_held_open_without_delete_sharing_fails_cleanly() {
    panic!("runs only on Windows");
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
    assert!(
        tmp_name.starts_with("config-"),
        "unexpected tmp name: {tmp_name}"
    );
    assert!(
        tmp_name.ends_with(".tmp"),
        "unexpected tmp name: {tmp_name}"
    );
    assert!(
        !tmp_name.contains("config.json"),
        "old shape leaked in: {tmp_name}"
    );
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
#[serial(backup_store)]
fn a_write_leaves_another_writers_in_flight_temp_alone() {
    crate::backup_store::close_backup_store();

    // A second instance mid-write has a temp beside the same target. Nothing
    // here may remove it: a write and a failed write clean up only their own.
    let dir = tempfile::tempdir().unwrap();
    let other = dir.path().join("config-otherwriter.tmp");
    fs::write(&other, b"in flight").unwrap();

    atomic_write_json(
        dir.path(),
        &dir.path().join("config.json"),
        &serde_json::json!({ "a": 1 }),
        file_header::CONFIG,
    )
    .unwrap();
    let failing = dir.path().join("state.json");
    fs::create_dir(&failing).unwrap();
    assert!(atomic_write_json(
        dir.path(),
        &failing,
        &serde_json::json!({ "a": 1 }),
        file_header::STATE
    )
    .is_err());

    assert_eq!(fs::read(&other).unwrap(), b"in flight");
    let temps: Vec<_> = fs::read_dir(dir.path())
        .unwrap()
        .flatten()
        .filter(|e| e.file_name().to_string_lossy().ends_with(".tmp"))
        .collect();
    assert_eq!(
        temps.len(),
        1,
        "only the other writer's temp remains: {temps:?}"
    );

    crate::backup_store::close_backup_store();
}

// A SQLite store of `kind`'s owner, recorded in a newer version.
fn newer_database(path: &Path, kind: &str) {
    Connection::open(path)
        .unwrap()
        .execute_batch(&format!(
            "create table file_header (key text primary key, value text not null);
             insert into file_header values ('format.owner', 'quickdeck'), ('format.kind', '{kind}');
             pragma user_version = 2;"
        ))
        .unwrap();
}

// Every file in `dir` with its bytes, to show a refusal changed nothing.
fn folder(dir: &Path) -> Vec<(String, Vec<u8>)> {
    let mut files: Vec<_> = fs::read_dir(dir)
        .unwrap()
        .map(|entry| {
            let path = entry.unwrap().path();
            let name = path.file_name().unwrap().to_string_lossy().into_owned();
            (name, fs::read(&path).unwrap_or_default())
        })
        .collect();
    files.sort();
    files
}

fn refused_names(files: &[RefusedFile]) -> Vec<(String, Option<u32>)> {
    let mut names: Vec<_> = files
        .iter()
        .map(|file| {
            let name = Path::new(&file.path)
                .file_name()
                .unwrap()
                .to_string_lossy()
                .into_owned();
            (name, file.newer)
        })
        .collect();
    names.sort();
    names
}

#[test]
#[serial(backup_store)]
fn a_launch_stops_on_every_newer_file_names_each_and_changes_nothing_after() {
    crate::backup_store::close_backup_store();
    let dir = tempfile::tempdir().unwrap();
    for (name, format) in [
        (CONFIG_FILE_NAME, file_header::CONFIG),
        (STATE_FILE_NAME, file_header::STATE),
        (WINDOW_FILE_NAME, file_header::WINDOW),
        (PANES_FILE_NAME, file_header::PANES),
    ] {
        fs::write(dir.path().join(name), newer(format)).unwrap();
    }
    newer_database(&dir.path().join(SNAPSHOTS_DB_FILE_NAME), "snapshots");
    newer_database(
        &dir.path().join(crate::backup_store::BACKUPS_DB_FILE_NAME),
        "backups",
    );
    let before = folder(dir.path());

    let records = file_header::Refusal::newer(RECORDS_DB_FILE_NAME, 2);
    let loaded =
        load_app_data_in(dir.path(), &SnapshotConnection::default(), Some(records)).unwrap();
    assert_eq!(
        refused_names(&loaded.refused),
        [
            ("backups.sqlite3".to_string(), Some(2)),
            ("config.json".to_string(), Some(2)),
            ("panes.json".to_string(), Some(2)),
            ("records.sqlite3".to_string(), Some(2)),
            ("snapshots.sqlite3".to_string(), Some(2)),
            ("state.json".to_string(), Some(2)),
            ("window.json".to_string(), Some(2)),
        ]
    );
    assert!(loaded.off.is_empty());
    assert_eq!(
        (loaded.config, loaded.state, loaded.panes),
        (None, None, None)
    );

    // A session of saves after the stop writes nothing.
    assert!(save_config(dir.path(), serde_json::json!({ "zen": true })).is_err());
    assert!(save_state_in(dir.path(), serde_json::json!({ "activePaneId": "p" })).is_err());
    assert!(save_window_state(dir.path(), serde_json::json!({ "main": {} })).is_err());
    assert!(save_panes_in(dir.path(), &authored_panes()).is_err());
    crate::backup_store::close_backup_store();
    assert_eq!(folder(dir.path()), before);
}

#[test]
#[serial(backup_store)]
fn unreadable_settings_panes_or_snapshots_stop_the_launch_and_stay_untouched() {
    crate::backup_store::close_backup_store();
    for bytes in ["{broken", "null", "[]", "42", r#"{"zen":true}"#] {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join(CONFIG_FILE_NAME), bytes).unwrap();
        fs::write(dir.path().join(PANES_FILE_NAME), bytes).unwrap();
        fs::write(dir.path().join(SNAPSHOTS_DB_FILE_NAME), bytes).unwrap();
        let before = folder(dir.path());

        let loaded = load_app_data_in(dir.path(), &SnapshotConnection::default(), None).unwrap();
        assert_eq!(
            refused_names(&loaded.refused),
            [
                ("config.json".to_string(), None),
                ("panes.json".to_string(), None),
                ("snapshots.sqlite3".to_string(), None),
            ],
            "{bytes}"
        );
        assert!(save_config(dir.path(), serde_json::json!({ "zen": true })).is_err());
        assert!(save_panes_in(dir.path(), &authored_panes()).is_err());
        assert_eq!(folder(dir.path()), before, "{bytes}");
    }
    crate::backup_store::close_backup_store();
}

#[test]
#[serial(backup_store)]
fn a_newer_config_alone_stops_the_launch_and_keeps_the_saved_language_readable() {
    crate::backup_store::close_backup_store();
    let dir = tempfile::tempdir().unwrap();
    fs::write(
        dir.path().join(CONFIG_FILE_NAME),
        stored(file_header::CONFIG, serde_json::json!({ "language": "de" })),
    )
    .unwrap();
    fs::write(dir.path().join(STATE_FILE_NAME), newer(file_header::STATE)).unwrap();

    let loaded = load_app_data_in(dir.path(), &SnapshotConnection::default(), None).unwrap();
    assert_eq!(
        refused_names(&loaded.refused),
        [("state.json".to_string(), Some(2))]
    );
    assert_eq!(loaded.config, Some(serde_json::json!({ "language": "de" })));
    assert!(
        !dir.path().join(SNAPSHOTS_DB_FILE_NAME).exists(),
        "a stopped launch opens no store"
    );
    crate::backup_store::close_backup_store();
}

#[test]
#[serial(backup_store)]
fn unreadable_view_state_takes_defaults_and_the_next_save_replaces_it() {
    crate::backup_store::close_backup_store();
    let dir = tempfile::tempdir().unwrap();
    let state = dir.path().join(STATE_FILE_NAME);
    let window = dir.path().join(WINDOW_FILE_NAME);
    fs::write(&state, [0xff, 0xfe, 0x00, 0x01]).unwrap();
    fs::write(&window, r#"{"main":{}}"#).unwrap();

    let loaded = load_app_data_in(dir.path(), &SnapshotConnection::default(), None).unwrap();
    assert!(loaded.refused.is_empty() && loaded.off.is_empty());
    assert_eq!(loaded.state, None);
    assert_eq!(load_window_state_in(dir.path()).unwrap(), None);
    assert!(
        fs::read_dir(dir.path()).unwrap().all(|entry| !entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .ends_with(".invalid")),
        "nothing is set aside"
    );

    save_state_in(dir.path(), serde_json::json!({ "activePaneId": "p" })).unwrap();
    save_window_state(dir.path(), serde_json::json!({ "main": {} })).unwrap();
    assert_eq!(on_disk(&state)["activePaneId"], "p");
    assert_eq!(on_disk(&window)["main"], serde_json::json!({}));
    crate::backup_store::close_backup_store();
}

#[test]
#[serial(backup_store)]
fn an_unreadable_records_or_backup_database_is_switched_off_and_left_untouched() {
    crate::backup_store::close_backup_store();
    let dir = tempfile::tempdir().unwrap();
    let backups = dir.path().join(crate::backup_store::BACKUPS_DB_FILE_NAME);
    fs::write(&backups, b"not a database at all, just text").unwrap();
    let before = fs::read(&backups).unwrap();

    let records = file_header::Refusal::unreadable("records.sqlite3 has no file header");
    let loaded =
        load_app_data_in(dir.path(), &SnapshotConnection::default(), Some(records)).unwrap();
    assert!(loaded.refused.is_empty());
    assert_eq!(
        refused_names(&loaded.off),
        [
            ("backups.sqlite3".to_string(), None),
            ("records.sqlite3".to_string(), None),
        ]
    );

    // The app runs: its saves land, and the backup history stays untouched.
    save_config(dir.path(), serde_json::json!({ "zen": true })).unwrap();
    crate::backup_store::close_backup_store();
    assert_eq!(fs::read(&backups).unwrap(), before);
}

#[test]
fn corrupt_panes_store_halts_and_is_left_in_place() {
    // panes.json carries the user's text: the load reports it unreadable and the
    // file is left exactly where it is (storage-path conventions).
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("panes.json");
    fs::write(&path, b"{ corrupt bytes").unwrap();

    assert!(matches!(
        read_json_store(&path, file_header::PANES).unwrap(),
        JsonRead::Corrupt(_)
    ));
    assert_eq!(fs::read(&path).unwrap(), b"{ corrupt bytes");
}

fn pane_shape_failures() -> Vec<JsonValue> {
    let pane = serde_json::json!({
        "id": "p", "title": "Title", "content": "authored",
        "headerColor": "#ABCDEF", "backgroundColor": "#123456"
    });
    let mut failures = vec![
        serde_json::json!({}),
        serde_json::json!({ "panes": {} }),
        serde_json::json!({ "panes": [pane.clone(), pane.clone()] }),
    ];
    for key in ["id", "title", "content", "headerColor", "backgroundColor"] {
        let mut incomplete = pane.clone();
        incomplete.as_object_mut().unwrap().remove(key);
        failures.push(serde_json::json!({ "panes": [incomplete] }));
    }
    failures
}

#[test]
fn loading_panes_rejects_invalid_current_shapes_without_changing_bytes() {
    for value in pane_shape_failures() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(PANES_FILE_NAME);
        let bytes =
            serde_json::to_vec(&file_header::stamp_json(&value, file_header::PANES).unwrap())
                .unwrap();
        fs::write(&path, &bytes).unwrap();
        let loaded = load_app_data_in(dir.path(), &SnapshotConnection::default(), None).unwrap();
        assert!(loaded.panes.is_none(), "{value}");
        assert_eq!(
            refused_names(&loaded.refused),
            [("panes.json".to_string(), None)],
            "{value}"
        );
        assert_eq!(fs::read(&path).unwrap(), bytes);
    }
}

#[test]
#[serial(backup_store)]
fn pane_save_refuses_corrupt_or_invalid_destination_before_publication() {
    crate::backup_store::close_backup_store();
    let mut corrupt = vec![b"{broken".to_vec()];
    corrupt.extend(pane_shape_failures().into_iter().map(|value| {
        serde_json::to_vec(&file_header::stamp_json(&value, file_header::PANES).unwrap()).unwrap()
    }));
    for bytes in corrupt {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(PANES_FILE_NAME);
        fs::write(&path, &bytes).unwrap();
        let error = save_panes_in(dir.path(), &serde_json::json!({ "panes": [] })).unwrap_err();
        assert_eq!(error.path.as_deref(), path.to_str());
        assert_eq!(error.newer, None);
        assert_eq!(fs::read(&path).unwrap(), bytes);
        assert_eq!(
            fs::read_dir(dir.path()).unwrap().count(),
            1,
            "refusal creates no backup or temp"
        );
    }
    crate::backup_store::close_backup_store();
}

#[test]
#[serial(backup_store)]
fn pane_save_rejects_invalid_incoming_shapes_without_touching_valid_content() {
    crate::backup_store::close_backup_store();
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join(PANES_FILE_NAME);
    let bytes = stored(file_header::PANES, authored_panes());
    fs::write(&path, &bytes).unwrap();
    for value in pane_shape_failures() {
        let error = save_panes_in(dir.path(), &value).unwrap_err();
        assert_eq!(error.path.as_deref(), path.to_str());
        assert_eq!(error.newer, None);
        assert_eq!(fs::read_to_string(&path).unwrap(), bytes);
    }
    assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    crate::backup_store::close_backup_store();
}

#[test]
fn read_missing_file_is_absent() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("does-not-exist.json");
    assert_eq!(
        read_json_store(&path, file_header::PANES).unwrap(),
        JsonRead::Absent
    );
}

// One valid pane holding authored text.
fn authored_panes() -> JsonValue {
    serde_json::json!({"panes": [{"id": "p", "title": "", "content": "authored",
        "headerColor": "#ABCDEF", "backgroundColor": "#123456"}]})
}

// The file's JSON exactly as stored, header included.
fn on_disk(path: &Path) -> JsonValue {
    serde_json::from_slice(&fs::read(path).unwrap()).unwrap()
}

#[test]
fn every_json_store_writes_its_file_header_as_its_first_key() {
    let dir = tempfile::tempdir().unwrap();
    save_state_in(dir.path(), serde_json::json!({ "activePaneId": "p1" })).unwrap();
    save_window_state(dir.path(), serde_json::json!({ "main": {} })).unwrap();
    for (name, format) in [
        (STATE_FILE_NAME, file_header::STATE),
        (WINDOW_FILE_NAME, file_header::WINDOW),
    ] {
        let text = fs::read_to_string(dir.path().join(name)).unwrap();
        let header = format!(
            "{{\n  \"format\": {{\n    \"owner\": \"quickdeck\",\n    \"kind\": \"{}\",\n    \"version\": 1\n  }},\n  \"writer\": {{\n    \"name\": \"quickdeck\",\n    \"version\": \"{}\"\n  }},\n",
            format.kind,
            env!("CARGO_PKG_VERSION")
        );
        assert!(text.starts_with(&header), "{name}: {text}");
    }
}

#[test]
#[serial(backup_store)]
fn recorded_json_stores_write_their_file_header_too() {
    crate::backup_store::close_backup_store();
    let dir = tempfile::tempdir().unwrap();
    save_config(dir.path(), serde_json::json!({ "zen": true })).unwrap();
    let panes = dir.path().join(PANES_FILE_NAME);
    atomic_write_json(
        dir.path(),
        &panes,
        &serde_json::json!({ "panes": [] }),
        file_header::PANES,
    )
    .unwrap();
    assert_eq!(
        on_disk(&dir.path().join(CONFIG_FILE_NAME))["format"],
        serde_json::json!({"owner": "quickdeck", "kind": "config", "version": 1})
    );
    assert_eq!(
        on_disk(&panes)["format"],
        serde_json::json!({"owner": "quickdeck", "kind": "panes", "version": 1})
    );
    crate::backup_store::close_backup_store();
}

#[test]
fn a_json_store_without_its_header_is_unreadable() {
    let dir = tempfile::tempdir().unwrap();
    let panes = dir.path().join(PANES_FILE_NAME);
    fs::write(&panes, br#"{"panes":[]}"#).unwrap();
    assert!(matches!(
        read_json_store(&panes, file_header::PANES).unwrap(),
        JsonRead::Corrupt(_)
    ));
    assert_eq!(fs::read(&panes).unwrap(), br#"{"panes":[]}"#);
}

#[test]
fn a_bad_or_foreign_header_is_corrupt() {
    for format in [
        r#"{"owner":"quickdeck","kind":"state","version":"1"}"#,
        r#"{"owner":"quickdeck","kind":"state","version":0}"#,
        r#"{"owner":"quickdeck","kind":"state","version":-1}"#,
        r#"{"owner":"quickdeck","kind":"state","version":1.5}"#,
        r#"{"owner":"quickdeck","kind":"state"}"#,
        r#"{"owner":"dropkick","kind":"state","version":1}"#,
        r#"{"owner":"quickdeck","kind":"config","version":1}"#,
        r#"{"kind":"state","version":1}"#,
        r#"1"#,
        r#"null"#,
    ] {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(STATE_FILE_NAME);
        let bytes = format!(r#"{{"format":{format},"zoomLevel":1}}"#);
        fs::write(&path, &bytes).unwrap();
        assert!(matches!(
            read_json_store(&path, file_header::STATE).unwrap(),
            JsonRead::Corrupt(_)
        ));
    }
}

#[test]
fn a_newer_panes_store_reads_as_newer() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join(PANES_FILE_NAME);
    fs::write(&path, newer(file_header::PANES)).unwrap();
    assert_eq!(
        read_json_store(&path, file_header::PANES).unwrap(),
        JsonRead::Newer(2)
    );
}

#[test]
#[serial(backup_store)]
fn no_write_replaces_a_json_store_in_a_newer_format() {
    crate::backup_store::close_backup_store();
    let dir = tempfile::tempdir().unwrap();
    let stores = [
        (CONFIG_FILE_NAME, file_header::CONFIG),
        (STATE_FILE_NAME, file_header::STATE),
        (WINDOW_FILE_NAME, file_header::WINDOW),
        (PANES_FILE_NAME, file_header::PANES),
    ];
    for (name, format) in stores {
        fs::write(dir.path().join(name), newer(format)).unwrap();
    }

    for (name, old) in stores.map(|(name, _)| (name, backdate(&dir.path().join(name)))) {
        let path = dir.path().join(name);
        let refused = match name {
            CONFIG_FILE_NAME => save_config(dir.path(), serde_json::json!({ "zen": true })),
            STATE_FILE_NAME => {
                save_state_in(dir.path(), serde_json::json!({ "activePaneId": "p1" })).map(|_| ())
            }
            WINDOW_FILE_NAME => save_window_state(dir.path(), serde_json::json!({ "main": {} })),
            _ => atomic_write_json(
                dir.path(),
                &path,
                &serde_json::json!({ "panes": [] }),
                file_header::PANES,
            )
            .map(|_| ()),
        }
        .unwrap_err();
        assert!(refused.contains("newer"), "{name}: {refused}");
        assert_eq!(
            fs::metadata(&path).unwrap().modified().unwrap(),
            old,
            "{name}"
        );
    }

    for (name, format) in stores {
        assert_eq!(
            fs::read_to_string(dir.path().join(name)).unwrap(),
            newer(format),
            "{name}"
        );
    }
    assert!(
        !dir.path()
            .join(crate::backup_store::BACKUPS_DB_FILE_NAME)
            .exists(),
        "a refused write records nothing"
    );
    assert_eq!(records_list_width_in(dir.path()).unwrap(), None);
    crate::backup_store::close_backup_store();
}

#[test]
#[serial(backup_store)]
fn panes_save_distinguishes_newer_refusal_from_an_exact_noop() {
    crate::backup_store::close_backup_store();
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join(PANES_FILE_NAME);
    fs::write(&path, newer(file_header::PANES)).unwrap();
    let error = save_panes_in(dir.path(), &serde_json::json!({ "panes": [] })).unwrap_err();
    assert_eq!(error.path.as_deref(), path.to_str());
    assert_eq!(error.newer, Some(2));
    assert_eq!(
        fs::read_to_string(&path).unwrap(),
        newer(file_header::PANES)
    );
    assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    let current = serde_json::json!({ "panes": [] });
    let mut written =
        serde_json::to_string_pretty(&stamped(file_header::PANES, current.clone())).unwrap();
    written.push('\n');
    fs::write(&path, written).unwrap();
    save_panes_in(dir.path(), &current).unwrap();
    assert_eq!(
        fs::read_dir(dir.path()).unwrap().count(),
        1,
        "no-op creates no backup or temp"
    );
    crate::backup_store::close_backup_store();
}

#[test]
fn launch_reads_of_config_skip_a_newer_headerless_foreign_or_corrupt_file() {
    assert_eq!(
        launch_config(&stored(
            file_header::CONFIG,
            serde_json::json!({ "theme": "dark" })
        )),
        Some(serde_json::json!({ "theme": "dark" }))
    );
    assert_eq!(launch_config(r#"{"theme":"dark"}"#), None);
    assert_eq!(launch_config(&newer(file_header::CONFIG)), None);
    assert_eq!(
        launch_config(&stored(
            file_header::STATE,
            serde_json::json!({ "theme": "dark" })
        )),
        None
    );
    assert_eq!(launch_config(r#"{"format":"x","theme":"dark"}"#), None);
    assert_eq!(launch_config("{ not json"), None);
}

#[test]
fn concurrent_loads_open_a_new_snapshot_store_once() {
    // React's development StrictMode sends load_app_data twice together.
    let dir = tempfile::tempdir().unwrap();
    let snapshots = std::sync::Arc::new(SnapshotConnection::default());
    let start = std::sync::Arc::new(std::sync::Barrier::new(4));
    let loads: Vec<_> = (0..4)
        .map(|_| {
            let (snapshots, start, root) =
                (snapshots.clone(), start.clone(), dir.path().to_path_buf());
            std::thread::spawn(move || {
                start.wait();
                snapshots.open(&root)
            })
        })
        .collect();
    for load in loads {
        assert_eq!(load.join().unwrap().unwrap(), None);
    }
    let count = snapshots.with(|conn| Ok(count_rows(conn))).unwrap();
    assert_eq!(count, 0);
}

#[test]
fn snapshot_commands_before_the_load_are_refused() {
    let refused = SnapshotConnection::default().with(|_| Ok(())).unwrap_err();
    assert!(refused.contains(SNAPSHOTS_DB_FILE_NAME), "{refused}");
}

fn snapshot_user_version(path: &Path) -> i64 {
    Connection::open(path)
        .unwrap()
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .unwrap()
}

#[test]
fn a_new_snapshot_store_records_its_file_header() {
    let dir = tempfile::tempdir().unwrap();
    assert!(matches!(
        open_snapshot_store(dir.path()).unwrap(),
        SnapshotStore::Ready(_)
    ));
    assert_eq!(
        snapshot_user_version(&dir.path().join(SNAPSHOTS_DB_FILE_NAME)),
        i64::from(file_header::SNAPSHOTS.version)
    );
}

#[test]
fn a_newer_snapshot_store_is_left_untouched_and_refused() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join(SNAPSHOTS_DB_FILE_NAME);
    {
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(
            "create table future (x);
             create table file_header (key text primary key, value text not null);
             insert into file_header values ('format.owner', 'quickdeck'), ('format.kind', 'snapshots');
             pragma user_version = 2;",
        )
        .unwrap();
    }
    let before = fs::read(&path).unwrap();

    assert!(matches!(
        open_snapshot_store(dir.path()).unwrap(),
        SnapshotStore::Newer(2)
    ));
    let snapshots = SnapshotConnection::default();
    assert_eq!(snapshots.open(dir.path()).unwrap(), Some(2));
    let refused = snapshots.with(|_| Ok(())).unwrap_err();
    assert!(refused.contains(SNAPSHOTS_DB_FILE_NAME), "{refused}");
    assert_eq!(fs::read(&path).unwrap(), before);
    let tables: i64 = Connection::open(&path)
        .unwrap()
        .query_row(
            "select count(*) from sqlite_master where name = 'snapshots'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(tables, 0, "no schema was written into it");
}

#[test]
fn a_snapshot_store_without_its_header_is_unreadable_and_left_untouched() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join(SNAPSHOTS_DB_FILE_NAME);
    Connection::open(&path)
        .unwrap()
        .execute_batch("create table snapshots (id text primary key);")
        .unwrap();
    let before = fs::read(&path).unwrap();

    let refused = open_snapshot_store(dir.path()).err().unwrap();
    assert!(refused.contains(SNAPSHOTS_DB_FILE_NAME), "{refused}");
    assert_eq!(fs::read(&path).unwrap(), before);
    assert_eq!(snapshot_user_version(&path), 0);
}

fn count_rows(conn: &Connection) -> i64 {
    conn.query_row("select count(*) from snapshots", [], |row| row.get(0))
        .unwrap()
}

fn save_config(data_dir: &Path, sets: JsonValue) -> Result<(), String> {
    if let Some(config) = config_to_write(data_dir, sets)?.content {
        write_config(data_dir, &config)?;
    }
    Ok(())
}

#[test]
#[serial(backup_store)]
fn a_config_write_stores_the_given_known_sets_and_keeps_unknown_keys() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join(CONFIG_FILE_NAME);
    save_config(root.path(), serde_json::json!({"zen": true})).unwrap();
    assert_eq!(
        on_disk(&path),
        stamped(file_header::CONFIG, serde_json::json!({"zen": true}))
    );
    fs::write(
        &path,
        stored(
            file_header::CONFIG,
            serde_json::json!({"zen": true, "version": 1, "dark": true}),
        ),
    )
    .unwrap();
    save_config(
        root.path(),
        serde_json::json!({"topmost": true, "retired": 1}),
    )
    .unwrap();
    assert_eq!(
        on_disk(&path),
        stamped(
            file_header::CONFIG,
            serde_json::json!({"topmost": true, "version": 1, "dark": true})
        )
    );
    crate::backup_store::close_backup_store();
}

#[test]
#[serial(backup_store)]
fn a_config_write_keeps_an_unchanged_set_it_cannot_accept() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join(CONFIG_FILE_NAME);
    fs::write(
        &path,
        stored(
            file_header::CONFIG,
            serde_json::json!({"snapshotPageSize": 999, "theme": 7}),
        ),
    )
    .unwrap();
    // The frontend sends back each set it could not read, as it was.
    save_config(
        root.path(),
        serde_json::json!({"snapshotPageSize": 999, "theme": 7, "zen": true}),
    )
    .unwrap();
    assert_eq!(
        on_disk(&path),
        stamped(
            file_header::CONFIG,
            serde_json::json!({"snapshotPageSize": 999, "theme": 7, "zen": true})
        )
    );
    // A changed value is still checked.
    assert!(save_config(root.path(), serde_json::json!({"snapshotPageSize": 998})).is_err());
    crate::backup_store::close_backup_store();
}

#[test]
fn a_config_write_with_a_number_setting_outside_its_accepted_values_is_refused() {
    let root = tempfile::tempdir().unwrap();
    let font = |size: JsonValue, line_height: JsonValue, padding: JsonValue| {
        serde_json::json!({"editorFont": {"family": "", "size": size, "lineHeight": line_height,
            "padding": padding, "bold": false, "italic": false, "underline": false}})
    };
    for sets in [
        font(9.into(), 1.5.into(), 15.into()),
        font(16.5.into(), 1.5.into(), 15.into()),
        font(16.into(), 3.01.into(), 15.into()),
        font(16.into(), 1.5.into(), 65.into()),
        font(16.into(), 1.5.into(), JsonValue::Null),
        serde_json::json!({"editorFont": {"size": 16}}),
        serde_json::json!({"autosaveDelaySeconds": 0}),
        serde_json::json!({"autosaveDelaySeconds": 1.5}),
        serde_json::json!({"snapshotPageSize": 201}),
        serde_json::json!({"snapshotPageSize": "20"}),
    ] {
        assert!(
            config_to_write(root.path(), sets.clone()).is_err(),
            "{sets}"
        );
    }
    assert!(!root.path().join(CONFIG_FILE_NAME).exists());
    for sets in [
        font(10.into(), 1.37.into(), 0.into()),
        font(32.into(), 3.into(), 64.into()),
        serde_json::json!({"autosaveDelaySeconds": 60, "snapshotPageSize": 5}),
    ] {
        assert!(config_to_write(root.path(), sets.clone()).is_ok(), "{sets}");
    }
}

#[test]
#[serial(backup_store)]
fn a_config_write_without_sets_and_without_a_file_writes_nothing() {
    let root = tempfile::tempdir().unwrap();
    save_config(root.path(), serde_json::json!({})).unwrap();
    assert!(!root.path().join(CONFIG_FILE_NAME).exists());
    crate::backup_store::close_backup_store();
}

#[test]
#[serial(backup_store)]
fn a_config_write_equal_to_the_file_leaves_its_bytes_alone() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join(CONFIG_FILE_NAME);
    let bytes = "{ \"writer\": {\"name\": \"quickdeck\", \"version\": \"0.9.0\"}, \"topmost\": true,\n\"format\": {\"owner\": \"quickdeck\", \"kind\": \"config\", \"version\": 1}, \"zen\": true }";
    fs::write(&path, bytes).unwrap();
    assert_eq!(
        config_to_write(
            root.path(),
            serde_json::json!({"zen": true, "topmost": true})
        )
        .unwrap(),
        ConfigToWrite { content: None }
    );
    assert_eq!(fs::read_to_string(&path).unwrap(), bytes);
    crate::backup_store::close_backup_store();
}

#[test]
#[serial(backup_store)]
fn a_config_whose_sets_are_all_back_at_their_built_ins_keeps_only_its_header() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join(CONFIG_FILE_NAME);
    save_config(root.path(), serde_json::json!({"zen": true})).unwrap();
    save_config(root.path(), serde_json::json!({})).unwrap();
    assert_eq!(
        on_disk(&path),
        stamped(file_header::CONFIG, serde_json::json!({}))
    );
    crate::backup_store::close_backup_store();
}

#[test]
fn the_records_list_width_reads_what_the_main_windows_state_save_wrote() {
    let dir = tempfile::tempdir().unwrap();
    save_state_in(
        dir.path(),
        serde_json::json!({ "activePaneId": "p1", "zoomLevel": 1.1, "recordsListWidth": 420 }),
    )
    .unwrap();
    assert_eq!(records_list_width_in(dir.path()).unwrap(), Some(420.0));
}

#[test]
fn the_records_list_width_is_absent_until_a_drag_saves_one() {
    let dir = tempfile::tempdir().unwrap();
    assert_eq!(records_list_width_in(dir.path()).unwrap(), None);
    save_state_in(dir.path(), serde_json::json!({ "activePaneId": "p1" })).unwrap();
    assert_eq!(records_list_width_in(dir.path()).unwrap(), None);
}

#[test]
fn snapshot_search_uses_the_same_unicode_lowercase_on_both_sides() {
    let conn = mem_db();
    insert_row(
        &conn,
        "match",
        "pane",
        "2026-01-01T00:00:00.000Z",
        "ÉCOLE ПРИВЕТ 50%_off",
    );
    for query in ["ÉCOLE", "école", "ПрИвЕт", "50%_off", "école привет"] {
        assert_eq!(
            list_snapshots_with_connection(&conn, query, 5, 0)
                .unwrap()
                .rows
                .len(),
            1,
            "{query}"
        );
    }
    assert!(list_snapshots_with_connection(&conn, "50%Xoff", 5, 0)
        .unwrap()
        .rows
        .is_empty());
}
