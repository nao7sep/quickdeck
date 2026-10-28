//! The quits that do not start at the window (unsaved-edits conventions,
//! Quitting): the menu's Quit, the Dock's Quit, and an OS logout, restart or
//! shutdown. The main window's close owns the save. A quit the user started
//! goes through that close, so a failed save can cancel it; an OS session end
//! asks the window to save without prompting and waits for it until the exit's
//! deadline.

use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Mutex, PoisonError,
    },
    time::{Duration, Instant},
};

use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind, MessageDialogResult};

use crate::logging;

/// The event that asks the main window to save for an OS session end.
pub const SESSION_ENDING_EVENT: &str = "session-ending";

/// The exit sequence's one deadline when the core fixes it: an OS session end
/// fixes it as it asks the window to save, and an exit nothing has fixed one
/// for fixes it as the exit begins. A quit the main window starts fixes its own
/// (EXIT_DEADLINE_MS in src/services/quit.ts) and hands what remains over with
/// its close (`begin_exit`). Every step draws on what remains. Windows gives
/// each end-session message 5 s before it offers to end the app, and macOS
/// documents no figure, so 3 s leaves the OS room on both.
pub(crate) const EXIT_DEADLINE: Duration = Duration::from_secs(3);

/// When the exit must be done. Only the main thread changes it (sync commands,
/// the session-end handlers and the run loop); the Mutex is what Tauri's
/// managed state requires.
#[derive(Default)]
pub struct ExitDeadline(Mutex<Option<Instant>>);

impl ExitDeadline {
    fn set(&self, deadline: Option<Instant>) {
        *self.0.lock().unwrap_or_else(PoisonError::into_inner) = deadline;
    }

    /// The deadline, fixed now when nothing fixed it earlier.
    pub fn get(&self) -> Instant {
        *self
            .0
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get_or_insert_with(|| Instant::now() + EXIT_DEADLINE)
    }

    /// What remains of the deadline.
    pub fn remaining(&self) -> Duration {
        self.get().saturating_duration_since(Instant::now())
    }
}

/// The main window's close hands over what remains of the deadline it fixed
/// when the close began, just before it destroys itself.
#[tauri::command]
pub fn begin_exit(deadline: State<ExitDeadline>, remaining_ms: u64) {
    deadline.set(Some(Instant::now() + Duration::from_millis(remaining_ms)));
}

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

/// How `applicationShouldTerminate:` answers a `terminate:`.
#[cfg(any(target_os = "macos", test))]
#[derive(Debug, PartialEq, Eq)]
enum TerminateAnswer<T> {
    /// Exit at once: there is no window to save, or its save could not be asked for.
    Now,
    /// The user's quit, which the window's close now owns.
    Cancel,
    /// Exit once the session-end save reports. The request that began the save
    /// carries its report and owns the reply; a repeated request joins it.
    Later(Option<T>),
}

#[cfg(any(target_os = "macos", test))]
fn answer_terminate<T>(
    has_main: bool,
    origin: QuitOrigin,
    route_quit: impl FnOnce(),
    begin_save: impl FnOnce() -> Option<(T, bool)>,
) -> TerminateAnswer<T> {
    if !has_main {
        return TerminateAnswer::Now;
    }
    match origin {
        QuitOrigin::User => {
            route_quit();
            TerminateAnswer::Cancel
        }
        QuitOrigin::SessionEnd => match begin_save() {
            None => TerminateAnswer::Now,
            Some((saved, true)) => TerminateAnswer::Later(Some(saved)),
            Some((_, false)) => TerminateAnswer::Later(None),
        },
    }
}

// The main window's end-session messages, by their Win32 values (checked
// against the windows crate on Windows, tests/unit/quit.rs).
#[cfg(any(windows, test))]
const WM_QUERYENDSESSION: u32 = 0x0011;
#[cfg(any(windows, test))]
const WM_ENDSESSION: u32 = 0x0016;

