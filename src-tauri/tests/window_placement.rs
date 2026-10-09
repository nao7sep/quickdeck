use quickdeck_lib::format_version::{self, JsonFormat};
use quickdeck_lib::window_placement::{
    new_state, placement_after_close, placements_from, save, ClosingState, NormalRectangle,
    Placement, DURABLE_WINDOWS,
};
use serde_json::json;

fn rectangle(x: i32, y: i32, width: u32, height: u32) -> NormalRectangle {
    NormalRectangle {
        x,
        y,
        width,
        height,
    }
}

#[test]
fn normal_close_replaces_position_and_size_as_one_rectangle() {
    let previous = Placement {
        normal: rectangle(10, 20, 800, 600),
        maximized: true,
    };
    let closing = rectangle(-900, 40, 900, 1000);

    assert_eq!(
        placement_after_close(Some(previous), ClosingState::Normal(closing), true),
        Some(Placement {
            normal: closing,
            maximized: false,
        })
    );
}

#[test]
fn maximized_close_retains_the_complete_normal_rectangle() {
    let previous = Placement {
        normal: rectangle(120, 80, 720, 640),
        maximized: false,
    };

    assert_eq!(
        placement_after_close(Some(previous), ClosingState::Maximized, true),
        Some(Placement {
            normal: previous.normal,
            maximized: true,
        })
    );
}

#[test]
fn mac_discards_maximized_mode_without_touching_the_normal_rectangle() {
    let previous = Placement {
        normal: rectangle(120, 80, 720, 640),
        maximized: true,
    };

    assert_eq!(
        placement_after_close(Some(previous), ClosingState::Maximized, false),
        Some(Placement {
            normal: previous.normal,
            maximized: false,
        })
    );
}

#[test]
fn minimized_or_fullscreen_close_retains_the_whole_record() {
    let previous = Placement {
        normal: rectangle(120, 80, 720, 640),
        maximized: true,
    };

    assert_eq!(
        placement_after_close(Some(previous), ClosingState::Transient, true),
        Some(previous)
    );
}

#[test]
fn window_json_holds_one_placement_per_durable_window() {
    assert_eq!(DURABLE_WINDOWS, ["main", "records"]);
    let placements = placements_from(Some(json!({
        "main": { "normal": { "x": 10, "y": 20, "width": 800, "height": 600 }, "maximized": true },
        "records": { "normal": { "x": -900, "y": 40, "width": 1240, "height": 820 }, "maximized": false },
    })));
    assert_eq!(
        placements.get("main"),
        Some(&Placement {
            normal: rectangle(10, 20, 800, 600),
            maximized: true
        })
    );
    assert_eq!(
        placements.get("records"),
        Some(&Placement {
            normal: rectangle(-900, 40, 1240, 820),
            maximized: false
        })
    );
}

#[test]
fn a_window_json_of_another_shape_is_discarded_as_a_unit() {
    // The single record window.json held before the Records window existed.
    let single =
        json!({ "normal": { "x": 10, "y": 20, "width": 800, "height": 600 }, "maximized": false });
    assert!(placements_from(Some(single)).is_empty());
    let damaged = json!({ "main": { "normal": { "x": 10 } } });
    assert!(placements_from(Some(damaged)).is_empty());
    assert!(placements_from(None).is_empty());
}

#[test]
fn the_exit_save_writes_window_json_into_the_launch_root() {
    let root = tempfile::tempdir().unwrap();
    let state = new_state();
    let placement = Placement {
        normal: rectangle(10, 20, 800, 600),
        maximized: false,
    };
    state.lock().unwrap().insert("main".into(), placement);

    save(root.path(), &state);

    let written: serde_json::Value =
        serde_json::from_slice(&std::fs::read(root.path().join("window.json")).unwrap()).unwrap();
    assert_eq!(written["formatVersion"], format_version::WINDOW);
    let Ok(JsonFormat::Readable(written)) =
        format_version::read_json(written, format_version::WINDOW)
    else {
        panic!("window.json reads in this build's format");
    };
    let placements = placements_from(Some(serde_json::Value::Object(written)));
    assert_eq!(placements.get("main"), Some(&placement));
}

#[test]
fn the_exit_save_keeps_a_window_it_did_not_capture() {
    // A launch whose placement read failed knows only the windows it captured
    // this run; the other window's saved placement survives the exit save.
    let root = tempfile::tempdir().unwrap();
    let records = Placement {
        normal: rectangle(900, 40, 600, 700),
        maximized: false,
    };
    let saved = new_state();
    saved.lock().unwrap().insert("records".into(), records);
    save(root.path(), &saved);

    let main = Placement {
        normal: rectangle(10, 20, 800, 600),
        maximized: true,
    };
    let this_run = new_state();
    this_run.lock().unwrap().insert("main".into(), main);
    save(root.path(), &this_run);

    let written: serde_json::Value =
        serde_json::from_slice(&std::fs::read(root.path().join("window.json")).unwrap()).unwrap();
    let Ok(JsonFormat::Readable(written)) =
        format_version::read_json(written, format_version::WINDOW)
    else {
        panic!("window.json reads in this build's format");
    };
    let placements = placements_from(Some(serde_json::Value::Object(written)));
    assert_eq!(placements.get("main"), Some(&main));
    assert_eq!(placements.get("records"), Some(&records));
}

mod restore_usability {
    use super::rectangle;
    use quickdeck_lib::window_placement::usable_on;

    const SCREEN: [quickdeck_lib::window_placement::NormalRectangle; 1] = [quickdeck_lib::window_placement::NormalRectangle {
        x: 0,
        y: 25,
        width: 1440,
        height: 875,
    }];

    #[test]
    fn a_window_inside_the_work_area_is_restored() {
        assert!(usable_on(rectangle(100, 100, 800, 600), &SCREEN));
    }

    #[test]
    fn a_window_mostly_off_screen_with_its_title_bar_reachable_is_restored() {
        assert!(usable_on(rectangle(1300, 600, 800, 600), &SCREEN));
        assert!(usable_on(rectangle(-700, 100, 800, 600), &SCREEN));
    }

    #[test]
    fn a_sliver_at_a_side_edge_is_not_restored() {
        assert!(!usable_on(rectangle(1439, 100, 800, 600), &SCREEN));
        assert!(!usable_on(rectangle(-799, 100, 800, 600), &SCREEN));
    }

    #[test]
    fn a_title_bar_above_or_below_the_work_area_is_not_restored() {
        assert!(!usable_on(rectangle(100, 0, 800, 600), &SCREEN));
        assert!(!usable_on(rectangle(100, 890, 800, 600), &SCREEN));
    }

    #[test]
    fn a_second_monitor_at_negative_coordinates_counts() {
        let screens = [
            SCREEN[0],
            quickdeck_lib::window_placement::NormalRectangle { x: -1920, y: 0, width: 1920, height: 1040 },
        ];
        assert!(usable_on(rectangle(-1800, 50, 800, 600), &screens));
        assert!(!usable_on(rectangle(-1800, 50, 800, 600), &SCREEN));
    }

    #[test]
    fn an_empty_rectangle_is_not_restored() {
        assert!(!usable_on(rectangle(100, 100, 0, 600), &SCREEN));
    }
}
