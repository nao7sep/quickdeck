//! Atomic process ownership and second-launch activation.
//!
//! QuickDeck persists whole-file pane snapshots, including authored text, so
//! two GUI processes must never open the same storage root concurrently. The
//! OS file lock is authoritative; the loopback endpoint only asks the owner to
//! show and focus its window. Files live under `QUICKDECK_HOME`, which keeps
//! disposable test homes independent from the normal profile.

use std::fs::{File, OpenOptions, TryLockError};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use tauri::{Manager, Runtime};

const LOCK_FILE_NAME: &str = "instance.lock";
const ENDPOINT_FILE_NAME: &str = "instance.endpoint";
const NOTIFY_TIMEOUT: Duration = Duration::from_secs(2);
const RETRY_DELAY: Duration = Duration::from_millis(20);

struct Owner {
    _lock: File,
}

enum Claim {
    Primary { lock: File, listener: TcpListener },
    Secondary { endpoint_path: PathBuf },
}

fn claim(root: &Path) -> Result<Claim, String> {
    let path = root.join(LOCK_FILE_NAME);
    let endpoint_path = root.join(ENDPOINT_FILE_NAME);
    let lock_file = OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .open(&path)
        .map_err(|e| {
            format!(
                "could not open process ownership file {}: {e}",
                path.display()
            )
        })?;

    match lock_file.try_lock() {
        Ok(()) => {
            let mut endpoint_file = OpenOptions::new()
                .create(true)
                .truncate(true)
                .write(true)
                .open(&endpoint_path)
                .map_err(|e| e.to_string())?;
            let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
                .map_err(|e| format!("could not open process activation endpoint: {e}"))?;
            listener
                .set_nonblocking(true)
                .map_err(|e| format!("could not configure process activation endpoint: {e}"))?;
            let port = listener
                .local_addr()
                .map_err(|e| format!("could not inspect process activation endpoint: {e}"))?
                .port();
            write!(endpoint_file, "{port}\n").map_err(|e| e.to_string())?;
            endpoint_file.sync_all().map_err(|e| e.to_string())?;
            Ok(Claim::Primary {
                lock: lock_file,
                listener,
            })
        }
        Err(TryLockError::WouldBlock) => Ok(Claim::Secondary { endpoint_path }),
        Err(TryLockError::Error(err)) => Err(format!(
            "could not acquire process ownership file {}: {err}",
            path.display()
        )),
    }
}

fn notify_primary(endpoint_path: &Path) -> Result<(), String> {
    let started = Instant::now();
    loop {
        if let Ok(text) = std::fs::read_to_string(endpoint_path) {
            if let Ok(port) = text.trim().parse::<u16>() {
                if let Ok(mut stream) = TcpStream::connect((std::net::Ipv4Addr::LOCALHOST, port)) {
                    stream.write_all(b"activate").map_err(|e| e.to_string())?;
                    return Ok(());
                }
            }
        }
        if started.elapsed() >= NOTIFY_TIMEOUT {
            return Err("the primary instance did not expose its activation endpoint".to_string());
        }
        std::thread::sleep(RETRY_DELAY);
    }
}

fn listen<R: Runtime>(listener: TcpListener, app: tauri::AppHandle<R>) {
    std::thread::spawn(move || loop {
        match listener.accept() {
            Ok((mut stream, _)) => {
                let mut request = [0u8; 8];
                if stream.read(&mut request).is_ok() && request.starts_with(b"activate") {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
            Err(err) if err.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(RETRY_DELAY);
            }
            Err(_) => break,
        }
    });
}

pub fn init() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::<tauri::Wry>::new("instance-owner")
        .setup(|app, _api| {
            let root = crate::paths::app_data_dir(app.app_handle())?;
            match claim(&root)? {
                Claim::Primary { lock, listener } => {
                    listen(listener, app.app_handle().clone());
                    app.manage(Owner { _lock: lock });
                    Ok(())
                }
                Claim::Secondary { endpoint_path } => {
                    let _ = notify_primary(&endpoint_path);
                    std::process::exit(0);
                }
            }
        })
        .build()
}

#[cfg(test)]
// EXCEPTION to tests-folder conventions: the module is private to the crate, and the tests drive
// the private `Claim`, `claim` and `notify_primary`.
#[path = "../tests/unit/instance_owner.rs"]
mod tests;
