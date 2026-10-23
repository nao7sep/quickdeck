use super::*;

#[test]
fn revisions_preserve_sibling_fields_and_do_not_advance_on_noop() {
    let state = PresentationState::from_locales(None, &["ja-JP".into()]);
    assert_eq!(state.snapshot().revision, 0);
    let display = state.set_display_preferences("Europe/Berlin".into(), "Example Font".into());
    assert_eq!(display.revision, 1);
    assert_eq!(display.language, "ja");
    let language = state.set_language("de");
    assert_eq!(language.revision, 2);
    assert_eq!(language.display_zone, "Europe/Berlin");
    assert_eq!(language.ui_font_family, "Example Font");
    assert_eq!(language.system_locale.as_deref(), Some("ja-JP"));
    assert_eq!(state.set_language("de").revision, 2);
    assert_eq!(state.set_display_preferences("Europe/Berlin".into(), "Example Font".into()).revision, 2);
}

#[test]
fn startup_choices_share_one_parse_outcome() {
    for text in ["{broken", r#"{"language":"de"}"#, r#"{"formatVersion":2,"language":"de","theme":"dark","displayZone":"UTC","uiFontFamily":"Example"}"#] {
        let config = crate::storage::launch_config(text);
        let state = PresentationState::from_locales(config.as_ref(), &["ja-JP".into()]);
        let snapshot = state.snapshot();
        assert_eq!(snapshot.language, "ja");
        assert_eq!(snapshot.display_zone, "system");
        assert_eq!(snapshot.ui_font_family, "");
        assert_eq!(crate::theme::saved_window_theme(config.as_ref()), None);
    }
    let config = crate::storage::launch_config(r#"{"formatVersion":1,"language":"de","theme":"dark","displayZone":"UTC","uiFontFamily":"Example"}"#);
    let state = PresentationState::from_locales(config.as_ref(), &["ja-JP".into()]);
    assert_eq!(state.snapshot().language, "de");
    assert_eq!(state.snapshot().display_zone, "UTC");
    assert_eq!(state.snapshot().ui_font_family, "Example");
    assert_eq!(crate::theme::saved_window_theme(config.as_ref()), Some(tauri::Theme::Dark));
}

#[test]
fn invalid_current_fields_fall_back_independently() {
    let config = crate::storage::launch_config(r#"{"formatVersion":1,"language":7,"theme":false,"displayZone":false,"uiFontFamily":7}"#);
    let state = PresentationState::from_locales(config.as_ref(), &["ja-JP".into()]);
    assert_eq!(state.snapshot().language, "ja");
    assert_eq!(state.snapshot().display_zone, "system");
    assert_eq!(state.snapshot().ui_font_family, "");
    assert_eq!(crate::theme::saved_window_theme(config.as_ref()), None);
}
