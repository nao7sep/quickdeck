//! Best-effort whole-store archive. Native work runs on a worker that launch
//! and exit wait on for at most `WAIT`; only completed zip files participate in
//! dedup and thinning.
use chrono::{DateTime, Datelike, NaiveDateTime, SecondsFormat, TimeDelta, Utc};
use rusqlite::{
    backup::{Backup, StepResult},
    Connection, OpenFlags,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs::{self, File, OpenOptions},
    io::{self, Read, Write},
    path::{Path, PathBuf},
    sync::{Arc, Condvar, Mutex, PoisonError},
    time::Duration,
};
use zip::{write::SimpleFileOptions, CompressionMethod, ZipArchive, ZipWriter};

use crate::format_version::{self, JsonFormat};

/// An archive's file name: its run time, per the timestamp-conventions.
const ARCHIVE_NAME_FORMAT: &str = "%Y%m%d-%H%M%S-utc.zip";

/// The entry that says what the archive holds, beside the stores.
const MANIFEST_NAME: &str = "manifest.json";

/// How long launch and exit wait for an archive run before going on without it.
const WAIT: Duration = Duration::from_secs(5);

/// A temporary file, then the files SQLite keeps beside a temporary store copy
/// while it is open: the copy inherits the store's WAL mode.
const TEMPORARY_SUFFIXES: [&str; 4] = ["", "-journal", "-wal", "-shm"];

/// An archive run on its own thread. A run given up on keeps going; if the
/// process ends first, `.running` stays and the next launch clears what the
/// run left.
#[derive(Clone)]
pub struct ArchiveRun(Arc<(Mutex<bool>, Condvar)>);

impl ArchiveRun {
    pub fn spawn(work: impl FnOnce() + Send + 'static) -> Self {
        let run = Self(Arc::new((Mutex::new(false), Condvar::new())));
        let finished = run.clone();
        std::thread::spawn(move || {
            work();
            let (done, changed) = &*finished.0;
            *done.lock().unwrap_or_else(PoisonError::into_inner) = true;
            changed.notify_all();
        });
        run
    }

    /// Whether the run has finished, waiting at most `bound` for it.
    pub fn join(&self, bound: Duration) -> bool {
        let (done, changed) = &*self.0;
        let done = done.lock().unwrap_or_else(PoisonError::into_inner);
        let (done, _) = changed
            .wait_timeout_while(done, bound, |done| !*done)
            .unwrap_or_else(PoisonError::into_inner);
        *done
    }
}

/// The archive session: the storage root resolved at launch, kept so exit does
/// no path resolution, and the launch run.
pub struct ArchiveSession {
    pub root: PathBuf,
    pub launch: ArchiveRun,
}

/// Starts the launch run: the recovery archive after an unclean exit, then the
/// marker.
pub fn start_session(root: PathBuf) -> ArchiveSession {
    let launch_root = root.clone();
    let launch = ArchiveRun::spawn(move || {
        if let Err(error) = prepare_session(&launch_root) {
            crate::logging::warn("archive launch failed", json!({ "error": error }));
        }
    });
    ArchiveSession { root, launch }
}

/// Called from the blocking load worker before the snapshot database opens.
pub fn wait_for_launch(launch: &ArchiveRun) {
    if !launch.join(WAIT) {
        crate::logging::warn(
            "archive launch wait expired",
            json!({ "seconds": WAIT.as_secs() }),
        );
    }
}

pub fn prepare_session(root: &Path) -> Result<(), String> {
    let directory = root.join("backups");
    fs::create_dir_all(&directory).map_err(error)?;
    let marker = directory.join(".running");
    if marker.exists() {
        // This runs only after exclusive process ownership was acquired. Any
        // previous archive worker died with that process, so its lock/temp files
        // cannot belong to a live writer.
        for entry in fs::read_dir(&directory).map_err(error)? {
            let path = entry.map_err(error)?.path();
            let name = path.file_name().unwrap_or_default().to_string_lossy();
            if name == ".lock"
                || TEMPORARY_SUFFIXES
                    .iter()
                    .any(|suffix| name.ends_with(&format!(".tmp{suffix}")))
            {
                fs::remove_file(path).map_err(error)?;
            }
        }
        archive_stores(root)?;
    }
    // not recorded: the unclean-exit marker is disposable process state.
    fs::write(marker, []).map_err(error)
}

