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
    let (logger, lines) = Logger::channel(session(Some(dir.path())), true, 64 * 1024, 8);
    let thread_session = logger.session.clone();
    let thread_file = file.clone();
    let budget = logger.budget.clone();
    let thread = std::thread::spawn(move || run_writer(Ok(thread_file), thread_session, lines, budget, || {}));
    for message in ["first", "second"] {
        assert!(logger.write_event(Level::Info, message, now_iso(), Map::new()));
    }
    logger.flush();
    drop(logger);
    thread.join().unwrap();

    let conn = Connection::open(&file).unwrap();
    let messages: Vec<String> = conn.prepare("SELECT message FROM log_lines ORDER BY id").unwrap()
        .query_map([], |row| row.get(0)).unwrap().collect::<Result<_, _>>().unwrap();
    assert_eq!(messages, ["first", "second"]);
}

#[test]
fn the_writer_thread_falls_back_when_the_database_cannot_open() {
    let dir = tempfile::tempdir().unwrap();
    let (logger, lines) = Logger::channel(session(Some(dir.path())), true, 64 * 1024, 8);
    assert!(logger.write_event(Level::Info, "kept", now_iso(), Map::new()));
    let thread_session = logger.session.clone();
    let budget = logger.budget.clone();
    drop(logger);
    let stored = std::cell::Cell::new(0);
    run_writer(Err("no data directory".to_string()), thread_session, lines, budget,
        || stored.set(stored.get() + 1));
    assert_eq!(stored.get(), 0);
    let contents = fs::read_to_string(dir.path().join("logs/20260101-000000-000-utc.log")).unwrap();
    let messages: Vec<Value> = contents.lines()
        .map(|line| serde_json::from_str::<Value>(line).unwrap()["message"].clone()).collect();
    assert_eq!(messages, [json!("records database unavailable"), json!("kept")]);
}

#[test]
fn the_writer_thread_signals_each_row_the_database_stored() {
    let dir = tempfile::tempdir().unwrap();
    let (logger, lines) = Logger::channel(session(Some(dir.path())), true, 64 * 1024, 8);
    for message in ["first", "second"] {
        assert!(logger.write_event(Level::Info, message, now_iso(), Map::new()));
    }
    let thread_session = logger.session.clone();
    let budget = logger.budget.clone();
    drop(logger);
    let stored = std::cell::Cell::new(0);
    run_writer(Ok(dir.path().join("records.sqlite3")), thread_session, lines, budget,
        || stored.set(stored.get() + 1));
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
fn a_new_records_database_records_its_format_version() {
    let dir = tempfile::tempdir().unwrap();
    let conn = open_records(&dir.path().join("records.sqlite3")).unwrap();
    let version: i64 = conn
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .unwrap();
    assert_eq!(version, i64::from(format_version::RECORDS));
}

#[test]
fn a_records_database_from_a_newer_build_is_left_untouched() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("records.sqlite3");
    Connection::open(&file)
        .unwrap()
        .execute_batch("pragma user_version = 2;")
        .unwrap();
    let before = fs::read(&file).unwrap();

    let refused = open_records(&file).err().unwrap();
    assert!(refused.contains("records.sqlite3"), "{refused}");
    assert_eq!(fs::read(&file).unwrap(), before);
}

#[test]
fn a_records_database_without_its_marker_is_left_untouched() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("records.sqlite3");
    Connection::open(&file)
        .unwrap()
        .execute_batch(records::SCHEMA)
        .unwrap();
    let before = fs::read(&file).unwrap();

    let refused = open_records(&file).err().unwrap();
    assert!(refused.contains("records.sqlite3"), "{refused}");
    assert_eq!(fs::read(&file).unwrap(), before);
}

