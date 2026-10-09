//! The quits that do not start at the window (unsaved-edits conventions,
//! Quitting): the menu's Quit, the Dock's Quit, and an OS logout, restart or
//! shutdown. The main window's close owns the save. A quit the user started
//! goes through that close, so a failed save can cancel it; an OS session end
//! asks the window to save without prompting and waits at most
//! `SESSION_SAVE_WAIT`.

use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Mutex, PoisonError,
    },
    time::Duration,
};

use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};

use crate::logging;

/// The event that asks the main window to save for an OS session end.
pub const SESSION_ENDING_EVENT: &str = "session-ending";

/// How long an OS session end waits for the window's save. With the exit steps
/// that follow it stays under the host's kill delay (tests/unit/quit.rs).
pub(crate) const SESSION_SAVE_WAIT: Duration = Duration::from_millis(1500);

/// Quits through the main window's close, which saves first and may be
/// cancelled; exits directly when there is no window to close.
pub fn request_quit<R: Runtime>(app: &AppHandle<R>) {
    let Some(window) = app.get_webview_window("main") else {
        app.exit(0);
        return;
    };
    if let Err(error) = window.close() {
        logging::warn(
            "route quit through main window failed",
            json!({ "error": error.to_string() }),
        );
    }
}

/// Who started a quit macOS delivers as `terminate:`.
#[cfg(any(target_os = "macos", test))]
#[derive(Debug, PartialEq, Eq)]
enum QuitOrigin {
    User,
    SessionEnd,
}

/// The quit Apple Event carries a reason only when the OS sends it for a
/// logout, restart or shutdown; the Dock's Quit sends none.
#[cfg(any(target_os = "macos", test))]
fn quit_origin(event_id: Option<u32>, has_quit_reason: bool) -> QuitOrigin {
    const QUIT_APPLICATION: u32 = u32::from_be_bytes(*b"quit");
    if event_id == Some(QUIT_APPLICATION) && has_quit_reason {
        QuitOrigin::SessionEnd
    } else {
        QuitOrigin::User
    }
}

/// The session-end save in flight: the window's report settles it. Once an OS
/// session end has begun, exit skips its waits that are not the user's save.
#[derive(Default)]
pub struct SessionEnd {
    pending: Mutex<Vec<mpsc::SyncSender<()>>>,
    ending: AtomicBool,
}

impl SessionEnd {
    fn begin(&self) -> (mpsc::Receiver<()>, bool) {
        self.ending.store(true, Ordering::Relaxed);
        let (saved, report) = mpsc::sync_channel(1);
        let mut pending = self.pending.lock().unwrap_or_else(PoisonError::into_inner);
        let first = pending.is_empty();
        pending.push(saved);
        (report, first)
    }

    fn finish(&self) {
        for saved in self.pending.lock().unwrap_or_else(PoisonError::into_inner).drain(..) {
            let _ = saved.try_send(());
        }
    }

    /// Whether this exit is an OS logout, restart or shutdown.
    pub fn ending(&self) -> bool {
        self.ending.load(Ordering::Relaxed)
    }

    /// The session end did not happen (Windows: another app cancelled it), so
    /// a later exit is an ordinary one again.
    #[cfg_attr(not(windows), allow(dead_code))]
    fn cancel(&self) {
        self.ending.store(false, Ordering::Relaxed);
    }
}

/// Asks the main window to save for an OS session end. The receiver hears when
/// it has; `None` when there is no window to ask.
fn begin_session_end<R: Runtime>(app: &AppHandle<R>) -> Option<(mpsc::Receiver<()>, bool)> {
    app.get_webview_window("main")?;
    let (saved, first) = app.state::<SessionEnd>().begin();
    if !first { return Some((saved, false)); }
    match app.emit_to("main", SESSION_ENDING_EVENT, ()) {
        Ok(()) => Some((saved, true)),
        Err(error) => {
            logging::warn(
                "session end save not requested",
                json!({ "error": error.to_string() }),
            );
            app.state::<SessionEnd>().finish();
            None
        }
    }
}

fn log_session_save_expired() {
    logging::warn(
        "session end save wait expired",
        json!({ "ms": SESSION_SAVE_WAIT.as_millis() }),
    );
}

/// The window's report that its session-end save has finished, whatever its
/// outcome; failures are logged on the window's side.
#[tauri::command]
pub fn session_end_saved(session_end: State<SessionEnd>) {
    session_end.finish();
}

