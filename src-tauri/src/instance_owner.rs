//! Atomic process ownership and second-launch activation.
//!
//! QuickDeck persists whole-file pane snapshots, including authored text, so
//! two GUI processes must never open the same storage root concurrently. The
//! OS file lock is authoritative; the loopback endpoint only asks the owner to
//! activate it or request its ordinary quit with a matching launch token. Files live under `QUICKDECK_DATA_DIR`, which keeps
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
const ACTIVATION_READ_WAIT: Duration = Duration::from_secs(1);

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
        .truncate(false)
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
            // Only the OS-lock owner publishes. Readers see the old complete endpoint
            // or the new one, never a partial port/identity pair.
            let staged_endpoint = root.join("instance.endpoint.tmp");
            let mut endpoint_file = OpenOptions::new()
                .create(true)
                .truncate(true)
                .write(true)
                .open(&staged_endpoint)
                .map_err(|e| e.to_string())?;
            let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
                .map_err(|e| format!("could not open process activation endpoint: {e}"))?;
            let port = listener
                .local_addr()
                .map_err(|e| format!("could not inspect process activation endpoint: {e}"))?
                .port();
            writeln!(endpoint_file, "{port}").map_err(|e| e.to_string())?;
            writeln!(
                endpoint_file,
                "{}",
                serde_json::json!({
                    "launcherRoot": std::env::var("QUICKDECK_LAUNCHER_ROOT").unwrap_or_default(),
                    "token": std::env::var("QUICKDECK_LAUNCHER_TOKEN").unwrap_or_default(),
                })
            )
            .map_err(|e| e.to_string())?;
            endpoint_file.sync_all().map_err(|e| e.to_string())?;
            drop(endpoint_file);
            std::fs::rename(&staged_endpoint, &endpoint_path).map_err(|e| e.to_string())?;
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
            if let Ok(port) = text.lines().next().unwrap_or_default().parse::<u16>() {
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
    let token = std::env::var("QUICKDECK_LAUNCHER_TOKEN").unwrap_or_default();
    std::thread::spawn(move || loop {
        match listener.accept() {
            Ok((mut stream, _)) => match read_request(&mut stream, &token) {
                Request::Activate => crate::bring_main_forward(&app),
                Request::Quit => {
                    crate::quit::request_quit(&app);
                    let _ = stream.write_all(b"requested");
                }
                Request::Status => {
                    let _ = stream.write_all(token.as_bytes());
                }
                Request::Unknown => {}
            },
            Err(_) => break,
        }
    });
}

// The dedicated listener sleeps in accept, and each client has a bounded read.
// A launcher can quit only the instance carrying its exact launch token.
#[derive(Debug, PartialEq)]
enum Request {
    Activate,
    Quit,
    Status,
    Unknown,
}

fn read_request(stream: &mut TcpStream, token: &str) -> Request {
    let started = Instant::now();
    let mut command = [0u8; 8];
    if stream
        .set_nonblocking(false)
        .and_then(|()| stream.set_read_timeout(Some(ACTIVATION_READ_WAIT)))
        .and_then(|()| stream.read_exact(&mut command))
        .is_err()
    {
        return Request::Unknown;
    }
    match &command {
        b"activate" => Request::Activate,
        b"status__" => Request::Status,
        b"quit____" if !token.is_empty() => {
            let expected = format!("{token}\n");
            let mut provided = Vec::new();
            // Bound the whole request, including a client trickling bytes.
            while provided.len() <= 256 {
                let Some(remaining) = ACTIVATION_READ_WAIT.checked_sub(started.elapsed()) else {
                    return Request::Unknown;
                };
                if remaining.is_zero() || stream.set_read_timeout(Some(remaining)).is_err() {
                    return Request::Unknown;
                }
                let mut byte = [0];
                match stream.read(&mut byte) {
                    Ok(0) => return if provided == expected.as_bytes() { Request::Quit } else { Request::Unknown },
                    Ok(_) => provided.push(byte[0]),
                    Err(_) => return Request::Unknown,
                }
            }
            Request::Unknown
        }
        _ => Request::Unknown,
    }
}

#[cfg(test)]
fn is_activation(stream: &mut TcpStream) -> bool {
    read_request(stream, "") == Request::Activate
}

pub fn init() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::<tauri::Wry>::new("instance-owner")
        .setup(|app, _api| {
            let handle = app.app_handle().clone();
            let prepared = crate::startup::prepare(
                "instance ownership",
                crate::startup::PREPARE_WAIT,
                move || {
                    let root = crate::paths::app_data_dir(&handle)?;
                    let claimed = claim(&root)?;
                    Ok::<_, String>((root, claimed))
                },
            );
            match prepared.and_then(|claimed| claimed) {
                Ok((root, Claim::Primary { lock, listener })) => {
                    app.manage(crate::paths::DataRoot(root));
                    listen(listener, app.app_handle().clone());
                    app.manage(Owner { _lock: lock });
                }
                Ok((_, Claim::Secondary { endpoint_path })) => {
                    let _ = crate::startup::prepare(
                        "existing instance activation",
                        NOTIFY_TIMEOUT,
                        move || notify_primary(&endpoint_path),
                    );
                    std::process::exit(0);
                }
                Err(error) => {
                    // Before logging starts, so stderr is all there is; the
                    // load-error screen tells the user.
                    crate::logging::to_stderr(format_args!("{error}"));
                    app.manage(crate::paths::ClaimFailure(error));
                }
            }
            Ok(())
        })
        .build()
}

#[cfg(test)]
// EXCEPTION to tests-folder conventions: the module is private to the crate, and the tests drive
// the private `Claim`, `claim` and `notify_primary`.
#[path = "../tests/unit/instance_owner.rs"]
mod tests;
