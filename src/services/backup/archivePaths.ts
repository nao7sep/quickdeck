// Pure mapping from quickdeck's on-disk data to archive entry paths, plus the
// fleet-wide case-insensitive uniqueness guard. QuickDeck keeps NO external
// documents (unlike dropkick's task lists) — everything it manages lives under
// ~/.quickdeck — so this is the simplest layout: a home-root file mirrors its
// path relative to the root straight onto the archive root.

import type { BackupCandidate } from "./backupTypes";

// Home-root files map straight: the path relative to ~/.quickdeck is the entry.
export function homeArchivePath(relativePath: string): string {
  return relativePath;
}

// Enforces the hard fleet invariant that no two archive entries differ only in
// case (they would collide on a case-insensitive macOS/Windows filesystem on any
// future extraction). Keeps the first candidate per case-folded path and reports
// the rest as dropped so the engine can record a skip for each.
export function dedupeCaseInsensitive(candidates: BackupCandidate[]): {
  kept: BackupCandidate[];
  dropped: BackupCandidate[];
} {
  const seen = new Set<string>();
  const kept: BackupCandidate[] = [];
  const dropped: BackupCandidate[] = [];
  for (const candidate of candidates) {
    const key = candidate.archivePath.toLowerCase();
    if (seen.has(key)) {
      dropped.push(candidate);
    } else {
      seen.add(key);
      kept.push(candidate);
    }
  }
  return { kept, dropped };
}
