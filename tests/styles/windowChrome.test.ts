import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  computeWindowMinHeight,
  computeWindowMinWidth,
} from "../../src/utils/layoutMetrics";

// The Tauri manifest owns native window behavior that runtime component tests
// cannot observe. `npm test` runs Vitest from the repo root.
function read(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), "utf8");
}

describe("tauri.conf.json window-chrome guards", () => {
  const window = JSON.parse(read("src-tauri/tauri.conf.json")).app.windows[0];

  it("the title bar is not transparent (a normal themed bar)", () => {
    expect(window.titleBarStyle).not.toBe("Transparent");
  });

  it("minWidth equals the single-pane derived floor", () => {
    expect(window.minWidth).toBe(computeWindowMinWidth(1, false));
  });

  it("minHeight equals the derived height floor", () => {
    expect(window.minHeight).toBe(computeWindowMinHeight());
  });
});