pub fn finish_session(root: PathBuf, launch: &ArchiveRun) {
    let launch = launch.clone();
    let run = ArchiveRun::spawn(move || {
        // An unfinished launch run may still hold the lock and temporary files;
        // the marker stays, so the next launch clears them and archives.
        if !launch.join(Duration::ZERO) {
            crate::logging::warn(
                "archive exit skipped",
                json!({ "reason": "the launch archive has not finished" }),
            );
            return;
        }
        // Snapshots use scoped connections; close the remaining owned store.
        crate::backup_store::close_backup_store();
        if let Err(error) = archive_stores(&root) {
            crate::logging::warn("archive exit failed", json!({ "error": error }));
        }
        // A marker already gone, with its data folder, needs no cleanup.
        match fs::remove_file(root.join("backups/.running")) {
            Err(error) if error.kind() != io::ErrorKind::NotFound => crate::logging::warn(
                "archive marker cleanup failed",
                json!({ "error": error.to_string() }),
            ),
            _ => {}
        }
    });
    if !run.join(WAIT) {
        crate::logging::warn(
            "archive exit wait expired",
            json!({ "seconds": WAIT.as_secs() }),
        );
    }
}

#[derive(Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct Entry {
    original_path: String,
    entry_name: String,
    hash: Option<String>,
    skipped: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    timestamp_utc: String,
    entries: Vec<Entry>,
}

