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

// Storage-path-conventions: the root is owner-only (0700) on POSIX — created
// that way, and tightened to 0700 at each launch when an existing root is
// broader. Both cases are exercised here against a throwaway QUICKDECK_HOME,
// driving the same `secure_root` step `app_data_dir` runs on every launch.
#[cfg(unix)]
#[test]
fn new_root_is_created_owner_only() {
    use std::os::unix::fs::PermissionsExt;

    let base = tempfile::tempdir().unwrap();
    let root = base.path().join("quickdeck-home"); // acts as a throwaway QUICKDECK_HOME
    fs::create_dir_all(&root).unwrap();

    secure_root(&root).unwrap();

    let mode = fs::metadata(&root).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode, 0o700);
}

// A freshly created root must be born owner-only, not merely tightened
// afterward — otherwise a broad umask (e.g. 022) leaves it briefly
// world-readable between creation and the `secure_root` tightening step.
#[cfg(unix)]
#[test]
fn create_data_dir_creates_a_fresh_dir_owner_only() {
    use std::os::unix::fs::PermissionsExt;

    let base = tempfile::tempdir().unwrap();
    let dir = base.path().join("quickdeck-home").join(".quickdeck");

    create_data_dir(&dir).unwrap();

    let mode = fs::metadata(&dir).unwrap().permissions().mode() & 0o777;
    assert_eq!(
        mode, 0o700,
        "the data dir must be created owner-only, not just tightened after the fact"
    );
}

#[cfg(unix)]
#[test]
fn existing_broader_root_is_tightened_on_launch() {
    use std::os::unix::fs::PermissionsExt;

    let base = tempfile::tempdir().unwrap();
    let root = base.path().join("quickdeck-home"); // acts as a throwaway QUICKDECK_HOME
    fs::create_dir_all(&root).unwrap();
    // Simulate a pre-existing root that is broader than owner-only, e.g. left
    // over from before this rule, or created with a permissive umask.
    fs::set_permissions(&root, fs::Permissions::from_mode(0o755)).unwrap();
    assert_eq!(fs::metadata(&root).unwrap().permissions().mode() & 0o777, 0o755);

    secure_root(&root).unwrap();

    let mode = fs::metadata(&root).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode, 0o700);
}
