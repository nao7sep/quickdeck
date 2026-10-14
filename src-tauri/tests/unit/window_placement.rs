use super::{
    capture_event, capture_from, new_state, placements_from, save, ClosingState, NormalRectangle,
    Placement, DURABLE_WINDOWS, REMEMBERS_MAXIMIZED,
};
use crate::format_version::{self, JsonFormat};
use tauri::{PhysicalPosition, PhysicalSize, WindowEvent};

const LAUNCH: NormalRectangle = NormalRectangle {
    x: 10,
    y: 20,
    width: 800,
    height: 600,
};
const BEFORE_MAXIMIZE: NormalRectangle = NormalRectangle {
    x: -900,
    y: 80,
    width: 1100,
    height: 720,
};

fn normal_change_then_maximized_exit(event: WindowEvent) {
    let root = tempfile::tempdir().unwrap();
    let state = new_state();
    for label in DURABLE_WINDOWS {
        state.lock().unwrap().insert(
            label.into(),
            Placement {
                normal: LAUNCH,
                maximized: false,
            },
        );
        // Substitute only the native observation. The production event router,
        // placement owner and exit publication retain the latest whole sample.
        capture_event(label, &event, &state, || {
            assert!(
                state.try_lock().is_ok(),
                "native reads must not hold the state lock"
            );
            Ok(ClosingState::Normal(BEFORE_MAXIMIZE))
        });
        // Maximizing can emit geometry events. Their payload and current
        // maximized geometry must not replace the preceding normal rectangle.
        capture_event(
            label,
            &WindowEvent::Resized(PhysicalSize::new(1920, 1080)),
            &state,
            || Ok(ClosingState::Maximized),
        );
        capture_from(label, &state, || Ok(ClosingState::Maximized));
    }
    save(root.path(), &state);
    let written =
        serde_json::from_slice(&std::fs::read(root.path().join("window.json")).unwrap()).unwrap();
    let Ok(JsonFormat::Readable(written)) =
        format_version::read_json(written, format_version::WINDOW)
    else {
        panic!("the saved placement must be readable on relaunch");
    };
    let reloaded = placements_from(Some(serde_json::Value::Object(written)));
    for label in DURABLE_WINDOWS {
        assert_eq!(
            reloaded.get(label),
            Some(&Placement {
                normal: BEFORE_MAXIMIZE,
                maximized: REMEMBERS_MAXIMIZED,
            }),
            "{label} must restore the latest normal rectangle, not the launch rectangle",
        );
    }
}

#[test]
fn normal_move_then_maximized_exit_saves_the_latest_complete_rectangle() {
    // Deliberately different from the native getter sample: this must not
    // accumulate the event's position alongside an older stored size.
    normal_change_then_maximized_exit(WindowEvent::Moved(PhysicalPosition::new(123, 456)));
}

#[test]
fn normal_resize_then_maximized_exit_saves_the_latest_complete_rectangle() {
    normal_change_then_maximized_exit(WindowEvent::Resized(PhysicalSize::new(900, 650)));
}

#[test]
fn transient_or_failed_geometry_observation_retains_the_complete_record() {
    let state = new_state();
    let previous = Placement {
        normal: BEFORE_MAXIMIZE,
        maximized: true,
    };
    state.lock().unwrap().insert("main".into(), previous);
    let moved = WindowEvent::Moved(PhysicalPosition::new(-32000, -32000));
    // The adapter classifies hidden setup, minimized and fullscreen windows as
    // transient. A failed getter likewise cannot partially replace the record.
    capture_event("main", &moved, &state, || Ok(ClosingState::Transient));
    assert_eq!(state.lock().unwrap().get("main"), Some(&previous));
    capture_event("main", &moved, &state, || {
        Err(tauri::Error::InvalidWindowHandle)
    });
    assert_eq!(state.lock().unwrap().get("main"), Some(&previous));
}

#[test]
fn unrelated_events_and_transient_window_labels_do_not_read_native_placement() {
    let state = new_state();
    capture_event("main", &WindowEvent::Focused(true), &state, || {
        panic!("focus does not change the placement");
    });
    capture_event(
        "dialog",
        &WindowEvent::Moved(PhysicalPosition::new(100, 100)),
        &state,
        || panic!("a transient window does not own placement"),
    );
    assert!(state.lock().unwrap().is_empty());
}
