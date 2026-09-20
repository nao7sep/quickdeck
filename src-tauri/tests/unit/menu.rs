const KEYS: [&str; 22] = [
    "nativeMenu.about",
    "nativeMenu.services",
    "nativeMenu.hide",
    "nativeMenu.hideOthers",
    "nativeMenu.quit",
    "nativeMenu.exit",
    "nativeMenu.file",
    "nativeMenu.closeWindow",
    "nativeMenu.edit",
    "nativeMenu.undo",
    "nativeMenu.redo",
    "nativeMenu.cut",
    "nativeMenu.copy",
    "nativeMenu.paste",
    "nativeMenu.selectAll",
    "nativeMenu.view",
    "nativeMenu.fullscreen",
    "nativeMenu.window",
    "nativeMenu.minimize",
    "nativeMenu.zoom",
    "nativeMenu.maximize",
    "nativeMenu.help",
];

use super::*;

#[test]
fn every_menu_key_is_in_every_language() {
    for language in i18n::LANGUAGES {
        let text = i18n::catalogue(language);
        for key in KEYS {
            assert!(text.has(key), "{language} lacks {key}");
        }
    }
}
