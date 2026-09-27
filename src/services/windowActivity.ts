import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { logWarn, serializeError } from "./logger";

// The focus ring softens while the window is inactive (interface-styling
// conventions). The page's own focus is not a reliable signal for that inside a
// webview, so the native window's focus events decide, marked on the root where
// the stylesheet reads it.
export function applyWindowActivity(
  root: Pick<Element, "toggleAttribute">,
  active: boolean,
): void {
  root.toggleAttribute("data-window-inactive", !active);
}

export function installWindowActivity(root: Element = document.documentElement): void {
  if (!isTauri()) return;
  void getCurrentWindow()
    .onFocusChanged(({ payload }) => applyWindowActivity(root, payload))
    .catch((error) => logWarn("window focus listener failed", { error: serializeError(error) }));
}