/// Hooks the OS-started quits into the save; called once from setup.
pub fn install(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    macos::install(app);
    #[cfg(windows)]
    windows_session::install(app);
    #[cfg(not(any(target_os = "macos", windows)))]
    let _ = app;
}

#[cfg(target_os = "macos")]
mod macos {
    //! macOS sends the Dock's Quit and a session end as `terminate:`, which
    //! asks the delegate's `applicationShouldTerminate:`. tao's delegate has
    //! none, so the app would exit without the window ever seeing it; the
    //! method is added to that delegate here.

    use std::sync::{mpsc::RecvTimeoutError, OnceLock};

    use objc2::{
        class, ffi, msg_send,
        runtime::{AnyObject, Bool, Imp, Sel},
        sel,
    };
    use serde_json::json;
    use tauri::{AppHandle, Manager};

    use super::{
        begin_session_end, log_session_save_expired, quit_origin, request_quit, QuitOrigin,
        SESSION_SAVE_WAIT,
    };
    use crate::logging;

    const TERMINATE_CANCEL: usize = 0;
    const TERMINATE_NOW: usize = 1;
    const TERMINATE_LATER: usize = 2;
    const QUIT_REASON: u32 = u32::from_be_bytes(*b"why?");

    static APP: OnceLock<AppHandle> = OnceLock::new();

    pub fn install(app: &AppHandle) {
        if APP.set(app.clone()).is_err() {
            return;
        }
        // SAFETY: setup runs on the main thread after launch, when the
        // delegate is tao's; the method matches `applicationShouldTerminate:`'s
        // signature and type encoding.
        let added = unsafe {
            let application: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
            let delegate: *mut AnyObject = msg_send![application, delegate];
            if delegate.is_null() {
                false
            } else {
                let method: extern "C-unwind" fn(&AnyObject, Sel, *mut AnyObject) -> usize =
                    should_terminate;
                let imp: Imp = std::mem::transmute(method);
                ffi::class_addMethod(
                    ffi::object_getClass(delegate) as *mut _,
                    sel!(applicationShouldTerminate:),
                    imp,
                    c"Q@:@".as_ptr(),
                )
                .as_bool()
            }
        };
        if !added {
            logging::warn("quit handler not installed", json!({}));
        }
    }

    extern "C-unwind" fn should_terminate(_: &AnyObject, _: Sel, _: *mut AnyObject) -> usize {
        let Some(app) = APP.get() else {
            return TERMINATE_NOW;
        };
        if app.get_webview_window("main").is_none() {
            return TERMINATE_NOW;
        }
        let (event_id, has_quit_reason) = current_quit_event();
        match quit_origin(event_id, has_quit_reason) {
            QuitOrigin::User => {
                request_quit(app);
                TERMINATE_CANCEL
            }
            QuitOrigin::SessionEnd => {
                let Some((saved, first)) = begin_session_end(app) else {
                    return TERMINATE_NOW;
                };
                // The first request already owns the termination reply and budget.
                if !first { return TERMINATE_LATER; }
                let app = app.clone();
                std::thread::spawn(move || {
                    if let Err(RecvTimeoutError::Timeout) = saved.recv_timeout(SESSION_SAVE_WAIT) {
                        log_session_save_expired();
                    }
                    if let Err(error) = app.run_on_main_thread(reply_terminate_now) {
                        logging::warn(
                            "session end reply failed",
                            json!({ "error": error.to_string() }),
                        );
                    }
                });
                TERMINATE_LATER
            }
        }
    }

    // The Apple Event being handled, and whether it carries a quit reason.
    fn current_quit_event() -> (Option<u32>, bool) {
        // SAFETY: plain Foundation calls on the main thread; nil is checked.
        unsafe {
            let manager: *mut AnyObject =
                msg_send![class!(NSAppleEventManager), sharedAppleEventManager];
            let event: *mut AnyObject = msg_send![manager, currentAppleEvent];
            if event.is_null() {
                return (None, false);
            }
            let event_id: u32 = msg_send![event, eventID];
            let attribute: *mut AnyObject =
                msg_send![event, attributeDescriptorForKeyword: QUIT_REASON];
            let parameter: *mut AnyObject =
                msg_send![event, paramDescriptorForKeyword: QUIT_REASON];
            (Some(event_id), !attribute.is_null() || !parameter.is_null())
        }
    }

