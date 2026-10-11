use quickdeck_lib::theme::{saved_window_theme, window_background, window_theme_for};
use tauri::window::Color;
use tauri::Theme;

#[test]
fn explicit_light_and_dark_pin_the_window_theme() {
    assert_eq!(window_theme_for("light"), Some(Theme::Light));
    assert_eq!(window_theme_for("dark"), Some(Theme::Dark));
}

#[test]
fn system_and_unknown_values_follow_the_os() {
    for preference in ["system", "", "Dark", "sepia"] {
        assert_eq!(window_theme_for(preference), None, "{preference}");
    }
}

#[test]
fn saved_theme_comes_from_the_config_theme_field() {
    assert_eq!(
        saved_window_theme(r#"{"formatVersion":1,"theme":"dark","zen":false}"#),
        Some(Theme::Dark)
    );
    assert_eq!(
        saved_window_theme(r#"{"formatVersion":1,"theme":"light"}"#),
        Some(Theme::Light)
    );
    assert_eq!(
        saved_window_theme(r#"{"formatVersion":1,"theme":"system"}"#),
        None
    );
}

#[test]
fn a_missing_retired_or_corrupt_config_follows_the_os() {
    assert_eq!(saved_window_theme(r#"{"dark":true}"#), None);
    assert_eq!(
        saved_window_theme(r#"{"formatVersion":1,"theme":true}"#),
        None
    );
    assert_eq!(saved_window_theme("{not json"), None);
    assert_eq!(saved_window_theme("[]"), None);
}

#[test]
fn each_theme_has_its_own_window_background() {
    assert_eq!(
        window_background(Theme::Dark),
        Color(0x14, 0x14, 0x19, 0xff)
    );
    assert_eq!(
        window_background(Theme::Light),
        Color(0xec, 0xed, 0xf5, 0xff)
    );
}

#[test]
fn a_config_from_a_newer_build_or_without_its_marker_follows_the_os() {
    assert_eq!(saved_window_theme(r#"{"theme":"dark"}"#), None);
    assert_eq!(
        saved_window_theme(r#"{"formatVersion":1,"theme":"dark"}"#),
        Some(Theme::Dark)
    );
    assert_eq!(
        saved_window_theme(r#"{"formatVersion":2,"theme":"dark"}"#),
        None
    );
}
