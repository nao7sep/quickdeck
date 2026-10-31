// The identity header every store records (file-identity and store-recovery
// conventions).

use quickdeck_lib::file_header::{
    check_sqlite, prepare_sqlite, read_json, stamp_json, Format, JsonFormat, SqliteFormat,
    SqliteOpen,
};
use rusqlite::{Connection, OpenFlags};
use serde_json::{json, Map, Value};

const OURS: Format = Format {
    kind: "config",
    version: 1,
};

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

fn header_rows(conn: &Connection) -> Vec<(String, String)> {
    let mut statement = conn
        .prepare("select key, value from file_header order by key")
        .unwrap();
    statement
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .unwrap()
        .map(Result::unwrap)
        .collect()
}

fn store(format: Value, content: Value) -> Value {
    let mut stored = Map::new();
    stored.insert("format".into(), format);
    stored.insert(
        "writer".into(),
        json!({ "name": "quickdeck", "version": "1.0.0" }),
    );
    stored.extend(fields(content));
    Value::Object(stored)
}

#[test]
fn a_json_header_is_removed_on_read() {
    assert_eq!(
        read_json(
            store(
                json!({ "owner": "quickdeck", "kind": "config", "version": 1 }),
                json!({ "zen": true })
            ),
            OURS
        )
        .unwrap(),
        JsonFormat::Readable(fields(json!({ "zen": true })))
    );
}

#[test]
fn a_json_reader_ignores_writer_and_extra_format_fields() {
    for writer in [
        json!({ "name": "someone else", "version": "99" }),
        json!("not an object"),
        json!(null),
    ] {
        let value = json!({
            "format": { "owner": "quickdeck", "kind": "config", "version": 1, "later": true },
            "writer": writer,
            "zen": true,
        });
        assert_eq!(
            read_json(value, OURS).unwrap(),
            JsonFormat::Readable(fields(json!({ "zen": true }))),
            "{writer}"
        );
    }
    assert_eq!(
        read_json(
            json!({ "format": { "owner": "quickdeck", "kind": "config", "version": 1 } }),
            OURS
        )
        .unwrap(),
        JsonFormat::Readable(Map::new()),
        "a missing writer is not read either"
    );
}

#[test]
fn a_json_store_without_its_header_is_unreadable() {
    for value in [
        json!({ "zen": true }),
        json!({ "formatVersion": 1, "zen": true }),
        json!({ "writer": { "name": "quickdeck", "version": "1.0.0" } }),
        json!({}),
        json!([1]),
        json!(null),
        json!("x"),
    ] {
        assert!(read_json(value.clone(), OURS).is_err(), "{value}");
    }
}

#[test]
fn a_json_store_of_another_owner_or_kind_is_unreadable() {
    for format in [
        json!({ "owner": "dropkick", "kind": "config", "version": 1 }),
        json!({ "owner": "QuickDeck", "kind": "config", "version": 1 }),
        json!({ "owner": "quickdeck", "kind": "state", "version": 1 }),
        // Another format is refused even in a version this build would call newer.
        json!({ "owner": "quickdeck", "kind": "panes", "version": 2 }),
    ] {
        assert!(
            read_json(store(format.clone(), json!({ "zen": true })), OURS).is_err(),
            "{format}"
        );
    }
}

#[test]
fn a_json_store_from_a_newer_build_reads_as_newer() {
    assert_eq!(
        read_json(
            store(
                json!({ "owner": "quickdeck", "kind": "config", "version": 2 }),
                json!({ "zen": true })
            ),
            OURS
        )
        .unwrap(),
        JsonFormat::Newer(2)
    );
}

#[test]
fn a_malformed_json_format_is_unreadable() {
    for format in [
        json!(1),
        json!("quickdeck"),
        json!(null),
        json!({ "kind": "config", "version": 1 }),
        json!({ "owner": "quickdeck", "version": 1 }),
        json!({ "owner": 7, "kind": "config", "version": 1 }),
        json!({ "owner": "quickdeck", "kind": "config" }),
        json!({ "owner": "quickdeck", "kind": "config", "version": "1" }),
        json!({ "owner": "quickdeck", "kind": "config", "version": 0 }),
        json!({ "owner": "quickdeck", "kind": "config", "version": -1 }),
        json!({ "owner": "quickdeck", "kind": "config", "version": 1.5 }),
        json!({ "owner": "quickdeck", "kind": "config", "version": null }),
        json!({ "owner": "quickdeck", "kind": "config", "version": u64::MAX }),
    ] {
        assert!(
            read_json(store(format.clone(), json!({})), OURS).is_err(),
            "{format}"
        );
    }
}

