//! The native menu, in the interface language. It has the same items as
//! Tauri's default menu, except that Quit (Exit on Windows) is QuickDeck's own
//! item, routed through the main window's close so pane data is saved first.
//! Each platform's menu is a plain table (`layout`), compiled and tested on
//! every platform; `build` only turns the running platform's table into native
//! items.

#[cfg(any(target_os = "macos", target_os = "windows"))]
use tauri::menu::{AboutMetadata, IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
#[cfg(any(target_os = "macos", target_os = "windows", test))]
use tauri::menu::{HELP_SUBMENU_ID, WINDOW_SUBMENU_ID};
#[cfg(any(target_os = "macos", target_os = "windows"))]
use tauri::{AppHandle, Wry};

#[cfg(any(target_os = "macos", target_os = "windows"))]
use crate::i18n;

pub const SAFE_QUIT_MENU_ID: &str = "quickdeck.safe-quit";
pub const CLOSE_WINDOW_MENU_ID: &str = "quickdeck.close-window";

/// The chord QuickDeck's own Close Window item carries where the predefined
/// one lacks Cmd/Ctrl+W: on Windows it binds only Alt+F4, which still works
/// beside it (keyboard-shortcut conventions, Closing a window).
#[cfg(any(target_os = "macos", target_os = "windows", test))]
fn close_window_chord(mac: bool) -> Option<&'static str> {
    (!mac).then_some("Ctrl+W")
}

#[cfg(any(target_os = "macos", target_os = "windows", test))]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Entry {
    About,
    Services,
    Hide,
    HideOthers,
    Quit,
    CloseWindow,
    Undo,
    Redo,
    Cut,
    Copy,
    Paste,
    SelectAll,
    Fullscreen,
    Minimize,
    Maximize,
    Separator,
}

#[cfg(any(target_os = "macos", target_os = "windows", test))]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Title {
    /// The macOS application menu, titled with the app's name.
    AppName,
    /// A catalogue key.
    Text(&'static str),
}

#[cfg(any(target_os = "macos", target_os = "windows", test))]
#[derive(Debug)]
struct SubmenuLayout {
    title: Title,
    /// The predefined Window and Help ids, which macOS uses for the window
    /// list and help search.
    id: Option<&'static str>,
    entries: Vec<Entry>,
}

/// The menu bar on the Mac (`mac`) or on Windows.
#[cfg(any(target_os = "macos", target_os = "windows", test))]
fn layout(mac: bool) -> Vec<SubmenuLayout> {
    use Entry::*;
    let submenu = |title, id, entries| SubmenuLayout { title: Title::Text(title), id, entries };
    let mut menus = Vec::new();
    if mac {
        menus.push(SubmenuLayout {
            title: Title::AppName,
            id: None,
            entries: vec![About, Separator, Services, Separator, Hide, HideOthers, Separator, Quit],
        });
    }
    menus.push(submenu(
        "nativeMenu.file",
        None,
        if mac { vec![CloseWindow] } else { vec![CloseWindow, Quit] },
    ));
    menus.push(submenu(
        "nativeMenu.edit",
        None,
        vec![Undo, Redo, Separator, Cut, Copy, Paste, SelectAll],
    ));
    if mac {
        menus.push(submenu("nativeMenu.view", None, vec![Fullscreen]));
    }
    menus.push(submenu(
        "nativeMenu.window",
        Some(WINDOW_SUBMENU_ID),
        if mac {
            vec![Minimize, Maximize, Separator, CloseWindow]
        } else {
            vec![Minimize, Maximize, CloseWindow]
        },
    ));
    menus.push(submenu(
        "nativeMenu.help",
        Some(HELP_SUBMENU_ID),
        if mac { vec![] } else { vec![About] },
    ));
    menus
}

