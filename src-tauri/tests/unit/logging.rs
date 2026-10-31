use super::*;

fn map(value: Value) -> Map<String, Value> {
    into_map(value)
}

// --- session_stamp ------------------------------------------------------

#[test]
fn session_stamp_is_yyyymmdd_hhmmss_utc() {
    let now: chrono::DateTime<Utc> = "2026-06-10T03:15:42.123Z".parse().unwrap();
    assert_eq!(session_stamp(now), "20260610-031542-utc");
}

#[test]
fn session_stamp_zero_pads_each_field() {
    let now: chrono::DateTime<Utc> = "2026-01-05T03:04:09.007Z".parse().unwrap();
    assert_eq!(session_stamp(now), "20260105-030409-utc");
}

#[test]
fn a_fallback_file_from_the_same_second_is_appended_to() {
    let dir = tempfile::tempdir().unwrap();
    append_fallback(dir.path(), "20260105-030409-utc", "first").unwrap();
    append_fallback(dir.path(), "20260105-030409-utc", "second").unwrap();
    assert_eq!(
        fs::read_to_string(dir.path().join("logs/20260105-030409-utc.log")).unwrap(),
        "first\nsecond\n"
    );
}

#[test]
fn fallback_logging_does_not_recreate_a_deleted_launch_root() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("claimed");
    fs::create_dir(&root).unwrap();
    let session = session(Some(&root));
    fs::remove_dir(&root).unwrap();

    assert!(!write_record(
        None,
        &session,
        Level::Warn,
        "fallback",
        "2026-01-01T00:00:01.000Z",
        &Map::new()
    ));
    assert!(
        !root.exists(),
        "optional diagnostics must not recreate the root"
    );
}

#[test]
fn fallback_logging_does_not_replace_a_file_named_logs() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("logs");
    fs::write(&path, "kept").unwrap();
    assert!(append_fallback(dir.path(), "20260105-030409-utc", "line").is_err());
    assert_eq!(fs::read_to_string(path).unwrap(), "kept");
}
#[test]
fn level_parse_is_liberal_and_case_insensitive() {
    assert_eq!(Level::parse("debug").as_str(), "debug");
    assert_eq!(Level::parse("INFO").as_str(), "info");
    assert_eq!(Level::parse(" Warn ").as_str(), "warn");
    assert_eq!(Level::parse("warning").as_str(), "warn");
    assert_eq!(Level::parse("Error").as_str(), "error");
    // Anything unrecognized degrades to info rather than vanishing.
    assert_eq!(Level::parse("trace").as_str(), "info");
    assert_eq!(Level::parse("").as_str(), "info");
}

