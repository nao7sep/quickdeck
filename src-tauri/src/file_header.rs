//! Every store's identity header, built and checked here and nowhere else
//! (file-identity and store-recovery conventions). The header names the format
//! (`format`: owner, kind, version) and the program that wrote this copy
//! (`writer`: name, version). A JSON store holds it as its first two keys; a
//! SQLite store holds the version as `PRAGMA user_version` and the rest as rows
//! of a `file_header` table.
//!
//! A store is accepted or refused on `format` alone: one that lacks it, holds it
//! malformed, or names another owner or kind is unreadable and takes its
//! store's unreadable branch. A store recorded in a newer version than this
//! build's is intact data this build cannot read: its caller reports it by name
//! and leaves it exactly in place. `writer` is written on every save and never
//! read: nothing here parses, checks or reports it.

use rusqlite::Connection;
use serde_json::{Map, Value as JsonValue};

/// The product every QuickDeck file belongs to.
pub const OWNER: &str = "quickdeck";

/// The package that serializes every QuickDeck file, and its release.
pub const WRITER_NAME: &str = env!("CARGO_PKG_NAME");
pub const WRITER_VERSION: &str = env!("CARGO_PKG_VERSION");

/// One of QuickDeck's formats: which file it is and the version this build reads
/// and writes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Format {
    pub kind: &'static str,
    pub version: u32,
}

pub const CONFIG: Format = Format {
    kind: "config",
    version: 1,
};
pub const STATE: Format = Format {
    kind: "state",
    version: 1,
};
pub const WINDOW: Format = Format {
    kind: "window",
    version: 1,
};
pub const PANES: Format = Format {
    kind: "panes",
    version: 1,
};
pub const SNAPSHOTS: Format = Format {
    kind: "snapshots",
    version: 1,
};
pub const BACKUPS: Format = Format {
    kind: "backups",
    version: 1,
};
pub const RECORDS: Format = Format {
    kind: "records",
    version: 1,
};

pub const FORMAT_KEY: &str = "format";
pub const WRITER_KEY: &str = "writer";

/// A parsed JSON store, its header checked against `ours`.
#[derive(Debug, PartialEq)]
pub enum JsonFormat {
    /// This build reads it: the store's content, the header removed. Only an
    /// object can carry a header, so a readable store is always one.
    Readable(Map<String, JsonValue>),
    /// Recorded in this newer version.
    Newer(u32),
}

/// Checks a parsed JSON store's `format` against `ours` and removes the header.
/// `writer` is dropped unread.
pub fn read_json(value: JsonValue, ours: Format) -> Result<JsonFormat, String> {
    let JsonValue::Object(mut fields) = value else {
        return Err(format!(
            "{FORMAT_KEY} is missing: the store is not an object"
        ));
    };
    let format = fields
        .shift_remove(FORMAT_KEY)
        .ok_or_else(|| format!("{FORMAT_KEY} is missing"))?;
    fields.shift_remove(WRITER_KEY);
    let JsonValue::Object(format) = format else {
        return Err(format!("{FORMAT_KEY} is not an object: {format}"));
    };
    let text = |key: &str| {
        format
            .get(key)
            .and_then(JsonValue::as_str)
            .ok_or_else(|| format!("{FORMAT_KEY}.{key} is missing or not a string"))
    };
    let recorded = check_identity(text("owner")?, text("kind")?, ours).and_then(|()| {
        let version = format.get("version").unwrap_or(&JsonValue::Null);
        version
            .as_u64()
            .and_then(|version| u32::try_from(version).ok())
            .filter(|version| *version >= 1)
            .ok_or_else(|| format!("{FORMAT_KEY}.version is not a positive integer: {version}"))
    })?;
    Ok(if recorded > ours.version {
        JsonFormat::Newer(recorded)
    } else {
        JsonFormat::Readable(fields)
    })
}

/// `value` as a JSON store writes it: `format` and `writer` as its first two
/// keys, then the content.
pub fn stamp_json(value: &JsonValue, ours: Format) -> Result<JsonValue, String> {
    let fields = value
        .as_object()
        .ok_or("a JSON store's content is not an object")?;
    let mut stamped = Map::with_capacity(fields.len() + 2);
    stamped.insert(
        FORMAT_KEY.to_string(),
        serde_json::json!({ "owner": OWNER, "kind": ours.kind, "version": ours.version }),
    );
    stamped.insert(
        WRITER_KEY.to_string(),
        serde_json::json!({ "name": WRITER_NAME, "version": WRITER_VERSION }),
    );
    for (key, field) in fields {
        if key != FORMAT_KEY && key != WRITER_KEY {
            stamped.insert(key.clone(), field.clone());
        }
    }
    Ok(JsonValue::Object(stamped))
}

fn check_identity(owner: &str, kind: &str, ours: Format) -> Result<(), String> {
    if owner != OWNER {
        return Err(format!("{FORMAT_KEY}.owner is {owner}, not {OWNER}"));
    }
    if kind != ours.kind {
        return Err(format!("{FORMAT_KEY}.kind is {kind}, not {}", ours.kind));
    }
    Ok(())
}

