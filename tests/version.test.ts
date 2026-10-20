import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// tauri.conf.json holds the app version; About, the installer and the release
// tag all take it from there. package.json, package-lock.json, Cargo.toml and
// Cargo.lock each need their own literal copy, so this checks each against it.
// The release workflow runs these tests before it builds anything.

function read(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), "utf8");
}

function match(text: string, pattern: RegExp): string {
  const found = pattern.exec(text);
  if (found === null) throw new Error(`No version matching ${pattern}`);
  return found[1];
}

const canonical = JSON.parse(read("src-tauri/tauri.conf.json")).version as string;

describe("app version is consistent across manifests", () => {
  it("tauri.conf.json carries a semver version", () => {
    expect(canonical).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("package.json and both places in package-lock.json match it", () => {
    expect(JSON.parse(read("package.json")).version).toBe(canonical);
    const lock = JSON.parse(read("package-lock.json"));
    expect(lock.version).toBe(canonical);
    expect(lock.packages[""].version).toBe(canonical);
  });

  it("Cargo.toml's [package] version matches it", () => {
    expect(match(read("src-tauri/Cargo.toml"), /^\[package\][^[]*?^version = "([^"]+)"/m)).toBe(canonical);
  });

  it("Cargo.lock's quickdeck entry matches it", () => {
    expect(match(read("src-tauri/Cargo.lock"), /^name = "quickdeck"\nversion = "([^"]+)"/m)).toBe(canonical);
  });
});