#[test]
fn build_line_starts_with_envelope_in_order() {
    let line = build_line(
        Level::Info,
        "hello",
        "2026-01-01T00:00:00.000Z",
        map(json!({ "op": "load" })),
    );
    assert!(
        line.starts_with(r#"{"time":"2026-01-01T00:00:00.000Z","level":"info","message":"hello""#),
        "unexpected line: {line}"
    );
    assert!(line.ends_with(r#""op":"load"}"#), "unexpected line: {line}");
}

#[test]
fn build_line_preserves_fields_that_collide_with_the_envelope() {
    let line = build_line(
        Level::Warn,
        "real message",
        "2026-01-01T00:00:00.000Z",
        map(json!({ "message": "spoofed", "level": "debug", "ok": true })),
    );
    let parsed: Value = serde_json::from_str(&line).unwrap();
    // The envelope stays authoritative...
    assert_eq!(parsed["message"], json!("real message"));
    assert_eq!(parsed["level"], json!("warn"));
    // ...and the colliding free fields are preserved (suffixed), not dropped.
    assert_eq!(parsed["message_"], json!("spoofed"));
    assert_eq!(parsed["level_"], json!("debug"));
    assert_eq!(parsed["ok"], json!(true));
}

#[test]
fn build_line_emits_one_physical_line_for_multiline_values() {
    let line = build_line(
        Level::Info,
        "multi",
        "2026-01-01T00:00:00.000Z",
        map(json!({ "detail": "line one\nline two" })),
    );
    // The JSON escapes the newline, so the serialized line has none.
    assert!(!line.contains('\n'), "line contained a raw newline: {line}");
    let parsed: Value = serde_json::from_str(&line).unwrap();
    assert_eq!(parsed["detail"], json!("line one\nline two"));
}

#[test]
fn into_map_wraps_non_object_payloads() {
    assert_eq!(into_map(json!(null)), Map::new());
    assert_eq!(into_map(json!("x"))["value"], json!("x"));
    assert_eq!(into_map(json!([1, 2]))["value"], json!([1, 2]));
}

fn session(root: Option<&Path>) -> Session {
    Session {
        started: "2026-01-01T00:00:00.000Z".to_string(),
        stamp: "20260101-000000-000-utc".to_string(),
        root: root.map(Path::to_path_buf),
    }
}

#[test]
fn write_record_stores_the_session_and_moves_domain_ids_to_their_columns() {
    let dir = tempfile::tempdir().unwrap();
    let conn = open_records(&dir.path().join("records.sqlite3")).unwrap();
    let fields = map(json!({ "paneId": "p1", "snapshotId": "s1", "message": "kept", "count": 2 }));
    write_record(
        Some(&conn),
        &session(Some(dir.path())),
        Level::Warn,
        "hello",
        "2026-01-01T00:00:01.000Z",
        &fields,
    );
    write_record(
        Some(&conn),
        &session(Some(dir.path())),
        Level::Info,
        "plain",
        "2026-01-01T00:00:02.000Z",
        &Map::new(),
    );

    type Row = (
        String,
        String,
        String,
        String,
        Option<String>,
        Option<String>,
        String,
    );
    let rows: Vec<Row> = conn
        .prepare("SELECT session, time, level, message, pane_id, snapshot_id, fields FROM log_lines ORDER BY id")
        .unwrap()
        .query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?, row.get(6)?))
        })
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    assert_eq!(rows.len(), 2);
    let (session_start, time, level, message, pane_id, snapshot_id, fields) = &rows[0];
    assert_eq!(session_start, "2026-01-01T00:00:00.000Z");
    assert_eq!(time, "2026-01-01T00:00:01.000Z");
    assert_eq!(level, "warn");
    assert_eq!(message, "hello");
    assert_eq!(pane_id.as_deref(), Some("p1"));
    assert_eq!(snapshot_id.as_deref(), Some("s1"));
    assert_eq!(
        serde_json::from_str::<Value>(fields).unwrap(),
        json!({ "message": "kept", "count": 2 })
    );
    assert_eq!((rows[1].4.as_deref(), rows[1].6.as_str()), (None, "{}"));
    assert!(!dir.path().join("logs").exists());
}

#[test]
fn write_record_falls_back_to_a_text_file_under_logs() {
    let dir = tempfile::tempdir().unwrap();
    let fields = map(json!({ "paneId": "p1" }));
    write_record(
        None,
        &session(Some(dir.path())),
        Level::Info,
        "one",
        "2026-01-01T00:00:01.000Z",
        &fields,
    );
    write_record(
        None,
        &session(Some(dir.path())),
        Level::Error,
        "two",
        "2026-01-01T00:00:02.000Z",
        &Map::new(),
    );

    let contents =
        std::fs::read_to_string(dir.path().join("logs").join("20260101-000000-000-utc.log"))
            .unwrap();
    let lines: Vec<Value> = contents
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert_eq!(
        lines,
        vec![
            json!({ "time": "2026-01-01T00:00:01.000Z", "level": "info", "message": "one", "paneId": "p1" }),
            json!({ "time": "2026-01-01T00:00:02.000Z", "level": "error", "message": "two" }),
        ]
    );
}

#[test]
fn write_record_falls_back_when_the_insert_fails() {
    let dir = tempfile::tempdir().unwrap();
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    write_record(
        Some(&conn),
        &session(Some(dir.path())),
        Level::Info,
        "lost table",
        "2026-01-01T00:00:01.000Z",
        &Map::new(),
    );
    let contents =
        std::fs::read_to_string(dir.path().join("logs").join("20260101-000000-000-utc.log"))
            .unwrap();
    assert!(
        contents.contains("\"lost table\""),
        "unexpected fallback: {contents}"
    );
}

