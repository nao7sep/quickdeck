// The format-version marker every store records (store-recovery conventions).

use quickdeck_lib::format_version::{
    check_sqlite, create_sqlite, read_json, stamp_json, JsonFormat, SqliteFormat, ARCHIVE_MANIFEST,
    BACKUPS, CONFIG, PANES, RECORDS, SNAPSHOTS, STATE, WINDOW,
};
use rusqlite::{Connection, OpenFlags};
use serde_json::{json, Map, Value};

fn fields(value: Value) -> Map<String, Value> {
    match value {
        Value::Object(fields) => fields,
        other => panic!("not an object: {other}"),
    }
}

fn user_version(conn: &Connection) -> i64 {
    conn.pragma_query_value(None, "user_version", |row| row.get(0))
        .unwrap()
}

#[test]
fn every_format_is_at_1_before_the_data_is_durable() {
    for version in [
        CONFIG,
        STATE,
        WINDOW,
        PANES,
        SNAPSHOTS,
        BACKUPS,
        RECORDS,
        ARCHIVE_MANIFEST,
    ] {
        assert_eq!(version, 1);
    }
}

#[test]
fn a_json_marker_is_removed_on_read() {
    assert_eq!(
        read_json(json!({ "formatVersion": 1, "zen": true }), 1).unwrap(),
        JsonFormat::Readable(fields(json!({ "zen": true })))
    );
}

#[test]
fn a_json_store_without_its_marker_is_unreadable() {
    for value in [
        json!({ "zen": true }),
        json!({}),
        json!([1]),
        json!(null),
        json!("x"),
    ] {
        assert!(read_json(value.clone(), 1).is_err(), "{value}");
    }
}

#[test]
fn a_json_store_from_a_newer_build_reads_as_newer() {
    assert_eq!(
        read_json(json!({ "formatVersion": 3, "zen": true }), 2).unwrap(),
        JsonFormat::Newer(3)
    );
    assert_eq!(
        read_json(json!({ "formatVersion": 2 }), 2).unwrap(),
        JsonFormat::Readable(Map::new())
    );
}

#[test]
fn a_json_marker_that_is_not_a_positive_integer_is_unreadable() {
    for marker in [
        json!("1"),
        json!(0),
        json!(-1),
        json!(1.5),
        json!(null),
        json!(u64::MAX),
    ] {
        assert!(
            read_json(json!({ "formatVersion": marker }), 1).is_err(),
            "{marker}"
        );
    }
}

#[test]
fn a_json_store_is_written_with_its_marker_first() {
    let stamped = stamp_json(&json!({ "zen": true, "formatVersion": 9 }), 1).unwrap();
    assert_eq!(
        serde_json::to_string(&stamped).unwrap(),
        r#"{"formatVersion":1,"zen":true}"#
    );
    assert!(stamp_json(&json!([1, 2]), 1).is_err());
}

#[test]
fn a_new_sqlite_store_is_created_with_its_marker() {
    let conn = Connection::open_in_memory().unwrap();
    assert_eq!(
        check_sqlite(&conn, "store.sqlite3", 1).unwrap(),
        SqliteFormat::New
    );
    create_sqlite(&conn, "create table if not exists t (x);", 1).unwrap();
    assert_eq!(user_version(&conn), 1);
    assert_eq!(
        check_sqlite(&conn, "store.sqlite3", 1).unwrap(),
        SqliteFormat::Readable
    );
}

#[test]
fn a_sqlite_store_with_tables_but_no_marker_is_unreadable() {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("create table t (x);").unwrap();
    let refused = check_sqlite(&conn, "store.sqlite3", 1).unwrap_err();
    assert!(refused.contains("store.sqlite3"), "{refused}");
    assert_eq!(user_version(&conn), 0);
}

#[test]
fn a_sqlite_store_from_a_newer_build_reads_as_newer_even_read_only() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("store.sqlite3");
    Connection::open(&path)
        .unwrap()
        .execute_batch("create table t (x); pragma user_version = 2;")
        .unwrap();

    let read_only = Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    assert_eq!(
        check_sqlite(&read_only, "store.sqlite3", 1).unwrap(),
        SqliteFormat::Newer(2)
    );
    assert_eq!(
        check_sqlite(&read_only, "store.sqlite3", 2).unwrap(),
        SqliteFormat::Readable
    );
}
