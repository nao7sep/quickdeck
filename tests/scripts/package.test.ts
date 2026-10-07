// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const script = new URL("../../scripts/package.sh", import.meta.url);
const windowsScript = readFileSync(new URL("../../scripts/package.ps1", import.meta.url), "utf8");
const appName = "QuickDeck";
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));

function packageFixture(mode: string) {
  const root = mkdtempSync(join(tmpdir(), "package-fixture-"));
  roots.push(root);
  for (const dir of ["scripts", "src-tauri", "node_modules/.bin", "tools",
    "src-tauri/target/release/bundle/dmg", "src-tauri/target/release/bundle/macos/Old.app"]) {
    mkdirSync(join(root, dir), { recursive: true });
  }
  copyFileSync(script, join(root, "scripts/package.sh"));
  writeFileSync(join(root, "src-tauri/tauri.conf.json"), JSON.stringify({ version: "2.0.0" }));
  writeFileSync(join(root, "src-tauri/target/release/bundle/dmg/Old-1.0.0.dmg"), "stale installer");
  writeFileSync(join(root, "node_modules/.bin/tauri"), `#!/bin/bash
set -eu
if [[ "$FIXTURE_MODE" == fail ]]; then exit 1; fi
if [[ "$FIXTURE_MODE" == none ]]; then exit 0; fi
mkdir -p src-tauri/target/release/bundle/{dmg,macos/Current.app}
printf current > src-tauri/target/release/bundle/dmg/Current-2.0.0.dmg
if [[ "$FIXTURE_MODE" == double ]]; then
  printf other > src-tauri/target/release/bundle/dmg/Other-2.0.0.dmg
fi
`, { mode: 0o755 });
  writeFileSync(join(root, "tools/ditto"), `#!/bin/bash
for destination in "$@"; do :; done
printf current-app > "$destination"
`, { mode: 0o755 });
  const result = spawnSync("bash", [join(root, "scripts/package.sh")], {
    encoding: "utf8", timeout: 5000,
    env: { ...process.env, FIXTURE_MODE: mode, PATH: `${join(root, "tools")}:${process.env.PATH}` },
  });
  if (result.error) throw result.error;
  return { root, result };
}

describe("current-build package collection", () => {
  it.skipIf(process.platform === "win32")("discards stale bundles and collects only the new installer and app", () => {
    const { root, result } = packageFixture("success");
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(join(root, `artifacts/${appName}-2.0.0.dmg`), "utf8")).toBe("current");
    expect(readFileSync(join(root, `artifacts/${appName}-2.0.0-mac.zip`), "utf8")).toBe("current-app");
  });
  it.skipIf(process.platform === "win32").each(["none", "double", "fail"])("refuses %s build outputs despite a stale installer", mode => {
    const { root, result } = packageFixture(mode);
    expect(result.status).not.toBe(0);
    expect(() => readFileSync(join(root, `artifacts/${appName}-2.0.0.dmg`))).toThrow();
  });
  it("Windows source cleans generated outputs before building and requires one fresh setup", () => {
    const cleanup = windowsScript.indexOf('foreach ($output in @("artifacts", $NsisDirectory, $PortableExecutable))');
    const build = windowsScript.indexOf('& $TauriCli build --bundles nsis');
    const check = windowsScript.indexOf('$setups.Count -ne 1');
    const copy = windowsScript.indexOf('Copy-Item $setups[0].FullName');
    expect(cleanup).toBeGreaterThan(-1);
    expect(build).toBeGreaterThan(cleanup);
    expect(check).toBeGreaterThan(build);
    expect(copy).toBeGreaterThan(check);
    expect(windowsScript).not.toContain("Select-Object -First 1");
  });
});
