// @vitest-environment node
// The frontend's quit save must finish inside the Rust core's wait for an OS
// session end, or a logout would exit before the save reports.
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { QUIT_SAVE_BOUND_MS, QUIT_SNAPSHOT_BOUND_MS } from "../../src/services/quit";

it("bounds the quit save inside the session-end wait", () => {
  const source = readFileSync(new URL("../../src-tauri/src/quit.rs", import.meta.url), "utf8");
  const wait = /const SESSION_SAVE_WAIT: Duration = Duration::from_millis\((\d+)\);/.exec(source);
  expect(wait).not.toBeNull();
  // The margin covers the report's IPC back to the core.
  expect(QUIT_SNAPSHOT_BOUND_MS + QUIT_SAVE_BOUND_MS).toBeLessThanOrEqual(Number(wait![1]) - 100);
});
