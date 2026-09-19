//! The interface language, resolved natively (fleet localization). The webview
//! and the native menu speak the same language: the frontend's catalogues in
//! src/i18n/locales are embedded here, and this module resolves the saved
//! choice — "system" or a language tag — the same way the frontend's
//! normalizeLanguagePreference does.
//!
//! The computer's language is read once, at launch, before anything can
//! override it; System resolves against that reading for the whole session.

use std::path::Path;
use std::sync::Mutex;

use serde_json::{Map, Value as JsonValue};

/// The supported tags, in the frontend's LANGUAGES order.
pub const LANGUAGES: [&str; 10] = ["en", "de", "es", "fr", "it", "pt-BR", "ru", "ja", "ko", "zh-Hans"];

const CATALOGUES: [(&str, &str); 10] = [
    ("en", include_str!("../../src/i18n/locales/en.json")),
    ("de", include_str!("../../src/i18n/locales/de.json")),
    ("es", include_str!("../../src/i18n/locales/es.json")),
    ("fr", include_str!("../../src/i18n/locales/fr.json")),
    ("it", include_str!("../../src/i18n/locales/it.json")),
    ("pt-BR", include_str!("../../src/i18n/locales/pt-BR.json")),
    ("ru", include_str!("../../src/i18n/locales/ru.json")),
    ("ja", include_str!("../../src/i18n/locales/ja.json")),
    ("ko", include_str!("../../src/i18n/locales/ko.json")),
    ("zh-Hans", include_str!("../../src/i18n/locales/zh-Hans.json")),
];

/// The supported tag a computer locale resolves to, if any. Every Chinese
/// locale, Taiwan and Hong Kong included, resolves to Simplified Chinese, and
/// every Portuguese one to Brazilian Portuguese.
fn match_locale(locale: &str) -> Option<&'static str> {
    let primary = locale.split(['-', '_', '.', '@']).next()?.to_ascii_lowercase();
    match primary.as_str() {
        "zh" => Some("zh-Hans"),
        "pt" => Some("pt-BR"),
        other => LANGUAGES.iter().copied().find(|tag| *tag == other),
    }
}

/// The computer's language: the first of its preferred locales that resolves
/// to a supported tag, else English.
pub fn system_language<'a>(locales: impl IntoIterator<Item = &'a str>) -> &'static str {
    locales.into_iter().find_map(match_locale).unwrap_or("en")
}

/// A saved preference: `Some(tag)` for a supported tag, `None` (System) for
/// "system" and for anything missing, retired, or hand-edited.
pub fn normalize_preference(value: Option<&str>) -> Option<&'static str> {
    let value = value?;
    LANGUAGES.iter().copied().find(|tag| *tag == value)
}

/// The preference saved in a config.json body; anything unparseable is System.
pub fn saved_preference(config: &str) -> Option<&'static str> {
    let value: JsonValue = serde_json::from_str(config).ok()?;
    normalize_preference(value.get("language")?.as_str())
}

/// Reads the saved choice without touching the file. A missing or unreadable
/// config is System; recovery of a corrupt one stays with the load path.
pub fn read_saved_preference(config_path: &Path) -> Option<&'static str> {
    let text = std::fs::read_to_string(config_path).ok()?;
    saved_preference(&text)
}

/// The language the computer and the saved choice settle on at launch, and the
/// language the native menu currently speaks.
pub struct LanguageState {
    pub system_language: &'static str,
    /// The computer's first preferred locale, for regional date and number
    /// formats in the frontend.
    pub system_locale: Option<String>,
    pub current: Mutex<&'static str>,
}

impl LanguageState {
    /// Reads the computer's languages and the saved choice. Must run before
    /// the macOS override in `align_appkit`, which would otherwise be read back
    /// as the computer's language.
    pub fn detect(config_path: Option<&Path>) -> Self {
        let locales: Vec<String> = sys_locale::get_locales().collect();
        let system_language = system_language(locales.iter().map(String::as_str));
        let preference = config_path.and_then(read_saved_preference);
        LanguageState {
            system_language,
            system_locale: locales.into_iter().next(),
            current: Mutex::new(preference.unwrap_or(system_language)),
        }
    }

    pub fn current(&self) -> &'static str {
        *self.current.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn set_current(&self, language: &'static str) {
        *self.current.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = language;
    }
}

/// One language's catalogue, for the few strings the native side draws.
pub struct Catalogue {
    entries: Map<String, JsonValue>,
    fallback: Map<String, JsonValue>,
}

fn parse(tag: &str) -> Map<String, JsonValue> {
    CATALOGUES
        .iter()
        .find(|(candidate, _)| *candidate == tag)
        .and_then(|(_, text)| serde_json::from_str::<JsonValue>(text).ok())
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default()
}

pub fn catalogue(language: &str) -> Catalogue {
    Catalogue { entries: parse(language), fallback: parse("en") }
}

impl Catalogue {
    #[cfg(test)]
    pub fn has(&self, key: &str) -> bool {
        self.entries.get(key).is_some_and(JsonValue::is_string)
    }

