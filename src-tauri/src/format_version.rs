//! Every store's format version, held here and nowhere else
//! (store-recovery-conventions). A JSON store records its version as a
//! top-level `formatVersion`, a SQLite store as `PRAGMA user_version`. A store
//! without its marker is unreadable and takes its store's unreadable branch. A
//! store recorded in a newer format than this build's is intact data this build
//! cannot read: its caller reports it by name and leaves it exactly in place.

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
    /// This build reads it: the store's fields, the marker removed. Only an
    /// object can carry a marker, so a readable store is always one.
    Readable(Map<String, JsonValue>),
    /// Recorded in this newer format.
    Newer(u32),
}

/// Checks a parsed JSON store's marker against `ours` and removes it. A missing
/// marker, or one that is not a positive integer, leaves the file unreadable.
pub fn read_json(value: JsonValue, ours: u32) -> Result<JsonFormat, String> {
    let JsonValue::Object(mut fields) = value else {
        return Err(format!("{JSON_KEY} is missing: the store is not an object"));
    };
    let marker = fields
        .shift_remove(JSON_KEY)
        .ok_or_else(|| format!("{JSON_KEY} is missing"))?;
    let recorded = marker
        .as_u64()
        .and_then(|version| u32::try_from(version).ok())
        .filter(|version| *version >= 1)
        .ok_or_else(|| format!("{JSON_KEY} is not a positive integer: {marker}"))?;
    Ok(if recorded > ours {
        JsonFormat::Newer(recorded)
    } else {
        JsonFormat::Readable(fields)
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

/// What a SQLite store's marker says, read before anything writes to it.
#[derive(Debug, PartialEq, Eq)]
pub enum SqliteFormat {
    /// A new, empty database: `create_sqlite` gives it its schema and marker.
    New,
    /// Recorded in a format this build reads.
    Readable,
    /// Recorded in this newer format: the caller leaves it untouched.
    Newer(u32),
}

/// Reads a SQLite store's marker. A database that already holds tables but
/// records none (SQLite's default, 0) is unreadable. Reads only, so a read-only
/// connection can ask too.
pub fn check_sqlite(conn: &Connection, file: &str, ours: u32) -> Result<SqliteFormat, String> {
    // One statement, so both come from the same snapshot: another connection's
    // first open cannot commit its tables and marker between the two reads.
    let (recorded, tables): (i64, i64) = conn
        .query_row(
            "select (select user_version from pragma_user_version),
                    (select count(*) from sqlite_master)",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|error| error.to_string())?;
    if recorded == 0 {
        return match tables {
            0 => Ok(SqliteFormat::New),
            _ => Err(format!("{file} records no format version")),
        };
    }
    let recorded = u32::try_from(recorded)
        .map_err(|_| format!("{file} records an invalid format version: {recorded}"))?;
    Ok(if recorded > ours {
        SqliteFormat::Newer(recorded)
    } else {
        SqliteFormat::Readable
    })
}

/// Gives a new database its schema and marker in one transaction, so no other
/// connection sees its tables without the marker; a first open racing this one
/// finds them already made. Runs after the journal mode is set, which a
/// transaction cannot change.
pub fn create_sqlite(conn: &Connection, schema: &str, ours: u32) -> rusqlite::Result<()> {
    conn.execute_batch("BEGIN IMMEDIATE")?;
    let created = conn
        .execute_batch(schema)
        .and_then(|()| conn.pragma_update(None, "user_version", ours));
    conn.execute_batch(if created.is_ok() {
        "COMMIT"
    } else {
        "ROLLBACK"
    })?;
    created
}

/// The diagnostic a store in a newer format is reported with.
pub fn newer_message(file: &str, recorded: u32) -> String {
    format!("{file} was written by a newer QuickDeck (format {recorded}) and is left in place")
}
