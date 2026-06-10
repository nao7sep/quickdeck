//! Per-session, append-only, JSON-Lines session logger.
//!
//! One file per process launch under `~/.quickdeck/logs/<yyyymmdd-hhmmss-utc>.log`.
//! The privileged Rust core owns the file; the sandboxed webview forwards
//! structured log objects via the `log_event` command (see `lib.rs`). Each line
//! is one JSON object with a fixed envelope (`time`, `level`, `message`) plus
//! free fields. Hand-rolled on purpose so flush, level-gating, redaction, and
//! console fallback behave exactly as the logging convention prescribes.

use std::{
    collections::HashSet,
    fs::{File, OpenOptions},
    io::{BufWriter, Write},
    path::Path,
    sync::{Mutex, OnceLock},
    time::Instant,
};

use chrono::{SecondsFormat, Utc};
use serde_json::{json, Map, Value};
use tauri::AppHandle;

use crate::paths;

// The four levels, and only four.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Level {
    Debug,
    Info,
    Warn,
    Error,
}

impl Level {
    fn as_str(self) -> &'static str {
        match self {
            Level::Debug => "debug",
            Level::Info => "info",
            Level::Warn => "warn",
            Level::Error => "error",
        }
    }

    // Parse liberally: an unrecognized level from a forwarded event still gets
    // recorded (as `info`) rather than dropped.
    fn parse(raw: &str) -> Level {
        match raw.trim().to_ascii_lowercase().as_str() {
            "debug" => Level::Debug,
            "warn" | "warning" => Level::Warn,
            "error" => Level::Error,
            _ => Level::Info,
        }
    }

    // info may stay buffered for efficiency; warn/error/debug flush immediately
    // so a line is on disk the moment you need it while debugging.
    fn flush_immediately(self) -> bool {
        !matches!(self, Level::Info)
    }
}

// File sink, or stderr when the file is unavailable (open failed, or a write
// failed mid-session). Either way the app keeps running.
enum Sink {
    File(BufWriter<File>),
    Stderr,
}

struct Logger {
    sink: Mutex<Sink>,
    // Denied field names, stored lowercased for exact case-insensitive matching.
    denied: HashSet<String>,
    debug_enabled: bool,
}

static LOGGER: OnceLock<Logger> = OnceLock::new();

// Upper bound on the per-launch filename-disambiguation retry (see
// create_unique_session_file). Reaching it means ~this many sessions already
// started in the same UTC second — far beyond anything real.
const MAX_SESSION_FILE_ATTEMPTS: u32 = 100;

// Seeded with the obvious secret-bearing names; extend here as needed.
fn default_denied_keys() -> HashSet<String> {
    ["apikey", "authorization", "token", "password", "secret"]
        .into_iter()
        .map(String::from)
        .collect()
}

// Opens this launch's session log, installs the panic hook, and writes the
// startup line. Safe to call once; later calls are ignored. Never fails the app:
// if the file cannot be opened the logger degrades to stderr.
pub fn init(app: &AppHandle, version: &str) {
    let debug_enabled = cfg!(debug_assertions)
        || std::env::var("QUICKDECK_DEBUG")
            .map(|value| value == "1")
            .unwrap_or(false);

    let sink = match open_session_file(app) {
        Ok(file) => Sink::File(BufWriter::new(file)),
        Err(err) => {
            // Best effort: surface the failure somewhere and keep going. Use a
            // non-panicking stderr write (not eprintln!, which panics on a
            // failed write — fatal on a no-console GUI build).
            let _ = writeln!(std::io::stderr(), "[quickdeck] log file unavailable, using stderr: {err}");
            Sink::Stderr
        }
    };

    let logger = Logger {
        sink: Mutex::new(sink),
        denied: default_denied_keys(),
        debug_enabled,
    };

    if LOGGER.set(logger).is_err() {
        return;
    }

    install_panic_hook();

    write_event(
        Level::Info,
        "startup",
        now_iso(),
        into_map(json!({
            "version": version,
            "build": if cfg!(debug_assertions) { "debug" } else { "release" },
            "debugEnabled": debug_enabled,
        })),
    );
}