    /// A plain entry with `{app}` filled in. The catalogue gate guarantees every
    /// key in every language; English, then the key itself, only guard a build
    /// that skipped it.
    pub fn text(&self, key: &str, app: &str) -> String {
        self.entries
            .get(key)
            .or_else(|| self.fallback.get(key))
            .and_then(JsonValue::as_str)
            .unwrap_or(key)
            .replace("{app}", app)
    }
}

/// Makes AppKit speak the interface language, so the items macOS adds to the
/// menu bar itself (Emoji & Symbols, Start Dictation, AutoFill, Writing Tools,
/// Services) match it. AppKit settles its language when the application object
/// is created and keeps it for the whole session, so this must run before
/// Tauri builds the app; a language saved later reaches those items at the
/// next launch. The override is volatile — nothing is written to the user's
/// defaults — and it needs the bundle's CFBundleLocalizations to list the tag.
#[cfg(target_os = "macos")]
pub fn align_appkit(language: &str) {
    use objc2::runtime::AnyObject;
    use objc2_foundation::{NSArgumentDomain, NSArray, NSMutableCopying, NSString, NSUserDefaults};

    let defaults = NSUserDefaults::standardUserDefaults();
    // SAFETY: NSArgumentDomain is a constant NSString that Foundation defines.
    let domain_name = unsafe { NSArgumentDomain };
    let domain = defaults.volatileDomainForName(domain_name).mutableCopy();
    let languages = NSArray::from_retained_slice(&[NSString::from_str(language)]);
    let languages: &AnyObject = languages.as_ref();
    domain.insert(&*NSString::from_str("AppleLanguages"), languages);
    // SAFETY: the domain maps NSString keys to property-list objects, as
    // setVolatileDomain:forName: requires.
    unsafe { defaults.setVolatileDomain_forName(&domain, domain_name) };
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn system_language_takes_the_first_supported_preferred_locale() {
        assert_eq!(system_language(["ja-JP", "en-US"]), "ja");
        assert_eq!(system_language(["nl-NL", "de-DE"]), "de");
        assert_eq!(system_language(["en-GB"]), "en");
        assert_eq!(system_language(["es-419"]), "es");
        assert_eq!(system_language(["ru_RU.UTF-8"]), "ru");
    }

    #[test]
    fn every_chinese_locale_resolves_to_simplified_chinese() {
        for locale in ["zh-CN", "zh-Hans-CN", "zh-TW", "zh-Hant-TW", "zh-HK", "zh-Hant-HK", "zh"] {
            assert_eq!(system_language([locale]), "zh-Hans", "{locale}");
        }
    }

    #[test]
    fn every_portuguese_locale_resolves_to_brazilian_portuguese() {
        assert_eq!(system_language(["pt-PT"]), "pt-BR");
        assert_eq!(system_language(["pt-BR"]), "pt-BR");
    }

    #[test]
    fn an_unsupported_or_empty_list_falls_back_to_english() {
        assert_eq!(system_language(["nl-NL", "sv-SE"]), "en");
        assert_eq!(system_language(["C", "POSIX"]), "en");
        assert_eq!(system_language(std::iter::empty()), "en");
    }

    #[test]
    fn preference_normalizes_like_the_frontend() {
        assert_eq!(normalize_preference(Some("ja")), Some("ja"));
        assert_eq!(normalize_preference(Some("zh-Hans")), Some("zh-Hans"));
        assert_eq!(normalize_preference(Some("system")), None);
        assert_eq!(normalize_preference(Some("zh-hans")), None);
        assert_eq!(normalize_preference(Some("xx")), None);
        assert_eq!(normalize_preference(None), None);
    }

    #[test]
    fn saved_preference_reads_the_language_field() {
        assert_eq!(saved_preference(r#"{"language":"de","theme":"dark"}"#), Some("de"));
        assert_eq!(saved_preference(r#"{"language":"system"}"#), None);
        assert_eq!(saved_preference(r#"{"language":7}"#), None);
        assert_eq!(saved_preference(r#"{"theme":"dark"}"#), None);
        assert_eq!(saved_preference("not json"), None);
    }

    #[test]
    fn embeds_exactly_the_catalogues_in_the_locales_folder() {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/i18n/locales");
        let mut on_disk: Vec<String> = std::fs::read_dir(dir)
            .unwrap()
            .filter_map(|entry| {
                let name = entry.unwrap().file_name().into_string().unwrap();
                name.strip_suffix(".json").map(str::to_string)
            })
            .collect();
        on_disk.sort();
        let mut embedded: Vec<String> = CATALOGUES.iter().map(|(tag, _)| tag.to_string()).collect();
        embedded.sort();
        assert_eq!(embedded, on_disk);
        let mut listed: Vec<String> = LANGUAGES.iter().map(|tag| tag.to_string()).collect();
        listed.sort();
        assert_eq!(listed, on_disk);
    }

    #[test]
    fn catalogue_text_fills_in_the_app_name() {
        assert_eq!(catalogue("en").text("nativeMenu.quit", "QuickDeck"), "Quit QuickDeck");
        assert_eq!(catalogue("ja").text("nativeMenu.quit", "QuickDeck"), "QuickDeckを終了");
    }
}
