import { describe, it, expect } from "vitest";
import { isExcludedHomeFile } from "../../../src/services/backup/homeRootExclusions";

describe("isExcludedHomeFile", () => {
  it("keeps durable home-root data, including state.json (pane content)", () => {
    expect(isExcludedHomeFile("config.json")).toBe(false);
    // Unlike dropkick, quickdeck's state.json holds the user's durable pane text,
    // so it IS backed up (content-based rule).
    expect(isExcludedHomeFile("state.json")).toBe(false);
  });

  it("excludes the feature's own output, logs, and temporaries", () => {
    expect(isExcludedHomeFile("logs/20260701-000000-utc.log")).toBe(true);
    expect(isExcludedHomeFile("backups/index.json")).toBe(true);
    expect(isExcludedHomeFile("backups/backup-20260701-000000-utc.zip")).toBe(true);
    expect(isExcludedHomeFile("config-1a2b3c4d5e6f.tmp")).toBe(true);
  });

  it("excludes the monolithic SQLite snapshot store and its WAL sidecars", () => {
    expect(isExcludedHomeFile("snapshots.sqlite3")).toBe(true);
    expect(isExcludedHomeFile("snapshots.sqlite3-wal")).toBe(true);
    expect(isExcludedHomeFile("snapshots.sqlite3-shm")).toBe(true);
    // Case-insensitive by basename.
    expect(isExcludedHomeFile("Snapshots.SQLite3")).toBe(true);
  });

  it("excludes the OS-noise floor anywhere, matched case-insensitively", () => {
    expect(isExcludedHomeFile(".DS_Store")).toBe(true);
    expect(isExcludedHomeFile("sub/.DS_Store")).toBe(true);
    expect(isExcludedHomeFile("Thumbs.db")).toBe(true);
    expect(isExcludedHomeFile("desktop.ini")).toBe(true);
    expect(isExcludedHomeFile("Desktop.ini")).toBe(true);
  });
});
