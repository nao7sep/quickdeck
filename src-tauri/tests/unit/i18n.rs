use std::path::Path;
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
    for locale in [
        "zh-CN",
        "zh-Hans-CN",
        "zh-TW",
        "zh-Hant-TW",
        "zh-HK",
        "zh-Hant-HK",
        "zh",
    ] {
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
    assert_eq!(
        catalogue("en").text("nativeMenu.quit", "QuickDeck"),
        "Quit QuickDeck"
    );
    assert_eq!(
        catalogue("ja").text("nativeMenu.quit", "QuickDeck"),
        "QuickDeckを終了"
    );
}

// The override lives in the argument domain, which outranks the user's saved
// languages and is never written to disk; anything else there is kept.
#[cfg(target_os = "macos")]
#[test]
fn appkit_takes_the_interface_language_from_a_volatile_override() {
    use objc2_foundation::{NSArgumentDomain, NSMutableCopying, NSString, NSUserDefaults};

    let defaults = NSUserDefaults::standardUserDefaults();
    // SAFETY: NSArgumentDomain is a constant NSString that Foundation defines.
    let domain_name = unsafe { NSArgumentDomain };
    let before = defaults.volatileDomainForName(domain_name);
    let marker = NSString::from_str("QuickDeckTestMarker");
    let with_marker = before.mutableCopy();
    with_marker.insert(&*marker, &*NSString::from_str("kept"));
    // SAFETY: NSString keys to property-list values, as the method requires.
    unsafe { defaults.setVolatileDomain_forName(&with_marker, domain_name) };

    let languages = || {
        defaults
            .stringArrayForKey(&NSString::from_str("AppleLanguages"))
            .map(|languages| languages.iter().map(|language| language.to_string()).collect::<Vec<_>>())
    };
    align_appkit("ja");
    assert_eq!(languages(), Some(vec!["ja".to_string()]));
    align_appkit("de");
    assert_eq!(languages(), Some(vec!["de".to_string()]));
    assert!(defaults.volatileDomainForName(domain_name).objectForKey(&marker).is_some());

    // SAFETY: as above; restores the domain this test found.
    unsafe { defaults.setVolatileDomain_forName(&before, domain_name) };
}
