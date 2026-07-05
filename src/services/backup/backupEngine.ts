// Orchestrates one backup run: load the index, collect candidates, drop
// case-collisions, select the changed ones, write the archive, then write the
// index. The write order is load-bearing — the archive lands (atomically) first,
// and only a fully written archive gets recorded, so a crash between the two
// leaves an orphaned archive that the next run simply recaptures, never a phantom
// index row. The engine never throws for expected trouble; it returns a report.

import {
  readIndex,
  writeIndex,
  writeZipArchive,
  readTextFileContent,
  pathExists,
  joinPath,
} from "./backupFs";
import type {
  BackupIndex,
  BackupReport,
  BackupSkip,
  BackupCandidate,
} from "./backupTypes";
import { collectCandidates, type BackupInputs } from "./backupCollector";
import { dedupeCaseInsensitive } from "./archivePaths";
import { selectChanged } from "./backupPlan";
import { backupTimestamp, toIsoSeconds } from "./backupTime";

const BACKUPS_DIR_NAME = "backups";
const INDEX_FILE_NAME = "index.json";

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Picks the archivedAt stamp this run will use: `backupTimestamp(nowMs)`, unless
// that stamp's `backup-<archivedAt>.zip` already exists in `backupsDir` — a
// same-millisecond collision, most commonly two instances of the app starting at
// once — in which case it advances one millisecond and checks again, looping
// until it finds a free name (the no-clobber create in the data-backup
// conventions). The winning stamp is used for both the archive's file name and
// its index rows, so the two can never disagree.
async function resolveArchiveStamp(
  backupsDir: string,
  nowMs: number,
): Promise<{ archivedAt: string; archiveFileName: string }> {
  let candidateMs = nowMs;
  for (;;) {
    const archivedAt = backupTimestamp(candidateMs);
    const archiveFileName = `backup-${archivedAt}.zip`;
    const taken = await pathExists(joinPath(backupsDir, archiveFileName));
    if (!taken) return { archivedAt, archiveFileName };
    candidateMs += 1;
  }
}

// Loads the index. A missing index is a normal first run (empty). A corrupt or
// unreadable one is reset to empty — the run then recaptures everything and
// overwrites the bad file, rather than trusting a ledger it cannot parse.
async function loadIndex(
  indexPath: string,
): Promise<{ index: BackupIndex; wasReset: boolean }> {
  const result = await readIndex(indexPath);
  if (result.status === "missing") return { index: { entries: [] }, wasReset: false };
  if (result.status === "success") return { index: result.index, wasReset: false };
  return { index: { entries: [] }, wasReset: true };
}

export async function runBackup(
  inputs: BackupInputs,
  nowMs: number,
): Promise<BackupReport> {
  const skips: BackupSkip[] = [];
  let indexWasReset = false;
  try {
    const backupsDir = joinPath(inputs.homeRoot, BACKUPS_DIR_NAME);
    const indexPath = joinPath(backupsDir, INDEX_FILE_NAME);

    const loaded = await loadIndex(indexPath);
    const index = loaded.index;
    indexWasReset = loaded.wasReset;

    const collected = await collectCandidates(inputs);
    skips.push(...collected.skips);

    const { kept, dropped } = dedupeCaseInsensitive(collected.candidates);
    for (const collision of dropped) {
      skips.push({
        sourcePath: collision.sourcePath,
        reason: `case-insensitive archive-path collision: ${collision.archivePath}`,
      });
    }

    const changed = selectChanged(kept, index);

    // Materialize the archive entries by reading each changed file's bytes now.
    // An unreadable file is a recorded skip, not a fatal error.
    const entries: [string, string][] = [];
    const archived: BackupCandidate[] = [];
    for (const candidate of changed) {
      let content: string;
      try {
        content = await readTextFileContent(candidate.sourcePath);
      } catch (error) {
        skips.push({ sourcePath: candidate.sourcePath, reason: describeError(error) });
        continue;
      }
      entries.push([candidate.archivePath, content]);
      archived.push(candidate);
    }

    if (entries.length === 0) {
      return {
        nothingChanged: true,
        archiveFileName: null,
        filesArchived: 0,
        skips,
        indexWasReset,
        fatal: null,
      };
    }

    const { archivedAt, archiveFileName } = await resolveArchiveStamp(backupsDir, nowMs);

    // Archive first...
    await writeZipArchive(entries, joinPath(backupsDir, archiveFileName));

    // ...then record it. Append one row per archived file (the index keeps
    // history; the plan reads the latest row per path).
    const updatedIndex: BackupIndex = { entries: [...index.entries] };
    for (const candidate of archived) {
      updatedIndex.entries.push({
        archivedAt,
        archivePath: candidate.archivePath,
        sizeBytes: candidate.sizeBytes,
        lastWriteUtc: toIsoSeconds(candidate.mtimeMs),
      });
    }
    await writeIndex(indexPath, updatedIndex);

    return {
      nothingChanged: false,
      archiveFileName,
      filesArchived: archived.length,
      skips,
      indexWasReset,
      fatal: null,
    };
  } catch (error) {
    return {
      nothingChanged: false,
      archiveFileName: null,
      filesArchived: 0,
      skips,
      indexWasReset,
      fatal: describeError(error),
    };
  }
}
