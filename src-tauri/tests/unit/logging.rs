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
fn only_info_is_buffered() {
    assert!(!Level::Info.flush_immediately());
    assert!(Level::Warn.flush_immediately());
    assert!(Level::Error.flush_immediately());
    assert!(Level::Debug.flush_immediately());
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
        line.starts_with(
            r#"{"time":"2026-01-01T00:00:00.000Z","level":"info","message":"hello""#
        ),
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

#[test]
fn write_line_appends_lines_to_a_real_file() {
    use std::io::Read;

    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("session.log");
    {
        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .unwrap();
        let mut sink = Sink::File(BufWriter::new(file));
        // First line buffered (info), second flushed immediately (warn);
        // the flush also pushes the buffered line, so both reach disk.
        write_line(&mut sink, "{\"a\":1}\n", false);
        write_line(&mut sink, "{\"b\":2}\n", true);
    }

    let mut contents = String::new();
    File::open(&path)
        .unwrap()
        .read_to_string(&mut contents)
        .unwrap();
    assert_eq!(contents, "{\"a\":1}\n{\"b\":2}\n");
}