fn open_session_file(app: &AppHandle) -> Result<File, String> {
    let dir = paths::logs_dir(app)?;
    // UTC session-start stamp and nothing else (see timestamp-conventions).
    let stamp = Utc::now().format("%Y%m%d-%H%M%S-utc").to_string();
    create_unique_session_file(&dir, &stamp)
}

// Creates a brand-new file for this launch — `create_new` (atomic exclusive
// create), so two launches in the same UTC second can never append into one
// another's session file. On the rare name clash it disambiguates with a numeric
// suffix (`<stamp>-2.log`, `<stamp>-3.log`, ...), preserving the one-file-per-
// launch invariant while keeping the plain stamp as the common case.
fn create_unique_session_file(dir: &Path, stamp: &str) -> Result<File, String> {
    for n in 1..=MAX_SESSION_FILE_ATTEMPTS {
        let name = if n == 1 {
            format!("{stamp}.log")
        } else {
            format!("{stamp}-{n}.log")
        };
        let path = dir.join(&name);
        match OpenOptions::new().create_new(true).write(true).open(&path) {
            Ok(file) => return Ok(file),
            Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(err) => return Err(format!("{}: {}", path.display(), err)),
        }
    }
    Err(format!(
        "could not create a unique session log in {} after {} attempts",
        dir.display(),
        MAX_SESSION_FILE_ATTEMPTS
    ))
}

// The authoritative debug gate, exposed so the command layer can hand the
// resolved value to the frontend (which gates its own debug calls to spare the
// IPC hop). The Rust writer enforces the gate regardless.
pub fn debug_enabled() -> bool {
    LOGGER
        .get()
        .map(|logger| logger.debug_enabled)
        .unwrap_or(cfg!(debug_assertions))
}

// --- Forwarded (webview) logging ----------------------------------------------

// Records an event forwarded from the frontend. The frontend stamps `time` at
// the event instant; we trust it when present and fall back to now otherwise.
// Returns nothing: logging must never surface an error back into the UI.
pub fn log_forwarded(
    level: &str,
    message: &str,
    time: Option<String>,
    fields: Option<Map<String, Value>>,
) {
    let time = match time {
        Some(value) if !value.is_empty() => value,
        _ => now_iso(),
    };
    write_event(Level::parse(level), message, time, fields.unwrap_or_default());
}

// Records the clean end of a session. Logged from the Rust run-loop on exit
// (see lib.rs) rather than the webview, so it cannot be lost to an in-flight IPC
// message racing the window teardown.
pub fn log_shutdown() {
    write_event(Level::Info, "shutdown", now_iso(), Map::new());
}

// --- Boundary instrumentation --------------------------------------------------

// Wraps an external-boundary operation (file / database / IPC command) with the
// standard logging: a `debug` line at the start, then exactly one `info` line on
// success or one `error` line on failure, each carrying the elapsed duration.
// This is what keeps "log every boundary crossing" to one info line per crossing.
pub fn boundary<T>(
    op: &str,
    params: Value,
    body: impl FnOnce() -> Result<T, String>,
    summarize: impl FnOnce(&T) -> Value,
) -> Result<T, String> {
    let started = Instant::now();

    let mut start_fields = into_map(params);
    start_fields.insert("op".to_string(), Value::String(op.to_string()));
    write_event(Level::Debug, "boundary start", now_iso(), start_fields);

    let result = body();
    let ms = started.elapsed().as_millis() as u64;

    match &result {
        Ok(value) => {
            let mut fields = into_map(summarize(value));
            fields.insert("op".to_string(), Value::String(op.to_string()));
            fields.insert("ms".to_string(), json!(ms));
            write_event(Level::Info, "boundary ok", now_iso(), fields);
        }
        Err(err) => {
            let mut fields = Map::new();
            fields.insert("op".to_string(), Value::String(op.to_string()));
            fields.insert("ms".to_string(), json!(ms));
            fields.insert("error".to_string(), Value::String(err.clone()));
            write_event(Level::Error, "boundary failed", now_iso(), fields);
        }
    }

    result
}

// --- Core write path -----------------------------------------------------------

