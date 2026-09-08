import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const capability = JSON.parse(
  readFileSync(
    join(process.cwd(), "src-tauri/capabilities/default.json"),
    "utf8",
  ),
) as { permissions?: unknown[] };

const permissions = capability.permissions ?? [];

describe("Tauri window capability", () => {
  it("grants the mutating window calls used by placement restoration", () => {
    for (const permission of [
      "core:window:allow-set-size",
      "core:window:allow-set-position",
      "core:window:allow-maximize",
      "core:window:allow-show",
    ]) {
      expect(permissions).toContain(permission);
    }
  });
});
