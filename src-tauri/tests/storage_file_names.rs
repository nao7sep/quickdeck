// Each store QuickDeck keeps in its data directory has its own file, so no two
// kinds of data, such as throwaway window state and the user's settings or
// text, can overwrite each other.

use quickdeck_lib::backup_store::BACKUPS_DB_FILE_NAME;
use quickdeck_lib::storage::{
    CONFIG_FILE_NAME, PANES_FILE_NAME, RECORDS_DB_FILE_NAME, SNAPSHOTS_DB_FILE_NAME,
    STATE_FILE_NAME, WINDOW_FILE_NAME,
};

#[test]
fn every_store_has_a_file_of_its_own() {
    let names = [
        CONFIG_FILE_NAME,
        STATE_FILE_NAME,
        WINDOW_FILE_NAME,
        PANES_FILE_NAME,
        SNAPSHOTS_DB_FILE_NAME,
        BACKUPS_DB_FILE_NAME,
        RECORDS_DB_FILE_NAME,
    ];
    let distinct: std::collections::BTreeSet<_> = names.iter().collect();
    assert_eq!(distinct.len(), names.len(), "{names:?}");
}
