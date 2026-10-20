import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The product name is tauri.conf.json's productName and the executable is the
// Cargo crate's name. Where a file has to spell one out, it is checked here.

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const productName = JSON.parse(read("src-tauri/tauri.conf.json")).productName as string;
const crate = /^\[package\][^[]*?^name = "([^"]+)"/m.exec(read("src-tauri/Cargo.toml"))![1];

describe("names spelled out beside their sources", () => {
  it("titles the pages and the main window with the product name", () => {
    for (const page of ["index.html", "records.html"]) {
      expect(/<title>([^<]+)<\/title>/.exec(read(page))?.[1], page).toBe(productName);
    }
    expect(JSON.parse(read("src-tauri/tauri.conf.json")).app.windows[0].title).toBe(productName);
  });

  it("names the crate's executable wherever a script runs or packages it", () => {
    const scripts = readdirSync(join(process.cwd(), "scripts")).filter((name) => /\.(command|ps1|sh)$/.test(name));
    const named = scripts.flatMap((name) => {
      const text = read(join("scripts", name));
      return [
        ...text.matchAll(/APP_EXECUTABLE="([^"]+)"/g),
        ...text.matchAll(/\$crate = "([^"]+)"/g),
        ...text.matchAll(/target\/(?:debug|release)\/([A-Za-z0-9_-]+?)(?:\.exe)?["\s)]/g),
      ].map((match) => [name, match[1]] as const);
    });
    expect(named.length).toBeGreaterThan(0);
    for (const [name, executable] of named) expect(executable, name).toBe(crate);
  });

  it("describes, credits and licenses the app the same way in both manifests and About", () => {
    const npm = JSON.parse(read("package.json"));
    const cargo = read("src-tauri/Cargo.toml");
    const field = (name: string) => new RegExp(`^${name} = (.+)$`, "m").exec(cargo)?.[1];
    expect(JSON.parse(field("description")!)).toBe(npm.description);
    expect(JSON.parse(field("license")!)).toBe(npm.license);
    expect(JSON.parse(field("authors")!)).toEqual([npm.author]);
    // The introduction line is the package description (app-chrome conventions).
    expect(JSON.parse(read("src/i18n/locales/en.json"))["about.tagline"]).toBe(npm.description);
  });

  it("names only data files the core really keeps, in every language", () => {
    const managed = new Set(
      ["src-tauri/src/storage.rs", "src-tauri/src/backup_store.rs"].flatMap((path) =>
        Array.from(read(path).matchAll(/FILE_NAME: &str = "([^"]+)"/g), (match) => match[1])),
    );
    expect(managed.size).toBeGreaterThan(0);
    for (const locale of readdirSync(join(process.cwd(), "src/i18n/locales"))) {
      const text = read(join("src/i18n/locales", locale));
      for (const [name] of text.matchAll(/[\w-]+\.(?:json|sqlite3)\b/g)) {
        expect(managed.has(name), `${locale}: ${name}`).toBe(true);
      }
    }
  });
});
