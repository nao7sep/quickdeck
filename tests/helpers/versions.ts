// Pure parsing helpers for the version-consistency test.
//
// These are kept free of file I/O so their edge cases — TOML quoting, the
// [package] table isolation, inline comments, CRLF — can be unit-tested against
// synthetic strings (tests/helpers/versions.test.ts) without touching the real
// manifests. tests/version.test.ts supplies the I/O by reading the actual files.

// Semantic Versioning 2.0.0: major.minor.patch with optional -prerelease and
// +build metadata. The consistency test only asserts the manifests AGREE and
// that the canonical version is well-formed semver; it deliberately does not try
// to be a bundler-compatibility linter, so prerelease/build forms are accepted.
export const SEMVER =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export function parseJsonVersion(jsonText: string): string {
  const version = JSON.parse(jsonText).version;
  if (typeof version !== "string" || version.length === 0) {
    throw new Error('Missing string "version"');
  }
  return version;
}

export function parseCargoPackageVersion(tomlText: string): string {
  // Isolate the [package] table so a dependency's own `version = "..."` in a
  // later table cannot be matched. `\[package\]` requires the literal closing
  // bracket, so it never matches `[package.metadata]` and friends.
  const table = /\[package\]([\s\S]*?)(?:\n\[|$)/.exec(tomlText);
  if (!table) {
    throw new Error("No [package] table");
  }
  // TOML strings are either basic ("...") or literal ('...'); accept both. A
  // trailing inline comment after the closing quote is ignored by the anchor.
  const match = /^[ \t]*version[ \t]*=[ \t]*["']([^"']+)["']/m.exec(table[1]);
  if (!match) {
    throw new Error("No version in the [package] table");
  }
  return match[1];
}
