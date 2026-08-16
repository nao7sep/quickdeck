// Contract for the data directory's on-disk filenames.
//
// These constants are the single source of truth for what QuickDeck writes into
// its data directory. This suite pins the volatile UI/window/session state to
// `state.json` and guards it against silently merging with, or drifting into,
// the durable `config.json` or the snapshot store.

use quickdeck_lib::backup_store::BACKUPS_DB_FILE_NAME;
use quickdeck_lib::storage::{CONFIG_FILE_NAME, PANES_FILE_NAME, SNAPSHOTS_DB_FILE_NAME, STATE_FILE_NAME};

#[test]
fn volatile_state_resolves_to_state_json() {
    assert_eq!(STATE_FILE_NAME, "state.json");
}

#[test]
fn durable_config_stays_config_json() {
    assert_eq!(CONFIG_FILE_NAME, "config.json");
}

#[test]
fn pane_content_lives_in_its_own_panes_json() {
    // The user's work product is its own store (persisted-store-separation):
    // never folded back into state.json, so each file can carry the corrupt
    // policy its kind names — panes halt, state quarantines.
    assert_eq!(PANES_FILE_NAME, "panes.json");
}

#[test]
fn snapshot_store_stays_snapshots_sqlite3() {
    assert_eq!(SNAPSHOTS_DB_FILE_NAME, "snapshots.sqlite3");
}

#[test]
fn backup_store_stays_backups_sqlite3() {
    // The write-through backup store's file name, pinned here so it never drifts.
    assert_eq!(BACKUPS_DB_FILE_NAME, "backups.sqlite3");
}

#[test]
fn state_is_separate_from_config_and_snapshots() {
    // Volatile state must never share a file with durable config or the snapshot
    // store — a collision would let throwaway UI state overwrite user settings.
    assert_ne!(STATE_FILE_NAME, CONFIG_FILE_NAME);
    assert_ne!(STATE_FILE_NAME, SNAPSHOTS_DB_FILE_NAME);
    assert_ne!(PANES_FILE_NAME, STATE_FILE_NAME);
    assert_ne!(PANES_FILE_NAME, CONFIG_FILE_NAME);
    assert_ne!(CONFIG_FILE_NAME, SNAPSHOTS_DB_FILE_NAME);
}

#[test]
fn backup_store_is_separate_from_the_snapshot_store_and_the_managed_files() {
    // The write-through backup store is its OWN file, distinct from the snapshot
    // store (a separate recovery mechanism) and from the managed text it captures.
    assert_ne!(BACKUPS_DB_FILE_NAME, SNAPSHOTS_DB_FILE_NAME);
    assert_ne!(BACKUPS_DB_FILE_NAME, CONFIG_FILE_NAME);
    assert_ne!(BACKUPS_DB_FILE_NAME, STATE_FILE_NAME);
}

#[test]
fn no_stale_session_json_name_remains() {
    // The old volatile-state filename is fully retired; nothing should resolve
    // back to it.
    for name in [STATE_FILE_NAME, CONFIG_FILE_NAME, SNAPSHOTS_DB_FILE_NAME] {
        assert_ne!(name, "session.json", "stale session.json name still in use");
    }
}
