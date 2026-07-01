// The startup edge of the backup. Fire-and-forget after config and state have
// loaded: it must never delay the window, surface an error to the user, or crash.
// Everything is logged; nothing is thrown.
//
// "Just in case" runs at startup, not shutdown, because startup is the safest
// moment — the on-disk files are whatever the last session flushed, before this
// session can touch them.

import { isTauri } from "@tauri-apps/api/core";
import { logError, logInfo, logWarn, serializeError } from "../logger";
import { runBackup } from "./backupEngine";
import type { BackupInputs } from "./backupCollector";
import type { BackupReport } from "./backupTypes";

// Kicks off a single best-effort backup without blocking the caller. `homeRoot`
// is the app's absolute data root (~/.quickdeck), resolved by the Rust core and
// handed to the frontend via load_app_data's `dataDir`.
export function runBackupInBackground(homeRoot: string): void {
  void runOnce(homeRoot);
}

async function runOnce(homeRoot: string): Promise<void> {
  try {
    // No Rust core in the browser preview — nothing to back up, no commands.
    if (!isTauri()) {
      return;
    }

    const inputs: BackupInputs = { homeRoot };
    logReport(await runBackup(inputs, Date.now()));
  } catch (error) {
    // Final backstop: any unexpected fault stays out of the user's way.
    logError("startup backup failed", { error: serializeError(error) });
  }
}

function logReport(report: BackupReport): void {
  for (const skip of report.skips) {
    logWarn("backup skipped file", { path: skip.sourcePath, reason: skip.reason });
  }
  if (report.indexWasReset) {
    logWarn("backup index was reset; ran a full backup");
  }
  if (report.fatal !== null) {
    logError("backup failed", { reason: report.fatal });
    return;
  }
  if (report.nothingChanged) {
    logInfo("backup: nothing changed");
    return;
  }
  logInfo("backup created", {
    archive: report.archiveFileName,
    files: report.filesArchived,
    skipped: report.skips.length,
  });
}
