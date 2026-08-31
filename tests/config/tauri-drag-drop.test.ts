import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const config = JSON.parse(
  readFileSync(join(process.cwd(), "src-tauri/tauri.conf.json"), "utf8"),
) as { app?: { windows?: Array<{ dragDropEnabled?: unknown }> } };

describe("Tauri external drag transport", () => {
  it("leaves delivery to the renderer so native editor text drops survive", () => {
    expect(config.app?.windows).toHaveLength(1);
    expect(config.app?.windows?.[0]?.dragDropEnabled).toBe(false);
  });
});
