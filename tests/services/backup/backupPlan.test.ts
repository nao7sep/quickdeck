import { describe, it, expect } from "vitest";
import { selectChanged, MTIME_MATCH_TOLERANCE_MS } from "../../../src/services/backup/backupPlan";
import type { BackupCandidate, BackupIndex, BackupIndexEntry } from "../../../src/services/backup/backupTypes";

const baseMs = Date.UTC(2026, 6, 1, 2, 22, 20);

function candidate(over: Partial<BackupCandidate> = {}): BackupCandidate {
  return {
    sourcePath: "/home/config.json",
    archivePath: "config.json",
    sizeBytes: 100,
    mtimeMs: baseMs,
    ...over,
  };
}

function row(over: Partial<BackupIndexEntry> = {}): BackupIndexEntry {
  return {
    archivedAt: "20260701-000000-utc",
    archivePath: "config.json",
    sizeBytes: 100,
    lastWriteUtc: "2026-07-01T02:22:20Z",
    ...over,
  };
}

describe("selectChanged", () => {
  it("treats a never-captured file as changed", () => {
    expect(selectChanged([candidate()], { entries: [] })).toHaveLength(1);
  });

  it("skips a file whose size and mtime match its latest row", () => {
    expect(selectChanged([candidate()], { entries: [row()] })).toHaveLength(0);
  });

  it("captures a file whose size changed even if mtime matches", () => {
    expect(selectChanged([candidate({ sizeBytes: 101 })], { entries: [row()] })).toHaveLength(1);
  });

  it("captures a file whose mtime moved beyond the tolerance", () => {
    const moved = candidate({ mtimeMs: baseMs + MTIME_MATCH_TOLERANCE_MS + 1 });
    expect(selectChanged([moved], { entries: [row()] })).toHaveLength(1);
  });

  it("skips a file whose mtime moved within the tolerance", () => {
    const jitter = candidate({ mtimeMs: baseMs + MTIME_MATCH_TOLERANCE_MS - 1 });
    expect(selectChanged([jitter], { entries: [row()] })).toHaveLength(0);
  });

  it("recaptures when the stored timestamp is unparseable", () => {
    expect(selectChanged([candidate()], { entries: [row({ lastWriteUtc: "not-a-date" })] })).toHaveLength(1);
  });

  it("compares against the latest row per path, not an older one", () => {
    const index: BackupIndex = {
      entries: [
        row({ archivedAt: "20260701-000000-utc", sizeBytes: 999 }), // stale, wrong size
        row({ archivedAt: "20260701-010000-utc", sizeBytes: 100 }), // latest, matches
      ],
    };
    expect(selectChanged([candidate()], index)).toHaveLength(0);
  });
});
