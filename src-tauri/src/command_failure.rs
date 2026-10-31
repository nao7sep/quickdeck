//! Failures crossing the native bridge retain recovery facts and log ownership.
use serde::Serialize;
use serde_json::{Map, Value};

#[derive(Debug, Serialize)]
pub(crate) struct CommandFailure {
    #[serde(flatten)]
    fields: Map<String, Value>,
}

impl CommandFailure {
    pub(crate) fn recorded(error: impl Serialize + std::fmt::Display) -> Self {
        let mut failure = Self::from(error.to_string());
        if let Ok(Value::Object(fields)) = serde_json::to_value(error) {
            failure.fields.extend(fields);
        }
        failure.fields.insert("logged".into(), Value::Bool(true));
        failure
    }
}

impl From<String> for CommandFailure {
    fn from(message: String) -> Self {
        let mut fields = Map::new();
        fields.insert("message".into(), Value::String(message));
        fields.insert("logged".into(), Value::Bool(false));
        Self { fields }
    }
}

#[cfg(test)]
#[path = "../tests/unit/command_failure.rs"]
mod tests;
