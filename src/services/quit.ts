import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { logError, logWarn, serializeError } from "./logger";

// The exit sequence's one deadline for a quit the main window starts, fixed
// when its close begins (architecture conventions, Deadlines at the owner).
// The quit's save draws on it; the close hands what remains to the Rust core
// (beginExit), whose own exit steps draw on the rest. At an OS session end the
// core's wait is the deadline and the window holds none (EXIT_DEADLINE in
// src-tauri/src/quit.rs).
export const EXIT_DEADLINE_MS = 3000;

export type QuitSaveSteps = {
  // The insurance snapshots: logged when they fail, never holding the quit.
  snapshot: () => Promise<void>;
  // The panes and committed settings: the user's own work.
  save: () => Promise<boolean>;
  onFailure?: (error: unknown) => void;
};

// Resolves whether the user's own work is known to be saved, shared by every
// quit path (unsaved-edits conventions, Quitting). Both steps begin at once, so
// the optional snapshot cannot delay saving authored text. With a deadline (a
// Date.now() time), work not finished by then is not waited for: it carries on
// in its owner, and an unfinished save counts as not saved.
export async function saveForQuit(steps: QuitSaveSteps, deadline?: number): Promise<boolean> {
  const snapshotWork = Promise.resolve().then(steps.snapshot).then(
    () => true,
    (error: unknown) => {
      logWarn("close snapshot failed", { error: serializeError(error) });
      return true;
    },
  );
  const saveWork = Promise.resolve().then(steps.save).catch((error: unknown) => {
    logError("save on close failed", { error: serializeError(error) });
    steps.onFailure?.(error);
    return false;
  });
  if (deadline === undefined) {
    await snapshotWork;
    return saveWork;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const passed = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), Math.max(0, deadline - Date.now()));
  });
  try {
    if ((await Promise.race([snapshotWork, passed])) === null) {
      logWarn("close snapshot unfinished at the exit deadline", { ms: EXIT_DEADLINE_MS });
    }
    const saved = await Promise.race([saveWork, passed]);
    if (saved === null) logError("save on close unfinished at the exit deadline", { ms: EXIT_DEADLINE_MS });
    return saved === true;
  } finally {
    clearTimeout(timer);
  }
}

// Hands the Rust core what remains of the exit's deadline as the window closes.
export function beginExit(deadline: number): Promise<void> {
  return invoke("begin_exit", { remainingMs: Math.max(0, Math.round(deadline - Date.now())) });
}

// The event the Rust core sends when an OS logout, restart or shutdown asks
// the app to quit (src-tauri/src/quit.rs).
const SESSION_ENDING_EVENT = "session-ending";

export function onSessionEnding(listener: (attempt: number) => void): Promise<() => void> {
  return listen<number>(SESSION_ENDING_EVENT, (event) => listener(event.payload));
}

// Tells the Rust core the session-end save has finished, whatever its outcome,
// so the app exits without waiting out its deadline.
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
