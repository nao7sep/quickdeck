// Discovers what to back up. QuickDeck keeps NO external documents — everything
// it manages lives under ~/.quickdeck — so collection is a single recursive walk
// of the home root, mirrored onto the archive root, minus the exclusion
// categories (logs/, backups/, *.tmp, the snapshot SQLite store, OS noise). The
// collector does the filesystem reads; the change decision is left to the pure
// plan. It never throws — an unreadable subtree becomes a recorded skip.

import { listFilesRecursive, joinPath, type WalkedFile } from "./backupFs";
import type { BackupCandidate, BackupSkip } from "./backupTypes";
import { homeArchivePath } from "./archivePaths";
import { isExcludedHomeFile } from "./homeRootExclusions";

export interface BackupInputs {
  homeRoot: string;
}

export interface CollectResult {
  candidates: BackupCandidate[];
  skips: BackupSkip[];
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function collectCandidates(inputs: BackupInputs): Promise<CollectResult> {
  const candidates: BackupCandidate[] = [];
  const skips: BackupSkip[] = [];

  let walked: WalkedFile[] = [];
  try {
    walked = await listFilesRecursive(inputs.homeRoot);
  } catch (error) {
    skips.push({ sourcePath: inputs.homeRoot, reason: describeError(error) });
  }

  for (const file of walked) {
    if (isExcludedHomeFile(file.relativePath)) continue;
    candidates.push({
      sourcePath: joinPath(inputs.homeRoot, file.relativePath),
      archivePath: homeArchivePath(file.relativePath),
      sizeBytes: file.size,
      mtimeMs: file.mtimeMs,
    });
  }

  return { candidates, skips };
}
