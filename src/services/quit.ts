import { logError, logWarn, serializeError } from "./logger";

// The quit's save, shared by every quit path (unsaved-edits conventions,
// Quitting). Each step is bounded: the snapshots by QUIT_SNAPSHOT_BOUND_MS, the
// user's own work by QUIT_SAVE_BOUND_MS. Together they stay inside the Rust
// core's wait for an OS session end (SESSION_SAVE_WAIT in src-tauri/src/quit.rs).
export const QUIT_SNAPSHOT_BOUND_MS = 400;
export const QUIT_SAVE_BOUND_MS = 1000;

type Settled = { kind: "done" } | { kind: "failed"; error: unknown } | { kind: "expired" };

// A step past its bound keeps running; its outcome is unknown.
function within(step: () => Promise<void>, ms: number): Promise<Settled> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ kind: "expired" }), ms);
    Promise.resolve()
      .then(step)
      .then(
        () => resolve({ kind: "done" }),
        (error: unknown) => resolve({ kind: "failed", error }),
      )
      .finally(() => clearTimeout(timer));
  });
}

export type QuitSaveSteps = {
  // The insurance snapshots: logged when they fail, never holding the quit.
  snapshot: () => Promise<void>;
  // The panes, settings and state: the user's own work.
  save: () => Promise<void>;
};

// Resolves whether the user's own work is known to be saved.
export async function saveForQuit(steps: QuitSaveSteps): Promise<boolean> {
  const snapshot = await within(steps.snapshot, QUIT_SNAPSHOT_BOUND_MS);
  if (snapshot.kind === "failed") {
    logWarn("close snapshot failed", { error: serializeError(snapshot.error) });
  } else if (snapshot.kind === "expired") {
    logWarn("close snapshot wait expired", { ms: QUIT_SNAPSHOT_BOUND_MS });
  }

  const save = await within(steps.save, QUIT_SAVE_BOUND_MS);
  if (save.kind === "failed") {
    logError("save on close failed", { error: serializeError(save.error) });
  } else if (save.kind === "expired") {
    logError("save on close wait expired", { ms: QUIT_SAVE_BOUND_MS });
  }
  return save.kind === "done";
}
