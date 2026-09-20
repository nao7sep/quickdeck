import { invoke, isTauri } from "@tauri-apps/api/core";

// The system clipboard, owned by the Rust core. The webview's own
// navigator.clipboard is not reliably available under the tauri:// scheme, so
// the copy goes through a command like every other native capability.
//
// Outside Tauri (the browser preview) there is no clipboard to write to, the
// same way there is no store to read — the caller sees a no-op, not a failure.
export async function copyText(text: string): Promise<void> {
  if (!isTauri()) {
    return;
  }

  await invoke<void>("copy_text", { text });
}
