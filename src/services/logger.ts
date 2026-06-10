import { invoke, isTauri } from "@tauri-apps/api/core";

// Thin frontend logging client. The sandboxed webview never opens a file; it
// forwards structured log objects to the Rust core (the `log_event` command),
// which owns the session file. Logging must never crash the app or surface into
// the UI, so every path here is best-effort and falls back to the console.

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogFields = Record<string, unknown>;

export type LogEvent = {
  time: string;
  level: LogLevel;
  message: string;
  fields: LogFields;
};

// The three fixed envelope keys. A free field must never silently overwrite or
// shadow one of these — see buildConsoleObject (frontend) and build_line (Rust),
// which both keep the envelope authoritative and preserve any colliding free
// field under a suffixed name.
const ENVELOPE_KEYS: ReadonlySet<string> = new Set(["time", "level", "message"]);

// Field names whose values are replaced before a line is written. Mirror of the
// Rust denied set in src-tauri/src/logging.rs — kept in sync deliberately, since
// each writer (the Rust file sink, this console fallback) redacts its own output.
const REDACTED_KEYS: ReadonlySet<string> = new Set([
  "apikey",
  "authorization",
  "token",
  "password",
  "secret",
]);

// Cause chains are short in practice; this only bounds pathological input.
const MAX_CAUSE_DEPTH = 16;

// Debug is developer-only. Default to the dev build; the authoritative gate is
// Rust (cfg!(debug_assertions) || QUICKDECK_DEBUG=1), pushed in via
// setDebugEnabled once load_app_data returns. Gating here only spares the IPC
// hop for debug lines in release — the Rust writer enforces the gate regardless.
let debugEnabled: boolean = import.meta.env.DEV;

export function setDebugEnabled(value: boolean): void {
  debugEnabled = value;
}

// Pure: turns any thrown value into a structured field set capturing the error's
// type, message, stack, and full cause chain — not just `.message`. The result
// is meant to live under a single `error` field (never spread at the top level,
// where its `message` would collide with the envelope). The cause walk is
// guarded against cycles and runaway depth so logging an error can never
// overflow the stack.
export function serializeError(error: unknown): LogFields {
  return serializeErrorInner(error, new WeakSet<object>(), 0);
}

function serializeErrorInner(error: unknown, seen: WeakSet<object>, depth: number): LogFields {
  if (error instanceof Error) {
    if (seen.has(error) || depth >= MAX_CAUSE_DEPTH) {
      return { name: error.name, message: error.message, truncated: true };
    }
    seen.add(error);
    const result: LogFields = { name: error.name, message: error.message };
    if (error.stack) {
      result.stack = error.stack;
    }
    if (error.cause !== undefined) {
      result.cause = serializeErrorInner(error.cause, seen, depth + 1);
    }
    return result;
  }
  // Non-Error throwables (strings, plain objects) — record without inventing
  // structure that isn't there.
  return { value: String(error) };
}

// Pure: assembles the envelope. `time` is the canonical internal form (UTC
// ISO-8601 with milliseconds and `Z`) — exactly what Date.toISOString() emits.
export function buildLogEvent(level: LogLevel, message: string, fields?: LogFields): LogEvent {
  return {
    time: new Date().toISOString(),
    level,
    message,
    fields: fields ?? {},
  };
}

// Non-destructive, type-preserving redaction: replaces the value of any field
// whose name matches REDACTED_KEYS (exact, case-insensitive), recurses through
// nested objects and arrays, and never scans string contents. Mirrors the Rust
// redactor's contract for the console sink.
function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactValue);
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      out[key] = REDACTED_KEYS.has(key.toLowerCase()) ? "[redacted]" : redactValue(inner);
    }
    return out;
  }
  return value;
}

// Pure: the flattened, redacted object a console line carries — envelope first,
// then the free fields, with any field colliding with an envelope key preserved
// under a suffixed name. Mirrors the Rust build_line shape so the console and
// file sinks agree on every event.
export function buildConsoleObject(event: LogEvent): Record<string, unknown> {
  const redacted = redactValue(event.fields) as LogFields;
  const out: Record<string, unknown> = {
    time: event.time,
    level: event.level,
    message: event.message,
  };
  for (const [key, value] of Object.entries(redacted)) {
    out[ENVELOPE_KEYS.has(key) ? `${key}_` : key] = value;
  }
  return out;
}

function consoleFallback(event: LogEvent): void {
  const payload = buildConsoleObject(event);
  switch (event.level) {
    case "error":
      console.error(payload);
      break;
    case "warn":
      console.warn(payload);
      break;
    case "debug":
      console.debug(payload);
      break;
    default:
      console.info(payload);
  }
}

function dispatch(event: LogEvent): void {
  if (event.level === "debug" && !debugEnabled) {
    return;
  }

  if (!isTauri()) {
    // Browser preview (no Rust core): the console is the only sink available.
    consoleFallback(event);
    return;
  }

  void invoke("log_event", {
    level: event.level,
    message: event.message,
    time: event.time,
    fields: event.fields,
  }).catch((forwardError) => {
    // The file logger is unreachable from here, so the console is the last
    // place left to surface both the event and why it could not be forwarded.
    consoleFallback(event);
    consoleFallback(buildLogEvent("error", "log forward failed", { error: serializeError(forwardError) }));
  });
}

export function logDebug(message: string, fields?: LogFields): void {
  dispatch(buildLogEvent("debug", message, fields));
}

export function logInfo(message: string, fields?: LogFields): void {
  dispatch(buildLogEvent("info", message, fields));
}

export function logWarn(message: string, fields?: LogFields): void {
  dispatch(buildLogEvent("warn", message, fields));
}

export function logError(message: string, fields?: LogFields): void {
  dispatch(buildLogEvent("error", message, fields));
}
