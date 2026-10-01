use quickdeck_lib::archive::{
    archive_stores, finish_session, prepare_session, start_session, ArchiveRun,
};
use rusqlite::Connection;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File},
    io::Read,
    path::Path,
    sync::mpsc,
    time::Duration,
};
use zip::{CompressionMethod, ZipArchive};

fn database(root: &Path) -> Connection {
    let connection = Connection::open(root.join("snapshots.sqlite3")).unwrap();
    connection
        .execute_batch("PRAGMA journal_mode=WAL; CREATE TABLE text(value TEXT);")
        .unwrap();
    connection
}

fn zips(root: &Path) -> Vec<std::path::PathBuf> {
    let mut paths = fs::read_dir(root.join("backups"))
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .filter(|path| path.extension().is_some_and(|extension| extension == "zip"))
        .collect::<Vec<_>>();
    paths.sort();
    paths
}

#[test]
fn copies_live_wal_bytes_consistently_hashes_them_and_deduplicates() {
    let root = tempfile::tempdir().unwrap();
    let connection = database(root.path());
    connection
        .execute("INSERT INTO text VALUES ('saved in WAL')", [])
        .unwrap();
    assert!(archive_stores(root.path()).unwrap());
    assert!(!archive_stores(root.path()).unwrap());
    let paths = zips(root.path());
    assert_eq!(paths.len(), 1);
    let mut zip = ZipArchive::new(File::open(&paths[0]).unwrap()).unwrap();
    assert_eq!(zip.len(), 2);
    let mut bytes = Vec::new();
    let mut entry = zip.by_name("snapshots.sqlite3").unwrap();
    assert_eq!(entry.compression(), CompressionMethod::Deflated);
    entry.read_to_end(&mut bytes).unwrap();
    drop(entry);
    let mut manifest = String::new();
    zip.by_name("manifest.json")
        .unwrap()
        .read_to_string(&mut manifest)
        .unwrap();
    let manifest: Value = serde_json::from_str(&manifest).unwrap();
    let hash: String = Sha256::digest(&bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    assert_eq!(manifest["entries"][0]["hash"], hash);
    assert_eq!(
        manifest["entries"][0]["originalPath"],
        root.path()
            .join("snapshots.sqlite3")
            .to_string_lossy()
            .as_ref()
    );
    fs::write(root.path().join("restored.sqlite3"), bytes).unwrap();
    let restored = Connection::open(root.path().join("restored.sqlite3")).unwrap();
    let value: String = restored
        .query_row("SELECT value FROM text", [], |row| row.get(0))
        .unwrap();
    assert_eq!(value, "saved in WAL");
    assert_eq!(
        fs::read_dir(root.path().join("backups")).unwrap().count(),
        1,
        "a written run leaves only its archive: no lock, temporary copy, or SQLite sidecar"
    );
}

#[test]
fn exclusive_lock_skips_without_removing_another_writers_lock() {
    let root = tempfile::tempdir().unwrap();
    let directory = root.path().join("backups");
    fs::create_dir_all(&directory).unwrap();
    fs::write(directory.join(".lock"), []).unwrap();
    assert!(!archive_stores(root.path()).unwrap());
    assert!(directory.join(".lock").exists());
    assert!(zips(root.path()).is_empty());
}

#[test]
fn a_missing_store_creates_neither_an_empty_database_nor_a_manifest_only_archive() {
    let root = tempfile::tempdir().unwrap();
    assert!(!archive_stores(root.path()).unwrap());
    assert!(!root.path().join("snapshots.sqlite3").exists());
    assert!(
        fs::read_dir(root.path().join("backups"))
            .unwrap()
            .next()
            .is_none(),
        "an empty run leaves no archive, lock, or temporary file"
    );
}

#[test]
fn an_unreadable_store_is_preserved_and_produces_no_archive() {
    let root = tempfile::tempdir().unwrap();
    let source = root.path().join("snapshots.sqlite3");
    fs::write(&source, b"not a SQLite database").unwrap();
    assert!(!archive_stores(root.path()).unwrap());
    assert_eq!(fs::read(&source).unwrap(), b"not a SQLite database");
    assert!(
        fs::read_dir(root.path().join("backups"))
            .unwrap()
            .next()
            .is_none(),
        "a skipped run cleans up its lock and temporary files"
    );
}

#[test]
fn clean_exit_returns_after_the_archive_is_complete_and_the_marker_is_removed() {
    let root = tempfile::tempdir().unwrap();
    database(root.path());
    let launch = start_session(root.path().to_owned());
    assert!(launch.join(Duration::from_secs(5)));
    finish_session(root.path().to_owned(), &launch);

    let paths = zips(root.path());
    assert_eq!(paths.len(), 1);
    let mut zip = ZipArchive::new(File::open(&paths[0]).unwrap()).unwrap();
    assert!(zip.by_name("snapshots.sqlite3").is_ok());
    assert!(zip.by_name("manifest.json").is_ok());
    assert!(!root.path().join("backups/.running").exists());
    assert!(!root.path().join("backups/.lock").exists());
}

#[test]
fn clean_exit_archives_and_clears_the_marker_and_unclean_launch_recovers_once() {
    let root = tempfile::tempdir().unwrap();
    database(root.path());
    prepare_session(root.path()).unwrap();
    assert!(zips(root.path()).is_empty());
    let directory = root.path().join("backups");
    assert!(directory.join(".running").exists());
    fs::write(directory.join(".lock"), []).unwrap();
    let leftovers = [
        "interrupted.tmp",
        "interrupted.tmp-journal",
        "interrupted.tmp-wal",
        "interrupted.tmp-shm",
    ];
    for name in leftovers {
        fs::write(directory.join(name), []).unwrap();
    }
    let launch = start_session(root.path().to_owned());
    assert!(launch.join(Duration::from_secs(5)));
    assert_eq!(zips(root.path()).len(), 1);
    for name in leftovers {
        assert!(!directory.join(name).exists(), "{name}");
    }
    assert!(!directory.join(".lock").exists());
    finish_session(root.path().to_owned(), &launch);
    assert!(!directory.join(".running").exists());
    assert_eq!(zips(root.path()).len(), 1);
}

#[test]
fn a_wait_past_its_bound_gives_up_while_the_run_goes_on() {
    let (release, stalled) = mpsc::channel::<()>();
    let run = ArchiveRun::spawn(move || {
        let _ = stalled.recv();
    });
    assert!(!run.join(Duration::from_millis(50)));
    release.send(()).unwrap();
    assert!(run.join(Duration::from_secs(5)));
}

#[test]
fn an_exit_before_the_launch_run_finishes_leaves_its_leftovers_to_the_next_launch() {
    let root = tempfile::tempdir().unwrap();
    database(root.path());
    prepare_session(root.path()).unwrap();
    let directory = root.path().join("backups");
    // What an unfinished launch run holds.
    fs::write(directory.join(".lock"), []).unwrap();
    fs::write(directory.join("copying.tmp"), []).unwrap();
    let (_release, stalled) = mpsc::channel::<()>();
    let launch = ArchiveRun::spawn(move || {
        let _ = stalled.recv();
    });
    finish_session(root.path().to_owned(), &launch);
    assert!(zips(root.path()).is_empty());
    assert!(directory.join(".running").exists());

    prepare_session(root.path()).unwrap();
    assert!(!directory.join(".lock").exists());
    assert!(!directory.join("copying.tmp").exists());
    assert_eq!(zips(root.path()).len(), 1);
}

#[test]
fn keeps_the_ten_newest_complete_archives() {
    let root = tempfile::tempdir().unwrap();
    let connection = database(root.path());
    for number in 0..12 {
        connection
            .execute("INSERT INTO text VALUES (?1)", [number.to_string()])
            .unwrap();
        assert!(archive_stores(root.path()).unwrap());
        let newest = zips(root.path()).pop().unwrap();
        // Move the current archive to an earlier distinct run timestamp so the
        // following run can use the current second without a clock-dependent wait.
        fs::rename(
            newest,
            root.path()
                .join(format!("backups/20260101-0000{number:02}-utc.zip")),
        )
        .unwrap();
    }
    let paths = zips(root.path());
    assert_eq!(paths.len(), 10);
    assert!(paths[0]
        .file_name()
        .unwrap()
        .to_string_lossy()
        .contains("000002"));
}

#[test]
fn an_old_archive_that_cannot_be_deleted_is_logged_and_the_run_still_counts_as_written() {
    let root = tempfile::tempdir().unwrap();
    database(root.path());
    let directory = root.path().join("backups");
    // A directory is the oldest "archive"; removing it as a file fails.
    fs::create_dir_all(directory.join("20200101-000000-utc.zip")).unwrap();
    for second in 1..10 {
        fs::write(
            directory.join(format!("20200101-0000{second:02}-utc.zip")),
            [],
        )
        .unwrap();
    }
    assert!(archive_stores(root.path()).unwrap());
    assert!(directory.join("20200101-000000-utc.zip").is_dir());
    assert_eq!(zips(root.path()).len(), 11);
}

#[test]
fn archives_live_directly_in_backups_and_an_older_archives_folder_is_left_alone() {
    let root = tempfile::tempdir().unwrap();
    database(root.path());
    let older = root.path().join("backups/archives");
    fs::create_dir_all(&older).unwrap();
    for name in ["20200101-000000-utc.zip", ".running", ".lock"] {
        fs::write(older.join(name), []).unwrap();
    }
    prepare_session(root.path()).unwrap();
    assert!(root.path().join("backups/.running").exists());
    assert!(archive_stores(root.path()).unwrap());
    let paths = zips(root.path());
    assert_eq!(paths.len(), 1);
    assert_eq!(paths[0].parent().unwrap(), root.path().join("backups"));
    for name in ["20200101-000000-utc.zip", ".running", ".lock"] {
        assert!(older.join(name).exists(), "{name}");
    }
}
