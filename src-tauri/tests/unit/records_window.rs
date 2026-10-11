use super::create_for_main;
use std::cell::{Cell, RefCell};

#[test]
fn retirement_during_creation_destroys_the_attached_handle_without_presenting_it() {
    let main = Cell::new(true);
    let attached = Cell::new(None);
    let runtime_windows = RefCell::new(Vec::new());
    let destroyed = RefCell::new(Vec::new());
    let shown = Cell::new(false);
    create_for_main(
        || main.get(),
        || {
            // Wry may create this window before the worker attaches it to Tauri.
            runtime_windows.borrow_mut().push(41);
            main.set(false);
            assert!(attached.get().is_none()); // The main-close lookup misses it.
            attached.set(Some(41));
            Ok(41)
        },
        |_| {
            shown.set(true);
            Ok(())
        },
        |window| {
            destroyed.borrow_mut().push(*window);
            runtime_windows.borrow_mut().retain(|id| id != window);
            Ok(())
        },
    )
    .unwrap();
    assert_eq!(*destroyed.borrow(), vec![41]);
    assert!(runtime_windows.borrow().is_empty());
    assert!(!shown.get());
}

#[test]
fn no_window_is_created_after_main_retirement() {
    let created = Cell::new(false);
    create_for_main(
        || false,
        || {
            created.set(true);
            Ok(41)
        },
        |_| Ok(()),
        |_| Ok(()),
    )
    .unwrap();
    assert!(!created.get());
}

#[test]
fn an_attached_window_is_presented_while_main_remains() {
    let shown = Cell::new(None);
    create_for_main(
        || true,
        || Ok(41),
        |window| {
            shown.set(Some(*window));
            Ok(())
        },
        |_| panic!("a live window must not be retired"),
    )
    .unwrap();
    assert_eq!(shown.get(), Some(41));
}

#[test]
fn failed_retirement_is_reported_without_presenting_the_window() {
    let main = Cell::new(true);
    let result = create_for_main(
        || main.get(),
        || {
            main.set(false);
            Ok(41)
        },
        |_| panic!("a retired window must not be presented"),
        |_| Err("destroy failed".to_string()),
    );
    assert_eq!(result, Err("destroy failed".to_string()));
}