#[test]
fn caller_admission_bounds_count_and_keeps_in_flight_diagnostics_until_sink_settles() {
    let (logger, lines) = Logger::channel(session(None), true, 64 * 1024, 2);
    let budget = logger.budget.clone();
    let (entered, started) = mpsc::sync_channel(1);
    let (release, held) = mpsc::sync_channel(1);
    let writer_budget = budget.clone();
    let thread = std::thread::spawn(move || {
        let mut output = Vec::new();
        run_messages(lines, &writer_budget, |level, message, _, fields| {
            if message == "first" {
                entered.send(()).unwrap();
                held.recv().unwrap();
            }
            output.push((level.as_str(), message.to_string(), fields.clone()));
        });
        output
    });
    let detail = "complete diagnostic\n".repeat(100);
    let fields = map(json!({ "nested": [{ "detail": detail }] }));
    assert!(logger.write_event(Level::Error, "first", now_iso(), fields.clone()));
    started.recv_timeout(Duration::from_secs(10)).unwrap();
    let in_flight = budget.retained.load(Ordering::Relaxed);
    assert!(in_flight > detail.len());
    assert!(logger.write_event(Level::Info, "second", now_iso(), Map::new()));
    assert!(logger.write_event(Level::Info, "third", now_iso(), Map::new()));
    let admitted = budget.retained.load(Ordering::Relaxed);
    assert!(!logger.write_event(Level::Warn, "full", now_iso(), Map::new()));
    assert_eq!(budget.retained.load(Ordering::Relaxed), admitted);
    assert_eq!(budget.dropped.load(Ordering::Relaxed), 1);
    // A full control queue returns without waiting for the stalled sink.
    let logger = Arc::new(logger);
    let caller_logger = logger.clone();
    let (flushed, finished) = mpsc::sync_channel(1);
    let caller = std::thread::spawn(move || { caller_logger.flush(); flushed.send(()).unwrap(); });
    finished.recv_timeout(Duration::from_secs(10)).unwrap();
    caller.join().unwrap();
    assert!(budget.retained.load(Ordering::Relaxed) >= in_flight);
    release.send(()).unwrap();
    drop(logger);
    let output = thread.join().unwrap();
    assert_eq!(budget.retained.load(Ordering::Relaxed), 0);
    assert_eq!(output.iter().filter(|(_, message, _)| message != "log events dropped")
        .map(|(_, message, _)| message.as_str()).collect::<Vec<_>>(), ["first", "second", "third"]);
    assert_eq!(output[0].2, fields);
    let summary = output.iter().find(|(_, message, _)| message == "log events dropped").unwrap();
    assert_eq!(summary.0, "warn");
    assert_eq!(summary.2["dropped"], json!(1));
}

#[test]
fn caller_admission_bounds_retained_bytes_and_rejects_oversize_diagnostics() {
    let (logger, lines) = Logger::channel(session(None), true, 2048, 100);
    let budget = logger.budget.clone();
    let writer_budget = budget.clone();
    let (entered, started) = mpsc::sync_channel(1);
    let (release, held) = mpsc::sync_channel(1);
    let writer = std::thread::spawn(move || run_messages(lines, &writer_budget, |_, message, _, _| {
        if message == "first" {
            entered.send(()).unwrap();
            held.recv().unwrap();
        }
    }));
    let fields = map(json!({ "detail": "x".repeat(700) }));
    assert!(logger.write_event(Level::Info, "first", now_iso(), fields.clone()));
    started.recv_timeout(Duration::from_secs(10)).unwrap();
    assert!(!logger.write_event(Level::Info, "second", now_iso(), fields));
    let retained = budget.retained.load(Ordering::Relaxed);
    assert!(retained <= 2048);
    assert!(!logger.write_event(Level::Error, "oversize", now_iso(), map(json!({ "detail": "x".repeat(4096) }))));
    assert_eq!(budget.retained.load(Ordering::Relaxed), retained);
    assert_eq!(budget.dropped.load(Ordering::Relaxed), 2);
    release.send(()).unwrap();
    drop(logger);
    writer.join().unwrap();
    assert_eq!(budget.retained.load(Ordering::Relaxed), 0);
}

#[test]
fn flush_is_bounded_when_an_admitted_control_message_waits_behind_a_blocked_sink() {
    let (logger, lines) = Logger::channel(session(None), true, 4096, 2);
    let budget = logger.budget.clone();
    let (entered, started) = mpsc::sync_channel(1);
    let (release, held) = mpsc::sync_channel(1);
    let writer = std::thread::spawn(move || run_messages(lines, &budget, |_, _, _, _| {
        entered.send(()).unwrap();
        held.recv().unwrap();
    }));
    assert!(logger.write_event(Level::Info, "held", now_iso(), Map::new()));
    started.recv_timeout(Duration::from_secs(10)).unwrap();
    let (finished, flushed) = mpsc::sync_channel(1);
    let caller = std::thread::spawn(move || {
        logger.flush();
        finished.send(()).unwrap();
    });
    // The sink remains blocked; this watchdog proves flush completes on its
    // own bound without imposing a sub-millisecond scheduling requirement.
    flushed.recv_timeout(Duration::from_secs(10)).unwrap();
    release.send(()).unwrap();
    caller.join().unwrap();
    writer.join().unwrap();
}

