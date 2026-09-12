import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function read(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), "utf8");
}

const core = read("src-tauri/src/lib.rs");
const placement = read("src-tauri/src/window_placement.rs");
const cargoManifest = read("src-tauri/Cargo.toml");
const packageManifest = JSON.parse(read("package.json")) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
const capability = JSON.parse(
  read("src-tauri/capabilities/default.json"),
) as { permissions?: Array<string | { identifier?: string }> };

describe("Tauri window-state integration", () => {
  it("restores native placement before the hidden window is shown", () => {
    expect(core).toContain("window_placement::restore(");
    expect(core).toContain("window.show()?");
    expect(core.indexOf("window_placement::restore(")).toBeLessThan(
      core.indexOf("window.show()?"),
    );
    expect(placement).toContain('cfg!(target_os = "windows") && placement.maximized');
  });

  it("captures position and size together only from a normal closing window", () => {
    expect(placement).toContain("WindowEvent::CloseRequested");
    expect(placement).toContain("window.is_minimized()? || window.is_fullscreen()?");
    expect(placement).toContain("if window.is_maximized()?");
    expect(placement).toContain("ClosingState::Normal(current_normal_rectangle(window)?)");
    expect(placement).not.toMatch(/onMoved|onResized|debounce|prev_[xy]/i);
  });

  it("keeps placement in Rust without the split-history plugin or frontend permissions", () => {
    expect(cargoManifest).not.toContain("tauri-plugin-window-state");
    expect(packageManifest.dependencies).not.toHaveProperty(
      "@tauri-apps/plugin-window-state",
    );
    expect(packageManifest.devDependencies).not.toHaveProperty(
      "@tauri-apps/plugin-window-state",
    );
    const identifiers = (capability.permissions ?? []).map((permission) =>
      typeof permission === "string" ? permission : permission.identifier ?? "",
    );
    expect(identifiers.filter((id) => id.startsWith("window-state:"))).toEqual([]);
  });
});
