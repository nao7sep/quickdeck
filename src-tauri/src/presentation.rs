//! One session owner for the presentation shared by the main and Records windows.
use std::sync::Mutex;

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};

use crate::{i18n, records_window};

pub const PRESENTATION_EVENT: &str = "records-presentation";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PresentationSnapshot {
    pub language: &'static str,
    pub system_locale: Option<String>,
    pub display_zone: String,
    pub ui_font_family: String,
}

pub struct PresentationState {
    pub system_language: &'static str,
    pub system_locale: Option<String>,
    current: Mutex<PresentationSnapshot>,
}

impl PresentationState {
    // Read the OS before align_appkit installs its session override.
    pub fn detect(config: Option<&Value>) -> Self {
        let locales: Vec<String> = sys_locale::get_locales().collect();
        Self::from_locales(config, &locales)
    }

    fn from_locales(config: Option<&Value>, locales: &[String]) -> Self {
        let system_language = i18n::system_language(locales.iter().map(String::as_str));
        let system_locale = locales.first().cloned();
        let field = |name| {
            config
                .and_then(|value| value.get(name))
                .and_then(Value::as_str)
        };
        Self {
            system_language,
            system_locale: system_locale.clone(),
            current: Mutex::new(PresentationSnapshot {
                language: i18n::normalize_preference(field("language")).unwrap_or(system_language),
                system_locale,
                display_zone: field("displayZone").unwrap_or("system").to_owned(),
                ui_font_family: field("uiFontFamily").unwrap_or("").to_owned(),
            }),
        }
    }

    pub fn snapshot(&self) -> PresentationSnapshot {
        self.current
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    pub fn current(&self) -> &'static str {
        self.current
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .language
    }

    pub fn set_language(&self, language: &'static str) -> PresentationSnapshot {
        let mut current = self
            .current
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        current.language = language;
        current.clone()
    }

    pub fn set_display_preferences(&self, zone: String, font: String) -> PresentationSnapshot {
        let mut current = self
            .current
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        current.display_zone = zone;
        current.ui_font_family = font;
        current.clone()
    }
}

/// Sends the Records window the presentation. Every send runs on the main
/// thread (sync commands), so the window hears them in the order they were set.
pub fn notify(app: &AppHandle, snapshot: &PresentationSnapshot) -> Result<(), String> {
    if app.get_webview_window(records_window::LABEL).is_none() {
        return Ok(());
    }
    app.emit_to(records_window::LABEL, PRESENTATION_EVENT, snapshot)
        .map_err(|error| error.to_string())
}

#[cfg(test)]
#[path = "../tests/unit/presentation.rs"]
mod tests;
