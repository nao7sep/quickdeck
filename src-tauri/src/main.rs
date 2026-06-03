// Hides the extra console window on Windows in release builds (kept in dev for logs). DO NOT REMOVE.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    quickdeck_lib::run()
}