/// The catalogue key of an entry's label; a separator has none.
#[cfg(any(target_os = "macos", target_os = "windows", test))]
fn label_key(entry: Entry, mac: bool) -> Option<&'static str> {
    Some(match entry {
        Entry::About => "nativeMenu.about",
        Entry::Services => "nativeMenu.services",
        Entry::Hide => "nativeMenu.hide",
        Entry::HideOthers => "nativeMenu.hideOthers",
        Entry::Quit if mac => "nativeMenu.quit",
        Entry::Quit => "nativeMenu.exit",
        Entry::CloseWindow => "nativeMenu.closeWindow",
        Entry::Undo => "nativeMenu.undo",
        Entry::Redo => "nativeMenu.redo",
        Entry::Cut => "nativeMenu.cut",
        Entry::Copy => "nativeMenu.copy",
        Entry::Paste => "nativeMenu.paste",
        Entry::SelectAll => "nativeMenu.selectAll",
        Entry::Fullscreen => "nativeMenu.fullscreen",
        Entry::Minimize => "nativeMenu.minimize",
        Entry::Maximize if mac => "nativeMenu.zoom",
        Entry::Maximize => "nativeMenu.maximize",
        Entry::Separator => return None,
    })
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
pub fn build(app: &AppHandle, language: &str) -> tauri::Result<Menu<Wry>> {
    let mac = cfg!(target_os = "macos");
    let name = app.package_info().name.clone();
    let text = i18n::catalogue(language);
    let config = app.config();
    let about = AboutMetadata {
        name: Some(name.clone()),
        version: Some(app.package_info().version.to_string()),
        copyright: config.bundle.copyright.clone(),
        authors: config
            .bundle
            .publisher
            .clone()
            .map(|publisher| vec![publisher]),
        ..Default::default()
    };
    let submenus = layout(mac)
        .into_iter()
        .map(|submenu| {
            let items = submenu
                .entries
                .iter()
                .map(|&entry| {
                    let label = label_key(entry, mac).map(|key| text.text(key, &name));
                    item(app, entry, label.as_deref(), &about)
                })
                .collect::<tauri::Result<Vec<_>>>()?;
            let items: Vec<&dyn IsMenuItem<Wry>> = items.iter().map(AsRef::as_ref).collect();
            let title = match submenu.title {
                Title::AppName => name.clone(),
                Title::Text(key) => text.text(key, &name),
            };
            match submenu.id {
                Some(id) => Submenu::with_id_and_items(app, id, title, true, &items),
                None => Submenu::with_items(app, title, true, &items),
            }
        })
        .collect::<tauri::Result<Vec<_>>>()?;
    let submenus: Vec<&dyn IsMenuItem<Wry>> = submenus
        .iter()
        .map(|submenu| submenu as &dyn IsMenuItem<Wry>)
        .collect();
    Menu::with_items(app, &submenus)
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn item(
    app: &AppHandle,
    entry: Entry,
    label: Option<&str>,
    about: &AboutMetadata,
) -> tauri::Result<Box<dyn IsMenuItem<Wry>>> {
    Ok(match entry {
        Entry::Quit => Box::new(MenuItem::with_id(
            app,
            SAFE_QUIT_MENU_ID,
            label.unwrap_or_default(),
            true,
            Some("CmdOrCtrl+Q"),
        )?),
        Entry::About => Box::new(PredefinedMenuItem::about(app, label, Some(about.clone()))?),
        Entry::Services => Box::new(PredefinedMenuItem::services(app, label)?),
        Entry::Hide => Box::new(PredefinedMenuItem::hide(app, label)?),
        Entry::HideOthers => Box::new(PredefinedMenuItem::hide_others(app, label)?),
        Entry::CloseWindow => match close_window_chord(cfg!(target_os = "macos")) {
            Some(chord) => Box::new(MenuItem::with_id(
                app,
                CLOSE_WINDOW_MENU_ID,
                label.unwrap_or_default(),
                true,
                Some(chord),
            )?),
            None => Box::new(PredefinedMenuItem::close_window(app, label)?),
        },
        Entry::Undo => Box::new(PredefinedMenuItem::undo(app, label)?),
        Entry::Redo => Box::new(PredefinedMenuItem::redo(app, label)?),
        Entry::Cut => Box::new(PredefinedMenuItem::cut(app, label)?),
        Entry::Copy => Box::new(PredefinedMenuItem::copy(app, label)?),
        Entry::Paste => Box::new(PredefinedMenuItem::paste(app, label)?),
        Entry::SelectAll => Box::new(PredefinedMenuItem::select_all(app, label)?),
        Entry::Fullscreen => Box::new(PredefinedMenuItem::fullscreen(app, label)?),
        Entry::Minimize => Box::new(PredefinedMenuItem::minimize(app, label)?),
        Entry::Maximize => Box::new(PredefinedMenuItem::maximize(app, label)?),
        Entry::Separator => Box::new(PredefinedMenuItem::separator(app)?),
    })
}

#[cfg(test)]
// EXCEPTION to tests-folder conventions: the module is private to the crate, and the tests read
// the private layout table.
#[path = "../tests/unit/menu.rs"]
mod tests;