/// What a SQLite store's header says, read before anything writes to it.
#[derive(Debug, PartialEq, Eq)]
pub enum SqliteFormat {
    /// A new, empty database: `prepare_sqlite` gives it its schema and header.
    New,
    /// Recorded in a version this build reads.
    Readable,
    /// Recorded in this newer version: the caller leaves it untouched.
    Newer(u32),
}

/// Reads a SQLite store's header. A database that already holds tables but no
/// `file_header` table, no recorded version (SQLite's default, 0), or another
/// owner or kind is unreadable. Reads only, so a read-only connection can ask
/// too.
pub fn check_sqlite(conn: &Connection, file: &str, ours: Format) -> Result<SqliteFormat, String> {
    // One statement, so all three come from the same snapshot: another
    // connection's first open cannot commit its tables and header between the
    // reads. Once `file_header` is visible its format rows are too, since the
    // table and its rows are created in one transaction.
    let (recorded, tables, has_header): (i64, i64, bool) = conn
        .query_row(
            "select (select user_version from pragma_user_version),
                    (select count(*) from sqlite_master),
                    exists (select 1 from sqlite_master
                            where type = 'table' and name = 'file_header')",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|error| error.to_string())?;
    if recorded == 0 && tables == 0 {
        return Ok(SqliteFormat::New);
    }
    if !has_header {
        return Err(format!("{file} has no file header"));
    }
    let row = |key: &str| {
        conn.query_row(
            "select value from file_header where key = ?1",
            [key],
            |row| row.get::<_, String>(0),
        )
        .map_err(|error| format!("{file} has no readable {key}: {error}"))
    };
    check_identity(&row("format.owner")?, &row("format.kind")?, ours)
        .map_err(|reason| format!("{file}: {reason}"))?;
    let recorded = u32::try_from(recorded)
        .ok()
        .filter(|version| *version >= 1)
        .ok_or_else(|| format!("{file} records an invalid format version: {recorded}"))?;
    Ok(if recorded > ours.version {
        SqliteFormat::Newer(recorded)
    } else {
        SqliteFormat::Readable
    })
}

/// What opening a SQLite store for writing found.
#[derive(Debug, PartialEq, Eq)]
pub enum SqliteOpen {
    /// Ready for the caller's work: its header is this build's.
    Ready,
    /// Recorded in this newer version and left untouched.
    Newer(u32),
}

/// Checks a store opened for writing and makes it ready. A new database gets WAL
/// and then its schema and header in one transaction, so no other connection
/// sees its tables without the header; a first open racing this one finds them
/// already made. A readable one has its writer rows rewritten. A store this
/// build cannot read is left exactly as it is.
pub fn prepare_sqlite(
    conn: &Connection,
    file: &str,
    ours: Format,
    schema: &str,
) -> Result<SqliteOpen, String> {
    let to_string = |error: rusqlite::Error| error.to_string();
    match check_sqlite(conn, file, ours)? {
        SqliteFormat::Newer(recorded) => return Ok(SqliteOpen::Newer(recorded)),
        // The journal mode is set first, since a transaction cannot change it.
        SqliteFormat::New => conn
            .pragma_update(None, "journal_mode", "WAL")
            .and_then(|_| in_transaction(conn, |conn| create_sqlite(conn, schema, ours)))
            .map_err(to_string)?,
        SqliteFormat::Readable => in_transaction(conn, write_writer_rows).map_err(to_string)?,
    }
    Ok(SqliteOpen::Ready)
}

fn create_sqlite(conn: &Connection, schema: &str, ours: Format) -> rusqlite::Result<()> {
    conn.execute_batch(schema)?;
    conn.execute_batch(
        "create table if not exists file_header (key text primary key, value text not null);",
    )?;
    conn.execute(
        "insert or replace into file_header (key, value)
         values ('format.owner', ?1), ('format.kind', ?2)",
        [OWNER, ours.kind],
    )?;
    write_writer_rows(conn)?;
    conn.pragma_update(None, "user_version", ours.version)
}

// Replaces every writer row, so a caller row an earlier writer left cannot
// outlive the copy it described.
fn write_writer_rows(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute("delete from file_header where key like 'writer.%'", [])?;
    conn.execute(
        "insert into file_header (key, value) values ('writer.name', ?1), ('writer.version', ?2)",
        [WRITER_NAME, WRITER_VERSION],
    )?;
    Ok(())
}

fn in_transaction(
    conn: &Connection,
    work: impl FnOnce(&Connection) -> rusqlite::Result<()>,
) -> rusqlite::Result<()> {
    conn.execute_batch("BEGIN IMMEDIATE")?;
    let done = work(conn);
    conn.execute_batch(if done.is_ok() { "COMMIT" } else { "ROLLBACK" })?;
    done
}

/// The diagnostic a store in a newer format is reported with.
pub fn newer_message(file: &str, recorded: u32) -> String {
    format!("{file} was written by a newer QuickDeck (format {recorded}) and is left in place")
}