struct Cleanup(PathBuf);
impl Drop for Cleanup {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

fn error(value: impl std::fmt::Display) -> String {
    value.to_string()
}

fn copy_sqlite(source: &Path, target: &Path) -> Result<(), String> {
    let source =
        Connection::open_with_flags(source, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(error)?;
    source
        .busy_timeout(Duration::from_millis(100))
        .map_err(error)?;
    {
        let mut target = Connection::open(target).map_err(error)?;
        let backup = Backup::new(&source, &mut target).map_err(error)?;
        loop {
            match backup.step(128).map_err(error)? {
                StepResult::Done => break,
                StepResult::More => {}
                StepResult::Busy | StepResult::Locked => return Err("store is locked".into()),
                _ => return Err("unexpected SQLite backup result".into()),
            }
        }
    }
    Ok(())
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = File::open(path).map_err(error)?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0; 64 * 1024];
    loop {
        match file.read(&mut buffer) {
            Ok(0) => break,
            Ok(read) => hasher.update(&buffer[..read]),
            Err(value) if value.kind() == io::ErrorKind::Interrupted => {}
            Err(value) => return Err(error(value)),
        }
    }
    Ok(hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

fn archives(directory: &Path) -> Result<Vec<PathBuf>, String> {
    let mut paths = fs::read_dir(directory)
        .map_err(error)?
        .map(|entry| entry.map(|entry| entry.path()))
        .collect::<Result<Vec<_>, _>>()
        .map_err(error)?;
    paths.retain(|path| path.extension().is_some_and(|extension| extension == "zip"));
    paths.sort();
    Ok(paths)
}

// An archive's manifest, its format marker checked.
fn manifest_format(path: &Path) -> Result<JsonFormat, String> {
    let mut archive = ZipArchive::new(File::open(path).map_err(error)?).map_err(error)?;
    let mut bytes = Vec::new();
    archive
        .by_name(MANIFEST_NAME)
        .map_err(error)?
        .read_to_end(&mut bytes)
        .map_err(error)?;
    let value = serde_json::from_slice(&bytes).map_err(error)?;
    format_version::read_json(value, format_version::ARCHIVE_MANIFEST)
}

// A manifest in a newer format is one this build cannot compare with, so the
// run writes a new archive beside the one that holds it.
fn read_manifest(path: &Path) -> Result<Manifest, String> {
    match manifest_format(path)? {
        JsonFormat::Readable(fields) => {
            serde_json::from_value(serde_json::Value::Object(fields)).map_err(error)
        }
        JsonFormat::Newer(recorded) => Err(format_version::newer_message(MANIFEST_NAME, recorded)),
    }
}

pub fn archive_stores(root: &Path) -> Result<bool, String> {
    // A data folder deleted while the app runs stays deleted: creating
    // `backups/` would bring it back as an empty folder.
    if !root.try_exists().map_err(error)? {
        crate::logging::warn(
            "archive skipped",
            json!({ "path": root, "reason": "the data folder no longer exists" }),
        );
        return Ok(false);
    }
    let directory = root.join("backups");
    fs::create_dir_all(&directory).map_err(error)?;
    let lock_path = directory.join(".lock");
    let lock = match OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&lock_path)
    {
        Ok(lock) => lock,
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            crate::logging::warn(
                "archive skipped",
                json!({ "reason": "another run holds the lock" }),
            );
            return Ok(false);
        }
        Err(value) => return Err(error(value)),
    };
    let _lock_cleanup = Cleanup(lock_path);
    let _lock = lock;
    let mut manifest = Manifest {
        timestamp_utc: Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
        entries: Vec::new(),
    };
    let mut copies = Vec::new();
    for (relative, entry_name) in crate::storage::ARCHIVED_STORES {
        let source = root.join(relative);
        let target = directory.join(format!("{}.tmp", crate::nanoid::generate()?));
        let cleanup = TEMPORARY_SUFFIXES.map(|suffix| {
            let mut path = target.clone().into_os_string();
            path.push(suffix);
            Cleanup(path.into())
        });
        let mut entry = Entry {
            original_path: source.to_string_lossy().into_owned(),
            entry_name: entry_name.to_string(),
            hash: None,
            skipped: None,
        };
        match copy_sqlite(&source, &target).and_then(|()| sha256_file(&target)) {
            Ok(hash) => {
                entry.hash = Some(hash);
                copies.push((*entry_name, target, cleanup));
            }
            Err(reason) => {
                crate::logging::warn(
                    "archive store skipped",
                    json!({ "path": source, "reason": reason }),
                );
                entry.skipped = Some(reason);
            }
        }
        manifest.entries.push(entry);
    }
    if copies.is_empty() {
        return Ok(false);
    }
    let previous = archives(&directory)?;
    if let Some(latest) = previous.last() {
        match read_manifest(latest) {
            Ok(previous_manifest) if previous_manifest.entries == manifest.entries => {
                return Ok(false)
            }
            Ok(_) => {}
            Err(reason) => crate::logging::warn(
                "archive manifest unreadable",
                json!({ "path": latest, "reason": reason }),
            ),
        }
    }
    let target = directory.join(Utc::now().format(ARCHIVE_NAME_FORMAT).to_string());
    // Never overwrite a completed archive when two different runs share a second.
    if target.exists() {
        return Err("archive timestamp already exists".into());
    }
    let temporary = directory.join(format!("{}.tmp", crate::nanoid::generate()?));
    let cleanup = Cleanup(temporary.clone());
    let file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(error)?;
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    for (name, path, _) in &copies {
        zip.start_file(*name, options).map_err(error)?;
        io::copy(&mut File::open(path).map_err(error)?, &mut zip).map_err(error)?;
    }
    let manifest = format_version::stamp_json(
        &serde_json::to_value(&manifest).map_err(error)?,
        format_version::ARCHIVE_MANIFEST,
    )?;
    zip.start_file(MANIFEST_NAME, options).map_err(error)?;
    zip.write_all(&serde_json::to_vec_pretty(&manifest).map_err(error)?)
        .map_err(error)?;
    zip.finish().map_err(error)?.sync_all().map_err(error)?;
    fs::rename(&temporary, target).map_err(error)?;
    drop(cleanup);
    // The new archive is complete; a thinning failure is logged, not the run's.
    match archives(&directory) {
        Ok(paths) => {
            for path in thinned(&paths, Utc::now()) {
                // An archive a newer build wrote is left exactly in place
                // (store-recovery conventions).
                if matches!(manifest_format(&path), Ok(JsonFormat::Newer(_))) {
                    continue;
                }
                if let Err(reason) = fs::remove_file(&path) {
                    crate::logging::warn(
                        "archive thinning failed",
                        json!({ "path": path, "reason": reason.to_string() }),
                    );
                }
            }
        }
        Err(reason) => crate::logging::warn(
            "archive thinning failed",
            json!({ "path": directory, "reason": reason }),
        ),
    }
    Ok(true)
}

/// The archives the data-lifecycle-conventions' schedule drops at `now`. A copy
/// is kept when it is the newest of its period within its own age band, so the
/// newest copy of all always is; a file not named by an archive time is kept.
pub fn thinned(paths: &[PathBuf], now: DateTime<Utc>) -> Vec<PathBuf> {
    let mut dated = paths
        .iter()
        .filter_map(|path| {
            let name = path.file_name()?.to_str()?;
            let time = NaiveDateTime::parse_from_str(name, ARCHIVE_NAME_FORMAT).ok()?;
            Some((time.and_utc(), path))
        })
        .collect::<Vec<_>>();
    dated.sort_by(|(left, _), (right, _)| right.cmp(left));
    let mut periods = HashSet::new();
    dated
        .into_iter()
        .filter(|(time, _)| {
            let age = now.signed_duration_since(*time);
            let period = if age < TimeDelta::days(21) {
                return false;
            } else if age < TimeDelta::days(90) {
                ("day", time.year(), time.ordinal())
            } else if age < TimeDelta::days(1095) {
                let week = time.iso_week();
                ("week", week.year(), week.week())
            } else {
                ("month", time.year(), time.month())
            };
            !periods.insert(period)
        })
        .map(|(_, path)| path.clone())
        .collect()
}
