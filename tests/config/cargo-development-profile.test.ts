import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const manifest = readFileSync("src-tauri/Cargo.toml", "utf8").replace(/\r\n?/g, "\n");

function manifestSection(name: string): string {
  const heading = `[${name}]\n`;
  const start = manifest.indexOf(heading);
  expect(start, `Cargo manifest section [${name}]`).toBeGreaterThanOrEqual(0);
  const body = manifest.slice(start + heading.length);
  const next = body.search(/^\[/m);
  return next < 0 ? body : body.slice(0, next);
}

describe("the Cargo development build policy", () => {
  it("emits only the desktop library artifact", () => {
    expect(manifestSection("lib")).toMatch(/^crate-type\s*=\s*\["rlib"\]\s*$/m);
  });

  it("keeps ordinary application symbols lightweight", () => {
    for (const profile of ["dev", "test"]) {
      expect(manifestSection(`profile.${profile}`)).toMatch(
        /debug\s*=\s*"line-tables-only"/,
      );
      expect(manifestSection(`profile.${profile}`)).toMatch(
        /split-debuginfo\s*=\s*"off"/,
      );
      expect(manifestSection(`profile.${profile}.package."*"`)).toMatch(
        /debug\s*=\s*false/,
      );
      expect(manifestSection(`profile.${profile}.package."*"`)).not.toMatch(
        /opt-level/,
      );
    }
  });

  it("keeps full debugging explicit and opt-in", () => {
    expect(manifestSection("profile.debugging")).toMatch(/inherits\s*=\s*"dev"/);
    expect(manifestSection("profile.debugging")).toMatch(/debug\s*=\s*true/);
  });
});
