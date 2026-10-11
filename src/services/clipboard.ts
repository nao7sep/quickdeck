import { invoke, isTauri } from "@tauri-apps/api/core";

// The system clipboard, owned by the Rust core. The webview's own
// navigator.clipboard is not reliably available under the tauri:// scheme, so
// the copy goes through a command like every other native capability.
//
// Outside Tauri (the browser preview) there is no clipboard to write to, the
// same way there is no store to read — the caller sees a no-op, not a failure.
// Snapshot copies share this owner across modal lifetimes: a closed modal's
// native write must settle before a newer copy can replace it. This does not
// serialize ordinary editor/menu copy or writes from other applications.
let pendingCopy: Promise<void> = Promise.resolve();

export async function copyText(text: string): Promise<void> {
  if (!isTauri()) {
    return;
  }

  const copy = pendingCopy.then(() => invoke<void>("copy_text", { text }));
  // Only the queue recovers; the caller still receives its own failure.
  pendingCopy = copy.catch(() => {});
  await copy;
}
