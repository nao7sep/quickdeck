//! Per-session, append-only, JSON-Lines session logger.
//!
//! One file per process launch under `~/.quickdeck/logs/<yyyymmdd-hhmmss-fff-utc>.log`.
//! The privileged Rust core owns the file; the sandboxed webview forwards
//! structured log objects via the `log_event` command (see `lib.rs`). Each line
//! is one JSON object with a fixed envelope (`time`, `level`, `message`) plus
//! free fields. Hand-rolled on purpose so flush, level-gating, redaction, and
//! console fallback behave exactly as the logging convention prescribes.

use std::{
    collections::HashSet,
    fs::{File, OpenOptions},
    io::{BufWriter, Write},
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

// Formats `now` as the session-log filename stem: `yyyymmdd-hhmmss-fff-utc`, the
// machine-paced millisecond form (see timestamp-conventions). Pure and
// injectable so the shape is unit-testable without spinning up an AppHandle.
// pub(crate): also the moment discriminator for other derived-sibling names
// (storage's quarantine `<stem>-<stamp>.invalid`) — one formatter, never two.
pub(crate) fn session_stamp(now: chrono::DateTime<Utc>) -> String {
    format!("{}-{:03}-utc", now.format("%Y%m%d-%H%M%S"), now.timestamp_subsec_millis())
}

fn open_session_file(app: &AppHandle) -> Result<File, String> {
    // not recorded: session logs under logs/ are append-mode and never written
    // through the managed-text atomic path, so they never reach the backup record
    // hook — excluded by construction (data-backup conventions). They are runtime
    // logs, not user data.
    let dir = paths::logs_dir(app)?;
    // UTC session-start stamp and nothing else — strictly `yyyymmdd-hhmmss-fff-utc.log`
    // (see timestamp-conventions). `create_new` so a launch never appends into an
    // existing file; a same-millisecond collision between two launches is
    // accepted, not engineered around — the create simply fails and `init`
    // degrades to stderr.
    let stamp = session_stamp(Utc::now());
    let path = dir.join(format!("{stamp}.log"));
    OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&path)
        .map_err(|err| format!("{}: {}", path.display(), err))
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

// A single Rust-side warning. Used by the write-through backup store (backup_store.rs)
// to log its one best-effort failure line — the store must never surface an error,
// so it logs exactly one `warn` and swallows the rest. `fields` is any JSON object
// (a non-object payload is wrapped, never lost); the timestamp is stamped here.
pub fn warn(message: &str, fields: Value) {
    write_event(Level::Warn, message, now_iso(), into_map(fields));
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
// EXCEPTION to tests-folder conventions: the module is private to the crate, and the tests drive
// the private `Sink`, `Level` and `build_line`.
#[path = "../tests/unit/logging.rs"]
mod tests;
