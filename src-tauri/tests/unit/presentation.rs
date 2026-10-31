use super::*;

#[test]
fn each_change_keeps_its_sibling_fields() {
    let state = PresentationState::from_locales(None, &["ja-JP".into()]);
    let display = state.set_display_preferences("Europe/Berlin".into(), "Example Font".into());
    assert_eq!(display.language, "ja");
    let language = state.set_language("de");
    assert_eq!(language.display_zone, "Europe/Berlin");
    assert_eq!(language.ui_font_family, "Example Font");
    assert_eq!(language.system_locale.as_deref(), Some("ja-JP"));
}

#[test]
fn startup_choices_share_one_parse_outcome() {
    for text in [
        "{broken",
        r#"{"language":"de"}"#,
        r#"{"format":{"owner":"quickdeck","kind":"config","version":2},"writer":{"name":"quickdeck","version":"1.0.0"},"language":"de","theme":"dark","displayZone":"UTC","uiFontFamily":"Example"}"#,
    ] {
        let config = crate::storage::launch_config(text);
        let state = PresentationState::from_locales(config.as_ref(), &["ja-JP".into()]);
        let snapshot = state.snapshot();
        assert_eq!(snapshot.language, "ja");
        assert_eq!(snapshot.display_zone, "system");
        assert_eq!(snapshot.ui_font_family, "");
        assert_eq!(crate::theme::saved_window_theme(config.as_ref()), None);
    }
    let config = crate::storage::launch_config(
        r#"{"format":{"owner":"quickdeck","kind":"config","version":1},"writer":{"name":"quickdeck","version":"1.0.0"},"language":"de","theme":"dark","displayZone":"UTC","uiFontFamily":"Example"}"#,
    );
    let state = PresentationState::from_locales(config.as_ref(), &["ja-JP".into()]);
    assert_eq!(state.snapshot().language, "de");
    assert_eq!(state.snapshot().display_zone, "UTC");
    assert_eq!(state.snapshot().ui_font_family, "Example");
    assert_eq!(
        crate::theme::saved_window_theme(config.as_ref()),
        Some(tauri::Theme::Dark)
    );
}

#[test]
fn invalid_current_fields_fall_back_independently() {
    let config = crate::storage::launch_config(
        r#"{"format":{"owner":"quickdeck","kind":"config","version":1},"writer":{"name":"quickdeck","version":"1.0.0"},"language":7,"theme":false,"displayZone":false,"uiFontFamily":7}"#,
    );
    let state = PresentationState::from_locales(config.as_ref(), &["ja-JP".into()]);
    assert_eq!(state.snapshot().language, "ja");
    assert_eq!(state.snapshot().display_zone, "system");
    assert_eq!(state.snapshot().ui_font_family, "");
    assert_eq!(crate::theme::saved_window_theme(config.as_ref()), None);
}
