use super::*;
use serde_json::json;

#[test]
fn recorded_failures_keep_structured_recovery_facts() {
    let failure = crate::storage::SaveFailure {
        path: Some("/panes.json".into()), newer: Some(99), message: "newer format".into(),
    };
    let result = serde_json::to_value(CommandFailure::recorded(failure)
        .with_config_set_aside(Some("/config.invalid".into()))).unwrap();
    assert_eq!(result, json!({"message":"newer format", "logged":true,
        "path":"/panes.json", "newer":99, "configQuarantinedTo":"/config.invalid"}));
}

#[test]
fn failures_outside_the_logged_boundary_remain_unlogged() {
    assert_eq!(serde_json::to_value(CommandFailure::from("worker stopped".to_string())).unwrap(),
        json!({"message":"worker stopped", "logged":false}));
}
