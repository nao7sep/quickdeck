use super::*;
use serial_test::serial;

#[test]
fn default_root_is_home_dot_quickdeck() {
    let home = PathBuf::from("/home/tester");
    // Unset / empty / whitespace all fall back to the default root.
    assert_eq!(resolve_root(&home, None).unwrap(), home.join(".quickdeck"));
    assert_eq!(resolve_root(&home, Some(String::new())).unwrap(), home.join(".quickdeck"));
    assert_eq!(
        resolve_root(&home, Some("   ".to_string())).unwrap(),
        home.join(".quickdeck")
    );
}

#[test]
fn env_var_relocates_root_to_absolute_path() {
    let home = PathBuf::from("/home/tester");
    assert_eq!(
        resolve_root(&home, Some("/tmp/qd-test".to_string())).unwrap(),
        PathBuf::from("/tmp/qd-test")
    );
}

#[test]
fn env_var_expands_leading_tilde() {
    let home = PathBuf::from("/home/tester");
    assert_eq!(resolve_root(&home, Some("~".to_string())).unwrap(), home);
    assert_eq!(
        resolve_root(&home, Some("~/profiles/work".to_string())).unwrap(),
        home.join("profiles/work")
    );
}

#[test]
fn relative_env_var_resolves_against_home_not_cwd() {
    let home = PathBuf::from("/home/tester");
    assert_eq!(
        resolve_root(&home, Some("alt-root".to_string())).unwrap(),
        home.join("alt-root")
    );
}

#[test]
#[serial(env)]
fn expands_environment_references_in_the_override() {
    let home = PathBuf::from("/home/tester");
    std::env::set_var("QUICKDECK_TEST_BASE", "/mnt/disk2");
    assert_eq!(
        resolve_root(&home, Some("$QUICKDECK_TEST_BASE/qd".to_string())).unwrap(),
        PathBuf::from("/mnt/disk2/qd")
    );
    assert_eq!(
        resolve_root(&home, Some("${QUICKDECK_TEST_BASE}/qd".to_string())).unwrap(),
        PathBuf::from("/mnt/disk2/qd")
    );
    std::env::remove_var("QUICKDECK_TEST_BASE");
}

#[test]
#[serial(env)]
fn override_that_expands_to_empty_is_rejected() {
    let home = PathBuf::from("/home/tester");
    std::env::remove_var("QUICKDECK_UNSET_FOR_TEST");
    assert!(resolve_root(&home, Some("$QUICKDECK_UNSET_FOR_TEST".to_string())).is_err());
}
