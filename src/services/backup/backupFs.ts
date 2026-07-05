// The filesystem boundary for the backup. The sandboxed webview owns no disk
// access of its own, so every touch is a Rust command (see src-tauri/src/lib.rs).
// These thin wrappers mirror the Rust FileMetadata / WalkedFile structs and keep
// the engine and collector free of `invoke` details (and easy to mock in tests).

import { invoke } from "@tauri-apps/api/core";
import type { BackupIndex } from "./backupTypes";

// A file's size (bytes) and last-modified time (epoch milliseconds). Backup uses
// size + mtime to detect which files changed without reading their contents.
export interface FileMetadata {
  size: number;
  mtimeMs: number;
}

export interface WalkedFile {
  relativePath: string; // relative to the walked root, forward-slash separated
  size: number;
  mtimeMs: number;
}

// Returns a single file's size and mtime. Throws (missing file, permission
// denied, …) so backup can skip that file best-effort.
export async function fileMetadata(path: string): Promise<FileMetadata> {
  return await invoke<FileMetadata>("file_metadata", { path });
}

// Recursively lists every regular file under `root` with size and mtime, each
// path relative to `root`. A missing root returns an empty list.
export async function listFilesRecursive(root: string): Promise<WalkedFile[]> {
  return await invoke<WalkedFile[]>("list_files_recursive", { root });
}

// Reads a file's raw text content, throwing if it is missing or unreadable.
// Backup relies on the throw to skip files it cannot read.
export async function readTextFileContent(path: string): Promise<string> {
  return await invoke<string>("read_text_file", { path });
}

// Reports whether `path` already exists. The engine uses this to detect a
// same-millisecond archive-name collision before finalizing archivedAt (the
// no-clobber create) — never for any other decision.
export async function pathExists(path: string): Promise<boolean> {
  return await invoke<boolean>("path_exists", { path });
}

// Writes a zip archive of [entryName, content] text pairs to `outputPath` (atomic
// temp + rename on the Rust side), creating the backups directory if needed. Entry
// names must already be unique (case-insensitively). Returns the output path.
export async function writeZipArchive(
  entries: [string, string][],
  outputPath: string,
): Promise<string> {
  return await invoke<string>("write_zip_archive", { entries, outputPath });
}

// Reads the index once via the backend and returns an explicit load result: a
// missing file is a normal first run; anything unparseable is surfaced so the
// engine can reset and run a full backup.
export type IndexReadResult =
  | { status: "success"; index: BackupIndex }
  | { status: "missing" }
  | { status: "invalid" };

export async function readIndex(path: string): Promise<IndexReadResult> {
  let text: string;
  try {
    text = await invoke<string>("read_text_file", { path });
  } catch {
    // The Rust command errors for a missing file; treat it as a first run.
    return { status: "missing" };
  }
  try {
    const parsed = JSON.parse(text) as BackupIndex;
    if (Array.isArray(parsed?.entries)) {
      return { status: "success", index: { entries: parsed.entries } };
    }
    return { status: "invalid" };
  } catch {
    return { status: "invalid" };
  }
}

// Writes the index atomically as a JSON object (the `{ entries: [...] }` shape).
export async function writeIndex(path: string, index: BackupIndex): Promise<void> {
  await invoke("write_index_json", { path, index });
}

// Joins path segments onto an already-absolute base using that base's own
// separator (a Windows path contains "\"), trimming stray separators.
export function joinPath(base: string, ...segments: string[]): string {
  const sep = base.includes("\\") && !base.includes("/") ? "\\" : "/";
  const trimEnd = (s: string) => s.replace(/[/\\]+$/, "");
  const trimBoth = (s: string) => s.replace(/^[/\\]+|[/\\]+$/g, "");
  let result = trimEnd(base);
  for (const segment of segments) {
    const part = trimBoth(segment);
    if (part) result = `${result}${sep}${part}`;
  }
  return result;
}
