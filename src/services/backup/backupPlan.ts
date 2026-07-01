// The pure change-detection half of the backup: given the candidates the
// collector found and the existing index, return only the candidates whose bytes
// have (almost certainly) changed since their last capture. No I/O, so it is
// unit-tested directly.

import type { BackupCandidate, BackupIndex, BackupIndexEntry } from "./backupTypes";

// Two mtimes within this window count as equal. Absorbs FAT/exFAT's 2-second
// modification-time granularity (USB drives) and the whole-second truncation the
// index stores. Change detection is deliberately size + mtime, never a content
// hash: a large file that happens to keep its size after an edit still moves its
// mtime, and hashing every file on every launch is the cost this avoids.
export const MTIME_MATCH_TOLERANCE_MS = 2000;

// The latest index row per archivePath. archivedAt is a "yyyymmdd-hhmmss-utc"
// stamp, so a plain lexicographic max is chronological.
function latestByPath(index: BackupIndex): Map<string, BackupIndexEntry> {
  const latest = new Map<string, BackupIndexEntry>();
  for (const entry of index.entries) {
    const prior = latest.get(entry.archivePath);
    if (prior === undefined || entry.archivedAt > prior.archivedAt) {
      latest.set(entry.archivePath, entry);
    }
  }
  return latest;
}

export function selectChanged(
  candidates: BackupCandidate[],
  index: BackupIndex,
): BackupCandidate[] {
  const latest = latestByPath(index);
  return candidates.filter((candidate) => {
    const prior = latest.get(candidate.archivePath);
    if (prior === undefined) return true; // never captured
    if (prior.sizeBytes !== candidate.sizeBytes) return true;
    const priorMs = Date.parse(prior.lastWriteUtc);
    if (Number.isNaN(priorMs)) return true; // unparseable stamp → recapture
    return Math.abs(priorMs - candidate.mtimeMs) > MTIME_MATCH_TOLERANCE_MS;
  });
}