#[test]
fn the_writer_thread_writes_lines_in_order_before_answering_a_flush() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("records.sqlite3");
    let (logger, lines) = Logger::channel(session(Some(dir.path())), true);
    let thread_session = logger.session.clone();
    let thread_file = file.clone();
    let thread =
        std::thread::spawn(move || run_writer(Ok(thread_file), thread_session, lines, || {}));
    for message in ["first", "second"] {
        assert!(logger.write_event(Level::Info, message, now_iso(), Map::new()));
    }
    logger.flush(Duration::MAX);
    drop(logger);
    thread.join().unwrap();

    let conn = Connection::open(&file).unwrap();
    let messages: Vec<String> = conn
        .prepare("SELECT message FROM log_lines ORDER BY id")
        .unwrap()
        .query_map([], |row| row.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    assert_eq!(messages, ["first", "second"]);
}

#[test]
fn the_writer_thread_falls_back_when_the_database_cannot_open() {
    let dir = tempfile::tempdir().unwrap();
    let (logger, lines) = Logger::channel(session(Some(dir.path())), true);
    assert!(logger.write_event(Level::Info, "kept", now_iso(), Map::new()));
    let thread_session = logger.session.clone();
    drop(logger);
    let stored = std::cell::Cell::new(0);
    run_writer(
        Err("no data directory".to_string()),
        thread_session,
        lines,
        || stored.set(stored.get() + 1),
    );
    assert_eq!(stored.get(), 0);
    let contents = fs::read_to_string(dir.path().join("logs/20260101-000000-000-utc.log")).unwrap();
    let messages: Vec<Value> = contents
        .lines()
        .map(|line| serde_json::from_str::<Value>(line).unwrap()["message"].clone())
        .collect();
    assert_eq!(
        messages,
        [json!("records database unavailable"), json!("kept")]
    );
}

#[test]
fn the_writer_thread_signals_each_row_the_database_stored() {
    let dir = tempfile::tempdir().unwrap();
    let (logger, lines) = Logger::channel(session(Some(dir.path())), true);
    for message in ["first", "second"] {
        assert!(logger.write_event(Level::Info, message, now_iso(), Map::new()));
    }
    let thread_session = logger.session.clone();
    drop(logger);
    let stored = std::cell::Cell::new(0);
    run_writer(
        Ok(dir.path().join("records.sqlite3")),
        thread_session,
        lines,
        || stored.set(stored.get() + 1),
    );
    assert_eq!(stored.get(), 2);
}

#[test]
fn write_record_says_whether_the_row_reached_the_database() {
    let dir = tempfile::tempdir().unwrap();
    let conn = open_records(&dir.path().join("records.sqlite3")).unwrap();
    let session = session(Some(dir.path()));
    let time = "2026-01-01T00:00:01.000Z";
    assert!(write_record(
        Some(&conn),
        &session,
        Level::Info,
        "kept",
        time,
        &Map::new()
    ));
    assert!(!write_record(
        None,
        &session,
        Level::Info,
        "fallback",
        time,
        &Map::new()
    ));
}

#[test]
fn a_new_records_database_records_its_file_header() {
    let dir = tempfile::tempdir().unwrap();
    let conn = open_records(&dir.path().join("records.sqlite3")).unwrap();
    let version: i64 = conn
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .unwrap();
    assert_eq!(version, i64::from(file_header::RECORDS.version));
    let kind: String = conn
        .query_row(
            "select value from file_header where key = 'format.kind'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(kind, "records");
}

// A records database a newer build made: its header, recorded in version 2.
const NEWER_RECORDS: &str = "create table file_header (key text primary key, value text not null);
             insert into file_header values ('format.owner', 'quickdeck'), ('format.kind', 'records');
             pragma user_version = 2;";

#[test]
fn a_records_database_from_a_newer_build_is_left_untouched() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("records.sqlite3");
    Connection::open(&file)
        .unwrap()
        .execute_batch(NEWER_RECORDS)
        .unwrap();
    let before = fs::read(&file).unwrap();

    let refused = open_records(&file).err().unwrap().to_string();
    assert!(refused.contains("records.sqlite3"), "{refused}");
    assert!(refused.contains("newer"), "{refused}");
    assert_eq!(fs::read(&file).unwrap(), before);
}

#[test]
fn a_records_database_without_its_header_is_left_untouched() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("records.sqlite3");
    Connection::open(&file)
        .unwrap()
        .execute_batch(records::SCHEMA)
        .unwrap();
    let before = fs::read(&file).unwrap();

    let refused = open_records(&file).err().unwrap().to_string();
    assert!(refused.contains("records.sqlite3"), "{refused}");
    assert_eq!(fs::read(&file).unwrap(), before);
}

