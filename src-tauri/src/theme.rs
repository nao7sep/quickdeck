//! The saved appearance choice, applied natively (app-chrome conventions,
//! Theme). The window theme is the one theme authority: it paints the title bar
//! and drives the webview's prefers-color-scheme, which the stylesheet's dark
//! block follows. It is applied before the window is first shown and again on
//! every Save, together with the window background behind the page.

use tauri::window::Color;
use tauri::{Theme, WebviewWindow};

/// The window theme for a saved preference: `Some` for "light" or "dark",
/// `None` (follow the OS) for anything else — the same rule as the frontend's
/// normalizeThemePreference, so a missing, retired, or hand-edited value never
/// pins a theme the frontend would not.
pub fn window_theme_for(preference: &str) -> Option<Theme> {
    match preference {
        "light" => Some(Theme::Light),
        "dark" => Some(Theme::Dark),
        _ => None,
    }
}

/// The window theme from the already parsed launch configuration. Missing or
/// unsupported choices follow the OS.
pub fn saved_window_theme(config: Option<&serde_json::Value>) -> Option<Theme> {
    window_theme_for(config?.get("theme")?.as_str()?)
}

/// The window background behind the page — styles.css's --app-bg in each
/// theme — so the frames before the page paints and the backing exposed while
/// resizing already match.
pub fn window_background(theme: Theme) -> Color {
    match theme {
        Theme::Dark => Color(0x14, 0x14, 0x19, 0xff),
        _ => Color(0xec, 0xed, 0xf5, 0xff),
    }
}

/// Applies a window theme (`None` follows the OS) and the matching background.
pub fn apply(window: &WebviewWindow, theme: Option<Theme>) -> Result<(), String> {
    window.set_theme(theme).map_err(|error| error.to_string())?;
    let effective = match theme {
        Some(theme) => theme,
        None => window.theme().map_err(|error| error.to_string())?,
    };
    window
        .set_background_color(Some(window_background(effective)))
        .map_err(|error| error.to_string())
}

/// The OS appearance, whatever the window is set to: the Settings modal shows it
/// as System's current value, such as "System (Dark)" (app-chrome conventions,
/// Theme). The window's own theme cannot say, since a saved Light or Dark sets
/// the app's appearance too.
pub fn os_theme() -> Theme {
    #[cfg(target_os = "macos")]
    {
        use objc2_foundation::{NSString, NSUserDefaults};
        let style = NSUserDefaults::standardUserDefaults()
            .stringForKey(&NSString::from_str("AppleInterfaceStyle"))
            .map(|style| style.to_string());
        mac_theme(style.as_deref())
    }
    #[cfg(windows)]
    {
        windows_theme(apps_use_light_theme())
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        Theme::Light
    }
}

/// macOS records a dark appearance, including Auto while it is dark, as
/// AppleInterfaceStyle "Dark"; light has no value.
#[cfg(any(target_os = "macos", test))]
fn mac_theme(style: Option<&str>) -> Theme {
    if style == Some("Dark") {
        Theme::Dark
    } else {
        Theme::Light
    }
}

/// Windows records the apps' appearance as AppsUseLightTheme, 0 for dark; a
/// missing value is light, Windows' default.
#[cfg(any(windows, test))]
fn windows_theme(apps_use_light_theme: Option<u32>) -> Theme {
    if apps_use_light_theme == Some(0) {
        Theme::Dark
    } else {
        Theme::Light
    }
}

#[cfg(windows)]
fn apps_use_light_theme() -> Option<u32> {
    use windows::{
        core::w,
        Win32::{
            Foundation::ERROR_SUCCESS,
            System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_DWORD},
        },
    };
    let mut value = 0u32;
    let mut size = std::mem::size_of::<u32>() as u32;
    // SAFETY: reads one DWORD into `value`, whose size `size` states.
    let status = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            w!("Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize"),
            w!("AppsUseLightTheme"),
            RRF_RT_REG_DWORD,
            None,
            Some(&mut value as *mut u32 as *mut core::ffi::c_void),
            Some(&mut size),
        )
    };
    (status == ERROR_SUCCESS).then_some(value)
}

#[cfg(test)]
#[path = "../tests/unit/theme.rs"]
mod tests;