#[test]
fn disconnected_writer_never_uses_a_caller_thread_fallback() {
    let dir = tempfile::tempdir().unwrap();
    let (logger, lines) = Logger::channel(session(Some(dir.path())), true, 4096, 2);
    drop(lines);
    assert!(!logger.write_event(Level::Error, "disconnected", now_iso(), Map::new()));
    logger.flush();
    assert_eq!(logger.budget.retained.load(Ordering::Relaxed), 0);
    assert_eq!(logger.budget.dropped.load(Ordering::Relaxed), 1);
    assert!(fs::read_dir(dir.path()).unwrap().next().is_none());
}

#[test]
fn flush_reports_drops_even_without_an_admitted_event() {
    let (logger, lines) = Logger::channel(session(None), true, 1, 2);
    assert!(!logger.write_event(Level::Error, "oversize", now_iso(), Map::new()));
    let budget = logger.budget.clone();
    let thread = std::thread::spawn(move || {
        let mut output = Vec::new();
        run_messages(lines, &budget, |_, message, _, fields| output.push((message.to_owned(), fields.clone())));
        output
    });
    logger.flush();
    drop(logger);
    let output = thread.join().unwrap();
    assert_eq!(output.len(), 1);
    assert_eq!(output[0].0, "log events dropped");
    assert_eq!(output[0].1["dropped"], json!(1));
}

#[test]
fn external_sqlite_lock_falls_back_on_writer_then_next_healthy_insert_works() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("records.sqlite3");
    let (logger, lines) = Logger::channel(session(Some(dir.path())), true, 64 * 1024, 8);
    let budget = logger.budget.clone();
    let thread_session = logger.session.clone();
    let writer_file = file.clone();
    let (stored, observed) = mpsc::channel();
    let writer = std::thread::spawn(move || run_writer(Ok(writer_file), thread_session, lines, budget,
        || { stored.send(()).unwrap(); }));
    assert!(logger.write_event(Level::Info, "before lock", now_iso(), Map::new()));
    observed.recv_timeout(Duration::from_secs(10)).unwrap();
    let external = Connection::open(&file).unwrap();
    external.execute_batch("BEGIN IMMEDIATE").unwrap();
    assert!(logger.write_event(Level::Error, "while locked", now_iso(), map(json!({ "detail": "retained" }))));
    let (done, written) = mpsc::sync_channel(1);
    assert!(logger.writer.try_send(Message::Flush(done)).is_ok());
    written.recv_timeout(Duration::from_secs(10)).unwrap();
    let fallback = fs::read_to_string(dir.path().join("logs/20260101-000000-000-utc.log")).unwrap();
    assert!(fallback.contains("while locked"));
    assert!(fallback.contains("retained"));
    external.execute_batch("ROLLBACK").unwrap();
    assert!(logger.write_event(Level::Info, "after lock", now_iso(), Map::new()));
    observed.recv_timeout(Duration::from_secs(10)).unwrap();
    drop(logger);
    writer.join().unwrap();
    let messages = external.prepare("SELECT message FROM log_lines ORDER BY id").unwrap()
        .query_map([], |row| row.get::<_, String>(0)).unwrap().collect::<Result<Vec<_>, _>>().unwrap();
    assert_eq!(messages, ["before lock", "after lock"]);
}

#[test]
fn admission_accounts_for_nested_string_and_array_spare_capacity() {
    let (logger, lines) = Logger::channel(session(None), true, 1024, 4);
    let mut text = String::with_capacity(4096);
    text.push_str("short");
    let mut fields = Map::new();
    fields.insert("nested".into(), Value::Array(vec![Value::String(text)]));
    assert!(!logger.write_event(Level::Error, "string capacity", now_iso(), fields));
    let mut array = Vec::with_capacity(128);
    array.push(Value::Null);
    let mut fields = Map::new();
    fields.insert("nested".into(), Value::Array(vec![Value::Array(array)]));
    assert!(!logger.write_event(Level::Error, "array capacity", now_iso(), fields));
    assert!(matches!(lines.try_recv(), Err(mpsc::TryRecvError::Empty)));
    assert_eq!(logger.budget.retained.load(Ordering::Relaxed), 0);
    assert_eq!(logger.budget.dropped.load(Ordering::Relaxed), 2);
}
