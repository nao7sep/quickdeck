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
        saved_window_theme(
            quickdeck_lib::storage::launch_config(
                r#"{"formatVersion":1,"theme":"dark","zen":false}"#
            )
            .as_ref()
        ),
        Some(Theme::Dark)
    );
    assert_eq!(
        saved_window_theme(
            quickdeck_lib::storage::launch_config(r#"{"formatVersion":1,"theme":"light"}"#)
                .as_ref()
        ),
        Some(Theme::Light)
    );
    assert_eq!(
        saved_window_theme(
            quickdeck_lib::storage::launch_config(r#"{"formatVersion":1,"theme":"system"}"#)
                .as_ref()
        ),
        None
    );
}

#[test]
fn a_missing_retired_or_corrupt_config_follows_the_os() {
    assert_eq!(
        saved_window_theme(quickdeck_lib::storage::launch_config(r#"{"dark":true}"#).as_ref()),
        None
    );
    assert_eq!(
        saved_window_theme(
            quickdeck_lib::storage::launch_config(r#"{"formatVersion":1,"theme":true}"#).as_ref()
        ),
        None
    );
    assert_eq!(
        saved_window_theme(quickdeck_lib::storage::launch_config("{not json").as_ref()),
        None
    );
    assert_eq!(
        saved_window_theme(quickdeck_lib::storage::launch_config("[]").as_ref()),
        None
    );
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
    assert_eq!(
        saved_window_theme(quickdeck_lib::storage::launch_config(r#"{"theme":"dark"}"#).as_ref()),
        None
    );
    assert_eq!(
        saved_window_theme(
            quickdeck_lib::storage::launch_config(r#"{"formatVersion":1,"theme":"dark"}"#).as_ref()
        ),
        Some(Theme::Dark)
    );
    assert_eq!(
        saved_window_theme(
            quickdeck_lib::storage::launch_config(r#"{"formatVersion":2,"theme":"dark"}"#).as_ref()
        ),
        None
    );
}
