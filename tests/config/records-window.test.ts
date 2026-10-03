import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The Records window's native lifecycle lives in the Rust core, where no
// component test reaches it. These guards read the source for the app-owned
// decisions (window-conventions, Placement verification): one window under one
// label, built hidden and placed before it is shown, its own placement record,
// and a lifecycle that never holds the app open or keeps activation from the
// main window.
function read(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), "utf8");
}

const recordsWindow = read("src-tauri/src/records_window.rs");
const placement = read("src-tauri/src/window_placement.rs");
const core = read("src-tauri/src/lib.rs");
const instanceOwner = read("src-tauri/src/instance_owner.rs");
const services = read("src/services/records.ts");

function between(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  expect(from, start).toBeGreaterThanOrEqual(0);
  const to = source.indexOf(end, from + start.length);
  return source.slice(from, to < 0 ? undefined : to);
}

describe("Records window lifecycle", () => {
  it("keeps one window: opening again brings the open one forward", () => {
    const open = between(recordsWindow, "pub fn open(", "\npub fn ");
    expect(recordsWindow).toContain('pub const LABEL: &str = "records";');
    expect(open.indexOf("app.get_webview_window(LABEL)")).toBeLessThan(open.indexOf("WebviewWindowBuilder::new"));
    expect(open).toContain("bring_forward(&window);");
    expect(between(recordsWindow, "fn bring_forward(", "\n}\n")).toContain(".unminimize()");
    // Two quick requests cannot both build one.
    expect(open).toContain("OPENING");
  });

  it("builds the window hidden and places it before it is first shown", () => {
    const open = between(recordsWindow, "pub fn open(", "\npub fn ");
    expect(open).toContain(".visible(false)");
    expect(open).toContain(".disable_drag_drop_handler()");
    expect(open.indexOf("window_placement::restore(")).toBeGreaterThan(open.indexOf(".build()"));
    expect(open.indexOf("window_placement::restore(")).toBeLessThan(open.indexOf("window.show()"));
  });

  it("gives the window its own placement record beside the main window's", () => {
    expect(placement).toContain('pub const DURABLE_WINDOWS: [&str; 2] = ["main", "records"];');
    expect(placement).toContain("DURABLE_WINDOWS.contains(&window.label())");
    const exit = between(core, "RunEvent::ExitRequested { .. }) {", "#[cfg(");
    expect(exit).toContain("for label in window_placement::DURABLE_WINDOWS");
  });

  it("closes with the main window, so it never keeps the app running", () => {
    expect(core).toMatch(
      /window\.label\(\) == "main" && matches!\(event, WindowEvent::Destroyed\)\s*\{\s*records_window::close_with_main\(/,
    );
    const close = between(recordsWindow, "pub fn close_with_main(", "\npub fn ");
    expect(close.indexOf("window_placement::capture(")).toBeLessThan(close.indexOf("window.destroy()"));
  });

  it("lets activation bring the main window back, whatever the Records window is doing", () => {
    expect(core).toMatch(/RunEvent::Reopen \{ \.\. \} = event \{\s*bring_main_forward\(app\);/);
    expect(instanceOwner).toContain("crate::bring_main_forward(&app);");
    const forward = between(core, "pub(crate) fn bring_main_forward", "\n}\n");
    expect(forward).toContain('get_webview_window("main")');
    expect(forward).toContain(".unminimize()");
  });

  it("writes no record for a read that succeeds", () => {
    const reads = between(core, "async fn read_records<", "// Receives a structured log object");
    expect(reads).not.toContain("logging::boundary");
    expect(reads).not.toMatch(/logging::(info|debug|warn)\(/);
    // Only a failure is logged.
    expect(reads).toContain(".inspect_err(|error| logging::error(");
  });

  it("grants the Records window only what its page uses", () => {
    const capability = JSON.parse(read("src-tauri/capabilities/records.json")) as {
      windows: string[];
      permissions: string[];
    };
    expect(capability.windows).toEqual(["records"]);
    expect(capability.permissions).toEqual(["core:default", "core:window:allow-set-min-size"]);
    const main = JSON.parse(read("src-tauri/capabilities/default.json")) as { windows: string[] };
    expect(main.windows).toEqual(["main"]);
  });

  it("builds the Records page beside the main page", () => {
    expect(read("vite.config.ts")).toContain('new URL("./records.html", import.meta.url)');
    expect(read("records.html")).toContain('src="/src/records/main.tsx"');
    expect(recordsWindow).toContain('WebviewUrl::App("records.html".into())');
  });

  it("names the same events on both sides", () => {
    for (const event of ["records-changed", "records-language"]) {
      expect(recordsWindow).toContain(`"${event}"`);
      expect(services).toContain(`"${event}"`);
    }
  });
});
