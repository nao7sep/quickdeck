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

// `applicationShouldTerminate:`'s answer, with the window's close and save
// supplied by the test.
fn answer(has_main: bool, origin: QuitOrigin, save: Option<(u32, bool)>) -> (TerminateAnswer<u32>, bool, bool) {
    let routed = std::cell::Cell::new(false);
    let saved = std::cell::Cell::new(false);
    let answer = answer_terminate(
        has_main,
        origin,
        || routed.set(true),
        || {
            saved.set(true);
            save
        },
    );
    (answer, routed.get(), saved.get())
}

#[test]
fn a_terminate_with_no_main_window_exits_at_once() {
    assert_eq!(answer(false, QuitOrigin::User, None), (TerminateAnswer::Now, false, false));
    assert_eq!(
        answer(false, QuitOrigin::SessionEnd, Some((1, true))),
        (TerminateAnswer::Now, false, false)
    );
}

#[test]
fn the_users_quit_is_cancelled_and_routed_through_the_windows_close() {
    assert_eq!(answer(true, QuitOrigin::User, Some((1, true))), (TerminateAnswer::Cancel, true, false));
}

#[test]
fn an_os_session_end_waits_for_the_save_without_prompting() {
    assert_eq!(
        answer(true, QuitOrigin::SessionEnd, Some((7, true))),
        (TerminateAnswer::Later(Some(7)), false, true)
    );
}

#[test]
fn a_repeated_session_end_request_waits_without_owning_the_reply() {
    assert_eq!(
        answer(true, QuitOrigin::SessionEnd, Some((7, false))),
        (TerminateAnswer::Later(None), false, true)
    );
}

#[test]
fn a_session_end_whose_save_cannot_be_asked_for_exits_at_once() {
    assert_eq!(answer(true, QuitOrigin::SessionEnd, None), (TerminateAnswer::Now, false, true));
}

#[test]
fn windows_end_session_messages_save_cancel_or_pass_through() {
    assert_eq!(end_session_step(WM_QUERYENDSESSION, 0), EndSessionStep::Save);
    // ENDSESSION_CLOSEAPP and friends arrive in lParam; wParam is the answer.
    assert_eq!(end_session_step(WM_QUERYENDSESSION, 1), EndSessionStep::Save);
    assert_eq!(end_session_step(WM_ENDSESSION, 0), EndSessionStep::Cancelled);
    // A session end going ahead is tao's to finish: it ends the event loop.
    assert_eq!(end_session_step(WM_ENDSESSION, 1), EndSessionStep::Pass);
    assert_eq!(end_session_step(0x0010 /* WM_CLOSE */, 0), EndSessionStep::Pass);
}

#[test]
fn the_window_is_asked_once_for_each_session_end_attempt() {
    let session_end = SessionEnd::default();
    let mut asked = Vec::new();
    let (saved, first) = ask_for_session_save(&session_end, |attempt| {
        asked.push(attempt);
        Ok::<_, String>(())
    })
    .unwrap();
    assert!(first);
    let (repeated, repeated_first) =
        ask_for_session_save(&session_end, |_| -> Result<(), String> { panic!("asked twice") }).unwrap();
    assert!(!repeated_first);
    assert_eq!(asked.len(), 1);

    session_end.finish(asked[0]);
    assert!(saved.try_recv().is_ok());
    assert!(repeated.try_recv().is_ok());
}

#[test]
fn a_window_that_cannot_be_asked_settles_the_attempt() {
    let session_end = SessionEnd::default();
    assert!(ask_for_session_save(&session_end, |_| Err("no listener")).is_none());
    // The exit goes ahead as a session end; a later request does not wait.
    assert_eq!(session_end.backup_wait(), None);
    let (saved, first) = ask_for_session_save(&session_end, |_| -> Result<(), String> {
        panic!("asked again")
    })
    .unwrap();
    assert!(!first);
    assert!(saved.try_recv().is_ok());
}

// Windows: a cancelled shutdown followed by a fresh one asks the window again.
#[test]
fn a_cancelled_session_end_lets_the_next_one_ask_the_window_again() {
    let session_end = SessionEnd::default();
    let mut asked = Vec::new();
    let _ = ask_for_session_save(&session_end, |attempt| {
        asked.push(attempt);
        Ok::<_, String>(())
    });
    session_end.cancel();
    let (_, first) = ask_for_session_save(&session_end, |attempt| {
        asked.push(attempt);
        Ok::<_, String>(())
    })
    .unwrap();
    assert!(first);
    assert_eq!(asked.len(), 2);
    assert_ne!(asked[0], asked[1]);
}

#[test]
fn exit_waits_for_backups_only_at_an_ordinary_quit() {
    let session_end = SessionEnd::default();
    assert_eq!(session_end.backup_wait(), Some(crate::backup_store::DRAIN_WAIT));
    let _ = session_end.begin();
    assert_eq!(session_end.backup_wait(), None);
    session_end.cancel();
    assert_eq!(session_end.backup_wait(), Some(crate::backup_store::DRAIN_WAIT));
}

fn question() -> QuitQuestion {
    QuitQuestion {
        title: "t".into(),
        body: "b".into(),
        retry: "Retry".into(),
        quit_anyway: "Quit Anyway".into(),
        cancel: "Cancel".into(),
    }
}

