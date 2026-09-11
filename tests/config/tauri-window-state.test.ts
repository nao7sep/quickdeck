import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function read(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), "utf8");
}

const core = read("src-tauri/src/lib.rs");
const packageManifest = JSON.parse(read("package.json")) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
const capability = JSON.parse(
  read("src-tauri/capabilities/default.json"),
) as { permissions?: Array<string | { identifier?: string }> };

describe("Tauri window-state integration", () => {
  it("tracks the transient maximize event but restores only normal geometry", () => {
    expect(core).toMatch(
      /\.with_state_flags\(\s*StateFlags::POSITION\s*\|\s*StateFlags::SIZE\s*\|\s*StateFlags::MAXIMIZED,?\s*\)/,
    );
    expect(core).toContain('.skip_initial_state("main")');
    expect(core).toContain(
      "window.restore_state(StateFlags::POSITION | StateFlags::SIZE)",
    );
    expect(core).not.toContain("StateFlags::FULLSCREEN");
    expect(core).not.toContain("StateFlags::VISIBLE");
  });

  it("keeps window-state outside the frontend boundary", () => {
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
