import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { defaultSettings } from "../../src/state/defaults";
import { settingsBySet } from "../../src/state/normalize";

it("keeps frontend settings sets identical to the Rust save allowlist", () => {
  const storage = readFileSync(join(process.cwd(), "src-tauri/src/storage.rs"), "utf8");
  const declaration = storage.match(/\bconst KEYS:\s*&\[&str\]\s*=\s*&\[([\s\S]*?)\];/);
  expect(declaration, "the Rust settings key declaration must be readable").not.toBeNull();
  const rustKeys = Array.from(declaration![1].matchAll(/"([^"]+)"/g), (match) => match[1]);

  expect(rustKeys.sort()).toEqual(Object.keys(settingsBySet(defaultSettings)).sort());
});
