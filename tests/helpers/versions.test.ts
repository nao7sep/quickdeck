import { describe, expect, it } from "vitest";
import { SEMVER, parseCargoPackageVersion, parseJsonVersion } from "./versions";

describe("parseJsonVersion", () => {
  it("extracts a string version", () => {
    expect(parseJsonVersion('{"version":"1.2.3","name":"x"}')).toBe("1.2.3");
  });

  it("throws when version is missing, empty, or not a string", () => {
    expect(() => parseJsonVersion('{"name":"x"}')).toThrow();
    expect(() => parseJsonVersion('{"version":""}')).toThrow();
    expect(() => parseJsonVersion('{"version":123}')).toThrow();
  });
});

describe("parseCargoPackageVersion", () => {
  it("reads a double-quoted version", () => {
    expect(parseCargoPackageVersion('[package]\nname = "q"\nversion = "0.1.1"\n')).toBe("0.1.1");
  });

  it("reads a single-quoted (TOML literal) version", () => {
    expect(parseCargoPackageVersion("[package]\nversion = '0.2.0'\n")).toBe("0.2.0");
  });

  it("ignores a trailing inline comment", () => {
    expect(parseCargoPackageVersion('[package]\nversion = "1.0.0" # release\n')).toBe("1.0.0");
  });

  it("tolerates CRLF line endings", () => {
    expect(parseCargoPackageVersion('[package]\r\nname = "q"\r\nversion = "3.4.5"\r\n')).toBe("3.4.5");
  });

  it("reads the [package] version, not a dependency's version", () => {
    const toml = [
      "[package]",
      'name = "quickdeck"',
      'version = "0.1.1"',
      "",
      "[dependencies]",
      'rusqlite = { version = "0.39.0" }',
      'sha2 = "0.11.0"',
    ].join("\n");
    expect(parseCargoPackageVersion(toml)).toBe("0.1.1");
  });

  it("is not confused by a [package.metadata] sub-table before [package]'s version", () => {
    const toml = [
      "[package.metadata.bundle]",
      'version = "9.9.9"',
      "",
      "[package]",
      'version = "0.1.1"',
    ].join("\n");
    expect(parseCargoPackageVersion(toml)).toBe("0.1.1");
  });

  it("reads version from a [package] table that is the last table with no trailing newline", () => {
    expect(parseCargoPackageVersion('[lib]\nname = "x"\n\n[package]\nversion = "5.0.0"')).toBe("5.0.0");
  });

  it("throws when there is no [package] table", () => {
    expect(() => parseCargoPackageVersion('[dependencies]\nserde = "1"\n')).toThrow(/\[package\]/);
  });

  it("throws when the [package] table has no version", () => {
    expect(() => parseCargoPackageVersion('[package]\nname = "x"\n')).toThrow(/version/);
  });
});

describe("SEMVER", () => {
  it("accepts plain and prerelease/build versions", () => {
    for (const v of ["0.1.1", "1.0.0", "10.20.30", "1.0.0-rc.1", "1.2.3-beta.2+build.5", "1.0.0+exp.sha.5"]) {
      expect(v).toMatch(SEMVER);
    }
  });

  it("rejects non-semver shapes", () => {
    for (const v of ["1.2", "1.2.3.4", "v1.2.3", "1.2.x", "", "01.2.3 "]) {
      expect(v).not.toMatch(SEMVER);
    }
  });
});
