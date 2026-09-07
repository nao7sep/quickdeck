import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const rootFile = (path: string) => join(process.cwd(), path);

it("packages the concise MPL notice and source routes", () => {
  const config = JSON.parse(
    readFileSync(rootFile("src-tauri/tauri.conf.json"), "utf8"),
  ) as { bundle?: { resources?: Record<string, string> } };
  const notices = readFileSync(rootFile("THIRD_PARTY_NOTICES"), "utf8");
  const windowsPackager = readFileSync(rootFile("scripts/package.ps1"), "utf8");

  expect(config.bundle?.resources?.["../THIRD_PARTY_NOTICES"]).toBe(
    "THIRD_PARTY_NOTICES.txt",
  );
  for (const crate of [
    "cssparser/0.36.0",
    "cssparser-macros/0.6.1",
    "dtoa-short/0.3.5",
    "option-ext/0.2.0",
    "selectors/0.36.1",
  ]) {
    expect(notices).toContain(crate);
  }
  expect(windowsPackager).toContain('"THIRD_PARTY_NOTICES"');
});
