// Types for the just-in-case data backup. The design mirrors the fleet-wide
// data-backup convention (see company/conventions): a size + mtime incremental
// archive with an append-only index, written archive-first then index.

// One row of the backup index (backups/index.json). One row is appended per
// archived file per run in which that file changed; the latest row per
// archivePath (by archivedAt) describes the most recent capture.
export interface BackupIndexEntry {
  // Run stamp "yyyymmdd-hhmmss-fff-utc" (also the zip's stem). Rows written before
  // milliseconds were adopted carry the second-precision "yyyymmdd-hhmmss-utc" and
  // stay valid as-is — never migrated or rewritten.
  archivedAt: string;
  archivePath: string; // entry path inside the archive (forward-slash)
  sizeBytes: number;
  lastWriteUtc: string; // ISO 8601, truncated to whole seconds
}

// The index file is a JSON object wrapping the rows (not a bare array), so future
// top-level metadata (a schema `version`, say) can be added without disturbing the
// records — the fleet-wide shape (data-backup-conventions).
export interface BackupIndex {
  entries: BackupIndexEntry[];
}

// One file the collector decided is worth considering, already stat'd. Content is
// read lazily by the engine, and only if the plan marks the file changed.
export interface BackupCandidate {
  sourcePath: string; // absolute path on disk
  archivePath: string; // entry path inside the archive
  sizeBytes: number;
  mtimeMs: number; // epoch ms, for change detection
}

// A file the run could not back up (unreadable, case collision). Never fatal —
// the backup captures whatever else it can and records the skip.
export interface BackupSkip {
  sourcePath: string;
  reason: string;
}

// The outcome of one backup run, for logging. `fatal` is set only for an
// unexpected failure that aborted the whole run.
export interface BackupReport {
  nothingChanged: boolean;
  archiveFileName: string | null;
  filesArchived: number;
  skips: BackupSkip[];
  indexWasReset: boolean;
  fatal: string | null;
}
