import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { logError, logWarn, serializeError } from "./logger";

// The quit's save, shared by every quit path (unsaved-edits conventions,
// Quitting). Each step is bounded: the snapshots by QUIT_SNAPSHOT_BOUND_MS, the
// user's own work by QUIT_SAVE_BOUND_MS. Together they stay inside the Rust
// core's wait for an OS session end (SESSION_SAVE_WAIT in src-tauri/src/quit.rs).
export const QUIT_SNAPSHOT_BOUND_MS = 400;
export const QUIT_SAVE_BOUND_MS = 1000;

type Settled<T> = { kind: "done"; value: T } | { kind: "failed"; error: unknown } | { kind: "expired" };

// A step past its bound keeps running; its outcome is unknown.
function within<T>(step: () => Promise<T>, ms: number): Promise<Settled<T>> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ kind: "expired" }), ms);
    Promise.resolve()
      .then(step)
      .then(
        (value) => resolve({ kind: "done", value }),
        (error: unknown) => resolve({ kind: "failed", error }),
      )
      .finally(() => clearTimeout(timer));
  });
}

export type QuitSaveSteps = {
  // The insurance snapshots: logged when they fail, never holding the quit.
  snapshot: () => Promise<void>;
  // The panes and committed settings: the user's own work.
  save: () => Promise<boolean>;
  onFailure?: (error: unknown) => void;
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
    steps.onFailure?.(save.error);
  } else if (save.kind === "expired") {
    logError("save on close wait expired", { ms: QUIT_SAVE_BOUND_MS });
  }
  return save.kind === "done" && save.value;
}

// The event the Rust core sends when an OS logout, restart or shutdown asks
// the app to quit (src-tauri/src/quit.rs).
const SESSION_ENDING_EVENT = "session-ending";

export function onSessionEnding(listener: (attempt: number) => void): Promise<() => void> {
  return listen<number>(SESSION_ENDING_EVENT, (event) => listener(event.payload));
}

// Tells the Rust core the session-end save has finished, whatever its outcome,
// so the app exits without waiting out its bound.
export function reportSessionEndSaved(attempt: number): Promise<void> {
  return invoke("session_end_saved", { attempt });
}

export type QuitQuestion = { title: string; body: string; retry: string; quitAnyway: string; cancel: string };
type QuitChoice = "retry" | "quitAnyway" | "cancel";

// Whether the main window is out of sight, minimized or hidden, so a question
// must not attach to it (window conventions, Background visibility and
// activation). A window that cannot say is treated as shown.
export async function windowIsHidden(window: {
  isMinimized: () => Promise<boolean>;
  isVisible: () => Promise<boolean>;
}): Promise<boolean> {
  try {
    const [minimized, visible] = await Promise.all([window.isMinimized(), window.isVisible()]);
    return minimized || !visible;
  } catch {
    return false;
  }
}

// The quit save-failure question as a standalone dialog, answered by the user.
export function askQuitSaveFailureStandalone(question: QuitQuestion): Promise<QuitChoice> {
  return invoke<QuitChoice>("ask_quit_save_failure_standalone", { question });
}
