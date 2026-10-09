use super::*;

const QUIT_APPLICATION: u32 = u32::from_be_bytes(*b"quit");

#[test]
fn a_quit_event_with_a_reason_is_an_os_session_end() {
    assert_eq!(quit_origin(Some(QUIT_APPLICATION), true), QuitOrigin::SessionEnd);
}

#[test]
fn the_docks_quit_carries_no_reason_and_is_the_users() {
    assert_eq!(quit_origin(Some(QUIT_APPLICATION), false), QuitOrigin::User);
}

#[test]
fn a_terminate_without_a_quit_event_is_the_users() {
    assert_eq!(quit_origin(None, false), QuitOrigin::User);
    assert_eq!(quit_origin(Some(u32::from_be_bytes(*b"odoc")), true), QuitOrigin::User);
}

#[test]
fn the_windows_report_settles_the_session_end_it_answers() {
    let session_end = SessionEnd::default();
    let (saved, first) = session_end.begin();
    assert!(first);
    assert!(saved.try_recv().is_err());

    session_end.finish();
    assert!(saved.try_recv().is_ok());
}

#[test]
fn a_report_with_no_session_end_in_flight_does_nothing() {
    let session_end = SessionEnd::default();
    session_end.finish();

    let (saved, first) = session_end.begin();
    assert!(first);
    assert!(saved.try_recv().is_err());
}

#[test]
fn repeated_session_requests_join_the_admitted_save() {
    let session_end = SessionEnd::default();
    let (first, first_owner) = session_end.begin();
    let (second, second_owner) = session_end.begin();
    assert!(first_owner);
    assert!(!second_owner);
    session_end.finish();
    assert!(first.try_recv().is_ok());
    assert!(second.try_recv().is_ok());
    let (_, next_owner) = session_end.begin();
    assert!(next_owner);
}

#[test]
fn only_a_begun_os_session_end_marks_the_exit_as_one() {
    let session_end = SessionEnd::default();
    assert!(!session_end.ending());
    session_end.begin();
    session_end.finish();
    assert!(session_end.ending());
}

// Windows gives each end-session message 5 s before it offers to end the app;
// macOS documents no figure, so the same bound serves both. The backup drain
// is skipped at an OS session end (lib.rs).
#[test]
fn an_os_session_end_fits_under_the_kill_delay() {
    let kill_delay = Duration::from_secs(5);
    let quit = SESSION_SAVE_WAIT + crate::window_placement::SAVE_WAIT + crate::logging::FLUSH_WAIT;
    assert!(quit < kill_delay, "{quit:?} is not under {kill_delay:?}");
}

// The Windows session-end wait pumps the main thread's messages until the save
// reports or its deadline passes; a steady stream of messages must not hold it.
#[cfg(windows)]
mod windows_session_wait {
    use super::*;
    use std::{
        sync::{
            atomic::{AtomicBool, Ordering},
            Arc,
        },
        thread,
        time::Instant,
    };
    use windows::Win32::{
        Foundation::{LPARAM, WPARAM},
        System::Threading::GetCurrentThreadId,
        UI::WindowsAndMessaging::{PeekMessageW, PostThreadMessageW, MSG, PM_NOREMOVE, WM_USER},
    };

    fn under_posted_messages<T>(work: impl FnOnce() -> T) -> T {
        // A thread gets its message queue on its first message call.
        let mut message = MSG::default();
        // SAFETY: plain message calls on this thread, with a valid MSG.
        let target = unsafe {
            let _ = PeekMessageW(&mut message, None, 0, 0, PM_NOREMOVE);
            GetCurrentThreadId()
        };
        let stop = Arc::new(AtomicBool::new(false));
        let poster = {
            let stop = stop.clone();
            thread::spawn(move || {
                while !stop.load(Ordering::Relaxed) {
                    // SAFETY: posts a message with no payload to a live thread.
                    let _ = unsafe { PostThreadMessageW(target, WM_USER, WPARAM(0), LPARAM(0)) };
                    thread::sleep(Duration::from_millis(1));
                }
            })
        };
        let result = work();
        stop.store(true, Ordering::Relaxed);
        poster.join().unwrap();
        result
    }

    #[test]
    fn the_wait_ends_at_its_deadline_under_continuously_posted_messages() {
        let (_report, saved) = mpsc::sync_channel::<()>(1);
        let elapsed = under_posted_messages(|| {
            let started = Instant::now();
            windows_session::pump_until_saved(&saved);
            started.elapsed()
        });
        assert!(elapsed >= SESSION_SAVE_WAIT, "{elapsed:?}");
        assert!(elapsed < SESSION_SAVE_WAIT + Duration::from_millis(500), "{elapsed:?}");
    }

    #[test]
    fn the_wait_ends_when_the_save_reports() {
        let (report, saved) = mpsc::sync_channel::<()>(1);
        let reporter = thread::spawn(move || {
            thread::sleep(Duration::from_millis(100));
            let _ = report.send(());
        });
        let elapsed = under_posted_messages(|| {
            let started = Instant::now();
            windows_session::pump_until_saved(&saved);
            started.elapsed()
        });
        reporter.join().unwrap();
        assert!(elapsed < SESSION_SAVE_WAIT, "{elapsed:?}");
    }
}