/// What the main window does with a message on its way to tao.
#[cfg(any(windows, test))]
#[derive(Debug, PartialEq, Eq)]
enum EndSessionStep {
    /// A logout, restart or shutdown asks whether the app may end: save first.
    Save,
    /// The session end did not happen (another app cancelled it).
    Cancelled,
    /// Anything else, including the session end going ahead: tao's hidden
    /// event-target window ends the event loop, which runs the exit, and then
    /// exits the process, whichever window hears it first. The save is already
    /// done by then: Windows sends every window `WM_QUERYENDSESSION`, which
    /// holds for the save, before it sends any `WM_ENDSESSION`.
    Pass,
}

#[cfg(any(windows, test))]
fn end_session_step(message: u32, wparam: usize) -> EndSessionStep {
    match (message, wparam) {
        (WM_QUERYENDSESSION, _) => EndSessionStep::Save,
        (WM_ENDSESSION, 0) => EndSessionStep::Cancelled,
        _ => EndSessionStep::Pass,
    }
}

/// The session-end save in flight: the window's report settles it. Once an OS
/// session end has begun, exit skips its waits that are not the user's save.
#[derive(Default)]
pub struct SessionEnd {
    pending: Mutex<SessionAttempt>,
    ending: AtomicBool,
}

#[derive(Default)]
struct SessionAttempt {
    id: u32,
    active: bool,
    reports: Vec<mpsc::SyncSender<()>>,
}

impl SessionEnd {
    fn begin(&self) -> (mpsc::Receiver<()>, u32, bool) {
        self.ending.store(true, Ordering::Relaxed);
        let (saved, report) = mpsc::sync_channel(1);
        let mut pending = self.pending.lock().unwrap_or_else(PoisonError::into_inner);
        let first = !pending.active;
        if first {
            pending.id = pending.id.wrapping_add(1);
            pending.active = true;
        }
        if !first && pending.reports.is_empty() {
            // This attempt already reported; repeated native requests neither
            // recapture input nor restart its deadline.
            let _ = saved.try_send(());
        } else {
            pending.reports.push(saved);
        }
        (report, pending.id, first)
    }

    fn finish(&self, attempt: u32) {
        let mut pending = self.pending.lock().unwrap_or_else(PoisonError::into_inner);
        if !pending.active || pending.id != attempt { return; }
        for saved in pending.reports.drain(..) {
            let _ = saved.try_send(());
        }
    }

    /// Whether this exit is an OS logout, restart or shutdown, when exit does
    /// not wait for pending backup history (data-backup conventions).
    pub fn ending(&self) -> bool {
        self.ending.load(Ordering::Relaxed)
    }

    /// The session end did not happen (Windows: another app cancelled it), so
    /// a later exit is an ordinary one again.
    #[cfg_attr(not(windows), allow(dead_code))]
    fn cancel(&self) {
        let mut pending = self.pending.lock().unwrap_or_else(PoisonError::into_inner);
        pending.active = false;
        pending.reports.clear();
        self.ending.store(false, Ordering::Relaxed);
    }
}

/// Asks the main window to save for an OS session end. The receiver hears when
/// it has; `None` when there is no window to ask. The request that asks fixes
/// the exit's deadline, which is how long the save is waited for.
fn begin_session_end<R: Runtime>(app: &AppHandle<R>) -> Option<(mpsc::Receiver<()>, bool)> {
    app.get_webview_window("main")?;
    let begun = ask_for_session_save(&app.state::<SessionEnd>(), |attempt| {
        app.emit_to("main", SESSION_ENDING_EVENT, attempt)
    });
    if let Some((_, true)) = begun {
        app.state::<ExitDeadline>().set(Some(Instant::now() + EXIT_DEADLINE));
    }
    begun
}

/// Admits a session-end save. Only the request that begins the attempt asks
/// the window; the bool says whether this request did. An attempt the window
/// could not be asked for is settled at once.
fn ask_for_session_save<E: std::fmt::Display>(
    session_end: &SessionEnd,
    ask_window: impl FnOnce(u32) -> Result<(), E>,
) -> Option<(mpsc::Receiver<()>, bool)> {
    let (saved, attempt, first) = session_end.begin();
    if !first { return Some((saved, false)); }
    match ask_window(attempt) {
        Ok(()) => Some((saved, true)),
        Err(error) => {
            logging::warn(
                "session end save not requested",
                json!({ "error": error.to_string() }),
            );
            session_end.finish(attempt);
            None
        }
    }
}

