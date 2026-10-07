use super::*;

#[test]
fn successful_preparation_returns_the_saved_first_frame_choices() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("config.json");
    std::fs::write(&path, r#"{"formatVersion":1,"language":"ja","theme":"dark"}"#).unwrap();
    let config = saved_config(Some(path)).unwrap();
    assert_eq!(crate::i18n::saved_preference(&config), Some("ja"));
    assert_eq!(crate::theme::saved_window_theme(&config), Some(tauri::Theme::Dark));
}

#[test]
fn optional_missing_or_newer_settings_retain_system_first_frame_fallback() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("config.json");
    assert!(saved_config(Some(path.clone())).is_none());
    std::fs::write(&path, r#"{"formatVersion":2,"language":"ja","theme":"dark"}"#).unwrap();
    let config = saved_config(Some(path)).unwrap();
    assert_eq!(crate::i18n::saved_preference(&config), None);
    assert_eq!(crate::theme::saved_window_theme(&config), None);
}

#[test]
fn timeout_discards_a_late_owned_result_without_adopting_it() {
    let (release, held) = mpsc::channel();
    let (dropped, observed) = mpsc::channel();
    struct Claim(mpsc::Sender<()>);
    impl Drop for Claim { fn drop(&mut self) { let _ = self.0.send(()); } }
    let result = prepare("held claim", Duration::from_millis(1), move || {
        held.recv().unwrap();
        Claim(dropped)
    });
    release.send(()).unwrap();
    observed.recv_timeout(Duration::from_secs(1)).unwrap();
    assert!(result.is_err());
}
