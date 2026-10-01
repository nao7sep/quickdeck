//! Best-effort whole-store archive. Native work runs on a worker that launch
//! and exit wait on for at most `WAIT`; only completed zip files participate in
//! dedup and retention.
use chrono::{SecondsFormat, Utc};
use rusqlite::{
    backup::{Backup, StepResult},
    Connection, OpenFlags,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{Arc, Condvar, Mutex, PoisonError},
    time::Duration,
};
use zip::{write::SimpleFileOptions, CompressionMethod, ZipArchive, ZipWriter};

/// How long launch and exit wait for an archive run before going on without it.
const WAIT: Duration = Duration::from_secs(5);

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

/// Starts the launch run: the recovery archive after an unclean exit, then the
/// marker.
pub fn start_session(root: PathBuf) -> ArchiveRun {
    ArchiveRun::spawn(move || {
        if let Err(error) = prepare_session(&root) {
            crate::logging::warn("archive launch failed", json!({ "error": error }));
        }
    })
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
    let directory = root.join("backups/archives");
    fs::create_dir_all(&directory).map_err(error)?;
    let marker = directory.join(".running");
    if marker.exists() {
        // This runs only after exclusive process ownership was acquired. Any
        // previous archive worker died with that process, so its lock/temp files
        // cannot belong to a live writer.
        for entry in fs::read_dir(&directory).map_err(error)? {
            let path = entry.map_err(error)?.path();
            if path.file_name().is_some_and(|name| name == ".lock")
                || path.extension().is_some_and(|extension| extension == "tmp")
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
        if let Err(error) = fs::remove_file(root.join("backups/archives/.running")) {
            crate::logging::warn(
                "archive marker cleanup failed",
                json!({ "error": error.to_string() }),
            );
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

fn copy_sqlite(source: &Path, target: &Path) -> Result<Vec<u8>, String> {
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
    fs::read(target).map_err(error)
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

fn read_manifest(path: &Path) -> Result<Manifest, String> {
    let mut archive = ZipArchive::new(File::open(path).map_err(error)?).map_err(error)?;
    let mut bytes = Vec::new();
    archive
        .by_name("manifest.json")
        .map_err(error)?
        .read_to_end(&mut bytes)
        .map_err(error)?;
    serde_json::from_slice(&bytes).map_err(error)
}

pub fn archive_stores(root: &Path) -> Result<bool, String> {
    let directory = root.join("backups/archives");
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
    let mut contents = Vec::new();
    for (relative, entry_name) in crate::storage::ARCHIVED_STORES {
        let source = root.join(relative);
        let target = directory.join(format!("{}.tmp", crate::nanoid::generate()?));
        let cleanup = Cleanup(target.clone());
        let mut entry = Entry {
            original_path: source.to_string_lossy().into_owned(),
            entry_name: entry_name.to_string(),
            hash: None,
            skipped: None,
        };
        match copy_sqlite(&source, &target) {
            Ok(bytes) => {
                entry.hash = Some(
                    Sha256::digest(&bytes)
                        .iter()
                        .map(|byte| format!("{byte:02x}"))
                        .collect(),
                );
                contents.push((*entry_name, bytes));
            }
            Err(reason) => {
                crate::logging::warn(
                    "archive store skipped",
                    json!({ "path": source, "reason": reason }),
                );
                entry.skipped = Some(reason);
            }
        }
        drop(cleanup);
        manifest.entries.push(entry);
    }
    if contents.is_empty() {
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
    let target = directory.join(format!("{}.zip", Utc::now().format("%Y%m%d-%H%M%S-utc")));
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
    for (name, bytes) in contents {
        zip.start_file(name, options).map_err(error)?;
        zip.write_all(&bytes).map_err(error)?;
    }
    zip.start_file("manifest.json", options).map_err(error)?;
    zip.write_all(&serde_json::to_vec_pretty(&manifest).map_err(error)?)
        .map_err(error)?;
    zip.finish().map_err(error)?.sync_all().map_err(error)?;
    fs::rename(&temporary, target).map_err(error)?;
    drop(cleanup);
    let paths = archives(&directory)?;
    for path in paths.iter().take(paths.len().saturating_sub(10)) {
        fs::remove_file(path).map_err(error)?;
    }
    Ok(true)
}
