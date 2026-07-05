// Pure exclusion predicate for the ~/.quickdeck home-root walk. The backup is
// optimistic — it captures everything under the home root except a small set of
// categories that are re-derivable, the backup's own output, or a monolithic
// mutating store:
//   - logs/     : session logs, not user data (fleet floor).
//   - backups/  : our own archives and index (never back up the backups).
//   - *.tmp     : atomic-write temp files ("<stem>-<discriminator>.tmp") mid-rename (floor).
//   - snapshots.sqlite3 (+ -wal / -shm sidecars): the monolithic SQLite snapshot
//     store — excluded on principle (size/mtime churn on every write, carries its
//     own atomic-commit/journaling integrity; high cost, low value). App-specific.
//   - OS/file-manager metadata a file manager drops into any browsed directory
//     (.DS_Store, Thumbs.db, desktop.ini) — the fleet floor, matched case-insensitively.
//
// NOTE: config.json AND state.json are NOT excluded. Unlike dropkick, quickdeck's
// state.json holds the pane CONTENT (the user's durable text), so it is backed up
// per the content-based rule — it is durable user work, not just UI chrome.
// (The Rust walker reports directory-entry types without following symlinks, so a
// link is never followed or archived.)

const EXCLUDED_BASENAMES: ReadonlySet<string> = new Set([
  // Fleet OS-noise floor.
  ".ds_store",
  "thumbs.db",
  "desktop.ini",
  // App-specific: the monolithic SQLite snapshot store and its WAL sidecars.
  "snapshots.sqlite3",
  "snapshots.sqlite3-wal",
  "snapshots.sqlite3-shm",
]);

export function isExcludedHomeFile(relativePath: string): boolean {
  const segments = relativePath.split("/");
  const top = segments[0];
  if (top === "logs" || top === "backups") return true;
  const lower = segments[segments.length - 1].toLowerCase();
  if (lower.endsWith(".tmp")) return true;
  if (EXCLUDED_BASENAMES.has(lower)) return true;
  return false;
}
