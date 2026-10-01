use quickdeck_lib::archive::{archive_stores, finish_session, prepare_session};
use rusqlite::Connection;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File},
    io::Read,
    path::Path,
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
    let mut paths = fs::read_dir(root.join("backups/archives"))
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
    assert!(!root.path().join("backups/archives/.lock").exists());
}

#[test]
fn exclusive_lock_skips_without_removing_another_writers_lock() {
    let root = tempfile::tempdir().unwrap();
    let directory = root.path().join("backups/archives");
    fs::create_dir_all(&directory).unwrap();
    fs::write(directory.join(".lock"), []).unwrap();
    assert!(!archive_stores(root.path()).unwrap());
    assert!(directory.join(".lock").exists());
    assert!(zips(root.path()).is_empty());
}

#[test]
fn a_missing_store_is_manifested_without_creating_an_empty_database() {
    let root = tempfile::tempdir().unwrap();
    assert!(archive_stores(root.path()).unwrap());
    assert!(!root.path().join("snapshots.sqlite3").exists());
    let mut zip = ZipArchive::new(File::open(&zips(root.path())[0]).unwrap()).unwrap();
    assert_eq!(zip.len(), 1);
    let mut manifest = String::new();
    zip.by_name("manifest.json")
        .unwrap()
        .read_to_string(&mut manifest)
        .unwrap();
    let manifest: Value = serde_json::from_str(&manifest).unwrap();
    assert!(manifest["entries"][0]["skipped"].is_string());
    assert!(manifest["entries"][0]["hash"].is_null());
}

#[test]
fn clean_exit_archives_and_clears_the_marker_and_unclean_launch_recovers_once() {
    let root = tempfile::tempdir().unwrap();
    database(root.path());
    prepare_session(root.path()).unwrap();
    assert!(zips(root.path()).is_empty());
    let directory = root.path().join("backups/archives");
    assert!(directory.join(".running").exists());
    fs::write(directory.join(".lock"), []).unwrap();
    fs::write(directory.join("interrupted.tmp"), []).unwrap();
    prepare_session(root.path()).unwrap();
    assert_eq!(zips(root.path()).len(), 1);
    assert!(!directory.join("interrupted.tmp").exists());
    assert!(!directory.join(".lock").exists());
    finish_session(root.path().to_owned());
    assert!(!directory.join(".running").exists());
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
                .join(format!("backups/archives/20260101-0000{number:02}-utc.zip")),
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
