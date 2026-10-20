import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Where the Rust core and the pages meet by name rather than by type: events
// sent between them, and the pages the core opens in windows. Both sides are
// read from the source, so a name changed on one side alone fails here.

function sources(dir: string, extensions: RegExp): string[] {
  return readdirSync(join(process.cwd(), dir), { recursive: true, encoding: "utf8" })
    .filter((path) => extensions.test(path))
    .map((path) => readFileSync(join(process.cwd(), dir, path), "utf8"));
}

function eventNames(texts: string[], pattern: RegExp): string[] {
  return [...new Set(texts.flatMap((text) => Array.from(text.matchAll(pattern), (match) => match[1])))].sort();
}

const RUST_EVENT = /_EVENT: &str = "([^"]+)"/g;
const PAGE_EVENT = /_EVENT = "([^"]+)"/g;

describe("Rust and page contract", () => {
  it("finds a name declared on only one side", () => {
    const rust = eventNames(['pub const A_EVENT: &str = "a";', 'const B_EVENT: &str = "b";'], RUST_EVENT);
    const pages = eventNames(['const A_EVENT = "a";'], PAGE_EVENT);
    expect(pages).not.toEqual(rust);
  });

  it("sends and listens for the same event names on both sides", () => {
    const rust = eventNames(sources("src-tauri/src", /\.rs$/), RUST_EVENT);
    const pages = eventNames(sources("src", /\.tsx?$/), PAGE_EVENT);
    expect(rust.length).toBeGreaterThan(0);
    expect(pages).toEqual(rust);
  });

  it("builds every page the core opens in a window", () => {
    const opened = eventNames(sources("src-tauri/src", /\.rs$/), /WebviewUrl::App\("([^"]+)"/g);
    const vite = readFileSync(join(process.cwd(), "vite.config.ts"), "utf8");
    expect(opened.length).toBeGreaterThan(0);
    for (const page of opened) {
      expect(vite).toContain(`new URL("./${page}", import.meta.url)`);
      expect(readFileSync(join(process.cwd(), page), "utf8")).toContain("<script");
    }
  });
});
