import type { SaveState } from "../types";

/**
 * The save-race resolution behind autosave/`saveNow`: a monotonic dirty counter
 * is snapshotted at the start of a save, and after the write completes its value
 * is compared again. If an edit bumped the counter while the save was in flight,
 * the just-written bytes are already stale, so the state stays `"unsaved"` (and
 * autosave will run again); otherwise the save is current and the state is
 * `"saved"`. Pure so this race resolution can be tested without driving a save.
 */
export function resolveSaveState(dirtyAtStart: number, dirtyNow: number): Extract<SaveState, "saved" | "unsaved"> {
  return dirtyNow === dirtyAtStart ? "saved" : "unsaved";
}