    fn reply_terminate_now() {
        // SAFETY: run on the main thread, answering the NSTerminateLater above.
        unsafe {
            let application: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
            let _: () = msg_send![application, replyToApplicationShouldTerminate: Bool::YES];
        }
    }
}

#[cfg(windows)]
mod windows_session {
    //! Windows asks every top-level window `WM_QUERYENDSESSION` before a
    //! logout, restart or shutdown, and tao answers none. The main window's
    //! subclass asks the webview to save and pumps messages until it reports,
    //! so its IPC keeps running, for at most `SESSION_SAVE_WAIT`.

    use std::{
        sync::mpsc::{self, TryRecvError},
        time::Instant,
    };

    use serde_json::json;
    use tauri::{AppHandle, Manager};
    use windows::Win32::{
        Foundation::{HWND, LPARAM, LRESULT, WPARAM},
        UI::{
            Shell::{DefSubclassProc, SetWindowSubclass},
            WindowsAndMessaging::{
                DispatchMessageW, MsgWaitForMultipleObjects, PeekMessageW, PostQuitMessage,
                TranslateMessage, MSG, PM_REMOVE, QS_ALLINPUT, WM_ENDSESSION, WM_QUERYENDSESSION,
                WM_QUIT,
            },
        },
    };

    use super::{begin_session_end, log_session_save_expired, SessionEnd, SESSION_SAVE_WAIT};
    use crate::logging;

    const SUBCLASS_ID: usize = 1;

    pub fn install(app: &AppHandle) {
        let Some(window) = app.get_webview_window("main") else {
            return;
        };
        let hwnd = match window.hwnd() {
            Ok(hwnd) => hwnd,
            Err(error) => {
                return logging::warn(
                    "quit handler not installed",
                    json!({ "error": error.to_string() }),
                )
            }
        };
        // The handle is kept for the life of the process, as the window is.
        let data = Box::into_raw(Box::new(app.clone()));
        // SAFETY: the main window belongs to this thread, and `data` outlives it.
        if !unsafe { SetWindowSubclass(hwnd, Some(on_message), SUBCLASS_ID, data as usize) }
            .as_bool()
        {
            // SAFETY: not installed, so nothing else holds `data`.
            drop(unsafe { Box::from_raw(data) });
            logging::warn("quit handler not installed", json!({}));
        }
    }

    unsafe extern "system" fn on_message(
        hwnd: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
        _: usize,
        data: usize,
    ) -> LRESULT {
        if message == WM_QUERYENDSESSION {
            // SAFETY: `data` is the AppHandle `install` leaked for this window.
            let app = unsafe { &*(data as *const AppHandle) };
            if let Some((saved, true)) = begin_session_end(app) {
                pump_until_saved(&saved);
            }
        } else if message == WM_ENDSESSION && wparam.0 == 0 {
            // SAFETY: as above.
            let app = unsafe { &*(data as *const AppHandle) };
            app.state::<SessionEnd>().cancel();
        }
        // SAFETY: forwards the message this subclass received.
        unsafe { DefSubclassProc(hwnd, message, wparam, lparam) }
    }

    pub(super) fn pump_until_saved(saved: &mpsc::Receiver<()>) {
        let deadline = Instant::now() + SESSION_SAVE_WAIT;
        loop {
            if !matches!(saved.try_recv(), Err(TryRecvError::Empty)) {
                return;
            }
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return log_session_save_expired();
            }
            let wait = u32::try_from(remaining.as_millis()).unwrap_or(u32::MAX);
            // SAFETY: standard message pumping on the thread that owns the window.
            unsafe {
                let _ = MsgWaitForMultipleObjects(None, false, wait, QS_ALLINPUT);
                let mut message = MSG::default();
                loop {
                    if !matches!(saved.try_recv(), Err(TryRecvError::Empty)) {
                        return;
                    }
                    if Instant::now() >= deadline {
                        return log_session_save_expired();
                    }
                    if !PeekMessageW(&mut message, None, 0, 0, PM_REMOVE).as_bool() {
                        break;
                    }
                    if message.message == WM_QUIT {
                        // Left for tao's own loop, after this wait.
                        PostQuitMessage(message.wParam.0 as i32);
                        return;
                    }
                    let _ = TranslateMessage(&message);
                    let _ = DispatchMessageW(&message);
                }
            }
        }
    }
}

#[cfg(test)]
#[path = "../tests/unit/quit.rs"]
mod tests;
