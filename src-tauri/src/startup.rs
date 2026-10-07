//! Bounded startup preparation; first-frame application stays on the UI thread.
use std::{sync::mpsc, time::Duration};

pub(crate) const PREPARE_WAIT: Duration = Duration::from_secs(2);

pub(crate) fn prepare<T: Send + 'static>(name: &str, wait: Duration, work: impl FnOnce() -> T + Send + 'static) -> Result<T, String> {
    let (done, completed) = mpsc::channel();
    std::thread::Builder::new().name("startup-io".into()).spawn(move || {
        // After timeout the receiver is gone. Any owned result, including an
        // instance claim, is dropped rather than adopted by a late worker.
        let _ = done.send(work());
    }).map_err(|error| error.to_string())?;
    completed.recv_timeout(wait).map_err(|error| format!("{name} preparation did not complete: {error}"))
}

pub(crate) fn saved_config(config_path: Option<std::path::PathBuf>) -> Option<String> {
    prepare("saved appearance and language", PREPARE_WAIT, move || {
        config_path.and_then(|path| std::fs::read_to_string(path).ok())
    }).unwrap_or_else(|error| { eprintln!("[quickdeck] {error}"); None })
}

// Unit-test stub: startup preparation is private to the native application.
#[cfg(test)]
#[path = "../tests/unit/startup.rs"]
mod tests;
