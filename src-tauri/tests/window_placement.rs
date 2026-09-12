use quickdeck_lib::window_placement::{
    placement_after_close, ClosingState, NormalRectangle, Placement,
};

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