#[test]
fn the_standalone_question_maps_its_buttons_and_treats_dismissal_as_cancel() {
    let question = question();
    assert_eq!(quit_choice(&MessageDialogResult::Custom("Retry".into()), &question), "retry");
    assert_eq!(quit_choice(&MessageDialogResult::Custom("Quit Anyway".into()), &question), "quitAnyway");
    assert_eq!(quit_choice(&MessageDialogResult::Custom("Cancel".into()), &question), "cancel");
    assert_eq!(quit_choice(&MessageDialogResult::Yes, &question), "retry");
    assert_eq!(quit_choice(&MessageDialogResult::No, &question), "quitAnyway");
    assert_eq!(quit_choice(&MessageDialogResult::Cancel, &question), "cancel");
}

#[test]
fn the_windows_report_settles_the_session_end_it_answers() {
    let session_end = SessionEnd::default();
    let (saved, attempt, first) = session_end.begin();
    assert!(first);
    assert!(saved.try_recv().is_err());

    session_end.finish(attempt);
    assert!(saved.try_recv().is_ok());
}

#[test]
fn a_report_with_no_session_end_in_flight_does_nothing() {
    let session_end = SessionEnd::default();
    session_end.finish(0);

    let (saved, _attempt, first) = session_end.begin();
    assert!(first);
    assert!(saved.try_recv().is_err());
}

#[test]
fn repeated_session_requests_join_the_admitted_save() {
    let session_end = SessionEnd::default();
    let (first, attempt, first_owner) = session_end.begin();
    let (second, repeated_attempt, second_owner) = session_end.begin();
    assert_eq!(attempt, repeated_attempt);
    assert!(first_owner);
    assert!(!second_owner);
    session_end.finish(attempt);
    assert!(first.try_recv().is_ok());
    assert!(second.try_recv().is_ok());
    let (completed, same_attempt, next_owner) = session_end.begin();
    assert!(!next_owner);
    assert_eq!(attempt, same_attempt);
    assert!(completed.try_recv().is_ok());
}

#[test]
fn only_a_begun_os_session_end_marks_the_exit_as_one() {
    let session_end = SessionEnd::default();
    assert!(!session_end.ending());
    let (_, attempt, _) = session_end.begin();
    session_end.finish(attempt);
    assert!(session_end.ending());
}

#[test]
fn cancellation_retires_an_unanswered_attempt_and_ignores_its_late_report() {
    let session_end = SessionEnd::default();
    let (old_report, old_attempt, _) = session_end.begin();
    session_end.cancel();
    assert!(!session_end.ending());
    assert!(matches!(old_report.try_recv(), Err(mpsc::TryRecvError::Disconnected)));
    let (new_report, new_attempt, first) = session_end.begin();
    assert!(first);
    assert_ne!(old_attempt, new_attempt);
    session_end.finish(old_attempt);
    assert!(matches!(new_report.try_recv(), Err(mpsc::TryRecvError::Empty)));
    session_end.finish(new_attempt);
    assert!(new_report.try_recv().is_ok());
}

#[test]
fn cancellation_after_a_completed_save_allows_a_fresh_shutdown() {
    let session_end = SessionEnd::default();
    let (old_report, old_attempt, _) = session_end.begin();
    session_end.finish(old_attempt);
    assert!(old_report.try_recv().is_ok());
    session_end.cancel();
    assert!(!session_end.ending());

    let (new_report, new_attempt, first) = session_end.begin();
    assert!(first);
    assert!(session_end.ending());
    assert_ne!(old_attempt, new_attempt);
    session_end.finish(old_attempt);
    assert!(matches!(new_report.try_recv(), Err(mpsc::TryRecvError::Empty)));
    session_end.finish(new_attempt);
    assert!(new_report.try_recv().is_ok());
}

// Windows gives each end-session message 5 s before it offers to end the app;
// macOS documents no figure, so the same bound serves both. These are every
// wait between the session end and the process ending (lib.rs, RunEvent::Exit).
#[test]
fn an_os_session_end_fits_under_the_kill_delay() {
    let kill_delay = Duration::from_secs(5);
    let session_end = SessionEnd::default();
    let _ = session_end.begin();
    let quit = SESSION_SAVE_WAIT
        + crate::window_placement::SAVE_WAIT
        + session_end.backup_wait().unwrap_or_default()
        + crate::logging::FLUSH_WAIT;
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
    fn the_end_session_message_values_are_the_win32_ones() {
        use windows::Win32::UI::WindowsAndMessaging as win32;
        assert_eq!(WM_QUERYENDSESSION, win32::WM_QUERYENDSESSION);
        assert_eq!(WM_ENDSESSION, win32::WM_ENDSESSION);
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

// Off Windows the tests above are listed as ignored rather than left out, so a
// run elsewhere shows what it did not cover. Run explicitly, each one fails.
#[cfg(not(windows))]
mod windows_session_wait {
    const WINDOWS_ONLY: &str = "runs only on Windows";

    #[test]
    #[ignore = "Windows only: compares with the windows crate"]
    fn the_end_session_message_values_are_the_win32_ones() {
        panic!("{WINDOWS_ONLY}");
    }

    #[test]
    #[ignore = "Windows only: pumps Win32 messages"]
    fn the_wait_ends_at_its_deadline_under_continuously_posted_messages() {
        panic!("{WINDOWS_ONLY}");
    }

    #[test]
    #[ignore = "Windows only: pumps Win32 messages"]
    fn the_wait_ends_when_the_save_reports() {
        panic!("{WINDOWS_ONLY}");
    }
}