fn log_session_save_expired() {
    logging::warn(
        "session end save unfinished at the exit deadline",
        json!({ "ms": EXIT_DEADLINE.as_millis() }),
    );
}

/// The window's report that its session-end save has finished, whatever its
/// outcome; failures are logged on the window's side.
#[tauri::command]
pub fn session_end_saved(session_end: State<SessionEnd>, attempt: u32) {
    session_end.finish(attempt);
}

/// The quit save-failure question's text, in the interface language.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuitQuestion {
    title: String,
    body: String,
    retry: String,
    quit_anyway: String,
    cancel: String,
}

/// The choice a standalone dialog's answer stands for. Closing the dialog
/// without a button is Cancel, the safe path.
fn quit_choice(result: &MessageDialogResult, question: &QuitQuestion) -> &'static str {
    match result {
        MessageDialogResult::Yes => "retry",
        MessageDialogResult::No => "quitAnyway",
        MessageDialogResult::Custom(label) if *label == question.retry => "retry",
        MessageDialogResult::Custom(label) if *label == question.quit_anyway => "quitAnyway",
        _ => "cancel",
    }
}

/// Asks the quit save-failure question as a standalone dialog, for a main
/// window that is minimized or hidden: a question never attaches to a hidden
/// window or brings it back (window conventions, Background visibility and
/// activation). Waits on a worker thread until the user answers.
#[tauri::command]
pub async fn ask_quit_save_failure_standalone<R: Runtime>(
    app: AppHandle<R>,
    question: QuitQuestion,
) -> Result<&'static str, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let result = app
            .dialog()
            .message(&question.body)
            .title(&question.title)
            .kind(MessageDialogKind::Warning)
            .buttons(MessageDialogButtons::YesNoCancelCustom(
                question.retry.clone(),
                question.quit_anyway.clone(),
                question.cancel.clone(),
            ))
            .blocking_show_with_result();
        quit_choice(&result, &question)
    })
    .await
    .map_err(|error| error.to_string())
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
        answer_terminate, begin_session_end, log_session_save_expired, quit_origin, request_quit,
        ExitDeadline, TerminateAnswer,
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
        let has_main = app.get_webview_window("main").is_some();
        let (event_id, has_quit_reason) = current_quit_event();
        let answer = answer_terminate(
            has_main,
            quit_origin(event_id, has_quit_reason),
            || request_quit(app),
            || begin_session_end(app),
        );
        match answer {
            TerminateAnswer::Now => TERMINATE_NOW,
            TerminateAnswer::Cancel => TERMINATE_CANCEL,
            TerminateAnswer::Later(None) => TERMINATE_LATER,
            TerminateAnswer::Later(Some(saved)) => {
                let app = app.clone();
                let wait = app.state::<ExitDeadline>().remaining();
                std::thread::spawn(move || {
                    if let Err(RecvTimeoutError::Timeout) = saved.recv_timeout(wait) {
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
    //! so its IPC keeps running, until the exit's deadline.

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
                TranslateMessage, MSG, PM_REMOVE, QS_ALLINPUT, WM_QUIT,
            },
        },
    };

    use super::{
        begin_session_end, end_session_step, log_session_save_expired, EndSessionStep,
        ExitDeadline, SessionEnd,
    };
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
        let step = end_session_step(message, wparam.0);
        if step != EndSessionStep::Pass {
            // SAFETY: `data` is the AppHandle `install` leaked for this window.
            let app = unsafe { &*(data as *const AppHandle) };
            if step == EndSessionStep::Save {
                if let Some((saved, true)) = begin_session_end(app) {
                    pump_until_saved(&saved, app.state::<ExitDeadline>().get());
                }
            } else {
                app.state::<SessionEnd>().cancel();
                app.state::<ExitDeadline>().set(None);
            }
        }
        // SAFETY: forwards the message this subclass received.
        unsafe { DefSubclassProc(hwnd, message, wparam, lparam) }
    }

    pub(super) fn pump_until_saved(saved: &mpsc::Receiver<()>, deadline: Instant) {
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