#[test]
fn disconnected_writer_never_uses_a_caller_thread_fallback() {
    let dir = tempfile::tempdir().unwrap();
    let (logger, lines) = Logger::channel(session(Some(dir.path())), true);
    drop(lines);
    assert!(!logger.write_event(Level::Error, "disconnected", now_iso(), Map::new()));
    logger.flush(Duration::MAX);
    assert!(fs::read_dir(dir.path()).unwrap().next().is_none());
}

// Queues a read of the row count, as `read` does, and returns where it answers.
fn queue_count(logger: &Logger) -> mpsc::Receiver<Result<i64, String>> {
    let (answer, answered) = mpsc::sync_channel(1);
    let job: Read = Box::new(move |records| {
        let _ = answer.send(records.map_err(str::to_string).and_then(|conn| {
            conn.query_row("SELECT count(*) FROM log_lines", [], |row| row.get(0))
                .map_err(|error| error.to_string())
        }));
    });
    assert!(logger.writer.send(Message::Read(job)).is_ok());
    answered
}

#[test]
fn a_read_runs_on_the_writer_after_the_lines_sent_before_it() {
    let dir = tempfile::tempdir().unwrap();
    let (logger, lines) = Logger::channel(session(Some(dir.path())), true);
    for message in ["first", "second"] {
        assert!(logger.write_event(Level::Info, message, now_iso(), Map::new()));
    }
    let answered = queue_count(&logger);
    let thread_session = logger.session.clone();
    drop(logger);
    run_writer(
        Ok(dir.path().join("records.sqlite3")),
        thread_session,
        lines,
        || {},
    );
    assert_eq!(answered.recv().unwrap(), Ok(2));
}

#[test]
fn a_read_of_a_records_database_from_a_newer_build_answers_its_error() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("records.sqlite3");
    Connection::open(&file)
        .unwrap()
        .execute_batch(NEWER_RECORDS)
        .unwrap();
    let (logger, lines) = Logger::channel(session(Some(dir.path())), true);
    let answered = queue_count(&logger);
    let thread_session = logger.session.clone();
    drop(logger);
    run_writer(Ok(file), thread_session, lines, || {});
    let refused = answered.recv().unwrap().unwrap_err();
    assert!(refused.contains("records.sqlite3"), "{refused}");
}

// The Records window pages the real store from the newest line down while new
// lines keep arriving: over 10,000 lines, each read once, newest first, with no
// gap or repeat, and the arrivals read from the top afterwards.
#[test]
fn paging_10000_records_while_new_ones_arrive_reads_each_once_newest_first() {
    let dir = tempfile::tempdir().unwrap();
    let conn = open_records(&dir.path().join("records.sqlite3")).unwrap();
    let session = session(Some(dir.path()));
    let base: chrono::DateTime<Utc> = "2026-01-01T00:00:00.000Z".parse().unwrap();
    // Pairs of lines share a millisecond, so the id breaks the tie.
    let time = |index: i64| {
        (base + chrono::Duration::milliseconds(index / 2))
            .to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
    };
    let write = |index: i64| {
        assert!(write_record(
            Some(&conn),
            &session,
            Level::Info,
            &format!("line {index}"),
            &time(index),
            &Map::new()
        ));
    };
    conn.execute_batch("BEGIN").unwrap();
    for index in 0..10_000 {
        write(index);
    }
    conn.execute_batch("COMMIT").unwrap();

    let mut read = Vec::new();
    let mut after = None;
    let mut arrived = 10_000;
    loop {
        let page = records::read_page(
            &conn,
            &records::RecordsQuery {
                after,
                ..Default::default()
            },
        )
        .unwrap();
        read.extend(page.records.iter().map(|record| record.message.clone()));
        if !page.more {
            break;
        }
        let last = page.records.last().unwrap();
        after = Some(records::Cursor {
            time: last.time.clone(),
            id: last.id,
        });
        for _ in 0..3 {
            write(arrived);
            arrived += 1;
        }
    }
    let expected: Vec<String> = (0..10_000)
        .rev()
        .map(|index| format!("line {index}"))
        .collect();
    assert_eq!(read, expected);

    let top = records::read_page(&conn, &records::RecordsQuery::default()).unwrap();
    assert_eq!(top.records[0].message, format!("line {}", arrived - 1));
    assert!(arrived > 10_000 + 3 * 98);
}