#[test]
fn a_json_store_is_written_with_its_header_first() {
    let stamped = stamp_json(&json!({ "zen": true, "format": 9, "writer": "old" }), OURS).unwrap();
    assert_eq!(
        serde_json::to_string(&stamped).unwrap(),
        format!(
            r#"{{"format":{{"owner":"quickdeck","kind":"config","version":1}},"writer":{{"name":"quickdeck","version":"{}"}},"zen":true}}"#,
            env!("CARGO_PKG_VERSION")
        )
    );
    assert!(stamp_json(&json!([1, 2]), OURS).is_err());
}

#[test]
fn a_new_sqlite_store_is_created_with_its_header() {
    let conn = Connection::open_in_memory().unwrap();
    assert_eq!(
        check_sqlite(&conn, "store.sqlite3", OURS).unwrap(),
        SqliteFormat::New
    );
    assert_eq!(
        prepare_sqlite(
            &conn,
            "store.sqlite3",
            OURS,
            "create table if not exists t (x);"
        )
        .unwrap(),
        SqliteOpen::Ready
    );
    assert_eq!(user_version(&conn), 1);
    assert_eq!(
        header_rows(&conn),
        [
            ("format.kind".into(), "config".into()),
            ("format.owner".into(), "quickdeck".into()),
            ("writer.name".into(), "quickdeck".into()),
            ("writer.version".into(), env!("CARGO_PKG_VERSION").into()),
        ]
    );
    assert_eq!(
        check_sqlite(&conn, "store.sqlite3", OURS).unwrap(),
        SqliteFormat::Readable
    );
}

#[test]
fn opening_a_readable_sqlite_store_rewrites_only_its_writer_rows() {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch(
        "create table t (x);
         create table file_header (key text primary key, value text not null);
         insert into file_header values
           ('format.owner', 'quickdeck'), ('format.kind', 'config'),
           ('writer.name', 'something'), ('writer.version', '0.1.0'),
           ('writer.caller.name', 'caller'), ('writer.caller.version', '2');
         pragma user_version = 1;",
    )
    .unwrap();
    assert_eq!(
        prepare_sqlite(&conn, "store.sqlite3", OURS, "create table t (x);").unwrap(),
        SqliteOpen::Ready
    );
    assert_eq!(
        header_rows(&conn),
        [
            ("format.kind".into(), "config".into()),
            ("format.owner".into(), "quickdeck".into()),
            ("writer.name".into(), "quickdeck".into()),
            ("writer.version".into(), env!("CARGO_PKG_VERSION").into()),
        ]
    );
}

#[test]
fn a_sqlite_store_without_its_header_is_unreadable() {
    for setup in [
        "create table t (x);",
        "create table t (x); pragma user_version = 1;",
        "create table file_header (key text primary key, value text not null);
         insert into file_header values ('format.owner', 'quickdeck'), ('format.kind', 'config');",
        "create table file_header (key text primary key, value text not null);
         insert into file_header values ('format.owner', 'quickdeck');
         pragma user_version = 1;",
    ] {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(setup).unwrap();
        let refused = check_sqlite(&conn, "store.sqlite3", OURS).unwrap_err();
        assert!(refused.contains("store.sqlite3"), "{refused}");
        assert!(prepare_sqlite(&conn, "store.sqlite3", OURS, "").is_err());
    }
}

#[test]
fn a_sqlite_store_of_another_owner_or_kind_is_unreadable_and_left_untouched() {
    for (owner, kind) in [("dropkick", "config"), ("quickdeck", "records")] {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(&format!(
            "create table file_header (key text primary key, value text not null);
             insert into file_header values ('format.owner', '{owner}'), ('format.kind', '{kind}'),
               ('writer.name', 'other');
             pragma user_version = 1;"
        ))
        .unwrap();
        let refused = prepare_sqlite(&conn, "store.sqlite3", OURS, "").unwrap_err();
        assert!(refused.contains("store.sqlite3"), "{refused}");
        assert!(header_rows(&conn).contains(&("writer.name".into(), "other".into())));
    }
}

#[test]
fn a_sqlite_store_from_a_newer_build_reads_as_newer_even_read_only() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("store.sqlite3");
    Connection::open(&path)
        .unwrap()
        .execute_batch(
            "create table t (x);
             create table file_header (key text primary key, value text not null);
             insert into file_header values ('format.owner', 'quickdeck'), ('format.kind', 'config');
             pragma user_version = 2;",
        )
        .unwrap();

    let read_only = Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    assert_eq!(
        check_sqlite(&read_only, "store.sqlite3", OURS).unwrap(),
        SqliteFormat::Newer(2)
    );
    let before = std::fs::read(&path).unwrap();
    let conn = Connection::open(&path).unwrap();
    assert_eq!(
        prepare_sqlite(&conn, "store.sqlite3", OURS, "").unwrap(),
        SqliteOpen::Newer(2)
    );
    drop(conn);
    assert_eq!(std::fs::read(&path).unwrap(), before);
}
