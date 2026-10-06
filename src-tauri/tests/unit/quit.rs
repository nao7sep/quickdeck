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
    let saved = session_end.begin();
    assert!(saved.try_recv().is_err());

    session_end.finish();
    assert!(saved.try_recv().is_ok());
}

#[test]
fn a_report_with_no_session_end_in_flight_does_nothing() {
    let session_end = SessionEnd::default();
    session_end.finish();

    let saved = session_end.begin();
    assert!(saved.try_recv().is_err());
}

#[test]
fn a_late_report_settles_only_the_newest_session_end() {
    let session_end = SessionEnd::default();
    let first = session_end.begin();
    let second = session_end.begin();

    session_end.finish();
    assert!(first.try_recv().is_err());
    assert!(second.try_recv().is_ok());
}

// Windows gives each end-session message 5 s before it offers to end the app;
// macOS documents no figure, so the same bound serves both.
#[test]
fn an_os_session_end_fits_under_the_kill_delay() {
    let kill_delay = Duration::from_secs(5);
    let quit = SESSION_SAVE_WAIT
        + crate::window_placement::SAVE_WAIT
        + crate::archive::EXIT_WAIT
        + crate::logging::FLUSH_WAIT;
    assert!(quit < kill_delay, "{quit:?} is not under {kill_delay:?}");
}
