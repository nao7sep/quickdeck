use std::{
    collections::BTreeMap,
    path::Path,
    sync::{
        mpsc::{self, RecvTimeoutError},
        Arc, Mutex,
    },
    time::Duration,
};

use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use tauri::{AppHandle, PhysicalPosition, PhysicalSize, Window, WindowEvent, Wry};

use crate::{logging, storage};

// How long exit waits for window.json before going on without it; part of the
// quit's budget (src/quit.rs).
pub(crate) const SAVE_WAIT: Duration = Duration::from_millis(500);

/// The durable windows, by label: each keeps its own placement in window.json,
/// which holds one record per label (window conventions, Placement).
pub const DURABLE_WINDOWS: [&str; 2] = ["main", "records"];

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalRectangle {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Placement {
    pub normal: NormalRectangle,
    pub maximized: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ClosingState {
    Normal(NormalRectangle),
    Maximized,
    Transient,
}

pub fn placement_after_close(
    previous: Option<Placement>,
    closing: ClosingState,
    remember_maximized: bool,
) -> Option<Placement> {
    match closing {
        ClosingState::Normal(normal) => Some(Placement {
            normal,
            maximized: false,
        }),
        ClosingState::Maximized => previous.map(|placement| Placement {
            normal: placement.normal,
            maximized: remember_maximized,
        }),
        ClosingState::Transient => previous,
    }
}

pub type Placements = BTreeMap<String, Placement>;

/// The placements window.json holds. A file that is not one record per label,
/// such as the single record window.json held before the Records window
/// existed, is discarded as a unit.
pub fn placements_from(value: Option<JsonValue>) -> Placements {
    value
        .and_then(|value| serde_json::from_value::<Placements>(value).ok())
        .unwrap_or_default()
}

pub type PlacementState = Arc<Mutex<Placements>>;

pub fn new_state() -> PlacementState {
    Arc::new(Mutex::new(Placements::new()))
}

fn current_normal_rectangle(window: &Window<Wry>) -> tauri::Result<NormalRectangle> {
    let position = window.outer_position()?;
    let size = window.inner_size()?;
    Ok(NormalRectangle {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    })
}

fn is_usable(window: &Window<Wry>, rectangle: NormalRectangle) -> tauri::Result<bool> {
    if rectangle.width == 0 || rectangle.height == 0 {
        return Ok(false);
    }

    let left = i64::from(rectangle.x);
    let top = i64::from(rectangle.y);
    let right = left + i64::from(rectangle.width);
    let bottom = top + i64::from(rectangle.height);
    Ok(window.available_monitors()?.iter().any(|monitor| {
        let area = monitor.work_area();
        let area_left = i64::from(area.position.x);
        let area_top = i64::from(area.position.y);
        let area_right = area_left + i64::from(area.size.width);
        let area_bottom = area_top + i64::from(area.size.height);
        left < area_right && right > area_left && top < area_bottom && bottom > area_top
    }))
}

fn replace_state(state: &PlacementState, label: &str, placement: Option<Placement>) {
    match state.lock() {
        Ok(mut current) => match placement {
            Some(placement) => {
                current.insert(label.to_string(), placement);
            }
            None => {
                current.remove(label);
            }
        },
        Err(error) => logging::warn(
            "window placement lock is unavailable",
            serde_json::json!({ "error": error.to_string() }),
        ),
    }
}

// Reads window.json once, in setup, on the main thread: the main window's
// placement must be applied before it is first shown (window conventions), and
// the Records window, opened later, takes its own from what was read here.
pub(crate) fn load(app: &AppHandle, state: &PlacementState) {
    let saved = match storage::load_window_state(app) {
        Ok(value) => placements_from(value),
        Err(error) => {
            logging::warn(
                "window placement could not be loaded",
                serde_json::json!({ "error": error }),
            );
            Placements::new()
        }
    };
    match state.lock() {
        Ok(mut current) => *current = saved,
        Err(error) => logging::warn(
            "window placement lock is unavailable",
            serde_json::json!({ "error": error.to_string() }),
        ),
    }
}

// Applies the window's saved placement while it is still hidden.
pub(crate) fn restore(window: &Window<Wry>, state: &PlacementState) {
    let label = window.label().to_string();
    let fallback = current_normal_rectangle(window)
        .ok()
        .map(|normal| Placement {
            normal,
            maximized: false,
        });
    let saved = state
        .lock()
        .ok()
        .and_then(|current| current.get(&label).copied());

    let usable = saved.and_then(|placement| match is_usable(window, placement.normal) {
        Ok(true) => Some(placement),
        Ok(false) => None,
        Err(error) => {
            logging::warn(
                "window placement could not be validated",
                serde_json::json!({ "error": error.to_string() }),
            );
            None
        }
    });

    let mut restored = fallback;
    if let Some(placement) = usable {
        let normal = placement.normal;
        let result = window
            .set_position(PhysicalPosition::new(normal.x, normal.y))
            .and_then(|()| window.set_size(PhysicalSize::new(normal.width, normal.height)));
        if let Err(error) = result {
            logging::warn(
                "window placement could not be restored",
                serde_json::json!({ "error": error.to_string() }),
            );
            if let Some(default) = fallback {
                let _ =
                    window.set_position(PhysicalPosition::new(default.normal.x, default.normal.y));
                let _ = window.set_size(PhysicalSize::new(
                    default.normal.width,
                    default.normal.height,
                ));
            }
        } else {
            restored = Some(Placement {
                normal,
                maximized: cfg!(target_os = "windows") && placement.maximized,
            });
            if cfg!(target_os = "windows") && placement.maximized {
                if let Err(error) = window.maximize() {
                    logging::warn(
                        "maximized window state could not be restored",
                        serde_json::json!({ "error": error.to_string() }),
                    );
                }
            }
        }
    }
    replace_state(state, &label, restored);
}

pub(crate) fn capture(window: &Window<Wry>, state: &PlacementState) {
    let closing = (|| -> tauri::Result<ClosingState> {
        if window.is_minimized()? || window.is_fullscreen()? {
            return Ok(ClosingState::Transient);
        }
        if window.is_maximized()? {
            return Ok(ClosingState::Maximized);
        }
        Ok(ClosingState::Normal(current_normal_rectangle(window)?))
    })();

    match closing {
        Ok(closing) => {
            let label = window.label();
            let previous = state
                .lock()
                .ok()
                .and_then(|current| current.get(label).copied());
            replace_state(
                state,
                label,
                placement_after_close(previous, closing, cfg!(target_os = "windows")),
            );
        }
        Err(error) => logging::warn(
            "window placement could not be captured",
            serde_json::json!({ "error": error.to_string() }),
        ),
    }
}

pub(crate) fn on_window_event(window: &Window<Wry>, event: &WindowEvent, state: &PlacementState) {
    if DURABLE_WINDOWS.contains(&window.label())
        && matches!(event, WindowEvent::CloseRequested { .. })
    {
        capture(window, state);
    }
}

// The exit write runs on its own thread so a stalled data volume
// cannot hold the quit for longer than `SAVE_WAIT` (PLAYBOOK, "Bound every
// external wait"). It writes into the root resolved at launch, and a data
// folder deleted while the app runs stays deleted.
pub fn save(root: &Path, state: &PlacementState) {
    let Some(placements) = state
        .lock()
        .ok()
        .map(|current| current.clone())
        .filter(|current| !current.is_empty())
    else {
        return;
    };
    let root = root.to_owned();
    let (done, finished) = mpsc::channel();
    std::thread::spawn(move || {
        write_placements(&root, placements);
        let _ = done.send(());
    });
    if let Err(RecvTimeoutError::Timeout) = finished.recv_timeout(SAVE_WAIT) {
        logging::warn(
            "window placement save wait expired",
            serde_json::json!({ "ms": SAVE_WAIT.as_millis() }),
        );
    }
}

fn write_placements(root: &Path, placements: Placements) {
    match root.try_exists() {
        Ok(true) => {}
        Ok(false) => {
            return logging::warn(
                "window placement save skipped",
                serde_json::json!({ "path": root, "reason": "the data folder no longer exists" }),
            )
        }
        Err(error) => {
            return logging::warn(
                "window placement could not be saved",
                serde_json::json!({ "error": error.to_string() }),
            )
        }
    }
    match serde_json::to_value(placements) {
        Ok(value) => {
            if let Err(error) = storage::save_window_state(root, value) {
                logging::warn(
                    "window placement could not be saved",
                    serde_json::json!({ "error": error }),
                );
            }
        }
        Err(error) => logging::warn(
            "window placement could not be serialized",
            serde_json::json!({ "error": error.to_string() }),
        ),
    }
}
