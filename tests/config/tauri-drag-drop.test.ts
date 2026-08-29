import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const config = JSON.parse(
  readFileSync(join(process.cwd(), "src-tauri/tauri.conf.json"), "utf8"),
) as { app?: { windows?: Array<{ dragDropEnabled?: unknown }> } };

describe("Tauri native file interception", () => {
  it("is explicitly the primary OS file-drop boundary", () => {
    expect(config.app?.windows).toHaveLength(1);
    expect(config.app?.windows?.[0]?.dragDropEnabled).toBe(true);
  });
});
