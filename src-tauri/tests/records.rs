use quickdeck_lib::records::{
    read_detail, read_page, read_sessions, Cursor, LevelFilter, RecordsQuery, PAGE_SIZE, SCHEMA,
};
use rusqlite::{params, Connection};

const LAUNCH: &str = "2026-10-01T08:00:00.000Z";
const LATER_LAUNCH: &str = "2026-10-02T08:00:00.000Z";

mod support {
    pub mod statement_work;
}

#[test]
fn a_deep_cursor_seeks_without_rescanning_newer_records() {
    let conn = database();
    conn.execute_batch(
        "WITH RECURSIVE sequence(id) AS (VALUES(1) UNION ALL SELECT id + 1 FROM sequence WHERE id < 100000)
         INSERT INTO log_lines(id, session, time, level, message, fields)
         SELECT id, 'launch', strftime('%Y-%m-%dT%H:%M:%fZ', '2026-01-01', (id / 2) || ' seconds'), 'info', 'line', '{}' FROM sequence;"
    ).unwrap();
    let (page, work) = support::statement_work::measure(&conn, || {
        read_page(
            &conn,
            &RecordsQuery {
                after: Some(Cursor {
                    time: "2026-01-01T01:23:20.000Z".into(),
                    id: 10000,
                }),
                ..query()
            },
        )
        .unwrap()
    });
    assert_eq!(page.records[0].id, 9999);
    assert_eq!(page.records.len(), PAGE_SIZE);
    assert!(page.more);
    assert_eq!(work.scans, 0, "cursor must seek: {work:?}");
    assert!(
        work.steps < 5000,
        "work should follow page size, not cursor depth: {work:?}"
    );
}
fn database() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch(SCHEMA).unwrap();
    conn
}

fn insert(
    conn: &Connection,
    session: &str,
    time: &str,
    level: &str,
    message: &str,
    fields: &str,
) -> i64 {
    conn.execute(
        "INSERT INTO log_lines (session, time, level, message, pane_id, snapshot_id, fields)
         VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6)",
        params![session, time, level, message, "pane-1", fields],
    )
    .unwrap();
    conn.last_insert_rowid()
}

fn query() -> RecordsQuery {
    RecordsQuery::default()
}

fn messages(conn: &Connection, query: &RecordsQuery) -> Vec<String> {
    read_page(conn, query)
        .unwrap()
        .records
        .into_iter()
        .map(|record| record.message)
        .collect()
}

#[test]
fn a_page_lists_the_newest_lines_first_with_the_operation_they_name() {
    let conn = database();
    insert(
        &conn,
        LAUNCH,
        "2026-10-01T08:00:01.000Z",
        "info",
        "startup",
        "{}",
    );
    insert(
        &conn,
        LAUNCH,
        "2026-10-01T08:00:03.000Z",
        "info",
        "boundary ok",
        r#"{"op":"save_panes","ms":3}"#,
    );
    // A frontend line stamps its own time, so a later row can be older.
    insert(
        &conn,
        LAUNCH,
        "2026-10-01T08:00:02.000Z",
        "warn",
        "set zoom failed",
        r#"{"op":7}"#,
    );

    let page = read_page(&conn, &query()).unwrap();
    let rows: Vec<(&str, Option<&str>)> = page
        .records
        .iter()
        .map(|record| (record.message.as_str(), record.op.as_deref()))
        .collect();
    assert_eq!(
        rows,
        [
            ("boundary ok", Some("save_panes")),
            ("set zoom failed", None),
            ("startup", None)
        ]
    );
    assert!(!page.more);
}

#[test]
fn pages_follow_the_cursor_without_skipping_or_repeating_a_line() {
    let conn = database();
    for index in 0..(PAGE_SIZE + 5) {
        // Pairs of lines share a time, so the id breaks the tie.
        let time = format!(
            "2026-10-01T08:{:02}:{:02}.000Z",
            index / 2 / 60,
            index / 2 % 60
        );
        insert(&conn, LAUNCH, &time, "info", &format!("line {index}"), "{}");
    }

    let first = read_page(&conn, &query()).unwrap();
    assert_eq!(first.records.len(), PAGE_SIZE);
    assert!(first.more);
    let last = first.records.last().unwrap();
    let second = read_page(
        &conn,
        &RecordsQuery {
            after: Some(Cursor {
                time: last.time.clone(),
                id: last.id,
            }),
            ..query()
        },
    )
    .unwrap();
    assert_eq!(second.records.len(), 5);
    assert!(!second.more);

    let mut seen: Vec<i64> = first
        .records
        .iter()
        .chain(&second.records)
        .map(|record| record.id)
        .collect();
    seen.sort_unstable();
    seen.dedup();
    assert_eq!(seen.len(), PAGE_SIZE + 5);
    // Newest first throughout: time descending, then id descending.
    let order: Vec<(String, i64)> = first
        .records
        .iter()
        .chain(&second.records)
        .map(|record| (record.time.clone(), record.id))
        .collect();
    let mut sorted = order.clone();
    sorted.sort_by(|a, b| b.cmp(a));
    assert_eq!(order, sorted);
}

