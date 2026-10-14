use super::*;
use crate::i18n;

const PLATFORMS: [(&str, bool); 2] = [("macOS", true), ("Windows", false)];

fn titled<'a>(menus: &'a [SubmenuLayout], title: Title) -> &'a SubmenuLayout {
    menus
        .iter()
        .find(|submenu| submenu.title == title)
        .unwrap_or_else(|| panic!("no {title:?} menu"))
}

fn holding(menus: &[SubmenuLayout], entry: Entry) -> Vec<Title> {
    menus
        .iter()
        .flat_map(|submenu| {
            submenu
                .entries
                .iter()
                .filter(move |&&held| held == entry)
                .map(|_| submenu.title)
        })
        .collect()
}

#[test]
fn every_menu_key_is_in_every_language() {
    for (platform, mac) in PLATFORMS {
        let mut keys = Vec::new();
        for submenu in layout(mac) {
            if let Title::Text(key) = submenu.title {
                keys.push(key);
            }
            keys.extend(submenu.entries.iter().filter_map(|&entry| label_key(entry, mac)));
        }
        for language in i18n::LANGUAGES {
            let text = i18n::catalogue(language);
            for key in &keys {
                assert!(text.has(key), "{language} lacks {key} ({platform})");
            }
        }
    }
}

// The one Quit is QuickDeck's own item, which saves before quitting.
#[test]
fn quit_appears_once_in_the_platforms_place_with_its_platform_name() {
    let mac = layout(true);
    assert_eq!(holding(&mac, Entry::Quit), [Title::AppName]);
    assert_eq!(label_key(Entry::Quit, true), Some("nativeMenu.quit"));

    let windows = layout(false);
    assert_eq!(holding(&windows, Entry::Quit), [Title::Text("nativeMenu.file")]);
    assert_eq!(label_key(Entry::Quit, false), Some("nativeMenu.exit"));
}

#[test]
fn about_is_in_the_app_menu_on_the_mac_and_in_help_on_windows() {
    assert_eq!(holding(&layout(true), Entry::About), [Title::AppName]);
    assert_eq!(holding(&layout(false), Entry::About), [Title::Text("nativeMenu.help")]);
}

#[test]
fn only_the_mac_has_the_app_menu_services_hide_and_full_screen() {
    let windows = layout(false);
    assert!(windows.iter().all(|submenu| submenu.title != Title::AppName));
    for entry in [Entry::Services, Entry::Hide, Entry::HideOthers, Entry::Fullscreen] {
        assert_eq!(holding(&layout(true), entry).len(), 1, "{entry:?} on the Mac");
        assert!(holding(&windows, entry).is_empty(), "{entry:?} on Windows");
    }
}

#[test]
fn the_maximize_item_is_zoom_on_the_mac() {
    assert_eq!(label_key(Entry::Maximize, true), Some("nativeMenu.zoom"));
    assert_eq!(label_key(Entry::Maximize, false), Some("nativeMenu.maximize"));
}

#[test]
fn window_and_help_carry_the_predefined_ids_on_both_platforms() {
    for (platform, mac) in PLATFORMS {
        let menus = layout(mac);
        assert_eq!(titled(&menus, Title::Text("nativeMenu.window")).id, Some(WINDOW_SUBMENU_ID), "{platform}");
        assert_eq!(titled(&menus, Title::Text("nativeMenu.help")).id, Some(HELP_SUBMENU_ID), "{platform}");
        let with_ids = menus.iter().filter(|submenu| submenu.id.is_some()).count();
        assert_eq!(with_ids, 2, "{platform}");
    }
}

#[test]
fn every_platform_has_editing_and_window_commands() {
    for (platform, mac) in PLATFORMS {
        let menus = layout(mac);
        for entry in [
            Entry::Undo,
            Entry::Redo,
            Entry::Cut,
            Entry::Copy,
            Entry::Paste,
            Entry::SelectAll,
            Entry::Minimize,
            Entry::Maximize,
        ] {
            assert_eq!(holding(&menus, entry).len(), 1, "{entry:?} on {platform}");
        }
        assert_eq!(holding(&menus, Entry::CloseWindow).len(), 2, "{platform}");
    }
}
