use super::*;

fn map(value: Value) -> Map<String, Value> {
    into_map(value)
}

// --- session_stamp ------------------------------------------------------

#[test]
fn session_stamp_is_yyyymmdd_hhmmss_fff_utc() {
    let now: chrono::DateTime<Utc> = "2026-06-10T03:15:42.123Z".parse().unwrap();
    assert_eq!(session_stamp(now), "20260610-031542-123-utc");
}

#[test]
fn session_stamp_zero_pads_milliseconds() {
    let now: chrono::DateTime<Utc> = "2026-01-05T03:04:09.007Z".parse().unwrap();
    assert_eq!(session_stamp(now), "20260105-030409-007-utc");
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
    let (writer, lines) = mpsc::channel();
    let thread_session = session(Some(dir.path()));
    let thread_file = file.clone();
    let thread =
        std::thread::spawn(move || run_writer(Ok(thread_file), thread_session, lines, || {}));
    for message in ["first", "second"] {
        writer
            .send(Message::Line {
                level: Level::Info,
                message: message.to_string(),
                time: "2026-01-01T00:00:01.000Z".to_string(),
                fields: Map::new(),
            })
            .unwrap();
    }
    let (done, written) = mpsc::sync_channel(1);
    writer.send(Message::Flush(done)).unwrap();
    written.recv_timeout(FLUSH_WAIT).unwrap();

    let conn = rusqlite::Connection::open(&file).unwrap();
    let messages: Vec<String> = conn
        .prepare("SELECT message FROM log_lines ORDER BY id")
        .unwrap()
        .query_map([], |row| row.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    assert_eq!(messages, ["first", "second"]);
    drop(writer);
    thread.join().unwrap();
}

#[test]
fn the_writer_thread_falls_back_when_the_database_cannot_open() {
    let dir = tempfile::tempdir().unwrap();
    let (writer, lines) = mpsc::channel();
    writer
        .send(Message::Line {
            level: Level::Info,
            message: "kept".to_string(),
            time: "2026-01-01T00:00:01.000Z".to_string(),
            fields: Map::new(),
        })
        .unwrap();
    drop(writer);
    let stored = std::cell::Cell::new(0);
    run_writer(
        Err("no data directory".to_string()),
        session(Some(dir.path())),
        lines,
        || stored.set(stored.get() + 1),
    );
    // A line that went to the fallback file is not in the database, so the
    // Records window is not told about it.
    assert_eq!(stored.get(), 0);

    let contents =
        std::fs::read_to_string(dir.path().join("logs").join("20260101-000000-000-utc.log"))
            .unwrap();
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
    let (writer, lines) = mpsc::channel();
    for message in ["first", "second"] {
        writer
            .send(Message::Line {
                level: Level::Info,
                message: message.to_string(),
                time: "2026-01-01T00:00:01.000Z".to_string(),
                fields: Map::new(),
            })
            .unwrap();
    }
    drop(writer);
    let stored = std::cell::Cell::new(0);
    run_writer(
        Ok(dir.path().join("records.sqlite3")),
        session(Some(dir.path())),
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