fn write_event(level: Level, message: &str, time: String, fields: Map<String, Value>) {
    let Some(logger) = LOGGER.get() else {
        // Not initialized (e.g. a unit test in another module) — best effort: drop.
        return;
    };

    // Debug never reaches an end-user disk.
    if level == Level::Debug && !logger.debug_enabled {
        return;
    }

    let line = build_line(level, message, &time, fields, &logger.denied);
    if line.is_empty() {
        return;
    }
    let line = format!("{line}\n");

    let mut sink = match logger.sink.lock() {
        Ok(sink) => sink,
        Err(poisoned) => poisoned.into_inner(),
    };
    write_line(&mut sink, &line, level.flush_immediately());
}

// Pure: redact, then serialize one JSON line with the envelope first
// (time, level, message) followed by the free fields. serde_json's
// preserve_order feature keeps this insertion order in the output.
fn build_line(
    level: Level,
    message: &str,
    time: &str,
    mut fields: Map<String, Value>,
    denied: &HashSet<String>,
) -> String {
    redact_map(&mut fields, denied);

    let mut obj = Map::new();
    obj.insert("time".to_string(), Value::String(time.to_string()));
    obj.insert("level".to_string(), Value::String(level.as_str().to_string()));
    obj.insert("message".to_string(), Value::String(message.to_string()));
    for (key, value) in fields {
        // The envelope keys are authoritative: a free field must never overwrite
        // one — but it is never silently dropped either. A colliding field is
        // preserved under a suffixed name so no data is lost.
        if key == "time" || key == "level" || key == "message" {
            obj.insert(format!("{key}_"), value);
        } else {
            obj.insert(key, value);
        }
    }

    serde_json::to_string(&Value::Object(obj)).unwrap_or_default()
}

// Writes one already-serialized line. Runs while the caller holds the sink lock,
// so it must NEVER panic: the std print macros (eprint!/eprintln!) panic on a
// failed stderr write, which on a no-console GUI build would fire the panic hook
// on this same thread while the lock is held, re-enter it, and deadlock. All
// stderr output here therefore goes through non-panicking `write!`/`writeln!`
// whose Result is deliberately ignored.
fn write_line(sink: &mut Sink, line: &str, flush: bool) {
    let failed = match sink {
        Sink::File(writer) => {
            let result = writer
                .write_all(line.as_bytes())
                .and_then(|_| if flush { writer.flush() } else { Ok(()) });
            match result {
                Ok(()) => false,
                Err(err) => {
                    let _ = writeln!(
                        std::io::stderr(),
                        "[quickdeck] log write failed, switching to stderr: {err}"
                    );
                    true
                }
            }
        }
        Sink::Stderr => {
            let _ = write!(std::io::stderr(), "{line}");
            false
        }
    };

    // The file went bad mid-session: write this line to stderr and fall back to
    // stderr for everything after it.
    if failed {
        let _ = write!(std::io::stderr(), "{line}");
        *sink = Sink::Stderr;
    }
}

// Flushes buffered (info) lines. Called on app exit and from the panic hook so
// the last lines before shutdown or a crash reach disk.
pub fn flush() {
    if let Some(logger) = LOGGER.get() {
        let mut sink = match logger.sink.lock() {
            Ok(sink) => sink,
            Err(poisoned) => poisoned.into_inner(),
        };
        if let Sink::File(writer) = &mut *sink {
            let _ = writer.flush();
        }
    }
}

// --- Redaction -----------------------------------------------------------------

// Non-destructive, type-preserving redaction. Matches denied field names by
// exact, case-insensitive name (never substring), replaces only the matched
// value with "[redacted]", recurses into nested objects and arrays, never scans
// string contents, and cannot drop fields or throw.
fn redact(value: &mut Value, denied: &HashSet<String>) {
    match value {
        Value::Object(map) => redact_map(map, denied),
        Value::Array(items) => {
            for item in items {
                redact(item, denied);
            }
        }
        _ => {}
    }
}

fn redact_map(map: &mut Map<String, Value>, denied: &HashSet<String>) {
    for (key, value) in map.iter_mut() {
        if denied.contains(&key.to_ascii_lowercase()) {
            *value = Value::String("[redacted]".to_string());
        } else {
            redact(value, denied);
        }
    }
}

// --- Helpers -------------------------------------------------------------------

fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn into_map(value: Value) -> Map<String, Value> {
    match value {
        Value::Object(map) => map,
        Value::Null => Map::new(),
        // A non-object payload is wrapped so it is never silently lost.
        other => {
            let mut map = Map::new();
            map.insert("value".to_string(), other);
            map
        }
    }
}

fn install_panic_hook() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let location = info
            .location()
            .map(|loc| format!("{}:{}:{}", loc.file(), loc.line(), loc.column()))
            .unwrap_or_else(|| "unknown".to_string());
        let payload = if let Some(text) = info.payload().downcast_ref::<&str>() {
            (*text).to_string()
        } else if let Some(text) = info.payload().downcast_ref::<String>() {
            text.clone()
        } else {
            "non-string panic payload".to_string()
        };

        write_event(
            Level::Error,
            "panic",
            now_iso(),
            into_map(json!({ "payload": payload, "location": location })),
        );
        flush();
        previous(info);
    }));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn denied() -> HashSet<String> {
        default_denied_keys()
    }

    fn map(value: Value) -> Map<String, Value> {
        into_map(value)
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
    fn redact_replaces_matched_keys_case_insensitively() {
        let mut fields = map(json!({
            "Token": "abc",
            "PASSWORD": "hunter2",
            "apiKey": "sk-1",
            "user": "alice",
        }));
        redact_map(&mut fields, &denied());
        assert_eq!(fields["Token"], json!("[redacted]"));
        assert_eq!(fields["PASSWORD"], json!("[redacted]"));
        assert_eq!(fields["apiKey"], json!("[redacted]"));
        // Non-denied fields are untouched, byte-identical.
        assert_eq!(fields["user"], json!("alice"));
    }

    #[test]
    fn redact_never_matches_substrings() {
        let mut fields = map(json!({
            "tokenCount": 42,
            "broken": true,
            "passwordless": "ok",
        }));
        redact_map(&mut fields, &denied());
        assert_eq!(fields["tokenCount"], json!(42));
        assert_eq!(fields["broken"], json!(true));
        assert_eq!(fields["passwordless"], json!("ok"));
    }

    #[test]
    fn redact_recurses_objects_and_arrays() {
        let mut fields = map(json!({
            "outer": { "secret": "x", "keep": 1 },
            "list": [ { "token": "t" }, { "fine": "y" } ],
        }));
        redact_map(&mut fields, &denied());
        assert_eq!(fields["outer"]["secret"], json!("[redacted]"));
        assert_eq!(fields["outer"]["keep"], json!(1));
        assert_eq!(fields["list"][0]["token"], json!("[redacted]"));
        assert_eq!(fields["list"][1]["fine"], json!("y"));
    }

    #[test]
    fn build_line_starts_with_envelope_in_order() {
        let line = build_line(
            Level::Info,
            "hello",
            "2026-01-01T00:00:00.000Z",
            map(json!({ "op": "load" })),
            &denied(),
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
            &denied(),
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
    fn build_line_applies_redaction() {
        let line = build_line(
            Level::Error,
            "boom",
            "2026-01-01T00:00:00.000Z",
            map(json!({ "password": "p", "context": "save" })),
            &denied(),
        );
        let parsed: Value = serde_json::from_str(&line).unwrap();
        assert_eq!(parsed["password"], json!("[redacted]"));
        assert_eq!(parsed["context"], json!("save"));
    }

    #[test]
    fn build_line_emits_one_physical_line_for_multiline_values() {
        let line = build_line(
            Level::Info,
            "multi",
            "2026-01-01T00:00:00.000Z",
            map(json!({ "detail": "line one\nline two" })),
            &denied(),
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

    #[test]
    fn create_unique_session_file_never_reuses_an_existing_name() {
        let dir = tempfile::tempdir().unwrap();
        let stamp = "20260101-000000-utc";

        // Two launches resolving to the same second must get distinct files —
        // the second one must NOT append into the first session's file.
        let _first = create_unique_session_file(dir.path(), stamp).unwrap();
        let _second = create_unique_session_file(dir.path(), stamp).unwrap();

        let mut names: Vec<String> = std::fs::read_dir(dir.path())
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        assert_eq!(
            names,
            vec![
                "20260101-000000-utc-2.log".to_string(),
                "20260101-000000-utc.log".to_string(),
            ]
        );
    }
}
