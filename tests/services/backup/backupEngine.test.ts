import { describe, it, expect, beforeEach, vi } from "vitest";
import type { BackupInputs } from "../../../src/services/backup/backupCollector";
import type { BackupIndex } from "../../../src/services/backup/backupTypes";

// In-memory filesystem shared by the mocked fs layer. Keys are absolute paths;
// the home root is "/home".
interface Entry {
  content: string;
  size: number;
  mtimeMs: number;
}
let fs: Map<string, Entry>;
const callOrder: string[] = [];

function put(path: string, content: string, mtimeMs = 1000): void {
  fs.set(path, { content, size: content.length, mtimeMs });
}

vi.mock("../../../src/services/backup/backupFs", () => ({
  joinPath: (base: string, ...segs: string[]) => [base, ...segs].join("/"),
  fileMetadata: async (path: string) => {
    const e = fs.get(path);
    if (!e) throw new Error(`missing: ${path}`);
    return { size: e.size, mtimeMs: e.mtimeMs };
  },
  listFilesRecursive: async (root: string) => {
    const prefix = root + "/";
    const out = [];
    for (const [path, e] of fs) {
      if (!path.startsWith(prefix)) continue;
      out.push({ relativePath: path.slice(prefix.length), size: e.size, mtimeMs: e.mtimeMs });
    }
    return out;
  },
  readTextFileContent: async (path: string) => {
    const e = fs.get(path);
    if (!e) throw new Error(`missing: ${path}`);
    // A file the walk can stat but the read cannot open (permission denied, etc).
    if (e.content === "__UNREADABLE__") throw new Error(`unreadable: ${path}`);
    return e.content;
  },
  readIndex: async (path: string) => {
    const e = fs.get(path);
    if (!e) return { status: "missing" };
    try {
      const parsed = JSON.parse(e.content) as BackupIndex;
      if (Array.isArray(parsed?.entries)) return { status: "success", index: { entries: parsed.entries } };
      return { status: "invalid" };
    } catch {
      return { status: "invalid" };
    }
  },
  writeIndex: async (path: string, index: BackupIndex) => {
    callOrder.push(`index:${path}`);
    put(path, JSON.stringify(index));
  },
  writeZipArchive: async (entries: [string, string][], outputPath: string) => {
    callOrder.push(`zip:${outputPath}`);
    // Record the archive's manifest so tests can assert entry paths.
    put(outputPath, JSON.stringify(entries.map(([name]) => name)));
    return outputPath;
  },
}));

// Imported after the mock is registered.
let runBackup: typeof import("../../../src/services/backup/backupEngine").runBackup;

const NOW = Date.UTC(2026, 6, 1, 8, 0, 0); // -> 20260701-080000-utc
const INDEX_PATH = "/home/backups/index.json";

function baseInputs(): BackupInputs {
  return { homeRoot: "/home" };
}

// A realistic ~/.quickdeck: durable config + state, the excluded SQLite store and
// its WAL sidecars, plus logs (excluded).
function seedFiles(): void {
  put("/home/config.json", '{"dark":true}');
  put("/home/state.json", '{"panes":[{"content":"work"}]}');
  put("/home/snapshots.sqlite3", "SQLITE-BINARY");
  put("/home/snapshots.sqlite3-wal", "WAL");
  put("/home/snapshots.sqlite3-shm", "SHM");
  put("/home/logs/session.log", "log line"); // excluded
}

function readIndex(): BackupIndex {
  return JSON.parse(fs.get(INDEX_PATH)!.content) as BackupIndex;
}

function archivedNames(fileName: string): string[] {
  return JSON.parse(fs.get(`/home/backups/${fileName}`)!.content) as string[];
}

beforeEach(async () => {
  fs = new Map();
  callOrder.length = 0;
  vi.resetModules();
  ({ runBackup } = await import("../../../src/services/backup/backupEngine"));
});

describe("runBackup", () => {
  it("first run: archives config + state, excludes the sqlite store, archive before index", async () => {
    seedFiles();
    const report = await runBackup(baseInputs(), NOW);

    expect(report.fatal).toBeNull();
    expect(report.nothingChanged).toBe(false);
    expect(report.indexWasReset).toBe(false);
    expect(report.archiveFileName).toBe("backup-20260701-080000-utc.zip");
    // config.json + state.json only. snapshots.sqlite3(+wal/shm) and logs/ excluded.
    expect(report.filesArchived).toBe(2);

    const archived = archivedNames("backup-20260701-080000-utc.zip");
    expect([...archived].sort()).toEqual(["config.json", "state.json"]);
    // The monolithic SQLite store and its sidecars are NOT in the archive.
    expect(archived).not.toContain("snapshots.sqlite3");
    expect(archived).not.toContain("snapshots.sqlite3-wal");
    expect(archived).not.toContain("snapshots.sqlite3-shm");

    // Archive is written before the index (crash-safety invariant).
    expect(callOrder).toEqual([
      "zip:/home/backups/backup-20260701-080000-utc.zip",
      `index:${INDEX_PATH}`,
    ]);

    // The index is the { entries: [...] } object shape (not a bare array).
    const index = readIndex();
    expect(Array.isArray(index)).toBe(false);
    expect(Array.isArray(index.entries)).toBe(true);
    expect(index.entries).toHaveLength(2);
    expect(index.entries[0]).toMatchObject({
      archivedAt: "20260701-080000-utc",
      lastWriteUtc: "1970-01-01T00:00:01Z",
    });
  });

  it("second run with nothing changed writes no archive and no index", async () => {
    seedFiles();
    await runBackup(baseInputs(), NOW);
    callOrder.length = 0;

    const report = await runBackup(baseInputs(), NOW + 60_000);
    expect(report.nothingChanged).toBe(true);
    expect(report.filesArchived).toBe(0);
    expect(callOrder).toEqual([]); // nothing written
  });

  it("captures only the file whose mtime moved", async () => {
    seedFiles();
    await runBackup(baseInputs(), NOW);
    callOrder.length = 0;

    // Touch state.json well beyond the 2s tolerance.
    const s = fs.get("/home/state.json")!;
    fs.set("/home/state.json", { ...s, mtimeMs: s.mtimeMs + 10_000 });

    const report = await runBackup(baseInputs(), NOW + 60_000);
    expect(report.filesArchived).toBe(1);
    expect(archivedNames("backup-20260701-080100-utc.zip")).toEqual(["state.json"]);
    // Index now holds the original 2 rows plus the one new capture.
    expect(readIndex().entries).toHaveLength(3);
  });

  it("resets a corrupt index and runs a full backup", async () => {
    seedFiles();
    put(INDEX_PATH, "{ this is not valid json");

    const report = await runBackup(baseInputs(), NOW);
    expect(report.indexWasReset).toBe(true);
    expect(report.filesArchived).toBe(2);
  });

  it("records a skip for an unreadable file but still backs up the rest", async () => {
    seedFiles();
    // state.json is listed by the walk but the read cannot open it (e.g. it was
    // deleted, or permission denied, between the walk and the archive read).
    put("/home/state.json", "__UNREADABLE__", 1000);

    const report = await runBackup(baseInputs(), NOW);
    expect(report.skips.some((sk) => sk.sourcePath === "/home/state.json")).toBe(true);
    // config.json still archived; the unreadable state.json is skipped, not fatal.
    expect(archivedNames(report.archiveFileName!)).toEqual(["config.json"]);
    expect(report.filesArchived).toBe(1);
    expect(report.fatal).toBeNull();
  });
});
