use super::*;

#[test]
fn macos_reads_dark_only_from_a_dark_interface_style() {
    assert_eq!(mac_theme(Some("Dark")), Theme::Dark);
    assert_eq!(mac_theme(None), Theme::Light);
    assert_eq!(mac_theme(Some("Light")), Theme::Light);
}

#[test]
fn windows_reads_dark_only_from_apps_use_light_theme_zero() {
    assert_eq!(windows_theme(Some(0)), Theme::Dark);
    assert_eq!(windows_theme(Some(1)), Theme::Light);
    assert_eq!(windows_theme(None), Theme::Light);
}