#[test]
fn the_level_filter_reads_one_level_or_everything_that_is_a_warning_or_error() {
    let conn = database();
    for level in ["debug", "info", "warn", "error"] {
        insert(
            &conn,
            LAUNCH,
            "2026-10-01T08:00:01.000Z",
            level,
            level,
            "{}",
        );
    }
    let with = |level| {
        messages(
            &conn,
            &RecordsQuery {
                level: Some(level),
                ..query()
            },
        )
    };

    assert_eq!(with(LevelFilter::WarningsAndErrors), ["error", "warn"]);
    assert_eq!(with(LevelFilter::Error), ["error"]);
    assert_eq!(with(LevelFilter::Warn), ["warn"]);
    assert_eq!(with(LevelFilter::Info), ["info"]);
    assert_eq!(with(LevelFilter::Debug), ["debug"]);

    // The Records window sends these names.
    for (name, level) in [
        ("warningsAndErrors", LevelFilter::WarningsAndErrors),
        ("error", LevelFilter::Error),
        ("warn", LevelFilter::Warn),
        ("info", LevelFilter::Info),
        ("debug", LevelFilter::Debug),
    ] {
        assert_eq!(
            serde_json::from_value::<LevelFilter>(serde_json::json!(name)).unwrap(),
            level
        );
    }
}

#[test]
fn the_launch_filter_reads_one_session_and_the_sources_list_every_launch_newest_first() {
    let conn = database();
    insert(
        &conn,
        LAUNCH,
        "2026-10-01T08:00:01.000Z",
        "info",
        "earlier",
        "{}",
    );
    insert(
        &conn,
        LATER_LAUNCH,
        "2026-10-02T08:00:01.000Z",
        "info",
        "later",
        "{}",
    );

    assert_eq!(
        messages(
            &conn,
            &RecordsQuery {
                session: Some(LAUNCH.to_string()),
                ..query()
            }
        ),
        ["earlier"]
    );
    assert_eq!(read_sessions(&conn).unwrap(), [LATER_LAUNCH, LAUNCH]);
}

#[test]
fn a_search_matches_the_typed_text_literally_in_every_text_column() {
    let conn = database();
    insert(
        &conn,
        LAUNCH,
        "2026-10-01T08:00:01.000Z",
        "info",
        "boundary ok",
        r#"{"op":"save_panes"}"#,
    );
    insert(
        &conn,
        LAUNCH,
        "2026-10-01T08:00:02.000Z",
        "info",
        "50% done",
        "{}",
    );
    insert(
        &conn,
        LAUNCH,
        "2026-10-01T08:00:03.000Z",
        "info",
        "500 done",
        "{}",
    );
    let search = |text: &str| {
        messages(
            &conn,
            &RecordsQuery {
                search: text.to_string(),
                ..query()
            },
        )
    };

    assert_eq!(search("SAVE_PANES"), ["boundary ok"]);
    assert_eq!(search("50%"), ["50% done"]);
    assert_eq!(search("pane-1").len(), 3);
    assert_eq!(search("   ").len(), 3);
    assert!(search("nothing like it").is_empty());
}

#[test]
fn a_detail_holds_every_column_as_stored() {
    let conn = database();
    let id = insert(
        &conn,
        LAUNCH,
        "2026-10-01T08:00:01.000Z",
        "error",
        "boundary failed",
        r#"{"op":"save_panes","error":"disk full"}"#,
    );

    let detail = read_detail(&conn, id).unwrap().unwrap();
    assert_eq!(detail.session, LAUNCH);
    assert_eq!(detail.level, "error");
    assert_eq!(detail.message, "boundary failed");
    assert_eq!(detail.pane_id.as_deref(), Some("pane-1"));
    assert_eq!(detail.snapshot_id, None);
    assert_eq!(detail.fields, r#"{"op":"save_panes","error":"disk full"}"#);
    assert_eq!(read_detail(&conn, id + 1).unwrap(), None);
}
