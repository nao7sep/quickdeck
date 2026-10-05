//! Every store's format version, held here and nowhere else
//! (store-recovery-conventions). A JSON store records its version as a
//! top-level `formatVersion`, a SQLite store as `PRAGMA user_version`, and a
//! missing marker reads as 1. A store recorded in a newer format than this
//! build's is intact data this build cannot read: its caller reports it by name
//! and leaves it exactly in place.

use rusqlite::Connection;
use serde_json::{Map, Value as JsonValue};

pub const CONFIG: u32 = 1;
pub const STATE: u32 = 1;
pub const WINDOW: u32 = 1;
pub const PANES: u32 = 1;
pub const SNAPSHOTS: u32 = 1;
pub const BACKUPS: u32 = 1;
pub const RECORDS: u32 = 1;
pub const ARCHIVE_MANIFEST: u32 = 1;

pub const JSON_KEY: &str = "formatVersion";

/// A parsed JSON store, its marker checked against this build's format.
#[derive(Debug, PartialEq)]
pub enum JsonFormat {
    /// This build reads it; the marker has been removed.
    Readable(JsonValue),
    /// Recorded in this newer format.
    Newer(u32),
}

/// Checks a parsed JSON store's marker against `ours` and removes it. A marker
/// that is not a positive integer leaves the file unreadable.
pub fn read_json(mut value: JsonValue, ours: u32) -> Result<JsonFormat, String> {
    let recorded = match value
        .as_object_mut()
        .and_then(|fields| fields.shift_remove(JSON_KEY))
    {
        None => 1,
        Some(marker) => marker
            .as_u64()
            .and_then(|version| u32::try_from(version).ok())
            .filter(|version| *version >= 1)
            .ok_or_else(|| format!("{JSON_KEY} is not a positive integer: {marker}"))?,
    };
    Ok(if recorded > ours {
        JsonFormat::Newer(recorded)
    } else {
        JsonFormat::Readable(value)
    })
}

/// `value` as a JSON store writes it: `ours` recorded as its first key.
pub fn stamp_json(value: &JsonValue, ours: u32) -> Result<JsonValue, String> {
    let fields = value
        .as_object()
        .ok_or("a JSON store's content is not an object")?;
    let mut stamped = Map::with_capacity(fields.len() + 1);
    stamped.insert(JSON_KEY.to_string(), JsonValue::from(ours));
    for (key, field) in fields {
        if key != JSON_KEY {
            stamped.insert(key.clone(), field.clone());
        }
    }
    Ok(JsonValue::Object(stamped))
}

/// `Some(recorded)` when a SQLite store's recorded format is newer than `ours`,
/// and the caller then leaves it untouched. Reads only: a writing connection asks
/// before anything it does writes, and a read-only one can ask too.
pub fn newer_sqlite(conn: &Connection, ours: u32) -> rusqlite::Result<Option<u32>> {
    let recorded = recorded_sqlite(user_version(conn)?);
    Ok((recorded > ours).then_some(recorded))
}

/// Records `ours` in a store with no marker yet, a new one included. Run once the
/// store's own setup is done, so in WAL: a rollback-journal write racing another
/// first open can fail with SQLITE_BUSY instead of waiting for the lock.
pub fn mark_sqlite(conn: &Connection, ours: u32) -> rusqlite::Result<()> {
    if user_version(conn)? == 0 {
        conn.pragma_update(None, "user_version", ours)?;
    }
    Ok(())
}

/// The diagnostic a store in a newer format is reported with.
pub fn newer_message(file: &str, recorded: u32) -> String {
    format!("{file} was written by a newer QuickDeck (format {recorded}) and is left in place")
}

fn user_version(conn: &Connection) -> rusqlite::Result<i64> {
    conn.pragma_query_value(None, "user_version", |row| row.get(0))
}

// SQLite's own default, 0, is a missing marker.
fn recorded_sqlite(raw: i64) -> u32 {
    u32::try_from(raw)
        .ok()
        .filter(|version| *version >= 1)
        .unwrap_or(1)
}
