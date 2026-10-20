// @vitest-environment node
// Runs the actual Windows collector with a disposable builder stand-in. No
// Rust build, installer execution or real application files are involved.
import { afterEach, describe, expect, it } from "vitest";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));

function powershell(root: string, args: string[], mode = "success") {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", ...args], {
    cwd: root, encoding: "utf8", timeout: 5000,
    env: { ...process.env, QUICKDECK_FIXTURE_MODE: mode, QUICKDECK_FIXTURE_NODE: process.execPath },
  });
  if (result.error) throw result.error;
  return result;
}

function packageFixture(mode: string) {
  const root = mkdtempSync(join(tmpdir(), "quickdeck package fixture-"));
  roots.push(root);
  for (const directory of ["scripts", "node_modules/.bin", "artifacts", "src-tauri/target/release/bundle/nsis"]) {
    mkdirSync(join(root, directory), { recursive: true });
  }
  copyFileSync(new URL("../../scripts/package.ps1", import.meta.url), join(root, "scripts/package.ps1"));
  writeFileSync(join(root, "src-tauri/tauri.conf.json"), JSON.stringify({ productName: "QuickDeck", version: "2.0.0" }));
  writeFileSync(join(root, "LICENSE"), "fixture licence");
  writeFileSync(join(root, "artifacts/stale.exe"), "stale published installer");
  writeFileSync(join(root, "src-tauri/target/release/bundle/nsis/Old-setup.exe"), "stale installer");
  writeFileSync(join(root, "src-tauri/target/release/quickdeck.exe"), "stale portable");
  writeFileSync(join(root, "node_modules/.bin/tauri.cmd"), '@echo off\r\n"%QUICKDECK_FIXTURE_NODE%" "%~dp0fixture.cjs"\r\nexit /b %ERRORLEVEL%\r\n');
  writeFileSync(join(root, "node_modules/.bin/fixture.cjs"), `
const { mkdirSync, writeFileSync } = require("node:fs");
const mode = process.env.QUICKDECK_FIXTURE_MODE;
if (mode === "fail") process.exit(7);
if (mode === "none") process.exit(0);
const nsis = "src-tauri/target/release/bundle/nsis";
mkdirSync(nsis, { recursive: true });
writeFileSync(nsis + "/Current-setup.exe", "current installer");
if (mode === "double") writeFileSync(nsis + "/Other-setup.exe", "other installer");
if (mode !== "no-portable") writeFileSync("src-tauri/target/release/quickdeck.exe", "current portable");
`);
  return { root, result: powershell(root, ["-File", join(root, "scripts/package.ps1")], mode) };
}

describe.skipIf(process.platform !== "win32")("Windows current-build package collection", () => {
  it("replaces stale output and packages the executable with its licence", () => {
    const { root, result } = packageFixture("success");
    expect(result.status, result.stderr).toBe(0);
    expect(readdirSync(join(root, "artifacts")).sort()).toEqual(["QuickDeck-2.0.0-setup.exe", "QuickDeck-2.0.0-win.zip"]);
    expect(readFileSync(join(root, "artifacts/QuickDeck-2.0.0-setup.exe"), "utf8")).toBe("current installer");
    expect(existsSync(join(root, "src-tauri/target/release/bundle/nsis/Old-setup.exe"))).toBe(false);
    const unpacked = powershell(root, ["-Command", "Expand-Archive -LiteralPath 'artifacts/QuickDeck-2.0.0-win.zip' -DestinationPath 'unpacked'"]);
    expect(unpacked.status, unpacked.stderr).toBe(0);
    expect(readFileSync(join(root, "unpacked/quickdeck.exe"), "utf8")).toBe("current portable");
    expect(readFileSync(join(root, "unpacked/LICENSE"), "utf8")).toBe("fixture licence");
  });

  it.each([
    ["fail", "Tauri build failed with exit code 7"],
    ["none", "Expected exactly one NSIS setup.exe from this build"],
    ["double", "Expected exactly one NSIS setup.exe from this build"],
    ["no-portable", "This build did not produce the portable executable"],
  ])("refuses %s outputs rather than publishing stale files", (mode, reason) => {
    const { root, result } = packageFixture(mode);
    expect(result.status, result.stdout).not.toBe(0);
    expect(result.stderr).toContain(reason);
    expect(readdirSync(join(root, "artifacts"))).toEqual([]);
  });
});
